"use strict";

// Four bounded morning sources share the existing authenticated owner.
// Water and UI fallbacks use one UI lane; the three direct reads can overlap.
const TYPES = Object.freeze([
  "water_environment", "limestone_stock", "turbine_gear_pinion", "silo_level"
]);
const MAX_CONCURRENCY = 4;
const typeOf = item => String(item?.requestType || item?.request_type || "").trim();
const dateOf = item => String(item?.targetDate || item?.target_date || "").trim();

function coordinatorError(code) {
  const messages = {
    OIS_MORNING_REQUEST_FINISHED:"이미 완료된 OIS 요청을 새로 시작하지 않았습니다.",
    OIS_MORNING_OWNER_UNAVAILABLE:"기존 OIS 로그인 화면을 사용할 수 없습니다. 현재 조회 결과를 확인해 주세요.",
    OIS_MORNING_COORDINATOR_CONTRACT:"오전회의 조회 순서와 요청 종류를 확인해 주세요."
  };
  const error = new Error(messages[code] || messages.OIS_MORNING_COORDINATOR_CONTRACT);
  error.code = code;
  return error;
}

function claimedOisItems(result) {
  const first = result?.items?.ois || null;
  const extra = result?.items?.morningOis;
  if (extra === undefined) return first ? [first] : []; // Older deployed server.
  if (result.morningOisParallelVersion !== 1 || result.morningOisConcurrency !== 4 ||
      !Array.isArray(extra) || extra.length > MAX_CONCURRENCY) {
    throw new Error("오전회의 OIS 병렬 응답의 버전 또는 최대 4건 제한을 확인하지 못했습니다.");
  }
  if ((first === null) !== (extra.length === 0) ||
      (first && String(first.id) !== String(extra[0]?.id))) {
    throw new Error("오전회의 OIS 병렬 응답과 기존 레인의 요청이 일치하지 않습니다.");
  }
  if (extra.length < 2) return extra;
  const ids = new Set(), types = new Set(), date = dateOf(extra[0]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("오전회의 OIS 병렬 조회일을 확인하지 못했습니다.");
  for (const item of extra) {
    const id = String(item?.id || "").trim(), type = typeOf(item);
    if (!id || ids.has(id) || !TYPES.includes(type) || types.has(type) || dateOf(item) !== date) {
      throw new Error("오전회의 OIS 병렬 요청의 중복·조회 유형·기준일을 확인해 주세요.");
    }
    ids.add(id); types.add(type);
  }
  return extra;
}

function createWorkerBatch({items, ensureOwner}) {
  claimedOisItems({items:{ois:items?.[0] || null,morningOis:items},
    morningOisParallelVersion:1,morningOisConcurrency:4});
  const requests = new Map(), states = new Map(), seenIds = new Set(), sessions = new Map();
  const targetDate = dateOf(items?.[0]);
  const waiters = new Set(), uiQueue = [];
  let ownerPromise, ownerRecord, uiOwner = null, activeReads = 0, fallbackReservations = 0;
  function changed() {
    for (const resolve of [...waiters]) resolve();
    waiters.clear();
  }
  function isLive(id) {return requests.has(id) && states.get(id)?.finished !== true;}
  function live(id) {
    if (!isLive(id)) throw coordinatorError("OIS_MORNING_REQUEST_FINISHED");
    return states.get(id);
  }
  async function until(id, predicate) {
    for (;;) {
      live(id);
      if (predicate()) return;
      await new Promise(resolve => waiters.add(resolve));
    }
  }
  function add(more) {
    const combined = [...requests.values(),...more];
    if (!combined.length || combined.length > MAX_CONCURRENCY ||
        !/^\d{4}-\d{2}-\d{2}$/.test(targetDate) ||
        new Set(combined.map(typeOf)).size !== combined.length ||
        more.some(item => !item?.id || seenIds.has(String(item.id)) ||
          !TYPES.includes(typeOf(item)) || dateOf(item) !== targetDate)) {
      throw new Error("오전회의 병렬 작업의 기준일·종류·빈 슬롯을 확인해 주세요.");
    }
    for (const item of more) {
      const id = String(item.id), type = typeOf(item);
      requests.set(id,item); seenIds.add(id);
      states.set(id,{id,type,finished:false,waterStarted:false,waterDone:false,waterReady:false,
        directStarted:false,directSettled:false,directActive:false,control:null});
    }
    changed();
  }
  add(items);
  function waterPending() {
    return [...states.values()].some(state => isLive(state.id) && state.type === "water_environment" && !state.waterDone);
  }
  function waterBlocksReads() {
    return [...states.values()].some(state => isLive(state.id) && state.type === "water_environment" &&
      !state.waterDone && !state.waterReady);
  }
  function canRead() {
    return !waterBlocksReads() && fallbackReservations === 0 && uiOwner?.kind !== "fallback" &&
      !(uiOwner?.kind === "water" && uiOwner.state.finished);
  }
  function nextUi() {
    const available = uiQueue.filter(token => isLive(token.id));
    // A late Water request cannot deadlock behind a fallback which is itself
    // waiting for that registered Water request to complete.
    if (waterPending()) return available.find(token => token.kind === "water") || null;
    return available[0] || null;
  }
  async function takeUi(id,kind) {
    live(id);
    const token = {id,kind,state:live(id)};
    let held = false, released = false;
    uiQueue.push(token);
    if (kind === "fallback") fallbackReservations++;
    changed();
    const release = () => {
      if (released) return;
      released = true;
      const index = uiQueue.indexOf(token);
      if (index >= 0) uiQueue.splice(index,1);
      if (held && uiOwner === token) uiOwner = null;
      if (kind === "fallback") fallbackReservations--;
      changed();
    };
    try {
      for (;;) {
        await until(id,() => uiOwner === null && nextUi() === token);
        live(id);
        if (uiOwner !== null || nextUi() !== token) continue;
        uiQueue.splice(uiQueue.indexOf(token),1);
        uiOwner = token; held = true; changed();
        break;
      }
      // Registering Water closes the read gate. Reserving a fallback does the
      // same. Only active HTTP attempts are drained, never UI fallback waits.
      await until(id,() => activeReads === 0);
      return release;
    } catch (error) {release();throw error;}
  }
  function checkedOwner() {
    const owner = ownerRecord;
    const page = owner?.primaryPage || owner?.page;
    if (!owner?.browser?.isConnected() || !owner.context || !page || page.isClosed()) {
      throw coordinatorError("OIS_MORNING_OWNER_UNAVAILABLE");
    }
    return {owner,page};
  }
  async function ownerSession() {
    if (!ownerPromise) ownerPromise = Promise.resolve().then(ensureOwner).then(owner => {
      ownerRecord = owner;
      return owner;
    });
    await ownerPromise;
    return checkedOwner();
  }
  async function ensure(id) {
    live(id);
    const {owner,page} = await ownerSession();
    live(id);
    if (!sessions.has(id)) {
      // The actual page.context() remains the authenticated BrowserContext.
      // This facade only bounds existing main-loop auxiliary-page cleanup;
      // closing one logical request never closes the shared page or context.
      sessions.set(id,{browser:owner.browser,page,primaryPage:page,
        context:{pages:()=>[page],close:async()=>{}},
        morningParallelRequestId:id,ownsBrowser:false,ownsContext:false});
    }
    return sessions.get(id);
  }
  async function close(id) {sessions.delete(id);}
  async function finish(id) {
    const state = states.get(id);
    if (state) {
      state.finished = true;
      state.waterDone = true;
      state.directSettled = true;
    }
    requests.delete(id); states.delete(id); sessions.delete(id);
    changed();
  }
  function marker(name,type) {console.log("[MORNING OWNER API V1] " + name + " " + type);}
  async function runWater(id,fn) {
    const state = live(id);
    if (state.type !== "water_environment" || state.waterStarted || typeof fn !== "function") {
      throw coordinatorError("OIS_MORNING_COORDINATOR_CONTRACT");
    }
    state.waterStarted = true;
    let release;
    try {
      await ensure(id);
      release = await takeUi(id,"water");
      live(id); checkedOwner();
      return await fn();
    } finally {
      state.waterReady = false;
      state.waterDone = true;
      if (release) release();
      changed();
    }
  }
  async function beforeWaterEntry(id) {
    const state = live(id);
    if (state.type !== "water_environment" || state.waterDone || uiOwner?.id !== id || uiOwner.kind !== "water") {
      throw coordinatorError("OIS_MORNING_COORDINATOR_CONTRACT");
    }
    state.waterReady = false;
    changed();
    await until(id,() => activeReads === 0);
    checkedOwner();
  }
  function waterReady(id) {
    const state = live(id);
    if (state.type !== "water_environment" || state.waterDone || uiOwner?.id !== id || uiOwner.kind !== "water") {
      throw coordinatorError("OIS_MORNING_COORDINATOR_CONTRACT");
    }
    checkedOwner();
    state.waterReady = true;
    marker("WATER_ENTRY_READY",state.type);
    changed();
  }
  async function runDirect(id,directFn,uiFallbackFn) {
    const state = live(id);
    if (state.type === "water_environment" || state.directStarted || typeof directFn !== "function") {
      throw coordinatorError("OIS_MORNING_COORDINATOR_CONTRACT");
    }
    state.directStarted = true;
    let attempted = false, directError;
    try {
      await ensure(id);
      for (;;) {
        await until(id,canRead);
        live(id);
        if (!canRead()) continue;
        checkedOwner();
        // No await may separate the last gate check and this increment.
        activeReads++; state.directActive = true; attempted = true;
        marker("DIRECT_START",state.type);
        break;
      }
      try {
        return await directFn();
      } finally {
        activeReads--; state.directActive = false; state.directSettled = true;
        marker("DIRECT_DONE",state.type);
        changed();
      }
    } catch (error) {
      if (!attempted) {state.directSettled = true;changed();throw error;}
      directError = error;
    }
    // Snapshot other registered first attempts. Their active counts have
    // already been released when they wait for the same UI fallback lane.
    const pending = [...states.values()].filter(other => other.id !== id &&
      other.type !== "water_environment" && !other.directSettled);
    await until(id,() => !waterPending() && pending.every(other => other.directSettled || other.finished));
    if (typeof uiFallbackFn !== "function") throw directError;
    const release = await takeUi(id,"fallback");
    try {
      await ensure(id); live(id);
      marker("UI_FALLBACK",state.type);
      return await uiFallbackFn(directError);
    } finally {release();}
  }
  function configFor(id,baseConfig={}) {
    const state = live(id);
    if (!state.control) state.control = Object.freeze({
      runWater: fn => runWater(id,fn),
      runDirect: (directFn,uiFallbackFn) => runDirect(id,directFn,uiFallbackFn),
      beforeWaterEntry: () => beforeWaterEntry(id),
      waterReady: () => waterReady(id)
    });
    return {...baseConfig,morningParallelReuseOnly:false,morningOwnerApiV1:state.control};
  }
  return {ensure,close,finish,add,configFor};
}

// While an eligible source is running, fill free slots with requests whose
// saved-value preflight finished later. The previous allSettled barrier must
// not make those sources wait for a slow Water calculation.
async function runWithFills({items,processItem,claimMore,onAdded,onFillError,
  shouldContinue=()=>true,intervalMs=1000}) {
  const running = new Map(), results = [];
  function start(item) {
    const id=String(item.id);
    if (running.has(id)) throw new Error("중복 OIS 실행 요청입니다.");
    const entry={item,promise:null};
    running.set(id,entry);
    entry.promise=Promise.resolve().then(()=>processItem(item)).then(
      value=>results.push({status:"fulfilled",value}),
      reason=>results.push({status:"rejected",reason})
    ).finally(()=>running.delete(id));
  }
  items.forEach(start);
  let nextFillAt=Date.now()+intervalMs;
  while (running.size) {
    let timer;
    try {
      await Promise.race([
        ...[...running.values()].map(entry=>entry.promise),
        new Promise(resolve=>{timer=setTimeout(resolve,Math.max(0,nextFillAt-Date.now()));})
      ]);
    } finally {clearTimeout(timer);}
    const eligible=[...running.values()].filter(entry=>TYPES.includes(typeOf(entry.item)));
    if (!eligible.length) {
      // Remaining Excel/other work has no eligible primary and cannot fill OIS.
      await Promise.all([...running.values()].map(entry=>entry.promise));
      break;
    }
    if (eligible.length < MAX_CONCURRENCY && shouldContinue() && Date.now() >= nextFillAt) {
      try {
        const more=await claimMore(eligible[0].item);
        if (more.length) {onAdded(more);more.forEach(start);}
        if (more.fillError) throw more.fillError; // Claimed work is already retained.
        nextFillAt=Date.now()+intervalMs;
      } catch (error) {
        onFillError?.(error);
        // Lease changes are harmless; transport failures keep the original
        // claim-error backoff and never cancel or repeat an active collection.
        nextFillAt=Date.now()+(error?.code==='MORNING_OIS_PRIMARY_NOT_LIVE'?intervalMs:60000);
      }
    } else if (Date.now() >= nextFillAt) nextFillAt=Date.now()+intervalMs;
  }
  return results;
}

module.exports = {TYPES,MAX_CONCURRENCY,claimedOisItems,createWorkerBatch,runWithFills};
