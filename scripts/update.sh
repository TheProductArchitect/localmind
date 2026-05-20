#!/bin/bash
# Pulls the latest LocalMind release, installs deps, runs migrations, and restarts via PM2.
set -e
APP_DIR="$HOME/LocalMind"
cd "$APP_DIR"
echo "Updating LocalMind..."
git pull --ff-only 2>/dev/null || echo "Not a git checkout — skipping pull."
npm install
npm run build
pm2 restart localmind
echo "Update complete. Database migrations run automatically on startup."
