'use strict';
// SILO_RESULT_DELIVERY_V1. Retries delivery of one immutable result, never collection.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function retryable(error) {
  if (error?.code === 'SILO_ACK_INVALID') return false;
  const status = Number(error?.status);
  if (status) return status === 408 || status === 429 || status >= 500 && status <= 599;
  return ['OIS_AGENT_API_TIMEOUT', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN',
    'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(error?.code) ||
    ['TypeError', 'AbortError'].includes(error?.name);
}

async function deliverSiloResultV1({ requestId, result, agentId, directory, request,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.log }) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId)) throw new Error('Invalid SILO request ID.');
  const frozenResult = JSON.parse(JSON.stringify(result));
  const bodyText = JSON.stringify({ action: 'complete', requestId, result: frozenResult });
  const backup = path.join(directory, requestId + '.json');
  let backupSaved = false;
  const started = Date.now();
  const trace = (phase, extra = {}) => {
    try { log('[SILO DELIVERY V1] ' + JSON.stringify({ requestId, phase,
      at: new Date().toISOString(), elapsedMs: Date.now() - started, ...extra })); } catch {}
  };
  let temp;
  try {
    fs.mkdirSync(directory, { recursive: true });
    if (fs.existsSync(backup)) {
      const previous = JSON.parse(fs.readFileSync(backup, 'utf8'));
      if (previous.requestId !== requestId || stable(previous.result) !== stable(frozenResult)) {
        throw Object.assign(new Error('A different SILO result is already retained for this request.'), { code: 'SILO_BACKUP_CONFLICT' });
      }
    }
    temp = backup + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(temp, JSON.stringify({ version: 1, requestId, requestType: 'silo_level',
      agentId, targetDate: frozenResult.targetDate, retainedAt: new Date().toISOString(),
      result: frozenResult }, null, 2), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, backup);
    backupSaved = true;
  } catch (error) {
    if (temp) { try { fs.unlinkSync(temp); } catch {} }
    if (error.code === 'SILO_BACKUP_CONFLICT') throw error;
    trace('BACKUP_UNAVAILABLE', { code: error.code || 'WRITE_FAILED' });
  }
  trace('COLLECTED_RESULT_READY', { backupSaved });
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    trace('UPLOAD_START', { attempt });
    try {
      const ack = await request({ method: 'POST', timeoutMilliseconds: 10000, body: JSON.parse(bodyText) });
      const item = ack?.item;
      if (ack?.ok !== true || item?.id !== requestId || item?.requestType !== 'silo_level' ||
          item?.status !== 'complete' || item?.targetDate !== frozenResult.targetDate ||
          item?.agentId !== agentId || stable(item?.result) !== stable(frozenResult)) {
        throw Object.assign(new Error('SILO server completion acknowledgement does not match this result.'), { code: 'SILO_ACK_INVALID' });
      }
      trace('UPLOAD_ACK', { attempt, replayed: ack.replayed === true });
      if (backupSaved) { try { fs.unlinkSync(backup); } catch { trace('BACKUP_CLEANUP_DEFERRED'); } }
      return ack;
    } catch (error) {
      lastError = error;
      trace('UPLOAD_ERROR', { attempt, status: error.status || null, code: error.code || error.name || 'ERROR' });
      const retryAfter = Number(error.retryAfterMilliseconds) || 0;
      if (attempt === 3 || !retryable(error) || retryAfter > 30000) break;
      await wait(Math.max(attempt * 1000, retryAfter));
    }
  }
  const error = new Error('SILO 값 수집은 완료됐지만 업무일지 서버 저장을 확인하지 못했습니다. ' +
    (backupSaved ? '수집 결과는 회사 PC에 보관했습니다.' : '로컬 결과 파일 저장도 실패했습니다.'));
  error.code = 'SILO_RESULT_DELIVERY_FAILED';
  error.cause = lastError;
  error.backupPath = backupSaved ? backup : null;
  trace('DELIVERY_UNCONFIRMED', { backupSaved });
  throw error;
}
module.exports = { deliverSiloResultV1 };
