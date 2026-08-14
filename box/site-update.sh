#!/usr/bin/env bash
#
# Ship the site. Run on the box whenever master moves — with the site living
# here, this box is the deploy target, not a mirror of one.
#
#   ./site-update.sh
#
# bun, not npm: npm install ignores bun.lock and re-resolves every dependency
# fresh, so each deploy would build a dependency tree nobody ever tested.
# --frozen-lockfile makes the box build exactly what the lockfile says or
# refuse loudly, never something in between.
#
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only
bun install --frozen-lockfile
bun run build
sudo systemctl restart truman-site
echo "deployed $(git rev-parse --short HEAD)"
