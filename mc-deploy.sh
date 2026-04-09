#!/bin/bash
# mc-deploy — deploy dist/ files to mission-control staging

SRC="/home/node/.openclaw/workspace/dist"
DEST_MNT="/mnt/spike-storage/mission-control-staging"
DEST_WS="/home/node/.openclaw/workspace/mission-control"

echo "[mc-deploy] Starting..."

# Try host path first
if [ -d "$DEST_MNT" ]; then
    echo "[mc-deploy] Copying to $DEST_MNT"
    cp "$SRC/index.html" "$DEST_MNT/index.html"
    cp "$SRC/game.js" "$DEST_MNT/game.js"
    cp "$SRC/config.js" "$DEST_MNT/config.js"
    cp "$SRC/mc-index.html" "$DEST_MNT/mc-index.html"
    cp "$SRC/board.html" "$DEST_MNT/board.html"
    cp "$SRC/mission-control-live.json" "$DEST_MNT/mission-control-live.json"
    cp "$SRC/deployHistory.json" "$DEST_MNT/deployHistory.json"
    cp -r "$SRC/assets/" "$DEST_MNT/assets/"
    cp -r "$SRC/css/" "$DEST_MNT/css/"
    echo "[mc-deploy] Host staging deploy complete."
else
    echo "[mc-deploy] Host staging not accessible, using workspace fallback."
fi

# Always sync to workspace mission-control
echo "[mc-deploy] Syncing workspace mission-control/"
cp "$SRC/index.html" "$DEST_WS/index.html"
cp "$SRC/game.js" "$DEST_WS/game.js"
cp "$SRC/config.js" "$DEST_WS/config.js"
cp "$SRC/mc-index.html" "$DEST_WS/mc-index.html" 2>/dev/null || true
cp "$SRC/board.html" "$DEST_WS/board.html"
cp "$SRC/mission-control-live.json" "$DEST_WS/mission-control-live.json"
cp "$SRC/deployHistory.json" "$DEST_WS/deployHistory.json" 2>/dev/null || true
cp -r "$SRC/assets/" "$DEST_WS/assets/"
cp -r "$SRC/css/" "$DEST_WS/css/"
echo "[mc-deploy] Workspace sync complete."

# Sync staging scripts into the container so the cron always runs the latest version
echo "[mc-deploy] Syncing scripts into container..."
docker exec openclaw cp /mnt/spike-storage/mission-control-staging/scripts/sync-live-json.js /home/node/.openclaw/workspace/scripts/sync-live-json.js 2>/dev/null && echo "[mc-deploy] sync-live-json.js synced to container" || echo "[mc-deploy] container sync skipped (docker not available from this path)"

echo "[mc-deploy] Done."
