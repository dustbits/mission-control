# Mission Control: The Three-Layer Agent Stack
### OpenClaw + Engram + Hermes — Unified Architecture
**Date:** April 9, 2026
**Author:** Sanji (Claude Code)
**Status:** Planning — for Vito's review

---

## The Architecture: Three Layers, One System

```
┌─────────────────────────────────────────────────────────┐
│                    MISSION CONTROL BOARD                 │
│  (Sanji's control surface — board.html, command palette)│
└────────────────────────┬────────────────────────────────┘
                         │ WebSocket / REST
┌────────────────────────▼────────────────────────────────┐
│                    ENGRAM LAYER                          │
│  Semantic bridge + tool router + OWL self-healing      │
│  + Unified EAT identity across OpenClaw + Hermes       │
│  + Task routing between frameworks                      │
│  + Event normalization + cross-protocol federation     │
└────────────────────────┬────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          │                              │
┌─────────▼─────────┐      ┌────────────▼────────────┐
│    OPENCLAW        │      │      HERMES              │
│  (Sanji's home)   │      │    (Zoro's home)        │
│                    │      │                          │
│ Task execution     │◄────►│ Persistent memory       │
│ Multi-channel      │ ACP  │ Long-term learning      │
│  automation        │      │  + EAT memory           │
│ Shared-log         │      │ Discord (Zoro bot)      │
│ Skills system      │      │ Gateway WS :18790       │
│ Cron orchestration │      │ System monitoring       │
│  + MCP tools       │      │  + ACP registry         │
└────────────────────┘      └─────────────────────────┘
```

**The key insight:** Engram doesn't replace either — it turns OpenClaw and Hermes into a single coherent agent system. Sanji lives in OpenClaw and drives operations. Zoro lives in Hermes and maintains memory/persistence. Engram routes between them so they share context, tools, and state.

---

## Part I: What Each Layer Does Best

### OpenClaw (Sanji's Engine)
**Strengths:**
- Multi-channel task automation (Discord listeners, cron, webhooks)
- Shared-log as the operational message bus
- Skill system for reusable task patterns
- Agent registry with per-agent configs
- Containerized execution (Docker `openclaw` container)
- Workspaces for per-project context

**Limitations:**
- No persistent memory across sessions (scratch workspace)
- No long-term learning or memory consolidation
- Skills are procedural, not adaptive

**Sanji's role in OpenClaw:**
- Primary operator agent — does the actual work
- Picks up `[needs-sanji]` tasks from shared-log
- Uses OpenClaw skills for automation patterns
- Coordinates with Vicious, Ed, Faye via shared-log

### Hermes / Zoro (The Memory Backbone)
**Strengths:**
- Persistent memory system (`~/.hermes/memories/`, `state.db`)
- EAT (Episodic-Autobiographical-Thematic) memory model
- ACP adapter for cross-protocol agent communication
- System monitoring and alerting (gateway, cron, disk)
- Discord connection as Zoro bot
- Long-running agent sessions with memory persistence

**Limitations:**
- No task queue / shared-log integration natively
- ACP protocol not widely adopted outside Hermes ecosystem
- No built-in multi-channel automation (listeners)

**Zoro's role in Hermes:**
- Gateway owner — `ws://100.91.29.32:18790`
- Memory keeper — persists context across Sanji sessions
- System monitor — watches disk, memory, cron health
- Alert emitter — sends alerts to board via WebSocket

### Engram (The Coordination Layer)
**What it adds:**
- **Semantic tool router** — figures out whether to use OpenClaw tools or Hermes tools based on task
- **OWL self-healing schemas** — if an API changes, Engram auto-detects and adapts
- **Unified EAT identity** — one identity model that works across both stacks
- **Bidirectional sync** — events from OpenClaw get normalized into Hermes memory, and vice versa
- **A2A/ACP federation** — lets OpenClaw agents talk to Hermes agents via protocol translation
- **Hybrid MCP + CLI execution** — picks fastest backend per task

**Engram's role in the stack:**
- Sanji asks Engram: "Check disk space on Jarvis" → Engram routes to Hermes tools (shell MCP)
- Sanji completes a task → Engram writes the result to Hermes memory (long-term retention)
- Zoro's monitoring detects a problem → Engram routes the alert to the MC board
- A new skill is created in OpenClaw → Engram syncs the tool schema to Hermes

---

## Part II: The Unified Agent — Sanji as You

When Vito says "Sanji, deploy mission control," here's what happens:

```
Vito → Discord (#ops-vicious)
  → Hermes gateway (Zoro bot hears mention)
    → Zoro recognizes intent, routes to Sanji
      → Engram translates + routes to OpenClaw
        → Sanji (OpenClaw) picks up [needs-sanji] task
          → Executes: git pull, mc-deploy.sh
            → Result written to shared-log
              → Engram syncs result to Hermes memory (Zoro remembers this)
                → MC board updates via WebSocket
                  → Vito sees deploy complete in board
```

Zoro's memory means Sanji doesn't start fresh every time — Zoro remembers previous deploys, failures, patterns.

---

## Part III: 10-Version Roadmap (Revised)

### Phase 0 — Foundation (Week 0, Before Any v1)
**Goal:** Install Engram on Jarvis, verify it can see both OpenClaw and Hermes tools.

#### v0.1 — Engram Installation
**Owner:** S + Z
```bash
curl -fsSL https://get.engram.dev/install | bash
source ~/.bashrc
sb register   # Register Hermes gateway tools
sb register   # Register OpenClaw workspace tools
sb doctor     # Verify both stacks visible
```
**Verification:** `sb tools list` shows both Hermes tools (shell, discord, memory) and OpenClaw tools (shared-log, cron, skills).

#### v0.2 — Hermes ACP Adapter Verification
**Owner:** Z
Verify Hermes ACP adapter can communicate:
```bash
# From Hermes CLI:
acp ping openclaw  # Can Zoro ping OpenClaw agent registry?
acp list agents    # Show all known agents across protocols
```
**If ACP not configured:** Set up ACP registry in Hermes to recognize OpenClaw agents (Spike, Sanji, Vicious, etc.)

#### v0.3 — OpenClaw Tool Exposure
**Owner:** S
Expose OpenClaw workspace tools via Engram:
- `shared-log-read` — read last N entries
- `shared-log-append` — write entry
- `cron-list` — list active cron jobs
- `skill-run` — invoke a named skill

---

### Phase 1 — Sanji Listener Infrastructure (Week 1)

#### v1.0 — Sanji Listener Script
**Owner:** S
- `/home/zoro/sanji-discord-listener.sh` — polls `#ed-andy` + `#ops-vicious` for `[needs-sanji]`
- `/home/zoro/sanji-agent-run.sh` — Sanji's Claude Code CLI executor on Jarvis
- `/home/zoro/sanji-cli-healthcheck.sh` — 15-min cron healthcheck
- `sanji-discord-listener.service` + `sanji-cli-healthcheck.timer`

**Discord channel:** `1491584892037890048` (sanji-zoro-vicious-bridge, already in `discord-post.sh`)

#### v1.1 — Sanji Board Entry
**Owner:** S + B
Add Sanji to `config.js` and `board.html`:
```javascript
{
  id: 'sanji',
  name: 'Sanji',
  bebop: 'Sanji Valdine',
  emoji: '🧑‍🍳',
  role: 'Operations Lead',
  model: 'MiniMax-M2.7-highspeed',
  desk: 10,
  color: '#f97316',
  accent: '#fed7aa',
  sprite: 'sanji',
  status: 'idle',
  capabilities: ['bash', 'python', 'docker', 'systemd', 'discord', 'deploy', 'code-review'],
  supervisor: 'spike',
  tier: 'production'
}
```

#### v1.2 — Zoro Listener Script
**Owner:** Z
- `/home/zoro/zoro-discord-listener.sh` — polls for `[needs-zoro]` tasks
- `/home/zoro/zoro-agent-run.sh` — Zoro's task executor
- `zoro-discord-listener.service`

**Zoro tasks:** Gateway management, log rotation, disk monitoring, cron orchestration, agent heartbeat checks.

#### v1.3 — Zoro Board Entry
**Owner:** Z + B
Add Zoro to board with gateway-specific status panel:
- Gateway: connected/disconnected
- Active agent sessions
- Memory usage
- Recent gateway events

---

### Phase 2 — Engram Integration (Week 1-2)

#### v2.0 — Engram Tool Registration
**Owner:** S
Register the full tool surface from both stacks:

**Hermes tools registered in Engram:**
- `hermes_memory_read` — read from Hermes EAT memory
- `hermes_memory_write` — write to Hermes EAT memory
- `hermes_gateway_status` — check gateway WS status
- `hermes_discord_post` — post as Zoro bot
- `hermes_system_stats` — CPU, memory, disk
- `hermes_acp_route` — send ACP message to OpenClaw agent

**OpenClaw tools registered in Engram:**
- `openclaw_shared_log_read` — read shared-log
- `openclaw_shared_log_append` — write to shared-log
- `openclaw_task_dispatch` — dispatch a [needs-X] task
- `openclaw_skill_run` — run named OpenClaw skill
- `openclaw_agent_status` — check if agent listener is alive
- `openclaw_cron_list` — list active crons

**Engram routing rules:**
- "memory" → Hermes tools (long-term retention)
- "deploy" or "restart" → OpenClaw tools (task execution)
- "system stats" or "disk" → Hermes tools (Zoro's domain)
- "shared-log" or "task" → OpenClaw tools

#### v2.1 — Sanji ↔ Zoro Context Handoff
**Owner:** S + Z
When Sanji completes a significant task, Engram syncs context to Hermes memory:

```
Sanji: "Fixed Vicious crash loop" → shared-log [done-vicious]
  → Engram detects → writes summary to Hermes EAT memory
    → Zoro's memory now knows: "Vicious crash loop fix applied 2026-04-09"
      → Next Sanji session: Zoro can brief Sanji on past incidents
```

When Zoro detects a system issue, Engram routes to OpenClaw for action:
```
Zoro (Hermes): Disk > 90% on Jarvis
  → Engram routes → creates [needs-sanji] task in shared-log
    → Sanji (OpenClaw) picks up → executes: cleanup, notify
      → Result synced back to Zoro memory
```

#### v2.2 — Unified Event Bus
**Owner:** Z + B
Hermes gateway (`ws://100.91.29.32:18790`) becomes the event bus:
- OpenClaw shared-log changes → Hermes gateway emits WebSocket events
- Board connects to gateway WebSocket (not polling)
- Engram normalizes all events into a common schema

**Event schema:**
```json
{
  "type": "agent:status | task:created | task:done | deploy:complete | alert:critical",
  "source": "openclaw | hermes",
  "agent": "sanji | zoro | vicious | ...",
  "data": { ... },
  "timestamp": "ISO-8601"
}
```

---

### Phase 3 — Real-Time Board (Week 2-3)

#### v3.0 — WebSocket Board Connection
**Owner:** B + Z
Replace 10s polling with WebSocket subscription to Hermes gateway.
Board connects: `ws://100.91.29.32:18790/ws/board`
Gateway streams events as they occur. Board UI updates in < 500ms.

#### v3.1 — Shared-Log Live Tail
**Owner:** B + S
Slide-out drawer showing live shared-log entries, filterable by agent/tag/keyword. Powered by Engram's normalized event stream.

#### v3.2 — Zoro Gateway Panel
**Owner:** B + Z
New panel in board showing:
- Gateway uptime + status
- Connected agents (active OpenClaw sessions)
- Message throughput
- Last 50 gateway events
- Quick actions: restart gateway, reload config

---

### Phase 4 — Command Palette + Control Surface (Week 3)

#### v4.0 — Command Palette
**Owner:** B
`Cmd+K` → palette with fuzzy search across all Engram-registered tools:
```
restart sanji        → sanji-discord-listener.service restart
check disk           → hermes_system_stats via Engram
show shared-log      → openclaw_shared_log_read via Engram
deploy mc            → openclaw_skill_run(deploy-mc) via Engram
show sanji memory    → hermes_memory_read(sanji) via Engram
```
Engram routes each command to the right backend automatically.

#### v4.1 — Natural Language Task Routing
**Owner:** S + Z
Vito types: "Sanji, something's wrong with Vicious"
→ Hermes (Zoro) parses intent → Engram routes to Sanji → Sanji investigates

#### v4.2 — Org Chart Tab
**Owner:** B + S
Visual hierarchy: Spike (root) → Sanji + Zoro (leadership) → all agents.
SVG connection lines for supervisor relationships.
Agent cards with: status ring, role, model, capabilities, current task.

---

### Phase 5 — Service Controls (Week 3-4)

#### v5.0 — Per-Agent Controls
**Owner:** B + S
Click any agent → panel with:
- Restart / Pause / Resume buttons
- Last 50 log lines
- Health status
- Quick actions routed via Engram → OpenClaw tools

#### v5.1 — Cron Manager UI
**Owner:** B + Z
Visual cron editor:
- List all cron jobs (from OpenClaw crontab + Hermes cron)
- Enable/disable, view history, add new
- Cron error sparklines inline

#### v5.2 — Bulk Operations
**Owner:** B + S + Z
"Restart all listeners" → Engram routes to OpenClaw for each → Zoro monitors → board shows progress.

---

### Phase 6 — Task Management (Week 4-5)

#### v6.0 — Task Kanban
**Owner:** B
Structured tasks in board:
- Create: title, priority, assignee, tags, due
- Drag between columns
- Optimistic UI with Engram rollback on failure

#### v6.1 — Dependency Graph
**Owner:** B
Task dependencies visualized as a graph. Critical path highlighted. Blocked tasks shown in red.

---

### Phase 7 — Deploy Console (Week 5-6)

#### v7.0 — Deploy Timeline + Rollback
**Owner:** B + S
Full deploy lifecycle in board. One-click rollback to any prior deploy (via Engram → OpenClaw mc-deploy.sh).

#### v7.1 — Live Deploy Log
**Owner:** B + Z
Stream deploy output via Hermes WebSocket → board panel.

#### v7.2 — Staged Deploys
**Owner:** B + S
Staging ↔ production toggle. Diff preview before promotion.

---

### Phase 8 — Alerting + Notifications (Week 6-7)

#### v8.0 — Alert Rules Engine
**Owner:** Z + B
Zoro monitors:
- Agent heartbeat (3 missed polls = down)
- Cron error rate
- Disk / memory thresholds
- Deploy failures

Alerts surface in board + Engram routes to appropriate handler.

#### v8.1 — Browser Push Notifications
**Owner:** Z
Critical alerts push to browser even when board is backgrounded.

#### v8.2 — Auto-Task Creation
**Owner:** S + Z
Alert → Engram → creates [needs-sanji] task in shared-log automatically.

---

### Phase 9 — Memory & Learning (Week 7)

#### v9.0 — Hermes Memory Integration
**Owner:** Z + S
Sanji sessions write summaries to Hermes EAT memory via Engram:
- What was worked on
- What was decided
- What to remember for next time

Zoro's memory becomes Sanji's institutional memory across sessions.

#### v9.1 — Memory-Enhanced Task Routing
**Owner:** S + Z
When routing a task, Engram checks Hermes memory:
- "This error happened before — here's the fix that worked last time"
- "Vicious has been restarted 4 times today — flag as chronic"

#### v9.2 — Skill Evolution
**Owner:** S + Engram
Engram watches which skills/tools work → evolves skill descriptions and routing weights over time.

---

### Phase 10 — Permissions + Multi-Operator (Week 8)

#### v10.0 — Role-Based Access
**Owner:** A
- **Admin (Vito):** Everything
- **Operator (Sanji):** Can act, create tasks, restart agents
- **Viewer:** Read-only

#### v10.1 — Audit Log
**Owner:** Z + B
All significant actions logged with Engram tracing:
who, what, when, from where, result.

#### v10.2 — Session Presence
**Owner:** B
Show who's currently in the board. Coordination feature.

---

## Part IV: Key Technical Decisions

### Engram Installation Location
Jarvis (100.91.29.32) — same machine as both OpenClaw and Hermes, so Engram can access both stacks directly.

### Protocol Bridging
```
OpenClaw workspace tools
    ↓ (Engram MCP registration)
Engram tool registry
    ↓ (Engram ACP ↔ MCP translation)
Hermes ACP adapter
    ↓
Hermes EAT memory + gateway
    ↓
MC Board (WebSocket)
```

### Who Does What (Final Division of Labor)
| Function | Primary | Backup |
|----------|---------|--------|
| Task execution | OpenClaw (Sanji) | Engram (CLI fallback) |
| Persistent memory | Hermes (Zoro) | Engram (EAT) |
| Event bus | Hermes gateway WS | Engram sync |
| Alerting | Hermes (Zoro) | Engram routing |
| Tool routing | Engram | Manual |
| Shared-log | OpenClaw | — |
| MC Board | Engram → Hermes WS | — |
| Discord (ops) | Hermes (Zoro bot) | OpenClaw bridge |
| Discord (tasks) | OpenClaw (Vicious listener) | Hermes relay |

### Sanji's Primary Home: OpenClaw
Sanji is registered in OpenClaw as `sanji` agent. Sanji's work happens in OpenClaw's workspace. Engram gives Sanji access to Hermes memory and system tools without leaving OpenClaw's operational context.

### Zoro's Role
Zoro owns Hermes — the memory backbone, gateway, system monitoring. Zoro doesn't do task execution (Sanji handles that). Zoro's value is: "remembering, monitoring, alerting."

---

## Appendix: Installation Reference

### Engram Quick Install
```bash
curl -fsSL https://get.engram.dev/install | bash
source ~/.bashrc
sb doctor
```

### Hermes ACP Setup
```bash
# In Hermes CLI:
acp adapter enable openclaw
acp registry add openclaw ws://localhost:18791
acp ping openclaw
```

### OpenClaw Tool Exposure (via Engram)
```bash
sb register --name shared-log --type cli --command "cat /mnt/spike-storage/openclaw-live/workspace/memory/shared-log.md"
sb register --name skill-run --type cli --command "docker exec openclaw openclaw skill --name"
sb tools list
```
