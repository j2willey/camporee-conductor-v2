# Runbook: event day

**Status: DRAFT.** Issue #45. Replaces v1's `EVENT-DAY-RUNBOOK.md`. The router and DNS steps (§3, §4) are
marked **verify at #51** until they've been done on the Opal with no internet; the dress rehearsal (~2027-04-15,
ADR-0006) walks the whole file. v1 stays the fallback until v2 passes it.

**Read it top to bottom once, then follow it in order.** It's the order of the day; the details live in the box
runbook, [collator.md](collator.md), and each step links to its section there.

- **The box** is any amd64 Linux machine with Docker (ADR-0027). The commands are for Linux; a Windows + WSL2 box
  has its own steps in the [appendix](#appendix-a-windows--wsl2-box).
- Every command runs **on the box, in the v2 repo**, unless it says otherwise. `cd deploy/collator` first for the
  `docker compose` ones.
- **No passwords in this file.** Write them on the paper copy, not in the repo (v1's runbook had them in a public
  repo; change those).

## 0. Quick reference

| What                               | Where                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------- |
| Judge page (phones)                | `https://judge.camporeeconductor.com`                                     |
| Official view (laptop)             | `https://judge.camporeeconductor.com/official`                            |
| QR codes, Reset, Awards, Printouts | in the Official view                                                      |
| All results (zip of CSVs)          | Official view → Overview → **Download all results**                       |
| Router admin                       | `http://192.168.8.1` (GL.iNet's default)                                  |
| Start                              | `docker compose up -d --wait` (**no `--build` offline**)                  |
| Status                             | `docker compose ps`: collator (healthy), caddy (running)                  |
| Logs                               | `docker compose logs -f collator`                                         |
| Backup now                         | `docker compose exec collator node apps/collator/src/cli/backup-now.ts`   |
| The box's IP                       | `ip -4 addr show \| grep 192.168.8`                                       |
| Stop (keeps the data)              | `docker compose down` (**never `-v`**: that deletes the event's database) |

Fill in on paper: Wi-Fi name `__________` · Wi-Fi password `__________` · router admin password `__________` ·
the box's IP `192.168.8.___` · setup code (if set in `.env`) `__________`.

## 1. Weeks before, while online

- [ ] **Renew the certificate** (→ [collator.md §1](collator.md#1-issue-the-certificate-jim-while-online)).
      Let's Encrypt certificates last 90 days, so do this in the last few weeks (commands below).
- [ ] **Configure the box**: `deploy/collator/.env` from `env.example` (→ [collator.md §2](collator.md#2-configure)):
      `CERTS_DIR`, `BACKUP_HOST_DIR` = the USB stick's mount point (writable by uid 1000), and either a
      `SETUP_CODE` you write on paper or `FIRST_LOAD=open` (only on a box with no internet).
- [ ] **Build the images on the box, now** (commands below). The build downloads Node packages, so it can't run
      offline. From here on, start **without `--build`**: Compose reuses the image you just built.
- [ ] **Download the final event-day cartridge** from the Composer (the Event page's **Download event-day
      cartridge (for the box)**). It needs at least one Director; check every Official's email. Copy it into
      `deploy/collator/cartridges/` and onto the USB stick.
- [ ] **Do a full run at home** (→ [collator.md: manual acceptance](collator.md#manual-acceptance-on-home-wi-fi-jim-recorded-in-the-pr)):
      load the cartridge, score from a phone, see it in the Official view, see a backup on the stick. Then
      **Reset → Full reset** (§7) so the box starts clean.
- [ ] **Print the QR codes** (→ [collator.md: QR codes](collator.md#print-the-qr-codes-41)): the Wi-Fi and judge
      page codes for check-in, and one per Activity for each Station. Print them from the box's own Official view
      with the event's Wi-Fi name and password.
- [ ] **Print this file** and [collator.md](collator.md), and keep a copy on the box.

The certificate:

```sh
deploy/collator/issue-cert.sh --renew
deploy/collator/issue-cert.sh --check    # must expire after 2027-05-23
```

The images:

```sh
cd deploy/collator
git log --oneline -1    # the commit you mean to run
BUILD_COMMIT=$(git rev-parse --short HEAD) docker compose up -d --build --wait
docker compose pull caddy    # Caddy's image is kept on the box too
docker compose down
```

## 2. Before going offline

Nothing after this list needs the internet. If any box is unticked, do it now.

- [ ] `deploy/collator/issue-cert.sh --check` passes.
- [ ] `docker image ls` shows `collator:local` (built from the right commit) and `caddy`.
- [ ] The event-day cartridge is on the box and on the stick.
- [ ] The QR codes are printed, and this runbook is on paper.
- [ ] The router, its power cable, the USB stick, the box's charger and a power strip are packed.

## 3. The router (GL.iNet Opal) — verify at #51

The label on the bottom has the default Wi-Fi name, Wi-Fi password and admin password.

1. Power it on (USB-C) and wait about a minute for the power light to stay on.
2. Join its default Wi-Fi from the box, and open `http://192.168.8.1`. Set a new **admin password** (on paper).
3. **Wireless:** set the event's **Wi-Fi name and password** (the ones on the QR codes).
4. **AP isolation (Client Device Isolation) off,** or phones can't reach the box
   (→ [collator.md §6](collator.md#6-if-a-phone-cant-connect)).
5. Router mode, no WAN uplink. Leave the other defaults.
6. Connect the box to the event Wi-Fi (forget other networks so it doesn't wander off), or by cable to a LAN port.
   Note its IP: `ip -4 addr show | grep 192.168.8`.
7. **Give the box a fixed IP** so the DNS record stays right after a reboot: in the admin panel, **Clients**, reserve
   the box's IP (or in LuCI: **Network → DHCP and DNS → Static Leases**).

## 4. Local DNS: the judge name → the box — verify at #51

Phones open `https://judge.camporeeconductor.com`; the router answers that name with the box's IP, and the
certificate matches the name, so there's no warning. Use the box's IP from §3 in place of `192.168.8.X`.

**SSH to the router** (what v1 did in 2026):

```sh
ssh root@192.168.8.1        # the admin password from §3
echo "192.168.8.X  judge.camporeeconductor.com" >> /etc/hosts
/etc/init.d/dnsmasq restart
nslookup judge.camporeeconductor.com 127.0.0.1   # shows 192.168.8.X
exit
```

**Or in LuCI** (`http://192.168.8.1` → **Advanced**): **Network → DHCP and DNS → Hostnames → Add**, the name and
the IP, then **Save & Apply**.

**Check from the box, then from a phone on the event Wi-Fi:**

```sh
nslookup judge.camporeeconductor.com 192.168.8.1   # shows the box's IP
```

If the box's IP changes, fix the record (or the reservation) before anything else.

## 5. Start the box and load the cartridge

1. Plug in the USB stick, and check it's mounted where `BACKUP_HOST_DIR` says.
2. Start, **without `--build`**:
   ```sh
   cd deploy/collator
   docker compose up -d --wait
   docker compose ps          # collator (healthy), caddy (running)
   ```
3. If a phone can't connect later, the firewall is the first suspect: `sudo ufw allow 443/tcp` and `sudo ufw allow
80/tcp` (→ [collator.md §6](collator.md#6-if-a-phone-cant-connect)).
4. **Load the cartridge** (→ [collator.md §4](collator.md#4-load-the-event-day-cartridge)): open
   `https://judge.camporeeconductor.com/official` on the box, **Load the event-day cartridge**, with the setup code
   (`SETUP_CODE`, or `docker compose logs collator | grep "setup code"`). Or from the console:
   ```sh
   docker compose exec collator node apps/collator/src/cli/load-cartridge.ts /cartridges/<file>.zip
   ```
5. Sign in to the Official view as a Director. A mistyped Official email is fixed on the console
   (→ [collator.md: add an Official](collator.md#add-an-official-on-site)).

## 6. Check from a judge's phone, end to end

On a phone on the event Wi-Fi (Android with Chrome, and an iPhone with Safari if you have both):

- [ ] Scan the check-in **Join the Wi-Fi** QR: it joins.
- [ ] Scan **Open the judge page**: `https://judge.camporeeconductor.com` opens with **no certificate warning**.
- [ ] The build stamp at the bottom matches `git log --oneline -1` on the box.
- [ ] Enter a test Judge, pick an Activity, add a test Team, submit a score.
- [ ] Official view: that score is there, once.
- [ ] A backup file appears on the stick within `BACKUP_EVERY_MINUTES` (default 5).
- [ ] Then clear the test: **Reset → Full reset** (§7).

## 7. Event morning

1. **Final reset** in the Official view: **Reset → Reset scores** (or **Full reset** to clear the test Groups and
   Teams too). Type the Event's name to confirm. The box backs up first; **note the backup's name**
   (→ [collator.md: reset](collator.md#reset-for-a-rehearsal-42)).
2. **Check-in, in this order, for every Judge:**
   1. Scan **Join the Wi-Fi**.
   2. **Android:** Settings → Apps → Chrome → Permissions → **Nearby devices → Allow**. Without it Chrome can't reach
      the box, and Android doesn't say why. **iPhone:** use **Safari**.
   3. Scan **Open the judge page** and enter their name and email. That's when the phone learns about the reset:
      **scores made before it would be discarded.**
   4. Only then go to the Station.
3. Post each Activity's QR code at its Station.

## 8. During the event

- **The Official view** on the laptop: each Activity's scores, Judges' closures, corrections, ranks, Exhibition
  results, Standings and Awards. It refreshes itself.
- **Out of range is normal.** A phone that opened the judge page at check-in keeps working and keeps its scores
  until it's back in range; the header says how many are waiting.
- **Check closures** as each Activity finishes: "N of them haven't reached the box" names an Activity still
  missing scores.
- **Glance at the stick** now and then: a new `collator-<time>.db` every few minutes.
  `docker compose logs collator | grep backup` shows a missing or full stick.
- Keep the box on mains power and **don't let it sleep** (turn off suspend on lid close, or keep the lid open).

## 9. End of the event

1. Every Activity and Exhibition closed and final in the Official view (the Awards page says **provisional** while
   any isn't).
2. Print the awards (Awards page) and the Announcer's script.
3. **Download all results** (Official view → Overview): `results-<date>.zip`, CSVs of the awards, Standings,
   every score and the Judges (for thank-you notes). **It has Judges' emails: keep it private.**
4. A last backup, and copy everything off:
   ```sh
   docker compose exec collator node apps/collator/src/cli/backup-now.ts
   ```
   Copy the stick's newest backup and the results zip to a second place (the laptop and another stick).
5. Stop the box: `docker compose down`. **Never `-v`** until the results are safe at home: it deletes the
   database.
6. Unplug the stick, then the router.

## 10. Troubleshooting

**A phone can't reach the box** (→ [collator.md §6](collator.md#6-if-a-phone-cant-connect))

1. Is the phone on the event Wi-Fi? Android: is **Nearby devices** allowed for Chrome?
2. Does the name resolve? On the box: `nslookup judge.camporeeconductor.com 192.168.8.1` shows the box's IP. If not,
   §4 again. A phone with **Private DNS** (Android) or Secure DNS set to a provider may skip the router: set it to
   **Off** or **Automatic**.
3. Is the box still on the event Wi-Fi, at the same IP? `ip -4 addr show | grep 192.168.8`.
4. Is the box serving? `docker compose ps`; then the firewall (§5 step 3).
5. AP isolation off on the router (§3)?

**The box isn't responding:** `docker compose ps`, `docker compose logs collator`, then
`docker compose restart collator`. The database survives a restart.

**A certificate warning on a phone:** the phone isn't using the name (an IP address or `localhost`), or the
certificate has expired. On the box: `deploy/collator/issue-cert.sh --check` and `docker compose logs caddy`.

**A judge page looks stuck or old:** close the tab and open the judge page again; reload twice after an update.
Its scores are kept on the phone until the box has them.

**Lost the database, or need an earlier state:** restore a backup with the command, never a hand copy
(→ [collator.md §5](collator.md#5-backups-adr-0027-item-11)). Phones then resend what the box lost when they're
next in range with the page open; check closures afterwards.

**The box itself fails:** another amd64 Linux machine with Docker and the image (§1). Load the same cartridge,
restore the stick's newest backup onto it, give it the old box's IP (or change the DNS record, §4), and phones
resend the rest.

## Appendix: a Windows + WSL2 box

The default is a Linux box (ADR-0027); this is for a Windows laptop, as in 2026. **Not yet tested with v2.**

- **Docker Desktop** (WSL2 backend): run the commands in a WSL2 terminal, in the repo cloned inside WSL2. Ports
  Docker Desktop publishes listen on Windows itself, so phones reach `192.168.8.X` (the **Windows** Wi-Fi IP, from
  `ipconfig`). Allow 80 and 443 in Windows Defender Firewall for the event Wi-Fi's network profile.
- **Docker Engine installed inside WSL2** (no Docker Desktop): Windows has to forward 80 and 443 to WSL2, as v1 did.
  In PowerShell as Administrator, **again after every Windows reboot** (WSL2's IP changes):
  ```powershell
  netsh interface portproxy reset
  $wslIp = (wsl hostname -I).Trim().Split()[0]
  netsh interface portproxy add v4tov4 listenport=80  listenaddress=0.0.0.0 connectport=80  connectaddress=$wslIp
  netsh interface portproxy add v4tov4 listenport=443 listenaddress=0.0.0.0 connectport=443 connectaddress=$wslIp
  netsh advfirewall firewall add rule name="Collator HTTP"  dir=in action=allow protocol=TCP localport=80
  netsh advfirewall firewall add rule name="Collator HTTPS" dir=in action=allow protocol=TCP localport=443
  ```
- The DNS record (§4) points at the **Windows** IP either way. Turn off sleep in Windows' power settings.
- `BACKUP_HOST_DIR` on a USB stick: WSL2 sees it under `/mnt/<letter>` (`sudo mount -t drvfs E: /mnt/e` if not).
  Check a backup lands there before the event.
