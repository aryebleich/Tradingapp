#!/usr/bin/env bash
# Sets up Brightfolio on a fresh Ubuntu 24.04 server (Oracle Cloud Always Free ARM VM, or any VM).
# Run once as the default user:  curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/deploy/vm/setup.sh | sudo bash -s -- <your-domain-or-ip.sslip.io> <owner/repo>
# What it does:
#   - security: firewall (only SSH, HTTP, HTTPS), SSH by key only, fail2ban, automatic security
#     updates (with reboots at 4 AM when needed), a non-root app user
#   - the app in Docker (read-only, no extra privileges), restarted automatically
#   - Caddy in front with free automatic HTTPS (Let's Encrypt) and HTTP/3
#   - auto-deploy: every 2 minutes it checks GitHub; a new commit on main is built and swapped in
# Settings (keys, DATABASE_URL, HOST_ID=oracle ...) go in /opt/brightfolio/.env (chmod 600).
set -euo pipefail
DOMAIN="${1:?Give the domain (or <ip>.sslip.io) as the first argument}"
REPO="${2:-aryebleich/Tradingapp}"
APP=/opt/brightfolio

echo "== System updates and basics"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get upgrade -y
apt-get install -y --no-install-recommends ca-certificates curl git ufw fail2ban unattended-upgrades docker.io docker-compose-v2 debian-keyring debian-archive-keyring apt-transport-https gnupg

echo "== Automatic security updates"
cat >/etc/apt/apt.conf.d/52brightfolio <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

echo "== Firewall: SSH, HTTP, HTTPS only"
ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
ufw --force enable
# Oracle images also filter with iptables: open 80/443 there too.
if iptables -L INPUT -n 2>/dev/null | grep -q REJECT; then
  iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT; iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT; iptables -I INPUT 6 -p udp --dport 443 -j ACCEPT
  command -v netfilter-persistent >/dev/null && netfilter-persistent save || true
fi

echo "== SSH: keys only, no root login"
sed -i -E 's/^#?PasswordAuthentication .*/PasswordAuthentication no/; s/^#?PermitRootLogin .*/PermitRootLogin no/; s/^#?KbdInteractiveAuthentication .*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config
systemctl reload ssh || systemctl reload sshd || true
systemctl enable --now fail2ban

echo "== Caddy (automatic HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi
cat >/etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		-Server
	}
	reverse_proxy 127.0.0.1:3000 {
		flush_interval -1
	}
}
EOF
systemctl enable --now caddy && systemctl reload caddy

echo "== The app"
id brightfolio >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin brightfolio
usermod -aG docker brightfolio
mkdir -p "$APP" && chown brightfolio:brightfolio "$APP"
[ -d "$APP/src/.git" ] || sudo -u brightfolio git clone --depth 1 "https://github.com/$REPO.git" "$APP/src"
if [ ! -f "$APP/.env" ]; then
  cat >"$APP/.env" <<EOF
# Brightfolio settings for this server. Copy your keys here (Admin → Keys → Download .env helps).
NODE_ENV=production
PORT=3000
HOST_ID=oracle
PUBLIC_URL=https://$DOMAIN
# DATABASE_URL=libsql://...   (the same database as your other servers)
# DATABASE_AUTH_TOKEN=...
# ENCRYPTION_KEY=...          (the same as on your other servers, or saved keys cannot be read)
# EDGE_SECRET=...             (when the Cloudflare edge is in front)
EOF
  chmod 600 "$APP/.env"; chown brightfolio:brightfolio "$APP/.env"
fi
cp "$APP/src/deploy/vm/compose.yml" "$APP/compose.yml"
cp "$APP/src/deploy/vm/update.sh" /usr/local/bin/brightfolio-update && chmod 755 /usr/local/bin/brightfolio-update

echo "== Auto-deploy every 2 minutes"
cat >/etc/systemd/system/brightfolio-update.service <<'EOF'
[Unit]
Description=Brightfolio: deploy the newest commit on main
[Service]
Type=oneshot
ExecStart=/usr/local/bin/brightfolio-update
EOF
cat >/etc/systemd/system/brightfolio-update.timer <<'EOF'
[Unit]
Description=Brightfolio: check GitHub for a new version every 2 minutes
[Timer]
OnBootSec=30s
OnUnitActiveSec=2min
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload && systemctl enable --now brightfolio-update.timer
FORCE=1 /usr/local/bin/brightfolio-update || echo "(The app starts once $APP/.env has your settings; that is the next step.)"

echo
echo "Done. Open https://$DOMAIN/healthz . Next: fill in $APP/.env (DATABASE_URL, ENCRYPTION_KEY and your keys),"
echo "then run: sudo FORCE=1 brightfolio-update . Add this server in Admin → Hosting with id 'oracle'."
