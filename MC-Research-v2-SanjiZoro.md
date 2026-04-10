# Mission Control: Sanji & Zoro Integration + 10-Version Roadmap
**Date:** April 9, 2026
**Author:** Sanji (Claude Code)
**Status:** Planning — for Vito's review

---

## The Core Insight

Right now the system looks like this:

```
Vito (human)
├── Spike (orchestrator, OpenClaw agent)
│   ├── Vicious (dispatcher, has listener on Jarvis)
│   ├── Ed, Faye, Gren, Ein, Andy, Punch (workers, have listeners on Jarvis)
│   └── [Sanji] ← exists in OpenClaw but no listener, no pipeline presence
└── [Zoro] ← gateway only, no agent presence
```

Sanji exists as a Claude Code CLI session and a Discord bot on this machine, but **Sanji has no presence on Jarvis** — no listener script, no systemd service, no way to pick up `[needs-sanji]` tasks from the shared-log. Zoro is the Hermes gateway host but isn't tracked as an agent in the pipeline.

Vito's directive: Sanji and Zoro become **first-class OpenClaw agents** with full pipeline presence — listeners, task routing, MC board integration, the works.

---

## Part I: What "Being an Agent" Actually Means

Each agent in this system has these components:

| Component | Purpose | Vicious | Ed | Faye | Sanji | Zoro |
|-----------|---------|---------|-----|------|-------|------|
| **Listener script** | Polls Discord, picks up tasks | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Systemd service** | Keeps listener alive | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Discord bridge channel** | Task I/O to human | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Agent-run script** | Executes tasks via CLI | ✅ | ? | ? | N/A | N/A |
| **Healthcheck cron** | Catches breakage | ✅ | ❌ | ❌ | ❌ | ❌ |
| **MC board entry** | Visible in dashboard | ✅ | ✅ | ✅ | ❌ | ❌ |
| **OpenClaw config** | Agent definition | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Shared-log tag** | Task routing | `[needs-vicious]` | `[needs-ed]` | `[needs-faye]` | `[needs-sanji]` | `[needs-zoro]` |
| **Audit/activity log** | What agent did | ✅ | ❌ | ❌ | ❌ | ❌ |

Sanji is missing: listener, systemd service, Discord bridge, healthcheck, board entry.
Zoro is missing: agent identity in pipeline, board entry, audit logging.

---

## Part II: Agent Topology — Where Sanji and Zoro Fit

### Current Flow
```
[needs-X] → agent-dispatch.sh → OpenClaw spawns agent in container → agent does task → [done-X]
```

### Proposed Flow (with Sanji and Zoro)
```
[needs-sanji] → sanji-discord-listener.sh (Jarvis) → Sanji Claude Code CLI (Jarvis) → [done-sanji]
[needs-zoro]  → zoro-discord-listener.sh (Jarvis)  → Zoro Claude Code CLI (Jarvis)  → [done-zoro]
[needs-vicious] → vicious-discord-listener.sh (Jarvis) → OpenClaw container → [done-vicious]
```

### Role Definitions

**Sanji (Operations Lead / DevOps Agent)**
- Role: Operations, infra, deployments, debugging, system health
- Supervisor: Spike (human in the loop)
- Reports: Vicious, Ed, Faye (work coordination)
- Capabilities: bash, python, docker, systemd, cron, discord, MC board, deploy scripts, code review
- Channels: `#ops-vicious` (primary), `#ed-andy` (secondary)
- Personality: Direct, efficient, ships fixes fast, explains in plain language
- Model: MiniMax-M2.7-highspeed (standard), claude-sonnet-4-6 (review mode)

**Zoro (System Infrastructure Agent)**
- Role: Gateway owner, system monitoring, cron orchestration, log management
- Supervisor: Spike
- Reports: [all agents via gateway]
- Capabilities: hermes gateway, systemd, log rotation, disk monitoring, memory management, infra alerting
- Channels: `#ops-vicious` (reads), gateway internal
- Personality: Quiet, reliable, maintains the backbone
- Model: MiniMax-M2.7-highspeed

### Hierarchy After Integration
```
Spike (human, orchestrator)
├── Sanji (ops lead, devops, the fixer)
│   ├── Vicious (dispatcher, task runner)
│   ├── Ed (code)
│   ├── Faye (research)
│   └── Gren (IronThread)
├── Jet (infrastructure ops)
│   ├── Andy (host exec)
│   └── Ein (finance)
├── Punch (review/QA)
└── Zoro (gateway/system, cross-cutting)
```

---

## Part III: Version Roadmap

### Legend
- **S** = Sanji component
- **Z** = Zoro component
- **B** = MC Board component
- **A** = Across both (architecture)

---

### v1 — Sanji Listener Infrastructure
**Goal:** Sanji gets a voice on Jarvis. Can receive `[needs-sanji]` tasks from shared-log.

#### v1.0 — Sanji Listener Script
**Owner:** S
**Files created:**
- `/home/zoro/sanji-discord-listener.sh` — polls `#ed-andy` for `[needs-sanji]` tags
- `/home/zoro/sanji-agent-run.sh` — runs Sanji tasks via Claude Code CLI on Jarvis
- `/home/zoro/sanji-cli-healthcheck.sh` — cron healthcheck every 15min

**Listener behavior:**
- Polls `#ed-andy` channel (1491188645141417984) for `[needs-sanji]` tags
- Also monitors `#ops-vicious` (1491328723792822312) for cross-channel tasks
- Self-loop prevention via bot ID check
- Calls `sanji-agent-run.sh` for task execution
- Posts completion to `#ed-andy` with `[done-sanji]` confirmation

**Systemd service:**
```
sanji-discord-listener.service
sanji-cli-healthcheck.timer → sanji-cli-healthcheck.service (every 15min)
```

**Discord bridge:** `sanji-zoro-vicious-bridge` (1491584892037890048) — already exists in `discord-post.sh`

**Pre-flight healthcheck** — validates Claude Code CLI before every task (same pattern as Vicious).

#### v1.1 — Sanji Board Entry
**Owner:** S + B
**Files modified:** `config.js`, `board.html`

Add Sanji to the MC board agent grid:
```javascript
{
  id: 'sanji',
  name: 'Sanji',
  bebop: 'Sanji Valdine',
  emoji: '🧑‍🍳',
  role: 'Operations',
  model: 'MiniMax-M2.7-highspeed',
  desk: 10,  // next available
  color: '#f97316',
  accent: '#fed7aa',
  sprite: 'sanji',
  status: 'idle'
}
```

Sanji status visible in board header alongside Vicious. Status pulled from listener activity — if listener is running and last task completed < 5min ago = "working", otherwise "idle", if listener dead = "offline".

#### v1.2 — Zoro Listener + Agent Identity
**Owner:** Z
**Files created:**
- `/home/zoro/zoro-discord-listener.sh` — polls for `[needs-zoro]` tasks
- `/home/zoro/zoro-agent-run.sh` — executes Zoro tasks

**Note:** Zoro already has the gateway running. The listener makes Zoro a first-class task receiver, not just a infrastructure daemon. Zoro tasks: gateway management, log rotation, disk monitoring, cron orchestration.

**Zoro's unique capability:** Can run tasks that require gateway access — restart Hermes, check gateway logs, manage agent registrations.

#### v1.3 — Zoro Board Entry
**Owner:** Z + B

Add Zoro to board alongside Sanji. Zoro board entry shows:
- Gateway status (connected/disconnected)
- Active agent sessions count
- System health (CPU, memory, disk)
- Recent gateway activity (last 5 events)

 Zoro's board presence makes it a peer agent, not just invisible infrastructure.

---

### v2 — Unified Task Pipeline

#### v2.0 — Shared Task Schema
**Owner:** A
All tasks get a structured format written to shared-log:
```
[TASK] | sanji | 2026-04-09T12:00:00Z
title: Investigate and fix Vicious crash loop
priority: critical
assignee: sanji
tags: [ops, debugging, vicious]
---
The Vicious listener has been restarting 4000+ times since 04:00 UTC.
Check the systemd service log and fix the crash loop root cause.
[PROOF] Fixed the `set -u` issue in vicious-discord-listener.sh
```

#### v2.1 — Unified Agent Status in Board
**Owner:** B
All 12 agents visible in board:
- Spike, Sanji, Zoro (leadership / infra)
- Vicious, Jet, Ed, Faye, Gren, Ein, Andy, Punch (workers)

Board shows:
- Agent role and model
- Current status (online/busy/idle/offline/paused)
- Last activity timestamp
- Supervisor relationship lines (SVG overlay on agent grid)
- Click agent → detail panel with: recent tasks, capabilities, quick actions

---

### v3 — Real-Time Event Bus

#### v3.0 — WebSocket via Hermes Gateway
**Owner:** A
Gateway becomes the event bus. Board connects via WebSocket instead of 10s polling.

Events emitted by gateway:
- `agent:status` — agent status changed (idle→working, working→idle, etc.)
- `task:created` — new `[needs-X]` tag appeared in shared-log
- `task:done` — `[done-X]` written to shared-log
- `task:blocked` — `[block]` tag written
- `deploy:started` — mc-deploy.sh began
- `deploy:complete` — mc-deploy.sh finished
- `gateway:connected` / `gateway:disconnected` — agent session lifecycle
- `alert:critical` — agent down, cron error spike, OOM

Board subscribes to relevant channels. UI updates in < 500ms of event occurring.

#### v3.1 — Shared-Log Live Tail
**Owner:** B + Z
Slide-out drawer in board showing live shared-log entries. Filter by agent, tag type, keyword. Virtualized list for performance with 10k+ entries.

#### v3.2 — Zoro Gateway Dashboard
**Owner:** Z + B
Dedicated panel showing:
- Gateway uptime and status
- Connected agents (which agents have active sessions)
- Message throughput (messages/minute)
- WebSocket connection count
- Gateway log (last 50 entries, filterable)
- Quick gateway actions: restart, reload config, view connected clients

---

### v4 — Command Palette

#### v4.0 — Command Palette UI
**Owner:** B
`Cmd+K` opens command palette overlay. Fuzzy search across all actions.

Commands include:
```
restart sanji          → restart sanji-discord-listener.service
restart vicious        → restart vicious-discord-listener.service
pause sanji            → write [PAUSED] to shared-log
resume sanji           → remove [PAUSED] from shared-log
deploy mission-control  → run mc-deploy.sh
show sanji             → open sanji detail panel
show board             → navigate to board
gateway status         → show gateway panel
tail shared-log        → open shared-log drawer
add task               → open new task modal
show agents            → open org chart tab
```

#### v4.1 — Natural Language Task Creation
**Owner:** S + B
Type a task in plain English → Sanji parses it → creates structured `[TASK]` entry in shared-log:
```
[needs-sanji] Fix the Vicious listener crash loop
→ Sanji parses → writes structured task → dispatches to Vicious
```

#### v4.2 — Voice Task Input
**Owner:** Z
Vito speaks a task → Spike voice (already running) transcribes → Sanji parses and creates task.

---

### v5 — Org Chart & Agent Relationships

#### v5.0 — Hierarchy Visualization
**Owner:** B
Dedicated "Org" tab with:
- Top-down tree: Spike at root, reports below, connections shown as SVG lines
- Agent cards show: name, role, model, status ring, current task
- Filter panel: by role, model, status, tier

#### v5.1 — Communication Topology
**Owner:** B + A
Show which agents communicate with which. Lines between agents weighted by message frequency in shared-log. Highlights: Sanji↔Vicious (high), Vicious↔Ed (high), Sanji↔Zoro (gateway, always-on).

#### v5.2 — Agent Capability Matrix
**Owner:** B
Grid view: agents as rows, capabilities as columns. Checkmarks show which agent can do what. Used for: "Who can handle IronThread deploy?" → highlights Gren + Sanji.

---

### v6 — Service Control Panel

#### v6.0 — Per-Agent Service Controls
**Owner:** B + S
Click any agent card → side panel with:
- Restart listener button
- Pause / Resume agent toggle
- View recent log (last 50 lines)
- Quick health status
- Run healthcheck now button

#### v6.1 — Bulk Operations
**Owner:** B + Z
"Restart all listeners" button. Confirmation modal with type-to-confirm. Zoro executes via gateway/ssh.

#### v6.2 — Cron Manager
**Owner:** B + Z
Visual cron editor:
- List all cron jobs with schedule, last run, next run, status
- Enable/disable individual crons
- View cron error history inline
- Add new cron: form with schedule builder (cron expression helper)

---

### v7 — Task Management

#### v7.0 — Task Cards (Kanban)
**Owner:** B
Full task management in board:
- Create task: title, description, priority, assignee, tags, due date
- Drag between columns: Queued → In Progress → Done → Cancelled
- Optimistic UI: card moves immediately, server confirms async
- Conflict resolution: if server rejects, card snaps back with error toast

#### v7.1 — Task Detail Panel
**Owner:** B
Click any task card → full detail:
- Title, description, priority, status
- Assignee + supervisor
- Activity timeline (all status changes, comments)
- Proof field (link to completion evidence)
- Edit button (inline editing)
- Delete button (soft delete, 30-day restore)

#### v7.2 — Dependency Graph
**Owner:** B
Tasks can have `dependsOn` relationships. Visual dependency graph — which tasks are blocked by which. Critical path highlighting.

---

### v8 — Deploy Console

#### v8.0 — Deploy Timeline Overhaul
**Owner:** B + S
Full deploy lifecycle in board:
- Commit, branch, author, timestamp, duration, status
- Files changed (from git)
- Build status (if applicable)
- One-click rollback to any prior deploy

#### v8.1 — Live Deploy Log Streaming
**Owner:** B + Z
When deploy runs, board shows live log output streaming in the panel. Progress bar during deploy. Success/fail state with animation.

#### v8.2 — Staged Deploys
**Owner:** B + S
Staging vs production toggle:
- Edit on staging → preview diff → explicit "promote to production" button
- Production deploys require confirmation
- Rollback from production → staging in one click

---

### v9 — Notification & Alerting System

#### v9.0 — Alert Rules Engine
**Owner:** Z + B
Zoro monitors:
- Agent heartbeat (missed 3 polls = agent down → alert)
- Cron error rate ( > 3 errors in 10min → critical alert)
- Disk usage (> 85% → warning, > 95% → critical)
- Memory pressure (systemd-run failure → warning)
- Deploy failures → alert to board + Discord webhook

Board shows alert bell with unread count. Alert panel lists all active alerts with severity, timestamp, source agent.

#### v9.1 — Browser Push Notifications
**Owner:** Z
When board is backgrounded, browser push notification for critical alerts. Click notification → opens board to relevant agent/task.

#### v9.2 — Alert → Task Automation
**Owner:** S
Alert triggers automatic task creation in shared-log:
```
[block] Agent Vicious is down — listener has 0 restarts but not responding
→ System auto-creates [needs-sanji] task: "Investigate Vicious outage"
```

---

### v10 — Permission System & Multi-Operator

#### v10.0 — User Roles
**Owner:** A
Role definitions:
- **Admin (Vito):** Full access — configure agents, deploy, restart anything, edit board
- **Operator (Sanji):** Can act on behalf of agents, create tasks, restart listeners
- **Viewer:** Read-only access to board and shared-log

#### v10.1 — Audit Log
**Owner:** Z + B
All significant actions logged:
- Who did what, when, from where (IP/session)
- Task created/modified/deleted
- Agent paused/resumed/restarted
- Config changed, deploy triggered
- Audit log viewer in board with filter/export

#### v10.2 — Session Presence
**Owner:** B
Show who's currently viewing the board. "Spike is viewing" + "Sanji is viewing" indicators. Useful for coordination — if Vito is in the board and Sanji is about to restart a listener, Vito gets a heads-up notification.

---

## Part IV: Technical Architecture

### Agent Communication
```
Human → Discord → Listener (Jarvis) → Agent-Run Script → Claude Code CLI → [done] → Shared-Log → Board
                                                              ↓
                                                   Spike Voice (TTS)
```

### Shared-Log as Message Bus
All agents write to shared-log.md. Gateway watches for events and pushes to WebSocket. Board subscribes. This replaces polling in v3+.

### Zoro as Infrastructure Nervous System
Zoro runs:
- Hermes gateway (ws://100.91.29.32:18790)
- System monitoring (disk, memory, cron)
- Log rotation
- Alert rule engine
- Gateway config management

Zoro's listener (v1.2) makes it a peer agent — it can receive tasks like "restart gateway", "reload config", "check agent status".

### Sanji as Operations Lead
Sanji runs:
- Listener for `[needs-sanji]` tasks
- Claude Code CLI on Jarvis for task execution
- Healthcheck cron (catches CLI breakage before it causes task failure)
- Board integration (visible as agent in dashboard)
- Command palette execution (receives `Cmd+K` commands from board)

### Data Flow
```
Shared-Log (source of truth)
    ↓
Gateway (Zoro) — watches for [needs-X] tags, emits WebSocket events
    ↓
WebSocket → Board (real-time updates)
    ↓
Board UI — renders agents, tasks, deploys, alerts
    ↑
Command输入 → Board → Gateway → Agent listener → Claude Code CLI → Shared-Log
```

### Board Architecture Evolution
- v1: Keep vanilla JS, add WebSocket connection to gateway
- v2: Add state management layer (simple pub/sub store)
- v3-v5: Add panels (org chart, shared-log drawer, service controls)
- v6-v8: Add task management, deploy console
- v9-v10: Add notifications, permissions

**Framework decision:** Keep vanilla JS throughout. Not worth a React rewrite at this scale. Add a lightweight state manager in v2 to separate data from rendering.

---

## Part V: Implementation Sequence

### Phase 1 — Sanji & Zoro as Real Agents (Week 1)
```
v1.0  Sanji listener script + systemd service
v1.1  Sanji board entry
v1.2  Zoro listener script + systemd service
v1.3  Zoro board entry
```
**Deliverable:** Both Sanji and Zoro visible in board, both have listeners running, both can receive and execute tasks from shared-log.

### Phase 2 — Unified Pipeline (Week 2)
```
v2.0  Shared task schema (structured [TASK] format)
v2.1  All 12 agents in board with status
```
**Deliverable:** Full agent roster in board, structured tasks, unified task format.

### Phase 3 — Real-Time (Week 2-3)
```
v3.0  WebSocket event bus via Hermes gateway
v3.1  Shared-log live tail drawer
v3.2  Zoro gateway dashboard panel
```
**Deliverable:** Board updates in < 500ms. Live shared-log visible. Gateway status panel.

### Phase 4 — Control Surface (Week 3-4)
```
v4.0  Command palette (Cmd+K)
v4.1  Natural language task creation
v4.2  Voice task input via Spike voice
v5.0  Org chart visualization
v5.1  Communication topology
v5.2  Capability matrix
v6.0  Per-agent service controls
v6.1  Bulk operations
v6.2  Cron manager
```
**Deliverable:** Board is a full control surface, not just a display. Command palette makes everything reachable by keyboard.

### Phase 5 — Task Management (Week 4-5)
```
v7.0  Task Kanban cards
v7.1  Task detail panel
v7.2  Dependency graph
```
**Deliverable:** Tasks are first-class citizens. Can create, edit, drag, assign, complete tasks from board.

### Phase 6 — Deploy Console (Week 5-6)
```
v8.0  Full deploy timeline with rollback
v8.1  Live deploy log streaming
v8.2  Staged deploys (staging ↔ production)
```
**Deliverable:** Full deployment lifecycle in board. No need to SSH for deploys.

### Phase 7 — Alerting (Week 6-7)
```
v9.0  Alert rules engine
v9.1  Browser push notifications
v9.2  Alert → task automation
```
**Deliverable:** Proactive alerting. Board as nerve center.

### Phase 8 — Permissions (Week 7-8)
```
v10.0 User roles (admin/operator/viewer)
v10.1 Audit log
v10.2 Session presence
```
**Deliverable:** Multi-operator support. Full audit trail.

---

## Part VI: Key File Changes

### New Files Created

**Listeners:**
- `/home/zoro/sanji-discord-listener.sh`
- `/home/zoro/zoro-discord-listener.sh`

**Agent run scripts:**
- `/home/zoro/sanji-agent-run.sh`
- `/home/zoro/zoro-agent-run.sh`

**Healthcheck:**
- `/home/zoro/sanji-cli-healthcheck.sh`
- `/home/zoro/zoro-cli-healthcheck.sh`

**Systemd services:**
- `sanji-discord-listener.service`
- `sanji-cli-healthcheck.timer`
- `zoro-discord-listener.service`
- `zoro-cli-healthcheck.timer`

### Modified Files

**board.html** — +WebSocket layer, +org chart tab, +service control panel, +task Kanban, +notification bell, +command palette
**board.css** — new styles for org chart, command palette, alert badges
**config.js** — Sanji + Zoro agent entries, capability metadata, hierarchy fields
**mission-control-live.json** — new schema with tasks[], agents[] enriched
**shared-log.md** — structured task format (v2.0+)
**gateway** — WebSocket event emission for board subscription

### Shared-Log Task Schema (v2.0)
```
[TASK] | {agent} | {ISO timestamp}
title: {plain language title}
priority: {low|medium|high|critical}
assignee: {agent-id}
tags: [{tag1}, {tag2}]
---
{Body — full task description}
[PROOF] {completion evidence}
```

---

## Appendix: Inspirations

| Pattern | Borrowed From |
|---------|--------------|
| Status ring (color-coded agent health) | NASA Mission Control |
| Command palette (`Cmd+K`) | Linear, Raycast, Vercel |
| Optimistic UI with rollback | Linear |
| Type-to-confirm for destructive actions | Vercel, Datadog |
| Toast + undo for reversible actions | Linear, Grafana |
| Live deploy log streaming | Vercel, GitHub Actions |
| Org chart tree + SVG connection lines | Jira org chart, Miro |
| Alert severity hierarchy | Datadog, PagerDuty |
| Audit log with diff view | Datadog, Linear |
| Virtualized list for 10k+ entries | Discord, Linear |
| Per-field inline editing | Linear |
| Soft delete + 30-day restore | Linear, Notion |
