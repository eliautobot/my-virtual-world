# Installing My Virtual World

My Virtual World runs as one Node.js server. It keeps its data in one folder: the world files and the accounts
database (`next.db`). A key for stored secrets, such as two-factor sign-in secrets, is kept outside that folder. There
are two official installs:

- [Docker](#docker), on any machine with Docker. This is the quickest way.
- [Native](#native-linux-with-systemd), on a Linux server with systemd.

A new world opens with the starting map: a city of about 110 buildings and 1,000 residents, metro stations, parks, an
airport, a marina and lake docks. It needs about 300 MB of memory and a fraction of one CPU core; larger cities need more.
Windows and macOS: use Docker Desktop.

**Signing in needs HTTPS**, except on the machine that runs the server. A fresh install can only be reached from that
machine. [Reaching it from other machines](#reaching-it-from-other-machines) takes a reverse proxy with a certificate.

## Docker

You need Docker Engine with Docker Compose v2, or Docker Desktop.

1. Get the code and start it:
   ```sh
   git clone https://github.com/eliautobot/my-virtual-world.git
   cd my-virtual-world
   docker compose up -d
   ```
   The first start builds the image (a few minutes) and opens the world with the starting map. `docker compose ps`
   shows the app as `healthy` once it is ready, usually within half a minute of the build.
2. Find the one-time **setup code**. The server prints it when it starts:
   ```sh
   docker compose logs app
   ```
   Look for `Setup code: XXXX-XXXX`. It is also in a file: `docker compose exec app cat /data/setup-code.txt`
3. On the same machine, open <http://localhost:8570>. The **Welcome** dialog asks for the setup code and the
   administrator account you want: your username, display name and password. That account is the world's owner.

[ACCOUNTS.md](ACCOUNTS.md) explains accounts, roles and two-factor sign-in.

### Settings

compose.yaml reads its settings from the environment, or from a file named `.env` next to it.
[.env.example](../.env.example) describes every setting. Copy the lines you need into `.env`, then run
`docker compose up -d` again. For example:

```sh
MVW_PUBLIC_URL=https://world.example.org
```

How many people live in the city is set in the world itself: **Settings → Residents → Homes filled**.

### Updating

Read the release notes first, then:

```sh
git pull
docker compose up -d --build
```

The world, the accounts and the key stay in their Docker volumes.

### Backups

While the app runs, one command writes the world and the accounts to one file:

```sh
docker compose exec -T app node tools/admin.mjs backup > world-backup.tar.gz
```

The key for stored secrets is not in the backup. Copy it once, and keep it as safe as a password, for example in a
password manager:

```sh
docker compose exec -T app cat /keys/secret.key > secret.key
```

To restore a backup, stop the app, replace its data and start it again:

```sh
docker compose stop app
docker compose run --rm --no-deps -T app sh -c 'find /data -mindepth 1 -delete && tar -xzf - -C /data' < world-backup.tar.gz
docker compose start app
```

On a new machine, put the key in place first:

```sh
docker compose run --rm --no-deps -T app sh -c 'umask 077 && cat > /keys/secret.key' < secret.key
```

### Administration

```sh
docker compose exec app node tools/admin.mjs status        # the owner, accounts, sessions and the key
docker compose exec app node tools/admin.mjs reset-owner   # a new temporary owner password (or, before setup, a new setup code)
docker compose logs app                                    # the server's log
```

`node tools/admin.mjs` without a command lists every command.

### Removing

`docker compose down` stops and removes the containers, and keeps the volumes. `docker compose down -v` also deletes
the volumes: the world, the accounts and the key are gone for good.

## Native (Linux with systemd)

You need Node.js 24.7 or newer, git and systemd. Distribution packages of Node.js are often older;
nodejs.org and NodeSource have current ones. The commands below run as an administrator with sudo.

1. Create the service's user and get the code. The code belongs to root, so the service cannot change it.
   ```sh
   sudo useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin my-virtual-world
   sudo git clone https://github.com/eliautobot/my-virtual-world.git /opt/my-virtual-world
   cd /opt/my-virtual-world
   sudo npm ci --omit=dev --ignore-scripts
   ```
2. Install the service and start it:
   ```sh
   sudo cp docs/examples/my-virtual-world.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now my-virtual-world
   ```
   If `command -v node` shows another path than `/usr/bin/node`, change `ExecStart=` in the copied file first. At the
   first start, systemd creates `/var/lib/my-virtual-world` for the service, with the data folder and the key's
   folder. The world opens with the starting map.
3. Read the one-time setup code (it is also in `journalctl -u my-virtual-world`):
   ```sh
   sudo cat /var/lib/my-virtual-world/data/setup-code.txt
   ```
4. Sign in on the server itself. The example unit listens on `127.0.0.1:8570`, which only this machine can reach. From
   your own computer, an SSH tunnel counts as the server itself:
   ```sh
   ssh -L 8570:127.0.0.1:8570 you@your-server
   ```
   Then open <http://localhost:8570> on your computer. The **Welcome** dialog asks for the setup code and the
   administrator account you want (username, display name, password).

### Settings

Add settings with `sudo systemctl edit my-virtual-world`, one `Environment=` line each, under `[Service]`:

```ini
[Service]
Environment=MVW_PUBLIC_URL=https://world.example.org
```

Check the settings before you restart. This lists every problem without starting anything:

```sh
cd /opt/my-virtual-world
node tools/deploy/configcheck.mjs --unit my-virtual-world --systemctl systemctl
sudo systemctl restart my-virtual-world
```

### Updating

Read the release notes first, then:

```sh
cd /opt/my-virtual-world
sudo git pull
sudo npm ci --omit=dev --ignore-scripts
node tools/deploy/configcheck.mjs --unit my-virtual-world --systemctl systemctl
sudo systemctl restart my-virtual-world
```

For staged releases with automatic rollback, use the release tools in [tools/deploy](../tools/deploy/README.md).

### Backups

```sh
cd /opt/my-virtual-world
sudo -u my-virtual-world node tools/admin.mjs backup --data /var/lib/my-virtual-world/data > world-backup.tar.gz
```

The key for stored secrets is not in the backup. Copy `/var/lib/my-virtual-world/keys/secret.key` to a safe place once,
and keep it as safe as a password.

To restore a backup:

```sh
sudo systemctl stop my-virtual-world
sudo mv /var/lib/my-virtual-world/data /var/lib/my-virtual-world/data.before-restore
sudo install -d -m 0700 -o my-virtual-world -g my-virtual-world /var/lib/my-virtual-world/data
sudo -u my-virtual-world tar -xzf - -C /var/lib/my-virtual-world/data < world-backup.tar.gz
sudo systemctl start my-virtual-world
```

### Administration

```sh
cd /opt/my-virtual-world
sudo -u my-virtual-world node tools/admin.mjs status --data /var/lib/my-virtual-world/data --key-file /var/lib/my-virtual-world/keys/secret.key
sudo -u my-virtual-world node tools/admin.mjs reset-owner --data /var/lib/my-virtual-world/data
journalctl -u my-virtual-world    # the server's log
```

### Removing

```sh
sudo systemctl disable --now my-virtual-world
sudo rm /etc/systemd/system/my-virtual-world.service
sudo rm -rf /opt/my-virtual-world /var/lib/my-virtual-world   # the world, the accounts and the key, for good
sudo userdel my-virtual-world
```

## Reaching it from other machines

People on other machines need HTTPS to sign in, so the server needs a reverse proxy with a certificate. Until then,
nobody on another machine can reach the server.

### Docker: the included proxy

compose.yaml includes a Caddy reverse proxy, which gets a certificate automatically. You need a domain name whose DNS
points at this machine, with ports 80 and 443 reachable from the internet: Caddy uses them to prove that the domain is
yours. In `.env`:

```sh
MVW_DOMAIN=world.example.org
MVW_PUBLIC_URL=https://world.example.org
COMPOSE_PROFILES=proxy
```

Then run `docker compose up -d` and open <https://world.example.org>. `COMPOSE_PROFILES=proxy` starts the proxy with
every later `up`; without it, add `--profile proxy` to each `up`.

The proxy runs on a Docker network of its own with a fixed address, `10.87.70.10`, which the app trusts to report each
visitor's address. If Docker reports "Pool overlaps with other one on this address space", that network's subnet is
already taken on your machine. Set `MVW_PROXY_SUBNET`, `MVW_PROXY_RANGE` and `MVW_PROXY_IP` to a free subnet, a range in
its lower half, and an address in its upper half, for example `10.87.71.0/28`, `10.87.71.0/29` and `10.87.71.10`.

To use your own reverse proxy on the Docker host instead, point it at `127.0.0.1:8570`. Then set
`MVW_TRUSTED_PROXIES=10.87.70.1` (the network's gateway: your proxy's connections reach the app from there) and
`MVW_PUBLIC_URL`.

### Native: Caddy on the same machine

Install Caddy from its packages. Put this in `/etc/caddy/Caddyfile`, with your domain, then reload Caddy:

```
world.example.org {
	reverse_proxy 127.0.0.1:8570
}
```

The example unit already trusts a proxy on the same machine (`MVW_TRUSTED_PROXIES=127.0.0.1,::1`). Add
`Environment=MVW_PUBLIC_URL=https://world.example.org` with `sudo systemctl edit my-virtual-world`, then restart the
service.

## Settings

[.env.example](../.env.example) describes every setting. The ones most installs change:

| Setting | Default | Meaning |
|---|---|---|
| `MVW_PUBLIC_URL` | (none) | The address people open, such as `https://world.example.org`. When set, only this site may change anything. |
| `MVW_TRUSTED_PROXIES` | `none` (compose.yaml: the proxy's address) | Reverse proxies whose headers about the visitor are believed. |
| `MVW_STARTER_MAP` | `on` | A new world opens with the starting map. `off`: a generated city instead. |
| `MVW_HOUSING` | `on` | How many live in the city follows its homes (Settings → Residents → Homes filled). `off`: a fixed number. |
| `MVW_POPULATION` | `1000` | With `MVW_STARTER_MAP=off`: how big the generated city is built. |
| `MVW_SEED` | `next-city` | With `MVW_STARTER_MAP=off`: the random seed of the generated city. |
| `MVW_HQ_NAME` | `Headquarters` | With `MVW_STARTER_MAP=off`: the name of the generated city's headquarters (at most 28 characters). |
| `PORT`, `HOST` | `8570`, `0.0.0.0` | Where the server listens. The Docker image and the example unit set these. |
| `MVW_DATA` | the folder `data` in the code folder | The data folder, as an absolute path. The Docker image and the example unit set it. |
| `MVW_KEY_FILE` | (required) | The key file for stored secrets, outside the data folder. The Docker image and the example unit set it. [SECRETS.md](SECRETS.md) explains the key. |

An invalid setting stops the start, with a message that lists every setting to fix.

## When something goes wrong

- **The server does not start.** Read its log: `docker compose logs app`, or `journalctl -u my-virtual-world`. A
  configuration problem stops the start with a message that lists every setting to fix.
- **Signing in says it needs HTTPS.** On another machine, set up a
  [reverse proxy](#reaching-it-from-other-machines). On the server itself, open `http://localhost:8570`, not the
  machine's name or address.
- **The setup code is lost, or the owner's password forgotten.** `node tools/admin.mjs reset-owner` writes a new setup
  code (before the administrator account exists) or a temporary owner password (after), see Administration.
- **Stored secrets cannot be opened** after a restore or a move to a new machine. The server needs the key that the
  backup was made with. [SECRETS.md](SECRETS.md) explains the choices.
