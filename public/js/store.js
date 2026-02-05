/**
 * Simple state store for Command Center
 * Holds the current dashboard state and notifies subscribers of changes
 */

let state = {
  vitals: null,
  sessions: [],
  tokenStats: null,
  statusCounts: { all: 0, live: 0, recent: 0, idle: 0 },
  capacity: null,
  operators: { operators: [], roles: {} },
  llmUsage: null,
  cron: [],
  memory: null,
  cerebro: null,
  subagents: [],
  pagination: { page: 1, pageSize: 50, totalPages: 1 },
  timestamp: null,
};

const subscribers = new Set();

/**
 * Get the current state
 * @returns {Object} Current state
 */
export function getState() {
  return state;
}

/**
 * Update the state with new data
 * @param {Object} newState - New state data (partial or full)
 */
export function setState(newState) {
  state = { ...state, ...newState, timestamp: Date.now() };
  notifySubscribers();
}

/**
 * Subscribe to state changes
 * @param {Function} callback - Called when state changes
 * @returns {Function} Unsubscribe function
 */
export function subscribe(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

function notifySubscribers() {
  for (const callback of subscribers) {
    try {
      callback(state);
    } catch (err) {
      console.error("[Store] Subscriber error:", err);
    }
  }
}

// Filter state
export const filters = {
  session: { status: "all", channel: "all", kind: "all" },
  cron: { status: "all", schedule: "all" },
  memory: { type: "all", age: "all" },
};

export function setFilter(section, key, value) {
  if (filters[section]) {
    filters[section][key] = value;
    notifySubscribers();
  }
}

// Pagination state
export const pagination = {
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 0,
  hasNext: false,
  hasPrev: false,
};

export function setPagination(newPagination) {
  Object.assign(pagination, newPagination);
}
