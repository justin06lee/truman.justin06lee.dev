#!/usr/bin/env bash
#
# Ship the site. Run on the box whenever master moves — with the site living
# here, this box is the deploy target, not a mirror of one.
#
#   ./site-update.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only
npm install
npm run build
sudo systemctl restart truman-site
echo "deployed $(git rev-parse --short HEAD)"
