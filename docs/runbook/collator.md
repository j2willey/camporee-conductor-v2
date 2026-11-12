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

From the checkout (and branch) you mean to run. `--build` rebuilds the image from it; without it, Compose
reuses whatever `collator:local` was built last, which may be an old build.

```sh
cd deploy/collator
git log --oneline -1                                               # the commit you're building
BUILD_COMMIT=$(git rev-parse --short HEAD) docker compose up -d --build --wait
docker compose ps        # collator (healthy) and caddy (running)
docker image inspect collator:local --format '{{.Created}}'        # just now
```

**Check the build on the phone:** the judge page shows `Build <commit> · <time>` in small grey text at the
bottom. It should match `git log --oneline -1`. If a phone shows an older one, reload the page twice: the
first load after an update may still be the copy the phone kept.

## 4. Load the event-day cartridge

Download it from the Composer: the Event page's **Download event-day cartridge (for the box)**. It carries
the Officials list, and needs at least one Director. Then either:

- **From a browser (#100):** open `https://<COLLATOR_HOSTNAME>/official`. On an empty box the page offers
  **Load the event-day cartridge**. Pick the zip and click Load.
  - It asks for the **setup code** unless the box's `.env` has `FIRST_LOAD=open`, which is only for a box
    with no internet. The code is `SETUP_CODE` in `.env`, or, when that's blank, the one in the log:
    `docker compose logs collator | grep "setup code"`. A made-up code changes each time the box starts.
  - Once an Event is loaded, a signed-in **Director** loads a new version from the Overview's **Event
    cartridge** section. A different Event is still refused while the box holds roster or scores.
- **From the console,** as before: put the zip in the cartridges folder (default `deploy/collator/cartridges/`,
  gitignored), and:

```sh
docker compose exec collator node apps/collator/src/cli/load-cartridge.ts /cartridges/<file>.zip
```

These rules are provisional (ADR-0027, 2026-11-12).

### Add an Official on site

Do this for a mistyped email in the cartridge (a Director who can't sign in), or a new Official on the day.
Add the email, with `--director` for a Director and `--name` for how they appear in the logs:

```sh
docker compose exec collator node apps/collator/src/cli/add-official.ts pat@example.com --name "Pat Director" --director
docker compose exec collator node apps/collator/src/cli/list-officials.ts
```

The first prints `added pat@example.com (director)`, or `updated ...` for an email already listed (the name or
role changes; leave a flag off to keep it). The second lists everyone: email, role, name, and whether they came
from the cartridge or were added on the box.

There is no sign-in for this: having the box's console is the trust (ADR-0027 item 5). Additions are kept on the
box and laid over the cartridge's list; the cartridge itself is unchanged. There is no removal: an Official added
by mistake is harmless, since only listed emails get in, and the Officials' email-only gate is the same for all.

Afterwards the Official signs in at `/official` with that email.

### Print the QR codes (#41)

On the laptop, open `https://<COLLATOR_HOSTNAME>/official`, sign in, and choose **QR codes to print**. Type
the Wi-Fi name and password (they stay in the page: nothing is sent to the box or kept), then **Print**.

- **Join the Wi-Fi** and **Open the judge page** go where Judges check in. The judge page link is the
  address the laptop has the box at, so print from a laptop that uses the same name as the phones
  (`COLLATOR_HOSTNAME`), not `localhost` or an IP address.
- **One per Activity**, a page per Competition: post each at its Station. Scanning it opens the judge page
  at that Activity (after a new Judge's details). A code for an Activity the loaded cartridge doesn't have
  (an old printout) opens the Activity list with a note.
- Reprint the Activity codes after loading a cartridge with new Activities; the Wi-Fi and judge page codes
  only change with the network name, password or hostname.

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
- To restore a backup, use the command, never a hand copy: it checks the file is a Collator database, puts it
  in place safely, clears the old journal files and records a **restore** in the box's epoch log (below).
  The backups are `/backups` inside the container:
  1. `docker compose stop collator`
  2. `docker compose run --rm collator node apps/collator/src/cli/restore-backup.ts /backups/<file>`
  3. `docker compose start collator`

  It prints the backup's name and the new epoch. Exit 1 means it refused the file and changed nothing.

- **After a restore, phones resend what the box lost** (#66). Each phone keeps what the box confirmed, and
  when it next sees the box with the page open, it notices the new epoch and sends all of it again with the
  same ids, so anything the box already had counts once. A phone that's out of range, or has the page
  closed, resends when it's back in range and opened. Give the Judges a few minutes, then check closures as a
  backstop: "Check closures" and "N of them haven't reached the box" point at an Activity still missing
  scores. A closure that reports missing scores also makes the phone resend those.
- **After a reset, nothing comes back**, on purpose: the phones drop what the reset cleared, and say so ("The
  box was reset; N unsent scores from before the reset were discarded"). A reset undone by a phone coming
  back into range would defeat it. So **after the final rehearsal reset, every judge phone opens the judge
  page on the box Wi-Fi (the check-in QR) before anyone scores**: a phone that scores before it has seen the
  reset discards those scores when it reconnects (#70 tracks a safer design).

### Reset for a rehearsal (#42)

On the laptop, on the Official page, **Reset** (any Official may). Two kinds:

- **Reset scores** clears score entries, closures, Judges, Official actions (disqualifications, corrections,
  ranks, finalizing) and Exhibition results. It keeps the Event, the Groups and Teams, and the Officials.
- **Full reset** also clears the Groups, Teams and the roster changes.
- Neither touches the loaded cartridge or the Officials added on the console.

To confirm, type the Event's name (its title or slug, any case). **The box backs up first**, into the backup
folder; if it can't (no `BACKUP_DIR`, the stick missing or full) the reset is refused and nothing changes. The
page then says "Reset done. Backup saved as `<file>`." To undo a reset, restore that file as above: it brings back
everything the reset cleared, and phones resend what they scored after the reset.

### Event morning, after the final rehearsal reset

1. Reset (above), and note the backup's name.
2. At check-in, each Judge scans the check-in QR on the box Wi-Fi and the judge page opens. That's when the phone
   learns about the reset; scores made before it would be discarded.
3. Only then does the Judge go to their Station and score.

## 6. If a phone can't connect

- **Android: Chrome needs the "Nearby devices" permission** to reach the box on the local network:
  Settings → Apps → Chrome → Permissions → Nearby devices → Allow. Without it, the page says "Can't reach
  the scoring box" (or the reload fails with `ERR_TOO_MANY_RETRIES`), and Android gives no hint why. The
  judge page shows this hint when it can't reach the box. **Do it at check-in**, with a volunteer, before
  the Judge scans the judge URL: Judges shouldn't have to find it at their Station.
- **iPhone: use Safari.** Chrome and other browsers on iOS need "Local Network" access (Settings → Privacy &
  Security → Local Network). Safari itself is expected not to need it: confirm on a real iPhone.
- The Wi-Fi must let phones reach the box: **Client Device Isolation (AP isolation) off.**
- An Android phone that's asleep doesn't answer ARP (`ip neigh` shows FAILED). Wake it before network tests.
- Caddy on the box logs no requests, so its logs can't show whether a phone reached it.

- The A record publishes the box's **private** IP in public DNS; that's expected. A router with DNS
  rebinding protection may refuse to answer it; then add a local DNS override for the name on the router.
- Omarchy's firewall (ufw) is active. Docker's published ports usually bypass it; if the phone still can't
  connect: `sudo ufw allow 443/tcp` (and `80/tcp` for the http-to-https redirect).

- **Out of range is normal.** A phone that has opened the judge page once in range keeps the app, the event
  and the roster, and keeps what the Judge saves until it's back in range (#41). So have each Judge open
  `https://judge.camporeeconductor.com` at check-in, on the box's Wi-Fi. A phone that never has can't open
  the page out of range.

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

## 8. Judge drones (CI and local)

```sh
docs/runbook/drones-collator.sh
```

Simulated Judges' phones in real browsers, **Chromium as Android and WebKit as iPhone**, against the real
box image behind Caddy over `https://judge.camporeeconductor.com` (#63). They run in Playwright's Docker
image, on the box's own Docker network, and trust only Caddy's root CA. Functional, not load. Covered:

- two Judges scoring one Team, with the newer entry counting, and the home unit in the Official view
- with no network, a reload, then a Team added and scored, all arriving once when the network is back
- a lost reply, resent and counted once
- a stopwatch running through a reload
- the build stamp

Each is checked on the box through the Official API. Traces on failure: `apps/collator-web/test-results/drones`.
The first run pulls Playwright's image (about 2 GB).

Software can't stand in for the phone itself: Android's Nearby devices permission, iOS's Local Network
prompt, real Wi-Fi at the edge of range, and Safari on iOS. Those stay in the real-phone checks below,
done by hand before the event.

## Manual acceptance on home Wi-Fi (Jim, recorded in the PR)

On Omarchy, after step 1 (certificate issued, `--check` OK):

- [ ] Public DNS: `judge.camporeeconductor.com` resolves to Omarchy's home-LAN IP (`dig +short judge.camporeeconductor.com`).
- [ ] `cp deploy/collator/env.example deploy/collator/.env`; set `CERTS_DIR=$HOME/collator-certs` and a
      `BACKUP_HOST_DIR` you can write to as uid 1000.
- [ ] `cd deploy/collator && BUILD_COMMIT=$(git rev-parse --short HEAD) docker compose up -d --build --wait`
      (§3), and the phone shows that build at the bottom of the judge page.
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

## Offline check on real phones (#41; Jim, recorded in the PR)

Service workers behave differently in each browser, and Judges use both: do this on an **Android phone
(Chrome)**, an **iPhone in Safari** and an **iPhone in Chrome**, with the box rebuilt (§3: check the build
on the phone) and the event loaded as above.

- [ ] Android: Chrome has the Nearby devices permission (§6). iPhone in Chrome: note whether it asked for
      Local Network access.
- [ ] In range: open `https://judge.camporeeconductor.com`, enter a Judge name and email, pick an Activity,
      and wait for the list of Teams to show. (That keeps the app, the event and the roster on the phone.)
- [ ] Airplane mode on (Wi-Fi off too). Score a listed Team: at once, a grey "Saved on this phone" and
      "Score another …"; the header says "1 score waiting to send". Nothing red, no "Try again".
- [ ] Still offline: close the browser tab, open the page again (or pull to reload). It opens, with "using
      the event saved on this phone".
- [ ] Still offline: add a new Team in an existing Group and score it. The header says "3 waiting to send",
      and the new Team is in the list for the next score.
- [ ] Airplane mode off. Within about 30 seconds (or tap **Send now**), the header clears.
- [ ] Official view on another device: the new Team is there once, and each score is there once.
- [ ] Record the date, phone model and browser in the PR.
