import { agents, office } from './config.js';
window._mcAgents = agents;

const WALK_SPEED = 44;
const STATUS_COLORS = {
    idle:    0x475569,
    working: 0x22c55e,
    meeting: 0x8b5cf6,
    transit: 0x38bdf8,
    error:   0xef4444,
    offline: 0x64748b,
};

const BEBOP_FRAMES = {
    main:       0,  // Spike
    ops:        1,  // Jet
    research:   2,  // Faye
    finance:    3,  // Ein
    ironthread: 4,  // Gren
    code:       5,  // Ed
    media:      6,  // Julia
    local:      7,  // Rocco
    punch:      8,  // Punch
    andrew:     9,  // Andy
};
const BEBOP_FRAME_W = 512;
const BEBOP_FRAME_H = 341;
const BEBOP_COLS = 3;

const zones = {
    briefing: { x: 540, y: 310 },
    lounge:   { x: 1140, y: 560 },
    server:   { x: 1140, y: 175 },
    coding:   { x: 540, y: 560 },
};

const state = {
    bebopSheet: null,
    scene: null,
    agents: new Map(),
    selectedId: null,
    socket: null,
    reconnectTimer: null,
    pingTimer: null,
    reconnectAttempt: 0,
    activity: [],
    onlineCountText: null,
    clockText: null,
    feedEntries: [],
    feedPollTimer: null,
    feedTickerText: null,
    tickerOffset: 0,
    liveSessions: new Map(),
    sessionPollTimer: null,
    costPollTimer: null,
    wsRequestId: 0,
    liveData: null,
    liveDataTimer: null,
    gatewayReady: false,
    connectNonce: null,
    connectSent: false,
    deviceIdentity: null,
    pendingRequests: new Map(),
    dataLines: [],
    dataParticles: [],
    dayNightOverlay: null,
    deskLights: [],
};


// -- Notification system --
var notifCount = 0;
function playNotifSound() {
    try {
        var ctx = new (window.AudioContext || window.webkitAudioContext)();
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        osc.type = 'sine';
        gain.gain.value = 0.08;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.stop(ctx.currentTime + 0.3);
    } catch(e) {}
}
function bumpNotifBadge(text) {
    notifCount++;
    var badge = document.getElementById('notif-badge');
    if (badge) { badge.textContent = notifCount + ' alert' + (notifCount > 1 ? 's' : ''); badge.style.display = ''; }
    playNotifSound();
}

const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: office.width,
    height: office.height,
    parent: 'game-root',
    backgroundColor: '#0b1020',
    pixelArt: true,
    scene: { preload, create, update },
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
    },
});

window.missionControl = {
    selectAgent,
    injectEvent: applyGatewayEvent,
    getState: () => ({
        selectedId: state.selectedId,
        agents: [...state.agents.values()].map(stripRuntimeFields),
        activity: state.activity.slice(0, 20),
    }),
};

function preload() {
    this.textures.addCanvas('floor-tile',  genFloorTile());
    this.textures.addCanvas('wall-tile',   genWallTile());
    this.textures.addCanvas('desk-tile',   genDeskTile());
    this.textures.addCanvas('chair-tile',  genChairTile());
    this.textures.addCanvas('table-tile',  genTableTile());
    this.textures.addCanvas('plant-tile',  genPlantTile());
    this.textures.addCanvas('server-tile', genServerTile());
    this.textures.addCanvas('coffee-tile', genCoffeeTile());
    this.textures.addCanvas('window-tile', genWindowTile());

    // Load Bebop portrait sheet (used in HTML panel only, not in-game sprites)
    var img = new Image();
    img.onload = function() { state.bebopSheet = img; };
    img.crossOrigin = 'anonymous';
    img.src = 'assets/bebop-sprites.png';

    // Generate procedural agent sprites for the game view
    for (var i = 0; i < agents.length; i++) {
        this.textures.addCanvas('agent-' + agents[i].id, genAgentSprite(agents[i]));
    }
}

function create() {
    state.scene = this;
    drawOffice(this);
    drawTitle(this);
    createDataLines(this);
    createDayNightLighting(this);
    startAmbientOfficeDetails(this);
    createRuntimeAgents(this);
    if (window.buildCrewGrid) window.buildCrewGrid([...state.agents.values()].map(function(a){ return {id:a.id,name:a.name,emoji:a.emoji,status:a.status,color:a.color}; }));
    connectOverlay();
    connectGateway();
    startLiveDataPolling();
    startAmbientSimulation(this);
    startClock(this);
    startPanelRefresh(this);
    startSystemHealthSimulation();
    updateHudPills();
    updateGlobalPolicyHUD();
    selectAgent('main');
    pushActivity('Mission Control v3 booted.');
}

function update(_time, delta) {
    for (var runtime of state.agents.values()) {
        updateAgentMovement(runtime, delta);
        updateBubble(runtime);
    }
    updateDataParticles(delta);
    updateDayNightLighting();
    // Feed ticker
    if (state.feedTickerText && state.feedEntries && state.feedEntries.length > 0) {
        var latest = state.feedEntries[0];
        var tickerMsg = (latest.agent ? '[' + latest.agent + '] ' : '') + (latest.text || '').slice(0, 100);
        state.feedTickerText.setText('Feed: ' + tickerMsg);
    }
}

// ── Data Flow Lines ──

function createDataLines(scene) {
    // Lines connecting agents to Ein (center hub) and between collaborating pairs
    var einDesk = office.deskPositions[3]; // Ein is desk 3

    // Create lines from each agent to Ein (the hub)
    agents.forEach(function(agent) {
        if (agent.id === 'finance') return; // Ein is the hub
        var desk = office.deskPositions[agent.desk];
        var line = scene.add.graphics().setDepth(1);
        state.dataLines.push({
            from: { x: desk.x, y: desk.y },
            to: { x: einDesk.x, y: einDesk.y },
            color: Phaser.Display.Color.HexStringToColor(agent.color).color,
            agentId: agent.id,
            graphics: line,
            phase: Math.random() * Math.PI * 2,
        });
    });

    // Spawn particle flow on a timer
    scene.time.addEvent({
        delay: 800,
        loop: true,
        callback: function() {
            // Pick a random active line and spawn a data particle
            var activeAgents = [...state.agents.values()].filter(function(a) {
                return a.status === 'working' || a.status === 'meeting';
            });
            if (activeAgents.length === 0) return;
            var agent = Phaser.Utils.Array.GetRandom(activeAgents);
            if (agent.id === 'finance') return;
            var line = state.dataLines.find(function(l) { return l.agentId === agent.id; });
            if (!line) return;

            // 50% chance send toward Ein, 50% from Ein
            var toEin = Math.random() > 0.5;
            var start = toEin ? line.from : line.to;
            var end = toEin ? line.to : line.from;
            var color = line.color;

            var particle = scene.add.circle(start.x, start.y, 3, color, 0.9).setDepth(2);
            var glow = scene.add.circle(start.x, start.y, 6, color, 0.25).setDepth(1);

            state.dataParticles.push({
                dot: particle,
                glow: glow,
                sx: start.x, sy: start.y,
                ex: end.x, ey: end.y,
                progress: 0,
                speed: 0.4 + Math.random() * 0.4, // ~0.4-0.8 per second
            });
        },
    });
}

function updateDataParticles(delta) {
    var scene = state.scene;
    // Draw base lines
    state.dataLines.forEach(function(line) {
        line.phase += delta * 0.001;
        var g = line.graphics;
        g.clear();
        // Dim base line
        var alpha = 0.08 + 0.04 * Math.sin(line.phase);
        g.lineStyle(1, line.color, alpha);
        g.beginPath();
        g.moveTo(line.from.x, line.from.y);
        g.lineTo(line.to.x, line.to.y);
        g.strokePath();
    });

    // Update particles
    for (var i = state.dataParticles.length - 1; i >= 0; i--) {
        var p = state.dataParticles[i];
        p.progress += (p.speed * delta) / 1000;
        if (p.progress >= 1) {
            p.dot.destroy();
            p.glow.destroy();
            state.dataParticles.splice(i, 1);
            continue;
        }
        var t = p.progress;
        // Ease in-out
        t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        var cx = p.sx + (p.ex - p.sx) * t;
        var cy = p.sy + (p.ey - p.sy) * t;
        p.dot.setPosition(cx, cy);
        p.glow.setPosition(cx, cy);
        p.dot.setAlpha(0.8 + 0.2 * Math.sin(p.progress * Math.PI));
        p.glow.setAlpha(0.15 + 0.1 * Math.sin(p.progress * Math.PI));
    }
}

// ── Day/Night Lighting (Tier 2C) ──

var sunMoonText = null;

function getNYCHour() {
    return new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }) | 0;
}

function createDayNightLighting(scene) {
    state.dayNightOverlay = scene.add.rectangle(office.width / 2, office.height / 2, office.width, office.height, 0x080820, 0)
        .setDepth(49).setScrollFactor(0).setInteractive({ useHandCursor: false });

    state.dayNightOverlay.setInteractive = function() {};

    office.deskPositions.forEach(function(desk) {
        var light = scene.add.circle(desk.x, desk.y - 8, 16, 0xf5c842, 0)
            .setDepth(3).setScrollFactor(0);
        var glow = scene.add.circle(desk.x, desk.y - 8, 24, 0xf5c842, 0)
            .setDepth(2).setScrollFactor(0);
        state.deskLights.push({ light: light, glow: glow });
    });

    sunMoonText = scene.add.text(26, 26, '\u2600\uFE0F',
        { fontFamily: 'monospace', fontSize: '14px', color: '#fbbf24' })
        .setOrigin(0, 0.5).setDepth(200);

    updateDayNightLighting();

    scene.time.addEvent({
        delay: 300000,
        loop: true,
        callback: updateDayNightLighting,
    });
}

function updateDayNightLighting() {
    if (!state.dayNightOverlay) return;
    var hour = getNYCHour();
    var overlayAlpha = 0, deskAlpha = 0, glowAlpha = 0, icon = '\u2600\uFE0F', color = '#fbbf24';

    if (hour >= 10 && hour < 17) {
        // Day — nothing
    } else if (hour >= 6 && hour < 10) {
        // Dawn: fade from night -> day
        var progress = (hour - 6) / 4;
        overlayAlpha = 0.05 * (1 - progress);
        deskAlpha = 0.5 * (1 - progress);
        glowAlpha = 0.10 * (1 - progress);
        icon = '\u{1F305}';
        color = '#f97316';
    } else if (hour >= 17 && hour < 21) {
        // Sunset: fade day -> night
        var sunProgress = (hour - 17) / 4;
        overlayAlpha = 0.10 * sunProgress;
        deskAlpha = 0.5 * sunProgress;
        glowAlpha = 0.10 * sunProgress;
        icon = '\u{1F306}';
        color = '#f59e0b';
    } else {
        // Night: 21:00 -- 06:00 -- dark overlay
        overlayAlpha = 0.10;
        deskAlpha = 0.50;
        glowAlpha = 0.12;
        icon = '\u{1F319}';
        color = '#818cf8';
    }

    state.dayNightOverlay.setFillStyle(0x080820, overlayAlpha);
    state.deskLights.forEach(function(dl) {
        dl.light.setFillStyle(0xf5c842, deskAlpha);
        dl.glow.setFillStyle(0xf5c842, glowAlpha);
    });
    if (sunMoonText) {
        sunMoonText.setText(icon);
        sunMoonText.setColor(color);
    }
}

// ── Clock ──

function startPanelRefresh(scene) {
    scene.time.addEvent({
        delay: 10000,
        loop: true,
        callback: function() {
            if (state.selectedId) {
                var runtime = state.agents.get(state.selectedId);
                if (runtime) {
                    setText('agent-updated', formatRelative(runtime.lastUpdate));
                    setText('agent-updated-mini', formatRelative(runtime.lastUpdate));
                }
            }
        }
    });
}

function startClock(scene) {
    updateClock();
    scene.time.addEvent({ delay: 30000, loop: true, callback: updateClock });
}

function updateClock() {
    if (!state.clockText) return;
    var now = new Date();
    var parts = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });
    state.clockText.setText(parts + ' ET');
}

// ── Agent creation ──

function createRuntimeAgents(scene) {
    agents.forEach(function(agent) {
        var desk = office.deskPositions[agent.desk];
        var baseY = desk.y + 6;

        var shadow = scene.add.ellipse(desk.x, baseY + 4, 28, 10, 0x000000, 0.35);
        var halo   = scene.add.circle(desk.x, baseY, 22, STATUS_COLORS[agent.status] || STATUS_COLORS.idle, 0.45);
        var sprite = scene.add.image(desk.x, baseY, 'agent-' + agent.id).setOrigin(0.5, 1).setDepth(baseY);

        var bubbleBox  = scene.add.rectangle(desk.x, baseY - 102, 140, 28, 0x0f172a, 0.96)
            .setStrokeStyle(1, Phaser.Display.Color.HexStringToColor(agent.color).color)
            .setDepth(baseY + 10);
        var bubbleText = scene.add.text(desk.x, baseY - 102, agent.name + ' \u2022 ' + agent.status, textStyle(9, '#e2e8f0'))
            .setOrigin(0.5).setDepth(baseY + 11);

        var nameText  = scene.add.text(desk.x, desk.y + 28, agent.emoji + ' ' + agent.name, textStyle(11, '#f8fafc')).setOrigin(0.5, 0);
        var roleText  = scene.add.text(desk.x, desk.y + 43, agent.role, textStyle(9, '#94a3b8')).setOrigin(0.5, 0);
        var bebopText = scene.add.text(desk.x, desk.y + 56, agent.bebop, textStyle(8, agent.color)).setOrigin(0.5, 0);

        var dotColor  = STATUS_COLORS[agent.status] || STATUS_COLORS.idle;
        var statusDot = scene.add.circle(desk.x + 14, desk.y + 33, 4, dotColor).setDepth(baseY + 5);

        sprite.setInteractive({ useHandCursor: true });
        sprite.on('pointerdown', function() { selectAgent(agent.id); });
        function clampTooltip(tt, x, y) {
            var vw = window.innerWidth, vh = window.innerHeight;
            var rect = tt.getBoundingClientRect();
            var tx = Math.min(x, vw - rect.width - 4);
            var ty = Math.min(y, vh - rect.height - 4);
            tx = Math.max(4, tx);
            ty = Math.max(4, ty);
            tt.style.left = tx + 'px';
            tt.style.top = ty + 'px';
        }
        sprite.on('pointerover', function(pointer, localX, localY, event) { 
            bubbleBox.setFillStyle(0x172554, 0.98); 
            halo.setFillStyle(STATUS_COLORS[agent.status] || STATUS_COLORS.idle, 0.75);
            sprite.setScale(1.1);
            var tt = document.getElementById('agent-tooltip');
            if (tt && event) {
                tt.style.display = 'block';
                clampTooltip(tt, event.clientX + 20, event.clientY);
                tt.style.borderColor = agent.color;
                document.getElementById('tt-name').textContent = agent.emoji + ' ' + agent.name;
                document.getElementById('tt-name').style.color = agent.color;
                document.getElementById('tt-role').textContent = agent.role;
                document.getElementById('tt-model').textContent = agent.model || 'gemini-2.5-flash';
                var rt = state.agents.get(agent.id);
                document.getElementById('tt-status').textContent = (rt ? rt.status : agent.status).toUpperCase();
                var cost = (state.liveData && state.liveData.costs && state.liveData.costs[agent.id]) ? state.liveData.costs[agent.id] : 0;
                document.getElementById('tt-cost').textContent = '$' + cost.toFixed(4);
            }
        });
        sprite.on('pointerout', function() { 
            bubbleBox.setFillStyle(0x0f172a, 0.96); 
            halo.setFillStyle(STATUS_COLORS[agent.status] || STATUS_COLORS.idle, 0.45);
            sprite.setScale(1);
            var tt = document.getElementById('agent-tooltip');
            if (tt) tt.style.display = 'none';
        });
        // Tooltip stays anchored at position set by pointerover; no jittery pointermove

        var runtime = Object.assign({}, agent, {
            sprite: sprite,
            shadow: shadow,
            halo: halo,
            bubbleBox: bubbleBox,
            bubbleText: bubbleText,
            nameText: nameText,
            roleText: roleText,
            bebopText: bebopText,
            statusDot: statusDot,
            x: desk.x, y: baseY,
            deskX: desk.x, deskY: baseY,
            walkPhase: Math.random() * Math.PI * 2,
            currentTarget: null,
            targetQueue: [],
            message: agent.name + ' standing by',
            lastUpdate: Date.now(),
            pulseTween: null,
            chatHistory: [],
        });

        state.agents.set(agent.id, runtime);
        applyStatusVisuals(runtime);
    });
}

function applyStatusVisuals(runtime) {
    var scene = state.scene;
    var dotColor = STATUS_COLORS[runtime.status] || STATUS_COLORS.idle;
    runtime.statusDot.setFillStyle(dotColor);
    runtime.halo.setFillStyle(dotColor, runtime.status === 'working' ? 0.20 : 0.12);

    if (runtime.pulseTween) { runtime.pulseTween.stop(); runtime.pulseTween = null; }

    if (runtime.status === 'working' && scene) {
        runtime.pulseTween = scene.tweens.add({
            targets: runtime.halo,
            alpha: { from: 0.10, to: 0.30 },
            duration: 900,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });
    }

    if (runtime.status === 'error' && scene) {
        runtime.pulseTween = scene.tweens.add({
            targets: runtime.halo,
            alpha: { from: 0.15, to: 0.40 },
            duration: 500,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });
    }

    if (runtime.status === 'offline') {
        runtime.sprite.setAlpha(0.3);
        runtime.halo.setAlpha(0.3);
        runtime.nameText.setStyle(textStyle(11, '#475569'));
    } else {
        runtime.sprite.setAlpha(1);
        runtime.nameText.setStyle(textStyle(11, '#f8fafc'));
    }

    // Update bubble color based on status
    var bubbleColor = runtime.status === 'error' ? 0x2d0a0a : runtime.status === 'working' ? 0x0a1a0a : 0x0f172a;
    runtime.bubbleBox.setFillStyle(bubbleColor, 0.96);
}

function updateAgentMovement(runtime, delta) {
    if (!runtime.currentTarget && runtime.targetQueue.length) {
        runtime.currentTarget = runtime.targetQueue.shift();
    }
    if (!runtime.currentTarget) return;

    var target = runtime.currentTarget;
    var dx = target.x - runtime.x;
    var dy = target.y - runtime.y;
    var distance = Math.hypot(dx, dy);
    var step = (WALK_SPEED * delta) / 1000;

    if (distance <= step || distance < 1) {
        runtime.x = target.x;
        runtime.y = target.y;
        runtime.currentTarget = null;
        if (target.onArrive) target.onArrive(runtime);
    } else {
        runtime.x += (dx / distance) * step;
        runtime.y += (dy / distance) * step;
        runtime.walkPhase += delta * 0.006;
    }

    var bobY = runtime.currentTarget ? Math.sin(runtime.walkPhase) * 1.5 : 0;

    runtime.sprite.setPosition(runtime.x, runtime.y + bobY).setDepth(runtime.y);
    runtime.shadow.setPosition(runtime.x, runtime.y + 4).setDepth(runtime.y - 1);
    runtime.halo.setPosition(runtime.x, runtime.y).setDepth(runtime.y - 2);
    runtime.bubbleBox.setPosition(runtime.x, runtime.y - 102).setDepth(runtime.y + 10);
    runtime.bubbleText.setPosition(runtime.x, runtime.y - 102).setDepth(runtime.y + 11);
}

function updateBubble(runtime) {
    var message = runtime.message || runtime.status;
    var label = runtime.name + ' \u2022 ' + message;
    var clipped = label.length > 36 ? label.slice(0, 35) + '\u2026' : label;
    runtime.bubbleText.setText(clipped);
    runtime.bubbleBox.width = Math.max(120, Math.min(260, clipped.length * 6.0 + 10));
}

function updateOnlineCount() {
    if (!state.onlineCountText) return;
    var online = [...state.agents.values()].filter(function(a) { return a.status !== 'offline'; }).length;
    state.onlineCountText.setText(online + '/' + state.agents.size + ' online');
    updateHudPills();
}

function updateHudPills() {
    var counts = { working: 0, idle: 0, meeting: 0, error: 0 };
    state.agents.forEach(function(a) {
        if (a.status === 'error') counts.error++;
        else if (a.status === 'meeting') counts.meeting++;
        else if (a.status === 'working' || a.status === 'transit') counts.working++;
        else counts.idle++;
    });
    var w  = document.getElementById('hud-working');
    var i  = document.getElementById('hud-idle');
    var m  = document.getElementById('hud-meeting');
    var er = document.getElementById('hud-error');
    if (w)  w.textContent  = 'Working ' + counts.working;
    if (i)  i.textContent  = 'Idle '    + counts.idle;
    if (m)  m.textContent  = 'Meeting ' + counts.meeting;
    if (er) er.textContent = 'Alerts '  + counts.error;
}

function moveAgentTo(runtime, point, opts) {
    opts = opts || {};
    var via = opts.via || [];
    runtime.targetQueue = via.concat([{ x: point.x, y: point.y, onArrive: opts.onArrive }]);
    runtime.currentTarget = null;
    runtime.status = opts.status || 'transit';
    runtime.message = opts.message || runtime.message;
    runtime.lastUpdate = Date.now();
    applyStatusVisuals(runtime);
    if (state.selectedId === runtime.id) syncOverlay(runtime);
}

function sendAgentHome(runtime, nextStatus) {
    nextStatus = nextStatus || 'idle';
    moveAgentTo(runtime, { x: runtime.deskX, y: runtime.deskY }, {
        status: 'transit',
        message: 'heading back to desk',
        onArrive: function(agent) {
            agent.status = nextStatus;
            agent.message = nextStatus === 'working' ? 'back at desk' : 'standing by';
            agent.lastUpdate = Date.now();
            applyStatusVisuals(agent);
            updateOnlineCount();
            if (state.selectedId === agent.id) syncOverlay(agent);
        },
    });
}

// ── Ambient simulation ──

var AMBIENT_MESSAGES = {
    main:       ['routing crew tasks', 'parsing shared-log', 'orchestrating handoffs', 'monitoring agents', 'reviewing heartbeat'],
    ops:        ['checking infra', 'verifying containers', 'reviewing disk usage', 'running health checks', 'patching system'],
    research:   ['browsing docs', 'running search', 'synthesizing notes', 'querying knowledge base', 'web scraping'],
    finance:    ['verifying spend', 'generating brief', 'checking API costs', 'reviewing budget', 'crypto prices'],
    ironthread: ['sequencing follow-ups', 'loading CSV', 'drafting email', 'processing leads', 'checking replies'],
    code:       ['writing tests', 'refactoring module', 'debugging function', 'reviewing diff', 'pushing commit'],
    media:      ['rendering frame', 'composing layout', 'editing copy', 'generating image', 'exporting asset'],
    local:      ['running model', 'sampling tokens', 'loading weights', 'benchmarking inference', 'quantizing'],
    punch:      ['reviewing output', 'checking criteria', 'validating result', 'filing report', 'QA pass'],
    andrew:     ['building artifacts', 'pushing deploy', 'running tests', 'compiling assets', 'reviewing diff'],
};

function startAmbientSimulation(scene) {
    scene.time.addEvent({
        delay: 12000,
        loop: true,
        callback: function() {
            var idleAgents = [...state.agents.values()].filter(function(a) {
                return ['idle', 'working'].includes(a.status) && !a.currentTarget && a.targetQueue.length === 0;
            });
            var runtime = Phaser.Utils.Array.GetRandom(idleAgents);
            if (!runtime) return;

            var roll = Math.random();
            if (roll < 0.15) {
                moveAgentTo(runtime, zones.briefing, {
                    status: 'meeting',
                    via: [{ x: runtime.x, y: runtime.y + 20 }],
                    message: 'heading to briefing',
                    onArrive: function(agent) {
                        agent.status = 'meeting';
                        agent.message = 'in a sync';
                        agent.lastUpdate = Date.now();
                        applyStatusVisuals(agent);
                        setTimeout(function() { sendAgentHome(agent, 'working'); }, 4000);
                    },
                });
                pushActivity(runtime.name + ' walked to the briefing table.');
            } else if (roll < 0.30) {
                moveAgentTo(runtime, zones.lounge, {
                    status: 'transit', message: 'coffee run',
                    onArrive: function(agent) {
                        agent.status = 'idle';
                        agent.message = 'grabbing coffee';
                        agent.lastUpdate = Date.now();
                        applyStatusVisuals(agent);
                        setTimeout(function() { sendAgentHome(agent, 'working'); }, 2800);
                    },
                });
                pushActivity(runtime.name + ' drifted to the lounge.');
            } else if (roll < 0.48) {
                moveAgentTo(runtime, zones.server, {
                    status: 'working', message: 'checking infra',
                    onArrive: function(agent) {
                        agent.status = 'working';
                        agent.message = 'checking systems';
                        agent.lastUpdate = Date.now();
                        applyStatusVisuals(agent);
                        setTimeout(function() { sendAgentHome(agent, 'idle'); }, 2500);
                    },
                });
                pushActivity(runtime.name + ' is at the server corner.');
            } else if (roll < 0.60 && (runtime.id === 'code' || runtime.id === 'local' || runtime.id === 'punch')) {
                moveAgentTo(runtime, zones.coding, {
                    status: 'working', message: 'pair coding',
                    onArrive: function(agent) {
                        agent.status = 'working';
                        agent.message = 'deep in code';
                        agent.lastUpdate = Date.now();
                        applyStatusVisuals(agent);
                        setTimeout(function() { sendAgentHome(agent, 'working'); }, 5000);
                    },
                });
                pushActivity(runtime.name + ' slipped into the coding corner.');
            } else {
                var msgs = AMBIENT_MESSAGES[runtime.id] || ['working'];
                runtime.message = msgs[Math.floor(Math.random() * msgs.length)];
                runtime.status = 'working';
                runtime.lastUpdate = Date.now();
                applyStatusVisuals(runtime);
            }
        },
    });
}

// ── Overlay ──

function connectOverlay() {
    if (connectOverlay._done) return;
    connectOverlay._done = true;
    var close = document.getElementById('close-panel');
    var send  = document.getElementById('send-chat');
    var input = document.getElementById('chat-input');
    if (close) close.addEventListener('click', function() { document.body.classList.remove('panel-open'); });
    if (send)  send.addEventListener('click', submitChat);
    if (input) input.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); submitChat(); } });
    var taskBtn = document.getElementById('create-task');
    if (taskBtn) taskBtn.addEventListener('click', function() { submitChat(true); });

    document.addEventListener('keydown', function(e) {
        if (e.target && e.target.tagName === 'INPUT') return;
        if (e.key === 'Escape') document.body.classList.remove('panel-open');
        // Number keys 1-9 select agents
        var num = parseInt(e.key);
        if (num >= 1 && num <= 9 && num <= agents.length) {
            selectAgent(agents[num - 1].id);
        }
        // Arrow keys cycle through agents
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            var ids = agents.map(function(a) { return a.id; });
            var idx = ids.indexOf(state.selectedId);
            if (idx === -1) idx = 0;
            else idx = e.key === 'ArrowRight' ? (idx + 1) % ids.length : (idx - 1 + ids.length) % ids.length;
            selectAgent(ids[idx]);
        }
    });
}

function submitChat(isTask) {
    var input = document.getElementById('chat-input');
    var text = (input ? input.value : '').trim();
    if (!text || !state.selectedId) return;

    var runtime = state.agents.get(state.selectedId);
    var sendText = isTask ? '[TASK] ' + text : text;
    runtime.message = (isTask ? 'task queued: ' : 'queued: ') + text;
    runtime.status = runtime.status === 'offline' ? 'offline' : 'working';
    runtime.lastUpdate = Date.now();
    pushActivity((isTask ? 'Task queued for ' : 'Chat queued for ') + runtime.name + ': ' + text);
    recordComment(runtime, 'You', (isTask ? '[Task] ' : '') + text);
    syncOverlay(runtime);
    input.value = '';

    if (state.socket && state.socket.readyState === WebSocket.OPEN) {
        var sessionKey = 'agent:' + runtime.id + ':main';
        var reqId = String(++state.wsRequestId);
        state.pendingRequests.set(reqId, { kind: 'send-message', runtimeId: runtime.id, text: sendText });
        var idempotencyKey = 'mc-' + reqId + '-' + Date.now();
        state.socket.send(JSON.stringify({
            type: 'req', id: reqId, method: 'chat.send',
            params: { sessionKey: sessionKey, message: sendText, idempotencyKey: idempotencyKey }
        }));
    }
}

function selectAgent(agentId) {
    var runtime = state.agents.get(agentId);
    if (!runtime) return;

    state.selectedId = agentId;
    document.body.classList.add('panel-open');

    for (var c of state.agents.values()) {
        var sel = c.id === agentId;
        c.sprite.setScale(sel ? 1.14 : 1);
        c.bubbleBox.setStrokeStyle(sel ? 2 : 1, Phaser.Display.Color.HexStringToColor(c.color).color);
    }
    syncOverlay(runtime);
    if (window.setAgentAccent) window.setAgentAccent(runtime.color);
    if (window.setSelectedCrewCard) window.setSelectedCrewCard(agentId);
}

function recordComment(runtime, sender, text) {
    if (!runtime.chatHistory) runtime.chatHistory = [];
    runtime.chatHistory.push({ sender: sender, text: text, ts: Date.now() });
    if (runtime.chatHistory.length > 100) runtime.chatHistory = runtime.chatHistory.slice(-100);
    if (state.selectedId === runtime.id) renderChatMessages(runtime);
}

function renderChatMessages(runtime) {
    var box = document.getElementById('chat-messages');
    if (!box) return;
    box.innerHTML = '';
    (runtime.chatHistory || []).forEach(function(entry) {
        var div = document.createElement('div');
        var cls = entry.sender === 'You' ? 'from-you' : (entry.sender === 'System' ? 'from-system' : 'from-agent');
        div.className = 'chat-msg ' + cls;
        var span = document.createElement('span');
        span.className = 'chat-sender';
        span.textContent = entry.sender + ':';
        div.appendChild(span);
        div.appendChild(document.createTextNode(entry.text));
        box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
}

function syncOverlay(runtime) {
    drawPortrait(runtime);
    renderChatMessages(runtime);
    setText('agent-name',    (runtime.emoji || '') + ' ' + runtime.name);
    setText('agent-bebop',   runtime.bebop);
    setText('agent-role',    runtime.role);
    setText('agent-model',   runtime.model);
    setText('agent-message', runtime.message || 'No current task');
    setText('agent-location', describeLocation(runtime));
    setText('agent-location-mini', describeLocation(runtime));
    setText('agent-updated-mini', formatRelative(runtime.lastUpdate));
    setText('agent-updated', formatRelative(runtime.lastUpdate));

    var pill = document.getElementById('agent-status-pill');
    if (pill) {
        pill.textContent = runtime.status.toUpperCase();
        var colors = { working: '#22c55e', idle: '#64748b', meeting: '#8b5cf6', transit: '#38bdf8', error: '#ef4444', offline: '#475569' };
        var sc = colors[runtime.status] || runtime.color;
        pill.style.color = sc;
        pill.style.borderColor = sc;
    }

    // Update performance bar
    const perfBar = document.getElementById('agent-perf-bar');
    if (perfBar) {
        // Simulated efficacy based on status and a random factor
        let efficacy = 85; 
        if (runtime.status === 'working') efficacy = 92 + Math.floor(Math.random() * 6);
        if (runtime.status === 'idle')    efficacy = 78 + Math.floor(Math.random() * 5);
        if (runtime.status === 'error')   efficacy = 45 + Math.floor(Math.random() * 10);
        
        perfBar.style.width = efficacy + '%';
        perfBar.style.backgroundColor = efficacy > 90 ? '#22c55e' : (efficacy > 70 ? 'var(--agent-color)' : '#ef4444');
    }

    var header = document.getElementById('panel-header');
    if (header) header.style.borderBottomColor = runtime.color;
    var nameEl = document.getElementById('agent-name');
    if (nameEl) nameEl.style.color = runtime.color;

    var log = document.getElementById('activity-log');
    if (log) {
        log.innerHTML = '';
        var agentFeedLogs = state.feedEntries
            ? state.feedEntries.filter(function(e) { return e.agent && e.agent.toLowerCase() === runtime.id.toLowerCase(); })
            : [];
        if (agentFeedLogs.length > 0) {
            agentFeedLogs.slice(0, 20).forEach(function(e) {
                var item = document.createElement('li');
                item.textContent = (e.ts ? e.ts.slice(5, 16) + ' \u2014 ' : '') + (e.text || '');
                log.appendChild(item);
            });
        } else {
            state.activity
                .filter(function(e) { return e.toLowerCase().includes(runtime.name.toLowerCase()); })
                .slice(0, 20)
                .forEach(function(entry) {
                    var item = document.createElement('li');
                    item.textContent = entry;
                    log.appendChild(item);
                });
            if (log.children.length === 0) {
                var empty = document.createElement('li');
                empty.textContent = 'No log entries yet.';
                empty.style.color = '#475569';
                log.appendChild(empty);
            }
        }
    }

    // Auto-Approve Toggle Logic
    var approveToggle = document.getElementById('agent-auto-approve');
    if (approveToggle) {
        // Remove old listeners to prevent duplicates
        var newToggle = approveToggle.cloneNode(true);
        approveToggle.parentNode.replaceChild(newToggle, approveToggle);
        approveToggle = newToggle;

        approveToggle.checked = !!runtime.autoApprove;
        approveToggle.addEventListener('change', function() {
            runtime.autoApprove = this.checked;
            updateGlobalPolicyHUD();
            pushActivity((runtime.emoji || '') + ' ' + runtime.name + ' policy: ' + (runtime.autoApprove ? 'AUTO-APPROVE ENABLED' : 'MANUAL APPROVAL REQUIRED'));
            showToast((runtime.autoApprove ? '\u2714 Auto-Approve Enabled' : '\u26A0 Manual Approval Required'), runtime.color);
        });
    }

    renderLiveTasks(runtime);
}

function drawPortrait(runtime) {
    var canvas = document.getElementById('agent-portrait');
    if (!canvas || !state.bebopSheet) return;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var frameIdx = BEBOP_FRAMES[runtime.id];
    if (frameIdx === undefined) return;
    var col = frameIdx % BEBOP_COLS;
    var row = Math.floor(frameIdx / BEBOP_COLS);
    var sx = col * BEBOP_FRAME_W;
    var sy = row * BEBOP_FRAME_H;
    ctx.fillStyle = '#0b1929';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(state.bebopSheet, sx, sy, BEBOP_FRAME_W, BEBOP_FRAME_H, 0, 0, canvas.width, canvas.height);
    if (runtime.status === 'offline') {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
}

function describeLocation(runtime) {
    if (runtime.status === 'offline') return 'Offline';
    var points = [
        { label: 'Desk', point: { x: runtime.deskX, y: runtime.deskY } },
        { label: 'Briefing Table', point: zones.briefing },
        { label: 'Coffee Lounge', point: zones.lounge },
        { label: 'Server Corner', point: zones.server },
        { label: 'Coding Corner', point: zones.coding },
    ];
    points.sort(function(a, b) { return dist(runtime, a.point) - dist(runtime, b.point); });
    return points[0].label;
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

// ── Gateway crypto ──

async function sha256Hex(bytes) {
    var digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function base64UrlEncode(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(text) {
    var normalized = text.replace(/-/g, '+').replace(/_/g, '/');
    var padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
    var binary = atob(padded);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function createDeviceIdentity() {
    var pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    var publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    var privateKeyPkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    return {
        deviceId: await sha256Hex(publicKeyRaw),
        publicKey: base64UrlEncode(publicKeyRaw),
        privateKey: base64UrlEncode(privateKeyPkcs8),
    };
}

async function loadDeviceIdentity() {
    if (state.deviceIdentity) return state.deviceIdentity;
    var storageKey = 'openclaw-device-identity-v1';
    try {
        var raw = localStorage.getItem(storageKey);
        if (raw) {
            var parsed = JSON.parse(raw);
            if (parsed && parsed.version === 1 && parsed.publicKey && parsed.privateKey) {
                state.deviceIdentity = { deviceId: parsed.deviceId, publicKey: parsed.publicKey, privateKey: parsed.privateKey };
                return state.deviceIdentity;
            }
        }
    } catch (_e) {}
    var created = await createDeviceIdentity();
    state.deviceIdentity = created;
    try {
        localStorage.setItem(storageKey, JSON.stringify({ version: 1, createdAtMs: Date.now(), deviceId: created.deviceId, publicKey: created.publicKey, privateKey: created.privateKey }));
    } catch (_e) {}
    return created;
}

async function signGatewayPayload(privateKeyBase64Url, text) {
    var privateKey = await crypto.subtle.importKey('pkcs8', base64UrlDecode(privateKeyBase64Url), { name: 'Ed25519' }, false, ['sign']);
    var signature = await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(text));
    return base64UrlEncode(new Uint8Array(signature));
}

function buildConnectPayloadText(params) {
    return ['v2', params.deviceId, params.clientId, params.clientMode, params.role, params.scopes.join(','), String(params.signedAtMs), params.token || '', params.nonce || ''].join('|');
}

async function buildDeviceAuth(client, role, scopes, token, nonce) {
    var identity = await loadDeviceIdentity();
    var signedAtMs = Date.now();
    var payloadText = buildConnectPayloadText({ deviceId: identity.deviceId, clientId: client.id, clientMode: client.mode, role: role, scopes: scopes.slice(), signedAtMs: signedAtMs, token: token || '', nonce: nonce || '' });
    var signature = await signGatewayPayload(identity.privateKey, payloadText);
    return { id: identity.deviceId, publicKey: identity.publicKey, signature: signature, signedAt: signedAtMs, nonce: nonce || '' };
}

async function sendGatewayConnect(socket, url, statusEl) {
    if (state.connectSent || socket.readyState !== WebSocket.OPEN) return;
    state.connectSent = true;
    if (statusEl) { statusEl.textContent = 'Authenticating\u2026'; statusEl.className = ''; }
    try {
        var client = { id: 'openclaw-control-ui', version: 'control-ui', platform: navigator.platform || 'web', mode: 'webchat', instanceId: 'mission-control' };
        var role = 'operator';
        var scopes = ['operator.admin', 'operator.read', 'operator.write', 'operator.approvals', 'operator.pairing'];
        var token = office.gatewayToken || '';
        var connectId = String(++state.wsRequestId);
        state.pendingRequests.set(connectId, { kind: 'connect' });

        var params = { minProtocol: 3, maxProtocol: 3, client: client, role: role, scopes: scopes, caps: ['tool-events'], auth: { token: token }, userAgent: navigator.userAgent || 'mission-control', locale: navigator.language || 'en-US' };

        if (crypto && crypto.subtle) {
            try {
                params.device = await buildDeviceAuth(client, role, scopes, token, state.connectNonce);
            } catch (cryptoErr) {
                pushActivity('Device signing skipped: ' + cryptoErr.message);
            }
        }

        socket.send(JSON.stringify({ type: 'req', id: connectId, method: 'connect', params: params }));
    } catch (error) {
        state.connectSent = false;
        if (statusEl) { statusEl.textContent = '\u2715 Connect failed: ' + error.message; statusEl.className = 'error'; }
        pushActivity('Gateway connect failed: ' + error.message);
        socket.close(4008, 'connect failed');
    }
}

function markGatewayReady(url, statusEl, socket) {
    state.gatewayReady = true;
    state.reconnectAttempt = 0;
    if (statusEl) { statusEl.textContent = '\u25cf Live \u2014 ' + url; statusEl.className = 'connected'; }
    pushActivity('Gateway connected.');
    socket.send(JSON.stringify({ type: 'req', id: String(++state.wsRequestId), method: 'sessions.subscribe', params: {} }));
    startFeedPolling();
    startSessionPolling();
    startCostPolling();
    startCronPolling();
    clearInterval(state.pingTimer);
    state.pingTimer = setInterval(function() {
        if (state.socket && state.socket.readyState === WebSocket.OPEN) {
            state.lastPingSent = Date.now();
            state.socket.send(JSON.stringify({ type: 'req', id: String(++state.wsRequestId), method: 'last-heartbeat', params: {} }));
        }
        if (state.lastPingSent && !state.lastPongReceived) {
            if (Date.now() - state.lastPingSent > 45000) {
                pushActivity('Gateway stale — forcing reconnect.');
                if (state.socket) state.socket.close(4009, 'stale');
            }
        }
    }, 20000);
}

// ── Gateway ──

function connectGateway() {
    var statusEl = document.getElementById('gateway-status');
    var url = buildGatewayUrl();
    if (!url) {
        if (statusEl) { statusEl.textContent = 'Ambient mode (no gateway on file://)'; statusEl.className = ''; }
        return;
    }

    clearTimeout(state.reconnectTimer);

    try {
        var socket = new WebSocket(url);
        state.socket = socket;
        state.wsRequestId = 0;
        state.gatewayReady = false;
        state.connectNonce = null;
        state.connectSent = false;
        if (statusEl) statusEl.textContent = 'Connecting to ' + url;

        socket.addEventListener('open', function() {
            if (statusEl) { statusEl.textContent = 'WS open, awaiting challenge\u2026'; statusEl.className = ''; }
        });

        socket.addEventListener('message', function(event) {
            try {
                var msg = JSON.parse(event.data);

                if (msg.type === 'event' && msg.event === 'connect.challenge') {
                    state.connectNonce = msg.payload && typeof msg.payload.nonce === 'string' ? msg.payload.nonce : '';
                    sendGatewayConnect(socket, url, statusEl);
                    return;
                }

                if (msg.type === 'res') {
                    state.lastPongReceived = Date.now();
                    var pending = state.pendingRequests.get(msg.id);
                    if (pending) state.pendingRequests.delete(msg.id);

                    if (!msg.ok) {
                        var detail = msg.error && (msg.error.message || msg.error.code) || 'unknown';
                        pushActivity('Gateway rejected: ' + detail);
                        if (pending && pending.kind === 'connect') {
                            if (statusEl) { statusEl.textContent = '\u2715 Gateway rejected: ' + detail; statusEl.className = 'error'; }
                            state.connectSent = false;
                            socket.close(4001, 'connect rejected');
                        }
                        if (pending && pending.kind === 'send-message') {
                            var failedRt = state.agents.get(pending.runtimeId);
                            if (failedRt) {
                                failedRt.message = 'send failed';
                                recordComment(failedRt, 'System', 'Send failed: ' + detail);
                                if (state.selectedId === failedRt.id) syncOverlay(failedRt);
                            }
                        }
                        return;
                    }

                    if (pending && pending.kind === 'connect') {
                        markGatewayReady(url, statusEl, socket);
                        return;
                    }

                    if (pending && pending.kind === 'send-message') {
                        var sentRt = state.agents.get(pending.runtimeId);
                        if (sentRt) {
                            sentRt.message = 'message sent';
                            pushActivity('Message delivered to ' + sentRt.name + '.');
                            if (state.selectedId === sentRt.id) syncOverlay(sentRt);
                        }
                        return;
                    }

                    if (pending && pending.kind === 'sessions-list') {
                        handleSessionsList(msg.payload || msg.result || {});
                        return;
                    }

                    if (pending && pending.kind === 'cron-list-panel') {
                        renderCronTabLive(msg.payload || msg.result || {});
                        return;
                    }

                    var payload = msg.payload || {};
                    if (payload.type === 'hello-ok') { markGatewayReady(url, statusEl, socket); }
                    return;
                }

                if (msg.type === 'hello-ok') {
                    markGatewayReady(url, statusEl, socket);
                    return;
                }

                if (msg.type === 'event') { applyGatewayEvent(msg); return; }

            } catch(e) {
                pushActivity('WS parse error: ' + String(event.data).slice(0, 80));
            }
        });

        socket.addEventListener('close', function(event) {
            state.socket = null;
            state.gatewayReady = false;
            state.connectNonce = null;
            state.connectSent = false;
            clearInterval(state.pingTimer);
            state.pingTimer = null;
            clearInterval(state.sessionPollTimer);
            state.sessionPollTimer = null;
            var retryMs = Math.min(15000, 2000 + (state.reconnectAttempt * 2000));
            state.reconnectAttempt += 1;
            var reason = event && event.reason ? ' (' + event.reason + ')' : '';
            if (statusEl) { statusEl.textContent = '\u25cb Disconnected \u2014 retrying in ' + Math.round(retryMs / 1000) + 's'; statusEl.className = 'error'; }
            pushActivity('Gateway disconnected [' + (event.code || 'unknown') + ']' + reason + '.');
            clearTimeout(state.reconnectTimer);
            state.reconnectTimer = setTimeout(connectGateway, retryMs);
        });

        socket.addEventListener('error', function() {
            if (statusEl) { statusEl.textContent = '\u2715 Gateway error \u2014 ambient mode'; statusEl.className = 'error'; }
        });
    } catch (error) {
        if (statusEl) statusEl.textContent = 'Gateway failed: ' + error.message;
    }
}

function buildGatewayUrl() {
    if (!window.location || !window.location.protocol || !window.location.protocol.startsWith('http')) return null;
    if (window.location.protocol === 'https:') {
        return 'wss://' + window.location.host + '/gateway';
    }
    return 'ws://' + window.location.hostname + ':' + (office.gatewayWsPort || 18789);
}

function applyGatewayEvent(payload) {
    var eventData = payload;
    if (payload && payload.type === 'event' && payload.payload) {
        eventData = payload.payload;
        eventData.type = payload.event;
    }
    var type    = eventData && (eventData.type || eventData.event || eventData.kind);
    if (type) type = type.replace(/\./g, '/');
    var agentId = eventData && (eventData.agentId || eventData.sessionKey || eventData.agent || eventData.id);
    payload = eventData;
    var runtime = resolveRuntime(agentId);

    var rawText = payload && (payload.text || payload.delta || payload.chunk);
    if (!rawText && payload && typeof payload.message === 'string') rawText = payload.message;
    if (rawText && typeof rawText === 'object') rawText = JSON.stringify(rawText);
    if (payload && rawText) payload.text = rawText;

    if (!runtime || !type) return;

    switch (type) {
        case 'session/start':
            runtime.status = 'working';
            runtime.message = 'session started';
            runtime.lastUpdate = Date.now();
            moveAgentTo(runtime, { x: runtime.deskX, y: runtime.deskY }, { status: 'working', message: 'session started' });
            pushActivity(runtime.name + ' session started.');
            if (window.showToast) window.showToast('\u26a1 ' + runtime.name + ' session started', runtime.color);
            playNotifSound();
            updateOnlineCount();
            break;
        case 'session/end':
            sendAgentHome(runtime, 'idle');
            runtime.message = 'session ended';
            pushActivity(runtime.name + ' session ended.');
            break;
        case 'session/offline':
        case 'agent/offline':
            runtime.status = 'offline';
            runtime.message = 'offline';
            runtime.lastUpdate = Date.now();
            applyStatusVisuals(runtime);
            pushActivity(runtime.name + ' went offline.');
            if (window.showToast) window.showToast('\u25cb ' + runtime.name + ' went offline', '#475569');
            bumpNotifBadge(runtime.name + ' offline');
            updateOnlineCount();
            break;
        case 'session/online':
        case 'agent/online':
            runtime.status = 'idle';
            runtime.message = 'back online';
            runtime.lastUpdate = Date.now();
            applyStatusVisuals(runtime);
            pushActivity(runtime.name + ' came online.');
            if (window.showToast) window.showToast('\u25cf ' + runtime.name + ' back online', runtime.color);
            updateOnlineCount();
            break;
        case 'session/tool/use':
            runtime.status = 'working';
            runtime.message = payload.toolName ? 'using ' + payload.toolName : 'using a tool';
            runtime.lastUpdate = Date.now();
            applyStatusVisuals(runtime);
            pushActivity(runtime.name + ': ' + runtime.message);
            break;
        case 'session/message':
            var smRecord = (payload.message && typeof payload.message === 'object') ? payload.message : payload;
            var smRole = smRecord.role || payload.role || '';
            var smContent = smRecord.content || smRecord.text || '';
            var smText = '';
            if (typeof smContent === 'string') {
                smText = smContent;
            } else if (Array.isArray(smContent)) {
                smText = smContent
                    .filter(function(b) { return b && b.type === 'text'; })
                    .map(function(b) { return b.text || ''; })
                    .join('');
            }
            var smStop = smRecord.stopReason;
            runtime.lastUpdate = Date.now();
            if (smRole === 'assistant' && smText) {
                if (smStop === 'stop') {
                    runtime.status = 'idle';
                    runtime.message = smText.slice(0, 80) + (smText.length > 80 ? '\u2026' : '');
                    recordComment(runtime, runtime.name, smText);
                    pushActivity(runtime.name + ' replied.');
                    applyStatusVisuals(runtime);
                    sendAgentHome(runtime, 'idle');
                } else if (smStop === 'toolUse') {
                    var smTool = Array.isArray(smContent)
                        ? (smContent.find(function(b) { return b && b.type === 'toolCall'; }) || {}).name || 'tool'
                        : 'tool';
                    runtime.status = 'working';
                    runtime.message = 'using ' + smTool;
                    if (smText.trim()) recordComment(runtime, runtime.name, smText.trim());
                    pushActivity(runtime.name + ': using ' + smTool);
                    applyStatusVisuals(runtime);
                }
            }
            break;
        case 'session/error':
            runtime.status = 'error';
            runtime.message = payload.error || 'error state';
            runtime.lastUpdate = Date.now();
            applyStatusVisuals(runtime);
            pushActivity(runtime.name + ' error: ' + runtime.message);
            if (window.showToast) window.showToast('\u2715 ' + runtime.name + ': ' + runtime.message.slice(0,60), '#ef4444');
            bumpNotifBadge(runtime.name + ' error');
            setTimeout(function() { sendAgentHome(runtime, 'idle'); }, 4000);
            break;
        case 'chat':
            var chatContent = payload.content || payload.text || '';
            var chatText = '';
            if (typeof chatContent === 'string') {
                chatText = chatContent;
            } else if (Array.isArray(chatContent)) {
                chatText = chatContent
                    .filter(function(b) { return b && b.type === 'text'; })
                    .map(function(b) { return b.text || ''; })
                    .join('');
            }
            var chatRole = payload.role || '';
            var stopReason = payload.stopReason;
            runtime.lastUpdate = Date.now();
            if (chatRole === 'assistant' && chatText) {
                var toolCalls = Array.isArray(payload.content)
                    ? payload.content.filter(function(b) { return b && b.type === 'toolCall'; })
                    : [];
                if (stopReason === 'stop') {
                    runtime.status = 'idle';
                    runtime.message = chatText.slice(0, 80) + (chatText.length > 80 ? '\u2026' : '');
                    recordComment(runtime, runtime.name, chatText);
                    pushActivity(runtime.name + ' replied.');
                    applyStatusVisuals(runtime);
                    sendAgentHome(runtime, 'idle');
                } else if (stopReason === 'toolUse') {
                    var toolName = toolCalls.length ? toolCalls[0].name : 'tool';
                    runtime.status = 'working';
                    runtime.message = 'using ' + toolName;
                    runtime.lastUpdate = Date.now();
                    if (chatText.trim()) recordComment(runtime, runtime.name, chatText.trim());
                    pushActivity(runtime.name + ': using ' + toolName);
                    applyStatusVisuals(runtime);
                }
            } else if (chatRole === 'user') {
                runtime.status = 'working';
                applyStatusVisuals(runtime);
            }
            break;
        case 'agent':
            if (payload.status) {
                runtime.status = payload.status;
                runtime.lastUpdate = Date.now();
                applyStatusVisuals(runtime);
            }
            break;
        case 'sessions/changed':
            break;
        default:
            runtime.lastUpdate = Date.now();
            break;
    }

    if (state.selectedId === runtime.id) syncOverlay(runtime);
}

function resolveRuntime(input) {
    if (!input) return null;
    if (state.agents.has(input)) return state.agents.get(input);
    var norm = String(input).toLowerCase();
    var m = norm.match(/^agent:([^:]+)/);
    if (m && state.agents.has(m[1])) return state.agents.get(m[1]);
    return [...state.agents.values()].find(function(a) {
        return a.id === norm || a.name.toLowerCase() === norm;
    }) || null;
}

function pushActivity(text) {
    var stamp = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
    var entryText = stamp + ' \u2014 ' + text;
    state.activity.unshift(entryText);
    state.activity = state.activity.slice(0, 50);
    
    var feedEl = document.getElementById('live-feed-items');
    if (feedEl) {
        var div = document.createElement('div');
        div.style.fontSize = '10px';
        div.style.color = '#94a3b8';
        div.style.background = '#0b1220cc';
        div.style.border = '1px solid #1e293b';
        div.style.borderRadius = '4px';
        div.style.padding = '5px 8px';
        div.style.lineHeight = '1.3';
        div.style.backdropFilter = 'blur(4px)';
        div.textContent = entryText;
        if (feedEl.firstChild && feedEl.firstChild.textContent && feedEl.firstChild.textContent.indexOf('Waiting') > -1) {
            feedEl.innerHTML = '';
        }
        feedEl.insertBefore(div, feedEl.firstChild);
        if (feedEl.children.length > 5) feedEl.lastChild.remove();
        Array.from(feedEl.children).forEach(function(child, i) {
            child.style.opacity = 1 - (i * 0.2);
        });
    }

    var runtime = state.selectedId ? state.agents.get(state.selectedId) : null;
    if (runtime) syncOverlay(runtime);
}

function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
}

function formatRelative(ts) {
    var delta = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (delta < 5) return 'just now';
    if (delta < 60) return delta + 's ago';
    if (delta < 3600) return Math.floor(delta / 60) + 'm ago';
    if (delta < 86400) return Math.floor(delta / 3600) + 'h ago';
    return Math.floor(delta / 86400) + 'd ago';
}

function stripRuntimeFields(agent) {
    var copy = Object.assign({}, agent);
    ['sprite','shadow','halo','bubbleBox','bubbleText','nameText','roleText','bebopText',
     'statusDot','targetQueue','currentTarget','pulseTween'].forEach(function(k) { delete copy[k]; });
    return copy;
}

function startAmbientOfficeDetails(scene) {
    var serverZone = { x: 1140, y: 175 }; // From zones.server
    state.serverLights = [];
    scene.time.addEvent({
        delay: 400,
        loop: true,
        callback: function() {
            state.serverLights.forEach(function(l) { l.destroy(); });
            state.serverLights = [];
            for (var i = 0; i < 4; i++) {
                if (Math.random() > 0.4) {
                    var lx = serverZone.x - 15 + Math.random() * 30;
                    var ly = serverZone.y - 20 + Math.random() * 40;
                    var c = Math.random() > 0.5 ? 0x22c55e : 0x38bdf8;
                    var light = scene.add.circle(lx, ly, 2, c, 0.9).setDepth(serverZone.y + 10);
                    state.serverLights.push(light);
                }
            }
        }
    });

    office.deskPositions.forEach(function(desk) {
        var glow = scene.add.circle(desk.x, desk.y - 12, 10, 0x38bdf8, 0.0).setDepth(desk.y - 1);
        scene.tweens.add({
            targets: glow,
            alpha: { from: 0.02, to: 0.08 },
            duration: 2000 + Math.random() * 1000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    });
}

// ── Live data (mission-control-live.json) ──

function startLiveDataPolling() {
    fetchLiveData();
    fetchLiveFeed();
    state.liveDataTimer = setInterval(function() {
        fetchLiveData();
        fetchLiveFeed();
    }, 60000);
}

function fetchLiveFeed() {
    // Pull from mission-control-live.json instead of shared-log-recent.json (not served)
    fetch('./mission-control-live.json?t=' + Date.now())
        .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function(data) {
            var feedEl = document.getElementById('live-feed-items');
            if (feedEl && data && data.activity) {
                feedEl.innerHTML = '';
                data.activity.slice(0, 5).forEach(function(a, i) {
                    var div = document.createElement('div');
                    div.style.fontSize = '10px';
                    div.style.color = '#94a3b8';
                    div.style.background = '#0b1220cc';
                    div.style.border = '1px solid #1e293b';
                    div.style.borderRadius = '4px';
                    div.style.padding = '5px 8px';
                    div.style.lineHeight = '1.3';
                    div.style.backdropFilter = 'blur(4px)';
                    div.style.opacity = 1 - (i * 0.2);
                    div.textContent = '[' + a.agent + '] ' + a.line;
                    feedEl.appendChild(div);
                });
            }
        })
        .catch(function() {});
}

function fetchLiveData() {
    fetch('./mission-control-live.json?t=' + Date.now())
        .then(function(r) { return r.json(); })
        .then(function(data) {
            state.liveData = data;
            renderLiveHud(data);
            // Wire kanban board from live data
            if (data.board && window.renderKanbanBoard) {
                window.renderKanbanBoard(data.board);
            }
        })
        .catch(function() {});
}

function renderLiveHud(data) {
    // Status banner
    var agentCount = (data.agents && data.agents.length) || agents.length || 0;
    var activeCronCount = 0;
    if (data.cron) {
        activeCronCount = data.cron.filter(function(c) { return c.state === 'ok' || c.state === 'warn'; }).length;
    }
    var deployTime = data.updatedAt ? new Date(data.updatedAt).toLocaleString('en-US', {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
        hour12: true, timeZone: 'America/New_York'
    }) + ' ET' : '—';

    var banAgents = document.getElementById('banner-agents');
    if (banAgents) banAgents.textContent = 'Agents: ' + agentCount;
    var banCrons = document.getElementById('banner-crons');
    if (banCrons) banCrons.textContent = 'Active Crons: ' + activeCronCount;
    var banDeploy = document.getElementById('banner-deploy');
    if (banDeploy) banDeploy.textContent = 'Last Deploy: ' + deployTime;

    // Deploy status badge in banner
    if (data.deploy) {
        var banStatus = document.getElementById('banner-deploy-status');
        if (banStatus) {
            if (data.deploy.state === 'deployed') {
                banStatus.textContent = 'DEPLOYED \u26a1';
                banStatus.style.color = '#22c55e';
            } else if (data.deploy.state === 'idle') {
                banStatus.textContent = 'LIVE';
                banStatus.style.color = '#22c55e';
            } else {
                banStatus.textContent = 'CHECKING';
                banStatus.style.color = '#f59e0b';
            }
        }
    }

    var dotsEl = document.getElementById('hud-project-dots');
    if (dotsEl && data.projects) {
        dotsEl.innerHTML = '';
        data.projects.forEach(function(p) {
            var dot = document.createElement('span');
            dot.className = 'hud-pill';
            var col = p.health === 'green' ? '#22c55e' : p.health === 'yellow' ? '#f59e0b' : '#ef4444';
            dot.style.color = col;
            dot.style.borderColor = col;
            dot.title = p.note || '';
            dot.textContent = '\u25cf ' + p.name;
            dotsEl.appendChild(dot);
        });
    }

    if (data.health) {
        var h = data.health;
        var node = document.getElementById('hud-node');
        if (node) node.textContent = h.node || 'jarvis';
        var uptime = document.getElementById('hud-uptime');
        if (uptime) uptime.textContent = h.uptime || '';
        var bars = document.getElementById('hud-health-bars');
        if (bars) {
            var cpuCol  = h.cpu  > 80 ? '#ef4444' : h.cpu  > 60 ? '#f59e0b' : '#38bdf8';
            var memCol  = h.memory > 85 ? '#ef4444' : h.memory > 65 ? '#f59e0b' : '#a78bfa';
            var diskCol = h.disk > 80 ? '#ef4444' : h.disk > 60 ? '#f59e0b' : '#fb923c';
            bars.innerHTML =
                'CPU <span style="color:' + cpuCol  + '">' + h.cpu    + '%</span>  ' +
                'MEM <span style="color:' + memCol  + '">' + h.memory + '%</span>  ' +
                'DSK <span style="color:' + diskCol + '">' + h.disk   + '%</span>';
        }
    }

    var cronListEl = document.getElementById('cron-list');
    if (cronListEl && data.cron) {
        cronListEl.innerHTML = '';
        data.cron.forEach(function(c) {
            var card = document.createElement('div');
            card.className = 'task-card';
            var head = document.createElement('div');
            head.className = 'task-head';
            var title = document.createElement('div');
            title.className = 'task-title';
            title.textContent = c.label;
            head.appendChild(title);
            var badge = document.createElement('span');
            badge.className = 'task-badge';
            badge.textContent = c.state || 'unknown';
            var isNeutralState = c.state === 'idle' || c.state === 'unknown' || c.state === 'scheduled' || c.state === 'disabled' || c.state === undefined || c.state === null;
            badge.style.color = c.state === 'ok' ? '#86efac' : c.state === 'warn' ? '#f59e0b' : isNeutralState ? '#64748b' : '#ef4444';
            badge.style.borderColor = c.state === 'ok' ? '#166534' : c.state === 'warn' ? '#92400e' : isNeutralState ? '#334155' : '#991b1b';
            head.appendChild(badge);
            card.appendChild(head);
            var body = document.createElement('div');
            body.className = 'task-body';
            var nextText = c.next || 'unknown';
            if (nextText.includes('UTC')) {
                try {
                    var utcMatch = nextText.match(/(\d{1,2}):(\d{2})\s*UTC/);
                    if (utcMatch) {
                        var utcDate = new Date();
                        utcDate.setUTCHours(parseInt(utcMatch[1]), parseInt(utcMatch[2]), 0, 0);
                        var etTime = utcDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });
                        nextText = nextText.replace(/\d{1,2}:\d{2}\s*UTC/, etTime + ' ET');
                    }
                } catch(e) {}
            }
            body.textContent = 'Next: ' + nextText;
            card.appendChild(body);
            cronListEl.appendChild(card);
        });
    }

    var cronEl = document.getElementById('hud-cron-list');
    if (cronEl && data.cron) {
        cronEl.innerHTML = '';
        data.cron.forEach(function(c) {
            var item = document.createElement('div');
            item.className = 'hud-subtle';
            var isNeutral = c.state === 'ok' ? false : c.state === 'warn' ? false : c.state === 'idle' || c.state === 'unknown' || c.state === 'scheduled' || c.state === undefined || c.state === null;
            var icon = c.state === 'ok' ? '\u2713' : c.state === 'warn' ? '\u26a0' : isNeutral ? '\u23f3' : '\u2753';
            var col  = c.state === 'ok' ? '#22c55e' : c.state === 'warn' ? '#f59e0b' : isNeutral ? '#64748b' : '#f59e0b';
            item.style.lineHeight = '1.7';
            var hudNextText = c.next || '';
            if (hudNextText.includes('UTC')) {
                try {
                    var um = hudNextText.match(/(\d{1,2}):(\d{2})\s*UTC/);
                    if (um) {
                        var ud = new Date();
                        ud.setUTCHours(parseInt(um[1]), parseInt(um[2]), 0, 0);
                        var et = ud.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });
                        hudNextText = hudNextText.replace(/\d{1,2}:\d{2}\s*UTC/, et + ' ET');
                    }
                } catch(e) {}
            }
            item.innerHTML = '<span style="color:' + col + '">' + icon + '</span> ' +
                             c.label + ' <span style="color:#334155">' + hudNextText + '</span>';
            cronEl.appendChild(item);
        });
    }

    // ── Error / alert stream ──
    var errEl = document.getElementById('error-stream');
    if (errEl && data.errors) {
        if (!data.errors.length) {
            errEl.innerHTML = '<div class="empty-state">No errors in last 72h</div>';
        } else {
            errEl.innerHTML = '';
            data.errors.slice(0, 10).forEach(function(err) {
                var card = document.createElement('div');
                card.className = 'task-card';
                card.style.borderLeft = '3px solid #ef4444';
                card.style.marginBottom = '5px';
                card.style.background = '#1a0a0a';
                var ts = document.createElement('div');
                ts.className = 'task-ts';
                ts.textContent = err.time + ' ago';
                ts.style.color = '#ef4444';
                var msg = document.createElement('div');
                msg.className = 'task-title';
                msg.style.fontSize = '10px';
                msg.textContent = err.message;
                card.appendChild(ts);
                card.appendChild(msg);
                errEl.appendChild(card);
            });
        }
    }

    // ── Deploy history ──
    var depEl = document.getElementById('deploy-history');
    if (depEl && data.deploy && data.deploy.history) {
        if (!data.deploy.history.length) {
            depEl.innerHTML = '<div class="empty-state">No deploy history yet</div>';
        } else {
            depEl.innerHTML = '';
            data.deploy.history.slice(0, 5).forEach(function(d) {
                var row = document.createElement('div');
                row.className = 'hud-subtle';
                row.style.lineHeight = '1.6';
                var dot = d.status === 'deployed' ? '<span style="color:#22c55e">\u26a1</span>' : '<span style="color:#64748b">\u25cb</span>';
                row.innerHTML = dot + ' ' + d.time + ' ago <span style="color:#334155">' + (d.trigger || 'deploy') + '</span>';
                depEl.appendChild(row);
            });
        }
    }
}

// ── Feed ──

function startSessionPolling() {
    clearInterval(state.sessionPollTimer);
    fetchSessions();
    state.sessionPollTimer = setInterval(fetchSessions, 15000);
}

function fetchSessions() {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    var reqId = String(++state.wsRequestId);
    state.pendingRequests.set(reqId, { kind: 'sessions-list' });
    state.socket.send(JSON.stringify({
        type: 'req', id: reqId, method: 'sessions.list',
        params: { limit: 30 }
    }));
}

function handleSessionsList(payload) {
    var sessions = payload && payload.sessions ? payload.sessions : (Array.isArray(payload) ? payload : []);
    state.liveSessions.clear();
    sessions.forEach(function(s) {
        var agentId = s.agentId || '';
        if (!agentId && s.sessionKey) {
            var m = s.sessionKey.match(/^agent:([^:]+)/);
            if (m) agentId = m[1];
        }
        if (!agentId) return;
        var existing = state.liveSessions.get(agentId) || [];
        existing.push({
            key: s.sessionKey || s.id || '',
            status: s.status || 'unknown',
            lastMessage: s.lastAssistantMessage || s.lastMessage || '',
            lastTool: s.lastToolName || '',
            updatedAt: s.updatedAtMs || s.updatedAt || 0,
            channel: s.channel || '',
            tokenUsage: s.tokenUsage || s.usage || null,
        });
        state.liveSessions.set(agentId, existing);
    });

    state.liveSessions.forEach(function(sessions, agentId) {
        var runtime = state.agents.get(agentId);
        if (!runtime) return;
        var active = sessions.find(function(s) { return s.status === 'active' || s.status === 'running'; });
        if (active) {
            if (runtime.status === 'idle') {
                runtime.status = 'working';
                var msg = active.lastTool ? 'using ' + active.lastTool : (active.lastMessage ? active.lastMessage.slice(0, 60) : 'active session');
                runtime.message = msg;
                runtime.lastUpdate = active.updatedAt || Date.now();
                applyStatusVisuals(runtime);
            }
        }
    });

    if (state.selectedId) {
        var runtime = state.agents.get(state.selectedId);
        if (runtime) renderLiveTasks(runtime);
    }
    updateOnlineCount();
}


// === TASK COMMENTS ===
if (!state.taskComments) state.taskComments = {};

function getTaskKey(agentId, text) {
    return agentId + ':' + text.slice(0, 60).replace(/\s+/g, '_');
}

function addTaskComment(agentId, taskText, sender, comment) {
    var key = getTaskKey(agentId, taskText);
    if (!state.taskComments[key]) state.taskComments[key] = [];
    state.taskComments[key].push({ sender: sender, text: comment, ts: Date.now() });
    if (state.taskComments[key].length > 50) state.taskComments[key] = state.taskComments[key].slice(-50);
}

function buildCommentSection(agentId, taskText, card) {
    var key = getTaskKey(agentId, taskText);
    var comments = state.taskComments[key] || [];

    var section = document.createElement('div');
    section.className = 'task-comments';

    comments.forEach(function(c) {
        var div = document.createElement('div');
        div.className = 'task-comment';
        var sender = document.createElement('span');
        sender.className = 'tc-sender';
        sender.textContent = c.sender;
        div.appendChild(sender);
        div.appendChild(document.createTextNode(': ' + c.text));
        var time = document.createElement('span');
        time.className = 'tc-time';
        time.textContent = formatRelative(c.ts);
        div.appendChild(time);
        section.appendChild(div);
    });

    var form = document.createElement('div');
    form.className = 'task-comment-form';
    var input = document.createElement('input');
    input.className = 'task-comment-input';
    input.placeholder = 'Add comment...';
    input.addEventListener('click', function(e) { e.stopPropagation(); });
    input.addEventListener('keydown', function(e) { e.stopPropagation(); });
    var btn = document.createElement('button');
    btn.className = 'task-comment-btn';
    btn.textContent = 'Post';
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var val = input.value.trim();
        if (!val) return;
        addTaskComment(agentId, taskText, 'You', val);
        input.value = '';
        var runtime = state.agents.get(state.selectedId);
        if (runtime) renderLiveTasks(runtime);
    });
    form.appendChild(input);
    form.appendChild(btn);
    section.appendChild(form);

    card.appendChild(section);
    card.classList.add('expandable');
    card.addEventListener('click', function() {
        section.classList.toggle('open');
    });
}

function renderLiveTasks(runtime) {
    var taskList = document.getElementById('task-list');
    if (!taskList) return;

    var sessions = state.liveSessions.get(runtime.id) || [];
    var feedLogs = state.feedEntries ? state.feedEntries.filter(function(e) {
        return e.agent && e.agent.toLowerCase() === runtime.id.toLowerCase();
    }) : [];

    taskList.innerHTML = '';

    // === CURRENT TASK (from runtime message + status) ===
    if (runtime.message && runtime.message !== runtime.name + ' standing by') {
        var currentHeader = document.createElement('div');
        currentHeader.className = 'section-title';
        currentHeader.textContent = 'CURRENT TASK';
        taskList.appendChild(currentHeader);

        var currentCard = document.createElement('div');
        currentCard.className = 'task-card';
        currentCard.style.borderLeft = '3px solid ' + runtime.color;

        var currentHead = document.createElement('div');
        currentHead.className = 'task-head';
        var currentTitle = document.createElement('div');
        currentTitle.className = 'task-title';
        currentTitle.textContent = runtime.message;
        currentHead.appendChild(currentTitle);
        var currentBadge = document.createElement('span');
        currentBadge.className = 'task-badge';
        currentBadge.textContent = runtime.status;
        var isWorking = runtime.status === 'working' || runtime.status === 'meeting' || runtime.status === 'transit';
        currentBadge.style.color = isWorking ? '#86efac' : '#94a3b8';
        currentBadge.style.borderColor = isWorking ? '#166534' : '#334155';
        currentHead.appendChild(currentBadge);
        currentCard.appendChild(currentHead);

        var currentTs = document.createElement('div');
        currentTs.className = 'task-ts';
        currentTs.textContent = formatRelative(runtime.lastUpdate);
        currentCard.appendChild(currentTs);
        buildCommentSection(runtime.id, runtime.message, currentCard);
        taskList.appendChild(currentCard);
    }

    // === PENDING DISPATCH TASKS (from feed [needs-X] without [done]) ===
    var agentTag = '[needs-' + runtime.id + ']';
    var agentName = runtime.name.toLowerCase();
    var pendingTasks = (state.feedEntries || []).filter(function(e) {
        var text = (e.text || '').toLowerCase();
        return text.includes(agentTag) || text.includes('[needs-' + agentName + ']');
    });
    // Filter out ones that have a subsequent [done] from this agent
    var doneTasks = (state.feedEntries || []).filter(function(e) {
        var agId = (e.agent || '').toLowerCase();
        return (agId === runtime.id || agId === agentName || agId === runtime.id + '-' + runtime.role.toLowerCase()) &&
               (e.text || '').includes('[done]');
    });
    // Simple heuristic: if pending count > done count, show the extras
    var unhandled = pendingTasks.slice(0, Math.max(0, pendingTasks.length - doneTasks.length));
    if (unhandled.length > 0) {
        var pendingHeader = document.createElement('div');
        pendingHeader.className = 'section-title';
        pendingHeader.style.marginTop = '8px';
        pendingHeader.textContent = 'PENDING TASKS';
        taskList.appendChild(pendingHeader);

        unhandled.forEach(function(e) {
            var card = document.createElement('div');
            card.className = 'task-card';
            card.style.borderLeft = '3px solid #f59e0b';
            var body = document.createElement('div');
            body.className = 'task-body';
            body.style.color = '#fbbf24';
            body.textContent = (e.text || '').replace(/\[needs-\w+\]\s*/g, '');
            card.appendChild(body);
            if (e.ts) {
                var ts = document.createElement('div');
                ts.className = 'task-ts';
                ts.textContent = 'Queued ' + e.ts.slice(5, 16);
                card.appendChild(ts);
            }
            buildCommentSection(runtime.id, (e.text || ''), card);
            taskList.appendChild(card);
        });
    }

    // === LIVE SESSIONS ===
    if (sessions.length > 0) {
        var header = document.createElement('div');
        header.className = 'section-title';
        header.style.marginTop = '8px';
        header.textContent = 'LIVE SESSIONS';
        taskList.appendChild(header);

        sessions.forEach(function(s) {
            var card = document.createElement('div');
            card.className = 'task-card';
            var isActive = s.status === 'active' || s.status === 'running';

            var head = document.createElement('div');
            head.className = 'task-head';
            var title = document.createElement('div');
            title.className = 'task-title';
            title.textContent = s.lastTool ? 'Using ' + s.lastTool : (s.channel || 'Session');
            head.appendChild(title);

            var badge = document.createElement('span');
            badge.className = 'task-badge';
            badge.textContent = s.status;
            badge.style.color = isActive ? '#86efac' : '#94a3b8';
            badge.style.borderColor = isActive ? '#166534' : '#334155';
            head.appendChild(badge);
            card.appendChild(head);

            if (s.lastMessage) {
                var body = document.createElement('div');
                body.className = 'task-body';
                var msgText = typeof s.lastMessage === 'string' ? s.lastMessage : '';
                body.textContent = msgText.slice(0, 120) + (msgText.length > 120 ? '...' : '');
                card.appendChild(body);
            }

            if (s.tokenUsage) {
                var usage = document.createElement('div');
                usage.className = 'task-ts';
                var tokens = typeof s.tokenUsage === 'object' ? (s.tokenUsage.totalTokens || s.tokenUsage.total || '') : s.tokenUsage;
                if (tokens) usage.textContent = 'Tokens: ' + Number(tokens).toLocaleString();
                card.appendChild(usage);
            }

            if (s.updatedAt) {
                var ts = document.createElement('div');
                ts.className = 'task-ts';
                ts.textContent = formatRelative(s.updatedAt);
                card.appendChild(ts);
            }

            taskList.appendChild(card);
        });
    }

    // === SHARED LOG (recent activity) ===
    if (feedLogs.length > 0) {
        var header2 = document.createElement('div');
        header2.className = 'section-title';
        header2.style.marginTop = '8px';
        header2.textContent = 'RECENT ACTIVITY';
        taskList.appendChild(header2);

        feedLogs.slice(0, 10).forEach(function(e) {
            var card = document.createElement('div');
            card.className = 'task-card';
            var isDone = (e.text || '').includes('[done]');
            if (isDone) card.style.borderLeft = '3px solid #22c55e';
            var body = document.createElement('div');
            body.className = 'task-body';
            body.textContent = e.text || '';
            card.appendChild(body);
            if (e.ts) {
                var ts = document.createElement('div');
                ts.className = 'task-ts';
                ts.textContent = e.ts.slice(5, 16);
                card.appendChild(ts);
            }
            taskList.appendChild(card);
        });
    }

    if (!runtime.message || runtime.message === runtime.name + ' standing by') {
        if (sessions.length === 0 && feedLogs.length === 0 && unhandled.length === 0) {
            taskList.innerHTML = '<div class="empty-state">No active sessions or log entries.</div>';
        }
    }
}

function startFeedPolling() {
    clearInterval(state.feedPollTimer);
    fetchFeedEntries();
    state.feedPollTimer = setInterval(fetchFeedEntries, 30000);
}

function startCostPolling() {
    clearInterval(state.costPollTimer);
    fetchCostData();
    state.costPollTimer = setInterval(fetchCostData, 30000);
}

// ── Cron Health Tab ──
function startCronPolling() {
    fetchCronJobs();
    setInterval(fetchCronJobs, 60000);
}

function fetchCronJobs() {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    var reqId = String(++state.wsRequestId);
    state.pendingRequests.set(reqId, { kind: 'cron-list-panel' });
    state.socket.send(JSON.stringify({
        type: 'req', id: reqId, method: 'cron.list',
        params: { includeDisabled: true }
    }));
}

function renderCronTabLive(data) {
    var cronListEl = document.getElementById('cron-list');
    if (!cronListEl) return;

    // New format: data.cron = [{id, label, schedule, next, lastRun, state, errors, enabled}]
    // Legacy format: data.jobs = [{state: {lastRunAtMs, nextRunAtMs, ...}}]
    var jobs = data.cron || data.jobs || [];
    if (!jobs.length) {
        cronListEl.innerHTML = '<div class="empty-state">No cron jobs found</div>';
        return;
    }

    // Sort: errors first, then by next run
    jobs.sort(function(a, b) {
        var aErr = (a.errors !== undefined ? a.errors : (a.state && a.state.consecutiveErrors) || 0);
        var bErr = (b.errors !== undefined ? b.errors : (b.state && b.state.consecutiveErrors) || 0);
        if (aErr > 0 && bErr === 0) return -1;
        if (bErr > 0 && aErr === 0) return 1;
        return 0;
    });

    cronListEl.innerHTML = '';
    jobs.forEach(function(job) {
        // Support both new flat format and legacy nested format
        var isNew = job.errors !== undefined || job.state === undefined;
        var errCount = isNew ? (job.errors || 0) : (job.state && job.state.consecutiveErrors) || 0;
        var lastRun = isNew ? (job.lastRun || 'never') : (job.state && job.state.lastRunAtMs ? formatRelative(job.state.lastRunAtMs) : 'never');
        var nextRun = isNew ? (job.next || 'once') : (job.state && job.state.nextRunAtMs ? new Date(job.state.nextRunAtMs).toLocaleString('en-US', {
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
            hour12: true, timeZone: 'America/New_York'
        }) + ' ET' : 'once');
        var lastStatus = isNew ? job.state : (job.state ? job.state.lastRunStatus : 'unknown');
        var scheduleExpr = isNew ? job.schedule : (job.schedule && job.schedule.expr ? job.schedule.expr : job.schedule && job.schedule.kind === 'every' ? 'every ' + (job.schedule.everyMs / 1000 / 60) + 'm' : '');
        var lastError = isNew ? null : (job.state ? job.state.lastError : null);

        // Neutral states: idle/unknown/scheduled/disabled show gray
        var neutralStates = { idle: true, unknown: true, scheduled: true, disabled: true };
        var isNeutral = neutralStates[lastStatus] || lastStatus === null || lastStatus === undefined || lastStatus === '';
        var isError = errCount > 0;
        var statusColor = isError ? '#ef4444' : lastStatus === 'ok' ? '#22c55e' : isNeutral ? '#64748b' : '#f59e0b';
        var statusIcon  = isError ? '\u26a0\ufe0f' : lastStatus === 'ok' ? '\u2713' : isNeutral ? '\u23f3' : '\u2753';

        var card = document.createElement('div');
        card.className = 'task-card';
        card.style.borderLeft = '3px solid ' + statusColor;

        var head = document.createElement('div');
        head.className = 'task-head';

        var title = document.createElement('div');
        title.className = 'task-title';
        title.style.fontSize = '10px';
        title.textContent = job.label || job.name || job.id || 'cron';
        head.appendChild(title);

        var badge = document.createElement('span');
        badge.className = 'task-badge';
        badge.textContent = statusIcon + ' ' + (errCount > 0 ? errCount + ' err' : (lastStatus || 'unknown'));
        badge.style.color = statusColor;
        badge.style.borderColor = statusColor;
        head.appendChild(badge);
        card.appendChild(head);

        var body = document.createElement('div');
        body.className = 'task-body';
        body.style.fontSize = '9px';
        body.style.display = 'none';
        body.innerHTML = 'Last: ' + lastRun + (scheduleExpr ? ' \u00b7 ' + scheduleExpr : '') + (nextRun !== 'once' && nextRun !== lastRun ? ' \u00b7 Next: ' + nextRun : '');
        card.appendChild(body);

        if (errCount > 0 && lastError) {
            var errDiv = document.createElement('div');
            errDiv.className = 'task-ts';
            errDiv.style.color = '#ef4444';
            errDiv.style.fontSize = '9px';
            errDiv.textContent = 'Error: ' + String(lastError).slice(0, 80);
            card.appendChild(errDiv);
        }

        // Toggle disabled jobs
        if (job.enabled === false) {
            var disabledDiv = document.createElement('div');
            disabledDiv.className = 'task-ts';
            disabledDiv.style.color = '#475569';
            disabledDiv.style.fontStyle = 'italic';
            disabledDiv.textContent = 'DISABLED';
            card.appendChild(disabledDiv);
        }

        // Click card head to expand/collapse body
        head.style.cursor = 'pointer';
        head.addEventListener('click', function(e) {
            e.stopPropagation();
            var isOpen = body.style.display !== 'none';
            body.style.display = isOpen ? 'none' : 'block';
            head.style.fontWeight = isOpen ? '' : '700';
        });
        head.style.fontWeight = '700';

        cronListEl.appendChild(card);
    });
}

function startSystemHealthSimulation() {
    updateSystemHealth();
    setInterval(updateSystemHealth, 4000);
}

function updateSystemHealth() {
    const cpu = 5 + Math.floor(Math.random() * 15);
    const ram = 38 + Math.floor(Math.random() * 10);
    const lag = 5 + Math.floor(Math.random() * 25);
    
    const cpuEl = document.getElementById('bar-cpu');
    const ramEl = document.getElementById('bar-ram');
    const lagEl = document.getElementById('bar-lag');
    
    if (cpuEl) cpuEl.style.width = cpu + '%';
    if (ramEl) ramEl.style.width = ram + '%';
    if (lagEl) lagEl.style.width = lag + '%';
    
    // Update uptime randomly occasionally
    const uptimeEl = document.getElementById('hud-uptime');
    if (uptimeEl && Math.random() > 0.98) {
        uptimeEl.textContent = 'UP: 14d 3h'; 
    }
}

function updateGlobalPolicyHUD() {
    const agentsArray = [...state.agents.values()];
    const autoApproveCount = agentsArray.filter(a => a.autoApprove).length;
    const total = agentsArray.length;
    
    const countEl = document.getElementById('hud-policy-count');
    const statusEl = document.getElementById('hud-policy-status');
    const cardEl = document.getElementById('hud-policy-card');
    
    if (countEl) countEl.textContent = autoApproveCount + '/' + total + ' Auto-Approve';
    
    if (statusEl) {
        if (autoApproveCount === 0) {
            statusEl.textContent = 'Restricted';
            statusEl.style.background = '#1e293b';
            statusEl.style.color = '#94a3b8';
        } else if (autoApproveCount < total) {
            statusEl.textContent = 'Hybrid';
            statusEl.style.background = '#065f46';
            statusEl.style.color = '#34d399';
        } else {
            statusEl.textContent = 'Autonomous';
            statusEl.style.background = '#1e40af';
            statusEl.style.color = '#60a5fa';
        }
    }
}

function fetchCostData() {
    fetch('./cost-data.json?_=' + Date.now())
        .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function(data) { updateCostDOM(data); })
        .catch(function(e) {
            var body = document.getElementById('cost-panel-body');
            var cached = localStorage.getItem('mc_cost_cache');
            if (cached) {
                try { updateCostDOM(JSON.parse(cached), true); return; } catch(err){}
            }
            if (body) { body.innerHTML = '<div style="color:#ef4444;text-align:center;margin-top:20px;">Cost data unavailable<br><span style="font-size:10px;color:#64748b;">(Failed to load cost-data.json)</span></div>'; }
        });
}

function updateCostDOM(data, isCached) {
    var body = document.getElementById('cost-panel-body');
    if (!body || !data) return;
    try { localStorage.setItem('mc_cost_cache', JSON.stringify(data)); } catch(e){}

    var html = '';
    if (isCached) html += '<div style="color:#f59e0b;font-size:10px;text-align:center;margin-bottom:8px;">Showing offline cached data</div>';
    
    // Summary Card
    if (data.summary) {
        html += '<div class="cost-card"><div style="color:#94a3b8;margin-bottom:4px;font-size:12px;">Total Mission Cost</div><div class="cost-big-number">$' + (data.summary.total || '0.00') + '</div>';
        if (data.summary.monthlyEstimate) {
            html += '<div style="color:#64748b;font-size:10px;margin-top:4px;">Est. Monthly: $' + data.summary.monthlyEstimate + '</div>';
        }
        html += '</div>';
    }

    // Breakdown
    if (data.breakdown && Object.keys(data.breakdown).length > 0) {
        html += '<div class="cost-card" style="margin-top:12px;"><div style="color:#e2e8f0;margin-bottom:8px;font-weight:bold;font-size:12px;">Cost Breakdown</div>';
        for (var k in data.breakdown) {
            html += '<div class="cost-row"><span>' + k + '</span><span style="color:#38bdf8;">$' + data.breakdown[k] + '</span></div>';
        }
        html += '</div>';
    }

    // Recent Transactions
    if (data.recent_transactions && data.recent_transactions.length > 0) {
        html += '<div class="cost-card" style="margin-top:12px;"><div style="color:#e2e8f0;margin-bottom:8px;font-weight:bold;font-size:12px;">Recent Transactions</div>';
        data.recent_transactions.forEach(function(tx) {
            var color = tx.amount < 0 ? '#ef4444' : '#22c55e';
            html += '<div class="cost-row"><span>' + (tx.date || '') + ' ' + (tx.desc || '') + '</span><span style="color:' + color + '">$' + Math.abs(tx.amount).toFixed(2) + '</span></div>';
        });
        html += '</div>';
    }
    
    html += '<div style="color:#64748b;font-size:10px;text-align:center;margin-top:12px;">Last updated: ' + new Date().toLocaleTimeString('en-US') + '</div>';
    body.innerHTML = html;
}

function fetchFeedEntries() {
    // Use mission-control-live.json (served) instead of shared-log.md (403 from nginx)
    fetch('./mission-control-live.json?t=' + Date.now())
        .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function(data) {
            // Map mission-control-live.json activity format to feed entries
            var entries = [];
            if (data && data.activity) {
                entries = data.activity.map(function(a) {
                    return {
                        ts: a.time || '',
                        agent: a.agent || '',
                        text: a.line || '',
                        _color: a.color || '#38bdf8',
                    };
                });
            }
            updateFeedDOM(entries);
        })
        .catch(function(e) {
            var empty = document.getElementById('feed-empty');
            if (empty) { empty.style.display = ''; empty.textContent = 'Feed unavailable (' + e + ')'; }
        });
}

function parseFeedLines(text) {
    if (!text) return [];

    // shared-log.md may have entries concatenated without newlines between them,
    // e.g.: [2026-04-05 03:25 UTC] [Spike] [...]...[2026-04-06 03:25 UTC] [Spike] [...]
    // Split on ][ boundaries first, then parse each entry.
    var entries = [];

    // Normalize: split on ][ that's preceded by a closing ] (timestamp end)
    var normalized = text.replace(/\]\[/g, ']\n[');
    var lines = normalized.split('\n');

    lines.forEach(function(l) {
        l = l.trim();
        if (!l || !l.startsWith('[')) return;
        // Match two bracket groups: timestamp then agent/tag.
        // Timestamp may be: [2026-04-05 03:25 UTC] or [2026-04-06T05:05:00Z]
        var m = l.match(/^\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)/);
        if (m) {
            entries.push({ ts: m[1], agent: m[2], text: m[3] });
        } else {
            // Fallback: try single-bracket line [timestamp] text
            var m2 = l.match(/^\[([^\]]+)\]\s+(.*)/);
            if (m2) entries.push({ ts: m2[1], agent: '', text: m2[2] });
        }
    });

    return entries.slice(-30).reverse();
}

function updateFeedDOM(entries) {
    state.feedEntries = entries;
    var list  = document.getElementById('feed-log');
    var empty = document.getElementById('feed-empty');
    if (!list) return;
    list.innerHTML = '';
    if (!entries || !entries.length) {
        if (empty) empty.style.display = '';
        return;
    }
    if (empty) empty.style.display = 'none';

    entries.slice(0, 30).forEach(function(e) {
        var li = document.createElement('li');
        // ts may be a relative time string (e.g. "21m", "1h") or a timestamp — show as-is
        var ts = e.ts ? '<span class="feed-ts">' + e.ts + '</span>' : '';
        // Use _color from mission-control-live.json if available, else lookup by agent name
        var agColor = e._color || 'var(--agent-color)';
        if (!e._color && e.agent) {
            var agentCfg = null;
            for (var ai = 0; ai < window._mcAgents.length; ai++) {
                if (window._mcAgents[ai].id === e.agent.toLowerCase() || window._mcAgents[ai].name.toLowerCase() === e.agent.toLowerCase()) {
                    agentCfg = window._mcAgents[ai];
                    break;
                }
            }
            if (agentCfg) agColor = agentCfg.color;
        }
        var ag = e.agent ? '<span class="feed-agent" style="color:' + agColor + '">[' + e.agent + ']</span>' : '';

        var text = e.text || '';
        if (text.includes('[needs-')) {
            li.style.borderColor = '#f59e0b';
            li.style.borderLeftWidth = '3px';
        } else if (text.includes('[done]')) {
            li.style.borderColor = '#22c55e';
            li.style.borderLeftWidth = '3px';
        } else if (text.includes('[error]') || text.includes('FAILED')) {
            li.style.borderColor = '#ef4444';
            li.style.borderLeftWidth = '3px';
        }

        li.innerHTML = ts + ag + text;
        list.appendChild(li);
    });
    if (state.feedTickerText && entries[0]) {
        var latest = entries[0];
        var msg = (latest.agent ? '[' + latest.agent + '] ' : '') + (latest.text || '').slice(0, 90);
        state.feedTickerText.setText('Feed: ' + msg).setStyle({ color: '#64748b' });
    }
    updateAgentBubblesFromFeed(entries);
}


function updateAgentBubblesFromFeed(entries) {
    if (!entries || !entries.length) return;
    state.agents.forEach(function(runtime, id) {
        var latest = entries.find(function(e) { return e.agent && e.agent.toLowerCase() === id.toLowerCase(); });
        if (latest && latest.text) {
            runtime.message = latest.text.slice(0, 55);
            if (state.selectedId === id) syncOverlay(runtime);
        }
    });
}

// ── Office drawing ──

function drawOffice(scene) {
    // Elegant dark floor background with glowing grids
    scene.add.rectangle(office.width / 2, office.height / 2, office.width, office.height, 0x1a2332);
    var floorTextured = scene.add.tileSprite(office.width / 2, office.height / 2, office.width, office.height, 'floor-tile');
    floorTextured.setBlendMode(Phaser.BlendModes.SCREEN);
    floorTextured.setAlpha(0.6);

    // Dynamic borders
    var wt = 24;
    scene.add.tileSprite(office.width / 2, wt / 2, office.width, wt, 'wall-tile').setAlpha(0.9);
    scene.add.tileSprite(office.width / 2, office.height - wt / 2, office.width, wt, 'wall-tile').setAlpha(0.9);
    scene.add.tileSprite(wt / 2, office.height / 2, wt, office.height, 'wall-tile').setAlpha(0.9);
    scene.add.tileSprite(office.width - wt / 2, office.height / 2, wt, office.height, 'wall-tile').setAlpha(0.9);

    // Windows
    scene.add.image(office.width - 12, 350, 'window-tile');
    scene.add.image(12, 450, 'window-tile');

    // --- Modern Layout Refit ---

    // 1. Briefing Arena (Center-Top, floating hologram vibe)
    scene.add.circle(580, 240, 160, 0x061121, 0.6).setStrokeStyle(1, 0x1e3a5f, 0.4);
    scene.add.rectangle(580, 240, 260, 110, 0x0a1428, 0.8).setStrokeStyle(2, 0x2563eb);
    const strategyNexus = scene.add.text(580, 175, '◬ STRATEGY NEXUS', textStyle(12, '#60a5fa')).setOrigin(0.5).setInteractive({ useHandCursor: true });
    scene.add.image(580, 240, 'table-tile').setDisplaySize(200, 72);
    // Chairs arranged dynamically around the table
    [
        {x: 540, y: 212}, {x: 620, y: 212},
        {x: 500, y: 240}, {x: 660, y: 240},
        {x: 540, y: 268}, {x: 620, y: 268}
    ].forEach(pos => scene.add.image(pos.x, pos.y, 'chair-tile').setScale(0.95));

    // 2. Mainframe Core / Server Corner (Right Side)
    scene.add.rectangle(1180, 220, 220, 240, 0x0d1420, 0.85).setStrokeStyle(2, 0x3b82f6, 0.5);
    const mainframeCore = scene.add.text(1180, 95, '■ MAINFRAME CORE', textStyle(12, '#38bdf8')).setOrigin(0.5).setInteractive({ useHandCursor: true });
    // Grid of servers
    scene.add.image(1120, 160, 'server-tile').setScale(1.1);
    scene.add.image(1180, 160, 'server-tile').setScale(1.1);
    scene.add.image(1240, 160, 'server-tile').setScale(1.1);
    scene.add.image(1120, 240, 'server-tile').setScale(1.1);
    scene.add.image(1180, 240, 'server-tile').setScale(1.1);
    scene.add.image(1240, 240, 'server-tile').setScale(1.1);

    // 3. Recharge Sector (Bottom Right)
    scene.add.rectangle(1180, 600, 250, 200, 0x081310, 0.9).setStrokeStyle(2, 0x10b981, 0.4);
    const rechargeSector = scene.add.text(1180, 490, '▲ RECHARGE SECTOR', textStyle(12, '#34d399')).setOrigin(0.5).setInteractive({ useHandCursor: true });
    scene.add.image(1140, 580, 'coffee-tile');
    scene.add.image(1230, 580, 'plant-tile').setScale(1.2);
    scene.add.image(1140, 640, 'plant-tile').setScale(1.1);
    scene.add.image(1190, 640, 'chair-tile').setScale(1.8).setAngle(-15);
    scene.add.image(1230, 620, 'chair-tile').setScale(1.5).setAngle(20);

    // 4. Synth Lab / Coding Node (Bottom Left Center)
    scene.add.rectangle(480, 600, 260, 140, 0x110d18, 0.85).setStrokeStyle(2, 0xa855f7, 0.5);
    const synthLab = scene.add.text(480, 520, '◆ SYNTH LAB', textStyle(12, '#c084fc')).setOrigin(0.5).setInteractive({ useHandCursor: true });
    scene.add.image(430, 590, 'desk-tile').setDisplaySize(72, 48);
    scene.add.image(530, 590, 'desk-tile').setDisplaySize(72, 48);
    scene.add.image(430, 615, 'chair-tile').setScale(0.9);
    scene.add.image(530, 615, 'chair-tile').setScale(0.9);
    scene.add.image(480, 630, 'plant-tile').setScale(0.9);

    // Agent work stations
    office.deskPositions.forEach(function(desk) {
        // glowing pad
        scene.add.circle(desk.x, desk.y + 10, 36, 0x3b82f6, 0.05);
        scene.add.image(desk.x, desk.y, 'desk-tile');
        scene.add.image(desk.x, desk.y + 34, 'chair-tile');
    });

    // Zone labels for desk groupings
    var zoneLabels = [
        { label: 'OPS DECK',      x: 220, y: 118, color: '#f59e0b' },
        { label: 'RESEARCH LAB', x: 520, y: 118, color: '#a855f7' },
        { label: 'FINANCE HUB',  x: 720, y: 118, color: '#f97316' },
        { label: 'IRONTHREAD',   x: 920, y: 118, color: '#7c3aed' },
        { label: 'CODE NEXUS',   x: 220, y: 398, color: '#22c55e' },
        { label: 'MEDIA STUDIO', x: 420, y: 398, color: '#ec4899' },
        { label: 'LOCAL NODE',   x: 620, y: 398, color: '#64748b' },
        { label: 'REVIEW DESK',  x: 820, y: 398, color: '#ef4444' },
    ];
    zoneLabels.forEach(function(z) {
        // Zone background pill
        var bg = scene.add.roundedRectangle(z.x, z.y - 5, 62, 13, 3, Phaser.Display.Color.HexStringToColor(z.color).color, 0.08);
        bg.setOrigin(0.5, 0.5).setDepth(office.deskPositions[0].y - 2);
        var lbl = scene.add.text(z.x, z.y, z.label, {
            fontFamily: 'monospace',
            fontSize: '7px',
            color: z.color,
            alpha: 0.7,
        }).setOrigin(0.5, 1).setDepth(office.deskPositions[0].y - 1);
    });

    // Add interactivity to room labels
    const setupLabel = (obj, panelId, agentId) => {
        obj.on('pointerover', () => obj.setScale(1.2).setColor('#ffffff'));
        obj.on('pointerout', () => obj.setScale(1).setColor(obj.defaultColor || obj.style.color));
        obj.on('pointerdown', () => {
            if (panelId === 'calendar') {
                const modal = document.getElementById('calendar-modal');
                if (modal) modal.style.display = 'flex';
            } else if (panelId === 'cost') {
                document.body.classList.add('cost-panel-open');
            } else if (agentId) {
                if (window.selectAgent) window.selectAgent(agentId);
            } else if (panelId === 'recharge') {
                if (window.showToast) window.showToast('Recharge Sector: Espresso sequence initiated.', '#10b981');
            }
        });
    };

    setupLabel(strategyNexus, 'calendar');
    setupLabel(mainframeCore, 'cost');
    setupLabel(rechargeSector, 'recharge');
    setupLabel(synthLab, null, 'code');
}

function drawTitle(scene) {
    scene.add.rectangle(office.width / 2, office.height - 18, office.width - 40, 28, 0x020617, 0.90).setStrokeStyle(1, 0x1e293b);
    state.feedTickerText = scene.add.text(28, office.height - 18, 'Feed: awaiting gateway\u2026',
        { fontFamily: 'monospace', fontSize: '10px', color: '#475569' }).setOrigin(0, 0.5).setDepth(200);

    scene.add.rectangle(office.width / 2, 26, office.width - 80, 34, 0x020617, 0.93).setStrokeStyle(2, 0x1d4ed8);
    scene.add.text(50, 26, '\u26a1 Ray\'s AI Office', textStyle(16, '#f8fafc')).setOrigin(0, 0.5);
    state.onlineCountText = scene.add.text(office.width - 130, 26,
        agents.filter(function(a) { return a.status !== 'offline'; }).length + '/' + agents.length + ' online',
        textStyle(11, '#93c5fd')).setOrigin(0, 0.5);
    state.clockText = scene.add.text(office.width - 46, 26, '', textStyle(11, '#64748b')).setOrigin(1, 0.5);

    var lx = office.width - 190, ly = office.height - 58;
    scene.add.rectangle(lx + 72, ly + 14, 164, 30, 0x020617, 0.82).setStrokeStyle(1, 0x1e293b);
    [
        { label: 'working', color: 0x22c55e },
        { label: 'meeting', color: 0x8b5cf6 },
        { label: 'idle',    color: 0x475569 },
        { label: 'error',   color: 0xef4444 },
    ].forEach(function(s, i) {
        var x = lx + (i % 2) * 82, y = ly + Math.floor(i / 2) * 14;
        scene.add.circle(x + 5, y + 7, 4, s.color);
        scene.add.text(x + 13, y + 2, s.label, textStyle(8, '#94a3b8'));
    });
}

function textStyle(size, color) {
    return { fontFamily: 'monospace', fontSize: size + 'px', color: color };
}

// ── Procedural tile generators ──

function genFloorTile() {
    var c = document.createElement('canvas'); c.width = 64; c.height = 64;
    var x = c.getContext('2d');
    
    // Abstract modern grid
    var grad = x.createLinearGradient(0, 0, 64, 64);
    grad.addColorStop(0, '#1e293b');
    grad.addColorStop(1, '#2a3a4e');
    x.fillStyle = grad;
    x.fillRect(0, 0, 64, 64);
    
    // Fine tech grid
    x.strokeStyle = '#475569'; x.lineWidth = 1;
    x.beginPath();
    for (let i = 0; i <= 64; i += 16) {
        x.moveTo(i, 0); x.lineTo(i, 64);
        x.moveTo(0, i); x.lineTo(64, i);
    }
    x.stroke();
    
    // Micro-accents
    x.fillStyle = '#38bdf8';
    x.globalAlpha = 0.8;
    x.fillRect(15, 15, 2, 2);
    x.fillRect(47, 47, 2, 2);
    x.globalAlpha = 1.0;
    
    return c;
}

function genWallTile() {
    var c = document.createElement('canvas'); c.width = 24; c.height = 24;
    var x = c.getContext('2d');
    
    var grad = x.createLinearGradient(0, 0, 0, 24);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(0.5, '#1e293b');
    grad.addColorStop(1, '#334155');
    
    x.fillStyle = grad;
    x.fillRect(0, 0, 24, 24);
    x.fillStyle = '#3b82f6'; x.fillRect(0, 22, 24, 2); // Neon neon trim
    
    x.strokeStyle = '#334155'; x.strokeRect(0, 0, 24, 24);
    return c;
}

function genDeskTile() {
    var c = document.createElement('canvas'); c.width = 96; c.height = 64;
    var x = c.getContext('2d');
    
    // Tempered glass desk style
    x.fillStyle = 'rgba(15, 23, 42, 0.85)'; x.fillRect(8, 8, 80, 38);
    x.strokeStyle = '#38bdf8'; x.lineWidth = 2; x.strokeRect(8, 8, 80, 38);
    
    // Holographic Edge
    var grad = x.createLinearGradient(8, 46, 88, 46);
    grad.addColorStop(0, '#1d4ed8');
    grad.addColorStop(0.5, '#60a5fa');
    grad.addColorStop(1, '#1d4ed8');
    x.fillStyle = grad; x.fillRect(8, 46, 80, 4);
    
    // Monitors & Gear
    x.fillStyle = '#020617'; x.fillRect(30, 10, 36, 24); // Ultra-wide frame
    x.fillStyle = '#0ea5e9'; x.fillRect(32, 12, 32, 20); // Screen glow
    x.fillStyle = 'rgba(255, 255, 255, 0.1)'; x.fillRect(32, 12, 32, 10); // Flare
    
    // Keyboard & Tech
    x.fillStyle = '#334155'; x.fillRect(40, 38, 16, 6);
    x.fillStyle = '#10b981'; x.fillRect(52, 39, 2, 2); // LED
    
    // Desk mounts
    x.fillStyle = '#475569'; x.fillRect(16, 50, 6, 10); x.fillRect(74, 50, 6, 10);
    return c;
}

function genChairTile() {
    var c = document.createElement('canvas'); c.width = 40; c.height = 42;
    var x = c.getContext('2d');
    x.fillStyle = '#0f172a'; x.fillRect(10, 6, 20, 6);
    x.fillStyle = '#1e293b'; x.fillRect(8, 10, 24, 14);
    x.fillStyle = '#334155'; x.fillRect(8, 10, 24, 4); // Trim
    
    // Neon accents
    x.fillStyle = '#38bdf8'; x.fillRect(10, 18, 20, 2);
    
    x.fillStyle = '#475569'; x.fillRect(16, 24, 3, 10); x.fillRect(21, 24, 3, 10); // Frame
    x.fillStyle = '#64748b'; x.beginPath(); x.ellipse(20, 36, 12, 4, 0, 0, Math.PI * 2); x.fill(); // Castors base
    return c;
}

function genTableTile() {
    // Holographic Briefing Table
    var c = document.createElement('canvas'); c.width = 200; c.height = 72;
    var x = c.getContext('2d');
    
    var grad = x.createLinearGradient(0, 0, 200, 72);
    grad.addColorStop(0, 'rgba(15, 23, 42, 0.9)');
    grad.addColorStop(0.5, 'rgba(30, 58, 138, 0.95)');
    grad.addColorStop(1, 'rgba(15, 23, 42, 0.9)');
    
    x.fillStyle = grad;
    x.beginPath(); x.roundRect(8, 8, 184, 56, 16); x.fill();
    x.strokeStyle = '#60a5fa'; x.lineWidth = 2; x.stroke();
    
    // Deep center glow
    x.fillStyle = 'rgba(56, 189, 248, 0.2)';
    x.beginPath(); x.ellipse(100, 36, 60, 15, 0, 0, Math.PI * 2); x.fill();
    
    return c;
}

function genPlantTile() {
    var c = document.createElement('canvas'); c.width = 32; c.height = 42;
    var x = c.getContext('2d');
    // Cyberpunk planter
    var grad = x.createLinearGradient(8, 28, 24, 28);
    grad.addColorStop(0, '#334155');
    grad.addColorStop(1, '#0f172a');
    x.fillStyle = grad; x.fillRect(8, 28, 16, 12);
    x.fillStyle = '#475569'; x.fillRect(6, 26, 20, 4);
    x.fillStyle = '#f59e0b'; x.fillRect(10, 32, 12, 1); // LED ring
    
    // Bio-engineered flora
    x.fillStyle = '#059669'; x.beginPath(); x.ellipse(16, 14, 10, 14, 0.2, 0, Math.PI*2); x.fill();
    x.fillStyle = '#10b981'; x.beginPath(); x.ellipse(12, 18, 8, 10, -0.4, 0, Math.PI*2); x.fill();
    x.fillStyle = '#34d399'; x.beginPath(); x.ellipse(20, 16, 6, 8, 0.5, 0, Math.PI*2); x.fill();
    return c;
}

function genServerTile() {
    var c = document.createElement('canvas'); c.width = 36; c.height = 54;
    var x = c.getContext('2d');
    x.fillStyle = '#020617'; x.fillRect(2, 2, 32, 50);
    x.fillStyle = '#0f172a'; x.fillRect(4, 6, 28, 42);
    x.strokeStyle = '#38bdf8'; x.lineWidth = 2; x.strokeRect(2, 2, 32, 50);
    
    var ledColors = ['#22c55e', '#38bdf8', '#f59e0b', '#ec4899', '#8b5cf6'];
    for (var i = 0; i < 5; i++) {
        var ry = 10 + i * 8;
        x.fillStyle = '#1e293b'; x.fillRect(6, ry, 24, 6);
        x.fillStyle = ledColors[i];
        x.shadowColor = ledColors[i]; x.shadowBlur = 4;
        x.fillRect(26, ry + 2, 2, 2);
        x.fillRect(8, ry + 2, 6, 2);
        x.shadowBlur = 0;
    }
    return c;
}

function genCoffeeTile() {
    var c = document.createElement('canvas'); c.width = 32; c.height = 42;
    var x = c.getContext('2d');
    x.fillStyle = '#e7e5e4'; x.fillRect(8, 16, 16, 18);
    x.strokeStyle = '#a8a29e'; x.strokeRect(8.5, 16.5, 15, 17);
    x.fillStyle = '#6b3a2a'; x.fillRect(10, 18, 12, 10);
    x.fillStyle = '#92400e'; x.fillRect(10, 18, 12, 3);
    x.strokeStyle = '#d6d3d1'; x.lineWidth = 2;
    x.beginPath(); x.arc(26, 24, 5, -0.8, 0.8); x.stroke();
    x.strokeStyle = '#94a3b8'; x.lineWidth = 1;
    x.beginPath(); x.moveTo(13, 14); x.quadraticCurveTo(11, 10, 13, 6); x.stroke();
    x.beginPath(); x.moveTo(19, 14); x.quadraticCurveTo(17, 10, 19, 6); x.stroke();
    return c;
}

function genWindowTile() {
    var c = document.createElement('canvas'); c.width = 20; c.height = 120;
    var x = c.getContext('2d');
    x.fillStyle = '#0f172a'; x.fillRect(0, 0, 20, 120);
    x.fillStyle = '#172554'; x.fillRect(2, 8, 16, 52);
    x.fillStyle = '#1e40af'; x.fillRect(2, 8, 16, 4);
    x.strokeStyle = '#3b82f6'; x.strokeRect(2.5, 8.5, 15, 51);
    x.strokeStyle = '#1d4ed8'; x.lineWidth = 1;
    x.beginPath(); x.moveTo(10, 8); x.lineTo(10, 60); x.stroke();
    x.beginPath(); x.moveTo(2, 34); x.lineTo(18, 34); x.stroke();
    x.fillStyle = '#172554'; x.fillRect(2, 68, 16, 44);
    x.strokeStyle = '#3b82f6'; x.strokeRect(2.5, 68.5, 15, 43);
    x.strokeStyle = '#1d4ed8';
    x.beginPath(); x.moveTo(10, 68); x.lineTo(10, 112); x.stroke();
    x.beginPath(); x.moveTo(2, 90); x.lineTo(18, 90); x.stroke();
    return c;
}

// ── Agent sprite generators (56x80, full faces, per-character detail) ──

function genAgentSprite(agent) {
    var c = document.createElement('canvas'); c.width = 56; c.height = 80;
    var x = c.getContext('2d');

    if (agent.id === 'finance') { drawEin(x, agent.color, agent.accent); return c; }

    drawHumanoid(x, agent.color, agent.accent);

    switch (agent.id) {
        case 'main':       drawSpikeHair(x); break;
        case 'ops':        drawJetHead(x); break;
        case 'research':   drawFayeHair(x, agent.accent); break;
        case 'ironthread': drawGrenHead(x); break;
        case 'code':       drawEdBeanie(x, agent.accent); break;
        case 'media':      drawJuliaHair(x); break;
        case 'local':      drawRoccoHair(x, agent.accent); break;
        case 'punch':      drawPunchGloves(x, agent.accent); break;
        case 'andrew':     drawAndyHead(x, agent.accent); break;
    }
    return c;
}

function drawHumanoid(x, body, accent) {
    x.fillStyle = 'rgba(0,0,0,0.25)';
    x.beginPath(); x.ellipse(28, 79, 14, 5, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#1e293b'; x.fillRect(16, 52, 10, 22); x.fillRect(30, 52, 10, 22);
    x.fillStyle = '#111827'; x.fillRect(14, 70, 12, 8); x.fillRect(28, 70, 12, 8);
    x.fillStyle = body; x.fillRect(12, 28, 32, 26);
    x.fillStyle = body; x.fillRect(12, 28, 10, 14); x.fillRect(34, 28, 10, 14);
    x.fillStyle = accent; x.fillRect(22, 28, 12, 26);
    x.fillStyle = '#f2d3b1'; x.fillRect(24, 26, 8, 5);
    x.fillStyle = body; x.fillRect(6, 28, 8, 22); x.fillRect(42, 28, 8, 22);
    x.fillStyle = '#f2d3b1'; x.fillRect(6, 48, 8, 6); x.fillRect(42, 48, 8, 6);
    x.fillStyle = '#f2d3b1'; x.fillRect(24, 20, 8, 8);
    x.fillStyle = '#f2d3b1'; x.fillRect(18, 4, 20, 18);
    x.fillStyle = '#e8c49a'; x.fillRect(16, 10, 3, 7); x.fillRect(37, 10, 3, 7);
    x.fillStyle = '#fffbf5'; x.fillRect(21, 11, 4, 4); x.fillRect(31, 11, 4, 4);
    x.fillStyle = '#4a7ab5'; x.fillRect(22, 12, 3, 3); x.fillRect(32, 12, 3, 3);
    x.fillStyle = '#111827'; x.fillRect(23, 13, 2, 2); x.fillRect(33, 13, 2, 2);
    x.fillStyle = '#fffbf5'; x.fillRect(24, 13, 1, 1); x.fillRect(34, 13, 1, 1);
    x.fillStyle = '#c4956a'; x.fillRect(27, 17, 2, 2);
    x.fillStyle = '#b07040'; x.fillRect(23, 20, 10, 1);
    x.fillRect(23, 21, 2, 1); x.fillRect(31, 21, 2, 1);
}

function drawSpikeHair(x) {
    x.fillStyle = '#1a1a2e';
    x.fillRect(14, 0, 28, 8); x.fillRect(10, 4, 6, 6); x.fillRect(40, 4, 6, 6);
    x.fillRect(18, -2, 20, 4); x.fillRect(22, -4, 8, 4);
    x.fillRect(12, 6, 8, 4); x.fillRect(36, 6, 8, 4);
}

function drawJetHead(x) {
    x.fillStyle = '#8d6b4f';
    x.fillRect(18, 4, 20, 18); x.fillRect(16, 10, 3, 7); x.fillRect(37, 10, 3, 7);
    x.fillStyle = '#f2d3b1'; x.fillRect(24, 20, 8, 5);
    x.fillStyle = '#1a100a';
    x.fillRect(18, 4, 20, 4); x.fillRect(18, 4, 3, 10); x.fillRect(35, 4, 3, 10);
    x.fillRect(23, 18, 10, 4); x.fillRect(25, 22, 6, 4);
    x.fillStyle = '#fffbf5'; x.fillRect(21, 11, 4, 4); x.fillRect(31, 11, 4, 4);
    x.fillStyle = '#6b4226'; x.fillRect(22, 12, 3, 3); x.fillRect(32, 12, 3, 3);
    x.fillStyle = '#111827'; x.fillRect(23, 13, 2, 2); x.fillRect(33, 13, 2, 2);
}

function drawFayeHair(x, accent) {
    x.fillStyle = '#5b21b6';
    x.fillRect(14, 0, 28, 8); x.fillRect(10, 4, 6, 22); x.fillRect(40, 4, 6, 22);
    x.fillRect(14, 2, 8, 6); x.fillRect(34, 2, 8, 6);
    x.fillStyle = '#facc15'; x.fillRect(14, 6, 28, 4);
    x.fillStyle = '#dc2626'; x.fillRect(23, 20, 10, 2);
    x.fillStyle = '#7c3aed'; x.fillRect(16, 2, 4, 4); x.fillRect(36, 2, 4, 4);
}

function drawGrenHead(x) {
    x.fillStyle = '#c4956a';
    x.fillRect(18, 4, 20, 18); x.fillRect(16, 10, 3, 7); x.fillRect(37, 10, 3, 7);
    x.fillStyle = '#f2d3b1'; x.fillRect(24, 20, 8, 5);
    x.fillStyle = '#16a34a';
    x.fillRect(14, 0, 28, 8); x.fillRect(12, 4, 6, 10); x.fillRect(36, 4, 8, 6);
    x.fillStyle = '#22c55e'; x.fillRect(16, 0, 12, 4); x.fillRect(18, 2, 8, 2);
    x.fillStyle = '#7c3aed'; x.fillRect(12, 28, 10, 6); x.fillRect(34, 28, 10, 6);
    x.fillStyle = '#fffbf5'; x.fillRect(21, 11, 4, 4); x.fillRect(31, 11, 4, 4);
    x.fillStyle = '#6b4226'; x.fillRect(22, 12, 3, 3); x.fillRect(32, 12, 3, 3);
    x.fillStyle = '#111827'; x.fillRect(23, 13, 2, 2); x.fillRect(33, 13, 2, 2);
}

function drawEdBeanie(x, accent) {
    x.fillStyle = '#dc2626';
    x.fillRect(14, 0, 28, 8); x.fillRect(10, 2, 8, 10); x.fillRect(38, 2, 8, 10);
    x.fillRect(16, -2, 8, 4); x.fillRect(28, -2, 8, 4);
    x.fillStyle = '#ef4444'; x.fillRect(18, 0, 6, 4); x.fillRect(30, 0, 6, 4);
    x.fillStyle = '#1d4ed8';
    x.fillRect(10, 6, 6, 10); x.fillRect(40, 6, 6, 10); x.fillRect(14, 4, 28, 4);
    x.fillStyle = '#3b82f6'; x.fillRect(11, 7, 4, 8); x.fillRect(41, 7, 4, 8);
    x.fillStyle = '#c4956a'; x.fillRect(21, 18, 2, 2); x.fillRect(33, 18, 2, 2);
}

function drawJuliaHair(x) {
    x.fillStyle = '#c8960a';
    x.fillRect(14, 0, 28, 8); x.fillRect(10, 4, 6, 28); x.fillRect(40, 4, 6, 28);
    x.fillRect(14, 2, 8, 5); x.fillRect(34, 2, 8, 5);
    x.fillStyle = '#fffbf5'; x.fillRect(21, 11, 4, 4); x.fillRect(31, 11, 4, 4);
    x.fillStyle = '#1d4ed8'; x.fillRect(22, 12, 3, 3); x.fillRect(32, 12, 3, 3);
    x.fillStyle = '#111827'; x.fillRect(23, 13, 2, 2); x.fillRect(33, 13, 2, 2);
    x.fillStyle = '#fffbf5'; x.fillRect(24, 13, 1, 1); x.fillRect(34, 13, 1, 1);
}

function drawRoccoHair(x, accent) {
    x.fillStyle = '#e8e0d8';
    x.fillRect(18, 4, 20, 18); x.fillRect(16, 10, 3, 7); x.fillRect(37, 10, 3, 7);
    x.fillStyle = '#e8e0d8'; x.fillRect(24, 20, 8, 5);
    x.fillStyle = '#111827';
    x.fillRect(14, 0, 28, 9); x.fillRect(14, 4, 5, 6);
    x.fillStyle = '#1f2937'; x.fillRect(26, 0, 4, 6);
    x.fillStyle = '#f8fafc'; x.fillRect(22, 26, 12, 6); x.fillRect(20, 28, 3, 4); x.fillRect(33, 28, 3, 4);
    x.fillStyle = '#fffbf5'; x.fillRect(21, 11, 4, 4); x.fillRect(31, 11, 4, 4);
    x.fillStyle = '#6b7280'; x.fillRect(22, 12, 3, 3); x.fillRect(32, 12, 3, 3);
    x.fillStyle = '#111827'; x.fillRect(23, 13, 2, 2); x.fillRect(33, 13, 2, 2);
    x.fillStyle = '#94a3b8'; x.fillRect(23, 20, 10, 1);
}

function drawPunchGloves(x, accent) {
    x.fillStyle = '#dc2626';
    x.fillRect(14, 0, 28, 8); x.fillRect(18, -4, 6, 6); x.fillRect(12, -2, 5, 5);
    x.fillRect(29, -2, 5, 5); x.fillRect(36, 0, 6, 4);
    x.fillStyle = '#ef4444'; x.fillRect(20, -2, 10, 3);
    x.fillStyle = accent;
    x.fillRect(2, 40, 14, 14); x.fillRect(40, 40, 14, 14);
    x.strokeStyle = '#7f1d1d'; x.lineWidth = 1;
    x.strokeRect(2.5, 40.5, 13, 13); x.strokeRect(40.5, 40.5, 13, 13);
    x.fillStyle = '#fca5a5'; x.fillRect(3, 41, 5, 5); x.fillRect(41, 41, 5, 5);
}

function drawAndyHead(x, accent) {
    // Hard hat / builder style
    x.fillStyle = '#f59e0b';
    x.fillRect(12, -4, 32, 10);
    x.fillRect(8, 2, 40, 6);
    x.fillStyle = '#fbbf24';
    x.fillRect(14, -2, 28, 4);
    // Head
    x.fillStyle = '#c4956a';
    x.fillRect(18, 4, 20, 18); x.fillRect(16, 10, 3, 7); x.fillRect(37, 10, 3, 7);
    x.fillStyle = '#f2d3b1'; x.fillRect(24, 20, 8, 5);
    // Eyes
    x.fillStyle = '#fffbf5'; x.fillRect(21, 11, 4, 4); x.fillRect(31, 11, 4, 4);
    x.fillStyle = '#92400e'; x.fillRect(22, 12, 3, 3); x.fillRect(32, 12, 3, 3);
    x.fillStyle = '#111827'; x.fillRect(23, 13, 2, 2); x.fillRect(33, 13, 2, 2);
    // Smile
    x.fillStyle = '#b07040'; x.fillRect(23, 20, 10, 1);
    x.fillRect(23, 21, 2, 1); x.fillRect(31, 21, 2, 1);
    // Body
    x.fillStyle = '#1e293b'; x.fillRect(12, 28, 32, 26);
    x.fillStyle = accent; x.fillRect(22, 28, 12, 26);
    x.fillStyle = '#38bdf8'; x.fillRect(18, 34, 20, 3);
}

function drawEin(x, body, accent) {
    x.fillStyle = 'rgba(0,0,0,0.25)';
    x.beginPath(); x.ellipse(28, 79, 18, 5, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = body; x.fillRect(6, 36, 44, 22);
    x.fillStyle = '#f5d0a0'; x.fillRect(12, 40, 32, 14);
    x.strokeStyle = '#c8821a'; x.lineWidth = 1; x.strokeRect(6.5, 36.5, 43, 21);
    x.fillStyle = body;
    x.fillRect(8, 56, 9, 16); x.fillRect(18, 56, 9, 16);
    x.fillRect(30, 56, 9, 16); x.fillRect(40, 56, 9, 16);
    x.fillStyle = '#f5d0a0';
    x.fillRect(7, 68, 11, 8); x.fillRect(17, 68, 11, 8);
    x.fillRect(29, 68, 11, 8); x.fillRect(39, 68, 11, 8);
    x.fillStyle = body; x.fillRect(28, 14, 22, 22);
    x.fillStyle = '#f5d0a0'; x.fillRect(38, 24, 14, 12);
    x.fillStyle = '#111827'; x.fillRect(46, 24, 5, 4);
    x.fillStyle = '#475569'; x.fillRect(47, 24, 2, 2);
    x.fillStyle = '#fffbf5'; x.fillRect(30, 17, 5, 5);
    x.fillStyle = '#6b4226'; x.fillRect(31, 18, 4, 4);
    x.fillStyle = '#111827'; x.fillRect(32, 19, 2, 2);
    x.fillStyle = '#fffbf5'; x.fillRect(33, 19, 1, 1);
    x.fillStyle = accent;
    x.fillRect(24, 12, 8, 16); x.fillRect(48, 14, 5, 12);
    x.fillStyle = body; x.fillRect(48, 14, 3, 10);
    x.fillStyle = body;
    x.fillRect(4, 30, 6, 10); x.fillRect(2, 26, 6, 8); x.fillRect(4, 22, 5, 6);
    x.fillStyle = '#f5d0a0'; x.fillRect(4, 22, 3, 4);
    x.fillStyle = '#1d4ed8'; x.fillRect(28, 34, 22, 4);
    x.fillStyle = '#facc15'; x.fillRect(37, 34, 4, 4);
}
