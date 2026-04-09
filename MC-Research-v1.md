# Mission Control: 10-Version Roadmap Research
**Date:** April 9, 2026
**Author:** Sanji (Claude Code)
**Status:** Research draft — for Vito's review

---

## Executive Summary

Mission Control Board is currently a **read-only dashboard** — it displays agent status, task pipeline, deploy history, and system health via 10-second JSON polling. The next 10 versions should transform it into a **live ops console** where Vito can see, control, and modify the entire multi-agent pipeline in real time. This document lays out the architectural vision, feature roadmap, and key decisions for that evolution.

**Core thesis:** The board should evolve from a passive display into an **active control surface** — equal parts mission control (NASA style) and incident management console (Datadog/Vercel style). Vito sits at the console and drives the operation.

---

## Part I: Current State Assessment

### What's Working (v0 baseline)
- 10 agents rendered with status indicators (working/idle/offline)
- Kanban pipeline: Queued → In Progress → Done columns
- Deploy history timeline with commit/branch/author
- Cron error sparkline history
- System health stats (CPU, memory)
- Dark/light theme toggle
- Card context menus (view-only actions)
- 10-second polling is functional
- Board runs on nginx at jarvis:8090

### What's Broken / Missing
- **No real-time**: WebSocket connection does not exist — board is always 10s stale
- **No interactivity**: No ability to create tasks, reassign agents, cancel jobs, restart services
- **No input**: No forms, no modals, no command palette
- **No org chart**: Agents shown as flat grid, no hierarchy/supervisor relationships
- **No audit log**: No record of what changed, when, by whom
- **Stale deploy history**: git fields (commit, branch, files) missing from deploy entries
- **No mobile**: Not responsive, unusable on phone/tablet
- **No shared-log integration**: Can't see what agents are actually working on
- **No notification system**: Errors surface in cron error panel only, no active alerting to board

### Code Assessment
- **Size:** 1766 lines in a single `board.html` file — needs architectural restructuring
- **Pattern:** Vanilla JS with 30 functions, no framework, no module system
- **State:** In-memory only — no client-side state management
- **Rendering:** Direct DOM manipulation — won't scale with more agents/events
- **Styling:** Pure CSS with CSS variables, theming works — good foundation

---

## Part II: Architectural Vision

### The Three Layers

Every ops console has three distinct layers:

| Layer | Purpose | Current State |
|-------|---------|---------------|
| **Observe** | See what's happening | Partially done — polling works, shared-log missing |
| **Act** | Control the system | Completely absent — no inputs, no controls |
| **Evolve** | Modify configuration, onboard agents | Absent |

The board needs to become a full Observe → Act → Evolve console.

### Real-Time Architecture

**Decision: WebSocket via Hermes Gateway**

The Hermes gateway (`ws://100.91.29.32:18790`) is already running and connected to Discord. It can be the message bus for the board.

**Option A — WebSocket through gateway (recommended):**
- Gateway receives events from agents (dispatch, task start, task done, errors)
- Gateway forwards events to board via WebSocket
- Board subscribes to channels relevant to visible panels
- Single source of truth, no new infrastructure

**Option B — SSE (Server-Sent Events) from nginx:**
- Board opens SSE connection to a new endpoint
- Backend pushes events as they occur
- Simpler than full WebSocket but one-directional (board can never send)

**Option C — Polling with WebSocket hybrid:**
- Keep current JSON polling for data refresh
- Add WebSocket only for high-priority events (errors, task completions, agent status changes)
- Fallback if WebSocket fails

**Recommendation:** Option C initially (easiest to implement), migrate to Option A as the gateway matures. The gateway already has the agent dispatch relationship — it knows when things happen.

### Data Flow

```
Agents → Shared-Log → Gateway → [WebSocket] → Board → UI
                ↑                         ↓
                ← [Commands] ← Board Input
```

Commands (restart service, cancel task, create task) flow back through the gateway to the appropriate agent listener or systemd service.

---

## Part III: 10-Version Roadmap

### Version 1 — Real-Time Bridge
**Goal:** Replace 10s polling with live updates. Board always shows current state.

**Features:**
- WebSocket connection to gateway (or SSE endpoint)
- Live agent status updates — status change visible within 1s
- Live task pipeline updates — cards move columns without refresh
- Connection status indicator (connected/reconnecting/offline)
- Automatic reconnection with exponential backoff
- Shared-log tail panel — last 20 entries visible in a slide-out drawer

**Technical:**
- Add `ws://` connection to `board.html`
- Gateway emits events: `agent:status`, `task:created`, `task:moved`, `task:done`, `error:new`
- Board maintains local state cache updated by WebSocket events
- Continue polling as fallback for 30s after WebSocket failure

**Files changed:** `board.html` (+100 lines for WebSocket layer)

---

### Version 2 — Service Control
**Goal:** Restart, stop, start individual agent listeners from the board.

**Features:**
- Agent cards gain action buttons: Restart, Disable, Enable
- Confirmation modal before destructive actions (type agent name to confirm)
- Action dispatched via gateway → appropriate listener or systemd
- Audit log entry created for each action (who, what, when)
- Visual feedback: agent card pulses while action is in progress

**Agent action types:**
| Action | Target | Mechanism |
|--------|--------|-----------|
| Restart listener | `vicious-discord-listener.service` | `systemctl --user restart` |
| Pause agent | Add `[PAUSED]` tag in shared-log | Dispatcher skips agent |
| Resume agent | Remove `[PAUSED]` tag | Dispatcher resumes |
| Kill stuck process | Specific PID | `kill -9` via SSH |
| Trigger healthcheck | `vicious-cli-healthcheck.sh` | Run immediately |

**Technical:**
- New REST endpoint on gateway: `POST /board/command` with `{agent, action, params}`
- Board sends command via WebSocket or fetch to gateway
- Gateway executes via existing SSH access, streams result back
- New panel in board: "Activity Log" showing last 50 actions

---

### Version 3 — Command Palette
**Goal:** Give Vito keyboard-driven superpowers. Everything accessible without clicking.

**Features:**
- `Cmd+K` / `Ctrl+K` opens command palette
- Fuzzy search across all actions: restart agent, go to channel, search tasks, run deploy
- Recent commands shown by default
- Command categories: Agents, Tasks, Deploys, Navigation, System
-权限 check before showing actions (Vito only gets all, others get subset)
- Execute command → result shown in inline toast

**Command examples:**
```
> restart vicious
> restart ed listener
> pause andy
> deploy mission control
> show shared-log
> show gren
> cancel last task
> restart all listeners
```

**Technical:**
- Command palette is pure frontend overlay on `board.html`
- State stored in `localStorage` for recent commands
- Commands dispatched via gateway REST endpoint
- Fuzzy search via lightweight library (Fuse.js, ~5KB)

---

### Version 4 — Org Chart
**Goal:** Visual map of the agent hierarchy and communication topology.

**Features:**
- Dedicated "Org" tab showing agent hierarchy
- Supervisor → report relationships shown as tree
- Model, role, current task, and status per agent node
- Lines colored by relationship type (reports-to, works-with, monitors)
- Click agent node → side panel with full details + quick actions
- Filter by: role, model, status, availability

**Agent metadata to add to `config.js`:**
```javascript
{
  id: 'vicious',
  name: 'Vicious',
  role: 'Operations',
  model: 'MiniMax-M2.7-highspeed',
  status: 'working',          // online|busy|idle|offline|paused
  supervisor: 'spike',       // who assigns work to this agent
  reports: ['ed', 'faye'],   // inverse of supervisor
  capabilities: ['discord', 'code', 'deploy'],  // what it can do
  owner: 'vito',             // who owns/built this agent
  tier: 'production',        // production|staging|experimental
  notes: '...',
}
```

**Visualization options:**
- **D3.js tree** — good for hierarchy, but heavy
- **CSS Grid + absolute positioning** — lighter, easier to style to match board
- **Canvas with a small library** — balance of flexibility and size
- **Recommendation:** CSS Grid with absolutely positioned agent cards, SVG lines for connections. Lighter than D3, sufficient for 10-50 agents.

---

### Version 5 — Task Management
**Goal:** Create, edit, assign, and close tasks from the board.

**Features:**
- "New Task" button → modal form
- Fields: title, description, priority (low/medium/high/critical), assignee agent, due timestamp, tags
- Task appears in Queued column immediately (optimistic UI)
- Edit task inline — click any field to modify
- Drag cards between columns to change status (manual override of agent automation)
- When status changes, audit log entry created
- Task detail panel — full history of status changes, comments, linked agents

**Task schema:**
```json
{
  "id": "uuid",
  "title": "string",
  "description": "string",
  "status": "queued|in_progress|done|cancelled|blocked",
  "priority": "low|medium|high|critical",
  "assignee": "agent-id|null",
  "createdBy": "human|agent-id",
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp",
  "completedAt": "ISO timestamp|null",
  "tags": ["string"],
  "dependsOn": ["task-id"],
  "proof": "string (link to completion evidence)"
}
```

**Backend:** Tasks stored in `mission-control-live.json` alongside agents. New `tasks` array. Gateway exposes `POST /tasks`, `PATCH /tasks/:id`, `DELETE /tasks/:id`.

---

### Version 6 — Shared-Log Integrator
**Goal:** Make the shared-log a first-class citizen of the board. See what agents are actually doing.

**Features:**
- Shared-log panel with real-time streaming entries
- Filter by: agent, tag type ([needs-X], [done-X], [block], [escalate]), time range, keyword search
- Highlight patterns: new tasks in yellow, completions in green, blocks in red
- Click entry → detail modal with full context (previous 5 entries, next 5 entries)
- Pause/resume stream
- Export filtered log to clipboard or file

**Technical:**
- Gateway exposes `GET /shared-log?filter=...&limit=...` for initial load
- WebSocket channel `shared-log:new` for streaming new entries
- Log viewer is a virtualized list (only render visible rows) for performance with 10k+ entries

---

### Version 7 — Configuration Editor
**Goal:** Modify agent configurations, add new agents, change roles — from the board.

**Features:**
- Agent configuration panel — edit agent properties inline
- "Add Agent" wizard — guided form to add new agent (name, role, model, channel, token)
- Validate before save — check that model is available, channel ID exists, token is valid
- Preview changes before applying
- Changes written to `config.js` on staging → deploy script → nginx
- Versioned config — each config change creates a snapshot before applying

**Safety:**
- "Test mode" toggle — changes apply to staging config only, don't affect production
- Explicit deploy button to push staging → production
- All changes logged with diff (before/after)

---

### Version 8 — Deploy Console
**Goal:** Full deploy management with rollback, promotion, and staging control.

**Features:**
- Deploy panel shows: commit, branch, files changed, author, timestamp, duration, status
- "Rollback" button on any past deploy — one-click revert to previous version
- "Promote" button — push staging config to production deploy
- "Cancel" button on in-progress deploys
- Live deploy log streaming — see real-time output of deploy script
- Deploy comparison — diff view of what changed between two deploys
- Commit message editor — can amend commit message after deploy

**Rollback mechanism:**
- `mc-deploy.sh` already writes deploy history
- Rollback = re-run `mc-deploy.sh` with previous commit SHA as `COMMIT_SHA`
- Pre-rollback confirmation with diff preview

---

### Version 9 — Notification Center & Alerting
**Goal:** Proactive alerting when things go wrong. Board as the nerve center.

**Features:**
- Notification bell icon in header with unread count
- Alert types: agent-down, task-stuck (>30min in same status), cron-error-spike, deploy-failed, disk-warning, memory-warning
- Severity levels: info (blue), warning (amber), critical (red)
- Notification panel — list of all alerts with timestamp, dismiss, snooze (15m/1h/1d)
- Alert rules editor — configure thresholds (e.g., cron error rate > 3 in 10min = critical)
- Browser push notifications when board is in background
- Alert → can create task directly from notification

**Alert sources:**
- Gateway monitors: agent heartbeats (missed 3 polls = down), cron error webhook, deploy webhook
- Board client monitors: task stuck detection, deploy failure polling
- Agents can emit: `[block]`, `[escalate]` tags in shared-log trigger alerts

---

### Version 10 — Permission System & Multi-User
**Goal:** Board supports multiple operators with scoped permissions. Vito can invite others.

**Features:**
- User identities: who is logged into the board (Discord OAuth?)
- Permission scopes: viewer (read-only), operator (can act), admin (can configure, can add agents)
- Per-action permission checks: restart requires `operator`, edit config requires `admin`
- Session tracking: who's currently viewing the board
- Activity per-user audit log
- "Impersonate" mode for admin to see board as another user would

**Technical:**
- Permission store in `config.js` alongside agents
- Gateway validates actions against permissions before executing
- Board stores session token in `localStorage`
- No full auth system — use short-lived tokens from a shared secret for initial version

---

## Part IV: Org Chart & Hierarchy Design

### Current Flat Model
Today all 10 agents are peers — displayed in a grid, equal importance. This reflects how they were set up but doesn't reflect how work actually flows.

### Proposed Hierarchy
```
Spike (Orchestrator / Human in the loop)
├── Vicious (Ops Lead / Dispatcher)
│   ├── Ed (Code)
│   ├── Faye (Research)
│   └── Gren (IronThread / Media)
├── Jet (Operations / Infrastructure)
│   ├── Andy (Host Exec)
│   └── Ein (Finance)
├── Punch (Review / QA)
└── Julia, Rocco (Future: retired from board, code/Media merged into Ed/Faye)
```

### Metadata Model
```javascript
{
  id: 'vicious',
  name: 'Vicious',
  codeName: 'Vicious',  // bebop reference
  role: 'Operations Lead',
  roleCategory: 'ops',  // ops|code|research|review|infrastructure|meta
  model: 'MiniMax-M2.7-highspeed',
  modelProvider: 'MiniMax',
  supervisor: 'spike',  // null for Spike
  reports: ['ed', 'faye', 'gren'],
  status: 'online',  // online|busy|idle|offline|paused|error
  currentTask: { id: '...', title: '...', startedAt: '...' },
  capabilities: ['discord', 'task-dispatch', 'deploy', 'code-review'],
  tier: 'production',  // production|beta|experimental
  ownedBy: 'vito',
  channels: ['#ed-andy', '#agent-lounge'],
  activeSince: '2026-01-15',
  stats: { tasksCompleted: 142, avgTaskDuration: '12m', uptime: '99.2%' }
}
```

### Visualization
- **Primary view:** Top-down tree (supervisor at top, reports below)
- **Secondary view:** Force-directed graph (agents that communicate frequently cluster together)
- **Status colors:** Green (online/idle), Blue (busy), Amber (warning), Red (error/offline)
- **Lines:** Solid for reports-to, dashed for communication-heavy links, dotted for occasional

---

## Part V: Pipeline & Controls Design

### Task Lifecycle
```
[needs-X] → Dispatcher sees tag → Spawns agent → [active-X]
  → Agent reports done → [done-X] → Task moves to Done column
  → Task stays stuck → Escalation after threshold
```

### Manual Intervention Points
1. **Create task** — human or agent posts to shared-log with `[needs-X]`
2. **Reassign** — drag task card to different agent column → writes new `[needs-Y]` tag
3. **Cancel task** — right-click → cancel → writes `[cancelled]` tag
4. **Block task** — right-click → block → posts `[block]` to shared-log
5. **Override agent** — click agent → pause → dispatcher skips, agent goes idle

### Automation vs Manual
| Action | Automated? | Manual Control |
|--------|-----------|----------------|
| Task dispatch | Yes — by tag | Can intercept before dispatch |
| Task completion | Yes — agent posts | Can override completion |
| Agent restart on failure | Yes — systemd auto-restart | Can disable auto-restart |
| Cron execution | Yes — cron schedule | Can pause/resume cron |
| Deploy | Yes — on push | Can rollback |
| New agent onboarding | No | Full manual via Config Editor |

---

## Part VI: Communication & Evolution

### How the Board Communicates Status to Vito
1. **Live presence** — Vito opens board, sees real-time state within 1s
2. **Notification bell** — proactive alerts when something needs attention
3. **Agent status ring** — color-coded ring around agent avatar
4. **Task pipeline** — Kanban columns show volume and flow
5. **Deploy timeline** — shows what's been deployed and when
6. **Shared-log drawer** — shows actual agent activity in real time
7. **Activity log** — shows what Vito or other operators have done

### How Vito Drives the System
1. **Command palette** (`Cmd+K`) — fast keyboard-driven actions
2. **Agent cards** — click for detail panel + actions
3. **Task cards** — drag to reassign, right-click to modify
4. **Config editor** — full control over agent configurations
5. **Deploy console** — full deployment lifecycle management

### Evolution Process
1. **Version tagged releases** — each version is a commit with a tag `mc-v1`, `mc-v2`, etc.
2. **Staging first** — all changes deploy to staging (jarvis:8090) before production
3. **Feature flags** — new panels/buttons gated by version number in `config.js`
4. **Shared-log as source of truth** — all agent actions logged to shared-log, board reads from there
5. **Incremental rewrites** — refactor `board.html` gradually, not a full rewrite

---

## Part VII: Key Technical Decisions

### Framework Question
**Should we rewrite in React/Vue, or keep vanilla JS?**

| Factor | Vanilla (current) | React | Vue |
|--------|-----------------|-------|-----|
| Rewrites needed | No | Yes — full rewrite | Yes — full rewrite |
| State management | Manual DOM | Built-in | Built-in |
| Team size | 1-2 | 1-2 (overkill) | 1-2 (overkill) |
| Performance | Fine for 10 agents | Fine | Fine |
| Risk | Accumulated complexity | Rewrite risk | Rewrite risk |

**Recommendation:** Keep vanilla JS for now. The board is 1766 lines — manageable. Add a lightweight state management layer (simple pub/sub pattern) to separate data from rendering. Consider React only if the board grows beyond ~3000 lines and the vanilla JS becomes unmaintainable.

### State Management Pattern (Vanilla JS)
```javascript
// Simple pub/sub store
const Store = {
  state: { agents: [], tasks: [], logs: [], alerts: [] },
  subscribers: [],
  subscribe(fn) { this.subscribers.push(fn) },
  setState(key, value) {
    this.state[key] = value;
    this.subscribers.forEach(fn => fn(key, value));
  }
};
// Render functions subscribe and re-render on state change
```

### WebSocket vs Polling
**Decision:** Hybrid initially.
- Keep existing 10s polling for full state sync (simple, reliable)
- Add WebSocket for event-driven updates (errors, completions, status changes)
- WebSocket message format: `{ type: 'event', channel: 'agents', data: {...} }`
- If WebSocket dies, fall back to polling
- Graduate to full WebSocket state sync in v3-v4 once reliability proven

### Mobile Strategy
**Decision:** Not a priority for v1-v6. Tablet/mobile is nice-to-have but:
- Vito's primary use is desktop (Spike's Lab ops station)
- Add basic responsive breakpoints in v4 (make it usable on tablet)
- Full mobile UI in v7+ only if use case emerges

### Persistence
- `mission-control-live.json` becomes the persistent state store
- Board reads from it; agents write to it via gateway
- Deploy history in `deployHistory.json` (append-only)
- Tasks in `mission-control-live.json.tasks[]` array
- Audit log: new `audit-log.json` (append-only, rotate monthly)

---

## Part VIII: Implementation Priority & Effort Estimate

### Quick Wins (1-2 days each)
| Version | Feature | Effort | Impact |
|---------|---------|--------|--------|
| v1 | WebSocket real-time | 1 day | High — board feels alive |
| v1 | Shared-log drawer | 0.5 days | High — see agent activity |
| v2 | Service restart buttons | 0.5 days | High — stop needing SSH |
| v3 | Command palette | 1 day | High — superpowers |

### Medium Effort (3-5 days)
| Version | Feature | Effort |
|---------|---------|--------|
| v4 | Org chart | 3 days |
| v5 | Task management | 5 days |
| v6 | Shared-log integration | 3 days |

### Heavy Lift (5+ days)
| Version | Feature | Effort |
|---------|---------|--------|
| v7 | Config editor | 5 days |
| v8 | Deploy console + rollback | 5 days |
| v9 | Notification center | 5 days |
| v10 | Permissions + multi-user | 7+ days |

**Total estimated:** 35-45 days of development work across all versions.

---

## Appendix: Inspirations & References

### Dashboards Studied
- **NASA Mission Control** — split-screen panels, status lights, alert hierarchy
- **Datadog** — manageboard with live preview, granular permissions, full audit trail
- **Linear** — keyboard-first UX, inline editing, optimistic UI, activity feed
- **Vercel** — deploy timeline, instant rollback, environment promotion
- **Grafana** — annotation system, time-range selection, dashboard versioning
- **Linear** — per-field undo, soft delete, conflict resolution

### Key Patterns to Steal
1. **Optimistic UI** (Linear) — show change immediately, rollback if server rejects
2. **Command palette** (Linear, Vercel, Raycast) — everything reachable from keyboard
3. **Type-to-confirm** (Vercel, Datadog) — destructive actions require typing to confirm
4. **Toast with undo** (Grafana, Linear) — 5-10 second undo window for reversible actions
5. **Audit log with diff** (Datadog, Linear) — every change recorded with before/after
6. **Status ring** (NASA, Datadog) — colored ring around agent/node = status at a glance
7. **Virtualized list** (Discord, Linear) — only render visible rows for 10k+ item lists
