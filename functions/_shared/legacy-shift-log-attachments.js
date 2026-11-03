// Read-time attachment recovery for migrated shift logs. No writes or schema changes.
const text = value => String(value ?? '').trim();
const list = value => Array.isArray(value) ? value : [];

export function getLegacyDiaryIdForAttachments(log) {
  const direct = text(log?.legacyDiaryId || log?.legacy_diary_id);
  if (direct) return direct;
  const id = text(log?.id);
  return id.startsWith('legacy-') ? text(id.slice(7)) : '';
}

function positiveId(value) {
  const id = text(value);
  return /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) > 0
    ? String(Number(id)) : '';
}

function legacyAttachment(row) {
  const id = positiveId(row?.id);
  const name = text(row?.file_name);
  const label = name.normalize('NFKC').replace(/\s+/g, '').replace(/：/g, ':').toLowerCase();
  if (!id || !name || ['제목', '유첨:제목'].includes(label)) return null;
  const url = '/api/legacy-attachment?id=' + encodeURIComponent(id);
  return {
    id, attachmentId: id, name, fileName: name,
    mimeType: text(row.mime_type) || 'application/octet-stream',
    fileSize: Number(row.file_size) || 0,
    uploadedAt: text(row.uploaded_at),
    url, previewUrl: url, downloadUrl: url,
    source: 'legacy', isLegacy: true
  };
}

function knownLegacyAttachments(log) {
  return list(log?.attachments).flatMap(file => {
    const match = /^\/api\/legacy-attachment\?id=(\d+)(?:&download=1)?$/.exec(text(file?.url || file?.previewUrl || file?.downloadUrl));
    if (!match) return [];
    const recovered = legacyAttachment({id: match[1], file_name: file.fileName || file.name,
      mime_type: file.mimeType, file_size: file.fileSize, uploaded_at: file.uploadedAt});
    return recovered ? [recovered] : [];
  });
}

function isLegacyAttachmentReference(file) {
  const url = text(file?.url || file?.previewUrl || file?.downloadUrl);
  return file?.isLegacy === true || file?.source === 'legacy' || url.startsWith('/api/legacy-attachment?');
}

function uniqueAttachments(files) {
  const seen = new Set();
  return files.filter(file => {
    if (!file || typeof file !== 'object') return false;
    const url = text(file.url || file.previewUrl || file.downloadUrl);
    const legacy = isLegacyAttachmentReference(file);
    const key = (legacy ? 'legacy:' : 'modern:') + text(file.attachmentId || file.id || url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sameLegacyGroup(row, log) {
  return text(row.legacy_diary_id) === getLegacyDiaryIdForAttachments(log)
    && text(row.legacy_work_date) === text(log.date || log.work_date)
    && text(row.legacy_shift).toUpperCase() === text(log.shift).toUpperCase()
    && text(row.legacy_role) === text(log.role);
}

export async function hydrateLegacyShiftLogAttachments(database, logs, options = {}) {
  const safeLogs = list(logs);
  const knownLogs = list(options.knownLogs || logs);
  const knownById = new Map(knownLogs.map(log => [text(log?.id), log]));
  const modernComplete = options.modernComplete !== false;
  const diaryIds = [...new Set(safeLogs.map(getLegacyDiaryIdForAttachments).filter(Boolean))];
  const rowsById = new Map(diaryIds.map(id => [id, []]));
  const failedIds = new Set();

  // The join and exact group check prevent a stray ID from attaching another log's files.
  // Chunked IN queries keep D1 bind counts bounded; ordinary new logs add no legacy query.
  for (let offset = 0; offset < diaryIds.length; offset += 80) {
    const chunk = diaryIds.slice(offset, offset + 80);
    try {
      const result = await database.prepare(`
        SELECT a.*, l.work_date AS legacy_work_date,
          l.shift AS legacy_shift, l.role AS legacy_role
        FROM legacy_attachments AS a
        INNER JOIN legacy_logs AS l ON l.legacy_diary_id = a.legacy_diary_id
        WHERE a.legacy_diary_id IN (${chunk.map(() => '?').join(', ')})
        ORDER BY a.legacy_diary_id ASC, a.id ASC
      `).bind(...chunk).all();
      if (!result || result.success === false || !Array.isArray(result.results)) throw new Error('LEGACY_ATTACHMENT_RESULT_UNAVAILABLE');
      for (const row of result.results) {
        const id = text(row.legacy_diary_id);
        if (rowsById.has(id)) rowsById.get(id).push(row);
      }
    } catch {
      for (const id of chunk) failedIds.add(id);
    }
  }

  return safeLogs.map(log => {
    const known = knownById.get(text(log.id)) || log;
    const diaryId = getLegacyDiaryIdForAttachments(log);
    const legacyComplete = !failedIds.has(diaryId);
    const legacy = !legacyComplete ? knownLegacyAttachments(known)
      : (rowsById.get(diaryId) || []).filter(row => sameLegacyGroup(row, log))
        .map(legacyAttachment).filter(Boolean);
    const authoritativeLegacy = uniqueAttachments(legacy);
    // On a complete modern lookup the caller supplied only current modern rows.
    // On failure known legacy rows are replaced by the separately resolved legacy set.
    const modern = list(log.attachments).filter(file => !isLegacyAttachmentReference(file));
    const attachments = uniqueAttachments([...modern, ...authoritativeLegacy]);
    const complete = modernComplete && legacyComplete;
    const previousCount = Math.max(0, Number(known.legacyAttachmentCount) || 0, list(known.attachments).length);
    return {...log, attachments,
      // Historical field name: callers use this as the total paperclip count.
      legacyAttachmentCount: complete ? attachments.length : Math.max(previousCount, attachments.length),
      attachmentLoadStatus: complete ? 'complete' : 'partial',
      attachmentLoadError: !complete
    };
  });
}

export async function attachmentStateForShiftLogRow(database, row, attachments) {
  let stored = {};
  try { const parsed = JSON.parse(row.log_json || '{}'); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed; } catch {}
  const known = {...stored, id: row.id, date: row.work_date, shift: row.shift, role: row.role};
  const [hydrated] = await hydrateLegacyShiftLogAttachments(database,
    [{...known, attachments}], {knownLogs: [known]});
  return {
    attachments: hydrated.attachments,
    legacyAttachmentCount: hydrated.legacyAttachmentCount,
    attachmentLoadStatus: hydrated.attachmentLoadStatus,
    attachmentLoadError: hydrated.attachmentLoadError
  };
}
