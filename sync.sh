#!/bin/sh
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'docker' \
  --exclude 'build' \
  --exclude 'resources/js/modules' \
  --exclude 'rollup.config.js' \
  --exclude 'package.json' \
  --exclude 'package-lock.json' \
  --exclude 'CLAUDE.md' \
  --exclude 'sync.sh' \
  ./ root@bocken.org:/usr/share/webapps/webtrees/modules_v4/full-diagram/
