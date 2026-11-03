/* Shared, side-effect-free diary confirmation rules. Keywords only reveal the
 * control: they NEVER confirm a replacement or choose an asset/date. */
export function normalizeContent(value) {
  return typeof value === 'string' ? value.normalize('NFKC').replace(/\r\n?/g, '\n').trim() : '';
}

const BELT = /(?:\b(?:V\s*[-/]?\s*)?(?:BELT|BLET)\b|[V브이]\s*[-/]?\s*벨트|벨트|밸트)/i;
const CHANGE = /(?:교체(?!\s*(?:운전|연월일|주기|이력))|교환|교제|\bREPLAC(?:E(?:D|MENT)?|ING)\b|\bEXCHANG(?:E(?:D)?|ING)\b)/i;
const OTHER_PART = /(?:FILTER|필터|휠터|여과|COVER|커버|카바|OIL|오일|윤활|PULLEY|풀리|PULLY|BEARING|베어링|MOTOR|모터|전동기|TENSIONER|텐셔너|SILENCER|소음기|진동\s*패드|안전\s*커버)/i;
const NOT_DONE = /(?:미\s*(?:실시|교체|완료)|교체\s*(?:안\s*(?:함|했|하)|하지\s*않)|교체.{0,12}(?:취소|보류|불가)|(?:않았|못했|못\s*하였)|\bNOT\s+REPLACED\b)/i;
const ADJUST = /(?:장력|TENSION|텐션).{0,16}(?:조정|조절|조절|ADJUST)/i;
const BLOWER = /(?:BLOWER|BLWR|FBHE|SEAL\s*POT|블로워|브로워|송풍기|\b\d{3}(?:HHL|SDF|ETG|ETH|LMDF|HRJ)[A-Z0-9]+\b)/i;
const OTHER_MACHINE = /(?:\bAHU\b|COAL\s*FEEDER|BELT\s*CONVEYOR|벨트\s*컨베이어|급탄기|환기\s*팬)/i;

function eligibleChange(part, inheritedBelt) {
  if (!CHANGE.test(part) || NOT_DONE.test(part)) return false;
  // A requested change explicitly replaced by tension adjustment did not occur.
  if (ADJUST.test(part) && /(?:하였으나|했으나|하지만|대신|자재\s*부족)/i.test(part)) return false;
  const belts = [...part.matchAll(new RegExp(BELT.source, 'gi'))];
  for (const belt of belts) {
    const tail = part.slice(belt.index + belt[0].length);
    const change = CHANGE.exec(tail);
    if (change && change.index <= 100) {
      const between = tail.slice(0, change.index);
      // "V-Belt Tension 조정 및 Filter 교체" replaces the Filter.
      const jointlyChanged = /^\s*(?:및|와|과|,|&|\+)\s*(?:Suction\s*)?(?:Filter|필터|휠터|Pulley|풀리|Pully|Bearing|베어링)\s*$/i.test(between);
      if ((!OTHER_PART.test(between) || jointlyChanged) && !ADJUST.test(between)) return true;
    }
    const before = part.slice(0, belt.index);
    if (CHANGE.test(before) && !OTHER_PART.test(before) && !ADJUST.test(before)) return true;
  }
  if (belts.length) return false;
  // A belt heading can own an indented "신품 교체 완료" continuation,
  // but never a different component's change or a tension-only operation.
  return inheritedBelt && !OTHER_PART.test(part) && !ADJUST.test(part);
}

export function isReplacementCandidate(value) {
  const content = normalizeContent(value);
  if (!content || content.length > 100000 || !BELT.test(content)) return false;
  if (OTHER_MACHINE.test(content) && !BLOWER.test(content)) return false;
  const tasks = content.split(/\n(?=\s*\d+[.)]\s)/);
  for (const task of tasks) {
    if (OTHER_MACHINE.test(task) && !BLOWER.test(task)) continue;
    let beltContext = false;
    const candidates = [];
    for (const raw of task.split(/\n|[;；]|\s*(?:->|=>|→|➡|⇒)\s*/)) {
      const part = raw.replace(/교체\s*운전/g, '운전기 변경').trim();
      if (!part || /(?:이력\s*관리|교체\s*연월일)/.test(part)) continue;
      if (OTHER_MACHINE.test(part) && !BLOWER.test(part)) { beltContext = false; continue; }
      if (eligibleChange(part, beltContext)) candidates.push(part);
      if (BELT.test(part)) beltContext = !NOT_DONE.test(part);
      else if (OTHER_PART.test(part)) beltContext = false;
    }
    // Read the continuation before deciding: a request followed by
    // "자재 부족으로 Tension 조정" is an adjustment instead of replacement.
    const performed = candidates.some(part => /(?:교체|교제|교환)\s*(?:작업\s*)?(?:완료|실시|함)|\bREPLACED\b/i.test(part));
    const substituted = ADJUST.test(task) && /(?:하였으나|했으나|하지만|대신|자재\s*부족)/i.test(task);
    if (candidates.length && (performed || !(substituted || NOT_DONE.test(task)))) return true;
  }
  return false;
}

function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
}

export function normalizeAnnotation(raw, content) {
  const normalized = normalizeContent(content);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== 1 ||
      typeof raw.confirmed !== 'boolean' || typeof raw.content !== 'string' ||
      normalizeContent(raw.content) !== normalized || !normalized) return null;
  if (!raw.confirmed) return {version: 1, confirmed: false, content: normalized, targets: []};
  if (!isReplacementCandidate(normalized) || !Array.isArray(raw.targets) ||
      !raw.targets.length || raw.targets.length > 27) return null;
  const targets = [], seen = new Set();
  for (const target of raw.targets) {
    if (!target || typeof target !== 'object' || Array.isArray(target) || typeof target.tagNumber !== 'string') return null;
    const tagNumber = target.tagNumber.trim().toUpperCase();
    if (!/^[0-9]{3}[A-Z0-9]{5,20}$/.test(tagNumber) || seen.has(tagNumber) || !validDay(target.replacedOn) ||
        typeof target.completedTime !== 'string' || !/^(?:|(?:[01]\d|2[0-3]):[0-5]\d)$/.test(target.completedTime)) return null;
    seen.add(tagNumber);
    targets.push({tagNumber, replacedOn: target.replacedOn, completedTime: target.completedTime});
  }
  return {version: 1, confirmed: true, content: normalized, targets};
}
