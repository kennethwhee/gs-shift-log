import { incrementalEvidence } from './blower-incremental.js';

function instant(value) {
  return typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
}

const SEAL_POT_FIRST_RUN_ORIGIN = Date.parse('2026-05-11T00:00:00+09:00');

function sealPotFirstRunScope(source) {
  return /^204HHL10AN(?:611|631)$/.test(source.assetTag) &&
    source.dataParcTag === `GSPOGE.ABB_DCS.${source.assetTag}XB04` &&
    source.expectedCycleStartState === 'legacy' && !source.expectedCycleStartedAt && !source.signalOnlyCycle &&
    !/^(?:append-v1|signal-only-v1):/.test(source.expectedCycleStartRevision || '') &&
    !/^append-v1:/.test(source.expectedCycleRuntimeRevision || '') &&
    instant(source.expectedLastReplacementAt) === SEAL_POT_FIRST_RUN_ORIGIN;
}

function firstRunInFullWindow(source) {
  const timestamp = instant(source.firstRunStartedAt);
  const end = instant(source.observedAt || source.endAt);
  return sealPotFirstRunScope(source) && !source.incremental &&
    instant(source.startAt) === SEAL_POT_FIRST_RUN_ORIGIN && source.startState === 'stopped' &&
    SEAL_POT_FIRST_RUN_ORIGIN < timestamp && timestamp < end &&
    source.firstRunStartedAt === new Date(timestamp).toISOString() &&
    Number.isSafeInteger(source.runningSeconds) && source.runningSeconds > 0 &&
    source.runningSeconds <= Math.round((end - timestamp) / 1000) ? source.firstRunStartedAt : '';
}

export function validatedFirstRunStart(result) {
  const first = firstRunInFullWindow(result);
  if (!first || !Array.isArray(result.chunks)) return '';
  const positive = result.chunks.findIndex(chunk => chunk.runningSeconds > 0);
  if (positive < 0 || result.chunks.reduce((seconds, chunk) => seconds + chunk.runningSeconds, 0) !== result.runningSeconds ||
      !result.chunks.slice(0, positive).every(chunk => fullStateWindow(chunk, 'stopped'))) return '';
  const chunk = result.chunks[positive], timestamp = instant(first);
  const start = instant(chunk.startAt), end = instant(chunk.endAt);
  return chunk.startState === 'stopped' && start < timestamp && timestamp < end &&
    chunk.runningSeconds <= Math.round((end - timestamp) / 1000) ? first : '';
}

function fullStateWindow(window, state) {
  const duration = (instant(window.observedAt || window.endAt) - instant(window.startAt)) / 1000;
  return duration > 0 && window.startState === state && window.endState === state &&
    window.runningSeconds === (state === 'running' ? duration : 0);
}

function plausibleTransition(window, timestamp, state) {
  const start = instant(window.startAt), end = instant(window.observedAt || window.endAt);
  if (!(start < timestamp && timestamp < end) || window.endState !== state ||
      !Number.isSafeInteger(window.runningSeconds) || fullStateWindow(window, state)) return false;
  const available = state === 'running' ? window.runningSeconds : (end - start) / 1000 - window.runningSeconds;
  return (end - timestamp) / 1000 <= available + 1;
}

export function validatedTrailingStateStart(result) {
  const timestamp = instant(result.trailingStateStartedAt), state = result.endState;
  if (!['running', 'stopped'].includes(state) || !plausibleTransition(result, timestamp, state)) return '';
  const chunks = result.chunks || [];
  const owner = chunks.findIndex(chunk => plausibleTransition(chunk, timestamp, state));
  return owner >= 0 && chunks.slice(owner + 1).every(chunk => fullStateWindow(chunk, state))
    ? new Date(timestamp).toISOString() : '';
}

function savedPreviousInterval(source, current, link, rowsById) {
  const row = rowsById.get(link.baseEventId);
  if (!row || row.tag_number !== source.assetTag || row.event_type !== 'runtime_correction' ||
      row.source_type !== 'dataparc_runtime' || row.created_at !== row.updated_at ||
      instant(row.event_date) !== instant(link.baseObservedAt)) return null;
  let previous;
  try { previous = JSON.parse(row.source_text); } catch { return null; }
  if (!previous || previous.schemaVersion !== source.schemaVersion || previous.requestType !== source.requestType ||
      row.source_log_id !== previous.requestId || row.id !== `dataparc_runtime:${previous.requestId}` ||
      previous.assetTag !== source.assetTag || previous.dataParcTag !== source.dataParcTag ||
      previous.expectedCycleStartRevision !== source.expectedCycleStartRevision ||
      instant(previous.expectedLastReplacementAt) !== instant(source.expectedLastReplacementAt) ||
      previous.endState !== current.startState || instant(previous.observedAt || previous.endAt) !== instant(link.baseObservedAt) ||
      !(instant(previous.startAt) < instant(link.baseObservedAt)) || previous.manualOverride) return null;
  const priorLink = incrementalEvidence(previous);
  if (previous.incremental && !priorLink ||
      instant(priorLink?.coverageStartAt || previous.startAt) !== instant(link.coverageStartAt) ||
      (priorLink?.totalRunningSeconds ?? previous.runningSeconds) !== link.baseRunningSeconds) return null;
  return previous;
}

export function savedFirstRunStart(source, rows) {
  if (!sealPotFirstRunScope(source)) return '';
  const byId = new Map(rows.map(row => [row.id, row]));
  let current = source;
  while (current && sealPotFirstRunScope(current)) {
    if (!current.incremental) return firstRunInFullWindow(current);
    const link = incrementalEvidence(current);
    if (!link || instant(link.coverageStartAt) !== SEAL_POT_FIRST_RUN_ORIGIN) return '';
    current = savedPreviousInterval(source, current, link, byId);
  }
  return '';
}

// Each append stores its own measured interval. Follow only the immutable
// predecessor link while every newer interval proves an unchanged RUN state.
export function savedTrailingStateStart(source, rows) {
  const state = source.endState;
  if (!['running', 'stopped'].includes(state)) return '';
  const byId = new Map(rows.map(row => [row.id, row]));
  let current = source;
  while (current) {
    const timestamp = instant(current.trailingStateStartedAt);
    if (plausibleTransition(current, timestamp, state)) return new Date(timestamp).toISOString();
    const link = incrementalEvidence(current);
    if (!link || !fullStateWindow(current, state)) return '';
    current = savedPreviousInterval(source, current, link, byId);
  }
  return '';
}
