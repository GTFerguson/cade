#!/usr/bin/env bash
# One-time setup: enable passwordless sudo for the deploy user on a remote host.
#
# Run this manually in your terminal (you'll need to type the sudo password once):
#   bash scripts/setup-sudo.sh <host>
#
# After this, deploy.sh can run fully unattended.

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: bash scripts/setup-sudo.sh <ssh-host>"
  exit 1
fi

HOST="$1"

echo "Setting up passwordless sudo on ${HOST}..."
echo "You'll be prompted for the sudo password once."
echo ""

ssh -t "$HOST" 'sudo bash -c "echo \"$(whoami) ALL=(ALL) NOPASSWD:ALL\" > /etc/sudoers.d/90-deploy && chmod 440 /etc/sudoers.d/90-deploy && echo \"Done! Passwordless sudo enabled for $(whoami).\""'

echo ""
echo "✓ You can now run: ./scripts/deploy.sh ${HOST}"
