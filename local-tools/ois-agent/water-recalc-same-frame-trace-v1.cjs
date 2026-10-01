'use strict';
// WATER_RECALC_SAME_FRAME_TRACE_V1
// No login, fetch, OIS command invocation, data reset or request interception here.
// Watches the existing page. The one action is a regular click on its visible Recalculate control.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const VERSION = 'water-recalc-same-frame-trace-v1';
const FIELD_MAP = Object.freeze({
  rawWaterInflow: 'menu1_1_2', demiProduction: 'menu2_5_4', pureWaterUsage: 'menu2_6_13',
  rawWaterTankAmount: 'menu1_1_5', rawWaterTankRate: 'menu1_3_4',
  filteredWaterTankAmount: 'menu1_1_6', filteredWaterTankRate: 'menu1_3_5',
  demiWaterTankAmount: 'menu1_1_7', demiWaterTankRate: 'menu1_3_6'
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function logDirectory() {
  return path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'GSShiftLog', 'water-recalc-trace');
}
function clean(value, limit = 600) {
  return String(value ?? '').replace(/(authorization|cookie|password|passwd|token|api[_-]?key|agent[_-]?key|session)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/https?:\/\/[^\s"'<>]+/g, raw => safeUrl(raw)).slice(0, limit);
}
function safeUrl(value) {
  try { const u = new URL(value); return `${u.protocol}//${u.host}${u.pathname}`; } catch { return '(unavailable)'; }
}
function date(value) {
  const m = String(value ?? '').trim().match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);
  if (!m) return '';
  const d = `${m[1]}-${m[2]}-${m[3]}`;
  const n = new Date(`${d}T00:00:00Z`);
  return Number.isFinite(+n) && n.toISOString().slice(0, 10) === d ? d : '';
}
function finite(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  const s = String(value).replace(/,/g, '').trim();
  return s && Number.isFinite(Number(s)) ? Number(s) : null;
}
function limited(promise, ms, fallback) {
  let timer;
  return Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); })])
    .finally(() => clearTimeout(timer));
}
function summarizeRequest(request) {
  let body = '', url = '';
  try { body = request.postData() || ''; url = request.url(); } catch {}
  const out = { method: request.method(), url: safeUrl(url), command: '', fieldNames: [], dates: [] };
  const seenDates = new Set();
  function walk(value, depth = 0) {
    if (depth > 5 || value === null || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value).slice(0, 80)) {
      if (/^(?:cmd|command)$/i.test(key) && typeof item === 'string' && /^[\w.:-]{1,160}$/.test(item)) out.command = item;
      if (out.fieldNames.length < 60 && /^[\w-]{1,80}$/.test(key) && !out.fieldNames.includes(key)) out.fieldNames.push(key);
      if (/^(?:schdate|entry_date|targetDate|sourceDate|date|yearmon|start_date|end_date)$/i.test(key)) {
        const d = date(item);
        if (d) seenDates.add(d);
        else if (/^\d{4}[-/]?\d{2}$/.test(String(item))) seenDates.add(String(item));
      }
      if (item && typeof item === 'object') walk(item, depth + 1);
      if (typeof item === 'string' && item.length < 262144 && /^[\[{]/.test(item.trim())) {
        try { walk(JSON.parse(item), depth + 1); } catch {}
      }
    }
  }
  try { walk(Object.fromEntries(new URL(url).searchParams)); } catch {}
  if (body.length <= 262144) {
    try { walk(JSON.parse(body)); } catch { try { walk(Object.fromEntries(new URLSearchParams(body))); } catch {} }
  }
  out.dates = Array.from(seenDates);
  return out;
}
function summarizeResponse(payload) {
  const out = { type: Array.isArray(payload) ? 'array' : typeof payload, keys: [], resultType: '', rowCount: null, dates: [], waterRows: [] };
  if (!payload || typeof payload !== 'object') return out;
  out.keys = Object.keys(payload).slice(0, 40).map(k => clean(k, 80));
  for (const k of ['ok', 'success', 'status', 'resultCode', 'errorCode']) {
    if (typeof payload[k] === 'boolean' || typeof payload[k] === 'number') out[k] = payload[k];
    else if (typeof payload[k] === 'string') out[k] = clean(payload[k], 100);
  }
  out.hasError = payload.ok === false || payload.success === false || Boolean(payload.error);
  // Do not copy arbitrary response text, credentials, names or other business data.
  const result = Array.isArray(payload) ? payload : payload.result;
  out.resultType = Array.isArray(result) ? 'array' : typeof result;
  if (typeof result === 'boolean' || typeof result === 'number') out.resultScalar = result;
  const rows = Array.isArray(result) ? result : result && typeof result === 'object' ? [result] : [];
  out.rowCount = rows.length;
  const ds = new Set();
  for (const row of rows.slice(0, 100)) {
    if (!row || typeof row !== 'object') continue;
    for (const key of ['schdate', 'entry_date', 'targetDate', 'sourceDate', 'date']) {
      const d = date(row[key]); if (d) ds.add(d);
    }
    const fields = {};
    for (const [name, key] of Object.entries(FIELD_MAP)) if (Object.hasOwn(row, key)) fields[name] = finite(row[key]);
    if (Object.keys(fields).length && out.waterRows.length < 3) out.waterRows.push(fields);
  }
  out.dates = Array.from(ds).slice(0, 10);
  return out;
}
// This function runs in the frame. It only reads visible control metadata and displayed dates.
function inspectFrame() {
  const visible = el => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  };
  const compact = s => String(s ?? '').replace(/\s+/g, '').trim();
  const body = document.body?.innerText || '';
  const headerDates = Array.from(body.matchAll(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g))
    .slice(0, 10).map(m => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
  const inputDates = Array.from(document.querySelectorAll('input')).filter(el => visible(el) && !['hidden','password'].includes(el.type))
    .map(el => ({ id: el.id || '', name: el.name || '', value: el.value || '' }))
    .filter(o => /^\d{4}[-/]\d{2}[-/]\d{2}$/.test(o.value.trim())).slice(0, 10);
  const cssPath = el => {
    const segments = [];
    while (el && el.nodeType === 1) {
      const name = el.tagName.toLowerCase();
      let n = 1; for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === el.tagName) n++;
      segments.unshift(`${name}:nth-of-type(${n})`); el = el.parentElement;
    }
    return segments.join(' > ');
  };
  let candidates = Array.from(document.querySelectorAll('button,input[type="button"],input[type="submit"],a,[role="button"],[onclick]'))
    .filter(el => visible(el) && compact(el.value || el.innerText || el.getAttribute('aria-label') || el.title) === '재계산');
  // Nested labels are not independent controls. Keep the outer actionable control of a single group.
  candidates = candidates.filter(el => !candidates.some(other => other !== el && other.contains(el)));
  const buttons = candidates.slice(0, 10).map(el => ({
    selector: cssPath(el), tag: el.tagName, id: el.id || '', role: el.getAttribute('role') || '',
    className: String(el.className || '').slice(0, 200), type: el.type || '',
    disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true',
    label: '재계산', onclick: (el.getAttribute('onclick') || '').slice(0, 500)
  }));
  return { frameUrl: location.origin + location.pathname, headerDates: [...new Set(headerDates)], inputDates, buttons };
}
async function snapshot(frame) {
  if (!frame || frame.isDetached?.()) throw new Error('수처리 환경일지 화면이 닫히거나 교체되었습니다.');
  const result = await frame.evaluate(inspectFrame);
  for (const button of result.buttons) button.onclick = clean(button.onclick, 500);
  return result;
}
function observedDate(info) {
  const headers = [...new Set((info?.headerDates || []).map(date).filter(Boolean))];
  const inputs = [...new Set((info?.inputDates || []).map(i => date(i.value)).filter(Boolean))];
  if (headers.length !== 1 && !(headers.length === 0 && inputs.length === 1)) return '';
  const found = headers.length === 1 ? headers[0] : inputs[0];
  if (inputs.some(d => d !== found)) return '';
  return found;
}
function assertDate(info, targetDate) {
  const actual = observedDate(info);
  if (!actual || (targetDate && actual !== date(targetDate))) {
    throw new Error(`수처리 재계산 기준일 확인 실패: 요청 ${targetDate || '-'}, 화면 ${actual || '확인 불가'}`);
  }
  return actual;
}
function createTrace(page, targetDate, options = {}) {
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  const report = { version: VERSION, runId: id, targetDate, startedAt: new Date().toISOString(),
    note: 'Network responses and readable values are separate observations; neither alone proves server recalculation success.', events: [], requests: [] };
  let phase = 'date_query', owner = null, closed = false, lastSignature = '', lastActivity = Date.now();
  const tracked = new Map(), pendingBodies = new Set();
  const sanitize = value => {
    if (typeof value === 'string') return clean(value, 1800);
    if (Array.isArray(value)) return value.slice(0, 30).map(sanitize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 50).map(([k, v]) => [k, sanitize(v)]));
    return value;
  };
  const note = (event, detail = {}) => {
    if (!closed && report.events.length < 240) report.events.push({ at: new Date().toISOString(), phase, event, ...sanitize(detail) });
  };
  const errorText = error => clean(error?.message || error, 1600);
  const onRequest = request => {
    if (closed || tracked.size >= 80) return;
    let requestFrame; try { requestFrame = request.frame(); } catch { return; }
    const type = request.resourceType();
    if (!['xhr', 'fetch'].includes(type) && !/\/ajax\/data(?:\?|$)/.test(request.url())) return;
    if (owner && requestFrame !== owner) return;
    const item = { sequence: tracked.size + 1, phase, at: new Date().toISOString(), ...summarizeRequest(request),
      frameUrl: safeUrl(requestFrame.url()), response: null, finished: false };
    tracked.set(request, { item, frame: requestFrame }); report.requests.push(item); lastActivity = Date.now();
  };
  const onResponse = response => {
    const entry = tracked.get(response.request()); if (!entry || closed) return;
    entry.item.status = response.status(); lastActivity = Date.now();
    const job = (async () => {
      try {
        const headers = response.headers(), length = Number(headers['content-length'] || 0);
        entry.item.contentType = String(headers['content-type'] || '').slice(0, 120);
        if (length > 262144) { entry.item.bodySummary = 'omitted-size-limit'; return; }
        const raw = await limited(response.text(), 2000, null);
        if (raw === null) { entry.item.bodySummary = 'body-not-ready-within-diagnostic-budget'; return; }
        if (raw.length > 262144) { entry.item.bodySummary = 'omitted-size-limit'; return; }
        try { entry.item.response = summarizeResponse(JSON.parse(raw)); }
        catch { entry.item.bodySummary = 'non-json-response'; }
      } catch (error) { entry.item.bodySummary = errorText(error); }
    })();
    pendingBodies.add(job); job.finally(() => pendingBodies.delete(job));
  };
  const onFinished = request => {
    const entry = tracked.get(request); if (!entry || closed) return;
    entry.item.finished = true; entry.item.finishedAt = new Date().toISOString(); lastActivity = Date.now();
  };
  const onFailed = request => {
    const entry = tracked.get(request); if (!entry || closed) return;
    entry.item.finished = true; entry.item.failure = clean(request.failure()?.errorText); lastActivity = Date.now();
  };
  const onError = error => note('page-error', { message: errorText(error) });
  page.on('request', onRequest); page.on('response', onResponse); page.on('requestfinished', onFinished);
  page.on('requestfailed', onFailed); page.on('pageerror', onError);
  const trace = {
    report, note,
    setFrame(frame) { owner = frame; note('frame-pinned', { frameUrl: safeUrl(frame.url()) }); },
    setPhase(value) { phase = value; lastActivity = Date.now(); note('phase-start'); },
    async recordFrame(frame, stage) {
      const info = await snapshot(frame); note(stage, info); return info;
    },
    observeValues(values) {
      const fields = Object.fromEntries(Object.keys(FIELD_MAP).map(k => [k, finite(values?.[k])]));
      const signature = JSON.stringify([values?.sourceDate, fields]);
      if (signature !== lastSignature) { note('observed-values', { sourceDate: date(values?.sourceDate), fields }); lastSignature = signature; }
    },
    async waitForQuiet(timeoutMs = 30000, graceMs = 0) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const entries = [...tracked.values()].filter(e => !owner || e.frame === owner);
        const pending = entries.filter(e => !e.item.finished);
        if (!pending.length && Date.now() - lastActivity >= 300 && Date.now() - start >= graceMs) {
          const sinceClick = entries.filter(e => e.item.phase === 'recalculate');
          note('network-settled-observation', { afterClickRequests: sinceClick.length,
            commands: [...new Set(sinceClick.map(e => e.item.command).filter(Boolean))],
            recalcSuccess: 'NOT_INFERRED_FROM_HTTP_STATUS_OR_EXISTING_VALUES' });
          return;
        }
        await sleep(50);
      }
      note('network-wait-timeout');
      throw new Error('수처리 화면의 조회/재계산 요청이 제한 시간 안에 종료되지 않았습니다. 추적 로그를 확인하세요.');
    },
    async finish() {
      page.removeListener('request', onRequest); page.removeListener('response', onResponse);
      page.removeListener('requestfinished', onFinished); page.removeListener('requestfailed', onFailed); page.removeListener('pageerror', onError);
      await limited(Promise.allSettled([...pendingBodies]), 2200, null);
      if (closed) return '';
      report.finishedAt = new Date().toISOString();
      report.recalculation = { confirmed: null, reason: 'The actual recalc service and success contract must be identified from this trace, not guessed.' };
      closed = true;
      const directory = options.directory || logDirectory();
      try {
        fs.mkdirSync(directory, { recursive: true });
        const output = path.join(directory, `GS_Water_Recalc_Trace_${targetDate}_${id}.json`);
        fs.writeFileSync(output, JSON.stringify(report, null, 2), 'utf8');
        (options.logger || console).log(`[WATER-RECALC-TRACE-V1] TRACE_FILE=${output}`);
        return output;
      } catch (error) {
        (options.logger || console).warn('[WATER-RECALC-TRACE-V1] trace write failed: ' + errorText(error));
        return '';
      }
    }
  };
  return trace;
}
async function clickRecalculate(frame, targetDate, trace, timeoutMs = 10000) {
  const before = await snapshot(frame);
  assertDate(before, targetDate);
  trace?.note('before-recalculate', before);
  if (before.buttons.length !== 1) throw new Error(`수처리 재계산 버튼을 하나로 특정하지 못했습니다. 표시 후보 ${before.buttons.length}개`);
  const control = before.buttons[0];
  if (control.disabled) throw new Error('수처리 재계산 버튼이 비활성 상태입니다.');
  const locator = frame.locator(control.selector);
  // Native Playwright click waits for visibility, stability, enabled state and event reception.
  // No force:true, synthetic dispatch, guessed handler invocation, or second click on error.
  await locator.scrollIntoViewIfNeeded({ timeout: timeoutMs });
  const current = await snapshot(frame);
  assertDate(current, targetDate);
  if (current.buttons.length !== 1 || current.buttons[0].selector !== control.selector) {
    throw new Error('수처리 재계산 직전 화면 구성이 변경되었습니다.');
  }
  trace?.setPhase('recalculate');
  trace?.note('native-click-start', { selector: control.selector, id: control.id, frameUrl: before.frameUrl });
  try {
    await locator.click({ timeout: timeoutMs });
    trace?.note('native-click-returned', { means: 'Click completed; NOT a server recalculation success assertion.' });
  } catch (error) {
    trace?.note('native-click-failed', { message: clean(error?.message || error, 1600) });
    throw error;
  }
}
module.exports = { VERSION, FIELD_MAP, createTrace, snapshot, observedDate, assertDate, clickRecalculate,
  logDirectory, summarizeRequest, summarizeResponse, finite, date, inspectFrame };
