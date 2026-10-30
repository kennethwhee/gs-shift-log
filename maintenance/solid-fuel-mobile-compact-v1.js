/* GS_SOLID_FUEL_MOBILE_COMPACT_V1: move existing nodes; preserve all data and listeners. */
(() => {
  'use strict';
  function init() {
    const page = document.querySelector('main.page');
    const query = page?.querySelector('.query-card');
    const summary = page?.querySelector('.summary-strip');
    const analytics = page?.querySelector('.analytics');
    if (!page || !query || !summary || !analytics) return;
    const media = window.matchMedia('(max-width: 760px)');
    const moved = [query, summary, analytics].map(node => {
      const anchor = document.createComment('solid-fuel-mobile-original-position');
      node.before(anchor);
      return {node, anchor};
    });
    function disclosure(id, label) {
      const details = document.createElement('details');
      details.id = id; details.className = 'sfmc-disclosure';
      const title = document.createElement('summary');
      title.textContent = label; details.append(title);
      return details;
    }
    const filters = disclosure('sfMobileFilters', '검색 조건 · 월 / 기간 / 업체');
    const statistics = disclosure('sfMobileStatistics', '하역 통계 · 업체 / Silo');
    const tbody = document.getElementById('unloadBody');
    const rowState = new WeakMap();
    let detailId = 0;
    let compact = false;
    function closeRow(row) {
      const state = rowState.get(row);
      if (!state?.detail) return;
      // Move the original permission-controlled buttons back; never synthesize
      // edit/delete actions or replace their native event handlers.
      if (state.actions) state.actionCell.append(state.actions);
      state.detail.remove(); state.detail = null;
      state.button.setAttribute('aria-expanded', 'false');
      row.classList.remove('sfmc-record-open');
    }
    function toggleRow(row) {
      const state = rowState.get(row);
      if (!compact || !state) return;
      if (state.detail) { closeRow(row); return; }
      const detail = document.createElement('tr');
      detail.className = 'sfmc-record-detail'; detail.id = state.detailId;
      const cell = document.createElement('td'); cell.colSpan = 7;
      const list = document.createElement('dl'); list.className = 'sfmc-record-fields';
      for (const [label, selector] of [['날짜', '.date'], ['업체', '.company'], ['입고량', '.receipt-ton'], ['소요', '.duration'], ['차량', '.vehicle'], ['Silo', '.silo'], ['비고', '.unload-note']]) {
        const field = document.createElement('div');
        if (label === '비고') field.className = 'sfmc-record-note';
        const term = document.createElement('dt'), value = document.createElement('dd');
        term.textContent = label;
        value.textContent = label === '날짜' ? state.fullDate : row.querySelector(selector)?.textContent.trim() || '-';
        field.append(term, value); list.append(field);
      }
      cell.append(list);
      if (state.actions) cell.append(state.actions);
      detail.append(cell); row.after(detail); state.detail = detail;
      state.button.setAttribute('aria-expanded', 'true');
      row.classList.add('sfmc-record-open');
    }
    function prepareRows() {
      if (!compact || !tbody) return;
      for (const row of tbody.children) {
        const dateCell = row.querySelector(':scope > .date'), numberCell = row.querySelector(':scope > .no');
        if (!dateCell || !numberCell || rowState.has(row)) continue;
        const fullDate = dateCell.textContent.trim();
        const state = {fullDate, dateCell, dateNodes: [...dateCell.childNodes],
          dateTitle: dateCell.getAttribute('title'), actionCell: row.querySelector(':scope > .actions'),
          actions: row.querySelector(':scope > .actions > .row-actions'), detail: null, detailId: 'sfmc-record-' + (++detailId)};
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'sfmc-row-toggle';
        const hasYear = /^\d{4}\.\d{2}\.\d{2}$/.test(fullDate);
        button.textContent = hasYear ? fullDate.slice(5) : fullDate;
        button.setAttribute('aria-label', fullDate + ' 하역기록 ' + numberCell.textContent.trim() + ' 상세');
        button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', state.detailId);
        state.button = button; rowState.set(row, state);
        // The native TODAY/week filter parses dateCell.textContent and updates
        // the No. cell. Keep the full year in the DOM and leave No. untouched.
        const year = document.createElement('span'); year.className = 'sfmc-date-year';
        year.textContent = hasYear ? fullDate.slice(0, 5) : '';
        year.setAttribute('aria-hidden', 'true');
        dateCell.replaceChildren(year, button);
        dateCell.title = fullDate;
        row.classList.add('sfmc-record-row');
      }
    }
    function restoreRows() {
      for (const row of [...(tbody?.children || [])]) {
        const state = rowState.get(row);
        if (!state) continue;
        closeRow(row);
        state.dateCell.replaceChildren(...state.dateNodes);
        if (state.dateTitle === null) state.dateCell.removeAttribute('title');
        else state.dateCell.setAttribute('title', state.dateTitle);
        row.classList.remove('sfmc-record-row'); rowState.delete(row);
      }
    }
    tbody?.addEventListener('click', event => {
      if (!compact) return;
      const control = event.target.closest('button, a, input, select, textarea');
      if (control && !control.classList.contains('sfmc-row-toggle')) return;
      const row = event.target.closest('tr.sfmc-record-row');
      if (row?.parentElement === tbody) toggleRow(row);
    });
    document.getElementById('solidFuelUnloadListQuickV4')?.addEventListener('click', event => {
      if (event.target.closest('button')) [...(tbody?.children || [])].forEach(closeRow);
    });
    // Native fetch/filter/date actions replace only the tbody's rows. Observe
    // that boundary so refreshes receive the same presentation without polling.
    if (tbody) new MutationObserver(prepareRows).observe(tbody, {childList: true});
    function update() {
      if (compact === media.matches) return;
      compact = media.matches;
      document.body.classList.toggle('sf-mobile-compact', compact);
      if (compact) {
        filters.append(query); statistics.append(summary, analytics);
        page.append(filters, statistics);
        prepareRows();
      } else {
        restoreRows();
        moved.forEach(({node, anchor}) => anchor.after(node));
        filters.remove(); statistics.remove();
      }
    }
    media.addEventListener('change', update);
    update();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
