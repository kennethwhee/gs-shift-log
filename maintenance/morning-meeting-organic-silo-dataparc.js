/* Organic Silo DataPARC V1. Only inventory is overlaid; daily DATA and receipt state stay independent. */
(function installOrganicSiloDataParc() {
  "use strict";
  if (window.organicSiloDataParc) return;

  const TYPE = "organic_silo_dataparc";
  const API = "/api/ois-data-requests";
  const CARD = "efficiencyMorningMeetingAutoDailySludgeCard";
  const PANEL = "efficiencyMorningMeetingWaterPanel";
  const FIELDS = ["organicDaySilo", "organicStorageSiloA", "organicStorageSiloB", "organicSiloTotal"];
  const TAGS = [
    "GSPOGE.ABB_DCS.104SDF01CW001XQ01/PLOT",
    "GSPOGE.ABB_DCS.003SDF01CW001XQ01/PLOT",
    "GSPOGE.ABB_DCS.003SDF02CW001XQ01/PLOT"
  ];
  const IDS = [
    "efficiencyMorningMeetingAutoDailyOrganicDaySilo",
    "efficiencyMorningMeetingAutoDailyOrganicStorageSiloA",
    "efficiencyMorningMeetingAutoDailyOrganicStorageSiloB",
    "efficiencyMorningMeetingAutoDailyOrganicSiloTotal"
  ];
  const cache = new Map();
  const states = new Map();
  let sequence = 0;
  let activeDate = "";
  let renderTimer = null;
  const byId = id => document.getElementById(id);
  const text = value => String(value ?? "").trim();
  const numeric = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const sameNumber = (a, b) => numeric(a) && numeric(b) && Math.abs(a - b) <= 1e-8;
  const setText = (element, value) => { if (element && element.textContent !== value) element.textContent = value; };

  function isDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function targetDate() {
    const state = window.efficiencyMorningMeetingUploadState || {};
    const panel = byId(PANEL);
    return [panel?.dataset.morningMeetingAutoBaseDate, state.shiftPart?.reportDate,
      state.shiftPart?.loadedDate, state.waterTreatment?.sourceDate,
      state.waterTreatment?.targetDate, panel?.dataset.waterTargetDate]
      .map(text).find(isDate) || "";
  }

  function qualityGood(value) {
    const tokens = text(value).toLowerCase().split(",").map(text);
    return (tokens.length === 1 && tokens[0] === "good") ||
      (tokens.length === 2 && tokens.includes("raw") && tokens.includes("good"));
  }

  function validateResult(item, date) {
    const result = item?.result;
    if (!isDate(date) || text(item?.targetDate) !== date ||
        text(item?.requestType || item?.sourceRequestType) !== TYPE || text(item?.status) !== "complete" ||
        !result || result.schemaVersion !== 1 || result.source !== "dataparc_hidden_excel" ||
        result.targetDate !== date || result.aggregation !== "End" || result.step !== "1D" ||
        result.qualityValidationVersion !== "1.2" || result.allQualitiesGood !== true ||
        result.cleanupVerified !== true || !FIELDS.every(key => numeric(result[key])) ||
        !sameNumber(result.organicSiloTotal, FIELDS.slice(0, 3).reduce((sum, key) => sum + result[key], 0)) ||
        !Array.isArray(result.samples) || result.samples.length !== 3) return null;
    const nextDay = new Date(`${date}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    if (result.intervalStartKst !== `${date}T00:00:00+09:00` ||
        result.intervalEndKst !== `${nextDay.toISOString().slice(0, 10)}T00:00:00+09:00`) return null;
    for (let i = 0; i < 3; i += 1) {
      const matches = result.samples.filter(sample => sample?.key === FIELDS[i]);
      if (matches.length !== 1) return null;
      const sample = matches[0];
      if (sample.date !== date || sample.tag !== TAGS[i] || !qualityGood(sample.qualityText) ||
          !sameNumber(sample.value, result[FIELDS[i]]) || !text(sample.returnedTimeText) ||
          /^(#|error|waiting|pending)/i.test(text(sample.returnedTimeText))) return null;
    }
    return { ...result, requestId: text(item.id), collectedAt: text(item.completedAt || result.collectedAt) };
  }

  function inventoryFields(result) {
    const values = Object.fromEntries(FIELDS.map(key => [key, result[key]]));
    values.organicDaySiloLevel = values.organicDaySilo;
    values.organicStorageSiloALevel = values.organicStorageSiloA;
    values.organicStorageSiloBLevel = values.organicStorageSiloB;
    return values;
  }

  function sourceStamp(item) {
    const parsed = Date.parse(item?.completedAt || item?.result?.collectedAt || "");
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function restoreCompleted(items, date) {
    if (!isDate(date) || !Array.isArray(items)) return false;
    let restored = false;
    for (const item of [...items].sort((a, b) => sourceStamp(b) - sourceStamp(a))) {
      const valid = validateResult(item, date);
      if (!valid) continue;
      // A history GET begun before a requery must not replace the newer completed result.
      const previous = cache.get(date);
      if (!previous || (Date.parse(valid.collectedAt) || 0) >= (Date.parse(previous.collectedAt) || 0)) {
        cache.set(date, valid);
      }
      if (!states.get(date)?.busy) states.set(date, { status: "complete" });
      restored = true;
      break;
    }
    if (date === targetDate()) render();
    return restored;
  }

  function valuesForWorkbook(dailyData) {
    const date = targetDate();
    const source = dailyData && typeof dailyData === "object" ? dailyData : {};
    const sourceDate = text(source.sourceDate || source.targetDate);
    // Never copy inventory from a previous day's daily DATA object into a new export.
    const base = { ...source };
    if (sourceDate && sourceDate !== date) {
      [...FIELDS, "organicDaySiloLevel", "organicStorageSiloALevel", "organicStorageSiloBLevel"].forEach(key => { delete base[key]; });
    }
    const result = cache.get(date);
    return result ? { ...base, ...inventoryFields(result) } : base;
  }

  function mergeHistoryRows(rowsByDate, items, inRange) {
    const applied = new Set();
    for (const item of [...items].sort((a, b) => sourceStamp(b) - sourceStamp(a))) {
      const date = text(item?.targetDate);
      if (!inRange(date) || applied.has(date)) continue;
      const valid = validateResult(item, date);
      if (!valid) continue;
      const row = rowsByDate.get(date) || { date, dailyData: null };
      row.dailyData = { ...(row.dailyData || {}), ...inventoryFields(valid),
        organicSiloSource: "dataparc_hidden_excel", organicSiloCollectedAt: valid.collectedAt };
      rowsByDate.set(date, row);
      applied.add(date);
    }
  }

  function canQuery() {
    if (window.matchMedia?.("(max-width: 900px)").matches ||
        /Android|iPhone|iPad|iPod|Mobile/i.test(window.navigator?.userAgent || "") ||
        (window.navigator?.platform === "MacIntel" && Number(window.navigator?.maxTouchPoints) > 0)) return false;
    if (typeof getShiftLogSessionToken !== "function" || !text(getShiftLogSessionToken())) return false;
    return true;
  }

  function queryDateAllowed(date) {
    const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return isDate(date) && date >= "2021-01-01" && date < todayKst;
  }

  function ensureControls() {
    const card = byId(CARD);
    const row = byId(IDS[0])?.parentElement;
    if (!card || !row) return null;
    let controls = byId("organicSiloDataParcControls");
    if (!controls) {
      controls = document.createElement("div");
      controls.id = "organicSiloDataParcControls";
      controls.className = "organic-silo-dataparc-controls";
      const label = document.createElement("span");
      label.className = "organic-silo-dataparc-label";
      label.id = "organicSiloDataParcSourceLabel";
      label.textContent = "DataPARC · Silo 재고";
      const badge = document.createElement("span");
      badge.id = "organicSiloDataParcStatus";
      badge.className = "efficiency-morning-meeting-auto-card__badge";
      badge.setAttribute("role", "status");
      badge.setAttribute("aria-live", "polite");
      const button = document.createElement("button");
      button.id = "organicSiloDataParcQueryButton";
      button.type = "button";
      button.className = "organic-silo-dataparc-query";
      button.textContent = "조회하기";
      button.addEventListener("click", () => { void load({ userInitiated: true }); });
      controls.append(label, badge, button);
      row.parentElement.insertBefore(controls, row);
    }
    return controls;
  }

  function render(options = {}) {
    const controls = ensureControls();
    if (!controls) return;
    const date = targetDate();
    const result = cache.get(date);
    const state = states.get(date) || {};
    const badge = byId("organicSiloDataParcStatus");
    const button = byId("organicSiloDataParcQueryButton");
    const status = state.busy ? "loading" : state.status === "error" ? "error" : result ? "complete" : "idle";
    const label = status === "loading" ? "조회 중" : status === "error" ? "조회 실패" : result ? "조회 완료" : "조회 대기";
    badge.dataset.queryTargetDate = date;
    setText(badge, label);
    const daily = window.efficiencyMorningMeetingUploadState?.steamStatus;
    const fileValues = daily && text(daily.sourceDate || daily.targetDate) === date &&
      [...FIELDS, "organicDaySiloLevel", "organicStorageSiloALevel", "organicStorageSiloBLevel"].some(key => numeric(daily[key]));
    controls.dataset.valueSource = result ? "dataparc" : fileValues ? "daily_data_excel" : "";
    setText(byId("organicSiloDataParcSourceLabel"), !result && fileValues
      ? "일일 DATA 엑셀 · Silo 재고" : "DataPARC · Silo 재고");
    if (!result && fileValues && status === "idle") setText(badge, "파일 값");
    badge.classList.toggle("is-loading", status === "loading");
    badge.classList.toggle("is-error", status === "error");
    badge.classList.toggle("is-complete", status === "complete");
    badge.title = state.error || (result ? `${date} · 1일 종료값 · DataPARC` : "선택일의 Silo 재고를 조회합니다.");
    controls.title = state.error || `${date || "기준일 선택"} · Silo 3개 및 총 재고량`;
    button.hidden = !canQuery();
    button.disabled = Boolean(state.busy) || !queryDateAllowed(date) || !canQuery();
    button.title = !queryDateAllowed(date) ? "조회가 완료된 날짜(어제까지)를 선택해 주세요." :
      result ? "선택일의 Silo 재고를 다시 조회합니다." : "선택일의 Silo 재고를 조회합니다.";
    setText(button, state.busy ? "조회 중…" : "조회하기");
    button.setAttribute("aria-label", "DataPARC에서 Silo 재고 조회하기");
    // The existing badge belongs to receipts/daily DATA, never to the new Silo request.
    const receiptStatus = byId("efficiencyMorningMeetingAutoDailySludgeStatus");
    if (receiptStatus && !text(receiptStatus.textContent).startsWith("입고 ")) {
      setText(receiptStatus, `입고 ${text(receiptStatus.textContent)}`);
    }
    if (result) IDS.forEach((id, index) => {
      const element = byId(id);
      setText(element, `${result[FIELDS[index]].toLocaleString("ko-KR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} ton`);
      if (element) {
        element.title = `${date} · DataPARC · ${result[FIELDS[index]]} ton`;
        element.dataset.organicDataParcDate = date;
      }
    });
    else IDS.forEach(id => {
      const element = byId(id);
      if (element?.dataset.organicDataParcDate) {
        // A standalone completion callback after date navigation must not leave old numbers visible.
        if (!options.baseRendered && element.dataset.organicDataParcDate !== date) setText(element, "-");
        element.title = "";
        delete element.dataset.organicDataParcDate;
      }
    });
    window.morningMeetingQuerySources?.render();
  }

  async function readResponse(response) {
    const payload = await response.json();
    if (!response.ok || payload?.ok === false) throw new Error(text(payload?.message || payload?.error) || "Silo 조회 요청에 실패했습니다.");
    return payload;
  }

  async function load(options = {}) {
    if (options.userInitiated !== true || !canQuery()) return null;
    const date = targetDate();
    if (!queryDateAllowed(date) || states.get(date)?.busy) return null;
    const token = ++sequence;
    activeDate = date;
    states.set(date, { busy: true, status: "loading", token });
    render();
    const cancelled = () => sequence !== token || targetDate() !== date || !canQuery();
    try {
      const response = await fetch(API, {
        method: "POST", cache: "no-store",
        headers: getShiftLogAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ requestType: TYPE, targetDate: date,
          forceRefresh: options.forceRefresh === true || cache.has(date) })
      });
      const payload = await readResponse(response);
      if (cancelled()) return null;
      let item = payload.item;
      if (!item?.id || item.requestType !== TYPE || item.targetDate !== date) {
        throw new Error("Silo 조회 요청의 종류 또는 기준일이 일치하지 않습니다.");
      }
      if (item.status !== "complete") {
        if (typeof window.waitForSharedOisRequestCompletion !== "function") throw new Error("Silo 조회 대기 기능을 사용할 수 없습니다.");
        item = await window.waitForSharedOisRequestCompletion(item.id, {
          maximumWaitMs: 10 * 60 * 1000, isCancelled: cancelled,
          notFoundMessage: "Silo 조회 요청을 찾을 수 없습니다.",
          timeoutMessage: "Silo 조회 대기시간이 초과되었습니다. 잠시 후 다시 조회해 주세요.",
          failureMessage: request => text(request?.errorMessage || request?.error_message) || "Silo 조회에 실패했습니다."
        });
      }
      if (cancelled() || !item) return null;
      const result = validateResult(item, date);
      if (!result) throw new Error("Silo 결과의 날짜·값·품질·종료 기록을 확인하지 못했습니다.");
      cache.set(date, result);
      states.set(date, { status: "complete" });
      document.dispatchEvent(new CustomEvent("efficiencyMorningMeetingOrganicSiloLoaded", { detail: { targetDate: date } }));
      return result;
    } catch (error) {
      if (!cancelled()) states.set(date, { status: "error", error: text(error?.message) || "Silo 조회에 실패했습니다." });
      return null;
    } finally {
      if (states.get(date)?.busy && states.get(date).token === token) states.set(date, { status: cache.has(date) ? "complete" : "idle" });
      if (activeDate === date && sequence === token) activeDate = "";
      render();
    }
  }

  function scheduleRender() {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => {
      renderTimer = null;
      if (activeDate && activeDate !== targetDate()) {
        sequence += 1;
        states.set(activeDate, { status: cache.has(activeDate) ? "complete" : "idle" });
        activeDate = "";
      }
      // Main renderer clears the old date first, then calls our inventory overlay hook.
      if (typeof window.renderEfficiencyMorningMeetingDailyData === "function") window.renderEfficiencyMorningMeetingDailyData();
      else render();
    }, 0);
  }

  function initialize() {
    const panel = byId(PANEL);
    if (!panel) return;
    new MutationObserver(mutations => {
      if (mutations.some(mutation => mutation.type === "attributes" ||
          [...mutation.addedNodes].some(node => node.id === CARD || node.querySelector?.(`#${CARD}`)))) scheduleRender();
    }).observe(panel, { attributes: true, attributeFilter: ["data-morning-meeting-auto-base-date"], childList: true, subtree: true });
    document.addEventListener("efficiencyMorningMeetingSteamStatusLoaded", scheduleRender);
    byId("resetEfficiencyMorningMeetingButton")?.addEventListener("click", () => {
      sequence += 1;
      activeDate = "";
      cache.clear();
      states.clear();
      scheduleRender();
    });
    window.addEventListener("resize", scheduleRender);
    scheduleRender();
  }

  window.organicSiloDataParc = Object.freeze({ validateResult, inventoryFields, mergeHistoryRows, restoreCompleted,
    valuesForWorkbook, render, load, targetDate });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
