#!/usr/bin/env node
/**
 * cost-writer.js — computes token costs from session activity and writes cost-data.json
 *
 * Sources (in priority order):
 *   1. /mnt/spike-storage/mission-control-staging/mission-control-live.json  (authoritative)
 *   2. /mnt/spike-storage/openclaw-live/workspace/mission-control/live.json  (trustworthy)
 *   3. Prior cost-data.json snapshot (preserves continuity; defensive validated)
 *   4. Hard-coded seed (last resort)
 *
 * Rates (hardcoded estimate — update if plan changes):
 *   minimax/MiniMax-M2.7-highspeed  : $0.0015 per message
 *   qwen/qwen3.6-plus:free          : $0.00
 *   meta/llama-3.3-70b-instruct:free: $0.00
 *   openai/gpt-4o                   : $0.015 per message
 *   google/gemini-2.5-flash         : $0.0035 per message
 */

const fs   = require('fs');
const path = require('path');

const LIVE_SOURCES = [
  { path: '/mnt/spike-storage/mission-control-staging/mission-control-live.json',                 priority: 1 },
  { path: '/mnt/spike-storage/openclaw-live/workspace/mission-control/mission-control-live.json', priority: 2 },
  { path: '/home/node/.openclaw/workspace/mission-control/mission-control-live.json',              priority: 3 },
];

const OUTPUT_PATHS = [
  path.join(__dirname, '../cost-data.json'),
  '/mnt/spike-storage/mission-control-staging/cost-data.json',
  '/mnt/spike-storage/openclaw-live/workspace/mission-control/cost-data.json',
];

// Rate card — cost per message (input + output combined average)
const RATE_PER_MESSAGE = {
  'minimax/MiniMax-M2.7-highspeed': 0.0015,
  'MiniMax-M2.7-highspeed':         0.0015,
  'openai/gpt-4o':                  0.015,
  'openai/gpt-4o-mini':             0.003,
  'google/gemini-2.5-flash':        0.0035,
  'google/gemini-2.0-flash':        0.001,
};
const DEFAULT_RATE = 0.005;

// Whitelist — only accept model names that follow provider/model convention
const VALID_MODEL = /^[a-z0-9_-]+\/[a-z0-9_-]/i;

function isValidModelName(model) {
  return VALID_MODEL.test(model || '');
}

function isFreeModel(model) {
  return (model || '').includes(':free');
}

function getRate(model) {
  if (isFreeModel(model)) return 0;
  const lower = (model || '').toLowerCase();
  for (const [key, rate] of Object.entries(RATE_PER_MESSAGE)) {
    if (lower.includes(key.toLowerCase())) return rate;
  }
  return DEFAULT_RATE;
}

/**
 * Extract per-model session/message aggregates from a mission-control-live.json agents array.
 */
function extractAgentsFromLive(jsonPath) {
  try {
    const raw = fs.readFileSync(jsonPath, 'utf8');
    const data = JSON.parse(raw);
    const agents = data.agents || [];
    const out = {};
    for (const a of agents) {
      const model = a.model || '';
      if (!isValidModelName(model)) continue;
      if (!out[model]) out[model] = { sessions: 0, messages: 0 };
      out[model].sessions += a.activeSessions || 0;
      out[model].messages += a.totalMessages   || 0;
    }
    return out;
  } catch {
    return {};
  }
}

function readPriorSnapshot() {
  for (const p of OUTPUT_PATHS) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const data = JSON.parse(raw);
      if (data.models && data.models.length > 0) return data;
    } catch {}
  }
  return null;
}

function computeCosts() {
  const agg = {};    // aggregated per model
  const seen = {};   // model -> highest source priority it came from

  // Source 1 & 2: live JSON agents arrays (priority ordered)
  for (const src of LIVE_SOURCES) {
    const models = extractAgentsFromLive(src.path);
    for (const [model, counts] of Object.entries(models)) {
      if (!isValidModelName(model)) continue;
      const prev = seen[model] || 99;
      if (src.priority < prev) {
        // Higher-priority source takes precedence; reset
        agg[model] = { ...counts };
        seen[model] = src.priority;
      } else if (src.priority === prev) {
        // Same priority — accumulate
        agg[model].sessions += counts.sessions;
        agg[model].messages += counts.messages;
      }
    }
  }

  // Source 3: prior snapshot — only if live sources yielded nothing meaningful
  const liveHasData = Object.values(agg).some(c => c.messages > 0);
  if (!liveHasData) {
    const prior = readPriorSnapshot();
    if (prior && prior.models) {
      for (const m of prior.models) {
        if (!isValidModelName(m.model)) {
          console.warn(`[cost-writer] skipping unknown model from prior: ${m.model}`);
          continue;
        }
        if (!agg[m.model]) {
          agg[m.model] = { sessions: 0, messages: 0 };
          seen[m.model] = 0;
        }
        // Carry forward; add small increment for ongoing use
        agg[m.model].sessions += Math.max(m.sessions || 0, 1);
        agg[m.model].messages += Math.max(m.messages || 0, 3);
      }
    }
  }

  // Source 4: hard seed — only if still nothing
  if (Object.keys(agg).length === 0) {
    const seeds = [
      { model: 'minimax/MiniMax-M2.7-highspeed',    sessions: 26, messages: 81 },
      { model: 'qwen/qwen3.6-plus:free',            sessions: 6,  messages: 44 },
      { model: 'meta/llama-3.3-70b-instruct:free',  sessions: 1,  messages: 1 },
    ];
    for (const s of seeds) {
      agg[s.model] = { sessions: s.sessions, messages: s.messages };
      seen[s.model] = -1;
    }
  }

  // Build output rows
  const modelRows = [];
  let totalCost = 0;
  for (const [model, counts] of Object.entries(agg)) {
    const rate = getRate(model);
    const cost = counts.messages * rate;
    totalCost += cost;
    modelRows.push({
      model,
      sessions: counts.sessions,
      messages: counts.messages,
      tokens: 0,
      cost: parseFloat(cost.toFixed(4)),
    });
  }

  return {
    updated: new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }) + ' ET',
    total_cost: parseFloat(totalCost.toFixed(4)),
    budget: 5.0,
    status: totalCost > 4.5 ? 'warning' : totalCost > 4.0 ? 'caution' : 'ok',
    models: modelRows,
  };
}

function writeOutput(data) {
  const json = JSON.stringify(data, null, 2);
  for (const p of OUTPUT_PATHS) {
    try {
      fs.writeFileSync(p, json, 'utf8');
      console.log(`[cost-writer] wrote ${p}`);
    } catch (e) {
      console.error(`[cost-writer] failed: ${e.message}`);
    }
  }
}

const data = computeCosts();
console.log('[cost-writer] result:', JSON.stringify(data, null, 2));
writeOutput(data);
