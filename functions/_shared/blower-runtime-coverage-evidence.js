/* Read-only evidence for the value currently owned by a Blower cycle.
 * Measured-window coverage and physical belt-basis certainty are independent.
 * The legacy coverageComplete flag is also used as a conservative query guard;
 * this projection must never relax it, alter a counter, or authorize a query.
 */
const instant = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ? Date.parse(value) : NaN;
const sameInstant = (left, right) => Number.isFinite(instant(left)) && instant(left) === instant(right);
const number = value => !['number', 'string'].includes(typeof value) ||
  typeof value === 'string' && !value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0
  ? null : Number(value);
const sameHours = (left, right) => number(left) !== null && number(right) !== null &&
  Math.abs(number(left) - number(right)) <= 0.000001;

function currentRuntimeOwner(asset, rows) {
  const anchor = instant(asset.cycle_runtime_anchor_at);
  if (!Number.isFinite(anchor)) return null;
  return (rows || []).filter(row => row.tag_number === asset.tag_number &&
    ['runtime_correction', 'startup', 'operation_start', 'operation_stop'].includes(row.event_type) &&
    instant(row.event_date) === anchor)
    .sort((a, b) => Date.parse(b.updated_at || b.created_at || b.event_date) - Date.parse(a.updated_at || a.created_at || a.event_date) ||
      String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(b.id || '').localeCompare(String(a.id || '')))[0] || null;
}

export function currentManualRuntimeMeasurement(asset, rows, { now, stateForEvent }) {
  const replacement = instant(asset.last_replacement_at), anchor = instant(asset.cycle_runtime_anchor_at);
  if (!Number.isFinite(replacement) || !Number.isFinite(anchor) || anchor < replacement ||
      anchor > now.getTime() || number(asset.cycle_runtime_hours) === null ||
      !['running', 'stopped'].includes(asset.cycle_runtime_state)) return null;
  const owner = currentRuntimeOwner(asset, rows);
  if (!owner || !sameHours(owner.runtime_hours, asset.cycle_runtime_hours) ||
      owner.source_type !== 'manual' || owner.event_type !== 'runtime_correction' ||
      stateForEvent(owner) !== asset.cycle_runtime_state) return null;
  let metadata;
  try { metadata = JSON.parse(owner.source_text || '{}'); } catch { metadata = {}; }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) metadata = {};
  const description = [owner.issue_type, owner.action_type, owner.note, owner.source_text].map(value => String(value || '')).join(' ');
  if (metadata.replacementEdit || metadata.requiresRunRefresh ||
      /ois|vibration|진동\s*(?:계산|누적|적용)|온도\s*(?:계산|누적|적용)/i.test(description)) return null;
  return owner;
}

function physicalBasisConfirmed(asset, automatic, review, initialBasis) {
  if (review && review.cycleBasisConfirmed !== true) return false;
  if (automatic?.completionClockConflict === true || automatic?.rolePrioritySourceRevoked === true ||
      automatic?.registeredRuntimeRange === true || automatic?.rangeTrackingAllowed === true ||
      automatic?.rolePrioritySelection?.requiredRebuild === true ||
      automatic?.rolePrioritySelection?.timePrecision === 'day') return false;
  if (initialBasis?.cycleBasisKind === 'initial_startup') {
    return initialBasis.initialStartupEvidenceValid === true &&
      sameInstant(initialBasis.initialStartedAt, asset.last_replacement_at);
  }
  if (automatic?.schemaVersion === 3 && automatic.clockKnown === true && automatic.timePrecision === 'minute' &&
      sameInstant(automatic.confirmedReplacementAt || automatic.requiredStartAt, asset.last_replacement_at)) return true;
  // Manual replacement registration accepts a calendar date and normalizes it
  // to midnight. Even an explicit timestamp has no independently validated
  // completion-clock proof. Preserve that registered basis without certifying
  // the physical boundary; only the canonical evidence above may do so.
  return false;
}

export function buildRuntimeCoverageEvidence({ asset, rows = [], measuredBasis = null, runRuntime = null,
  manualMeasurement = null, replacementAutoCycle = null, cycleSourceReview = null, initialBasis = null }) {
  const pending = replacementAutoCycle?.requiresRunRefresh === true;
  const start = instant(measuredBasis?.startAt), end = instant(measuredBasis?.observedAt);
  // The legacy append selector may find an older equal-valued receipt after a
  // newer same-anchor event disagrees with the saved counter. Certify only the
  // latest owner, chosen before comparing numbers. Same-value manual/automatic
  // boundaries may still preserve a proven receipt at its original endpoint.
  const owner = currentRuntimeOwner(asset, rows);
  const ownerMatches = Boolean(owner && sameHours(owner.runtime_hours, asset.cycle_runtime_hours));
  const measured = !pending && ownerMatches && measuredBasis?.appendReady === true &&
    typeof measuredBasis.requestId === 'string' && Boolean(measuredBasis.requestId.trim()) &&
    Number.isFinite(start) && Number.isFinite(end) && start < end &&
    sameHours(measuredBasis.runtimeHours, asset.cycle_runtime_hours) &&
    (!runRuntime || runRuntime.verified === true && runRuntime.source === 'dataparc');
  const manual = !pending && ownerMatches && !measured && number(asset.cycle_runtime_hours) !== null &&
    (runRuntime?.verified === true && runRuntime.source === 'manual' ||
      manualMeasurement && sameHours(manualMeasurement.runtime_hours, asset.cycle_runtime_hours));
  const cycleBasisConfirmed = physicalBasisConfirmed(asset, replacementAutoCycle, cycleSourceReview, initialBasis);
  const coverageComplete = measured && typeof measuredBasis.coverageComplete === 'boolean'
    ? measuredBasis.coverageComplete : null;
  const first = instant(measuredBasis?.firstRunStartedAt);
  const firstRunVerified = measured && coverageComplete === true && Number.isFinite(first) && first > start && first < end;
  const missingLeadingSeconds = measured && Number.isSafeInteger(measuredBasis.missingLeadingSeconds) &&
    measuredBasis.missingLeadingSeconds >= 0 ? measuredBasis.missingLeadingSeconds : null;
  // A registered restart may make the legacy window complete without proving
  // the earlier belt interval. Only a receipt covering the physical origin may
  // certify the whole cycle; never assume the unqueried prefix was stopped.
  const physicalOrigin = instant(initialBasis?.initialStartupEvidenceValid === true
    ? initialBasis.initialStartedAt : asset.last_replacement_at);
  return {
    version: 1,
    source: measured ? 'dataparc' : manual ? 'manual' : 'unverified',
    measurementVerified: Boolean(measured || manual),
    hours: measured ? number(measuredBasis.runtimeHours) : manual ? number(asset.cycle_runtime_hours) : null,
    requestId: measured ? measuredBasis.requestId : '',
    startAt: measured ? measuredBasis.startAt : '',
    observedAt: measured ? measuredBasis.observedAt : manual ? runRuntime?.measuredAt || manualMeasurement?.event_date || '' : '',
    requiredStartAt: measured ? measuredBasis.requiredStartAt || '' : '',
    missingLeadingSeconds,
    coverageComplete,
    cycleBasisConfirmed,
    wholeCycleVerified: Boolean(measured && coverageComplete === true && missingLeadingSeconds === 0 &&
      cycleBasisConfirmed && Number.isFinite(physicalOrigin) && start <= physicalOrigin && !cycleSourceReview),
    firstRunVerified
  };
}
