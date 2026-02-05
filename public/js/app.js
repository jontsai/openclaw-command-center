/**
 * OpenClaw Command Center - Main Application
 * 
 * Uses morphdom for efficient DOM updates (only patches what changed).
 */

// Import morphdom (loaded as UMD, available as global `morphdom`)
// <script src="/js/lib/morphdom.min.js"></script> must be loaded first

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

const state = {
  vitals: null,
  sessions: [],
  tokenStats: {},
  statusCounts: { all: 0, live: 0, recent: 0, idle: 0 },
  capacity: { main: { active: 0, max: 12 }, subagent: { active: 0, max: 24 } },
  operators: { operators: [], roles: {} },
  llmUsage: null,
  cron: [],
  memory: null,
  cerebro: null,
  subagents: [],
  lastUpdated: null,
  connected: false,
};

// ============================================================================
// SSE CONNECTION
// ============================================================================

let eventSource = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;

function connectSSE() {
  if (typeof EventSource === 'undefined') {
    console.warn('[SSE] Not supported, falling back to polling');
    startPolling();
    return;
  }

  updateConnectionStatus('connecting');

  eventSource = new EventSource('/api/events');

  eventSource.onopen = () => {
    console.log('[SSE] Connected');
    state.connected = true;
    reconnectAttempts = 0;
    updateConnectionStatus('connected');
  };

  eventSource.addEventListener('connected', (e) => {
    const data = JSON.parse(e.data);
    console.log('[SSE] Server greeting:', data.message);
  });

  eventSource.addEventListener('update', (e) => {
    const data = JSON.parse(e.data);
    handleStateUpdate(data);
  });

  eventSource.addEventListener('heartbeat', (e) => {
    const data = JSON.parse(e.data);
    state.lastUpdated = new Date();
    updateTimestamp();
  });

  eventSource.onerror = () => {
    console.error('[SSE] Connection error');
    state.connected = false;
    eventSource.close();
    updateConnectionStatus('disconnected');

    // Exponential backoff
    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), MAX_RECONNECT_DELAY);
    console.log(`[SSE] Reconnecting in ${delay}ms`);
    setTimeout(connectSSE, delay);
  };
}

// ============================================================================
// STATE UPDATES
// ============================================================================

function handleStateUpdate(data) {
  // Merge new data into state
  if (data.vitals) state.vitals = data.vitals;
  if (data.sessions) state.sessions = data.sessions;
  if (data.tokenStats) state.tokenStats = data.tokenStats;
  if (data.statusCounts) state.statusCounts = data.statusCounts;
  if (data.capacity) state.capacity = data.capacity;
  if (data.operators) state.operators = data.operators;
  if (data.llmUsage) state.llmUsage = data.llmUsage;
  if (data.cron) state.cron = data.cron;
  if (data.memory) state.memory = data.memory;
  if (data.cerebro) state.cerebro = data.cerebro;
  if (data.subagents) state.subagents = data.subagents;
  
  state.lastUpdated = new Date();

  // Re-render affected components using morphdom
  renderAll();
}

// ============================================================================
// RENDERING (with morphdom)
// ============================================================================

function renderAll() {
  // Each render function generates HTML and morphdom patches the DOM
  renderVitals();
  renderTokenStats();
  renderLlmUsage();
  renderSessions();
  renderCron();
  renderMemory();
  renderCerebro();
  renderOperators();
  updateTimestamp();
}

// Utility: safely patch a container using morphdom
function patchElement(containerId, newHtml) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Create a temporary element with the new content
  const temp = document.createElement('div');
  temp.innerHTML = newHtml;

  // Use morphdom to efficiently patch only what changed
  if (typeof morphdom !== 'undefined') {
    // Patch each child
    while (container.firstChild && temp.firstChild) {
      morphdom(container.firstChild, temp.firstChild);
      temp.removeChild(temp.firstChild);
    }
    // Add any new children
    while (temp.firstChild) {
      container.appendChild(temp.firstChild);
    }
    // Remove extra children
    while (container.childNodes.length > temp.childNodes.length) {
      container.removeChild(container.lastChild);
    }
  } else {
    // Fallback: direct innerHTML replacement
    container.innerHTML = newHtml;
  }
}

// ============================================================================
// COMPONENT RENDERERS (to be extracted to separate files)
// ============================================================================

function renderVitals() {
  if (!state.vitals) return;
  const v = state.vitals;
  
  // Update individual elements (simpler than full morphdom for now)
  setText('vitals-hostname', v.hostname || '-');
  setText('vitals-uptime', v.uptime || '-');
  
  if (v.cpu) {
    const cpuPct = v.cpu.usage || 0;
    setText('cpu-percent', cpuPct + '%');
    setWidth('cpu-bar', cpuPct + '%');
    setText('cpu-user', (v.cpu.userPercent?.toFixed(1) || '-') + '%');
    setText('cpu-sys', (v.cpu.sysPercent?.toFixed(1) || '-') + '%');
    setText('cpu-idle', (v.cpu.idlePercent?.toFixed(1) || '-') + '%');
    setText('cpu-chip', v.cpu.chip || v.cpu.brand || '');
  }
  
  if (v.memory) {
    const memPct = v.memory.percent || 0;
    setText('mem-percent', memPct + '% used');
    setWidth('mem-bar', memPct + '%');
    setText('mem-summary', `${v.memory.usedFormatted || '-'} of ${v.memory.totalFormatted || '-'}`);
  }
  
  if (v.disk) {
    const diskPct = v.disk.percent || 0;
    setText('disk-percent', diskPct + '% used');
    setWidth('disk-bar', diskPct + '%');
    setText('disk-summary', `${v.disk.usedFormatted || '-'} of ${v.disk.totalFormatted || '-'}`);
  }
}

function renderTokenStats() {
  if (!state.tokenStats) return;
  const t = state.tokenStats;
  
  setText('stat-total-tokens', t.total || '-');
  setText('stat-input', t.input || '-');
  setText('stat-output', t.output || '-');
  setText('stat-active', t.activeCount || '0');
  setText('stat-cost', t.estCost || '-');
  setText('stat-main', `${t.activeMainCount || 0}/${t.mainLimit || 12}`);
  setText('stat-subagents', `${t.activeSubagentCount || 0}/${t.subagentLimit || 24}`);
}

function renderLlmUsage() {
  // Placeholder - will be extracted to component
}

function renderSessions() {
  // Placeholder - will be extracted to component
}

function renderCron() {
  // Placeholder - will be extracted to component
}

function renderMemory() {
  // Placeholder - will be extracted to component
}

function renderCerebro() {
  // Placeholder - will be extracted to component
}

function renderOperators() {
  // Placeholder - will be extracted to component
}

// ============================================================================
// UTILITIES
// ============================================================================

function setText(id, text) {
  const el = document.getElementById(id);
  if (el && el.textContent !== text) {
    el.textContent = text;
  }
}

function setWidth(id, width) {
  const el = document.getElementById(id);
  if (el && el.style.width !== width) {
    el.style.width = width;
  }
}

function updateTimestamp() {
  const now = state.lastUpdated || new Date();
  const timeStr = now.toLocaleTimeString();
  const indicator = state.connected ? ' ⚡' : '';
  setText('last-updated', timeStr + indicator);
  setText('sidebar-updated', state.connected ? `Live: ${timeStr}` : `Updated: ${timeStr}`);
}

function updateConnectionStatus(status) {
  const el = document.getElementById('connection-status');
  if (!el) return;
  
  el.className = 'connection-status ' + status;
  el.textContent = status === 'connected' ? '🟢 Live' : 
                   status === 'connecting' ? '🟡 Connecting...' : '🔴 Disconnected';
}

// ============================================================================
// POLLING FALLBACK
// ============================================================================

let pollInterval = null;

function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(fetchState, 5000);
  fetchState();
}

async function fetchState() {
  try {
    const response = await fetch('/api/state');
    const data = await response.json();
    handleStateUpdate(data);
  } catch (e) {
    console.error('[Polling] Failed:', e);
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function init() {
  console.log('[App] Initializing OpenClaw Command Center');
  connectSSE();
  
  // Initial fetch to populate immediately
  setTimeout(fetchState, 100);
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  setTimeout(init, 0);
}
