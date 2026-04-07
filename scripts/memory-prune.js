#!/usr/bin/env node
/**
 * memory-prune.js — Runs INSIDE the OpenClaw container
 * Complete memory hygiene: SQLite flush + .md archival + cold/ retention
 * Uses node:sqlite (built-in Node 24, no external deps).
 *
 * Called by host cron every 6h:
 *   docker exec openclaw node /home/node/.openclaw/workspace/scripts/memory-prune.js
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

// === CONFIG ===
const SQLITE_DIR = '/home/node/.openclaw/memory';
const WORKSPACE_MEM = '/mnt/spike-storage/openclaw-live/workspace/memory';
const COLD_DIR = path.join(WORKSPACE_MEM, 'cold');
const SHARED_LOG = path.join(WORKSPACE_MEM, 'shared-log.md');
const LOG_PATH = '/tmp/memory-prune.log';

const SQLITE_MAX_KB = 500;         // Flush SQLite if larger than 500KB
const MD_MAX_AGE_H = 48;           // Archive session .md files older than 48h
const COLD_MAX_FILES = 50;         // Keep only 50 newest files in cold/
const MD_MAX_FILES = 25;           // Max .md files in memory/ before forced archive

// Files that should NEVER be archived or deleted
const PROTECTED_FILES = new Set([
  'MEMORY.md',
  'shared-log.md',
  'agent-roster.md',
  'task-queue.md',
  'improvement-queue.md',
]);

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch(e) {}
}

// === PHASE 1: SQLite Flush ===
function pruneSQLite() {
  log('Phase 1: SQLite prune');
  let files;
  try {
    files = fs.readdirSync(SQLITE_DIR).filter(f => f.endsWith('.sqlite'));
  } catch(e) {
    log(`SQLite dir not found: ${e.message}`);
    return [];
  }

  const results = [];
  for (const f of files) {
    const dbPath = path.join(SQLITE_DIR, f);
    const name = f.replace('.sqlite', '');
    try {
      const stats = fs.statSync(dbPath);
      const sizeKB = Math.round(stats.size / 1024);

      if (sizeKB <= SQLITE_MAX_KB) {
        results.push({ name, sizeKB, action: 'ok' });
        continue;
      }

      let chunks = 0;
      try {
        const db = new DatabaseSync(dbPath);
        const r = db.prepare('SELECT count(*) as c FROM chunks').get();
        chunks = r.c;
        db.close();
      } catch(e) {}

      fs.unlinkSync(dbPath);
      log(`  FLUSHED ${name}: ${sizeKB}KB (${chunks} chunks) → deleted`);
      results.push({ name, sizeKB, chunks, action: 'flushed' });
    } catch(e) {
      log(`  ERROR ${name}: ${e.message}`);
      results.push({ name, action: 'error', error: e.message });
    }
  }
  return results;
}

// === PHASE 2: Archive stale .md session files ===
function archiveStaleMd() {
  log('Phase 2: .md archive');
  let files;
  try {
    files = fs.readdirSync(WORKSPACE_MEM).filter(f => f.endsWith('.md'));
  } catch(e) {
    log(`Workspace memory dir error: ${e.message}`);
    return { archived: 0, kept: 0 };
  }

  // Ensure cold/ exists
  try { fs.mkdirSync(COLD_DIR, { recursive: true }); } catch(e) {}

  const now = Date.now();
  const maxAge = MD_MAX_AGE_H * 60 * 60 * 1000;
  let archived = 0;
  let kept = 0;

  // Sort by mtime (oldest first) for overflow handling
  const fileStats = files.map(f => {
    const full = path.join(WORKSPACE_MEM, f);
    try {
      const stat = fs.statSync(full);
      return { name: f, path: full, mtime: stat.mtimeMs, size: stat.size };
    } catch(e) {
      return null;
    }
  }).filter(Boolean);

  fileStats.sort((a, b) => a.mtime - b.mtime); // oldest first

  for (const file of fileStats) {
    if (PROTECTED_FILES.has(file.name)) {
      kept++;
      continue;
    }

    const age = now - file.mtime;
    const isSession = /^\d{4}-\d{2}-\d{2}/.test(file.name); // Date-prefixed = session file
    const isOld = age > maxAge;
    const overLimit = (fileStats.length - archived) > MD_MAX_FILES;

    if (isSession && (isOld || overLimit)) {
      try {
        const dest = path.join(COLD_DIR, file.name);
        fs.copyFileSync(file.path, dest);
        fs.unlinkSync(file.path);
        archived++;
        log(`  ARCHIVED ${file.name} (${Math.round(age/3600000)}h old, ${Math.round(file.size/1024)}KB)`);
      } catch(e) {
        log(`  ARCHIVE ERROR ${file.name}: ${e.message}`);
      }
    } else {
      kept++;
    }
  }

  log(`  .md result: ${archived} archived, ${kept} kept`);
  return { archived, kept };
}

// === PHASE 3: Cold storage retention ===
function pruneCold() {
  log('Phase 3: cold/ retention');
  let files;
  try {
    files = fs.readdirSync(COLD_DIR);
  } catch(e) {
    log(`Cold dir not found: ${e.message}`);
    return { deleted: 0, kept: 0 };
  }

  if (files.length <= COLD_MAX_FILES) {
    log(`  cold/ has ${files.length} files (limit ${COLD_MAX_FILES}), no action`);
    return { deleted: 0, kept: files.length };
  }

  // Sort by mtime, delete oldest
  const fileStats = files.map(f => {
    const full = path.join(COLD_DIR, f);
    try {
      return { name: f, path: full, mtime: fs.statSync(full).mtimeMs };
    } catch(e) {
      return null;
    }
  }).filter(Boolean);

  fileStats.sort((a, b) => a.mtime - b.mtime); // oldest first

  const toDelete = fileStats.length - COLD_MAX_FILES;
  let deleted = 0;

  for (let i = 0; i < toDelete; i++) {
    try {
      fs.unlinkSync(fileStats[i].path);
      deleted++;
    } catch(e) {
      log(`  DELETE ERROR ${fileStats[i].name}: ${e.message}`);
    }
  }

  log(`  cold/ result: ${deleted} deleted, ${fileStats.length - deleted} kept`);
  return { deleted, kept: fileStats.length - deleted };
}

// === PHASE 4: Shared log trim (prevent unbounded growth) ===
function trimSharedLog() {
  log('Phase 4: shared-log trim');
  try {
    const content = fs.readFileSync(SHARED_LOG, 'utf-8');
    const lines = content.split('\n');
    if (lines.length <= 200) {
      log(`  shared-log: ${lines.length} lines, ok`);
      return;
    }
    // Keep last 150 lines
    const trimmed = lines.slice(-150).join('\n');
    fs.writeFileSync(SHARED_LOG, trimmed);
    log(`  shared-log trimmed: ${lines.length} → 150 lines`);
  } catch(e) {
    log(`  shared-log error: ${e.message}`);
  }
}

// === MAIN ===
log('=== memory-prune starting (full) ===');

const sqliteResults = pruneSQLite();
const mdResults = archiveStaleMd();
const coldResults = pruneCold();
trimSharedLog();

const flushed = sqliteResults.filter(r => r.action === 'flushed');
const summary = [];
if (flushed.length > 0) summary.push(`sqlite: ${flushed.length} flushed`);
if (mdResults.archived > 0) summary.push(`md: ${mdResults.archived} archived`);
if (coldResults.deleted > 0) summary.push(`cold: ${coldResults.deleted} purged`);

log(`=== Done: ${summary.join(', ') || 'all clean'} ===`);

// Log to shared-log if any action taken
if (summary.length > 0) {
  const ts = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z/, ' UTC');
  const line = `\n[${ts}] [system] [done] memory-prune: ${summary.join(', ')}\n`;
  try { fs.appendFileSync(SHARED_LOG, line); } catch(e) {}
}
