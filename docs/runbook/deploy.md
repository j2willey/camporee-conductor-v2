# Runbook: deploying the Composer (v2) on the droplet

**Status: DRAFT.** Not yet run. Issue #4, PR C. ADR-0013 (SQLite on the droplet), ADR-0014 (Clerk).

v2 runs **next to** v1 on the same droplet. v1 stays production and is not rebuilt, restarted or
reconfigured. The only shared piece is v1's Caddy, which gets one new site block and a graceful reload.

Every command says where it runs: **[omarchy]** (the home-office machine, in the v2 repo) or **[vps]**
(`ssh conductor`).

---

## 1. How v1 is deployed today (recon 2026-11-05)

| What         | Value                                                                                                                                                                                                                                                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host         | DigitalOcean droplet, SSH alias `conductor` (`~/.ssh/config`), user `j2willey` (sudo, docker groups). Only other login user: `root`                                                                                                                                                                                                                        |
| OS           | Ubuntu 24.04.5 LTS, kernel 6.8, x86_64                                                                                                                                                                                                                                                                                                                     |
| Size         | 1 vCPU, **2 GiB RAM** (resized from 1 GiB on 2026-11-05, CPU and RAM only), 2 GiB swapfile, 25 GB disk (18 GB free). After the resize, with v1 running: about 620 MiB used, **1.3 GiB available**, swap unused                                                                                                                                             |
| Docker       | Engine 29.9, Compose v5.6. No Caddy or nginx on the host itself                                                                                                                                                                                                                                                                                            |
| v1 code      | `~/ws/camporee-conductor`, a git clone of `j2willey/camporee-conductor` on `main`                                                                                                                                                                                                                                                                          |
| v1 runtime   | One Compose project, `camporee-conductor`, with 6 containers: `camporee-caddy`, `-landing`, `-composer`, `-collator`, `-demo-collator`, `-demo-composer`. About 335 MiB RAM in total (50 to 72 MiB each)                                                                                                                                                   |
| v1 config    | `~/ws/camporee-conductor/.env`: Clerk keys, Gemini key, `SESSION_SECRET`, `CADDY_HOST=camporeeconductor.com`, `DATA_DIR=/opt/camporee-conductor-data`, `NODE_ENV=production`, `COLLATOR_MODE=offline`                                                                                                                                                      |
| v1 data      | `/opt/camporee-conductor-data` (1.8 MB), bind-mounted into the containers                                                                                                                                                                                                                                                                                  |
| Caddy        | Container `camporee-caddy` (`caddy:2-alpine`, v2.11.3) on ports 80 and 443. Config: `~/ws/camporee-conductor/Caddyfile` (tracked in the v1 repo), bind-mounted read-only as `/etc/caddy/Caddyfile` (a single-file mount; section 6 changes it to a folder mount). It reaches the apps by container name on the Docker network `camporee-conductor_default` |
| TLS          | Every site uses `tls internal` (Caddy's own CA). Browsers never see that certificate, because Cloudflare sits in front and presents its own (Cloudflare SSL mode must be **Full**, not Full (strict))                                                                                                                                                      |
| DNS          | Cloudflare (`tani` / `tom.ns.cloudflare.com`), proxied (orange cloud). One record per name: apex, `composer`, `collator`, `demo`, `collator-demo`, `composer-demo`. No wildcard, no `www`                                                                                                                                                                  |
| Cron         | `0 3 * * *`: reset the demo Collator (`seed-demo.js`)                                                                                                                                                                                                                                                                                                      |
| Deploy habit | Aliases in `~/.bash_aliases`. `revive` = `docker compose build && down --remove-orphans && up -d`, after a `git pull` by hand. `rcomposer` / `rcollator` / `rlanding` rebuild one service; `rcaddy` = `up -d caddy`                                                                                                                                        |

How a v1 update happens: `ssh conductor`, `cd ~/ws/camporee-conductor`, `git pull`, then `revive` (or the
single-service alias). Images are built **on the droplet**.

Recon also found v1's app ports reachable from the internet directly (camporee-conductor #3, fix: a DigitalOcean
Cloud Firewall) and a duplicate `SESSION_SECRET` in v1's `.env` (camporee-conductor #4). Neither blocks this
deploy, and v2 publishes no ports.

---

## 2. The plan for v2

```
Browser ─▶ Cloudflare (proxied, its own cert) ─▶ droplet :443 ─▶ camporee-caddy (v1 compose)
                                                                     │  network camporee-conductor_default
                                     ┌───────────────────────────────┼─────────────────────────┐
                                     ▼                               ▼                         ▼
                              v1 containers (unchanged)        composer-v2:3010   (new, own compose project)
                                                                     │
                                                              volume composer-v2_data → /data/composer.db
```

- **Subdomain:** `v2.camporeeconductor.com`.
- **Sign-in:** the **development instance** of the existing "Camporee Conductor v2" Clerk application (`pk_test_…`).
  It works on any domain with no DNS setup, and shows a small "development mode" badge. A production instance
  comes later.
- **Separate Compose project** `composer-v2` in `~/composer-v2/` on the droplet. It joins v1's network as an
  _external_ network, so Caddy can reach it by name. v1's `docker-compose.yml` is not touched.
- **No published ports.** Only Caddy can reach v2.
- **Memory cap** `mem_limit: 256m`. If v2 misbehaves, it gets killed instead of starving v1.
- **Build on Omarchy, ship the image.** The droplet still has only 1 CPU, and building v2 there (pnpm install,
  Vite, maybe compiling better-sqlite3) would slow v1 for minutes. Build on Omarchy, then stream the
  image over SSH (`docker save | ssh … docker load`). Both machines are x86_64. (Later: CI could publish to GHCR
  and the droplet would `docker pull`.)
- **Images tagged by git commit** (`composer-v2:f654e0a`). The tag lives in `~/composer-v2/.env` as `TAG`, so
  rolling back means putting the old tag back.
- **The Caddy block is committed to the v1 repo**, so the droplet's Caddyfile always matches git. The same v1 PR moves it
  to `caddy/Caddyfile` and mounts that folder, so later changes are `git pull` plus `caddy reload` (section 6).
- **Database:** `/data/composer.db` in the named volume `composer-v2_data`. It survives new images. Migrations run
  automatically when the server starts.
- **Backups:** Litestream is a follow-up (#36). Until it lands, back up by hand **before every deploy**
  (section 11).

---

## 3. Before you start (gates)

- [ ] **Docker works on Omarchy without sudo.** One-time fix:
      `sudo systemctl enable --now docker && sudo usermod -aG docker $USER`, then log out and back in.
      Check: `docker info` prints no "permission denied".
- [ ] **The Clerk dev instance** of "Camporee Conductor v2" has **verify at sign-up** turned on (issue #4 acceptance).
      Have its two keys ready (Clerk dashboard → API keys). They go only into the droplet's `.env`.
- [ ] **The v1 PR `chore/caddy-v2-site` is merged** to v1's `main` (not yet pulled on the droplet; section 6 does that).
- [ ] **The rehearsal passes** (step 4.0): Caddy picks up a pulled Caddyfile through the folder mount, and v1's `revive`
      works with v2 attached.
- [ ] **Memory gate (issue #4, D6).** Measured in step 4.3 and again in 5.4. Pass = v2 idles under about
      150 MiB, and the droplet still shows at least 1 GiB `available` in `free -h` with v2 running (1.3 GiB before v2).

---

## 4. Build and ship the image

**4.0 [omarchy]: rehearse the two risky moves** (once, before the first deploy):

```sh
docs/runbook/rehearse.sh
```

It builds a small copy of the droplet's layout from throwaway containers and checks two things:

1. **A Caddyfile change that arrives by `git pull` reaches Caddy with a reload**, using the folder mount. The old
   single-file mount runs alongside it for contrast, and should still see the old file.
2. **v1's `revive` works with v2 attached.** `revive` runs `docker compose down`, which tries to delete the network
   v2 is on. If Compose treated "network in use" as an error, `revive`'s `&& up -d` would never run and v1 would stay
   down. The script checks that `revive` exits 0, v1 comes back, and Caddy still reaches v2.

Pass = every line `PASS`. On any `FAIL`, stop and rethink before going further.

**4.1 [omarchy]: build.** From an up-to-date `main` (or the commit you mean to deploy):

```sh
TAG=$(git rev-parse --short HEAD)
docker build -t composer-v2:$TAG .
```

**4.2 [omarchy]: smoke test**, the same check CI runs:

```sh
docker run -d --name cv2-smoke --init -p 3010:3010 \
  -e CLERK_SECRET_KEY=sk_test_placeholder -e CLERK_PUBLISHABLE_KEY=pk_test_placeholder composer-v2:$TAG
curl -sf localhost:3010/health && curl -sf localhost:3010/ | grep -q "<title>Composer</title>" && echo OK
```

**4.3 [omarchy]: memory at idle** (first half of the memory gate). Write the number down.

```sh
docker stats --no-stream cv2-smoke
docker rm -f cv2-smoke
```

**4.4 [omarchy → vps]: ship.** Streams the image over SSH. Nothing is built on the droplet.

```sh
docker save composer-v2:$TAG | gzip | ssh conductor 'gunzip | docker load'
ssh conductor docker images composer-v2
```

---

## 5. Start v2 on the droplet (v1 untouched)

**5.1 [vps]: a home for the Compose project.** Not inside v1's folder.

```sh
mkdir -p ~/composer-v2 && cd ~/composer-v2
```

**5.2 [vps]: `~/composer-v2/compose.yml`**

```yaml
# Composer v2 beside v1. Joins v1's network so v1's Caddy can reach it; publishes no ports.
name: composer-v2
services:
  composer:
    container_name: composer-v2
    image: composer-v2:${TAG}
    env_file: .env
    init: true
    mem_limit: 256m
    volumes:
      - data:/data
    networks:
      - v1
    restart: unless-stopped
volumes:
  data:
networks:
  v1:
    external: true
    name: camporee-conductor_default
```

**5.3 [vps]: `~/composer-v2/.env`.** Holds secrets, so only you can read it. Type the keys in on the droplet,
and never commit or paste them anywhere.

```sh
touch .env && chmod 600 .env
# then edit .env to contain:
#   TAG=<the tag from 4.1>
#   CLERK_SECRET_KEY=sk_test_...        (Camporee Conductor v2, development instance)
#   CLERK_PUBLISHABLE_KEY=pk_test_...
```

**5.4 [vps]: start, and check it from Caddy's side of the network.**

```sh
docker compose up -d
docker compose logs --tail 20          # expect "auth: clerk (development instance)" and "listening on :3010"
docker exec camporee-caddy wget -qO- http://composer-v2:3010/health   # expect {"ok":true}
docker stats --no-stream               # memory gate, 2nd half: composer-v2 vs the v1 containers
free -h                                # 'available' should still be ≥ ~1 GiB
```

Up to this point the public internet can't reach v2. If anything looks wrong, `docker compose down` and stop here.

---

## 6. Route v2 through Caddy (the one change shared with v1)

This lands v1's `chore/caddy-v2-site` PR on the droplet. That PR does two things:

- It moves the Caddyfile to `caddy/Caddyfile` and adds the `v2.` block.
- It mounts the `caddy/` **folder** into the container instead of the single file. A single-file mount pins the file's
  inode, and `git pull` writes a new file, so Caddy would keep reading the old one. A folder mount follows names,
  so from now on a Caddyfile change is just `git pull` plus `caddy reload` (step 4.0 proves this).

Changing the mount means Caddy's container is **recreated once**, a few seconds' outage for every v1 site. Do it at
a quiet time. Everything is validated first, so the restart starts on a config already known to be good.

**6.1 [vps]: record where v1 is now**, so you can compare and roll back.

```sh
cd ~/ws/camporee-conductor
git rev-parse HEAD > ~/composer-v2/v1-before.sha
for h in "" composer. collator. demo. collator-demo. composer-demo.; do
  curl -s -o /dev/null -w "%{http_code}  https://${h}camporeeconductor.com/\n" "https://${h}camporeeconductor.com/"
done | tee ~/composer-v2/v1-before.txt
```

**6.2 [vps]: look at what's coming, and validate it before anything changes.**

```sh
git fetch origin
git diff --stat HEAD origin/main                  # expect: Caddyfile → caddy/Caddyfile, docker-compose.yml, CLAUDE.md
git show origin/main:caddy/Caddyfile > ~/composer-v2/Caddyfile.new
docker run --rm -e CADDY_HOST=camporeeconductor.com \
  -v ~/composer-v2/Caddyfile.new:/etc/caddy/Caddyfile:ro \
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

The last command runs a throwaway Caddy, not the live one. Expect `Valid configuration`. Anything else: stop.

**6.3 [vps]: pull, then recreate only Caddy.**

```sh
git pull --ff-only
docker compose up -d --no-deps caddy               # recreates camporee-caddy with the folder mount; other v1 containers untouched
docker compose ps caddy                            # "Up"
docker exec camporee-caddy grep -n "composer-v2" /etc/caddy/Caddyfile
```

`--no-deps` stops Compose from touching the other v1 services. If Caddy doesn't come up, roll back (8.1) straight away.

**6.4 [vps]: v1 still answers the same.**

```sh
for h in "" composer. collator. demo. collator-demo. composer-demo.; do
  curl -s -o /dev/null -w "%{http_code}  https://${h}camporeeconductor.com/\n" "https://${h}camporeeconductor.com/"
done | diff ~/composer-v2/v1-before.txt - && echo "v1 unchanged"
```

If anything differs, roll back (8.1).

**Later Caddyfile changes** (after this one): merge the v1 PR, then on the droplet:

```sh
cd ~/ws/camporee-conductor && git pull --ff-only
docker exec camporee-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec camporee-caddy caddy reload   --config /etc/caddy/Caddyfile --adapter caddyfile   # graceful; a bad config is refused
```

---

## 7. DNS, then the first real check

**7.1 Cloudflare dashboard:** camporeeconductor.com → DNS → Add record:
Type `A`, Name `v2`, IPv4 = the droplet's address (same as the other records), Proxy status **Proxied**
(orange cloud), TTL Auto. Cloudflare's free certificate already covers `*.camporeeconductor.com`.

**7.2 [omarchy]: check** (DNS can take a minute):

```sh
getent ahostsv4 v2.camporeeconductor.com     # expect Cloudflare addresses (104.21.x / 172.67.x), not the droplet's
curl -s https://v2.camporeeconductor.com/health   # {"ok":true}
```

**7.3 [vps]: seed the demo Event.** Seed with _your_ sign-in email. Your first Clerk sign-in links to it (#32).

```sh
docker exec composer-v2 node apps/composer-api/src/cli/seed-demo.ts <your-email> coyote-creek packages/schema/fixtures/circus-2026
```

**7.4 In a browser:** open `https://v2.camporeeconductor.com`, sign in with Clerk, see the Organization, open
Circus 2026. This is issue #4's "sign-in works on the deployed host" check.

---

## 8. Rollback

Each piece rolls back on its own. None of these touch v1's containers or data.

**8.1 Caddy** (if Caddy doesn't start after 6.3, or v1 answers differently in 6.4). Go back to v1's previous
commit (the single-file mount and the old Caddyfile) and recreate Caddy:

```sh
cd ~/ws/camporee-conductor
git reset --hard $(cat ~/composer-v2/v1-before.sha)
docker compose up -d --no-deps caddy
# then re-run the 6.4 check
```

`git reset --hard` only rewinds the droplet's clone; GitHub still has the change. Then revert it in v1 with a PR, so
the next `git pull` doesn't bring it back.

**8.2 A bad v2 version:** set `TAG=` back to the previous tag in `~/composer-v2/.env`, then
`cd ~/composer-v2 && docker compose up -d`. Keep the last couple of images on the droplet.
If a newer image already migrated the DB, an older image may not run against it: restore the backup you took
before the deploy (section 11.3), which also sets the old `TAG`.

**8.3 Take v2 down entirely:**

```sh
cd ~/composer-v2 && docker compose down          # add -v to also delete the database volume
```

Then remove the `v2.` block from `caddy/Caddyfile` with a v1 PR (deploy it with "Later Caddyfile changes" in section 6),
then delete the `v2` record in Cloudflare.

---

## 9. After any v1 `revive`, verify v2

`revive` deletes and recreates v1's containers, including Caddy. v2 should survive (step 4.0 rehearsed it), but
check every time:

```sh
# [vps], right after revive / rcaddy / any v1 docker compose down+up
curl -s https://v2.camporeeconductor.com/health          # expect {"ok":true}
cd ~/composer-v2 && docker compose ps                    # composer-v2 should be "Up"
```

If the health check fails: `cd ~/composer-v2 && docker compose up -d --force-recreate`, then check again.

---

## 10. Later

- **Deploying a new v2 version:** **back up first (11.1, 11.2)**, then 4.1 to 4.4 with the new commit, set `TAG` in
  `~/composer-v2/.env`, `docker compose up -d`, then 7.2. Caddy and DNS don't change.
- **Follow-up issue: Litestream backups** (ADR-0013). Stream `/data/composer.db` to object storage (e.g.
  DigitalOcean Spaces). Needs its own decisions (bucket, credentials, retention, a restore drill).
- **Maybe:** CI publishes the image to GHCR so the droplet can `docker pull` instead of 4.4.

---

## 11. Backup before deploy / Rollback (until #36)

Until Litestream (#36) replaces this section, **back up before ANY deploy**, with or without a migration.
Migrations run automatically when the new image starts (section 2), so the backup is the only way back.

These are the exact commands rehearsed on 2026-11-06 (backup → deploy a migrating image on the same volume →
restore onto the old image; every row came back and the integrity check passed).

> **Backups contain users' emails** (and, once there are Officials, theirs). Keep them private: only on the droplet
> and on Omarchy. **Never commit them**, attach them to an issue, or paste them anywhere.

**11.1 [vps]: back up, while v2 keeps running.** The database is in WAL mode, so a plain file copy can miss the latest
writes. This uses SQLite's online backup through `better-sqlite3`, which is already in the image:

```sh
mkdir -p ~/composer-v2/backups
docker exec -w /repo/apps/composer-api composer-v2 node -e "require('better-sqlite3')('/data/composer.db',{readonly:true}).backup('/data/composer-backup.db').then(()=>console.log('backup ok'))"
docker cp composer-v2:/data/composer-backup.db ~/composer-v2/backups/composer-$(date +%Y%m%d-%H%M).db
grep TAG ~/composer-v2/.env        # write down the running tag: it's what you roll back to
```

Expect `backup ok`. Name the file after the deploy if that helps (e.g. `…-before-8.db`).

**11.2 [omarchy]: keep a private copy off the droplet.**

```sh
mkdir -p ~/composer-v2-backups && scp 'conductor:composer-v2/backups/*' ~/composer-v2-backups/
```

**11.3 [vps]: roll back** to the backup and the old tag. Nothing is deleted: the WAL side-files of the newer database
are moved aside (`.before-restore`), so a wrong step can still be undone.

```sh
cd ~/composer-v2 && docker compose stop
docker run --rm -v composer-v2_data:/data -v ~/composer-v2/backups:/b --entrypoint sh composer-v2:<OLD_TAG> \
  -c 'cp /b/<backup-file>.db /data/composer.db && for f in /data/composer.db-wal /data/composer.db-shm; do if [ -e "$f" ]; then mv "$f" "$f.before-restore"; fi; done'
# set TAG=<OLD_TAG> in ~/composer-v2/.env, then:
docker compose up -d
docker compose logs --tail 5          # expect "listening on :3010"
curl -s https://v2.camporeeconductor.com/health
```

Replace `<OLD_TAG>` with the tag from 11.1, and `<backup-file>` with the file name in `~/composer-v2/backups`.
The `.before-restore` files can go once v2 is healthy again.
