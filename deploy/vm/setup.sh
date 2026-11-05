#!/usr/bin/env bash
# Sets up Brightfolio on a fresh Ubuntu 24.04 server (Oracle Cloud Always Free ARM VM, or any VM).
# Run once:  curl -fsSL https://raw.githubusercontent.com/aryebleich/Tradingapp/main/deploy/vm/setup.sh -o setup.sh   then   sudo bash setup.sh auto
# What it does:
#   - security: firewall (only SSH, HTTP, HTTPS), SSH by key only, fail2ban, automatic security
#     updates (with reboots at 4 AM when needed), a non-root app user
#   - the app in Docker (read-only, no extra privileges), restarted automatically
#   - Caddy in front with free automatic HTTPS (Let's Encrypt) and HTTP/3
#   - auto-deploy: every 2 minutes it checks GitHub; a new commit on main is built and swapped in
# Settings (keys, DATABASE_URL, HOST_ID=oracle ...) go in /opt/brightfolio/.env (chmod 600).
set -euo pipefail
DOMAIN="${1:-auto}"
# "auto": this server's public IPv4 address as a free name, e.g. 129-146-12-34.sslip.io
if [ "$DOMAIN" = "auto" ]; then
  IP=""
  for u in https://api.ipify.org https://ipv4.icanhazip.com https://ifconfig.me/ip https://checkip.amazonaws.com; do
    IP=$(curl -4fsS --max-time 10 "$u" 2>/dev/null | tr -d '[:space:]' || true)
    echo "$IP" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' && break; IP=""
  done
  [ -n "$IP" ] || { echo "Could not find this server's public address. Run again with it, e.g.: sudo bash setup.sh 129-146-12-34.sslip.io" >&2; exit 1; }
  DOMAIN="$(echo "$IP" | tr . -).sslip.io"
  echo "Public address: $IP  ->  https://$DOMAIN"
fi
case "$DOMAIN" in *:*|.sslip.io|-*) echo "That does not look like a domain: $DOMAIN (use the server's IPv4 address with dashes, e.g. 129-146-12-34.sslip.io)" >&2; exit 1;; esac
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
# Oracle images also filter with iptables, ending in a REJECT rule: the web ports must come first.
# Any older copies of these rules (possibly placed after the REJECT) are removed, then put on top.
for spec in "tcp 80" "tcp 443" "udp 443"; do set -- $spec
  while iptables -D INPUT -p $1 --dport $2 -j ACCEPT 2>/dev/null; do :; done
  iptables -I INPUT 1 -p $1 --dport $2 -j ACCEPT
done
(command -v netfilter-persistent >/dev/null && netfilter-persistent save >/dev/null 2>&1) || true

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
# Check the settings first, then (re)start; a start that fails shows Caddy's own reason.
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy
if ! systemctl restart caddy; then journalctl -u caddy --no-pager -n 25; echo "Caddy did not start (reason above)." >&2; exit 1; fi

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
