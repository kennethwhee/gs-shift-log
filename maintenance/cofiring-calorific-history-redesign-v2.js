
(() => {
  "use strict";

  /* COFIRING CALORIFIC HISTORY REDESIGN V2 R3 DATEFIX */
  const ROOT_SELECTOR = "[data-cofiring-draft-root]";
  const PANEL_CLASS = "cfv-history-redesign-panel-v2";
  const TABLE_CLASS = "cfv-history-redesign-source-v2";
  const CUSTOM_CLASS = "cfv-history-redesign-custom-v2";
  const TITLE_TEXT = "발열량 저장 이력";

  function textOf(node) {
    return String(node?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function findRoot() {
    return document.querySelector(ROOT_SELECTOR);
  }

  function findPanel(root) {
    if (!root) return null;
    const title = Array.from(root.querySelectorAll('strong,h1,h2,h3,h4')).find((node) => textOf(node) === TITLE_TEXT);
    if (!title) return null;
    return title.closest('section') || title.closest('.cfv12-history-panel') || title.parentElement?.parentElement || null;
  }

  function findTable(panel) {
    return panel?.querySelector('table') || null;
  }

  function extractRows(table) {
    if (!table) return [];
    const bodies = Array.from(table.tBodies || []);
    const rows = bodies.flatMap((tbody) => Array.from(tbody.rows || []));
    return rows.map((row) => Array.from(row.cells || []).map((cell) => textOf(cell))).filter((cells) => cells.some(Boolean));
  }

  function normalizeCells(cells) {
    const filtered = [...cells];
    while (filtered.length > 6 && !filtered[filtered.length - 1]) {
      filtered.pop();
    }
    if (filtered.length < 6) {
      while (filtered.length < 6) filtered.push('');
    }
    return filtered.slice(0, 6);
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function yearFromSavedAt(savedAt) {
    const match = String(savedAt || '').match(/(20\d{2}|19\d{2})/);
    if (match) return match[1].slice(-2);
    return String(new Date().getFullYear()).slice(-2);
  }

  function formatDateLabel(dateText, savedAt) {
    const raw = String(dateText || '').trim();
    if (!raw) return '-';

    const fullMatch = raw.match(/(\d{2,4})[./-]\s*(\d{1,2})[./-]\s*(\d{1,2})\s*\(?([월화수목금토일])\)?/);
    if (fullMatch) {
      const yy = fullMatch[1].slice(-2);
      const mm = pad2(fullMatch[2]);
      const dd = pad2(fullMatch[3]);
      return `${yy}-${mm}-${dd}(${fullMatch[4]})`;
    }

    const mdwMatch = raw.match(/(\d{1,2})-(\d{1,2})\s*\(?([월화수목금토일])\)?/);
    if (mdwMatch) {
      const yy = yearFromSavedAt(savedAt);
      const mm = pad2(mdwMatch[1]);
      const dd = pad2(mdwMatch[2]);
      return `${yy}-${mm}-${dd}(${mdwMatch[3]})`;
    }

    const mdMatch = raw.match(/(\d{1,2})-(\d{1,2})/);
    if (mdMatch) {
      const yy = yearFromSavedAt(savedAt);
      const mm = pad2(mdMatch[1]);
      const dd = pad2(mdMatch[2]);
      return `${yy}-${mm}-${dd}`;
    }

    return raw;
  }

  function buildCustomList(panel, rows) {
    let custom = panel.querySelector(`.${CUSTOM_CLASS}`);
    if (!custom) {
      custom = document.createElement('div');
      custom.className = CUSTOM_CLASS;
      panel.appendChild(custom);
    }

    const head = `
      <div class="cfv-history-redesign-grid-v2 cfv-history-redesign-head-v2">
        <div>적용일</div>
        <div>Coal<div class="unit">kcal/kg</div></div>
        <div>Bio<div class="unit">kcal/kg</div></div>
        <div>유기성<div class="unit">kcal/kg</div></div>
        <div>축분<div class="unit">kcal/kg</div></div>
        <div>저장 시각</div>
      </div>`;

    const body = rows.length
      ? rows.map((cells) => {
          const [date, coal, bio, organic, manure, savedAt] = normalizeCells(cells);
          const displayDate = formatDateLabel(date, savedAt);
          return `
            <div class="cfv-history-redesign-grid-v2 cfv-history-redesign-row-v2">
              <div class="is-date">${displayDate || '-'}</div>
              <div class="is-value">${coal || '-'}</div>
              <div class="is-value">${bio || '-'}</div>
              <div class="is-value">${organic || '-'}</div>
              <div class="is-value">${manure || '-'}</div>
              <div class="is-time">${savedAt || '-'}</div>
            </div>`;
        }).join('')
      : `<div class="cfv-history-redesign-empty-v2">표시할 저장 이력이 없습니다.</div>`;

    custom.innerHTML = `<div class="cfv-history-redesign-shell-v2">${head}<div class="cfv-history-redesign-body-v2">${body}</div></div>`;
  }

  function enhance() {
    const root = findRoot();
    if (!root) return false;
    const panel = findPanel(root);
    if (!panel) return false;
    panel.classList.add(PANEL_CLASS);

    const table = findTable(panel);
    if (!table) return false;

    table.classList.add(TABLE_CLASS);
    const wrapper = table.parentElement;
    if (wrapper) wrapper.classList.add('cfv-history-redesign-source-wrap-v2');

    const rows = extractRows(table);
    buildCustomList(panel, rows);
    return true;
  }

  function scheduleEnhance() {
    window.setTimeout(enhance, 0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhance, { once: true });
  } else {
    enhance();
  }

  document.addEventListener('click', scheduleEnhance, true);
  window.addEventListener('focus', scheduleEnhance);
  [120, 350, 800, 1500, 3000, 6000].forEach((delay) => window.setTimeout(enhance, delay));
})();
