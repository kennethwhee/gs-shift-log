(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BlowerHistoryTimeline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const headers = ['일자', '설비', '구분', '당시 운전시간', '문제/사유', '조치', '내용', '출처'];
  const stamp = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function sourceOf(event) {
    if (typeof event?.sourceText !== 'string') return null;
    try { const source = JSON.parse(event.sourceText); return source && typeof source === 'object' && !Array.isArray(source) ? source : null; }
    catch { return null; }
  }
  function isAutomaticRunHistory(event) {
    if (event?.eventType !== 'runtime_correction' || event.sourceType !== 'dataparc_runtime' ||
        typeof event.id !== 'string' || typeof event.sourceLogId !== 'string' || !event.sourceLogId ||
        event.id !== 'dataparc_runtime:' + event.sourceLogId ||
        typeof event.createdAt !== 'string' || event.createdAt !== event.updatedAt || !Number.isFinite(stamp(event.createdAt))) return false;
    const source = sourceOf(event);
    if (!source || source.schemaVersion !== 1 || source.requestType !== 'blower_runtime_probe' ||
        source.requestId !== event.sourceLogId || source.assetTag !== event.tagNumber ||
        typeof source.assetTag !== 'string' || !source.assetTag ||
        typeof source.dataParcTag !== 'string' || !/^GSPOGE\.ABB_DCS\.[A-Z0-9][A-Z0-9._-]*$/.test(source.dataParcTag) ||
        !Number.isFinite(stamp(event.eventDate)) || stamp(event.eventDate) !== stamp(source.observedAt || source.endAt) ||
        ['manualOverride', 'replacementEdit', 'requiresRunRefresh'].some(key => Object.hasOwn(source, key) && source[key] !== false)) return false;
    return true;
  }
  function partition(events) {
    const major = [], automatic = [];
    for (const event of Array.isArray(events) ? events : []) (isAutomaticRunHistory(event) ? automatic : major).push(event);
    return {major, automatic};
  }
  function defaultDateTime(value) {
    const time = stamp(value);
    return Number.isFinite(time) ? new Date(time + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : '';
  }
  function automaticSummary(events, formatDateTime = defaultDateTime) {
    const last = events.reduce((latest, event) => stamp(event.eventDate) > stamp(latest?.eventDate) || !latest ? event : latest, null);
    const recent = last ? String(formatDateTime(last.eventDate) ?? '') : '';
    return `자동 운전시간 조회 ${events.length.toLocaleString('ko-KR')}건${recent ? ' · 최근 ' + recent : ''}`;
  }
  function render(events, renderer) {
    if (typeof renderer !== 'function') throw new TypeError('A history row renderer is required');
    return events.map(event => { const html = renderer(event); if (typeof html !== 'string') throw new TypeError('History rows must render as HTML strings'); return html; }).join('');
  }
  function renderAssetTimeline(events, options = {}) {
    const rows = partition(events), major = render(rows.major, options.renderEvent);
    if (!rows.automatic.length) return major;
    return major + `<details class="blower-history-auto-log blower-history-auto-log--asset"><summary>${escape(automaticSummary(rows.automatic, options.formatDateTime))}</summary><div class="blower-history-auto-log-content">${render(rows.automatic, options.renderEvent)}</div></details>`;
  }
  function renderHistoryTable(events, options = {}) {
    const rows = partition(events), major = render(rows.major, options.renderRow);
    if (!rows.automatic.length) return major;
    const labels = options.headers ?? headers, count = options.columnCount ?? labels.length;
    if (!Array.isArray(labels) || !labels.length || labels.length !== count || !Number.isSafeInteger(count) || count < 1 || count > 32) throw new TypeError('History table columns do not match');
    const heading = `<thead><tr>${labels.map(label => `<th scope="col">${escape(label)}</th>`).join('')}</tr></thead>`;
    return major + `<tr class="blower-history-auto-log-row"><td colspan="${count}"><details class="blower-history-auto-log blower-history-auto-log--table"><summary>${escape(automaticSummary(rows.automatic, options.formatDateTime))}</summary><div class="table-wrap"><table class="history-table" aria-label="자동 운전시간 조회 이력">${heading}<tbody>${render(rows.automatic, options.renderRow)}</tbody></table></div></details></td></tr>`;
  }
  return {isAutomaticRunHistory, partition, renderAssetTimeline, renderHistoryTable};
});
