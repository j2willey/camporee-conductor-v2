# Runbook: the public demo on the droplet

Issue #143, ADR-0033. The demo is three containers in the compose project `v2-demo` (`deploy/demo/compose.yaml`):

| Container       | What                                                 | Hostname                                     |
| --------------- | ---------------------------------------------------- | -------------------------------------------- |
| `demo-hub`      | The demo hub and the phone-frame page (static files) | `demo.camporeeconductor.com`                 |
| `collator-demo` | The Collator, loaded with Circus 2026                | `collator-demo.camporeeconductor.com`        |
| `composer-demo` | The Composer (Clerk development instance, AI off)    | `composer-demo.`, `v2.camporeeconductor.com` |

They publish no ports. The droplet's front door, **ww-edge** (a separate private repo, `~/ww/ww-edge` on the
droplet), routes each hostname to its container over the shared Docker network `edge`. Its README covers adding,
reloading and checking sites. The droplet's DigitalOcean Cloud Firewall (`ww-edge-firewall`) lets in only 22, 80 and 443.

`[omarchy]` steps run on Jim's machine in this repo; `[vps]` steps run on the droplet (`ssh conductor`).

## 1. Before a deploy

**1.1 [vps] Back up the Composer database** (migrations can't be undone), while it keeps running. The database is in
WAL mode: most recent writes live in `composer.db-wal`, so **a plain copy of `composer.db` is not a backup** (on
2026-11-15 one held 4 KB of a 2.3 MB database). Use SQLite's online backup through `better-sqlite3`, as deploy.md
11.1 does, then check the copy:

```sh
mkdir -p ~/ww/backups
c=composer-demo                     # the first deploy (step 3): composer-v2, the container being replaced
docker exec -w /repo/apps/composer-api $c node -e "require('better-sqlite3')('/data/composer.db',{readonly:true}).backup('/data/composer-backup.db').then(()=>console.log('backup ok'))"
f=~/ww/backups/composer-demo-$(date +%F-%H%M).db && docker cp $c:/data/composer-backup.db $f
docker exec -i -w /repo/apps/composer-api $c node -e "const db=require('better-sqlite3')(process.argv[1],{readonly:true}); console.log(db.pragma('integrity_check',{simple:true}), db.prepare('select count(*) c from users').get().c, 'users,', db.prepare('select count(*) c from documents').get().c, 'documents')" /data/composer-backup.db
scp "conductor:ww/backups/$(basename $f)" ~/composer-v2-backups/   # [omarchy] a private copy off the droplet
```

Expect `backup ok`, then `ok` with non-zero counts. Backups hold users' emails: never commit or share them.

**1.2 [vps] Write down the running tag** (what you roll back to): `grep TAG ~/ww/camporee-conductor-v2/deploy/demo/.env`.

## 2. Build and ship the images [omarchy]

Both images from the same commit, tagged with it. Building on the droplet would tie up its single CPU.

```sh
TAG=$(git rev-parse --short HEAD)
docker build -t composer-v2:$TAG .
docker build --build-arg BUILD_COMMIT=$TAG -t collator-v2:$TAG -f apps/collator/Dockerfile .
docker save composer-v2:$TAG collator-v2:$TAG | gzip | ssh conductor 'gunzip | docker load'
```

## 3. First deploy (one time)

**3.1 [vps] The repo and settings.** The repo is public, so no key is needed:

```sh
cd ~/ww && git clone https://github.com/j2willey/camporee-conductor-v2.git
cd ~/ww/camporee-conductor-v2/deploy/demo
cp ~/ww/composer-v2/.env .env && chmod 600 .env   # today's v2 Clerk keys; then set TAG=<tag from step 2>
mkdir -p cartridges
```

**3.2 [vps] Retire the old `composer-v2` project; start the demo.** The demo keeps its data volume:

```sh
cd ~/ww/composer-v2 && docker compose down        # removes the container only; the volume composer-v2_data stays
cd ~/ww/camporee-conductor-v2/deploy/demo && docker compose up -d
docker compose ps                                 # all three Up; the Composer runs its migrations on start
```

**3.3 [vps] Point the hostnames at the demo** in ww-edge (`caddy/sites/camporee-v2.caddy`, committed from Omarchy),
then `rcaddy` (git pull + hot reload). Remove the v1 demo blocks from `camporee-v1.caddy` in the same commit.

**3.4 [omarchy → vps] Load Circus 2026 into the Collator.** The cartridge is made on Omarchy; the Director email is
given here so it never lands in the repo:

```sh
node deploy/demo/make-cartridge.ts <your-email> /tmp/demo-circus.zip
scp /tmp/demo-circus.zip conductor:ww/camporee-conductor-v2/deploy/demo/cartridges/
ssh conductor 'cd ~/ww/camporee-conductor-v2/deploy/demo && chmod 644 cartridges/demo-circus.zip &&
  docker compose exec collator node apps/collator/src/cli/load-cartridge.ts /cartridges/demo-circus.zip'
node deploy/demo/seed-roster.ts https://collator-demo.camporeeconductor.com
```

The cartridge's Officials: you as Director, and `demo@camporeeconductor.com` as an Official (printed on the hub).
The demo Official must never be a Director: a Director can load a different cartridge over the internet.

**3.5 [browser + vps] The Composer.** Sign in at `composer-demo.camporeeconductor.com` once, then on the droplet:

```sh
cd ~/ww/camporee-conductor-v2/deploy/demo
docker compose exec composer node apps/composer-api/src/cli/set-sysadmin.ts <your-email>
docker compose exec composer node apps/composer-api/src/cli/set-curator.ts <your-email>
```

Then in the browser, publish the Circus 2026 Event (or a Template made from it) to the Library, so visitors can
start a New Event from it.

**3.6 [vps] Retire v1's demo**, kept for 30 days for rollback:

```sh
cd ~/ww/camporee-conductor && docker compose stop demo-composer demo-collator
crontab -l | grep -v seed-demo.js | crontab -   # v1's 03:00 demo reset
```

## 4. Every later deploy

1.1 and 1.2, then 2, then on the droplet:

```sh
cd ~/ww/camporee-conductor-v2 && git pull       # hub pages and compose file
cd deploy/demo && sed -i "s/^TAG=.*/TAG=<new tag>/" .env && docker compose up -d
```

## 5. Check

```sh
for h in demo collator-demo composer-demo v2; do
  printf '%-16s %s\n' $h "$(curl -sL -o /dev/null -w '%{http_code}' https://$h.camporeeconductor.com/)"; done
free -m   # "available" at least 900 MiB (ADR-0033)
```

Then by hand: the hub's three doors; score a Team in the phone frame and see it in the Official view; sign in to the
Composer.

## 6. Roll back

- **A bad version:** set `TAG` back to the old tag in `.env`, restore the backup from 1.1 into `composer-v2_data` if
  a migration ran, `docker compose up -d`.
- **The whole demo:** `docker compose down` here, `docker compose start demo-composer demo-collator` in
  `~/ww/camporee-conductor`, and restore v1's demo blocks in ww-edge (`git revert`, then `rcaddy`).

## 7. Reset the demo Collator

The demo has no nightly reset yet (#93). To start over: `docker compose down collator`,
`docker volume rm v2-demo_collator-data`, `docker compose up -d collator`, then 3.4 again.
