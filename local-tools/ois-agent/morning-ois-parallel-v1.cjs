"use strict";

// Only these four read-only morning sources may share a batch. Other OIS
// workflows and the existing Excel/DataPARC lane retain their original limits.
const TYPES = Object.freeze([
  "water_environment", "limestone_stock", "turbine_gear_pinion", "silo_level"
]);
const MAX_CONCURRENCY = 4;
// Keep this entry aligned with the existing Agent's fixed OIS_LOGIN_URL.
// The login/index page does not necessarily redirect valid reused cookies.
const AUTHENTICATED_MAIN_URL = "http://ois.gspoge.com/jsp/login/main";
const LOGIN_ENTRY_URL = "http://ois.gspoge.com/jsp/login/index";
const AUTHENTICATED_NAVIGATION_TIMEOUT = 30000;
const typeOf = item => String(item?.requestType || item?.request_type || "").trim();
const dateOf = item => String(item?.targetDate || item?.target_date || "").trim();

function isAuthenticatedMain(value) {
  try {
    const url = new URL(value), expected = new URL(AUTHENTICATED_MAIN_URL);
    return !url.username && !url.password && url.origin === expected.origin &&
      url.pathname === expected.pathname;
  } catch {return false;}
}
function workerAuthenticationError() {
  const error = new Error("OIS 병렬 조회 화면의 인증을 확인하지 못했습니다. 조회 결과를 확인한 뒤 다시 조회해 주세요.");
  error.code = "OIS_MORNING_WORKER_SESSION_EXPIRED";
  return error;
}
async function assertAuthenticatedWorker(page) {
  if (!isAuthenticatedMain(page.url())) throw workerAuthenticationError();
  // A main URL alone is not sufficient if an expired session renders a login
  // form in the page or one of its frames. These checks do not fill credentials.
  for (const frame of page.frames()) {
    for (const selector of ["#userid input","#pw input"]) {
      if (await frame.locator(selector).isVisible()) throw workerAuthenticationError();
    }
  }
  if (!isAuthenticatedMain(page.url())) throw workerAuthenticationError();
}
async function openAuthenticatedWorker(page, owner) {
  const ownerPage = owner.primaryPage || owner.page;
  if (!ownerPage || !isAuthenticatedMain(ownerPage.url())) throw workerAuthenticationError();
  // Only the fixed canonical entry is used. Never copy query strings, hashes,
  // credentials or session tokens from the owner's current URL.
  await page.goto(AUTHENTICATED_MAIN_URL, {
    waitUntil:"domcontentloaded",timeout:AUTHENTICATED_NAVIGATION_TIMEOUT
  });
  await assertAuthenticatedWorker(page);
  // The installed Water entry preparation and its existing retry reopen the
  // login index to reset the navigation shell. In a reuse-only worker, reenter
  // that shell through main instead. Only this owned page is adapted; every
  // other URL, option and returned response keeps the original Page behavior.
  const originalGoto = page.goto.bind(page);
  page.goto = async (url, options) => {
    const resetAuthenticatedEntry = url === LOGIN_ENTRY_URL;
    const response = await originalGoto(resetAuthenticatedEntry ? AUTHENTICATED_MAIN_URL : url, options);
    if (resetAuthenticatedEntry) await assertAuthenticatedWorker(page);
    return response;
  };
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

function createWorkerBatch({items, ensureOwner, ensureLoggedIn, config}) {
  // Check the exact same contract locally even when called outside queue parsing.
  claimedOisItems({items:{ois:items?.[0] || null,morningOis:items},
    morningOisParallelVersion:1,morningOisConcurrency:4});
  const requests = new Map(), seenIds = new Set();
  const targetDate = dateOf(items[0]);
  function add(more) {
    const combined = [...requests.values(),...more];
    if (!combined.length || combined.length > MAX_CONCURRENCY ||
        !/^\d{4}-\d{2}-\d{2}$/.test(targetDate) ||
        new Set(combined.map(typeOf)).size !== combined.length ||
        more.some(item => !item?.id || seenIds.has(String(item.id)) ||
          !TYPES.includes(typeOf(item)) || dateOf(item) !== targetDate)) {
      throw new Error("오전회의 병렬 작업의 기준일·종류·빈 슬롯을 확인해 주세요.");
    }
    for (const item of more) {requests.set(String(item.id),item);seenIds.add(String(item.id));}
  }
  add(items);
  const sessions = new Map(), opening = new Map();
  let ownerPromise;
  async function ownerState() {
    if (!ownerPromise) ownerPromise = Promise.resolve().then(ensureOwner).then(async owner => {
      if (!owner?.browser?.isConnected() || !owner.context) throw new Error("OIS 공통 로그인 세션을 준비하지 못했습니다.");
      // Never persist or log this snapshot. Workers cannot write the owner's file.
      return {owner,storageState:await owner.context.storageState()};
    });
    return ownerPromise;
  }
  async function close(id) {
    const session = sessions.get(id);
    sessions.delete(id);
    if (session) await session.context.close().catch(() => null);
  }
  async function ensure(id) {
    if (!requests.has(id)) throw new Error("이 배치에 속하지 않는 OIS 요청입니다.");
    if (opening.has(id)) return opening.get(id);
    const existing = sessions.get(id);
    if (existing && existing.browser.isConnected() && !existing.primaryPage.isClosed()) return existing;
    const pending = (async () => {
      await close(id);
      const {owner,storageState} = await ownerState();
      // A failed worker never closes/restarts the shared browser under siblings.
      if (!owner.browser.isConnected()) throw new Error("OIS 공통 브라우저가 종료되었습니다. 현재 배치 결과를 확인해 주세요.");
      const context = await owner.browser.newContext({storageState});
      try {
        const page = await context.newPage();
        await openAuthenticatedWorker(page,owner);
        await ensureLoggedIn(page,{...config,morningParallelReuseOnly:true});
        const session = {browser:owner.browser,context,page,primaryPage:page,
          morningParallelRequestId:id,ownsBrowser:false};
        sessions.set(id,session);
        return session;
      } catch (error) {
        await context.close().catch(() => null);
        throw error;
      }
    })();
    opening.set(id,pending);
    try {return await pending;} finally {opening.delete(id);}
  }
  async function finish(id) {requests.delete(id);await close(id);}
  return {ensure,close,finish,add};
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
