(function () {
  "use strict";

  const DEFAULT_LOCALE = "en";
  const SUPPORTED_LOCALES = ["en", "zh-CN"];
  const STORAGE_KEY = "occ.locale";
  const loadedMessages = new Map();
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "CODE", "PRE"]);

  let currentLocale = DEFAULT_LOCALE;
  let activeMessages = {};
  let observer = null;
  let isApplyingTranslations = false;

  function normalizeLocale(input) {
    if (!input || typeof input !== "string") return DEFAULT_LOCALE;
    const lc = input.toLowerCase();
    if (lc === "zh" || lc.startsWith("zh-")) return "zh-CN";
    return "en";
  }

  function getInitialLocale() {
    const fromQuery = new URLSearchParams(window.location.search).get("lang");
    if (fromQuery) return normalizeLocale(fromQuery);

    const fromStorage = localStorage.getItem(STORAGE_KEY);
    if (fromStorage) return normalizeLocale(fromStorage);

    return normalizeLocale(navigator.language || DEFAULT_LOCALE);
  }

  async function loadLocaleMessages(locale) {
    const normalized = normalizeLocale(locale);
    if (loadedMessages.has(normalized)) return loadedMessages.get(normalized);

    const response = await fetch(`/locales/${normalized}.json`, { cache: "no-cache" });
    if (!response.ok) throw new Error(`Failed to load locale: ${normalized}`);
    const data = await response.json();
    loadedMessages.set(normalized, data || {});
    return data || {};
  }

  function getByPath(obj, path) {
    return String(path)
      .split(".")
      .reduce(
        (acc, key) =>
          acc && Object.prototype.hasOwnProperty.call(acc, key) ? acc[key] : undefined,
        obj,
      );
  }

  function interpolate(template, params = {}) {
    if (typeof template !== "string") return template;
    return template.replace(/\{(\w+)\}/g, (_, key) => {
      return Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : `{${key}}`;
    });
  }

  function t(key, params = {}, fallback = undefined) {
    const value = getByPath(activeMessages, key);
    if (value === undefined || value === null) {
      if (fallback !== undefined) return interpolate(fallback, params);
      return String(key);
    }
    return interpolate(value, params);
  }

  function buildReverseMap(source = {}) {
    const reversed = {};
    for (const [from, to] of Object.entries(source)) {
      if (typeof from !== "string" || typeof to !== "string") continue;
      if (!Object.prototype.hasOwnProperty.call(reversed, to)) {
        reversed[to] = from;
      }
    }
    return reversed;
  }

  function getExactPhraseMap() {
    const exact = getByPath(activeMessages, "phrases.exact") || {};
    if (currentLocale !== DEFAULT_LOCALE) return exact;
    const zh = loadedMessages.get("zh-CN") || {};
    const zhExact = getByPath(zh, "phrases.exact") || {};
    return buildReverseMap(zhExact);
  }

  function getPatternRules() {
    const localeRules = getByPath(activeMessages, "phrases.patterns");
    if (Array.isArray(localeRules)) return localeRules;
    if (currentLocale !== DEFAULT_LOCALE) return [];
    const zh = loadedMessages.get("zh-CN") || {};
    const zhRules = getByPath(zh, "phrases.reversePatterns");
    return Array.isArray(zhRules) ? zhRules : [];
  }

  function translateTextValue(input) {
    if (typeof input !== "string") return input;
    if (!input.trim()) return input;

    const leading = input.match(/^\s*/)?.[0] || "";
    const trailing = input.match(/\s*$/)?.[0] || "";
    let core = input.trim();

    const exactMap = getExactPhraseMap();
    if (Object.prototype.hasOwnProperty.call(exactMap, core)) {
      return `${leading}${exactMap[core]}${trailing}`;
    }

    for (const rule of getPatternRules()) {
      if (!rule || typeof rule.pattern !== "string" || typeof rule.replace !== "string") continue;
      try {
        const regex = new RegExp(rule.pattern);
        if (regex.test(core)) {
          core = core.replace(regex, rule.replace);
          return `${leading}${core}${trailing}`;
        }
      } catch {
        continue;
      }
    }

    return input;
  }

  function setAttrIfChanged(el, attr, value) {
    if (!el || typeof value !== "string") return;
    if (el.getAttribute(attr) !== value) {
      el.setAttribute(attr, value);
    }
  }

  function translateLooseAttributes(el) {
    if (el.hasAttribute("data-i18n-title")) {
      setAttrIfChanged(el, "title", t(el.getAttribute("data-i18n-title")));
    } else if (el.hasAttribute("title")) {
      setAttrIfChanged(el, "title", translateTextValue(el.getAttribute("title")));
    }

    if (el.hasAttribute("data-i18n-placeholder")) {
      setAttrIfChanged(el, "placeholder", t(el.getAttribute("data-i18n-placeholder")));
    } else if (el.hasAttribute("placeholder")) {
      setAttrIfChanged(el, "placeholder", translateTextValue(el.getAttribute("placeholder")));
    }

    if (el.hasAttribute("data-i18n-aria-label")) {
      setAttrIfChanged(el, "aria-label", t(el.getAttribute("data-i18n-aria-label")));
    } else if (el.hasAttribute("aria-label")) {
      setAttrIfChanged(el, "aria-label", translateTextValue(el.getAttribute("aria-label")));
    }

    if (el.hasAttribute("data-tooltip")) {
      setAttrIfChanged(el, "data-tooltip", translateTextValue(el.getAttribute("data-tooltip")));
    }
  }

  function translateTextNodes(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
      nodes.push(node);
    }

    for (const textNode of nodes) {
      const parent = textNode.parentElement;
      if (!parent) continue;
      if (SKIP_TAGS.has(parent.tagName)) continue;
      if (parent.hasAttribute("data-i18n")) continue;
      const translated = translateTextValue(textNode.nodeValue || "");
      if (translated !== textNode.nodeValue) {
        textNode.nodeValue = translated;
      }
    }
  }

  function translateElement(el) {
    const textKey = el.getAttribute("data-i18n");
    if (textKey) {
      const translatedText = t(textKey);
      if (el.textContent !== translatedText) {
        el.textContent = translatedText;
      }
    }

    const titleKey = el.getAttribute("data-i18n-title");
    if (titleKey) {
      setAttrIfChanged(el, "title", t(titleKey));
    }

    const placeholderKey = el.getAttribute("data-i18n-placeholder");
    if (placeholderKey) {
      setAttrIfChanged(el, "placeholder", t(placeholderKey));
    }

    const ariaLabelKey = el.getAttribute("data-i18n-aria-label");
    if (ariaLabelKey) {
      setAttrIfChanged(el, "aria-label", t(ariaLabelKey));
    }

    translateLooseAttributes(el);
  }

  function translateSubtree(root = document) {
    if (!root) return;
    isApplyingTranslations = true;
    if (root.nodeType === Node.ELEMENT_NODE) {
      translateElement(root);
    }
    root
      .querySelectorAll(
        "[data-i18n], [data-i18n-title], [data-i18n-placeholder], [data-i18n-aria-label]",
      )
      .forEach(translateElement);

    const elementRoot =
      root.nodeType === Node.DOCUMENT_NODE ? root.body || root.documentElement : root;
    if (elementRoot) {
      translateTextNodes(elementRoot);
      if (elementRoot.querySelectorAll) {
        elementRoot
          .querySelectorAll("[title], [placeholder], [aria-label], [data-tooltip]")
          .forEach(translateLooseAttributes);
      }
    }
    isApplyingTranslations = false;
  }

  function updateDocumentLang() {
    document.documentElement.lang = currentLocale;
  }

  function renderLanguageSwitcher() {
    const header = document.querySelector("header");
    if (!header) return;

    let container = document.getElementById("lang-switcher");
    let select = document.getElementById("lang-select");

    if (!container) {
      container = document.createElement("div");
      container.id = "lang-switcher";
      container.style.display = "inline-flex";
      container.style.alignItems = "center";
      container.style.gap = "6px";
      container.style.marginLeft = "12px";
      container.style.flexShrink = "0";

      const label = document.createElement("span");
      label.style.fontSize = "0.75rem";
      label.style.opacity = "0.8";
      label.textContent = "🌐";
      container.appendChild(label);

      select = document.createElement("select");
      select.id = "lang-select";
      select.style.fontSize = "0.8rem";
      select.style.padding = "3px 8px";
      select.style.background = "var(--card-bg, #161b22)";
      select.style.color = "var(--text, #c9d1d9)";
      select.style.border = "1px solid var(--border, #30363d)";
      select.style.borderRadius = "4px";
      select.style.cursor = "pointer";
      select.innerHTML = `
        <option value="en">English</option>
        <option value="zh-CN">简体中文</option>
      `;
      container.appendChild(select);

      const targetHost = header.querySelector(".header-left") || header;
      targetHost.appendChild(container);
    }

    select = document.getElementById("lang-select");
    if (select && !select.dataset.i18nBound) {
      select.addEventListener("change", (e) => {
        setLocale(e.target.value, { persist: true });
      });
      select.dataset.i18nBound = "1";
    }

    if (select) {
      if (!select.options.length) {
        select.innerHTML = `
          <option value="en">English</option>
          <option value="zh-CN">简体中文</option>
        `;
      }
      select.value = currentLocale;
    }
  }

  function installObserver() {
    if (observer) observer.disconnect();
    if (!document.body) return;

    observer = new MutationObserver((mutations) => {
      if (isApplyingTranslations) return;
      isApplyingTranslations = true;
      try {
        for (const mutation of mutations) {
          if (mutation.type === "childList") {
            mutation.addedNodes.forEach((addedNode) => {
              if (addedNode.nodeType === Node.TEXT_NODE) {
                const parent = addedNode.parentElement;
                if (parent && !SKIP_TAGS.has(parent.tagName)) {
                  const translated = translateTextValue(addedNode.nodeValue || "");
                  if (translated !== addedNode.nodeValue) addedNode.nodeValue = translated;
                }
                return;
              }
              if (addedNode.nodeType === Node.ELEMENT_NODE) {
                translateSubtree(addedNode);
              }
            });
          }

          if (mutation.type === "characterData" && mutation.target?.nodeType === Node.TEXT_NODE) {
            const textNode = mutation.target;
            const parent = textNode.parentElement;
            if (parent && !SKIP_TAGS.has(parent.tagName)) {
              const translated = translateTextValue(textNode.nodeValue || "");
              if (translated !== textNode.nodeValue) textNode.nodeValue = translated;
            }
          }
        }
      } finally {
        isApplyingTranslations = false;
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: false,
    });
  }

  async function setLocale(locale, { persist = true } = {}) {
    const normalized = normalizeLocale(locale);
    const targetLocale = SUPPORTED_LOCALES.includes(normalized) ? normalized : DEFAULT_LOCALE;

    let localeMessages;
    try {
      localeMessages = await loadLocaleMessages(targetLocale);
    } catch (error) {
      console.error("[i18n] Failed to load locale, fallback to English:", error);
      localeMessages = await loadLocaleMessages(DEFAULT_LOCALE);
    }

    currentLocale = targetLocale;
    activeMessages = localeMessages;
    if (persist) {
      localStorage.setItem(STORAGE_KEY, currentLocale);
    }

    updateDocumentLang();
    translateSubtree(document);
    renderLanguageSwitcher();
    installObserver();
    window.dispatchEvent(new CustomEvent("i18n:updated", { detail: { locale: currentLocale } }));
  }

  async function init() {
    await loadLocaleMessages(DEFAULT_LOCALE);
    await loadLocaleMessages("zh-CN").catch(() => null);
    const initialLocale = getInitialLocale();
    await setLocale(initialLocale, { persist: false });
  }

  window.I18N = {
    init,
    t,
    setLocale,
    getLocale: () => currentLocale,
    translateSubtree,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
