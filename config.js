export const agents = [
  { id: 'main',       name: 'Spike',  bebop: 'Spike Spiegel',  emoji: '🌊', role: 'Orchestrator', model: 'MiniMax/M2.7',            desk: 0, color: '#4a9eff', accent: '#facc15', sprite: 'spike', status: 'working' },
  { id: 'ops',        name: 'Jet',    bebop: 'Jet Black',      emoji: '🔧', role: 'Operations',   model: 'MiniMax/M2.7',            desk: 1, color: '#f59e0b', accent: '#1f2937', sprite: 'jet',   status: 'idle' },
  { id: 'research',   name: 'Faye',   bebop: 'Faye Valentine', emoji: '🔬', role: 'Research',     model: 'Qwen/Qwen2.5-7B-Instruct', desk: 2, color: '#a855f7', accent: '#fde047', sprite: 'faye',  status: 'idle' },
  { id: 'finance',    name: 'Ein',    bebop: 'Ein (Corgi)',    emoji: '🐕', role: 'Finance',      model: 'MiniMax/M2.7',            desk: 3, color: '#f97316', accent: '#fb923c', sprite: 'ein',   status: 'idle' },
  { id: 'ironthread', name: 'Gren',   bebop: 'Gren Murdock',   emoji: '🎙', role: 'IronThread',   model: 'MiniMax/M2.7',            desk: 4, color: '#7c3aed', accent: '#c4b5fd', sprite: 'gren',  status: 'idle' },
  { id: 'code',       name: 'Ed',     bebop: 'Edward Wong',    emoji: '💻', role: 'Code',         model: 'openai/gpt-4o',          desk: 5, color: '#22c55e', accent: '#ef4444', sprite: 'ed',    status: 'idle' },
  { id: 'media',      name: 'Julia',  bebop: 'Julia',          emoji: '🎨', role: 'Media',        model: 'Qwen/Qwen2.5-7B-Instruct', desk: 6, color: '#ec4899', accent: '#111827', sprite: 'julia', status: 'idle' },
  { id: 'local',      name: 'Rocco',  bebop: 'Vicious',        emoji: '🐧', role: 'Local',        model: 'MiniMax/M2.7',            desk: 7, color: '#64748b', accent: '#f8fafc', sprite: 'rocco', status: 'idle' },
  { id: 'punch',      name: 'Punch',  bebop: 'Punch',          emoji: '🥊', role: 'Reviewer',     model: 'anthropic/claude-sonnet-4-6', desk: 8, color: '#ef4444', accent: '#fca5a5', sprite: 'punch', status: 'idle' },
  { id: 'andrew',     name: 'Andy',   bebop: 'Andy',           emoji: '🖥', role: 'Host Exec',    model: 'MiniMax-M2.7',               desk: 9, color: '#14b8a6', accent: '#99f6e4', sprite: 'andy',  status: 'idle' },
];

export const office = {
  width: 1280,
  height: 720,
  gatewayWsPort: 18790,
  gatewayToken: '9ca3f1fe8deee5ed362fe56d036cfb2b98eb8342721cf14c',
  deskPositions: [
    { x: 300, y: 350 }, // 0
    { x: 400, y: 350 }, // 1
    { x: 300, y: 450 }, // 2
    { x: 400, y: 450 }, // 3
    { x: 800, y: 350 }, // 4
    { x: 900, y: 350 }, // 5
    { x: 800, y: 450 }, // 6
    { x: 900, y: 450 }, // 7
    { x: 640, y: 550 }, // 8
    { x: 740, y: 550 }, // 9
  ],

};
