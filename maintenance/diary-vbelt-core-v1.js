/* Shared, side-effect-free diary confirmation rules. Keywords only reveal the
 * control: they NEVER confirm a replacement or choose an asset/date. */
export function normalizeContent(value) {
  return typeof value === 'string' ? value.normalize('NFKC').replace(/\r\n?/g, '\n').trim() : '';
}

const BELT = /(?:\b(?:V\s*[-/]?\s*)?(?:BELTS?|BLETS?)\b|(?:V|브이)\s*[-/]?\s*(?:벨트|밸트)|벨트|밸트)/i;
const BELT_SHORT = /\bV\s*\/\s*B\b/i;
const CHANGE = /(?:교체(?!\s*(?:운전|연월일|주기|이력))|교환(?!\s*운전)|교제|대체(?!\s*(?:품|운전|로|적))|갈(?:았|아)|갈기(?=\s*(?:작업|요청|예정|완료|실시|진행|필요|함|[.,;)]|$))|바(?:꿨|꾸|꿔|꿈)|\bREPLAC(?:E(?:D|MENT|S)?|ING)\b|\bEXCHANG(?:E(?:D|S)?|ING)\b|\bCHANG(?:E(?:D|S)?|ING)\b(?![\s-]*OVER\b)|\bSWAP(?:PED|PING|S)?\b|\bRENEW(?:ED|ING|AL|S)?\b)/i;
const NEW_PART = /(?:신품|신규(?:품)?|새\s*(?:것|거|걸|품|제품|부품|벨트|밸트)|대체품|\bNEW\b)/i;
const NEWLY = /새로/i;
const INSTALL = /(?:(?:장착|설치|취부|부착|체결)(?!\s*용)|달(?:았|아|기)|\bINSTALL(?:ED|ING|ATION)?\b|\bFITT?(?:ED|ING)?\b|\bMOUNT(?:ED|ING)?\b)/i;
const REPAIR = /(?:정비|수리|보수|복구|\bREPAIR(?:ED|ING|S)?\b|\bRESTOR(?:E(?:D)?|ING|ATION)\b)/i;
const DAMAGE = /(?:파손|손상|절손|절단|단선|끊|끈어|마모|균열|크랙|늘어짐|불량|노후|탈락|이탈|\b(?:CRACK(?:ED|S)?|BROKEN|BREAKAGE|DAMAGED?|WORN|SLIP(?:PING)?)\b)/i;
const REMEDY = /(?:조치|처리|개선|작업)/i;
const STOCK_ONLY = /(?:재고|입고|발주|구매|견적|규격|확보|준비|납품|보관|자재\s*(?:신청|요청)|\b(?:STOCK|INVENTORY|PURCHASE|ORDER)\b)/i;
const STOCK_PURPOSE = /(?:(?:장착|설치|취부|부착|체결)\s*용|\bFOR\s+(?:INSTALLATION|REPLACEMENT)\b)/i;
const INSPECTION_ONLY = /(?:점검|확인|관찰|추이|측정|검토|\b(?:INSPECT(?:ION|ED)?|CHECK(?:ED)?)\b)/i;
const OTHER_PART = /(?:FILTER|필터|휠터|여과|COVER|커버|카바|OIL|오일|윤활|PULLEY|풀리|PULLY|BEARING|베어링|MOTOR|모터|전동기|TENSIONER|텐셔너|SILENCER|소음기|진동\s*패드|안전\s*커버)/i;
const NOT_DONE = /(?:미\s*(?:실시|교체|교환|완료|작업|조치|정비|수리|보수|복구|장착|설치)|(?:교체|교환|교제|대체|장착|설치|취부|정비|수리|보수|복구|조치|갈(?:았|아|기)|바(?:꿨|꾸|꿔|꿈)).{0,12}(?:안\s*(?:함|했|하)|못\s*(?:함|했|하)|하지\s*않|취소|보류|불가)|(?:안|못)\s*(?:교체|교환|교제|대체|장착|설치|취부|정비|수리|보수|복구|조치|갈(?:았|아)|바(?:꿨|꾸|꿔))|(?:않았|지\s*(?:않|못)|못했|못\s*하였)|\b(?:NOT|NEVER)\s+(?:(?:YET|BEEN)\s+)?(?:REPLAC(?:E|ED|EMENT)|CHANG(?:E|ED|ING)|EXCHANGED|SWAP(?:PED|PING)?|RENEWED|INSTALLED|FITTED|REPAIRED|RESTORED)\b|\bNO\s+(?:REPLACEMENT|CHANGE|EXCHANGE|SWAP|REPAIR|RENEWAL|INSTALLATION)\b|\b(?:REPLACEMENT|CHANGE|EXCHANGE|SWAP|RENEWAL|REPAIR|INSTALLATION)\s+(?:CANCELLED|CANCELED|DEFERRED|POSTPONED)\b)/i;
const ADJUST = /(?:장력|TENSION|텐션).{0,16}(?:조정|조절|조임|조이|조였|당김|세팅|셋팅|ADJUST)/i;
const PERFORMED = /(?:교체|교제|교환|대체|장착|설치|취부|체결|정비|수리|보수|복구|조치)\s*(?:작업\s*)?(?:완료|실시|함)|갈았|갈아\s*끼(?:웠|움)|갈아\s*줬|바꿨|바꿈|\b(?:REPLACED|EXCHANGED|CHANGED|SWAPPED|RENEWED|INSTALLED|FITTED|REPAIRED|RESTORED)\b/i;
const BLOWER = /(?:BLOWER|BLWR|FBHE|SEAL\s*POT|블로워|브로워|송풍기|\b\d{3}(?:HHL|SDF|ETG|ETH|LMDF|HRJ)[A-Z0-9]+\b)/i;
const OTHER_MACHINE = /(?:\bAHU\b|COAL\s*FEEDER|BELT\s*CONVEYOR|벨트\s*컨베이어|급탄기|환기\s*팬)/i;

function eligibleAction(part, inheritedBelt, action) {
  if (!action.test(part) || NOT_DONE.test(part)) return false;
  const belts = [...part.matchAll(new RegExp(BELT.source, 'gi'))];
  for (const belt of belts) {
    const tail = part.slice(belt.index + belt[0].length);
    const change = action.exec(tail);
    if (change && change.index <= 100) {
      const between = tail.slice(0, change.index);
      // "V-Belt Tension 조정 및 Filter 교체" replaces the Filter.
      const jointlyChanged = /^\s*(?:및|와|과|,|&|\+)\s*(?:Suction\s*)?(?:Filter|필터|휠터|Pulley|풀리|Pully|Bearing|베어링)(?:\s*(?:신품|신규(?:품)?|새(?:것|거|걸|품)|NEW)(?:으로|을|를)?)*\s*$/i.test(between);
      if ((!OTHER_PART.test(between) || jointlyChanged) && !ADJUST.test(between)) return true;
    }
    const before = part.slice(0, belt.index);
    // "새 벨트" spans the belt token instead of appearing before/after it.
    if (action === NEW_PART && /새\s*$/.test(before)) return true;
    if (action.test(before) && !OTHER_PART.test(before) && !ADJUST.test(before)) return true;
  }
  if (belts.length) return false;
  // A belt heading can own an indented "신품 교체 완료" continuation,
  // but never a different component's change or a tension-only operation.
  return inheritedBelt && !OTHER_PART.test(part) && !ADJUST.test(part);
}

function eligibleChange(part, inheritedBelt, inheritedNewPart = false) {
  if (NOT_DONE.test(part)) return false;
  if (STOCK_ONLY.test(part) && STOCK_PURPOSE.test(part) && !PERFORMED.test(part)) return false;
  // A requested change explicitly replaced by tension adjustment did not occur.
  if (ADJUST.test(part) && /(?:하였으나|했으나|하지만|대신|자재\s*부족)/i.test(part)) return false;
  if (eligibleAction(part, inheritedBelt, CHANGE)) return true;
  const newPart = eligibleAction(part, inheritedBelt, NEW_PART);
  const newly = eligibleAction(part, inheritedBelt, NEWLY);
  if ((newPart || newly || inheritedNewPart) && eligibleAction(part, inheritedBelt, INSTALL)) return true;
  if (ADJUST.test(part)) return false;
  // These are offers to confirm manually, including shorthand "벨트 신품".
  // Neither a keyword nor a damaged belt automatically records a replacement.
  const lastBelt = [...part.matchAll(new RegExp(BELT.source, 'gi'))].pop();
  const barePartOnly = !OTHER_PART.test(lastBelt ? part.slice(lastBelt.index + lastBelt[0].length) : part);
  if (newPart && barePartOnly && !STOCK_ONLY.test(part) && !INSPECTION_ONLY.test(part)) return true;
  return eligibleAction(part, inheritedBelt, REPAIR) ||
    (DAMAGE.test(part) && eligibleAction(part, inheritedBelt, REMEDY));
}

export function isReplacementCandidate(value) {
  const content = normalizeContent(value);
  if (!content || content.length > 100000 ||
      !(BELT.test(content) || (BLOWER.test(content) && BELT_SHORT.test(content)))) return false;
  if (OTHER_MACHINE.test(content) && !BLOWER.test(content)) return false;
  const tasks = content.split(/\n(?=\s*\d+[.)]\s)/);
  for (const task of tasks) {
    if (OTHER_MACHINE.test(task) && !BLOWER.test(task)) continue;
    let beltContext = false;
    let newPartContext = false;
    const candidates = [];
    for (const raw of task.split(/\n|[;；]|\s*(?:->|=>|→|➡|⇒)\s*/)) {
      let part = raw.replace(/(?:교체|교환|대체)\s*운전/gi, '운전기 변경')
        .replace(/\b(?:CHANGE|SWITCH)[\s-]*OVER\b/gi, '운전기 변경').trim();
      if (BLOWER.test(task)) part = part.replace(new RegExp(BELT_SHORT.source, 'gi'), 'V-Belt');
      if (!part || /(?:이력\s*관리|교체\s*연월일)/.test(part)) continue;
      if (OTHER_MACHINE.test(part) && !BLOWER.test(part)) { beltContext = false; newPartContext = false; continue; }
      if (eligibleChange(part, beltContext, newPartContext)) candidates.push(part);
      if (BELT.test(part)) {
        beltContext = !NOT_DONE.test(part);
        newPartContext = beltContext && (eligibleAction(part, false, NEW_PART) || eligibleAction(part, false, NEWLY));
      } else if (OTHER_PART.test(part) || NOT_DONE.test(part)) {
        beltContext = false;
        newPartContext = false;
      } else if (beltContext && (eligibleAction(part, true, NEW_PART) || eligibleAction(part, true, NEWLY))) newPartContext = true;
    }
    // Read the continuation before deciding: a request followed by
    // "자재 부족으로 Tension 조정" is an adjustment instead of replacement.
    const performed = candidates.some(part => PERFORMED.test(part));
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
