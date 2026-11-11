#!/usr/bin/env bash
# Rehearses the on-site box (issue #40, ADR-0027) on a local Docker, end to end over HTTPS by hostname:
#
#   1. Caddy accepts the TLS_MODE=files configuration (with a throwaway self-signed certificate), and the
#      certificate script's checks work (fake token file; it never runs certbot here).
#   2. Build the Collator image and start deploy/collator/compose.yaml with TLS_MODE=internal.
#   3. Load the Circus 2026 event-day cartridge (with its Officials list) into the running container.
#   4. Over https://judge.camporeeconductor.com, trusting only Caddy's own root CA (taken from the caddy
#      container; no -k): add a Group and a Team, submit a score, resend it (a repeat, not a duplicate).
#   5. The Official view for that Activity shows exactly one entry and one ranked row; an Official added with
#      add-official in the container signs in (#42).
#   6. The backup timer wrote a backup to the backup folder that opens and contains the score; backup-now
#      works too.
#
#   7. Reset scores through the API (#42 PR 8): the score is gone, the reset's backup was written first; then
#      restore-backup in the container brings the score back, under a new `restore` epoch (#66).
#
# Usage: docs/runbook/rehearse-collator.sh
# Needs docker without sudo, node and the workspace's dependencies (pnpm install), curl and openssl.
# Publishes no well-known ports: HTTPS on REHEARSAL_HTTPS_PORT (default 8443), HTTP on REHEARSAL_HTTP_PORT
# (default 8080). Uses its own Compose project (REHEARSAL_PROJECT, default collator-rehearsal) and removes
# it, with its volumes, when it ends. The image it builds stays (collator-rehearsal:local) so a rerun is fast.
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
project=${REHEARSAL_PROJECT:-collator-rehearsal}
# Cleanup runs `down -v` on this project: never let it be the real box's (deploy/collator's is "collator").
case "$project" in
  *rehearsal*) ;;
  *) echo "rehearse-collator: REHEARSAL_PROJECT must contain 'rehearsal' (got '$project')" >&2; exit 2 ;;
esac
https_port=${REHEARSAL_HTTPS_PORT:-8443}
http_port=${REHEARSAL_HTTP_PORT:-8080}
host=judge.camporeeconductor.com
director=director@example.com # on the test cartridge's Officials list (apps/collator/src/test-support.ts)
work=$(mktemp -d)

# Everything compose sees is set here; an empty env file keeps a real deploy/collator/.env out of it.
: >"$work/empty.env"
export COLLATOR_IMAGE=collator-rehearsal:local TLS_MODE=internal COLLATOR_HOSTNAME=$host \
  HTTPS_PORT=$https_port HTTP_PORT=$http_port \
  BACKUP_HOST_DIR=$work/backups CARTRIDGES_DIR=$work/cartridges \
  BACKUP_EVERY_MINUTES=0.05 BACKUP_KEEP=5
compose() { docker compose -p "$project" --env-file "$work/empty.env" -f "$repo/deploy/collator/compose.yaml" "$@"; }

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "== logs"
    compose logs --no-color --tail 40 2>/dev/null || true
  fi
  compose down -v -t 2 >/dev/null 2>&1 || true
  rm -rf "$work" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT

fail() { echo "FAIL  $*" >&2; exit 1; }
pass() { echo "PASS  $*"; }

# The Collator runs as uid 1000 (node), which may not be this user (CI's runner is 1001).
mkdir -p "$work/backups" "$work/cartridges" "$work/certs"
chmod 777 "$work/backups"

echo "== 1. Caddy accepts TLS_MODE=files"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=$host" -addext "subjectAltName=DNS:$host" \
  -keyout "$work/certs/privkey.pem" -out "$work/certs/fullchain.pem" 2>/dev/null
chmod 644 "$work/certs/privkey.pem" # readable inside the container; a throwaway key

# The certificate script's checks, with fake files only: it never runs certbot here (--print, --check).
cert() { CERTS_DIR=$work/certs CLOUDFLARE_INI=$work/fake.ini "$repo/deploy/collator/issue-cert.sh" "$@"; }
cert --print >/dev/null 2>&1 && fail "issue-cert.sh accepted a missing token file"
echo "not a token" >"$work/fake.ini" && chmod 644 "$work/fake.ini"
cert --print >/dev/null 2>&1 && fail "issue-cert.sh accepted a token file with mode 644"
chmod 600 "$work/fake.ini"
cert --print | grep -q "certbot/dns-cloudflare:v" || fail "issue-cert.sh --print"
cert --print | grep -q "not a token" && fail "issue-cert.sh printed the token"
cert --print | grep -q -- "--keep-until-expiring" || fail "issue-cert.sh should keep a certificate that isn't near expiry"
cert --print --renew | grep -q -- "--force-renewal" || fail "issue-cert.sh --renew should force a fresh certificate"
# An explicit far-off deadline, so this keeps meaning "too short" after the 2027 event has passed.
rc=0 && CERT_MUST_LAST_UNTIL=2099-01-01 cert --check >/dev/null 2>&1 || rc=$?
[ "$rc" = 3 ] || fail "issue-cert.sh --check should warn (3) for a certificate ending before its deadline, got $rc"
CERT_MUST_LAST_UNTIL=$(date -u +%F) cert --check >/dev/null || fail "issue-cert.sh --check with an earlier date"
pass "issue-cert.sh refuses a missing or mode-644 token file, never prints it, and checks the expiry"

CERTS_DIR=$work/certs docker compose -p "$project" --env-file "$work/empty.env" \
  -f "$repo/deploy/collator/compose.yaml" -f "$repo/deploy/collator/compose.tls-files.yaml" \
  run --rm --no-deps -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >"$work/validate.log" 2>&1 ||
  { cat "$work/validate.log"; fail "caddy validate with TLS_MODE=files"; }
pass "caddy validate with TLS_MODE=files and certificate files in /certs"

echo "== 2. build and start with TLS_MODE=internal on :$https_port"
compose build collator >"$work/build.log" 2>&1 || { tail -40 "$work/build.log"; fail "image build"; }
compose up -d --wait --wait-timeout 90 >"$work/up.log" 2>&1 || { cat "$work/up.log"; fail "compose up"; }
pass "collator healthy, caddy running"

# Trust only Caddy's local root CA: no -k. It appears once Caddy has issued the site's certificate.
for _ in $(seq 30); do
  compose cp caddy:/data/caddy/pki/authorities/local/root.crt "$work/root.crt" >/dev/null 2>&1 && break
  sleep 1
done
[ -s "$work/root.crt" ] || fail "Caddy's root CA never appeared"
api() { # api <method> <path> [json body] -> prints "<status> <body>"
  curl -sS --max-time 10 --cacert "$work/root.crt" --resolve "$host:$https_port:127.0.0.1" \
    -X "$1" -H "content-type: application/json" -H "x-official-email: $director" \
    ${3:+--data "$3"} -w ' %{http_code}' "https://$host:$https_port$2"
}
status_of() { echo "${1##* }"; }
body_of() { echo "${1% *}"; }
for _ in $(seq 30); do
  health=$(api GET /api/health 2>/dev/null) && [ "$(status_of "$health")" = 200 ] && break
  sleep 1
done
[ "$(status_of "${health:-x 0}")" = 200 ] || fail "https://$host:$https_port/api/health over Caddy's CA: ${health:-no answer}"
pass "HTTPS by hostname, verified against Caddy's root CA"
curl -sS --max-time 10 --cacert "$work/root.crt" --resolve "$host:$https_port:127.0.0.1" \
  "https://$host:$https_port/" | grep -q "<title>Judge</title>" || fail "the judge page isn't served"
pass "judge page served"

echo "== 3. load the Circus 2026 event-day cartridge"
(cd "$repo" && node apps/collator-web/e2e/make-cartridge.ts "$work/cartridges/circus-event-day.zip")
chmod 644 "$work/cartridges/circus-event-day.zip"
compose exec -T collator node apps/collator/src/cli/load-cartridge.ts /cartridges/circus-event-day.zip ||
  fail "load-cartridge"
pass "cartridge loaded"

echo "== 4. a Group, a Team, a score, and the score resent"
fixtures=$repo/packages/schema/fixtures/circus-2026
activity=$(node -p "JSON.parse(require('fs').readFileSync('$fixtures/activities/clown-car.json','utf8')).id")
expect() { # expect <name> <status> <response>
  [ "$(status_of "$3")" = "$2" ] || fail "$1: expected HTTP $2, got $(status_of "$3"): $(body_of "$3")"
  pass "$1 ($2 $(body_of "$3"))"
}
expect "add a Group" 201 "$(api PUT /api/groups/rehearsal-group '{"name":"Troop 101"}')"
expect "add a Team" 201 "$(api PUT /api/teams/rehearsal-team '{"groupId":"rehearsal-group","name":"Owls"}')"
score=$(printf '{"judge":{"id":"rehearsal-judge","name":"Alex Judge","email":"alex@example.com"},"activityId":"%s","entrantId":"rehearsal-team","values":{"scouts_balanced":7,"p_flag":5},"phoneCreatedAt":"2027-05-15T09:30:00Z"}' "$activity")
expect "submit a score" 201 "$(api PUT /api/scores/rehearsal-score-1 "$score")"
resent=$(api PUT /api/scores/rehearsal-score-1 "$score")
expect "resend the score" 200 "$resent"
[ "$(body_of "$resent")" = '{"status":"repeat"}' ] || fail "the resend wasn't a repeat: $(body_of "$resent")"

echo "== 5. the Official view shows exactly one"
view=$(api GET "/api/official/activities/$activity")
[ "$(status_of "$view")" = 200 ] || fail "Official view: HTTP $(status_of "$view"): $(body_of "$view")"
# shellcheck disable=SC2016 # JavaScript, not shell
counts=$(body_of "$view" | node -e '
  const v = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const scored = v.matrix.filter((r) => r.scored);
  console.log(`${v.entries.length} ${scored.length} ${v.entries[0]?.id} ${scored[0]?.place}`);')
[ "$counts" = "1 1 rehearsal-score-1 1" ] ||
  fail "Official view: expected 1 entry and 1 ranked row in 1st place, got (entries scored-rows id place) $counts"
pass "Official view: one entry, one ranked row in 1st place"

echo "== 5b. an Official added from the console can sign in"
newcomer=console.added@example.com
me() { # me <email> -> "<body> <status>" from the Official page's sign-in check
  curl -sS --max-time 10 --cacert "$work/root.crt" --resolve "$host:$https_port:127.0.0.1" \
    -H "x-official-email: $1" -w ' %{http_code}' "https://$host:$https_port/api/official/me"
}
[ "$(status_of "$(me "$newcomer")")" = 403 ] || fail "an email nobody added got into the Official view"
compose exec -T collator node apps/collator/src/cli/add-official.ts "$newcomer" --name "Casey Console" --director ||
  fail "add-official"
signed_in=$(me "$newcomer")
expect "sign in as the added Official" 200 "$signed_in"
[ "$(body_of "$signed_in")" = '{"email":"console.added@example.com","role":"director","name":"Casey Console"}' ] ||
  fail "the added Official's sign-in answered: $(body_of "$signed_in")"
compose exec -T collator node apps/collator/src/cli/list-officials.ts | grep -q "$newcomer.*box, added" ||
  fail "list-officials doesn't show the added Official"
pass "add-official and list-officials work in the container"

echo "== 6. backups"
has_score() { # has_score <file in the backup folder>: opens it inside the container, as a restore would
  compose exec -T -w /repo/apps/collator collator node -e '
    const db = new (require("better-sqlite3"))(process.argv[1], { readonly: true, fileMustExist: true });
    const ok = db.pragma("integrity_check", { simple: true }) === "ok" &&
      db.prepare("SELECT count(*) AS n FROM score_entries WHERE id = ?").get("rehearsal-score-1").n === 1;
    process.exit(ok ? 0 : 1);' "/backups/$1" >/dev/null 2>&1
}
found=""
for _ in $(seq 30); do
  newest=$(find "$work/backups" -maxdepth 1 -name 'collator-*.db' -printf '%f\n' | sort | tail -1)
  if [ -n "$newest" ] && has_score "$newest"; then found=$newest && break; fi
  sleep 1
done
[ -n "$found" ] || fail "no backup containing the score appeared in the backup folder"
pass "the timer wrote $found: it opens and contains the score"
compose exec -T collator node apps/collator/src/cli/backup-now.ts >/dev/null || fail "backup-now"
[ "$(find "$work/backups" -maxdepth 1 -name 'collator-*.db' | wc -l)" -le 5 ] || fail "BACKUP_KEEP=5 not applied"
[ -z "$(find "$work/backups" -maxdepth 1 -name '*.partial')" ] || fail "a .partial file was left behind"
pass "backup-now works; old backups pruned; no half files"

echo "== 7. reset scores, then restore the backup it took"
event_epoch() { # event_epoch -> "<id> <reason>" from the judge page's event data
  curl -sS --max-time 10 --cacert "$work/root.crt" --resolve "$host:$https_port:127.0.0.1" \
    "https://$host:$https_port/api/event" | node -p 'const e = JSON.parse(require("fs").readFileSync(0, "utf8")).epoch; `${e.id} ${e.reason}`'
}
score_count() { # score_count -> how many entries the Official view has at Clown Car
  body_of "$(api GET "/api/official/activities/$activity")" | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).entries.length'
}
[ "$(event_epoch | cut -d' ' -f2)" = created ] || fail "a new box's epoch should be 'created', got $(event_epoch)"
wrong=$(api POST /api/official/reset '{"kind":"scores","confirm":"not the name"}')
expect "a reset with the wrong name is refused" 400 "$wrong"
[ "$(score_count)" = 1 ] || fail "a refused reset cleared the score"
title=$(node -p "JSON.parse(require('fs').readFileSync('$fixtures/event.json','utf8')).title")
reset=$(api POST /api/official/reset "$(printf '{"kind":"scores","confirm":"%s"}' "$title")")
expect "reset scores" 200 "$reset"
backup=$(body_of "$reset" | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).backup')
[ -f "$work/backups/$backup" ] || fail "the reset's backup $backup isn't in the backup folder"
has_score "$backup" || fail "the reset's backup $backup doesn't contain the score it was about to clear"
[ "$(score_count)" = 0 ] || fail "the score is still there after the reset"
[ "$(event_epoch | cut -d' ' -f2)" = reset ] || fail "after a reset the epoch should be 'reset', got $(event_epoch)"
pass "reset: $backup written first with the score in it; the score is gone; the epoch is 'reset'"
compose stop collator >/dev/null 2>&1 || fail "stop collator"
compose run --rm --no-deps -T collator node apps/collator/src/cli/restore-backup.ts "/backups/$backup" ||
  fail "restore-backup"
compose start collator >/dev/null 2>&1 || fail "start collator"
for _ in $(seq 30); do
  [ "$(status_of "$(api GET /api/health 2>/dev/null || echo 'x 0')")" = 200 ] && break
  sleep 1
done
[ "$(score_count)" = 1 ] || fail "the score didn't come back after restore-backup"
[ "$(event_epoch | cut -d' ' -f2)" = restore ] || fail "after a restore the epoch should be 'restore', got $(event_epoch)"
pass "restore-backup in the container: the score is back, under a new 'restore' epoch"

echo "== all checks passed"
