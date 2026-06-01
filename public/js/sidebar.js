/**
 * Shared Sidebar Loader
 *
 * Loads the sidebar partial and connects to SSE for live badge updates.
 * Include this script in any page that needs the sidebar.
 */

(function () {
  "use strict";

  // State for sidebar badges
  const sidebarState = {
    sessions: 0,
    cron: 0,
    jobs: 0,
    memory: 0,
    cerebro: 0,
    operators: 0,
    tokens: "-",
    cost: "-",
    monthlyCost: "-",
    avgTokens: "-",
    avgCost: "-",
    lastUpdated: null,
  };

  // SSE connection
  let eventSource = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_DELAY = 30000;

  /**
   * Load and inject sidebar HTML
   */
  async function loadSidebar() {
    try {
      const response = await fetch("/partials/sidebar.html");
      if (!response.ok) throw new Error("Failed to load sidebar");

      const html = await response.text();

      // Find or create sidebar container
      let container = document.getElementById("sidebar-container");
      if (!container) {
        // Insert at start of body
        container = document.createElement("div");
        container.id = "sidebar-container";
        document.body.insertBefore(container, document.body.firstChild);
      }

      container.innerHTML = html;

      if (window.I18N?.translateSubtree) {
        window.I18N.translateSubtree(container);
      }

      // Set active state based on current page
      setActiveNavItem();

      // Connect to SSE for live updates
      connectSSE();

      // Also fetch initial state
      fetchSidebarState();
    } catch (error) {
      console.error("[Sidebar] Failed to load:", error);
    }
  }

  /**
   * Check if we're on the main page
   */
  function isMainPage() {
    const path = window.location.pathname;
    return path === "/" || path === "/index.html";
  }

  function getDockLinks() {
    return document.querySelectorAll(".dock-item, .dock-menu-item");
  }

  function markActive(item, active) {
    item.classList.toggle("active", active);
    if (active) {
      item.setAttribute("aria-current", item.dataset.page === "/jobs.html" ? "page" : "location");
    } else {
      item.removeAttribute("aria-current");
    }
  }

  function closeCommandDockMore() {
    const menu = document.getElementById("command-more-menu");
    const toggle = document.getElementById("command-more-toggle");
    if (menu) menu.hidden = true;
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }

  window.closeCommandDockMore = closeCommandDockMore;

  window.toggleCommandDockMore = function () {
    const menu = document.getElementById("command-more-menu");
    const toggle = document.getElementById("command-more-toggle");
    if (!menu || !toggle) return;
    const nextOpen = menu.hidden;
    menu.hidden = !nextOpen;
    toggle.setAttribute("aria-expanded", nextOpen ? "true" : "false");
  };

  window.toggleSidebar = function () {
    window.toggleCommandDockMore();
  };

  /**
   * Set the active nav item based on current URL
   */
  function setActiveNavItem() {
    const currentPath = window.location.pathname;
    const currentHash = window.location.hash;

    getDockLinks().forEach((item) => {
      const itemPage = item.dataset.page;
      const itemHref = item.getAttribute("href");
      let active = false;

      if (itemPage === "/" && isMainPage()) {
        if (currentHash && itemHref === currentHash) {
          active = true;
        } else if (!currentHash && item.dataset.section === "vitals") {
          active = true;
        }
      } else if (itemHref === currentPath) {
        active = true;
      }

      markActive(item, active);
    });
  }

  /**
   * Set up navigation click handlers
   * - Hash links on main page: smooth scroll
   * - Hash links on other pages: navigate to main page with hash
   */
  function setupNavigation() {
    document.querySelectorAll("[data-section]").forEach((item) => {
      item.addEventListener("click", (e) => {
        const section = item.dataset.section;
        const targetHash = `#${section}-section`;

        if (isMainPage()) {
          e.preventDefault();
          const target = document.querySelector(targetHash);
          if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
            history.pushState(null, "", targetHash);
            setActiveNavItem();
            closeCommandDockMore();
          }
        } else {
          e.preventDefault();
          window.location.href = "/" + targetHash;
        }
      });
    });

    document.addEventListener("click", (event) => {
      const dock = document.getElementById("command-dock");
      if (dock && !dock.contains(event.target)) {
        closeCommandDockMore();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeCommandDockMore();
    });
  }

  /**
   * Connect to SSE for live updates
   */
  function connectSSE() {
    if (typeof EventSource === "undefined") {
      console.warn("[Sidebar SSE] Not supported");
      return;
    }

    eventSource = new EventSource("/api/events");

    eventSource.onopen = () => {
      console.log("[Sidebar SSE] Connected");
      reconnectAttempts = 0;
    };

    eventSource.addEventListener("update", (e) => {
      try {
        const data = JSON.parse(e.data);
        handleStateUpdate(data);
      } catch (err) {
        console.error("[Sidebar SSE] Parse error:", err);
      }
    });

    eventSource.addEventListener("heartbeat", () => {
      sidebarState.lastUpdated = new Date();
      updateTimestamp();
    });

    eventSource.onerror = () => {
      console.error("[Sidebar SSE] Connection error");
      eventSource.close();

      // Exponential backoff reconnect
      reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), MAX_RECONNECT_DELAY);
      setTimeout(connectSSE, delay);
    };
  }

  /**
   * Fetch initial sidebar state
   */
  async function fetchSidebarState() {
    try {
      const response = await fetch("/api/state");
      const data = await response.json();
      handleStateUpdate(data);
    } catch (error) {
      console.error("[Sidebar] Failed to fetch state:", error);
    }
  }

  /**
   * Handle state updates and update badges
   */
  function handleStateUpdate(data) {
    // Update session count
    if (data.sessions) {
      sidebarState.sessions = data.sessions.length || 0;
    }
    if (data.statusCounts) {
      sidebarState.sessions = data.statusCounts.all || 0;
    }

    // Update cron count
    if (data.cron) {
      sidebarState.cron = Array.isArray(data.cron) ? data.cron.length : 0;
    }

    // Update jobs count (from jobs API if available)
    if (data.jobs) {
      sidebarState.jobs = Array.isArray(data.jobs) ? data.jobs.length : data.jobs.total || 0;
    }

    // Update memory count
    if (data.memory) {
      sidebarState.memory = data.memory.fileCount || data.memory.totalFiles || 0;
    }

    // Update cerebro count
    if (data.cerebro) {
      sidebarState.cerebro = data.cerebro.topicCount || data.cerebro.totalTopics || 0;
    }

    // Update operators count
    if (data.operators) {
      sidebarState.operators = Array.isArray(data.operators.operators)
        ? data.operators.operators.length
        : 0;
    }

    // Update token stats
    if (data.tokenStats) {
      sidebarState.tokens = data.tokenStats.totalFormatted || data.tokenStats.total || "-";
      sidebarState.cost = data.tokenStats.estCostFormatted || data.tokenStats.estCost || "-";
      sidebarState.monthlyCost =
        data.tokenStats.estMonthlyCostFormatted || data.tokenStats.estMonthlyCost || "-";
      sidebarState.avgTokens = data.tokenStats.avgTokensPerSession || "-";
      sidebarState.avgCost = data.tokenStats.avgCostPerSession || "-";
    }

    sidebarState.lastUpdated = new Date();

    // Update the DOM
    updateBadges();
    updateTimestamp();
  }

  /**
   * Update badge elements
   */
  function updateBadges() {
    const updates = {
      "nav-session-count": sidebarState.sessions,
      "nav-cron-count": sidebarState.cron,
      "nav-jobs-count": sidebarState.jobs || "-",
      "nav-memory-count": sidebarState.memory,
      "nav-cerebro-count": sidebarState.cerebro,
      "nav-operator-count": sidebarState.operators,
      "nav-tokens": sidebarState.tokens,
      "nav-cost": sidebarState.cost,
      "nav-monthly-cost": sidebarState.monthlyCost,
      "nav-avg-tokens": sidebarState.avgTokens,
      "nav-avg-cost": sidebarState.avgCost,
    };

    for (const [id, value] of Object.entries(updates)) {
      const el = document.getElementById(id);
      if (el && el.textContent !== String(value)) {
        el.textContent = value;
      }
    }
  }

  /**
   * Update the timestamp in sidebar footer
   */
  function updateTimestamp() {
    const el = document.getElementById("sidebar-updated");
    if (el && sidebarState.lastUpdated) {
      const timeStr = sidebarState.lastUpdated.toLocaleTimeString();
      const t = window.I18N?.t;
      el.textContent = t ? t("sidebar.live", { time: timeStr }) : `Live: ${timeStr}`;
    }
  }

  // Fetch jobs count separately (since it's a different API)
  async function fetchJobsCount() {
    try {
      const response = await fetch("/api/jobs");
      const data = await response.json();
      sidebarState.jobs = data.jobs?.length || 0;
      updateBadges();
    } catch (error) {
      // Jobs API may not be available
    }
  }

  // Initialize on DOM ready
  function init() {
    loadSidebar().then(() => {
      setupNavigation();
      fetchJobsCount();
    });

    // Listen for hash changes to update active state
    window.addEventListener("hashchange", setActiveNavItem);
    window.addEventListener("i18n:updated", () => {
      const container = document.getElementById("sidebar-container");
      if (container && window.I18N?.translateSubtree) {
        window.I18N.translateSubtree(container);
      }
      updateTimestamp();
      setActiveNavItem();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
