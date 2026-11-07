#!/usr/bin/env bash
# Issues (or renews) the Let's Encrypt certificate the on-site box serves (issue #40, ADR-0027 item 4), with
# certbot's Cloudflare DNS-01 plugin in a container. Run it while online, before going to the event; the
# box itself then needs no internet. Caddy serves the result with TLS_MODE=files (compose.tls-files.yaml).
#
# Usage: deploy/collator/issue-cert.sh            issue the certificate, then check its expiry
#        deploy/collator/issue-cert.sh --print    print the docker command it would run, and stop
#        deploy/collator/issue-cert.sh --check    only check the expiry of the certificate already in CERTS_DIR
#        deploy/collator/issue-cert.sh --help
#
# Settings (environment):
#   COLLATOR_HOSTNAME     the certificate's name (default judge.camporeeconductor.com)
#   CLOUDFLARE_INI        the Cloudflare API token file, mode 600, never in the repo
#                         (default ~/.secrets/cloudflare-camporeeconductor.ini); mounted read-only, never printed
#   CERTS_DIR             where the certificate goes, outside the repo (default ~/collator-certs):
#                         fullchain.pem and privkey.pem at the top for Caddy, certbot's own state in letsencrypt/
#   CERT_MUST_LAST_UNTIL  the certificate must expire after this date: the event's end + 7 days
#                         (default 2027-05-23; the event ends 2027-05-16)
#   CERTBOT_EMAIL         optional: an email for the Let's Encrypt account
#
# Exit status: 0 issued and lasts long enough; 3 issued (or present) but expires too early; anything else
# is a failure.
set -euo pipefail

usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; }

mode=issue
case "${1:-}" in
  "") ;;
  --print) mode=print ;;
  --check) mode=check ;;
  -h | --help) usage; exit 0 ;;
  *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
esac

host=${COLLATOR_HOSTNAME:-judge.camporeeconductor.com}
ini=${CLOUDFLARE_INI:-$HOME/.secrets/cloudflare-camporeeconductor.ini}
certs=${CERTS_DIR:-$HOME/collator-certs}
deadline=${CERT_MUST_LAST_UNTIL:-2027-05-23}
image=certbot/dns-cloudflare:v5.6.0
repo=$(cd "$(dirname "$0")/../.." && pwd)

die() { echo "issue-cert: $*" >&2; exit 1; }

deadline_epoch=$(date -u -d "$deadline" +%s 2>/dev/null) ||
  die "CERT_MUST_LAST_UNTIL must be a date like 2027-05-23, not '$deadline'"

# Certificates, keys and the token never go in the repo.
repo=$(realpath "$repo")
certs=$(realpath -m "$certs")
case "$certs/" in
  "$repo/"*) die "CERTS_DIR ($certs) is inside the repo; choose a folder outside it" ;;
esac

check_expiry() {
  local cert=$certs/fullchain.pem end end_epoch
  [ -f "$cert" ] || die "no certificate at $cert"
  end=$(openssl x509 -enddate -noout -in "$cert" | cut -d= -f2)
  end_epoch=$(date -u -d "$end" +%s)
  echo "certificate for $host expires: $end ($(date -u -d "@$end_epoch" +%F))"
  if [ "$end_epoch" -lt "$deadline_epoch" ]; then
    echo "WARNING: it expires before $deadline (CERT_MUST_LAST_UNTIL: the event's end + 7 days). Issue it again closer to the event." >&2
    exit 3
  fi
  echo "OK: it lasts past $deadline (CERT_MUST_LAST_UNTIL: the event's end + 7 days)."
}

if [ "$mode" = check ]; then
  check_expiry
  exit 0
fi

# The token file: present, a regular file, and readable by its owner only. Its contents are never read here.
[ -e "$ini" ] || die "no Cloudflare token file at $ini"
[ -f "$ini" ] || die "$ini isn't a regular file"
perms=$(stat -c %a "$ini")
[ "$perms" = 600 ] || die "$ini has mode $perms; it must be 600 (chmod 600 '$ini')"
case "$(realpath "$ini")" in
  "$repo/"*) die "the token file is inside the repo; keep it in ~/.secrets" ;;
esac

email_args=(--register-unsafely-without-email)
[ -n "${CERTBOT_EMAIL:-}" ] && email_args=(--email "$CERTBOT_EMAIL")

# As this user, so the files it writes are this user's; the token is mounted read-only.
cmd=(docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp
  -v "$certs/letsencrypt:/etc/letsencrypt"
  -v "$ini:/run/secrets/cloudflare.ini:ro"
  "$image" certonly --non-interactive --agree-tos "${email_args[@]}"
  --dns-cloudflare --dns-cloudflare-credentials /run/secrets/cloudflare.ini
  --dns-cloudflare-propagation-seconds 30
  --config-dir /etc/letsencrypt --work-dir /etc/letsencrypt/work --logs-dir /etc/letsencrypt/logs
  --keep-until-expiring -d "$host")

if [ "$mode" = print ]; then
  printf '%q ' "${cmd[@]}"
  echo
  exit 0
fi

mkdir -p "$certs/letsencrypt"
"${cmd[@]}"

# Plain files at the top of CERTS_DIR for Caddy (certbot's live/ holds symlinks into archive/).
live=$certs/letsencrypt/live/$host
(umask 077 && cp -L "$live/privkey.pem" "$certs/privkey.pem.new" && mv "$certs/privkey.pem.new" "$certs/privkey.pem")
cp -L "$live/fullchain.pem" "$certs/fullchain.pem.new" && mv "$certs/fullchain.pem.new" "$certs/fullchain.pem"
echo "certificate files: $certs/fullchain.pem, $certs/privkey.pem"
check_expiry
