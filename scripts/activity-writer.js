#!/usr/bin/env node
/**
 * Lightweight HTTP endpoint for real-time MC activity writes.
 * Receives POST /activity from openclaw gateway when events fire.
 * Writes to mission-control-live.json — uses atomic merge to avoid
 * write-write races with sync-live-json.js.
 *
 * Usage: node activity-writer.js [port]
 * Default port: 8091
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT          = parseInt(process.argv[2]) || 8091;
const LIVE_JSON_SRC = path.join(__dirname, '../mission-control-live.json');
const LIVE_JSON_DST = '/mnt/spike-storage/mission-control-staging/mission-control-live.json';
const FLUSH_MS      = 8000; // debounce interval

let activityBuffer = [];
let flushTimer     = null;
let flushing       = false; // prevent concurrent flushes

function relativeTime(isoStr) {
  const now  = Date.now();
  const then = new Date(isoStr).getTime();
  if (isNaN(then)) return 'now';
  const diffMin = Math.floor((now - then) / 60000);
  if (diffMin < 2)  return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24)   return `${diffH}h`;
  return `${Math.floor(diffH / 24)}d`;
}

function loadJson() {
  try {
    const raw = fs.readFileSync(LIVE_JSON_SRC, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { activity: [] };
  }
}

/**
 * Atomic write: write to temp file, then rename. Prevents partial writes
 * from being read by sync-live-json.js mid-flush.
 */
function atomicWrite(filePath, json) {
  const tmp = filePath + '.tmp.' + process.pid + '.' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(json, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function writeJson(json) {
  try {
    atomicWrite(LIVE_JSON_SRC, json);
    // Mirror to staging so nginx serves it immediately
    atomicWrite(LIVE_JSON_DST, json);
  } catch (e) {
    console.error('[activity-writer] write error:', e.message);
  }
}

function flushBuffer() {
  if (activityBuffer.length === 0 || flushing) return;
  flushing = true;

  try {
    const data     = loadJson();
    const now      = new Date().toISOString();
    const newItems = [];

    // Prepend new entries with real ISO timestamp + computed relative time
    for (const entry of activityBuffer) {
      newItems.push({
        id:    (data.activity.length || 0) + 1,
        agent: entry.agent || 'Spike',
        line:  entry.text || '',
        time:  relativeTime(now),   // computed at flush time, not hardcoded 'just now'
        _iso:  now,                // stored ISO for next flush to use as baseline
        color: entry.color || '#4a9eff',
      });
    }

    // Merge: prepend newItems BEFORE existing data.activity.
    // This preserves sync-live-json entries and avoids overwriting them.
    data.activity = [...newItems, ...data.activity].slice(0, 30);

    // Rebuild relativeTime for all entries using stored _iso
    if (data.activity.length > 0) {
      data.activity = data.activity.map(item => ({
        ...item,
        time: item._iso ? relativeTime(item._iso) : item.time,
      }));
    }

    writeJson(data);
    console.log(`[activity-writer] flushed ${activityBuffer.length} entries (total: ${data.activity.length})`);
  } finally {
    activityBuffer = [];
    flushing       = false;
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/activity') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const entry = JSON.parse(body);
        activityBuffer.push(entry);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, buffered: activityBuffer.length }));

        // Debounced flush
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = setTimeout(flushBuffer, FLUSH_MS);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', buffered: activityBuffer.length }));
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`[activity-writer] listening on :${PORT}`);
  // Initial flush of any stale buffer on start
  flushBuffer();
});

// Graceful shutdown
process.on('SIGINT', () => { flushBuffer(); server.close(); });
process.on('SIGTERM', () => { flushBuffer(); server.close(); });
