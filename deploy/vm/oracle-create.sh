#!/usr/bin/env bash
# Creates the free Brightolio server on Oracle Cloud from Cloud Shell (the >_ button at the top of
# the Oracle console), and keeps retrying while Oracle says "Out of capacity" — free ARM machines
# free up through the day. Run:
#   curl -fsSL https://raw.githubusercontent.com/aryebleich/Tradingapp/main/deploy/vm/oracle-create.sh -o create.sh && bash create.sh
# It sets up the network (if there is none): a public subnet with SSH, HTTP and HTTPS open, then
# tries every availability domain, first 2 CPUs / 12 GB, then 1 CPU / 6 GB (both Always Free),
# every 60 seconds until one works. The server then installs Brightolio by itself (setup.sh).
# The SSH key stays in this Cloud Shell (~/.ssh/brightfolio); nothing here costs money.
set -uo pipefail
C="${OCI_TENANCY:?Run this in Oracle Cloud Shell}"
REPO="aryebleich/Tradingapp"
say() { printf '\n== %s\n' "$*"; }
q() { oci "$@" 2>/dev/null; }

say "Region: ${OCI_REGION:-?}"
if [ -n "$(q compute instance list --compartment-id "$C" --lifecycle-state RUNNING --display-name brightfolio --query 'data[0].id' --raw-output)" ]; then
  echo "A server named brightfolio is already running. Nothing to do."; exit 0
fi

say "SSH key"
[ -f ~/.ssh/brightfolio ] || { mkdir -p ~/.ssh && ssh-keygen -q -t ed25519 -N '' -f ~/.ssh/brightfolio && echo "Made ~/.ssh/brightfolio (keep it; it opens your server)"; }

say "Network"
SUBNET=$(q network subnet list --compartment-id "$C" --query "data[?\"prohibit-public-ip-on-vnic\"==\`false\`] | [0].id" --raw-output)
if [ -z "$SUBNET" ] || [ "$SUBNET" = "null" ]; then
  VCN=$(oci network vcn create --compartment-id "$C" --cidr-block 10.0.0.0/16 --display-name brightfolio-vcn --dns-label brightfolio --wait-for-state AVAILABLE --query data.id --raw-output)
  IGW=$(oci network internet-gateway create --compartment-id "$C" --vcn-id "$VCN" --is-enabled true --display-name brightfolio-igw --wait-for-state AVAILABLE --query data.id --raw-output)
  RT=$(oci network vcn get --vcn-id "$VCN" --query 'data."default-route-table-id"' --raw-output)
  oci network route-table update --rt-id "$RT" --force --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IGW\"}]" >/dev/null
  SUBNET=$(oci network subnet create --compartment-id "$C" --vcn-id "$VCN" --cidr-block 10.0.0.0/24 --display-name brightfolio-subnet --dns-label web --wait-for-state AVAILABLE --query data.id --raw-output)
  echo "Created a network with internet access"
else
  echo "Using the existing public subnet"
fi
# Open SSH (22), HTTP (80) and HTTPS (443) on the subnet's security lists.
RULES='[{"protocol":"6","source":"0.0.0.0/0","tcpOptions":{"destinationPortRange":{"min":22,"max":22}}},{"protocol":"6","source":"0.0.0.0/0","tcpOptions":{"destinationPortRange":{"min":80,"max":80}}},{"protocol":"6","source":"0.0.0.0/0","tcpOptions":{"destinationPortRange":{"min":443,"max":443}}},{"protocol":"17","source":"0.0.0.0/0","udpOptions":{"destinationPortRange":{"min":443,"max":443}}},{"protocol":"1","source":"0.0.0.0/0","icmpOptions":{"type":3,"code":4}}]'
for SL in $(oci network subnet get --subnet-id "$SUBNET" --query 'data."security-list-ids"[]' --raw-output | tr -d '[]",'); do
  oci network security-list update --security-list-id "$SL" --force --ingress-security-rules "$RULES" >/dev/null && echo "Opened ports 22, 80 and 443"
done

say "Ubuntu 24.04 for ARM"
IMG=$(oci compute image list --compartment-id "$C" --operating-system "Canonical Ubuntu" --operating-system-version "24.04" --shape VM.Standard.A1.Flex --sort-by TIMECREATED --sort-order DESC --query 'data[?!contains("display-name", `Minimal`)] | [0].id' --raw-output)
[ -n "$IMG" ] && [ "$IMG" != "null" ] || { echo "No Ubuntu 24.04 ARM image found in this region."; exit 1; }

cat > ~/brightfolio-init.sh <<EOF
#!/bin/bash
IP=\$(curl -4s https://ifconfig.me)
curl -fsSL https://raw.githubusercontent.com/$REPO/main/deploy/vm/setup.sh | bash -s -- "\$(echo \$IP | tr . -).sslip.io" $REPO
EOF

ADS=$(oci iam availability-domain list --compartment-id "$C" --query 'data[].name' --raw-output | tr -d '[]",')
say "Asking for a free ARM server (retrying every 60 seconds while Oracle is out of capacity; keep this tab open)"
n=0
while true; do
  n=$((n+1))
  for SIZE in '{"ocpus":2,"memoryInGBs":12}' '{"ocpus":1,"memoryInGBs":6}'; do
    for AD in $ADS; do
      OUT=$(oci compute instance launch --compartment-id "$C" --availability-domain "$AD" --display-name brightfolio \
        --shape VM.Standard.A1.Flex --shape-config "$SIZE" --image-id "$IMG" --subnet-id "$SUBNET" --assign-public-ip true \
        --ssh-authorized-keys-file ~/.ssh/brightfolio.pub --user-data-file ~/brightfolio-init.sh --wait-for-state RUNNING 2>&1)
      if echo "$OUT" | grep -q '"lifecycle-state": "RUNNING"'; then
        ID=$(echo "$OUT" | grep -m1 '"id": "ocid1.instance' | sed 's/.*"\(ocid1[^"]*\)".*/\1/')
        IP=$(oci compute instance list-vnics --instance-id "$ID" --query 'data[0]."public-ip"' --raw-output)
        say "Your server is running: $SIZE in $AD"
        echo "Public IP: $IP"
        echo "In about 10 minutes: https://$(echo "$IP" | tr . -).sslip.io/healthz"
        echo "Connect later from this Cloud Shell with:  ssh -i ~/.ssh/brightfolio ubuntu@$IP"
        exit 0
      fi
      if echo "$OUT" | grep -qiE 'out of (host )?capacity|InternalError|TooManyRequests'; then
        echo "$(date +%H:%M:%S) try $n: no free capacity in ${AD##*:} for $SIZE"
      else
        echo "Oracle refused for another reason:"; echo "$OUT" | grep -iE '"message"|code' | head -5; exit 1
      fi
      sleep 5
    done
  done
  sleep 60
done
