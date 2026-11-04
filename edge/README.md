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
flood protection, and keep-warm for every server.
1. Free Cloudflare account → **Workers & Pages** (note the Account ID) → **KV** → create a namespace
   `brightfolio-config` (note its id).
2. My Profile → API Tokens → Create token with **Workers Scripts: Edit** and **Workers KV Storage: Edit**
   (and **Zone DNS: Edit** if you use your own domain on Cloudflare).
3. GitHub repository → Settings → Secrets and variables → Actions:
   secrets `CLOUDFLARE_API_TOKEN`, `EDGE_SECRET` (any long random text);
   variables `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_KV_ID`, `EDGE_ORIGINS` (e.g. `https://oracle.example.com,https://quantpocket.onrender.com`).
4. Run the **Edge (Cloudflare Worker)** workflow. The site is then at `https://brightfolio-edge.<you>.workers.dev`
   (or add your own domain to the Worker in Cloudflare).
5. On every server set `PUBLIC_URL` to that address, `EDGE_SECRET` to the same secret, and in Admin → Keys
   add `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_KV_ID` so Admin → Hosting can switch.
   Update the APP_URL repository variable and Twilio's / Stripe's webhook addresses to the new address
   (Admin → Money & fees → Stripe → Finish setup re-creates the Stripe webhook).

## 3. Switching

Admin → Hosting → **Make active**: the edge sends visitors to that server at once (the others stay as
backups), the DNS record follows if you use your own domain, APP_URL is updated, and that server takes
over bots, scheduled trades and alerts (exactly one server runs them).
