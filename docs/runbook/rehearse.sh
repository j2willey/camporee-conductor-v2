#!/usr/bin/env bash
# Rehearses the two risky moves in deploy.md on a local Docker, with throwaway containers that copy the
# droplet's layout: a "v1" compose project whose Caddy mounts a caddy/ folder from a git clone, and a "v2"
# project that joins v1's network from outside.
#
#   1. A Caddyfile change that arrives by `git pull` reaches Caddy with a reload (folder mount). The old
#      single-file mount is run alongside for contrast: it should still see the old file.
#   2. v1's `revive` (compose down + up) with v2 attached exits 0, v1 comes back, and Caddy still reaches v2.
#
# Usage: docs/runbook/rehearse.sh      (needs docker without sudo, and port 18080 free; cleans up after itself)
set -u

work=$(mktemp -d)
pass=0
fail=0
check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass + 1)); else echo "FAIL  $1: expected '$2', got '$3'"; fail=$((fail + 1)); fi
}
cleanup() {
  (cd "$work/v2" 2>/dev/null && docker compose down -t 1 >/dev/null 2>&1)
  (cd "$work/v1" 2>/dev/null && docker compose down -t 1 >/dev/null 2>&1)
  rm -rf "$work"
}
trap cleanup EXIT
fetch() { sleep 2; curl -s --max-time 5 localhost:18080; }
git_() { git -c user.name=rehearsal -c user.email=rehearsal@localhost "$@"; }

# "GitHub": the upstream repo, holding caddy/Caddyfile.
mkdir -p "$work/upstream/caddy" && cd "$work/upstream" && git init -q
printf ':80 {\n\trespond "v1 only"\n}\n' > caddy/Caddyfile
git_ add -A && git_ commit -qm "v1 only"

# "The droplet": a clone, plus the v1 compose file (folder mount, and a single-file mount for contrast).
git clone -q "$work/upstream" "$work/v1" && cd "$work/v1"
cat > compose.yml <<'EOF'
name: rh-v1
services:
  caddy:
    image: caddy:2-alpine
    ports: ["18080:80"]
    volumes: ["./caddy:/etc/caddy:ro"]
  caddy-single-file:
    image: caddy:2-alpine
    volumes: ["./caddy/Caddyfile:/etc/caddy/Caddyfile:ro"]
EOF
mkdir -p "$work/v2" && cat > "$work/v2/compose.yml" <<'EOF'
name: rh-v2
services:
  app:
    container_name: rh-composer-v2
    image: caddy:2-alpine
    command: caddy respond --listen :3010 "hello from v2"
    networks: [v1]
networks:
  v1:
    external: true
    name: rh-v1_default
EOF

echo "== start v1, then v2 on v1's network"
docker compose up -d --quiet-pull >/dev/null 2>&1 || { echo "FAIL  could not start v1 (is docker usable without sudo?)"; exit 1; }
(cd "$work/v2" && docker compose up -d --quiet-pull >/dev/null 2>&1)
check "v1 answers before the change" "v1 only" "$(fetch)"

echo "== test 1: the Caddyfile change arrives by git pull"
before=$(stat -c %i caddy/Caddyfile)
(cd "$work/upstream" && printf ':80 {\n\treverse_proxy rh-composer-v2:3010\n}\n' > caddy/Caddyfile && git_ commit -qam "route to v2")
git pull -q --ff-only
after=$(stat -c %i caddy/Caddyfile)
echo "      inode on disk: $before -> $after (git pull wrote a new file)"
docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1
check "caddy validate of the pulled file" "0" "$?"
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1
check "folder mount: reload serves the new config" "hello from v2" "$(fetch)"
check "single-file mount (contrast): still sees the old file" "1" \
  "$(docker compose exec -T caddy-single-file grep -c 'v1 only' /etc/caddy/Caddyfile 2>/dev/null)"

echo "== test 2: v1 revive (down --remove-orphans && up -d) with v2 attached"
docker compose down --remove-orphans -t 1 >"$work/down.log" 2>&1 && docker compose up -d >/dev/null 2>&1
check "revive exits 0" "0" "$?"
sed 's/^/      down: /' "$work/down.log" | grep -iE 'network|resource|error|warn' || true
check "v2 still running" "running" "$(docker inspect -f '{{.State.Status}}' rh-composer-v2 2>/dev/null)"
check "v1 back up, and its new Caddy reaches v2" "hello from v2" "$(fetch)"

echo "== $pass passed, $fail failed"
[ "$fail" -eq 0 ]
