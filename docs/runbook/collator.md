# Runbook: the on-site Collator box

**Status: DRAFT.** Rehearsed in CI (`docs/runbook/rehearse-collator.sh`); the certificate and the phone test
below are not yet run. Issue #40. ADR-0027 (box, network, HTTPS, recovery). The full event-day runbook is
#45.

The box is any amd64 Linux machine with Docker (ADR-0027 items 1, 2). It runs two containers from
`deploy/collator/compose.yaml`: the **Collator** (the judge page, the Official view at `/official`, the
database) and **Caddy** in front of it for HTTPS. Phones reach it as `https://judge.camporeeconductor.com`;
the router's local DNS (or, at home, the public A record) points that name at the box.

Every command runs on the box, in the v2 repo, unless it says otherwise.

## 1. Issue the certificate (Jim, while online)

The certificate comes from Let's Encrypt by DNS-01 through Cloudflare, so the box needs no internet on
event day. The token file stays in `~/.secrets` with mode 600; the script mounts it read-only into
certbot's container and never prints it. The certificate goes outside the repo.

```sh
deploy/collator/issue-cert.sh --print   # optional: see the docker command it will run
deploy/collator/issue-cert.sh           # issues it into ~/collator-certs, then prints the expiry
```

Settings, all optional: `COLLATOR_HOSTNAME` (default `judge.camporeeconductor.com`), `CLOUDFLARE_INI`
(default `~/.secrets/cloudflare-camporeeconductor.ini`), `CERTS_DIR` (default `~/collator-certs`),
`CERT_MUST_LAST_UNTIL` (default `2027-05-23`), `CERTBOT_EMAIL`. See `--help`.

**Expiry check (ADR-0027 item 4):** the certificate must expire after the event's end + 7 days
(2027-05-23). The script prints the expiry, and warns and exits 3 if it's earlier. Check an existing
certificate at any time with:

```sh
deploy/collator/issue-cert.sh --check
```

Let's Encrypt certificates last 90 days or less, so one issued in November 2026 expires before the event.
Issue it again in the weeks before the event, while still online, with `--renew` (certbot otherwise keeps a certificate until its last 30 days), and run `--check`.

## 2. Configure

```sh
cp deploy/collator/env.example deploy/collator/.env   # gitignored; edit it
```

`.env` sets `COMPOSE_FILE=compose.yaml:compose.tls-files.yaml` (TLS from the certificate files),
`CERTS_DIR`, the hostname, the ports (443 and 80), the backup folder and the cartridges folder.

**TLS mode is configuration** (ADR-0027 item 4). `TLS_MODE` picks one of two snippets in
`deploy/collator/caddy/`:

| `TLS_MODE` | Certificate                                                                       | Used for             |
| ---------- | --------------------------------------------------------------------------------- | -------------------- |
| `internal` | Caddy's own local CA (phones would warn)                                          | development, CI      |
| `files`    | `fullchain.pem` and `privkey.pem` from `CERTS_DIR`, mounted read-only at `/certs` | event day, home test |

`compose.tls-files.yaml` sets `TLS_MODE=files` and mounts `CERTS_DIR`; without it, the mode is `internal`.
Automatic DNS-01 inside Caddy needs a custom Caddy build: later.

## 3. Start

```sh
cd deploy/collator
docker compose up -d --build --wait
docker compose ps        # collator (healthy) and caddy (running)
```

## 4. Load the event-day cartridge

Export it from the Composer with `--profile event-day` (it carries the Officials list), put it in the
cartridges folder (default `deploy/collator/cartridges/`, gitignored), and:

```sh
docker compose exec collator node apps/collator/src/cli/load-cartridge.ts /cartridges/<file>.zip
```

## 5. Backups (ADR-0027 item 11)

The Collator writes a backup to the backup folder every `BACKUP_EVERY_MINUTES` (default 5) and keeps the
newest `BACKUP_KEEP` (default 288, a day's worth). A mounted USB stick is just a folder: set
`BACKUP_HOST_DIR` to its mount point. It must be writable by uid 1000 (the container's `node` user):
`sudo chown 1000:1000 <folder>`, or mount a FAT stick with `uid=1000`.

- Each backup is SQLite's own consistent copy (`VACUUM INTO`), named `collator-<UTC time>.db`. It's written
  under a hidden `.partial` name and renamed when complete, so a stick pulled mid-write never leaves a half
  file under a real name.
- A missing or unwritable folder is logged (`docker compose logs collator | grep backup`) and tried again
  next time; the server keeps running.
- Take one now (before shutting down, or to check the stick):
  `docker compose exec collator node apps/collator/src/cli/backup-now.ts`
- To restore, stop the box, copy a backup into the `collator-data` volume as `collator.db` (deleting any
  `collator.db-wal` and `collator.db-shm` beside it), and start it.
  The phones resend anything newer (ADR-0027 item 8).

## 6. If a phone can't connect

- The A record publishes the box's **private** IP in public DNS; that's expected. A router with DNS
  rebinding protection may refuse to answer it; then add a local DNS override for the name on the router.
- Omarchy's firewall (ufw) is active. Docker's published ports usually bypass it; if the phone still can't
  connect: `sudo ufw allow 443/tcp` (and `80/tcp` for the http-to-https redirect).

## 7. Rehearsal (CI and local)

```sh
docs/runbook/rehearse-collator.sh
```

It builds the image, starts its own Compose project (`collator-rehearsal`) with `TLS_MODE=internal` on
port 8443, loads the Circus 2026 event-day cartridge, and over `https://judge.camporeeconductor.com:8443`
(with `curl --resolve`, trusting only Caddy's root CA copied out of the caddy container; no `-k`) adds a
Group and a Team, submits a score, resends it (a repeat), checks the Official view shows exactly one, and
checks a backup containing the score appeared. It also validates the `files` mode with a throwaway
certificate and the certificate script's checks with a fake token file. It tears everything down, volumes
included, when it ends.

## Manual acceptance on home Wi-Fi (Jim, recorded in the PR)

On Omarchy, after step 1 (certificate issued, `--check` OK):

- [ ] Public DNS: `judge.camporeeconductor.com` resolves to Omarchy's home-LAN IP (`dig +short judge.camporeeconductor.com`).
- [ ] `cp deploy/collator/env.example deploy/collator/.env`; set `CERTS_DIR=$HOME/collator-certs` and a
      `BACKUP_HOST_DIR` you can write to as uid 1000.
- [ ] `cd deploy/collator && docker compose up -d --build --wait`.
- [ ] Load the Circus 2026 event-day cartridge: from the repo root,
      `node apps/collator-web/e2e/make-cartridge.ts deploy/collator/cartridges/circus-event-day.zip`, then
      `docker compose exec collator node apps/collator/src/cli/load-cartridge.ts /cartridges/circus-event-day.zip`.
- [ ] A phone on the home Wi-Fi opens `https://judge.camporeeconductor.com` with **no certificate warning**.
- [ ] On the phone: enter a Judge name and email, pick an Activity, add a Team, submit a score.
- [ ] On another device: `https://judge.camporeeconductor.com/official`, sign in as `director@example.com`,
      open that Activity: the score is there, once.
- [ ] A backup file appeared in `BACKUP_HOST_DIR`.
- [ ] `docker compose down` when done (add `-v` to also delete the test database).
- [ ] Record the date, phone model and browser in the PR.
