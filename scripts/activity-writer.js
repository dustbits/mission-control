#!/usr/bin/env node
/**
 * Lightweight HTTP endpoint for real-time MC activity writes.
 * game.js POSTs here when gateway events fire.
 * Replaces shared-log polling for the activity feed in mission-control-live.json.
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

function loadJson() {
  try {
    const raw = fs.readFileSync(LIVE_JSON_SRC, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { activity: [] };
  }
}

function writeJson(json) {
  try {
    fs.writeFileSync(LIVE_JSON_SRC, JSON.stringify(json, null, 2), 'utf8');
    // Mirror to staging so nginx serves it immediately
    fs.writeFileSync(LIVE_JSON_DST, JSON.stringify(json, null, 2), 'utf8');
  } catch (e) {
    console.error('[activity-writer] write error:', e.message);
  }
}

function flushBuffer() {
  if (activityBuffer.length === 0) return;
  const data = loadJson();
  // Prepend new entries (newest first, matching state.activity.unshift)
  for (const entry of activityBuffer) {
    data.activity.unshift({
      id: (data.activity.length || 0) + 1,
      agent: entry.agent || 'Spike',
      line: entry.text || '',
      time: 'just now',
      color: entry.color || '#4a9eff',
    });
  }
  data.activity = data.activity.slice(0, 30);
  writeJson(data);
  console.log(`[activity-writer] flushed ${activityBuffer.length} entries (total activity: ${data.activity.length})`);
  activityBuffer = [];
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
