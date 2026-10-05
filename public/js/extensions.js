/** Read-only extension renderer. Consumes unified state; opens no connections. */
(function () {
  "use strict";
  let latest = null;
  const statuses = new Set(["loading", "ready", "stale", "unavailable", "error", "disabled"]);

  function text(key, fallback, params = {}) {
    return window.I18N?.t ? window.I18N.t(`extensions.${key}`, params, fallback) : fallback;
  }

  function label(value) {
    const locale = window.I18N?.getLocale?.() || "en";
    return value && typeof value === "object" ? value[locale] || value.en || "" : "";
  }

  function element(tag, className, value) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (value !== undefined) el.textContent = String(value);
    return el;
  }

  function translated(tag, key, fallback, className) {
    const el = element(tag, className, text(key, fallback));
    el.dataset.i18n = `extensions.${key}`;
    return el;
  }

  function renderPanel(panel) {
    const section = element("section", "extension-panel");
    section.append(element("h4", "extension-panel-title", label(panel.title)));
    if (panel.type === "metrics") {
      const grid = element("dl", "extension-metrics");
      for (const metric of panel.metrics || []) {
        const card = element("div", "extension-metric");
        card.append(element("dt", "", label(metric.label)));
        card.append(element("dd", "", metric.value));
        grid.append(card);
      }
      section.append(grid);
    } else if (panel.type === "table") {
      if (!panel.rows?.length) {
        section.append(translated("p", "empty", "No records.", "extension-note"));
        return section;
      }
      const wrapper = element("div", "extension-table-scroll");
      wrapper.tabIndex = 0;
      const table = element("table", "extension-table");
      const caption = element("caption", "sr-only", label(panel.title));
      table.append(caption);
      const header = element("tr");
      for (const column of panel.columns || []) {
        const cell = element("th", "", label(column.label));
        cell.scope = "col";
        header.append(cell);
      }
      const thead = element("thead");
      thead.append(header);
      table.append(thead);
      const body = element("tbody");
      for (const row of panel.rows) {
        const tr = element("tr");
        for (const column of panel.columns || []) {
          tr.append(element("td", "", row[column.key] ?? "—"));
        }
        body.append(tr);
      }
      table.append(body);
      wrapper.append(table);
      section.append(wrapper);
    }
    return section;
  }

  function render(data) {
    latest = data || { mode: "legacy", items: [] };
    const mode = ["legacy", "core", "extensions"].includes(latest.mode) ? latest.mode : "core";
    document.querySelectorAll("[data-legacy-panel]").forEach((el) => {
      el.hidden = mode !== "legacy";
    });
    const root = document.getElementById("extension-content");
    if (!root) return;
    const content = document.createDocumentFragment();
    content.append(
      translated(
        "p",
        "companion",
        "Command Center works on its own. Spacesuit is its highly recommended companion for agent flavors and workflows.",
        "extension-note",
      ),
    );
    const modeKeys = {
      core: ["core", "Core monitoring only. No domain collectors are enabled."],
      legacy: [
        "legacy",
        "Built-in optional panels remain enabled for compatibility. A Spacesuit flavor can replace them without changing core monitoring.",
      ],
      extensions: [
        "active",
        "Spacesuit extensions — collected snapshots, independent of core monitoring.",
      ],
    };
    content.append(translated("p", ...modeKeys[mode], "extension-note"));
    if (latest.diagnostic) {
      // Never echo raw diagnostic values or host paths into the UI.
      const loading = latest.diagnostic === "loading";
      content.append(
        translated(
          "p",
          loading ? "loading" : "configurationError",
          loading
            ? "Loading extension selection…"
            : "Extension selection could not be loaded. Core monitoring remains available.",
          "extension-note extension-warning",
        ),
      );
    }
    if (mode === "extensions") {
      const items = Array.isArray(latest.items) ? latest.items : [];
      if (!items.length && !latest.diagnostic) {
        content.append(
          translated(
            "p",
            "none",
            "No extensions selected. Core monitoring is still available.",
            "extension-note",
          ),
        );
      }
      for (const item of items) {
        const status = statuses.has(item.status) ? item.status : "error";
        const card = element("article", "extension-card");
        card.dataset.i18nSkip = "true";
        card.dataset.extensionId = item.id;
        card.dataset.status = status;
        const header = element("div", "extension-header");
        header.append(element("h3", "", item.id));
        header.append(
          translated(
            "span",
            `status.${status}`,
            status,
            `extension-status extension-status-${status}`,
          ),
        );
        card.append(header);
        if (item.observedAt && Number.isFinite(Date.parse(item.observedAt))) {
          const observed = element("p", "extension-note");
          observed.append(translated("span", "observed", "Observed: "));
          const time = element(
            "time",
            "",
            new Date(item.observedAt).toLocaleString(window.I18N?.getLocale?.() || "en"),
          );
          time.dateTime = item.observedAt;
          observed.append(time);
          card.append(observed);
        }
        if (status === "ready" || status === "stale") {
          if (status === "stale")
            card.append(
              translated(
                "p",
                "staleNote",
                "This snapshot is old; values below are not current.",
                "extension-note extension-warning",
              ),
            );
          for (const panel of item.panels || []) card.append(renderPanel(panel));
        } else {
          card.append(
            translated(
              "p",
              "unavailableNote",
              "No current data is available for this extension. Core monitoring is unaffected.",
              "extension-note",
            ),
          );
        }
        content.append(card);
      }
    }
    root.replaceChildren(content);
  }

  window.ExtensionPanels = { render };
  window.addEventListener("i18n:updated", () => {
    if (latest) render(latest);
  });
})();
