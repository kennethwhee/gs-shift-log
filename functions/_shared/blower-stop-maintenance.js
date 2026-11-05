const HOUR = 3600000;
const DAY = 24 * HOUR;
const WORK_WINDOW = HOUR;
const MAX_DIARY_ROWS = 96;
const STOP_MAINTENANCE_ASSET = /^(?:104|204)HHL(?:60AP|10AN)(?:611|621|631)$/;

const kstDate = timestamp => new Date(timestamp + 9 * HOUR).toISOString().slice(0, 10);

export function blowerStopMaintenanceKind(text) {
  if (/(?:예정|계획|요청|검토|준비|보류|취소|불가|미\s*(?:실시|완료|교체|확인)|하지\s*않|교체\s*중|(?:교체|실시|완료)\s*여부|[?？])/i.test(text)) return '';
  if (/(?:\boil\b|오일)\s*주입구\s*(?:측\s*)?(?:연결\s*)?(?:파이프|배관|피팅)\s*(?:을|를)?\s*(?:교체|교환)\s*(?:완료|종료|실시|함|하였|했|후\s*(?:tightening|조임|체결))/i.test(text)) return 'oil_fill_pipe';
  if (/(?:\boil\b|오일|윤활유)\s*(?:을|를)?\s*(?:교체|교환)\s*(?:작업\s*)?(?:완료|종료|실시|함|하였|했)/i.test(text)) return 'oil_change';
  return '';
}

function verifiedStopScope(asset) {
  if (!STOP_MAINTENANCE_ASSET.test(asset.tagNumber) || !['1', '2'].includes(asset.unitNo) ||
      asset.runRuntime?.verified !== true || asset.runRuntime.source !== 'dataparc' || asset.runRuntime.state !== 'stopped') return null;
  const basis = asset.dataParcRuntimeBasis;
  const stoppedAt = Date.parse(basis?.trailingStateStartedAt), observedAt = Date.parse(basis?.observedAt);
  const replacementAt = Date.parse(asset.lastReplacementAt);
  if (!(replacementAt <= stoppedAt && stoppedAt < observedAt) ||
      Date.parse(asset.runRuntime.measuredAt) !== observedAt) return null;
  const earliest = stoppedAt - WORK_WINDOW;
  const latest = Math.min(stoppedAt + WORK_WINDOW, observedAt);
  // Early-morning NS entries are filed under the previous KST work date.
  const dates = new Set([kstDate(earliest), kstDate(latest)]);
  if (new Date(earliest + 9 * HOUR).getUTCHours() < 7) dates.add(kstDate(earliest - DAY));
  return { asset, replacementAt, earliest, latest, observedAt, dates, roles: [`BCO${asset.unitNo}`, `BO${asset.unitNo}`] };
}

export async function loadBlowerStopMaintenance(database, assets, readDiaryFacts) {
  const scopes = assets.map(verifiedStopScope).filter(Boolean);
  if (!scopes.length) return new Map();
  const dates = [...new Set(scopes.flatMap(scope => [...scope.dates]))];
  const roles = [...new Set(scopes.flatMap(scope => scope.roles))];
  // Optional decoration: use only canonical approved operational logs from the
  // small, signal-derived date/role set. Never create a table or a receipt.
  try {
    const result = await database.prepare(`SELECT id,work_date,shift,role,status,log_json
      FROM shift_logs WHERE work_date IN (SELECT value FROM json_each(?))
        AND role IN (SELECT value FROM json_each(?)) AND status='결재완료' LIMIT ?`)
      .bind(JSON.stringify(dates), JSON.stringify(roles), MAX_DIARY_ROWS + 1).all();
    if (result?.success === false || !Array.isArray(result?.results) || result.results.length > MAX_DIARY_ROWS) return new Map();
    const facts = result.results.map(row => ({ row, ...readDiaryFacts(row) }));
    const notes = new Map();
    for (const scope of scopes) {
      const entries = facts.filter(({ row }) => scope.dates.has(row.work_date) && scope.roles.includes(row.role));
      const inWindow = value => {
        const time = Date.parse(value);
        return time >= scope.replacementAt && time >= scope.earliest && time <= scope.latest;
      };
      const candidates = new Map();
      for (const { row, maintenance, belts } of entries) {
        if (belts.some(fact => {
          const time = Date.parse(fact.eventDate);
          return fact.tagNumber === scope.asset.tagNumber && (fact.timePrecision === 'day' ||
            (time >= scope.replacementAt && time >= scope.earliest && time <= scope.observedAt));
        })) {
          candidates.clear();
          break;
        }
        for (const fact of maintenance) {
          if (fact.tagNumber !== scope.asset.tagNumber || !inWindow(fact.eventAt)) continue;
          const { kind, eventAt } = fact;
          candidates.set(`${kind}:${eventAt}`, { kind, eventAt, workDate: row.work_date });
        }
      }
      if (candidates.size === 1) notes.set(scope.asset.tagNumber, candidates.values().next().value);
    }
    return notes;
  } catch {
    return new Map();
  }
}
