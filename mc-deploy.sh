#!/bin/bash
# mc-deploy.sh v2 — Deploy Mission Control staging → nginx
# Pre-deploy validation + git-enriched deploy history + Discord deploy feed
set -euo pipefail

PW=$(gcloud secrets versions access latest --secret=ZORO_SUDO_PASSWORD --project=gen-lang-client-0412397372)
STAGING="/mnt/spike-storage/mission-control-staging"
LIVE="/usr/share/nginx/mission-control"
DEPLOY_HISTORY="$STAGING/deployHistory.json"
# Resolve agent: explicit env var overrides; else git commit author; else "manual"
AGENT="${MC_DEPLOY_AGENT:-$(git -C "$STAGING" log -1 --format='%an' 2>/dev/null || echo 'manual')}"
DEPLOY_START=$(date +%s)
DISCORD_DEPLOY_WEBHOOK_URL=$(gcloud secrets versions access latest --secret=mc-deploy-feed-webhook --project=gen-lang-client-0412397372 2>/dev/null || echo "")

# === PRE-DEPLOY VALIDATION ===
echo "[validate] Checking staging files..."

if [ ! -s "$STAGING/board.html" ]; then
  echo "[FAIL] board.html missing or empty in staging"
  exit 1
fi

if ! grep -q "renderColumn\|board-container\|kanban" "$STAGING/board.html" 2>/dev/null; then
  echo "[FAIL] board.html missing expected DOM elements"
  exit 1
fi

if [ ! -s "$STAGING/game.js" ]; then
  echo "[FAIL] game.js missing or empty in staging"
  exit 1
fi

if [ ! -s "$STAGING/index.html" ]; then
  echo "[FAIL] index.html missing or empty in staging"
  exit 1
fi

echo "[validate] All checks passed"

# === DEPLOY ===
echo "$PW" | sudo -S cp "$STAGING/index.html" "$STAGING/game.js" "$STAGING/config.js" "$STAGING/board.html" "$LIVE/" 2>/dev/null
[ -f "$STAGING/manifest.json" ] && echo "$PW" | sudo -S cp "$STAGING/manifest.json" "$LIVE/" 2>/dev/null
[ -f "$STAGING/sw.js" ] && echo "$PW" | sudo -S cp "$STAGING/sw.js" "$LIVE/" 2>/dev/null

echo "$PW" | sudo -S mkdir -p "$LIVE/assets" "$LIVE/scripts"
echo "$PW" | sudo -S rsync -a "$STAGING/scripts/" "$LIVE/scripts/" 2>/dev/null
[ -f "$STAGING/cost-data.json" ] && echo "$PW" | sudo -S cp "$STAGING/cost-data.json" "$LIVE/" 2>/dev/null

# Copy live data files directly (nginx serves them directly, not via symlink)
# NOTE: deployHistory.json is copied BEFORE mission-control-live.json so that
# sync-live-json.js reads the authoritative deploy state when it regenerates the live JSON.
echo "$PW" | sudo cp --remove-destination "$STAGING/deployHistory.json" "$LIVE/deployHistory.json" 2>/dev/null || true
[ -f "$STAGING/cron-error-history.json" ] && echo "$PW" | sudo cp --remove-destination "$STAGING/cron-error-history.json" "$LIVE/cron-error-history.json" 2>/dev/null || true

# Run sync inside openclaw container so it regenerates mission-control-live.json
# with correct deploy state read from deployHistory.json (not index.html mtime)
docker exec openclaw node /mnt/spike-storage/mission-control-staging/scripts/sync-live-json.js >/dev/null 2>&1 || true

# Now copy the freshly-generated mission-control-live.json to nginx
echo "$PW" | sudo cp --remove-destination "$STAGING/mission-control-live.json" "$LIVE/mission-control-live.json" 2>/dev/null || true
echo "$PW" | sudo -S rsync -a --delete "$STAGING/assets/" "$LIVE/assets/" 2>/dev/null || \
  echo "$PW" | sudo -S cp -rf "$STAGING/assets/"* "$LIVE/assets/" 2>/dev/null

# === POST-DEPLOY SMOKE TEST ===
echo "[mc-deploy] Post-deploy verification..."
VERIFY_FAILED=0
for URL in \
  "http://jarvis:8090/board.html" \
  "http://jarvis:8090/mission-control-live.json" \
  "http://jarvis:8090/deployHistory.json"; do
  if ! curl -sf -o /dev/null --max-time 5 "$URL"; then
    echo "[mc-deploy] FAIL — $URL"
    VERIFY_FAILED=1
  else
    echo "[mc-deploy] OK — $URL"
  fi
done
if [ $VERIFY_FAILED -ne 0 ]; then
  echo "[mc-deploy] WARNING — one or more endpoints failed"
fi

# === GIT-ENRICHED DEPLOY HISTORY ===
cd "$STAGING"
COMMIT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
COMMIT_SHA7=$(echo "$COMMIT_SHA" | cut -c1-7)
COMMIT_MSG=$(git log -1 --format="%s" 2>/dev/null || echo "no message")
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
CHANGED_FILES=$(git diff --name-only HEAD~1 HEAD 2>/dev/null | tr '\n' ',' | sed 's/,$//' || echo "")
DEPLOY_END=$(date +%s)
DURATION_S=$((DEPLOY_END - DEPLOY_START))
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

# Build JSON entry and write via helper
ENTRY=$(python3 -c "
import json, sys
print(json.dumps({
    'timestamp': sys.argv[1],
    'status': 'deployed',
    'trigger': sys.argv[2],
    'sha': sys.argv[3],
    'shaFull': sys.argv[4],
    'message': sys.argv[5],
    'branch': sys.argv[6],
    'changedFiles': sys.argv[7],
    'durationSec': int(sys.argv[8])
}))
" "$TIMESTAMP" "$AGENT" "$COMMIT_SHA7" "$COMMIT_SHA" "$COMMIT_MSG" "$BRANCH" "$CHANGED_FILES" "$DURATION_S")

python3 /home/zoro/bin/deploy-history-writer.py "$DEPLOY_HISTORY" "$ENTRY"

# CRITICAL: re-copy deployHistory to nginx AFTER sync ran and git-enriched entry was written.
# sync-live-json.js no longer writes deployHistory (mc-deploy.sh is the authoritative source).
echo "$PW" | sudo cp --remove-destination "$STAGING/deployHistory.json" "$LIVE/deployHistory.json" 2>/dev/null || true

echo "Mission Control deployed | $BRANCH @ $COMMIT_SHA7 — $COMMIT_MSG | agent=$AGENT | ${DURATION_S}s | files=$CHANGED_FILES"

# === DEPLOY FEED — post to #furnace ===
if [ -n "$DISCORD_DEPLOY_WEBHOOK_URL" ]; then
  python3 -c "
import json, subprocess, sys
sha7, msg, branch, agent, files, dur = sys.argv[1:]
wh_url = subprocess.check_output(['gcloud','secrets','versions','access','latest','--secret=mc-deploy-feed-webhook','--project=gen-lang-client-0412397372']).decode().strip()
content = '**MC Deployed** ' + chr(96) + sha7 + chr(96) + ' — ' + msg
if files:
    content += chr(10) + 'Files: ' + chr(96) + files + chr(96)
content += chr(10) + 'Branch: ' + chr(96) + branch + chr(96) + ' · Agent: ' + chr(96) + agent + chr(96) + ' · ' + dur + 's'
payload = json.dumps({'content': content})
r = subprocess.run(['curl','-sf','-X','POST','-H','Content-Type: application/json','-d',payload,wh_url], capture_output=True, text=True)
if r.returncode != 0:
    sys.stderr.write(r.stderr[:200])
" "$COMMIT_SHA7" "$COMMIT_MSG" "$BRANCH" "$AGENT" "$CHANGED_FILES" "$DURATION_S" || \
    echo "[mc-deploy] WARNING — deploy feed webhook failed"
fi

exit 0
