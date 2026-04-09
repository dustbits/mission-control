#!/usr/bin/env node
/**
 * sync-live-json.js
 * Reads shared-log.md, extracts recent activity, writes mission-control-live.json
 * to both workspace and staging.
 *
 * Data sources:
 *  - /home/node/.openclaw/cron/jobs.json (real cron state)
 *  - SHARED_LOG (activity, board, errors)
 *  - deploy staging mtime + deployHistory.json
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const WORKSPACE = '/mnt/spike-storage/openclaw-live/workspace';
const SHARED_LOG = `${WORKSPACE}/memory/shared-log.md`;
const OUT_WORKSPACE = `${WORKSPACE}/mission-control/mission-control-live.json`;
const OUT_STAGING  = '/mnt/spike-storage/mission-control-staging/mission-control-live.json';
const CRON_JOBS_PATH = '/home/node/.openclaw/cron/jobs.json';
const DEPLOY_HISTORY_PATH   = `${WORKSPACE}/mission-control/deployHistory.json`;
const CRON_ERROR_HISTORY_PATH = `${WORKSPACE}/mission-control/cron-error-history.json`;

const AGENT_COLORS = {
  spike:    '#4a9eff',
  main:     '#4a9eff',
  jet:      '#f59e0b',
  ops:      '#f59e0b',
  faye:     '#a855f7',
  research: '#a855f7',
  'faye-scan': '#a855f7',
  ein:      '#f97316',
  finance:  '#f97316',
  gren:     '#7c3aed',
  ironthread: '#7c3aed',
  ed:       '#22c55e',
  code:     '#22c55e',
  julia:    '#ec4899',
  media:    '#ec4899',
  rocco:    '#64748b',
  local:    '#64748b',
  punch:    '#ef4444',
  claude:   '#64d8ff',
  'claude-code': '#64d8ff',
  dispatch: '#38bdf8',
  system:   '#38bdf8',
  andy:     '#38bdf8',
  andrew:   '#38bdf8',
  'ed-builder-loop': '#22c55e',
};

const AGENT_MODELS = {
  spike: 'MiniMax/M2.7-highspeed',
  jet: 'MiniMax/M2.7',
  faye: 'Qwen/Qwen2.5-7B',
  ein: 'MiniMax/M2.7',
  gren: 'MiniMax/M2.7',
  ed: 'openai/gpt-4o',
  julia: 'Qwen/Qwen2.5-7B',
  rocco: 'MiniMax/M2.7',
  punch: 'claude-sonnet-4',
  andy: 'claude-sonnet-4',
  andrew: 'claude-sonnet-4',
  main: 'MiniMax/M2.7',
};

const AGENT_DISPLAY = {
  spike: 'Spike', main: 'Spike',
  jet: 'Jet', ops: 'Jet',
  faye: 'Faye', research: 'Faye', 'faye-scan': 'Faye',
  ein: 'Ein', finance: 'Ein',
  gren: 'Gren', ironthread: 'Gren',
  ed: 'Ed', code: 'Ed',
  julia: 'Julia', media: 'Julia',
  rocco: 'Rocco', local: 'Rocco',
  punch: 'Punch',
  claude: 'Claude', 'claude-code': 'Claude',
  dispatch: 'System',
  system: 'System',
  andy: 'Andy', andrew: 'Andy',
  'ed-builder-loop': 'Ed',
};

function relativeTime(isoStr) {
  // Normalize common variations: "2026-04-09 04:38:00 UTC" → "2026-04-09T04:38:00Z"
  const normalized = isoStr.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) UTC$/, '$1T$2:00Z');
  const now = Date.now();
  const then = new Date(normalized).getTime();
  if (isNaN(then)) return 'earlier';
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 2)  return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24)   return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d`;
}

function parseLog(content) {
  const lines = content.split('\n').filter(l => l.trim());
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;

  const entries = [];
  for (const line of lines) {
    // Format A: [YYYY-MM-DD HH:MM UTC] [agent] [tag] message
    let m = line.match(/^\[(\d{4}-\d{2}-\d{2})(?:[T ])(\d{2}:\d{2}(?::\d{2})?)(?:Z|[ ]UTC|[ ]ET|[ ]EST|[ ]EDT)?\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)/);
    // Format B: [YYYY-MM-DD HH:MM UTC] agent [tag] message (agent without brackets)
    if (!m) m = line.match(/^\[(\d{4}-\d{2}-\d{2})(?:[T ])(\d{2}:\d{2}(?::\d{2})?)(?:Z|[ ]UTC|[ ]ET|[ ]EST|[ ]EDT)?\]\s+(\S+)\s+\[([^\]]+)\]\s+(.*)/);
    if (!m) continue;

    const [, date, time, agent, tag, message] = m;
    const secs = time.split(':').length === 2 ? ':00' : '';
    const iso = date + 'T' + time + secs + 'Z';
    const ts = new Date(iso).getTime();
    if (isNaN(ts) || ts < cutoff) continue;

    const tagLower = tag.toLowerCase();
    if (!tagLower.startsWith('done') && !tagLower.startsWith('needs') && !tagLower.startsWith('partial') && !tagLower.startsWith('acknowledged') && !tagLower.startsWith('alert') && !tagLower.startsWith('failed') && !tagLower.startsWith('error')) continue;

    entries.push({ iso, ts, agent: agent.toLowerCase(), tag, message });
  }

  entries.sort((a, b) => b.ts - a.ts);
  return entries;
}

// --- NEW: Extract errors/alerts from shared log ---
function extractErrors(logContent) {
  const lines = logContent.split('\n').filter(l => l.trim());
  const cutoff = Date.now() - 72 * 60 * 60 * 1000; // 72 hours
  const errors = [];

  for (const line of lines) {
    const upper = line.toUpperCase();
    const isError = upper.includes('[ERROR]') || upper.includes('[ALERT]') || upper.includes('[FAILED]');
    if (!isError) continue;

    const m = line.match(/^\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+UTC)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)/);
    if (m) {
      const [, rawTime, agent, tag, message] = m;
      const iso = rawTime.replace(' UTC', 'Z').replace(/\s+/, 'T').replace(/T(\d)/, 'T0$1').replace(/(\d{2}:\d{2})Z$/, '$1:00Z');
      const ts = new Date(iso).getTime();
      if (!isNaN(ts) && ts >= cutoff) {
        errors.push({
          time: relativeTime(iso),
          agent: AGENT_DISPLAY[agent.toLowerCase()] ?? agent,
          message: message.slice(0, 150),
          color: '#ef4444',
        });
      }
    }
  }

  return errors.slice(0, 10);
}

// --- Persistent cron error history for sparklines ---
function getCronErrorHistory() {
  try {
    if (existsSync(CRON_ERROR_HISTORY_PATH)) {
      return JSON.parse(readFileSync(CRON_ERROR_HISTORY_PATH, 'utf8'));
    }
  } catch {}
  return {};
}

function saveCronErrorHistory(history) {
  try {
    writeFileSync(CRON_ERROR_HISTORY_PATH, JSON.stringify(history, null, 2), 'utf8');
  } catch (e) {
    console.warn('Could not save cron error history:', e.message);
  }
}

function updateCronErrorHistory(cronJobs) {
  const history = getCronErrorHistory();
  const now = Date.now();
  cronJobs.forEach(job => {
    const id = job.id;
    if (!history[id]) {
      history[id] = { samples: [] };
    }
    const h = history[id];
    // Append current error count as a sample (max 20 samples = last 20 syncs)
    h.samples.push({ t: now, e: job.errors || 0 });
    if (h.samples.length > 20) h.samples = h.samples.slice(-20);
  });
  // Prune jobs that no longer exist
  const activeIds = new Set(cronJobs.map(j => j.id));
  Object.keys(history).forEach(id => { if (!activeIds.has(id)) delete history[id]; });
  saveCronErrorHistory(history);
  return history;
}

// --- NEW: Real cron health from jobs.json ---
function getCronHealthData() {
  try {
    const raw = readFileSync(CRON_JOBS_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (!data.jobs) return [];

    return data.jobs.map(job => {
      const state = job.state || {};
      const hasErrors = (state.consecutiveErrors || 0) > 0;
      const lastStatus = state.lastRunStatus || 'unknown';
      const enabled = job.enabled !== false;

      let health = 'ok';
      if (!enabled) health = 'paused';
      else if (hasErrors) health = 'error';
      else if (lastStatus === 'ok') health = 'ok';
      else if (lastStatus === 'error' || lastStatus === 'failed') health = 'error';
      else health = 'unknown';

      const nextRun = state.nextRunAtMs ? new Date(state.nextRunAtMs).toISOString() : null;
      const lastRun = state.lastRunAtMs ? new Date(state.lastRunAtMs).toISOString() : null;

      return {
        id: job.id,
        label: job.name || job.id,
        schedule: job.schedule?.expr || job.schedule?.everyMs || 'event-driven',
        next: nextRun ? relativeTime(nextRun) : 'scheduled',
        lastRun: lastRun ? relativeTime(lastRun) : 'never',
        state: health,
        errors: state.consecutiveErrors || 0,
        enabled,
      };
    });
  } catch (e) {
    console.warn('Cron health read error:', e.message);
    return [];
  }
}

// --- NEW: Build deploy history ---
function getDeployInfo() {
  const stagingPath = '/mnt/spike-storage/mission-control-staging';
  const workspacePath = '/home/node/.openclaw/workspace';
  const DEPLOY_HISTORY = `${stagingPath}/deployHistory.json`;
  let info = { state: 'idle' };

  // Primary: read deploy state from deployHistory.json (written by mc-deploy.sh)
  try {
    if (existsSync(DEPLOY_HISTORY)) {
      const history = JSON.parse(readFileSync(DEPLOY_HISTORY, 'utf8'));
      if (Array.isArray(history) && history.length > 0) {
        const latest = history[0];
        if (latest.status === 'deployed' && latest.timestamp) {
          info = { state: 'deployed', timestamp: latest.timestamp };
        }
      }
    }
  } catch (e) {
    console.warn('deployHistory read error:', e.message);
  }

  // Fallback: use index.html mtime if deployHistory doesn't exist or has no entry
  if (info.state === 'idle') {
    try {
      const mtime = execSync(`find ${stagingPath}/index.html -type f 2>/dev/null | head -1 | xargs stat -c %Y 2>/dev/null`, { timeout: 3000 }).toString().trim();
      if (mtime) {
        const ts = parseInt(mtime) * 1000;
        info = { state: 'deployed', timestamp: new Date(ts).toISOString() };
      }
    } catch {}
  }

  // Capture git info from workspace
  try {
    const gitBranch = execSync(`cd ${workspacePath} && git rev-parse --abbrev-ref HEAD 2>/dev/null`, { timeout: 3000 }).toString().trim();
    const gitSha = execSync(`cd ${workspacePath} && git rev-parse HEAD 2>/dev/null`, { timeout: 3000 }).toString().trim();
    const gitMsg = execSync(`cd ${workspacePath} && git log -1 --format=%s 2>/dev/null`, { timeout: 3000 }).toString().trim();
    if (gitBranch) info.branch = gitBranch;
    if (gitSha) info.commit = gitSha.slice(0, 7);
    if (gitMsg) info.message = gitMsg;
  } catch {}
  return info;
}

function updateDeployHistory(deployTimestamp, gitInfo = {}) {
  let history = [];
  if (existsSync(DEPLOY_HISTORY_PATH)) {
    try {
      history = JSON.parse(readFileSync(DEPLOY_HISTORY_PATH, 'utf8'));
    } catch {}
  }

  // Only add if this deploy is new (not the latest entry)
  if (deployTimestamp && history.length > 0 && history[0]?.timestamp === deployTimestamp) {
    return history.slice(0, 10);
  }

  const entry = {
    timestamp: deployTimestamp || new Date().toISOString(),
    status: 'deployed',
    trigger: 'manual',
    branch: gitInfo.branch || null,
    commit: gitInfo.commit || null,
    message: gitInfo.message || null,
  };

  history.unshift(entry);

  // Compute duration (time since previous deploy) for each entry
  for (let i = 0; i < history.length; i++) {
    if (i === 0) {
      history[i].duration = null; // most recent — no "since previous"
    } else {
      const prev = new Date(history[i - 1].timestamp).getTime();
      const curr = new Date(history[i].timestamp).getTime();
      const diffMs = prev - curr;
      const diffMins = Math.round(diffMs / 60000);
      if (diffMins < 1) history[i].duration = '<1m';
      else if (diffMins < 60) history[i].duration = diffMins + 'm';
      else {
        const h = Math.floor(diffMins / 60);
        const m = diffMins % 60;
        history[i].duration = m > 0 ? h + 'h ' + m + 'm' : h + 'h';
      }
    }
  }

  return history.slice(0, 10);
}

function buildBoardData(entries) {
  const queued = [];
  const inprogress = [];
  const done = [];

  for (const e of entries) {
    const msg = e.message;
    const item = {
      id: e.ts,
      text: msg.slice(0, 100),
      agent: AGENT_DISPLAY[e.agent] ?? e.agent,
      ts: relativeTime(e.iso),
    };

    const tagLower = e.tag.toLowerCase();
    if (tagLower.startsWith('done')) {
      done.push(item);
    } else if (tagLower.startsWith('acknowledged')) {
      inprogress.push(item);
    } else if (tagLower.startsWith('needs')) {
      queued.push(item);
    }
  }

  return { queued, inprogress, done };
}

// --- Detect live agent state from recent log entries ---
function detectAgentState(allEntries, agentKey) {
  const now = Date.now();
  const CUTOFF_MS = 2 * 60 * 1000; // 2 minutes
  const recent = allEntries.filter(e => {
    if (e.agent !== agentKey) return false;
    if (!e.iso) return false;
    return (now - new Date(e.iso).getTime()) < CUTOFF_MS;
  });

  // Check for blocked/error first (highest priority)
  const hasBlock = recent.some(e => {
    const tag = (e.tag || '').toLowerCase();
    return tag.includes('blocked') || tag.includes('error');
  });
  if (hasBlock) return { state: 'blocked', stateSince: null };

  // Check for in-progress work
  const hasWorking = recent.some(e => {
    const tag = (e.tag || '').toLowerCase();
    return tag.startsWith('acknowledged') || tag.startsWith('taken') || tag.startsWith('partial');
  });
  if (hasWorking) return { state: 'working', stateSince: null };

  return { state: 'idle', stateSince: null };
}

// --- Build per-agent efficiency leaderboard ---
function buildLeaderboard(logContent) {
  const lines = logContent.split('\n').filter(l => l.trim());
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;

  // Parse all entries for task chains
  const allParsed = [];
  for (const line of lines) {
    const m = line.match(/^\[(\d{4}-\d{2}-\d{2})(?:[T ])(\d{2}:\d{2}(?::\d{2})?)(?:Z| UTC)?\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)/);
    if (!m) continue;
    const [, date, time, agent, tag, message] = m;
    const secs = time.split(':').length === 2 ? ':00' : '';
    const iso = date + 'T' + time + secs + 'Z';
    const ts = new Date(iso).getTime();
    if (isNaN(ts) || ts < cutoff) continue;
    const tagLower = tag.toLowerCase();
    allParsed.push({ iso, ts, agent: agent.toLowerCase(), tag, tagLower, message });
  }

  // Group by task text (first 80 chars as key)
  const taskMap = new Map();
  for (const e of allParsed) {
    const key = e.message.slice(0, 80).replace(/\]\s*\[[^\]]+\]\s*/g, ']').replace(/\s+/g, ' ').trim();
    if (!taskMap.has(key)) taskMap.set(key, []);
    taskMap.get(key).push(e);
  }

  // Per-agent stats
  const stats = {};
  const AGENT_LIST = ['spike', 'jet', 'faye', 'ein', 'gren', 'ed', 'julia', 'rocco', 'punch', 'andy'];
  for (const a of AGENT_LIST) {
    stats[a] = { completed: 0, totalTimeMs: 0, blockers: 0, tasks: [] };
  }

  for (const [key, evts] of taskMap) {
    evts.sort((a, b) => a.ts - b.ts);

    let started = null;
    let completed = null;
    let owner = null;
    let wasBlocked = false;

    for (const e of evts) {
      const tagLower = e.tagLower;

      if (tagLower.startsWith('acknowledged') || tagLower.startsWith('taken')) {
        if (!started) {
          started = e;
          owner = e.agent;
        }
      } else if (tagLower.startsWith('done') || tagLower.startsWith('partial')) {
        if (started && !completed) {
          completed = e;
          if (owner && stats[owner]) {
            const dur = completed.ts - started.ts;
            stats[owner].completed++;
            stats[owner].totalTimeMs += dur;
            stats[owner].tasks.push({ dur, key });
          }
        }
      } else if (tagLower.startsWith('blocked') || tagLower.includes('blocked')) {
        wasBlocked = true;
        if (owner && stats[owner]) stats[owner].blockers++;
      }
    }
  }

  const leaderboard = [];
  for (const [agentKey, s] of Object.entries(stats)) {
    const avgTime = s.completed > 0 ? Math.round(s.totalTimeMs / s.completed / 1000) : 0;
    const efficiency = s.completed > 0 ? Math.round((s.completed / Math.max(1, s.completed + s.blockers)) * 100) : 0;
    leaderboard.push({
      agent: AGENT_DISPLAY[agentKey] ?? agentKey,
      agentKey,
      color: AGENT_COLORS[agentKey] ?? '#94a3b8',
      completed: s.completed,
      avgTimeSec: avgTime,
      blockers: s.blockers,
      efficiency,
    });
  }

  leaderboard.sort((a, b) => b.efficiency - a.efficiency || b.completed - a.completed);
  return leaderboard;
}

function getSystemStats() {
  let cpu = 34, memory = 58, disk = 41;
  try {
    const loadAvg = parseFloat(execSync("cat /proc/loadavg", { timeout: 2000 }).toString().split(' ')[0]);
    const cpuCount = parseInt(execSync("nproc", { timeout: 2000 }).toString().trim());
    cpu = Math.min(99, Math.round((loadAvg / cpuCount) * 100));
  } catch {}
  try {
    const memInfo = execSync("free -m", { timeout: 2000 }).toString();
    const memLine = memInfo.split('\n').find(l => l.startsWith('Mem:'));
    if (memLine) {
      const parts = memLine.trim().split(/\s+/);
      const total = parseInt(parts[1]);
      const used  = parseInt(parts[2]);
      memory = Math.round((used / total) * 100);
    }
  } catch {}
  try {
    const dfOut = execSync("df -h /mnt/spike-storage 2>/dev/null || df -h /", { timeout: 2000 }).toString();
    const dfLine = dfOut.split('\n')[1];
    if (dfLine) {
      const parts = dfLine.trim().split(/\s+/);
      disk = parseInt(parts[4]);
    }
  } catch {}
  return { cpu, memory, disk };
}

function buildJson(entries) {
  const stats = getSystemStats();
  const deploy = getDeployInfo();
  const deployHistory = updateDeployHistory(deploy.timestamp, { branch: deploy.branch, commit: deploy.commit, message: deploy.message });
  const cronHealth = getCronHealthData();
  const cronErrorHistory = updateCronErrorHistory(cronHealth);
  // Attach error history samples to each cron job
  cronHealth.forEach(job => {
    job.errorHistory = (cronErrorHistory[job.id]?.samples || []).map(s => s.e);
  });
  const errorStream = extractErrors(readFileSync(SHARED_LOG, 'utf8'));
  const allEntries = parseLog(readFileSync(SHARED_LOG, 'utf8'));

  const activity = entries.map((e, i) => {
    const agentKey = e.agent;
    return {
      id: i + 1,
      agent: AGENT_DISPLAY[agentKey] ?? e.agent,
      line: e.message.slice(0, 120),
      time: relativeTime(e.iso),
      color: AGENT_COLORS[agentKey] ?? '#38bdf8',
    };
  });

  return {
    updatedAt: new Date().toISOString(),
    health: {
      node: 'jarvis',
      uptime: 'stable',
      cpu: stats.cpu,
      memory: stats.memory,
      disk: stats.disk,
    },
    agents: buildLeaderboard(readFileSync(SHARED_LOG, 'utf8')).map(entry => {
      const agentState = detectAgentState(allEntries, entry.agentKey);
      return {
        name: entry.agent,
        key: entry.agentKey,
        model: AGENT_MODELS[entry.agentKey] || 'unknown',
        color: entry.color,
        completed: entry.completed,
        efficiency: entry.efficiency,
        avgTimeSec: entry.avgTimeSec,
        blockers: entry.blockers,
        ...agentState,
      };
    }),
    deploy: {
      ...deploy,
      history: deployHistory.map(d => ({
        ...d,
        duration: d.duration || null,
        time: relativeTime(d.timestamp),
      })),
    },
    projects: [
      { id: 'trendtribe', name: 'TrendTribe',  color: '#7F77DD', health: 'green',  note: 'ProductHunt launch Apr 7' },
      { id: 'ironthread', name: 'IronThread',  color: '#1D9E75', health: 'yellow', note: 'Outreach pipeline active' },
      { id: 'openclaw',   name: 'OpenClaw',    color: '#FF6B35', health: 'green',  note: 'Mission Control rebuild in progress' },
      { id: 'crypto',     name: 'Crypto',      color: '#BA7517', health: 'green',  note: 'Daily brief live' },
      { id: 'artsite',    name: 'Art Site',    color: '#993556', health: 'green',  note: 'Maintained' },
    ],
    activity,
    board: buildBoardData(allEntries),
    cron: cronHealth,
    errors: errorStream,
  };
}

// --- Main ---
const logContent = readFileSync(SHARED_LOG, 'utf8');
const entries = parseLog(logContent);
const json = buildJson(entries);
const out = JSON.stringify(json, null, 2);

writeFileSync(OUT_WORKSPACE, out, 'utf8');
console.log(`✓ Written: ${OUT_WORKSPACE}`);

if (existsSync('/mnt/spike-storage/mission-control-staging')) {
  writeFileSync(OUT_STAGING, out, 'utf8');
  console.log(`✓ Synced:  ${OUT_STAGING}`);
}

// Persist deploy history
if (json.deploy.history?.length > 0) {
  const historyOnly = json.deploy.history.map(d => ({
    timestamp: d.timestamp,
    status: d.status,
    trigger: d.trigger,
    duration: d.duration || null,
  }));
  writeFileSync(DEPLOY_HISTORY_PATH, JSON.stringify(historyOnly, null, 2), 'utf8');
  console.log(`✓ Deploy history: ${historyOnly.length} entries`);

  // Also copy to staging so nginx can serve it
  const stagingDeployHistory = '/mnt/spike-storage/mission-control-staging/deployHistory.json';
  writeFileSync(stagingDeployHistory, JSON.stringify(historyOnly, null, 2), 'utf8');
  console.log(`✓ Deploy history synced to staging`);
}

console.log(`  Activity items: ${json.activity.length}`);
console.log(`  Board: ${json.board.queued.length} queued | ${json.board.inprogress.length} in-progress | ${json.board.done.length} done`);
console.log(`  Deploy: ${json.deploy.state}`);
console.log(`  Cron jobs: ${json.cron.length}`);
console.log(`  Errors: ${json.errors.length}`);
console.log(`  Updated at: ${json.updatedAt}`);
