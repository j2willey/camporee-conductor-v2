#!/usr/bin/env bash
# Judge drones (#63): simulated Judges' phones in real browsers (Chromium as Android, WebKit as iPhone)
# against the real box image behind Caddy, over HTTPS by hostname.
#
#   1. Build the Collator image (with this commit's build stamp) and start deploy/collator/compose.yaml
#      with TLS_MODE=internal, as its own Compose project.
#   2. Load the Circus 2026 event-day cartridge.
#   3. Run apps/collator-web/drones in Playwright's Docker image (every browser with its libraries, the
#      same here and in CI). The container joins the box's network, where judge.camporeeconductor.com
#      is Caddy. It trusts only Caddy's root CA: in its trust store for WebKit and Node, and for Chromium
#      the keys of the certificates Caddy presents. No ignoreHTTPSErrors.
#
# Usage: docs/runbook/drones-collator.sh
# Needs docker without sudo, node and the workspace's dependencies (pnpm install), and openssl. The first
# run pulls Playwright's image (about 2 GB). Uses its own Compose project (DRONES_PROJECT, default
# collator-drones), publishes no ports, and removes the project with its volumes when it ends. Results
# (traces on failure) go to apps/collator-web/test-results/drones.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
project=${DRONES_PROJECT:-collator-drones}
# Cleanup runs `down -v` on this project: never let it be the real box's (deploy/collator's is "collator").
case "$project" in
  *drones*) ;;
  *) echo "drones-collator: DRONES_PROJECT must contain 'drones' (got '$project')" >&2; exit 2 ;;
esac
host=judge.camporeeconductor.com
playwright=$(node -p "require('$repo/apps/collator-web/node_modules/@playwright/test/package.json').version")
image=mcr.microsoft.com/playwright:v$playwright-noble
commit=$(git -C "$repo" rev-parse --short HEAD)
results=$repo/apps/collator-web/test-results/drones
work=$(mktemp -d)
: >"$work/empty.env"
# Ports go to 127.0.0.1 only and to otherwise unused numbers: the drones reach Caddy on the box's
# network, not through the host.
export COLLATOR_IMAGE=collator-drones:local TLS_MODE=internal COLLATOR_HOSTNAME=$host \
  HTTPS_PORT=127.0.0.1:${DRONES_HTTPS_PORT:-8444} HTTP_PORT=127.0.0.1:${DRONES_HTTP_PORT:-8081} \
  BACKUP_HOST_DIR=$work/backups CARTRIDGES_DIR=$work/cartridges BUILD_COMMIT=$commit
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
mkdir -p "$work/backups" "$work/cartridges" "$work/results" "$work/ctl"
chmod 777 "$work/backups" "$work/results" "$work/ctl"

echo "== 1. build ($commit) and start"
compose build collator >"$work/build.log" 2>&1 || { tail -40 "$work/build.log"; fail "image build"; }
compose up -d --wait --wait-timeout 90 >"$work/up.log" 2>&1 || { cat "$work/up.log"; fail "compose up"; }
for _ in $(seq 30); do
  compose cp caddy:/data/caddy/pki/authorities/local/root.crt "$work/root.crt" >/dev/null 2>&1 && break
  sleep 1
done
[ -s "$work/root.crt" ] || fail "Caddy's root CA never appeared"
caddy_ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$(compose ps -q caddy)")
network=${project}_default
pass "box up; Caddy at $caddy_ip on $network"

echo "== 2. load the Circus 2026 event-day cartridge"
(cd "$repo" && node apps/collator-web/e2e/make-cartridge.ts "$work/cartridges/circus-event-day.zip")
chmod 644 "$work/cartridges/circus-event-day.zip"
compose exec -T collator node apps/collator/src/cli/load-cartridge.ts /cartridges/circus-event-day.zip >/dev/null ||
  fail "load-cartridge"
pass "cartridge loaded"

echo "== 3. drones ($image)"
docker image inspect "$image" >/dev/null 2>&1 || docker pull -q "$image" >/dev/null
# The browsers run as root in the container; results are handed back to this user at the end.
docker run --rm --network "$network" --add-host "$host:$caddy_ip" --ipc=host \
  -v "$repo:/repo" -v "$work:/work" -w /repo/apps/collator-web \
  -e CI -e DRONES_CTL=/work/ctl -e DRONES_URL="https://$host" -e DRONES_BUILD="$commit" -e DRONES_RESULTS=/work/results \
  -e NODE_EXTRA_CA_CERTS=/work/root.crt -e HOST_IDS="$(id -u):$(id -g)" \
  "$image" bash -euo pipefail -c '
    cp /work/root.crt /usr/local/share/ca-certificates/caddy-drones.crt
    update-ca-certificates >/dev/null 2>&1
    # Chromium does not read that store: accept exactly the keys of the certificates Caddy presents.
    openssl s_client -connect judge.camporeeconductor.com:443 -servername judge.camporeeconductor.com \
      -showcerts </dev/null 2>/dev/null | awk "/BEGIN CERT/{n++} n{print > (\"/tmp/cert\" n \".pem\")}"
    DRONES_SPKI=$(for c in /tmp/cert*.pem; do
      openssl x509 -in "$c" -pubkey -noout | openssl pkey -pubin -outform der |
        openssl dgst -sha256 -binary | base64
    done | paste -sd, -)
    export DRONES_SPKI
    status=0
    ./node_modules/.bin/playwright test -c drones/playwright.config.ts || status=$?
    chown -R "$HOST_IDS" /work/results
    exit $status' &
playwright_pid=$!

# The restore scenario needs the box stopped, restored and started again, which a browser container can't do.
# It writes a command into $work/ctl and waits; this loop does it to this script's own Compose project only.
while kill -0 "$playwright_pid" 2>/dev/null; do
  if [ -f "$work/ctl/cmd" ]; then
    cmd=$(cat "$work/ctl/cmd")
    rm -f "$work/ctl/cmd"
    answer="fail: unknown command $cmd"
    case "$cmd" in
      backup)
        if out=$(compose exec -T collator node apps/collator/src/cli/backup-now.ts 2>&1); then
          answer=$(basename "$(printf '%s\n' "$out" | sed -n 's/^backup written: //p' | head -1)")
          printf '%s' "$answer" >"$work/ctl/backup-name"
        else answer="fail: $out"; fi ;;
      restore)
        name=$(cat "$work/ctl/backup-name")
        if compose stop -t 5 collator >/dev/null 2>&1 &&
          out=$(compose run --rm --no-deps -T collator node apps/collator/src/cli/restore-backup.ts "/backups/$name" 2>&1) &&
          compose up -d --wait --wait-timeout 90 collator >/dev/null 2>&1; then
          answer="restored $name"
        else answer="fail: ${out:-restore}"; compose up -d collator >/dev/null 2>&1 || true; fi ;;
    esac
    printf '%s' "$answer" >"$work/ctl/ack"
  fi
  sleep 0.5
done
wait "$playwright_pid" || drones=$?
rm -rf "$results" && mkdir -p "$(dirname "$results")" && cp -r "$work/results" "$results"
[ "${drones:-0}" = 0 ] || fail "drones (traces in $results)"
pass "drones: Chromium and WebKit over HTTPS, each score and Team on the box exactly once, also after a restore and a reset"
echo "== all checks passed"
