# Hosting: a free always-on server, the edge in front, and switching in Admin → Hosting

## 1. A server that never sleeps (free)

**Oracle Cloud Always Free** (recommended main server):
1. Sign up at cloud.oracle.com (a card is asked for identity; Always Free resources are not charged).
   Upgrading the account to "Pay as you go" keeps the free allowance and stops Oracle from reclaiming
   idle free machines.
2. Create an instance: image **Ubuntu 24.04**, shape **VM.Standard.A1.Flex** (Ampere ARM) with the
   Always Free CPUs and memory (2 OCPUs / 12 GB for free accounts since June 2026). Add your SSH key.
   In the instance's subnet security list, allow TCP 80 and 443 from 0.0.0.0/0.
3. A name for it: your own domain pointed at its public IP, or a free `<ip-with-dashes>.sslip.io`.
4. SSH in and run:
   `curl -fsSL https://raw.githubusercontent.com/aryebleich/Tradingapp/main/deploy/vm/setup.sh | sudo bash -s -- <name> aryebleich/Tradingapp`
5. Put your settings in `/opt/brightfolio/.env` (Admin → Keys → Download .env gives them all). It must have
   the same `DATABASE_URL`, `DATABASE_AUTH_TOKEN` and `ENCRYPTION_KEY` as Render, plus `HOST_ID=oracle`.
   Then `sudo FORCE=1 brightfolio-update`. From then on every push to main is live there within 2 minutes.

**Northflank** (second free always-on option): new project → service from the GitHub repository →
build with the Dockerfile → port 3000 → add the same settings and `HOST_ID=northflank`.

Then add each server in **Admin → Hosting** (id = its HOST_ID, its https address, and its deploy hook if
it has one). Render can stay as the backup (`HOST_ID` unset counts as `render`).

## 2. The edge (free Cloudflare Worker in front)

Fast static files from the nearest Cloudflare location, failover to the backup server, attack and
flood protection, and keep-warm for every server. Set up from the admin page with one press:
1. Free account at dash.cloudflare.com. To use your own domain, add it there (Add a domain → Free) and
   put Cloudflare's two name servers at your domain company.
2. Profile → API Tokens → Create Token → template **Edit Cloudflare Workers**, and add
   **Zone → DNS → Edit** and **Zone → Zone → Read**. Copy the token.
3. Admin → Keys → `CLOUDFLARE_API_TOKEN`.
4. Admin → Hosting: add each server with its own address (not the domain), then **Set up the edge**
   with the site's address (e.g. `app.brightolio.com`). It finds the account, creates the settings
   store, uploads `edge/worker.js` with its 5-minute keep-warm, gives it the servers (active first),
   turns on Cloudflare for that name and routes it to the Worker. Without the domain on Cloudflare it
   uses the free `brightfolio-edge.<name>.workers.dev` address.
5. The edge proves itself to the servers with a secret derived from ENCRYPTION_KEY, which every server
   already shares; `EDGE_SECRET` overrides it. Requests signed this way also pass the address the
   visitor used, so sign-in and redirects use the public name.

The "Edge (Cloudflare Worker)" workflow is the alternative for deploying from GitHub instead.

## 3. Switching

Admin → Hosting → **Make active**: the edge sends visitors to that server at once (the others stay as
backups), the DNS record follows if you use your own domain, APP_URL is updated, and that server takes
over bots, scheduled trades and alerts (exactly one server runs them).
