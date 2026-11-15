"use strict";

// Only these four bounded morning sources may share a batch. Other OIS
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
const OWNED_PAGE_OPEN_TIMEOUT = 5000;
const typeOf = item => String(item?.requestType || item?.request_type || "").trim();
const dateOf = item => String(item?.targetDate || item?.target_date || "").trim();

function isAuthenticatedMain(value) {
  try {
    const url = new URL(value), expected = new URL(AUTHENTICATED_MAIN_URL);
    return !url.username && !url.password && url.origin === expected.origin &&
      url.pathname === expected.pathname;
  } catch {return false;}
}
function routeClassification(value) {
  try {
    const url = new URL(value), main = new URL(AUTHENTICATED_MAIN_URL);
    if (url.username || url.password) return "UNTRUSTED_URL";
    if (url.href === "about:blank") return "BLANK";
    if (url.origin !== main.origin) return "OTHER_ORIGIN";
    if (url.pathname === main.pathname) return "OIS_MAIN";
    if (url.pathname === "/jsp/login/index") return "OIS_LOGIN";
    return "OIS_OTHER";
  } catch {return "UNAVAILABLE";}
}
function pageRoute(page) {
  try {return routeClassification(page?.url());} catch {return "UNAVAILABLE";}
}
function workerAuthenticationError(stage = "AUTHENTICATION", route = "UNAVAILABLE", reason = "NOT_CONFIRMED") {
  const error = new Error("OIS 병렬 조회 화면의 인증을 확인하지 못했습니다. 조회 결과를 확인한 뒤 다시 조회해 주세요.");
  error.code = "OIS_MORNING_WORKER_SESSION_EXPIRED";
  // Fixed classifications only: never include URLs, cookies or browser state.
  error.morningWorkerStage = stage;
  error.morningWorkerRoute = route;
  error.morningWorkerReason = reason;
  return error;
}
function requestFinishedError() {
  const error = new Error("이미 완료된 OIS 요청의 새 탭을 시작하지 않았습니다.");
  error.code = "OIS_MORNING_REQUEST_FINISHED";
  return error;
}
async function assertAuthenticatedWorker(page, stage) {
  if (!isAuthenticatedMain(page.url())) throw workerAuthenticationError(stage, pageRoute(page), "UNEXPECTED_ROUTE");
  // A main URL alone is not sufficient if an expired session renders a login
  // form in the page or one of its frames. These checks do not fill credentials.
  for (const frame of page.frames()) {
    for (const selector of ["#userid input","#pw input"]) {
      if (await frame.locator(selector).isVisible()) throw workerAuthenticationError(stage, pageRoute(page), "LOGIN_FORM_VISIBLE");
    }
  }
  if (!isAuthenticatedMain(page.url())) throw workerAuthenticationError(stage, pageRoute(page), "ROUTE_CHANGED");
}
async function openAuthenticatedWorker(page, owner) {
  const ownerPage = owner.primaryPage || owner.page;
  if (!ownerPage || ownerPage.isClosed() || !isAuthenticatedMain(ownerPage.url())) {
    throw workerAuthenticationError("OWNER_ENTRY", pageRoute(ownerPage), "OWNER_NOT_READY");
  }
  // Only the fixed canonical entry is used. Never copy query strings, hashes,
  // credentials or session tokens from the owner's current URL.
  await page.goto(AUTHENTICATED_MAIN_URL, {
    waitUntil:"domcontentloaded",timeout:AUTHENTICATED_NAVIGATION_TIMEOUT
  });
  await assertAuthenticatedWorker(page, "WORKER_MAIN_ENTRY");
  // The installed Water entry preparation and its existing retry reopen the
  // login index to reset the navigation shell. In a reuse-only worker, reenter
  // that shell through main instead. Only this owned page is adapted; every
  // other URL, option and returned response keeps the original Page behavior.
  const originalGoto = page.goto.bind(page);
  page.goto = async (url, options) => {
    const resetAuthenticatedEntry = url === LOGIN_ENTRY_URL;
    const response = await originalGoto(resetAuthenticatedEntry ? AUTHENTICATED_MAIN_URL : url, options);
    if (resetAuthenticatedEntry) await assertAuthenticatedWorker(page, "WORKER_MAIN_RESET");
    return response;
  };
}

// The real BrowserContext remains unchanged. This narrow facade is used only
// by the existing Agent's auxiliary-page cleanup and this worker's teardown.
// Its pages can never include the authenticated owner or another worker.
function ownedPageScope() {
  const pages = new Set(), listeners = new Map(), closingPages = new Map();
  let closing = false;
  function detach(page) {
    const handlers = listeners.get(page);
    if (!handlers) return;
    page.off("popup", handlers.popup);
    page.off("close", handlers.close);
    listeners.delete(page);
  }
  function closePage(page) {
    if (closingPages.has(page)) return closingPages.get(page);
    const pending = Promise.resolve().then(async () => {
      if (!page.isClosed()) await page.close({runBeforeUnload:false});
    }).catch(() => null).finally(() => {
      closingPages.delete(page);
      if (page.isClosed()) detach(page);
    });
    closingPages.set(page, pending);
    return pending;
  }
  function adopt(page) {
    if (!page || pages.has(page)) return page;
    pages.add(page);
    const handlers = {popup: popup => adopt(popup), close: () => detach(page)};
    listeners.set(page, handlers);
    page.on("popup", handlers.popup);
    page.on("close", handlers.close);
    if (closing) void closePage(page);
    return page;
  }
  async function close() {
    closing = true;
    await Promise.all([...pages].map(closePage));
    // A popup observed while its parent is closing is adopted and closed too.
    while (closingPages.size) await Promise.all([...closingPages.values()]);
    for (const page of pages) if (page.isClosed()) detach(page);
  }
  return {adopt,close,isClosing:()=>closing,
    context:{pages:()=>[...pages],close}};
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
  const sessions = new Map(), opening = new Map(), scopes = new Map();
  let ownerPromise, creationFailure = null, creationQueue = Promise.resolve();
  async function ownerSession() {
    if (!ownerPromise) ownerPromise = Promise.resolve().then(ensureOwner).then(async owner => {
      if (!owner?.browser?.isConnected() || !owner.context) throw new Error("OIS 공통 로그인 세션을 준비하지 못했습니다.");
      return owner;
    });
    return ownerPromise;
  }
  function openOwnedPrimary(owner, id) {
    // Only native popup creation is serialized. Navigation and collection
    // happen after this queue releases, independently in all four pages.
    const attempt = creationQueue.then(async () => {
      if (!requests.has(id)) throw requestFinishedError();
      if (creationFailure) {
        throw workerAuthenticationError("TAB_OPEN_QUEUE", "UNAVAILABLE", "PREVIOUS_OPEN_UNCERTAIN");
      }
      const ownerPage = owner.primaryPage || owner.page;
      if (!ownerPage || ownerPage.isClosed() || !isAuthenticatedMain(ownerPage.url())) {
        throw workerAuthenticationError("OWNER_ENTRY", pageRoute(ownerPage), "OWNER_NOT_READY");
      }
      const scope = ownedPageScope();
      scopes.set(id, scope);
      const capture = popup => scope.adopt(popup);
      const releaseCapture = () => {
        ownerPage.off("popup", capture);
        ownerPage.off("close", releaseCapture);
      };
      ownerPage.on("popup", capture);
      let timer;
      try {
        // Register before window.open. Each operation has exactly one waiter;
        // the creation queue prevents sibling workers taking the same popup.
        const popup = ownerPage.waitForEvent("popup", {timeout:OWNED_PAGE_OPEN_TIMEOUT})
          .then(page => scope.adopt(page));
        const opened = Promise.resolve().then(() => ownerPage.evaluate(() =>
          Boolean(window.open("about:blank", "_blank"))
        )).then(value => {
          if (value !== true) throw workerAuthenticationError("TAB_OPEN", "UNAVAILABLE", "POPUP_NOT_OPENED");
          return value;
        });
        const combined = Promise.all([opened, popup]);
        // The independent deadline also bounds an evaluate acknowledgement
        // that stalls after its popup event has already arrived.
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => reject(workerAuthenticationError("TAB_OPEN", "UNAVAILABLE", "OPEN_TIMEOUT")), OWNED_PAGE_OPEN_TIMEOUT);
        });
        const [, page] = await Promise.race([combined, timeout]);
        releaseCapture();
        if (!requests.has(id) || scope.isClosing()) {
          await scope.close();
          throw requestFinishedError();
        }
        if (page.isClosed()) throw workerAuthenticationError("TAB_OPEN", "UNAVAILABLE", "PAGE_CLOSED");
        return {page,scope};
      } catch (error) {
        if (error?.code === "OIS_MORNING_REQUEST_FINISHED") {
          releaseCapture();
        } else {
          creationFailure = true;
          // An uncertain evaluate can still emit a late popup. Keep this
          // closed scope's capture until the owner closes after the batch;
          // any late child is immediately closed, never reused by a sibling.
          ownerPage.on("close", releaseCapture);
          if (ownerPage.isClosed()) releaseCapture();
        }
        await scope.close();
        if (scopes.get(id) === scope) scopes.delete(id);
        if (error?.code === "OIS_MORNING_REQUEST_FINISHED") throw error;
        throw workerAuthenticationError("TAB_OPEN", "UNAVAILABLE", "OPEN_UNCERTAIN");
      } finally {clearTimeout(timer);}
    });
    // Keep the queue usable after a rejected operation, while creationFailure
    // conservatively prevents another ambiguous window.open in this batch.
    creationQueue = attempt.then(() => undefined, () => undefined);
    return attempt;
  }
  async function close(id) {
    const session = sessions.get(id);
    sessions.delete(id);
    const scope = scopes.get(id);
    scopes.delete(id);
    if (session) await session.context.close().catch(() => null);
    else if (scope) await scope.close();
  }
  async function ensure(id) {
    if (!requests.has(id)) throw new Error("이 배치에 속하지 않는 OIS 요청입니다.");
    if (opening.has(id)) return opening.get(id);
    const existing = sessions.get(id);
    if (existing && existing.browser.isConnected() && !existing.primaryPage.isClosed()) return existing;
    const pending = (async () => {
      await close(id);
      const owner = await ownerSession();
      if (!requests.has(id)) throw requestFinishedError();
      // A failed worker never closes/restarts the shared browser under siblings.
      if (!owner.browser.isConnected()) throw new Error("OIS 공통 브라우저가 종료되었습니다. 현재 배치 결과를 확인해 주세요.");
      const {page,scope} = await openOwnedPrimary(owner,id);
      try {
        await openAuthenticatedWorker(page,owner);
        await ensureLoggedIn(page,{...config,morningParallelReuseOnly:true});
        if (!requests.has(id) || scope.isClosing()) throw requestFinishedError();
        const session = {browser:owner.browser,context:scope.context,page,primaryPage:page,
          morningParallelRequestId:id,ownsBrowser:false,ownsContext:false};
        sessions.set(id,session);
        return session;
      } catch (error) {
        await scope.close();
        if (scopes.get(id) === scope) scopes.delete(id);
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
