/* Read-only routing metadata for an accepted Blower runtime request.
 * This is derived from the saved intent, never from a browser flag. The
 * dedicated apply actions still validate the immutable recovery snapshot,
 * source proof and current owner before changing a value. */
const ROLE = 'role-priority-recovery-v1:';
const COVERAGE = 'coverage-recovery-v1:';
const WINDOW = 'completion-window-recovery-v1:';
const SIGNAL_ONLY = 'signal-only-v1:';
const DAY = 86400000;
const clean = value => typeof value === 'string' && value === value.trim() ? value : '';
const stamp = value => typeof value === 'string' && value ? Date.parse(value) : NaN;
const marker = value => typeof value === 'string' && ['role-priority-recovery-', 'coverage-recovery-', 'completion-window-recovery-']
  .some(prefix => value.trim().startsWith(prefix));

export function scheduledRuntimeRecoveryMetadata(row) {
  if (!row || typeof row !== 'object') return {};
  const key = clean(row.reuse_key), revision = clean(row.expected_cycle_runtime_revision);
  if (!marker(row.reuse_key) && !marker(row.expected_cycle_runtime_revision)) return {};
  const descriptor = { version: 1, mode: 'invalid', requestId: clean(row.request_id),
    assetTag: clean(row.asset_tag), dataParcTag: clean(row.dataparc_tag),
    startAt: clean(row.window_start), endAt: clean(row.window_end) };
  const invalid = () => ({ runtimeRecovery: descriptor });
  let mode = '', prefix = '', signal = '';
  if (key.startsWith(ROLE) && revision.startsWith(ROLE) && descriptor.assetTag === '103HRJ01AN601') {
    mode = 'role_priority'; prefix = ROLE; signal = 'GSPOGE.ABB_DCS.103HRJ01AN601XB04';
  } else if (key.startsWith(COVERAGE + 'confirmed_gap:') && revision.startsWith(COVERAGE) &&
      descriptor.assetTag === '104ETG30AN602') {
    mode = 'confirmed_gap'; prefix = COVERAGE; signal = 'GSPOGE.ABB_DCS.103ETG30AN602XJ04';
  } else if (key.startsWith(COVERAGE + 'seal_first_run:') && revision.startsWith(COVERAGE) &&
      ['204HHL10AN611', '204HHL10AN631'].includes(descriptor.assetTag)) {
    mode = 'seal_first_run'; prefix = COVERAGE; signal = `GSPOGE.ABB_DCS.${descriptor.assetTag}XB04`;
  } else if (key.startsWith(WINDOW) && revision.startsWith(WINDOW) && descriptor.assetTag === '204HHL60AP631') {
    mode = 'completion_window_zero'; prefix = WINDOW; signal = 'GSPOGE.ABB_DCS.204HHL60AP631XB04';
  } else return invalid();
  let hash = key.slice(prefix.length + (prefix === COVERAGE ? mode.length + 1 : 0));
  const signalOnly = hash.startsWith(SIGNAL_ONLY);
  if (signalOnly) hash = hash.slice(SIGNAL_ONLY.length);
  const start = stamp(descriptor.startAt), end = stamp(descriptor.endAt);
  const owner = stamp(row.expected_last_replacement_at), startRevision = clean(row.expected_cycle_start_revision);
  const runtimeRevision = revision.slice(prefix.length);
  if (Number(row.schema_version) !== 1 || !/^[A-Za-z0-9:_-]{1,200}$/.test(descriptor.requestId) ||
      !/^[a-f0-9]{64}$/.test(hash) || descriptor.dataParcTag !== signal ||
      !runtimeRevision || runtimeRevision.length + prefix.length > 200 || marker(runtimeRevision) ||
      !startRevision || !['legacy', 'started'].includes(row.expected_cycle_start_state) ||
      signalOnly !== startRevision.startsWith(SIGNAL_ONLY) ||
      signalOnly && (row.expected_cycle_start_state !== 'legacy' || clean(row.expected_cycle_started_at)) ||
      !Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(owner) ||
      start < owner || end <= start || end - start > 366 * DAY) return invalid();
  return { runtimeRecovery: { ...descriptor, mode } };
}
