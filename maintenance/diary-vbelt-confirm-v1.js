import { normalizeContent, isReplacementCandidate, normalizeAnnotation } from './diary-vbelt-core-v1.js?keywords=20261111-v2';

const editorStates = new WeakMap();
let assetRequest = null;
let assetRequestIdentity = '';
const hasAnnotation = entry => entry?.vBeltReplacement !== undefined;
const unchecked = content => ({ version: 1, confirmed: false, content: normalizeContent(content), targets: [] });
const escapeText = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

function copyAnnotation(entry, content = entry?.content) {
  if (!hasAnnotation(entry)) return undefined;
  return normalizeAnnotation(entry.vBeltReplacement, content) || unchecked(content);
}

function copyNormalizedAnnotation(sourceEntry, normalizedEntry) {
  if (!hasAnnotation(sourceEntry)) return undefined;
  const original = normalizeAnnotation(sourceEntry.vBeltReplacement, sourceEntry.content);
  // Only the existing mechanical time/TAG parser may rebind valid saved proof.
  // A changed source body must never regain confirmation from a stale annotation.
  if (original && typeof normalizeExistingLogEntryTime === 'function') {
    const expected = normalizeExistingLogEntryTime({ ...sourceEntry, category: normalizedEntry?.category || sourceEntry.category });
    if (normalizeContent(expected?.content) === normalizeContent(normalizedEntry?.content)) {
      return normalizeAnnotation({ ...original, content: normalizeContent(normalizedEntry.content) }, normalizedEntry.content)
        || unchecked(normalizedEntry.content);
    }
  }
  return copyAnnotation(normalizedEntry);
}

function legacyInputAnnotation(entry, content) {
  return hasAnnotation(entry) ? copyAnnotation(entry, content)
    : (isReplacementCandidate(content) ? unchecked(content) : undefined);
}

function resetCopiedAnnotation(entry, content = entry?.content) {
  return hasAnnotation(entry) || isReplacementCandidate(content) ? unchecked(content) : undefined;
}

function badgeHtml(entry) {
  const annotation = copyAnnotation(entry);
  return annotation?.confirmed === true
    ? '<span class="diary-vbelt-confirmed-badge" title="작성자가 선택한 설비의 V-belt 교체 완료를 확인했습니다.">V-belt 교체 확인</span>'
    : '';
}

function editorHtml() {
  return `<div class="diary-vbelt-confirm" hidden>
    <label class="diary-vbelt-confirm__check"><input type="checkbox" name="diaryVBeltConfirmed" class="diary-vbelt-confirm__checkbox"> V-belt 교체 완료</label>
    <p class="diary-vbelt-confirm__notice" role="status" hidden></p>
    <div class="diary-vbelt-confirm__details" hidden>
      <div class="diary-vbelt-confirm__targets"></div>
      <button type="button" class="diary-vbelt-confirm__add" aria-label="교체 설비 추가" title="교체 설비 추가">＋</button>
      <button type="button" class="diary-vbelt-confirm__retry" hidden>설비 목록 다시 불러오기</button>
    </div>
    <p class="diary-vbelt-confirm__error" role="alert" hidden></p>
  </div>`;
}

function editorDate() {
  return String(document.getElementById('logDate')?.value || '').trim();
}

async function loadAssets() {
  const headers = typeof getShiftLogAuthHeaders === 'function' ? getShiftLogAuthHeaders() : { Accept: 'application/json' };
  const identity = String(headers.Authorization || '');
  if (assetRequest && identity === assetRequestIdentity) return assetRequest;
  assetRequestIdentity = identity;
  const request = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/blower-history?action=replacement_assets', {
        method: 'GET', headers, credentials: 'same-origin', signal: controller.signal
      });
      const body = await response.json();
      if (!response.ok || body?.ok !== true || !Array.isArray(body.assets)) throw new Error('설비 목록을 불러오지 못했습니다. 다시 시도해 주세요.');
      const assets = body.assets.filter(asset => asset && typeof asset.tagNumber === 'string').map(asset => ({ ...asset, tagNumber: asset.tagNumber.trim().toUpperCase() }));
      if (!assets.length) throw new Error('선택할 교체 설비가 없습니다. 설비 목록을 확인해 주세요.');
      return assets;
    } catch (error) {
      throw new Error(error?.name === 'AbortError' ? '설비 목록 응답이 늦습니다. 다시 시도해 주세요.' : (error?.message || '설비 목록을 불러오지 못했습니다.'));
    } finally {
      clearTimeout(timer);
    }
  })();
  assetRequest = request;
  try {
    return await request;
  } catch (error) {
    if (assetRequest === request) assetRequest = null;
    throw error;
  }
}

function targetDrafts(state) {
  const rows = [...state.root.querySelectorAll('.diary-vbelt-confirm__target')];
  return rows.map(row => ({
    tagNumber: String(row.querySelector('[data-vbelt-tag]')?.value || '').trim().toUpperCase(),
    replacedOn: String(row.querySelector('[data-vbelt-date]')?.value || '').trim(),
    completedTime: String(row.querySelector('[data-vbelt-time]')?.value || '').trim()
  }));
}

function showError(state, message, focus = null) {
  const error = state.root.querySelector('.diary-vbelt-confirm__error');
  error.textContent = message;
  error.hidden = !message;
  focus?.focus();
}

function renderTargets(state) {
  const targetHost = state.root.querySelector('.diary-vbelt-confirm__targets');
  targetHost.innerHTML = state.targets.map((target, index) => {
    const options = state.assets.map(asset => {
      const fallbackName = [asset.unitNo === 'shared' ? '공용' : (asset.unitNo ? `${asset.unitNo}호기` : ''), asset.blowerType, asset.positionLabel].filter(Boolean).join(' ');
      const label = `${asset.displayName || asset.equipmentName || fallbackName} [${asset.tagNumber}]`;
      return `<option value="${escapeText(asset.tagNumber)}"${asset.tagNumber === target.tagNumber ? ' selected' : ''}>${escapeText(label)}</option>`;
    }).join('');
    const unavailable = target.tagNumber && !state.assets.some(asset => asset.tagNumber === target.tagNumber)
      ? `<option value="${escapeText(target.tagNumber)}" selected>목록 확인 필요 [${escapeText(target.tagNumber)}]</option>` : '';
    return `<div class="diary-vbelt-confirm__target">
      <label><span class="diary-vbelt-confirm__caption">교체 설비</span><select data-vbelt-tag name="diaryVBeltTag${index}" title="교체 설비"${state.loading ? ' disabled' : ''}><option value="">${state.loading ? '설비 목록 불러오는 중…' : '교체 설비 선택'}</option>${unavailable}${options}</select></label>
      <label><span class="diary-vbelt-confirm__caption">실제 교체일</span><input data-vbelt-date name="diaryVBeltDate${index}" type="date" title="실제 교체일" value="${escapeText(target.replacedOn)}"></label>
      <label><span class="diary-vbelt-confirm__caption">완료 시각 (선택)</span><input data-vbelt-time name="diaryVBeltTime${index}" type="time" title="완료 시각 (선택) · 모르면 비워두세요" value="${escapeText(target.completedTime)}"></label>
      <button type="button" class="diary-vbelt-confirm__remove" data-vbelt-remove="${index}" aria-label="교체 설비 ${index + 1} 삭제"${state.targets.length === 1 ? ' hidden' : ''}>×</button>
    </div>`;
  }).join('');
  state.root.querySelector('.diary-vbelt-confirm__add').disabled = state.targets.length >= 27;
}

function syncVisibility(state) {
  const candidate = isReplacementCandidate(state.getContent());
  state.root.hidden = !candidate && !state.invalidated;
  state.root.querySelector('.diary-vbelt-confirm__check').hidden = !candidate;
  state.root.querySelector('.diary-vbelt-confirm__details').hidden = !candidate || !state.checkbox.checked;
  const notice = state.root.querySelector('.diary-vbelt-confirm__notice');
  notice.hidden = !state.invalidated;
  notice.textContent = state.invalidated ? '내용이 변경되어 교체 완료 확인을 다시 해주세요.' : '';
  if (!candidate) state.checkbox.checked = false;
}

async function ensureAssets(state) {
  if (state.assets.length || state.loading) return;
  state.loading = true;
  state.root.querySelector('.diary-vbelt-confirm__retry').hidden = true;
  state.targets = targetDrafts(state);
  renderTargets(state);
  try {
    const assets = await loadAssets();
    if (!state.root.isConnected) return;
    state.assets = assets;
    showError(state, '');
  } catch (error) {
    if (!state.root.isConnected) return;
    showError(state, error.message);
    state.root.querySelector('.diary-vbelt-confirm__retry').hidden = false;
  } finally {
    state.loading = false;
    if (state.root.isConnected) {
      state.targets = targetDrafts(state);
      renderTargets(state);
    }
  }
}

function mountEditor(editor, previousEntry = null, inputSelector = '.section-context-entry-content', readContent = value => value) {
  const root = editor.querySelector('.diary-vbelt-confirm');
  const input = editor.querySelector(inputSelector);
  if (!root || !input || editorStates.has(editor)) return;
  // Keep the leader quick-add's visual and keyboard order identical.
  const quickRow = editor.querySelector('.leader-role-quick-add-editor__input-row');
  const quickSave = quickRow?.querySelector('.leader-role-quick-add-save');
  if (quickSave) quickRow.insertBefore(root, quickSave);
  const getContent = () => readContent(input.value);
  const initialContent = getContent();
  const annotation = copyAnnotation(previousEntry, initialContent);
  const raw = previousEntry?.vBeltReplacement;
  const state = {
    editor, root, getContent, checkbox: root.querySelector('.diary-vbelt-confirm__checkbox'),
    hadAnnotation: hasAnnotation(previousEntry),
    content: normalizeContent(initialContent),
    invalidated: hasAnnotation(previousEntry) && !normalizeAnnotation(raw, initialContent),
    targets: annotation?.confirmed ? annotation.targets.map(target => ({ ...target })) : [{ tagNumber: '', replacedOn: editorDate(), completedTime: '' }],
    assets: [], loading: false
  };
  state.checkbox.checked = annotation?.confirmed === true;
  editorStates.set(editor, state);
  renderTargets(state);
  syncVisibility(state);
  if (state.checkbox.checked) void ensureAssets(state);
  input.addEventListener('input', () => {
    const nextContent = normalizeContent(getContent());
    if (nextContent !== state.content) {
      if (state.checkbox.checked || state.hadAnnotation) {
        state.invalidated = true;
        state.hadAnnotation = true;
      }
      state.checkbox.checked = false;
      state.targets = [{ tagNumber: '', replacedOn: editorDate(), completedTime: '' }];
      state.content = nextContent;
      renderTargets(state);
      showError(state, '');
    }
    syncVisibility(state);
  });
  state.checkbox.addEventListener('change', () => {
    state.hadAnnotation = true;
    if (state.checkbox.checked) state.invalidated = false;
    showError(state, '');
    syncVisibility(state);
    if (state.checkbox.checked) void ensureAssets(state);
  });
  root.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.diary-vbelt-confirm__add')) {
      state.targets = targetDrafts(state);
      if (state.targets.length < 27) state.targets.push({ tagNumber: '', replacedOn: editorDate(), completedTime: '' });
      renderTargets(state);
    } else if (target.closest('[data-vbelt-remove]')) {
      const index = Number(target.closest('[data-vbelt-remove]').dataset.vbeltRemove);
      state.targets = targetDrafts(state);
      if (state.targets.length > 1) state.targets.splice(index, 1);
      renderTargets(state);
    } else if (target.closest('.diary-vbelt-confirm__retry')) {
      void ensureAssets(state);
    }
  });
}

function readEditor(editor, content, previousEntry = null) {
  const state = editorStates.get(editor);
  if (!state) return { ok: true, annotation: legacyInputAnnotation(previousEntry, content) };
  const normalized = normalizeContent(content);
  const currentInput = normalizeContent(state.getContent());
  // Compare the live input before the editor's existing numbering/time cleanup.
  // This catches programmatic edits without treating that cleanup as a new edit.
  if (currentInput !== state.content) {
    state.checkbox.checked = false;
    state.invalidated = state.hadAnnotation || Boolean(previousEntry?.vBeltReplacement?.confirmed);
    state.hadAnnotation = state.hadAnnotation || state.invalidated;
    state.content = currentInput;
    syncVisibility(state);
  }
  if (!state.checkbox.checked || !isReplacementCandidate(content)) {
    return { ok: true, annotation: state.hadAnnotation || isReplacementCandidate(content) ? unchecked(content) : undefined };
  }
  if (state.loading || !state.assets.length) {
    showError(state, '설비 목록을 불러온 뒤 교체한 설비를 선택해 주세요.');
    return { ok: false };
  }
  const targets = targetDrafts(state);
  if (targets.some(target => !target.tagNumber || !state.assets.some(asset => asset.tagNumber === target.tagNumber))) {
    showError(state, '실제로 교체한 설비를 목록에서 선택해 주세요.', state.root.querySelector('[data-vbelt-tag]'));
    return { ok: false };
  }
  if (targets.some(target => !target.replacedOn)) {
    showError(state, '실제 교체일을 입력해 주세요.', state.root.querySelector('[data-vbelt-date]'));
    return { ok: false };
  }
  const annotation = normalizeAnnotation({ version: 1, confirmed: true, content: normalized, targets }, content);
  if (!annotation) {
    showError(state, '중복 설비, 실제 교체일과 완료 시각을 확인해 주세요.');
    return { ok: false };
  }
  showError(state, '');
  return { ok: true, annotation };
}

window.GSDiaryVBeltConfirm = Object.freeze({ editorHtml, mountEditor, readEditor, copyAnnotation, copyNormalizedAnnotation, legacyInputAnnotation, resetCopiedAnnotation, badgeHtml });
