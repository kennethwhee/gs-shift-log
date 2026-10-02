/* Morning Meeting card value override editor v1.
 * - Edits display/workbook values only.
 * - Never writes TO, OIS, co-firing closing, adjustment or unloading source records.
 * - Selected-date Data Delete invalidates older overrides through reset_at cutoff.
 */
(function installMorningMeetingCardOverridesV1(root) {
  "use strict";
  if (!root || !root.document || root.morningMeetingCardOverrides?.version === "20261003-v3") return;

  const doc = root.document;
  const API = "/api/morning-meeting-card-overrides";
  const PANEL_ID = "efficiencyMorningMeetingWaterPanel";
  const VERSION = "20261003-v3";
  const MAX_VALUE = 1e12;

  const CARDS = Object.freeze({
    power: Object.freeze({
      label: "전력 현황",
      cardId: "efficiencyMorningMeetingAutoDailyPowerCard",
      fields: Object.freeze([
        ["generatorEcmsGen1", "efficiencyMorningMeetingAutoDailyGeneratorEcmsGen1", "발전량", "kWh", 6, false],
        ["ismartReception", "efficiencyMorningMeetingAutoDailyIsmartReception", "수전량", "kWh", 6, false],
        ["epowerTransmission", "efficiencyMorningMeetingAutoDailyEpowerTransmission", "송전량", "kWh", 6, false],
        ["solarDailyGeneration", "efficiencyMorningMeetingAutoDailySolarGeneration", "태양광 발전량", "kWh", 6, false],
        ["solarMonthlyCumulative", "efficiencyMorningMeetingAutoSolarMonthlyCumulative", "태양광 월간 누적", "kWh", 6, false],
        ["solarYearlyCumulative", "efficiencyMorningMeetingAutoSolarYearlyCumulative", "태양광 년간 누적", "kWh", 6, false]
      ])
    }),
    steam: Object.freeze({
      label: "증기 생산·판매",
      cardId: "efficiencyMorningMeetingAutoSteamCard",
      fields: Object.freeze([
        ["steamSalesLowPressure", "efficiencyMorningMeetingAutoDailySteamSalesLowPressure", "저압", "ton", 3, false],
        ["steamSalesHighPressure", "efficiencyMorningMeetingAutoDailySteamSalesHighPressure", "고압", "ton", 3, false],
        ["steamSales", "efficiencyMorningMeetingAutoSteamSales", "총 증기 판매량", "ton", 3, false],
        ["unitOneProduction", "efficiencyMorningMeetingAutoSteamProductionUnitOne", "증기 생산량 1호기", "ton", 3, false],
        ["unitTwoProduction", "efficiencyMorningMeetingAutoSteamProductionUnitTwo", "증기 생산량 2호기", "ton", 3, false],
        ["totalProduction", "efficiencyMorningMeetingAutoSteamProductionTotal", "총 증기 생산량", "ton", 3, false]
      ])
    }),
    organic: Object.freeze({
      label: "유기성 고형연료",
      cardId: "efficiencyMorningMeetingAutoDailySludgeCard",
      fields: Object.freeze([
        ["sludgeTotal", "efficiencyMorningMeetingAutoDailySludgeTotal", "총 입고량", "t", 2, false],
        ["sludgeTruckCount", "efficiencyMorningMeetingAutoDailySludgeTruckCount", "입고 건수", "건", 0, true],
        ["organicDaySilo", "efficiencyMorningMeetingAutoDailyOrganicDaySilo", "Day Silo", "t", 2, false],
        ["organicStorageSiloA", "efficiencyMorningMeetingAutoDailyOrganicStorageSiloA", "Storage A", "t", 2, false],
        ["organicStorageSiloB", "efficiencyMorningMeetingAutoDailyOrganicStorageSiloB", "Storage B", "t", 2, false],
        ["organicSiloTotal", "efficiencyMorningMeetingAutoDailyOrganicSiloTotal", "총 재고량", "t", 2, false]
      ])
    })
  });

  const cache = new Map();
  const pending = new Map();
  let editing = null;
  let scheduled = false;
  let observer = null;
  let workbookWrapped = false;

  const byId = id => doc.getElementById(id);
  const text = value => String(value ?? "").trim();
  const dateValid = value => /^20\d{2}-\d{2}-\d{2}$/.test(text(value)) &&
    Number.isFinite(Date.parse(text(value) + "T00:00:00Z"));

  function authHeaders(extra = {}) {
    if (typeof root.getShiftLogAuthHeaders === "function") return root.getShiftLogAuthHeaders(extra);
    if (typeof getShiftLogAuthHeaders === "function") return getShiftLogAuthHeaders(extra);
    return {Accept: "application/json", ...extra};
  }

  function targetDate() {
    const candidates = [
      root.morningMeetingClosedCofiring?.targetDate?.(),
      root.toNightPower?.targetDate?.(),
      byId(PANEL_ID)?.dataset?.morningMeetingAutoBaseDate,
      root.efficiencyMorningMeetingUploadState?.shiftPart?.reportDate,
      root.efficiencyMorningMeetingUploadState?.shiftPart?.loadedDate
    ];
    return candidates.map(text).find(dateValid) || "";
  }

  function deleted(date) {
    return Boolean(date && (
      root.isMorningMeetingSelectedDateResetActive?.(date) === true ||
      root.morningMeetingQuerySources?.resetState?.(date)?.active === true
    ));
  }

  function finite(value) {
    if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
    const normalized = text(value).replaceAll(",", "");
    if (!normalized || normalized === "-" || normalized === "—") return null;
    const match = normalized.match(/(?:\d+(?:\.\d+)?|\.\d+)/);
    if (!match) return null;
    const number = Number(match[0]);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function parseInput(value, integerOnly) {
    const raw = text(value).replaceAll(",", "");
    if (!raw) return null;
    if (!/^(?:\d+)(?:\.\d+)?$/.test(raw)) throw new Error("0 이상의 숫자를 입력해 주세요.");
    const number = Number(raw);
    if (!Number.isFinite(number) || number < 0 || number > MAX_VALUE) throw new Error("입력 가능한 숫자 범위를 확인해 주세요.");
    if (integerOnly && !Number.isSafeInteger(number)) throw new Error("입고 건수는 정수로 입력해 주세요.");
    return number;
  }

  function numberText(number, unit, digits) {
    const value = Number(number);
    if (!Number.isFinite(value)) return "-";
    return value.toLocaleString("ko-KR", {
      minimumFractionDigits: unit === "t" ? digits : 0,
      maximumFractionDigits: digits
    }) + (unit ? " " + unit : "");
  }

  function formatInput(number, digits) {
    if (!Number.isFinite(Number(number))) return "";
    return Number(number).toLocaleString("en-US", {
      useGrouping: false,
      maximumFractionDigits: Math.max(digits, 6)
    });
  }

  function emptyItem(cardKey) {
    return {cardKey, revision: 0, active: false, staleByDelete: false, values: {}};
  }

  function stateFor(date) {
    return cache.get(date) || null;
  }

  function itemFor(date, cardKey) {
    return stateFor(date)?.items?.[cardKey] || emptyItem(cardKey);
  }

  async function readResponse(response) {
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; }
    catch { throw new Error("카드 수정 서버 응답을 읽지 못했습니다."); }
    if (!response.ok || data.ok === false) {
      const error = new Error(data.message || "카드 수정값 처리에 실패했습니다.");
      error.status = response.status;
      error.code = data.code;
      throw error;
    }
    return data;
  }

  async function load(date, force = false) {
    if (!dateValid(date)) return null;
    if (!force && cache.has(date)) return cache.get(date);
    if (pending.has(date)) return pending.get(date);
    const promise = (async () => {
      const url = new URL(API, root.location.origin);
      url.searchParams.set("date", date);
      url.searchParams.set("_", String(Date.now()));
      const response = await root.fetch(url.toString(), {
        method: "GET",
        headers: authHeaders({Accept: "application/json"}),
        credentials: "same-origin",
        cache: "no-store"
      });
      const data = await readResponse(response);
      if (data.targetDate !== date || !data.items || typeof data.items !== "object") {
        throw new Error("카드 수정값의 기준일을 확인하지 못했습니다.");
      }
      cache.set(date, data);
      return data;
    })().finally(() => pending.delete(date));
    pending.set(date, promise);
    return promise;
  }

  async function saveOverride(date, cardKey, values, expectedRevision) {
    const response = await root.fetch(API, {
      method: "POST",
      headers: authHeaders({Accept: "application/json", "Content-Type": "application/json"}),
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({targetDate: date, cardKey, values, expectedRevision})
    });
    const data = await readResponse(response);
    const current = cache.get(date) || {ok: true, targetDate: date, items: {}};
    current.items = {...(current.items || {}), [cardKey]: data.item};
    cache.set(date, current);
    return data.item;
  }

  async function restoreOverride(date, cardKey, expectedRevision) {
    const response = await root.fetch(API, {
      method: "DELETE",
      headers: authHeaders({Accept: "application/json", "Content-Type": "application/json"}),
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({targetDate: date, cardKey, expectedRevision})
    });
    const data = await readResponse(response);
    const current = cache.get(date) || {ok: true, targetDate: date, items: {}};
    current.items = {...(current.items || {}), [cardKey]: data.item};
    cache.set(date, current);
    return data.item;
  }

  function rawProviderValues(cardKey, date) {
    try {
      if (cardKey === "power") {
        const provider = root.toNightPower;
        if (provider && typeof provider.valuesForWorkbook === "function") {
          return provider.valuesForWorkbook({}, {targetDate: date}) || {};
        }
      }
      if (cardKey === "steam") {
        return root.getEfficiencyMorningMeetingSteamOisValues?.() ||
          root.__morningMeetingSteamOisProbeLastResult || {};
      }
      if (cardKey === "organic") {
        const provider = root.morningMeetingClosedCofiring;
        if (provider && typeof provider.valuesForWorkbook === "function") {
          return provider.valuesForWorkbook({}, {targetDate: date}) || {};
        }
      }
    } catch (error) {
      console.warn("오전회의 원본 카드값 확인 실패:", cardKey, error);
    }
    return {};
  }

  function sourceValues(cardKey, date) {
    const config = CARDS[cardKey];
    const provided = rawProviderValues(cardKey, date);
    const result = {};
    for (const [key, id] of config.fields) {
      const value = finite(provided?.[key]);
      if (value !== null) result[key] = value;
      else {
        const display = byId(id);
        if (display?.dataset?.morningCardOverride !== "true") {
          const displayed = finite(display?.textContent);
          if (displayed !== null) result[key] = displayed;
        }
      }
    }
    return result;
  }

  function clearOverrideMarkers(cardKey) {
    for (const [, id] of CARDS[cardKey].fields) {
      const element = byId(id);
      if (element?.dataset?.morningCardOverride === "true") {
        delete element.dataset.rawValue;
        delete element.dataset.morningCardOverride;
      }
    }
  }

  function paintSource(cardKey, date) {
    clearOverrideMarkers(cardKey);
    try {
      if (cardKey === "power") root.toNightPower?.renderMeeting?.();
      else if (cardKey === "organic") root.morningMeetingClosedCofiring?.renderOrganic?.();
      else if (cardKey === "steam") {
        const raw = rawProviderValues("steam", date);
        for (const [key, id, , unit, digits] of CARDS.steam.fields) {
          const value = finite(raw?.[key]);
          if (value !== null) {
            const element = byId(id);
            const next = numberText(value, unit, digits);
            if (element && element.textContent !== next) element.textContent = next;
          }
        }
      }
    } catch (error) {
      console.warn("오전회의 원본 카드 재표시 실패:", cardKey, error);
    }
  }

  function controls(cardKey) {
    const card = byId(CARDS[cardKey].cardId);
    return card?.querySelector(`[data-morning-card-override-controls="${cardKey}"]`) || null;
  }

  function ensureInput(cardKey, field) {
    const [key, id, label, , , integerOnly] = field;
    const display = byId(id);
    if (!display || !display.parentElement) return null;
    let input = display.parentElement.querySelector(`input[data-morning-card-override-input="${cardKey}:${key}"]`);
    if (!input) {
      input = doc.createElement("input");
      input.type = "text";
      input.inputMode = integerOnly ? "numeric" : "decimal";
      input.className = "morning-card-override-input";
      input.dataset.morningCardOverrideInput = `${cardKey}:${key}`;
      input.setAttribute("aria-label", `${CARDS[cardKey].label} ${label} 수정값`);
      input.hidden = true;
      display.insertAdjacentElement("afterend", input);
    }
    return input;
  }

  function button(label, className, action) {
    const element = doc.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.className = "morning-card-override-button " + (className || "");
    element.dataset.morningCardOverrideAction = action;
    return element;
  }

  function ensureControls(cardKey) {
    const config = CARDS[cardKey];
    const card = byId(config.cardId);
    if (!card) return null;
    const header = card.querySelector(".efficiency-morning-meeting-auto-card__header");
    const meta = card.querySelector(".efficiency-morning-meeting-auto-card__meta") || header || card;
    let group = controls(cardKey);
    if (!group) {
      group = doc.createElement("span");
      group.className = "morning-card-override-controls";
      group.dataset.morningCardOverrideControls = cardKey;
      const badge = doc.createElement("span");
      badge.className = "morning-card-override-badge";
      badge.textContent = "수정됨";
      badge.dataset.morningCardOverrideBadge = "true";
      badge.hidden = true;
      const edit = button("수정", "", "edit");
      const restore = button("원본", "is-restore", "restore");
      const save = button("저장", "is-save", "save");
      const cancel = button("취소", "", "cancel");
      restore.hidden = true;
      save.hidden = true;
      cancel.hidden = true;
      group.append(badge, edit, restore, save, cancel);
      meta.appendChild(group);
    }
    /* GS_MORNING_CARD_OVERRIDE_V6_UNIFIED_HEADER
     * All three editable cards use the same two-row header layout.
     * Source/read/save behavior is unchanged; only the control container moves.
     */
    if (header && group.parentElement !== header) {
      header.appendChild(group);
    }
    card.classList.add("morning-card-override-unified-header");

    for (const field of config.fields) ensureInput(cardKey, field);
    return group;
  }

  function updateControls(cardKey, date) {
    const group = ensureControls(cardKey);
    if (!group) return;
    const item = itemFor(date, cardKey);
    const isEditing = editing?.cardKey === cardKey && editing?.date === date;
    const isDeleted = deleted(date);
    const badge = group.querySelector("[data-morning-card-override-badge]");
    const edit = group.querySelector('[data-morning-card-override-action="edit"]');
    const restore = group.querySelector('[data-morning-card-override-action="restore"]');
    const save = group.querySelector('[data-morning-card-override-action="save"]');
    const cancel = group.querySelector('[data-morning-card-override-action="cancel"]');
    if (badge) {
      badge.hidden = !item.active || isEditing || isDeleted;
      badge.title = item.active ? [item.updatedBy, item.updatedAt].filter(Boolean).join(" · ") : "";
    }
    if (edit) {
      edit.hidden = isEditing || isDeleted;
      edit.disabled = Boolean(isDeleted);
    }
    if (restore) {
      restore.hidden = isEditing || isDeleted || !item.active;
      restore.disabled = Boolean(isDeleted);
    }
    if (save) save.hidden = !isEditing;
    if (cancel) cancel.hidden = !isEditing;
  }

  function applyOverride(cardKey, date) {
    const config = CARDS[cardKey];
    const card = byId(config.cardId);
    if (!card || !dateValid(date)) return;
    const item = itemFor(date, cardKey);
    const isEditing = editing?.cardKey === cardKey && editing?.date === date;
    updateControls(cardKey, date);
    if (isEditing) return;
    clearOverrideMarkers(cardKey);
    if (deleted(date) || !item.active) return;
    for (const [key, id, , unit, digits] of config.fields) {
      if (!Object.hasOwn(item.values || {}, key)) continue;
      const value = finite(item.values[key]);
      const element = byId(id);
      if (value === null || !element) continue;
      const next = numberText(value, unit, digits);
      if (element.textContent !== next) element.textContent = next;
      element.dataset.rawValue = String(value);
      element.dataset.morningCardOverride = "true";
    }
  }

  function applyAll(date = targetDate()) {
    if (!dateValid(date)) return;
    for (const cardKey of Object.keys(CARDS)) applyOverride(cardKey, date);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    root.requestAnimationFrame(() => {
      scheduled = false;
      const date = targetDate();
      if (!dateValid(date)) return;
      for (const key of Object.keys(CARDS)) ensureControls(key);
      if (!cache.has(date) && !pending.has(date)) {
        void load(date).then(() => {
          for (const key of Object.keys(CARDS)) paintSource(key, date);
          applyAll(date);
        }).catch(error => console.warn("오전회의 카드 수정값 조회 실패:", error));
      } else {
        applyAll(date);
      }
      installWorkbookBridge();
    });
  }

  function beginEdit(cardKey) {
    const date = targetDate();
    if (!dateValid(date) || deleted(date)) return;
    if (editing && editing.cardKey !== cardKey) cancelEdit(editing.cardKey);
    const config = CARDS[cardKey];
    const source = sourceValues(cardKey, date);
    editing = {cardKey, date, source};
    byId(config.cardId)?.classList.add("morning-card-override-editing");
    for (const [key, id, , , digits] of config.fields) {
      const display = byId(id);
      const input = ensureInput(cardKey, config.fields.find(field => field[0] === key));
      if (!display || !input) continue;
      const current = finite(display.dataset?.rawValue ?? display.textContent);
      input.value = current === null ? "" : formatInput(current, digits);
      display.hidden = true;
      input.hidden = false;
    }
    updateControls(cardKey, date);
  }

  function cancelEdit(cardKey) {
    const config = CARDS[cardKey];
    for (const [key, id] of config.fields) {
      const display = byId(id);
      const input = doc.querySelector(`input[data-morning-card-override-input="${cardKey}:${key}"]`);
      if (input) input.hidden = true;
      if (display) display.hidden = false;
    }
    byId(config.cardId)?.classList.remove("morning-card-override-editing");
    const date = editing?.date || targetDate();
    editing = null;
    paintSource(cardKey, date);
    applyOverride(cardKey, date);
  }

  function approximatelyEqual(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-9);
  }

  async function commitEdit(cardKey) {
    const context = editing;
    if (!context || context.cardKey !== cardKey) return;
    const date = context.date;
    const config = CARDS[cardKey];
    const group = controls(cardKey);
    for (const control of group?.querySelectorAll("button") || []) control.disabled = true;
    try {
      const values = {};
      for (const [key, , , , , integerOnly] of config.fields) {
        const input = doc.querySelector(`input[data-morning-card-override-input="${cardKey}:${key}"]`);
        if (!input) continue;
        const value = parseInput(input.value, integerOnly);
        if (value === null) continue;
        const original = finite(context.source?.[key]);
        if (original !== null && approximatelyEqual(value, original)) continue;
        values[key] = value;
      }
      const current = itemFor(date, cardKey);
      if (!Object.keys(values).length) {
        await restoreOverride(date, cardKey, current.revision);
      } else {
        await saveOverride(date, cardKey, values, current.revision);
      }
      cancelEdit(cardKey);
      await load(date, true);
      paintSource(cardKey, date);
      applyOverride(cardKey, date);
      root.showToast?.(`${config.label} 오전회의 수정값을 저장했습니다.`);
      doc.dispatchEvent(new CustomEvent("morningMeetingCardOverrideChanged", {detail: {targetDate: date, cardKey}}));
    } catch (error) {
      console.error("오전회의 카드 수정 저장 실패:", error);
      root.alert?.(error?.message || "수정값을 저장하지 못했습니다.");
      if (error?.status === 409) {
        try { await load(date, true); } catch (_) {}
      }
    } finally {
      for (const control of group?.querySelectorAll("button") || []) control.disabled = false;
      updateControls(cardKey, date);
    }
  }

  async function restoreCard(cardKey) {
    const date = targetDate();
    if (!dateValid(date) || deleted(date)) return;
    const config = CARDS[cardKey];
    const current = itemFor(date, cardKey);
    if (!current.active) return;
    if (!root.confirm(`${date} ${config.label} 수정값을 지우고 원본 조회값으로 복원할까요?`)) return;
    const group = controls(cardKey);
    for (const control of group?.querySelectorAll("button") || []) control.disabled = true;
    try {
      await restoreOverride(date, cardKey, current.revision);
      await load(date, true);
      paintSource(cardKey, date);
      applyOverride(cardKey, date);
      root.showToast?.(`${config.label}을 원본 조회값으로 복원했습니다.`);
      doc.dispatchEvent(new CustomEvent("morningMeetingCardOverrideChanged", {detail: {targetDate: date, cardKey}}));
    } catch (error) {
      console.error("오전회의 카드 원본 복원 실패:", error);
      root.alert?.(error?.message || "원본값으로 복원하지 못했습니다.");
    } finally {
      for (const control of group?.querySelectorAll("button") || []) control.disabled = false;
      updateControls(cardKey, date);
    }
  }

  function overrideValues(values, date) {
    const result = values && typeof values === "object" ? {...values} : {};
    const state = cache.get(date);
    if (!state || state.resetActive === true || deleted(date)) return result;
    for (const cardKey of Object.keys(CARDS)) {
      const item = state.items?.[cardKey];
      if (!item?.active || !item.values || typeof item.values !== "object") continue;
      Object.assign(result, item.values);
      if (cardKey === "organic") {
        if (Object.hasOwn(item.values, "sludgeTruckCount")) result.organicTruckCount = item.values.sludgeTruckCount;
        if (Object.hasOwn(item.values, "sludgeTotal")) result.organicReceivedAmount = item.values.sludgeTotal;
        if (Object.hasOwn(item.values, "organicDaySilo")) result.organicDaySiloLevel = item.values.organicDaySilo;
        if (Object.hasOwn(item.values, "organicStorageSiloA")) result.organicStorageSiloALevel = item.values.organicStorageSiloA;
        if (Object.hasOwn(item.values, "organicStorageSiloB")) result.organicStorageSiloBLevel = item.values.organicStorageSiloB;
      }
    }
    return result;
  }

  function installWorkbookBridge() {
    if (workbookWrapped) return true;
    const current = root.morningMeetingWorkbookCurrentValues;
    if (!current || typeof current.collect !== "function") return false;
    if (current.__morningCardOverrideWrapped === true) {
      workbookWrapped = true;
      return true;
    }
    const originalCollect = current.collect.bind(current);
    const wrapped = {
      ...current,
      version: `${current.version || "current"}+card-overrides-v3`,
      async collect(options = {}) {
        const bundle = await originalCollect(options);
        const date = dateValid(bundle?.targetDate) ? bundle.targetDate : targetDate();
        if (dateValid(date)) {
          try { await load(date, true); }
          catch (error) { console.warn("최종 엑셀 카드 수정값 확인 실패:", error); }
        }
        const values = dateValid(date) ? overrideValues(bundle?.values || {}, date) : {...(bundle?.values || {})};
        const missing = typeof current.getMissing === "function" ? current.getMissing(values) : (bundle?.missing || []);
        return {
          ...bundle,
          values,
          missing,
          cardOverridesApplied: dateValid(date) && Object.values(cache.get(date)?.items || {}).some(item => item?.active === true)
        };
      },
      __morningCardOverrideWrapped: true
    };
    root.morningMeetingWorkbookCurrentValues = Object.freeze(wrapped);
    workbookWrapped = true;
    return true;
  }

  function handleClick(event) {
    const button = event.target?.closest?.("[data-morning-card-override-action]");
    if (!button) return;
    const group = button.closest("[data-morning-card-override-controls]");
    const cardKey = group?.dataset?.morningCardOverrideControls;
    if (!Object.hasOwn(CARDS, cardKey)) return;
    event.preventDefault();
    event.stopPropagation();
    const action = button.dataset.morningCardOverrideAction;
    if (action === "edit") beginEdit(cardKey);
    else if (action === "cancel") cancelEdit(cardKey);
    else if (action === "save") void commitEdit(cardKey);
    else if (action === "restore") void restoreCard(cardKey);
  }

  async function refreshVisible(force = false) {
    const date = targetDate();
    if (!dateValid(date)) return;
    try {
      await load(date, force);
      if (force) for (const key of Object.keys(CARDS)) paintSource(key, date);
      applyAll(date);
    } catch (error) {
      console.warn("오전회의 카드 수정값 동기화 실패:", error);
    }
  }

  function initialize() {
    doc.addEventListener("click", handleClick, true);
    for (const eventName of [
      "efficiencyMorningMeetingSteamStatusLoaded",
      "morningMeetingClosedCofiringChanged",
      "morningMeetingCardOverrideChanged"
    ]) {
      doc.addEventListener(eventName, schedule);
    }
    doc.addEventListener("morningMeetingResetStateChanged", () => void refreshVisible(true));
    doc.addEventListener("morningMeetingSelectedDateResetStateChanged", () => void refreshVisible(true));
    root.addEventListener("focus", () => void refreshVisible(true));
    doc.addEventListener("visibilitychange", () => {
      if (!doc.hidden) void refreshVisible(true);
    });
    const panel = byId(PANEL_ID);
    if (panel && typeof MutationObserver === "function") {
      new MutationObserver(() => {
        editing = null;
        schedule();
      }).observe(panel, {attributes: true, attributeFilter: ["data-morning-meeting-auto-base-date"]});
    }
    if (typeof MutationObserver === "function") {
      observer = new MutationObserver(mutations => {
        if (mutations.some(mutation => {
          const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
          return target && Object.values(CARDS).some(config => target.closest?.("#" + config.cardId));
        })) schedule();
      });
      observer.observe(doc.documentElement, {subtree: true, childList: true, characterData: true});
    }
    schedule();
    root.setTimeout(installWorkbookBridge, 0);
    root.setTimeout(installWorkbookBridge, 1000);
  }

  root.morningMeetingCardOverrides = Object.freeze({
    version: VERSION,
    targetDate,
    load,
    refresh: refreshVisible,
    item: (cardKey, date = targetDate()) => itemFor(date, cardKey),
    overrideValues,
    apply: applyAll
  });

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", initialize, {once: true});
  else initialize();
})(typeof window === "object" ? window : null);
