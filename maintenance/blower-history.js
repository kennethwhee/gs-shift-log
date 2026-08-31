"use strict";

/* [FBHE-VIBRATION-SHADOW-V1] */
/* [FBHE-OPERATIONS-CONTROL-V1] */
(() => {
  const API_URL = "/api/blower-history";
  const OIS_REQUEST_API_URL = "/api/ois-data-requests";
  const AUTH_STORAGE_KEY = "gsShiftLog.currentUser";
  const AVERAGE_PERIOD_STORAGE_KEY = "gsShiftLog.blowerHistory.averagePeriod";
  const MOBILE_MONITORING_QUERY = "(max-width: 700px), (max-width: 1024px) and (hover: none) and (pointer: coarse)";

  const state = {
    data: null,
    activeType: "fbhe",
    statusFilter: "all",
    historyAssetTag: "",
    subview: "overview",
    busy: false,
    backfillRunning: false,
    auditRunning: false,
    operationSyncCompleted: false,
    assetManagerAutoName: true,
    serverClockOffsetMs: 0,
    runtimeEditOriginalDate: "",
    vibrationReport: null,
    vibrationReportRangeKey: "",
    vibrationPolling: false,
    vibrationPollRequestIds: [],
    vibrationPreset: "cycle"
  };

  const elements = {};

  function byId(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    [
      "authNotice",
      "historicalBackfillNotice",
      "overviewBackfillCallout",
      "overviewBackfillTitle",
      "overviewBackfillSummary",
      "overviewBackfillButton",
      "typeTabs",
      "candidateCountBadge",
      "statusFilters",
      "visibleAssetCount",
      "settingsSummary",
      "settingsUpdated",
      "assetManagerButton",
      "settingsButton",
      "missingTagsNotice",
      "averagePanel",
      "averageHeadline",
      "averageSubline",
      "averagePeriodValue",
      "averagePeriodUnit",
      "averageMetrics",
      "averageAssets",
      "vibrationShadowPanel",
      "vibrationHeadline",
      "vibrationStartDate",
      "vibrationEndDate",
      "vibrationQueryButton",
      "vibrationRequeryButton",
      "vibrationStatus",
      "vibrationMetrics",
      "vibrationTableWrap",
      "vibrationBody",
      "vibrationEmpty",
      "activeTypeTitle",
      "assetGroups",
      "historyFilter",
      "historyBody",
      "historyEmpty",
      "scanDays",
      "scanButton",
      "historicalBackfillButton",
      "candidateList",
      "candidateEmpty",
      "auditHistoryButton",
      "refreshButton",
      "recordDialog",
      "recordForm",
      "recordMode",
      "recordTag",
      "candidateId",
      "recordEventId",
      "recordExpectedEventUpdatedAt",
      "runtimeEditResetToPending",
      "recordDialogEyebrow",
      "recordDialogTitle",
      "recordAssetLabel",
      "recordDateLabel",
      "recordDate",
      "issueTypeField",
      "issueType",
      "actionTypeField",
      "actionType",
      "replacementRunningField",
      "replacementRunning",
      "replacementStartupAtField",
      "replacementStartupAt",
      "runtimeHoursField",
      "runtimeHours",
      "runtimeStateField",
      "runtimeState",
      "runtimeStateLabel",
      "runtimeCycleSummary",
      "runtimeEditPendingField",
      "runtimeEditPendingButton",
      "recordNoteLabel",
      "recordNote",
      "candidateSourcePreview",
      "recordSaveButton",
      "settingsDialog",
      "settingsForm",
      "settingsDialogTitle",
      "cycleDays",
      "warningDays",
      "criticalDays",
      "clearSettingsButton",
      "assetManagerDialog",
      "assetManagerForm",
      "assetManagerDialogTitle",
      "assetManagerDialogIntro",
      "assetManagerTarget",
      "assetManagerUpdated",
      "assetManagerMode",
      "assetOriginalTag",
      "assetExpectedUpdatedAt",
      "assetBlowerType",
      "assetUnitNo",
      "assetGroup",
      "assetGroupField",
      "assetPositionLabel",
      "assetDisplayName",
      "assetTagNumber",
      "assetTagHelp",
      "assetSortOrder",
      "assetEnabled",
      "assetChangeNote",
      "assetManagerHelp",
      "assetManagerSaveButton",
      "historyDialog",
      "historyDialogTitle",
      "historyDialogAsset",
      "historyCycleSummary",
      "historyRuntimeStateButton",
      "historyRuntimeCorrectionButton",
      "assetHistoryList",
      "toast"
    ].forEach(id => {
      elements[id] = byId(id);
    });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function getCurrentUser() {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);

    if (!raw) return null;

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function getSessionToken() {
    const user = getCurrentUser();
    return String(user?.sessionToken || user?.session_token || "").trim();
  }

  function getAuthHeaders(extra = {}) {
    const token = getSessionToken();

    return {
      Accept: "application/json",
      "X-GS-Client-Mode": isMobileMonitoringView() ? "mobile-monitoring" : "desktop",
      ...extra,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  function hasAuthenticatedWriteAccess(data = state.data) {
    if (!data) return false;

    const explicitPermission = data?.permissions?.canWrite;
    return typeof explicitPermission === "boolean"
      ? explicitPermission
      : Boolean(data.user);
  }

  function isPublicMonitoringView() {
    return Boolean(state.data) && !hasAuthenticatedWriteAccess();
  }

  function isMobileMonitoringView() {
    return Boolean(window.matchMedia?.(MOBILE_MONITORING_QUERY).matches);
  }

  function stopMobileMutation(event) {
    if (isMobileMonitoringView()) {
      event?.preventDefault?.();
      showToast("모바일에서는 현황과 이력 조회만 가능합니다.");
      return true;
    }

    if (hasAuthenticatedWriteAccess()) return false;

    event?.preventDefault?.();
    showToast("공유 조회에서는 변경할 수 없습니다.");
    return true;
  }

  function applyPublicMonitoringMode() {
    const publicMonitoring = isPublicMonitoringView();
    document.body.classList.toggle("public-monitoring", publicMonitoring);

    if (!publicMonitoring) return;

    if (state.subview === "detect") switchSubview("overview");
    if (elements.recordDialog?.open) elements.recordDialog.close();
    if (elements.settingsDialog?.open) elements.settingsDialog.close();
    if (elements.assetManagerDialog?.open) elements.assetManagerDialog.close();

    elements.candidateCountBadge.hidden = true;
    elements.candidateList.replaceChildren();
    elements.candidateEmpty.hidden = true;
    elements.overviewBackfillCallout.hidden = true;
    elements.historicalBackfillNotice.hidden = true;
  }

  function applyMobileMonitoringMode() {
    const mobile = isMobileMonitoringView();
    document.body.classList.toggle("mobile-monitoring", mobile);

    if (!mobile) return;

    if (state.subview === "detect") switchSubview("overview");
    if (elements.recordDialog?.open) elements.recordDialog.close();
    if (elements.settingsDialog?.open) elements.settingsDialog.close();
    if (elements.assetManagerDialog?.open) elements.assetManagerDialog.close();
  }

  function parseRetryAfterMs(value) {
    const text = String(value || "").trim();
    if (!text) return 0;

    const seconds = Number(text);
    if (Number.isFinite(seconds)) {
      return Math.max(0, Math.round(seconds * 1000));
    }

    const retryAt = new Date(text);
    return Number.isNaN(retryAt.getTime())
      ? 0
      : Math.max(0, retryAt.getTime() - Date.now());
  }

  function waitForMilliseconds(milliseconds) {
    return new Promise(resolve => {
      window.setTimeout(resolve, Math.max(0, Number(milliseconds) || 0));
    });
  }

  async function apiRequest(options = {}) {
    const method = options.method || "GET";

    if (method !== "GET" && !hasAuthenticatedWriteAccess()) {
      throw new Error("공유 조회에서는 변경할 수 없습니다.");
    }

    const timeoutMs = Math.max(0, Number(options.timeoutMs) || 0);
    const controller = timeoutMs > 0 && typeof AbortController !== "undefined"
      ? new AbortController()
      : null;
    let timeoutId = null;
    let response;

    if (controller && timeoutMs > 0) {
      timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    }

    try {
      response = await fetch(options.url || API_URL, {
        method,
        headers: getAuthHeaders(
          options.body
            ? { "Content-Type": "application/json; charset=utf-8" }
            : {}
        ),
        cache: "no-store",
        body: options.body ? JSON.stringify(options.body) : undefined,
        ...(controller ? { signal: controller.signal } : {})
      });
    } catch (cause) {
      const timedOut = cause?.name === "AbortError" && timeoutMs > 0;
      const error = new Error(timedOut ? "서버 응답 시간이 초과되었습니다. 자동으로 다시 시도합니다." : "서버에 연결할 수 없습니다.");
      error.status = timedOut ? 504 : 0;
      error.code = timedOut ? "REQUEST_TIMEOUT" : "NETWORK_ERROR";
      error.retryable = true;
      error.cause = cause;
      throw error;
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    }

    const text = await response.text();
    let result = {};
    let invalidJson = false;

    if (text.trim()) {
      try {
        result = JSON.parse(text);
      } catch {
        invalidJson = true;
      }
    }

    if (!response.ok || result.ok === false) {
      const error = new Error(result.message || `요청 실패 (HTTP ${response.status})`);
      error.status = response.status;
      error.code = String(result.code || "HTTP_ERROR");
      error.retryable = result.retryable === true || [429, 502, 503, 504].includes(response.status);
      error.retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
      error.cfRay = String(response.headers.get("CF-Ray") || "");
      error.payload = result;
      throw error;
    }

    if (invalidJson) {
      throw new Error("서버 응답 형식을 확인할 수 없습니다.");
    }

    return result;
  }

  function buildAdaptiveRetryLimits(currentLimit, defaults) {
    const normalizedCurrent = Math.floor(Number(currentLimit) || 0);
    if (normalizedCurrent <= 0) return [...defaults];

    const limits = [normalizedCurrent];

    for (const value of defaults) {
      const normalizedValue = Math.floor(Number(value) || 0);
      if (normalizedValue > 0 && normalizedValue < normalizedCurrent) {
        limits.push(normalizedValue);
      }
    }

    const fallback = limits[limits.length - 1] || normalizedCurrent;
    while (limits.length < defaults.length) limits.push(fallback);
    return limits.slice(0, defaults.length);
  }

  async function requestHistoricalAuditStep(cursor, onRetry, tuning = {}) {
    const fallbackWaits = [1200, 2400, 4800, 8000];
    const adaptiveLimits = buildAdaptiveRetryLimits(
      tuning.analysisLimit,
      [null, 2, 1, 1, 1]
    );
    const adaptiveScanLimits = buildAdaptiveRetryLimits(
      tuning.scanLimit,
      [null, 25, 10, 5, 1]
    );

    for (let attempt = 0; attempt <= fallbackWaits.length; attempt += 1) {
      try {
        const result = await apiRequest({
          method: "POST",
          body: {
            action: "historical_audit_step",
            cursor,
            analysisLimit: adaptiveLimits[attempt],
            scanLimit: adaptiveScanLimits[attempt]
          }
        });
        tuning.analysisLimit = adaptiveLimits[attempt];
        tuning.scanLimit = adaptiveScanLimits[attempt];
        return result;
      } catch (error) {
        const retryable = error?.retryable === true ||
          [0, 429, 502, 503, 504].includes(Number(error?.status));

        if (!retryable || attempt >= fallbackWaits.length) {
          throw error;
        }

        const waitMs = Math.min(
          15000,
          Math.max(250, Number(error?.retryAfterMs) || fallbackWaits[attempt])
        );
        const retryInfo = {
          attempt: attempt + 1,
          maxAttempts: fallbackWaits.length,
          waitMs,
          nextAnalysisLimit: adaptiveLimits[attempt + 1],
          nextScanLimit: adaptiveScanLimits[attempt + 1],
          status: Number(error?.status) || 0,
          code: String(error?.code || ""),
          cfRay: String(error?.cfRay || ""),
          message: String(error?.message || ""),
          diagnostics: isPlainObject(error?.payload?.diagnostics)
            ? error.payload.diagnostics
            : null
        };

        if (typeof onRetry === "function") onRetry(retryInfo);
        await waitForMilliseconds(waitMs);
      }
    }

    throw new Error("누락 진단 재시도 횟수를 초과했습니다.");
  }

  function showToast(message, type = "info") {
    if (!elements.toast) return;

    elements.toast.textContent = String(message || "");
    elements.toast.classList.toggle("error", type === "error");
    elements.toast.hidden = false;

    clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      elements.toast.hidden = true;
    }, 3300);
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function mergeAuditSummary(current = {}, incoming = {}) {
    const output = isPlainObject(current) ? { ...current } : {};

    if (!isPlainObject(incoming)) return output;

    for (const [key, value] of Object.entries(incoming)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) continue;

      const previous = output[key];

      if (typeof value === "number" && Number.isFinite(value)) {
        output[key] = (typeof previous === "number" && Number.isFinite(previous) ? previous : 0) + value;
      } else if (Array.isArray(value)) {
        output[key] = [
          ...(Array.isArray(previous) ? previous : []),
          ...value
        ];
      } else if (isPlainObject(value)) {
        output[key] = mergeAuditSummary(isPlainObject(previous) ? previous : {}, value);
      } else if (value !== undefined) {
        output[key] = value;
      }
    }

    return output;
  }

  function downloadAuditJson(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8"
    });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  function currentServerDate() {
    return new Date(Date.now() + Number(state.serverClockOffsetMs || 0));
  }

  function formatKstDateInput(date = currentServerDate()) {
    const parts = new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);

    const values = Object.fromEntries(
      parts.filter(part => part.type !== "literal").map(part => [part.type, part.value])
    );

    return `${values.year}-${values.month}-${values.day}`;
  }

  function formatKstDateTimeInput(date = currentServerDate()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts.filter(part => part.type !== "literal").map(part => [part.type, part.value])
    );
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
  }

  function kstDateTimeInputToIso(value) {
    const text = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text)) return "";
    const parsed = new Date(`${text.length === 16 ? `${text}:00` : text}+09:00`);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  }

  function formatKstDateTimeDisplay(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "-";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(parsed);
    const values = Object.fromEntries(
      parts.filter(part => part.type !== "literal").map(part => [part.type, part.value])
    );
    return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
  }

  function formatKstDownloadTimestamp(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts.filter(part => part.type !== "literal").map(part => [part.type, part.value])
    );

    return `${values.year}${values.month}${values.day}-${values.hour}${values.minute}${values.second}`;
  }

  function formatDate(value) {
    const text = String(value || "").trim();
    if (!text) return "-";

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return text;
    }

    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return "-";
    return formatKstDateInput(parsed);
  }

  function roundHours(value) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? Math.max(0, numberValue) : 0;
  }

  function formatHours(value) {
    const hours = roundHours(value);
    return `${hours.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}h`;
  }

  function formatDaysHours(value) {
    const hours = Math.max(0, roundHours(value));
    const days = Math.floor(hours / 24);
    const remainingHours = Math.floor(hours % 24);
    return `${days}일 ${remainingHours}시간`;
  }

  function addDaysToDate(value, days) {
    const text = formatDate(value);
    const safeDays = Number(days);

    if (text === "-" || !Number.isFinite(safeDays)) return "-";

    const [year, month, day] = text.split("-").map(Number);
    if (![year, month, day].every(Number.isFinite)) return "-";

    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + Math.round(safeDays));
    return date.toISOString().slice(0, 10);
  }

  function formatRemainingDday(nextReplacementAt, now = new Date()) {
    const dueDate = formatDate(nextReplacementAt);
    const today = formatKstDateInput(now);
    if (dueDate === "-") return "기준 미설정";

    const [dueYear, dueMonth, dueDay] = dueDate.split("-").map(Number);
    const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
    const dueUtc = Date.UTC(dueYear, dueMonth - 1, dueDay);
    const todayUtc = Date.UTC(todayYear, todayMonth - 1, todayDay);
    const dayDifference = Math.round((dueUtc - todayUtc) / 86400000);

    if (!Number.isFinite(dayDifference)) return "기준 미설정";
    if (dayDifference === 0) return "D-DAY";
    return dayDifference > 0 ? `D-${dayDifference}` : `D+${Math.abs(dayDifference)}`;
  }

  function formatOperatingDday(remainingHours) {
    const hours = Number(remainingHours);
    if (!Number.isFinite(hours)) return "기준 미설정";
    if (Math.abs(hours) < 24) return "D-DAY";

    const days = Math.ceil(Math.abs(hours) / 24);
    return hours > 0 ? `D-${days}` : `D+${days}`;
  }

  function projectedOperatingDueDate(remainingHours, now = new Date()) {
    const hours = Number(remainingHours);
    if (!Number.isFinite(hours)) return "-";
    if (hours <= 0) return formatKstDateInput(now);
    return formatKstDateInput(new Date(now.getTime() + hours * 3600000));
  }

  function formatSignedRemaining(asset) {
    if (!asset.lastReplacementAt) return "확정된 V-Belt 교체 이력이 없습니다.";
    if (asset.cycleStartState === "pending") return "기동 등록 전 · 주기 계산 대기";
    if (asset.severity === "unset") return "교체주기 설정 필요";

    const remaining = Number(asset.remainingHours);

    if (!Number.isFinite(remaining)) return "-";

    if (remaining <= 0) {
      return `기준 ${formatDaysHours(Math.abs(remaining))} 초과`;
    }

    return `잔여 ${formatDaysHours(remaining)}`;
  }

  function severityLabel(severity) {
    return {
      normal: "정상",
      warning: "교체 예정",
      critical: "교체 임박",
      overdue: "교체주기 초과",
      startup_pending: "기동 대기",
      unset: "기준 미설정",
      unknown: "교체일 미확인"
    }[severity] || "확인 필요";
  }

  function displaySeverity(asset) {
    if (!asset?.lastReplacementAt) return "unknown";
    if (isAssetAwaitingBackfill(asset)) return "unknown";
    return ["normal", "warning", "critical", "overdue", "startup_pending", "unset"].includes(asset.severity)
      ? asset.severity
      : "normal";
  }

  function eventLabel(type) {
    return {
      replacement: "V-Belt 교체",
      startup: "기동",
      operation_start: "재기동",
      operation_stop: "정지",
      problem: "문제발생",
      runtime_correction: "운전시간 보정",
      note: "메모"
    }[type] || type;
  }

  function getTypeDefinition(type = state.activeType) {
    return state.data?.types?.find(item => item.key === type) || null;
  }

  function getActiveSetting() {
    return state.data?.settings?.[state.activeType] || null;
  }

  function getActiveAssets() {
    return (state.data?.assets || []).filter(asset => asset.blowerType === state.activeType);
  }

  function getActiveMissingSlots() {
    return (state.data?.missingSlots || []).filter(slot => slot.blowerType === state.activeType);
  }

  function renderTypeTabs() {
    if (!elements.typeTabs || !state.data) return;

    const compactLabels = {
      fbhe: "FBHE",
      seal_pot: "Seal Pot",
      organic_fuel: "유기성",
      flyash_bag: "BAG",
      flyash_silo: "SILO"
    };

    elements.typeTabs.innerHTML = (state.data.types || [])
      .map(type => {
        const active = type.key === state.activeType;
        const typeAlerts = (state.data.assets || []).filter(
          asset => asset.blowerType === type.key && ["warning", "critical", "overdue"].includes(displaySeverity(asset))
        ).length;
        const alertLabel = typeAlerts > 0 ? `교체주기 알림 ${typeAlerts}건` : "";
        const accessibleLabel = alertLabel ? `${type.label}, ${alertLabel}` : type.label;

        return `
          <button
            type="button"
            class="type-tab${active ? " is-active" : ""}${type.important ? " is-important" : ""}${typeAlerts > 0 ? " has-alert" : ""}"
            data-type="${escapeHtml(type.key)}"
            aria-label="${escapeHtml(accessibleLabel)}"
            title="${escapeHtml(accessibleLabel)}"
            aria-pressed="${active ? "true" : "false"}"
            ${active ? 'aria-current="page"' : ""}
          >
            <span class="type-label-full">${escapeHtml(type.label)}</span>
            <span class="type-label-compact">${escapeHtml(compactLabels[type.key] || type.label)}</span>
            ${typeAlerts > 0 ? `<span class="type-alert-count" aria-hidden="true">${typeAlerts}</span>` : ""}
          </button>
        `;
      })
      .join("");
  }

  function renderStatusFilters() {
    const assets = getActiveAssets();
    const missingSlots = getActiveMissingSlots();
    const counts = assets.reduce((result, asset) => {
      const severity = displaySeverity(asset);
      result[severity] = (result[severity] || 0) + 1;
      return result;
    }, { unknown: missingSlots.length });
    const definitions = [
      ["all", "전체", assets.length + missingSlots.length],
      ["normal", "정상", counts.normal || 0],
      ["warning", "교체 예정", counts.warning || 0],
      ["critical", "교체 임박", counts.critical || 0],
      ["overdue", "주기 초과", counts.overdue || 0],
      ["startup_pending", "기동 대기", counts.startup_pending || 0],
      ["unknown", "교체일 미확인", counts.unknown || 0],
      ["unset", "기준 미설정", counts.unset || 0]
    ];

    elements.statusFilters.innerHTML = definitions
      .filter(([key, , count]) => key === "all" || count > 0 || state.statusFilter === key)
      .map(([key, label, count]) => `
        <button
          type="button"
          class="status-filter ${escapeHtml(key)}${state.statusFilter === key ? " is-active" : ""}"
          data-status-filter="${escapeHtml(key)}"
          aria-pressed="${state.statusFilter === key ? "true" : "false"}"
        >
          <span>${escapeHtml(label)}</span>
          <strong>${Number(count).toLocaleString("ko-KR")}</strong>
        </button>
      `)
      .join("");
  }

  function renderSettings() {
    const type = getTypeDefinition();
    const setting = getActiveSetting();
    const publicMonitoring = isPublicMonitoringView();

    elements.activeTypeTitle.textContent = type?.label || "Blower";

    if (!setting || !(Number(setting.cycleDays) > 0)) {
      elements.settingsSummary.textContent = "교체주기 미설정";
      elements.settingsUpdated.textContent = publicMonitoring
        ? "공유 조회 전용"
        : isMobileMonitoringView()
          ? "모바일 조회 전용"
          : "로그인 사용자 누구나 설정 가능 · 변경 이력 기록";
    } else {
      const cycleHours = Number(setting.cycleDays) * 24;
      elements.settingsSummary.textContent = [
        `누적 운전 ${setting.cycleDays}일 (${cycleHours.toLocaleString("ko-KR")}h)`,
        `예정 ${Number(setting.warningDays) * 24}h 전`,
        `임박 ${Number(setting.criticalDays) * 24}h 전`
      ].join(" · ");

      const updatedText = setting.updatedAt
        ? `최근 변경 ${formatDate(setting.updatedAt)}${setting.updatedByName ? ` · ${setting.updatedByName}` : ""}`
        : "변경 이력 기록";
      elements.settingsUpdated.textContent = publicMonitoring
        ? `${updatedText} · 공유 조회 전용`
        : isMobileMonitoringView()
          ? `${updatedText} · 모바일 조회 전용`
          : `${updatedText} · 누구나 변경 가능`;
    }

    elements.settingsButton.hidden = !hasAuthenticatedWriteAccess() || isMobileMonitoringView();
    elements.assetManagerButton.hidden = !hasAuthenticatedWriteAccess()
      || !state.data?.user?.isSuperAdmin
      || isMobileMonitoringView();
  }

  function renderHeaderActions() {
    elements.auditHistoryButton.hidden = !hasAuthenticatedWriteAccess()
      || !state.data?.user?.isSuperAdmin
      || isMobileMonitoringView();
  }

  function renderMissingTags() {
    const missing = (state.data?.missingTags || []).filter(item => item.blowerType === state.activeType);

    if (missing.length === 0) {
      elements.missingTagsNotice.hidden = true;
      elements.missingTagsNotice.textContent = "";
      return;
    }

    elements.missingTagsNotice.hidden = false;
    const hasIdentityPending = missing.some(item => item.identityPending);
    elements.missingTagsNotice.innerHTML = `
      <strong>TAG 확인 대기</strong>
      <span>${missing.map(item => {
        const unitLabel = item.groupLabel
          || (item.unitNo === "shared" ? "공용" : `#${item.unitNo}호기`);
        return `${escapeHtml(unitLabel)} ${item.missingCount}대`;
      }).join(" · ")}</span>
      <small>${hasIdentityPending
        ? "축분 Blower는 정확한 TAG와 호기를 확인한 뒤 교체주기·이력을 연동합니다."
        : "정확한 전체 TAG가 업무일지에서 확인되면 자동 등록됩니다."}</small>
    `;
  }

  function getRawAssetEvents(tagNumber) {
    return (state.data?.events || []).filter(event => event.tagNumber === tagNumber);
  }

  function shouldHideAutomaticData(backfill = state.data?.backfill) {
    return !hasCanonicalBackfill(backfill) && !backfill?.requiresCatchUp;
  }

  function getVisibleEvents() {
    const events = state.data?.events || [];
    return shouldHideAutomaticData()
      ? events.filter(event => !isShiftLogEvent(event))
      : events;
  }

  function getAssetEvents(tagNumber) {
    return getVisibleEvents().filter(event => event.tagNumber === tagNumber);
  }

  function getLatestReplacementEvent(asset, includeHiddenAutomatic = false) {
    const sourceEvents = includeHiddenAutomatic
      ? getRawAssetEvents(asset.tagNumber)
      : getAssetEvents(asset.tagNumber);
    const replacements = sourceEvents
      .filter(event => event.eventType === "replacement");
    const replacementDate = formatDate(asset.lastReplacementAt);

    return replacements.find(event => formatDate(event.eventDate) === replacementDate)
      || replacements[0]
      || null;
  }

  function requiresInitialBackfill(backfill = state.data?.backfill) {
    if (!backfill) return true;
    return backfill.hasRun === false || backfill.requiresInitialRebuild === true;
  }

  function hasCanonicalBackfill(backfill = state.data?.backfill) {
    return Boolean(backfill?.hasRun && backfill.status === "complete");
  }

  function isAssetAwaitingBackfill(asset) {
    if (!shouldHideAutomaticData()) return false;

    const latestRecordedReplacement = asset?.lastReplacementAt
      ? getLatestReplacementEvent(asset, true)
      : null;

    return !latestRecordedReplacement || isShiftLogEvent(latestRecordedReplacement);
  }

  function isShiftLogEvent(event) {
    return [
      "shift_log_auto",
      "shift_log_history_auto",
      "shift_log_history_v12",
      "shift_log_history_v13",
      "shift_log_operation_auto"
    ].includes(event?.sourceType);
  }

  function evidenceSourceMeta(event) {
    if (!event) {
      return { label: "근거 미연결", className: "other" };
    }

    const sourceType = String(event?.sourceType || "").trim();

    if (sourceType === "shift_log_history_v13") {
      return { label: "업무일지 V13 문맥복구", className: "v13" };
    }
    if (sourceType === "shift_log_history_v12") {
      return { label: "업무일지 V12 복구", className: "v12" };
    }
    if (sourceType === "shift_log_history_auto") {
      return { label: "업무일지 과거 자동", className: "history" };
    }
    if (sourceType === "shift_log_auto") {
      return { label: "업무일지 자동감지", className: "auto" };
    }
    if (sourceType === "shift_log_operation_auto") {
      return { label: "업무일지 교체운전 자동", className: "auto" };
    }
    if (sourceType === "manual") {
      return { label: "수동 등록", className: "manual" };
    }

    return {
      label: sourceType ? sourceType : "등록 이력",
      className: "other"
    };
  }

  function emptyEvidenceMessage(event) {
    if (!event) {
      return "최근 교체 이력과 연결된 등록 근거가 없습니다.";
    }

    if (isShiftLogEvent(event)) {
      return "업무일지 기반 교체 이력이지만 이 이벤트에는 원문 근거가 저장되지 않았습니다.";
    }

    if (event.sourceType === "manual") {
      return "수동 등록 시 작업내용(비고)이 입력되지 않았습니다.";
    }

    return "등록 이력은 확인되지만 원문 근거가 저장되지 않았습니다.";
  }

  function fullEvidenceText(event) {
    if (!event) return "";

    const raw = isShiftLogEvent(event)
      ? event.sourceText
      : event.sourceType === "manual"
        ? event.note
        : (event.note || event.sourceText);

    return String(raw || "")
      .replace(/\s*\n\s*/g, " · ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function readableEvidence(event) {
    const fullText = fullEvidenceText(event);
    if (!fullText) return "";

    if (isShiftLogEvent(event)) {
      return fullText.length > 240
        ? `${fullText.slice(0, 237).trim()}…`
        : fullText;
    }

    const raw = fullText
      .replace(/legacy-entry-[^|\s]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    const fragments = raw
      .split(/\s*\|\s*|\s*\n\s*/)
      .map(fragment => fragment.trim())
      .filter(Boolean)
      .filter(fragment => !/^\d{3}[A-Z0-9]{7,}$/i.test(fragment))
      .filter(fragment => !/^(?:BCO[12]|BO[12]|TGO|TO|TM\s*발행)$/i.test(fragment));
    const replacementFragment = fragments.find(fragment => {
      const hasBelt = /(?:v[\s\/-]?belt|vbelt|belt|v[\s\/-]?벨트|v벨트|벨트)/i.test(fragment);
      const hasNewBeltInstall = (
        /(?:v[\s\/-]?belt|vbelt|belt|v[\s\/-]?벨트|v벨트|벨트).{0,40}(?:신품|new)?.{0,16}(?:취부|설치|장착).{0,16}(?:완료|실시|함|하였|했)/i.test(fragment)
        || /(?:신품|new).{0,16}(?:v[\s\/-]?belt|vbelt|belt|v[\s\/-]?벨트|v벨트|벨트).{0,16}(?:취부|설치|장착).{0,16}(?:완료|실시|함|하였|했)/i.test(fragment)
      );
      const hasCompletion = (
        /(?:교체|교환)\s*(?:작업\s*)?(?:완료|실시|시행|함|하였|했|하여)/i.test(fragment)
        || /\breplaced\b|replacement\s+completed?/i.test(fragment)
        || hasNewBeltInstall
      );
      const hasHardExclusion = (
        /(?:교체\s*운전|교체\s*(?:중|미실시|미완료|보류|취소|불가)|미교체|완료\s*(?:여부|미확인|실패|불가)|하지\s*못|못\s*(?:함|했)|안\s*(?:됨|함|했)|not\s+replaced|replacement\s+cancelled?)/i.test(fragment)
      );
      const hasUnresolvedPlan = (
        /(?:요청|예정|계획|필요|검토|관찰|감시|요망|tm\s*발행)/i.test(fragment)
        && !hasCompletion
      );
      const isBeltWork = hasBelt && (/(?:교체|교환|replace)/i.test(fragment) || hasNewBeltInstall);
      return isBeltWork && hasCompletion && !hasHardExclusion && !hasUnresolvedPlan;
    });

    const text = replacementFragment || fragments.join(" · ") || raw;

    return text.length > 240 ? `${text.slice(0, 237).trim()}…` : text;
  }

  function renderAssetCard(asset, setting) {
    const cycleDays = Number(setting?.cycleDays);
    const cycleElapsedHours = roundHours(asset.cycleElapsedHours);
    const replacementEvent = asset.lastReplacementAt ? getLatestReplacementEvent(asset) : null;
    const awaitingBackfill = isAssetAwaitingBackfill(asset);
    const confirmed = Boolean(asset.lastReplacementAt) && !awaitingBackfill;
    const cycleStartState = String(asset.cycleStartState || "legacy");
    const startupPending = confirmed && cycleStartState === "pending";
    const actualStarted = confirmed && cycleStartState === "started" && Boolean(asset.cycleStartedAt);
    const cycleRuntimeTracked = confirmed && !startupPending && Boolean(asset.cycleRuntimeTracked);
    const operationRunning = cycleRuntimeTracked && Boolean(asset.isRunning);
    const operationState = confirmed
      ? (startupPending ? "startup_pending" : (operationRunning ? "running" : "stopped"))
      : "unconfirmed";
    const cycleAnchorAt = actualStarted ? asset.cycleStartedAt : (startupPending ? "" : asset.lastReplacementAt);
    const severity = displaySeverity(asset);
    const evidence = readableEvidence(replacementEvent);
    const fullEvidence = fullEvidenceText(replacementEvent);
    const evidenceMeta = evidenceSourceMeta(replacementEvent);
    const cycleHours = cycleDays > 0 ? cycleDays * 24 : null;
    const rawProgress = cycleHours ? (cycleElapsedHours / cycleHours) * 100 : 0;
    const progress = Math.max(0, Math.min(100, rawProgress));
    const nextReplacementAt = cycleRuntimeTracked
      ? (operationRunning ? projectedOperatingDueDate(asset.remainingHours) : "재기동 후 산정")
      : (cycleDays > 0 && cycleAnchorAt ? addDaysToDate(cycleAnchorAt, cycleDays) : "-");
    const remainingLabel = cycleHours && !startupPending
      ? (cycleRuntimeTracked
        ? formatOperatingDday(asset.remainingHours)
        : formatRemainingDday(nextReplacementAt))
      : "-";
    const remainingDetail = cycleHours ? formatSignedRemaining(asset) : "교체주기 미설정";
    const evidenceText = fullEvidence || emptyEvidenceMessage(replacementEvent);
    const evidencePreview = evidence || evidenceText;
    const cardPosition = formatCardPosition(asset);
    const unitAttribute = ["1", "2", "shared"].includes(String(asset.unitNo || ""))
      ? ` data-unit="${escapeHtml(asset.unitNo)}"`
      : "";
    const cycleBasisLabel = cycleHours
      ? (cycleRuntimeTracked
        ? `${cycleHours.toLocaleString("ko-KR")}h`
        : `${cycleDays.toLocaleString("ko-KR")}일`)
      : "미설정";
    const operationActionLabel = operationRunning ? "정지" : "기동";
    const operationActionTitle = operationRunning
      ? "클릭하면 현재 시각으로 운전을 정지합니다."
      : "클릭하면 현재 시각으로 운전을 기동합니다.";
    const operationAction = confirmed
      ? `<button type="button" class="asset-action runtime-state-action ${operationRunning ? "stop" : "start"}" data-mobile-write data-asset-action="operation_toggle" data-tag="${escapeHtml(asset.tagNumber)}" title="${escapeHtml(operationActionTitle)}" aria-label="${escapeHtml(`${cardPosition} ${operationActionLabel}`)}">${operationActionLabel}</button>`
      : "";

    return `
      <article class="asset-card" data-severity="${escapeHtml(severity)}" data-operation-state="${escapeHtml(operationState)}" data-tag="${escapeHtml(asset.tagNumber)}"${unitAttribute}>
        <div class="asset-card-header">
          <div class="asset-identity">
            <strong class="asset-position">${escapeHtml(cardPosition)}</strong>
            <span class="asset-tag">${escapeHtml(asset.tagNumber)}</span>
          </div>
          <div class="asset-status-group">
            <span class="status-pill ${escapeHtml(severity)}">${escapeHtml(awaitingBackfill ? "재구성 대기" : severityLabel(severity))}</span>
            ${confirmed ? `<span class="operation-pill ${operationRunning ? "running" : "stopped"}">${operationRunning ? "운전중" : "정지"}</span>` : ""}
          </div>
        </div>

        ${confirmed ? `
          <div class="cycle-overview${startupPending ? " is-startup-pending" : ""}" title="${escapeHtml(remainingDetail)}">
            <div class="cycle-primary-metric">
              <span>${startupPending ? "주기 상태" : (cycleRuntimeTracked ? "누적 운전" : (actualStarted ? "기동 경과" : "교체 경과"))}</span>
              <strong>${startupPending ? "기동 대기" : escapeHtml(formatDaysHours(cycleElapsedHours))}</strong>
            </div>
            <div class="cycle-deadline-metric ${escapeHtml(severity)}">
              <span>${cycleRuntimeTracked && !operationRunning ? "D-day · 정지" : "D-day"}</span>
              <strong>${escapeHtml(remainingLabel)}</strong>
            </div>
            <div class="cycle-usage-metric ${escapeHtml(severity)}">
              <span>주기 사용</span>
              <strong>${cycleHours && !startupPending ? `${Math.round(rawProgress).toLocaleString("ko-KR")}%` : "-"}</strong>
            </div>
          </div>

          ${cycleHours && !startupPending ? `
            <div class="cycle-progress-block">
              <div
                class="progress-track"
                role="progressbar"
                aria-label="교체주기 진행률"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow="${Math.round(progress)}"
              >
                <div class="progress-bar" style="width:${progress.toFixed(2)}%"></div>
              </div>
            </div>
          ` : (startupPending && cycleHours ? `<div class="cycle-progress-block is-placeholder" aria-hidden="true"><div class="progress-track"></div></div>` : "")}

          ${actualStarted || startupPending ? `
            <div class="cycle-date-line${startupPending ? " is-startup-pending" : " has-cycle-start"}">
              <span><em>교체</em><strong>${escapeHtml(formatDate(asset.lastReplacementAt))}</strong></span>
              <b aria-hidden="true">→</b>
              <span><em>기동</em><strong>${startupPending ? "미등록" : escapeHtml(formatDate(asset.cycleStartedAt))}</strong></span>
              ${startupPending ? "" : `<b aria-hidden="true">→</b><span><em>${cycleRuntimeTracked ? "예상" : "예정"}</em><strong>${escapeHtml(nextReplacementAt)}</strong></span>`}
              <small>기준 ${cycleHours ? cycleBasisLabel : "미설정"}</small>
            </div>
          ` : `
            <div class="cycle-date-line">
              <span><em>최근</em><strong>${escapeHtml(formatDate(asset.lastReplacementAt))}</strong></span>
              <b aria-hidden="true">→</b>
              <span><em>${cycleRuntimeTracked ? "예상" : "예정"}</em><strong>${escapeHtml(nextReplacementAt)}</strong></span>
              <small>기준 ${cycleHours ? cycleBasisLabel : "미설정"}</small>
            </div>
          `}

          <div class="asset-evidence${evidence ? "" : " is-empty"}">
            <div class="evidence-heading">
              <span>등록 근거</span>
              <em class="evidence-source-badge ${escapeHtml(evidenceMeta.className)}">${escapeHtml(evidenceMeta.label)}</em>
            </div>
            <p title="${escapeHtml(evidenceText)}">${escapeHtml(evidencePreview)}</p>
          </div>
        ` : awaitingBackfill ? `
          <div class="unknown-cycle is-rebuild-pending">
            <strong>자동 이력 재확인 중</strong>
            <p>V13 업무일지 문맥 복구 후 교체일과 경과시간을 표시합니다.</p>
            <small>수동 등록 이력은 재구성과 관계없이 유지됩니다.</small>
          </div>
        ` : `
          <div class="unknown-cycle">
            <strong>최근 교체일 없음</strong>
            <p>확정된 V-Belt 교체 이력이 아직 없습니다.</p>
            <small>검토 대기에서 확인하거나 직접 등록할 수 있습니다.</small>
          </div>
        `}

        <div class="asset-actions">
          ${operationAction}
          <button type="button" class="asset-action ${confirmed ? "" : "primary"}" data-mobile-write data-asset-action="replacement" data-tag="${escapeHtml(asset.tagNumber)}">${startupPending ? "V-Belt 교체 다시 등록" : "V-Belt 교체 등록"}</button>
          ${confirmed && !startupPending ? `<button type="button" class="asset-action" data-mobile-write data-asset-action="runtime" data-tag="${escapeHtml(asset.tagNumber)}">누적시간</button>` : ""}
          <button type="button" class="asset-action" data-asset-action="history" data-tag="${escapeHtml(asset.tagNumber)}">이력 보기</button>
        </div>
      </article>
    `;
  }

  function formatCardPosition(item) {
    const position = String(item?.positionLabel || "").trim();
    const unitNo = String(item?.unitNo || "").trim();

    if (unitNo === "shared") return position ? `1·2호기 공용 · ${position}` : "1·2호기 공용";
    if (/^[12]$/.test(unitNo)) return position ? `#${unitNo}호기 · ${position}` : `#${unitNo}호기`;
    return position || String(item?.displayName || "Blower").trim();
  }

  function unitDisplayRank(unitNo) {
    return ({ "1": 1, "2": 2, shared: 3 })[String(unitNo || "")] || 9;
  }

  function positionDisplayRank(positionLabel) {
    const value = String(positionLabel || "").trim().replace(/^#/, "").toUpperCase();
    if (/^[A-Z]$/.test(value)) return value.charCodeAt(0) - 64;
    if (/^\d+$/.test(value)) return Number(value);
    return 99;
  }

  function compareAssetDisplayEntries(left, right) {
    const leftItem = left.item;
    const rightItem = right.item;
    const unitDifference = unitDisplayRank(leftItem.unitNo) - unitDisplayRank(rightItem.unitNo);
    if (unitDifference !== 0) return unitDifference;

    if (left.kind === "asset" && right.kind === "asset") {
      const managedSortDifference = Number(leftItem.sortOrder || 0) - Number(rightItem.sortOrder || 0);
      if (managedSortDifference !== 0) return managedSortDifference;
    }

    const positionDifference = positionDisplayRank(leftItem.positionLabel) - positionDisplayRank(rightItem.positionLabel);
    if (positionDifference !== 0) return positionDifference;

    const sortDifference = Number(leftItem.sortOrder || 0) - Number(rightItem.sortOrder || 0);
    if (sortDifference !== 0) return sortDifference;
    return String(leftItem.tagNumber || leftItem.slotKey || "").localeCompare(String(rightItem.tagNumber || rightItem.slotKey || ""));
  }

  function unifiedGroupLabel(items) {
    const units = new Set(items.map(item => String(item?.unitNo || "")).filter(Boolean));
    if (units.has("1") && units.has("2")) return "#1 · #2호기";
    if (units.has("1")) return "#1호기";
    if (units.has("2")) return "#2호기";
    if (units.has("shared")) return "#1 · #2호기 공용";
    return "Blower";
  }

  function usesUnitRows(blowerType) {
    return ["fbhe", "seal_pot"].includes(String(blowerType || ""));
  }

  function unitRowLabel(unitNo, items) {
    if (String(unitNo) === "1") return "#1호기";
    if (String(unitNo) === "2") return "#2호기";
    if (String(unitNo) === "shared") return "#1 · #2호기 공용";
    return unifiedGroupLabel(items);
  }

  function renderDisplayEntry(entry, setting) {
    return entry.kind === "asset"
      ? renderAssetCard(entry.item, setting)
      : renderMissingAssetCard(entry.item);
  }

  function renderMissingAssetCard(slot) {
    const identityPending = Boolean(slot.identityPending);
    const positionLabel = identityPending ? (slot.displayName || "축분 Blower") : formatCardPosition(slot);
    const tagLabel = identityPending ? "TAG · 호기 확인 대기" : "TAG 자동확인 대기";
    const note = identityPending
      ? "정확한 TAG와 호기가 확인되면 교체주기와 이력을 연동합니다."
      : "정확한 전체 TAG가 업무일지에서 확인되면 설비 카드로 자동 전환됩니다.";
    const unitAttribute = !identityPending && ["1", "2", "shared"].includes(String(slot.unitNo || ""))
      ? ` data-unit="${escapeHtml(slot.unitNo)}"`
      : "";

    return `
      <article class="asset-card is-placeholder${identityPending ? " is-identity-pending" : ""}" data-severity="unknown"${unitAttribute}>
        <div class="asset-card-header">
          <div class="asset-identity">
            <strong class="asset-position">${escapeHtml(positionLabel)}</strong>
            <span class="asset-tag">${escapeHtml(tagLabel)}</span>
          </div>
          <span class="status-pill unknown">TAG 미확인</span>
        </div>

        <div class="placeholder-note">
          ${escapeHtml(note)}
        </div>
      </article>
    `;
  }

  function buildAssetSectionsHtml(assets, missingSlots, setting, statusFilter = "all") {
    const visibleAssets = assets
      .filter(asset => statusFilter === "all" || displaySeverity(asset) === statusFilter)
      .map(item => ({ kind: "asset", item }));
    const visibleGroupedAssets = visibleAssets
      .filter(entry => String(entry.item?.assetGroup || "") === "manure")
      .sort(compareAssetDisplayEntries);
    const visibleStandardAssets = visibleAssets
      .filter(entry => String(entry.item?.assetGroup || "") !== "manure");
    const visibleStandardSlots = missingSlots
      .filter(slot => !slot.identityPending && ["all", "unknown"].includes(statusFilter))
      .map(item => ({ kind: "missing", item }));
    const visiblePendingSlots = missingSlots
      .filter(slot => slot.identityPending && ["all", "unknown"].includes(statusFilter))
      .slice()
      .sort((left, right) => String(left.slotKey || "").localeCompare(String(right.slotKey || "")));
    const standardEntries = [...visibleStandardAssets, ...visibleStandardSlots].sort(compareAssetDisplayEntries);
    const sections = [];

    if (standardEntries.length > 0) {
      const inventoryItems = [
        ...assets,
        ...missingSlots.filter(slot => !slot.identityPending)
      ];
      const blowerType = inventoryItems.find(item => item?.blowerType)?.blowerType || state.activeType;

      if (usesUnitRows(blowerType)) {
        const entriesByUnit = new Map();
        for (const entry of standardEntries) {
          const unitNo = String(entry.item?.unitNo || "other");
          if (!entriesByUnit.has(unitNo)) entriesByUnit.set(unitNo, []);
          entriesByUnit.get(unitNo).push(entry);
        }

        const orderedUnitKeys = ["1", "2", "shared"];
        for (const unitNo of entriesByUnit.keys()) {
          if (!orderedUnitKeys.includes(unitNo)) orderedUnitKeys.push(unitNo);
        }

        for (const unitNo of orderedUnitKeys) {
          const unitEntries = entriesByUnit.get(unitNo) || [];
          if (unitEntries.length === 0) continue;
          const unitItems = unitEntries.map(entry => entry.item);
          const cards = unitEntries.map(entry => renderDisplayEntry(entry, setting)).join("");

          sections.push(`
            <section class="unit-group is-unit-assets" data-unit-group="${escapeHtml(unitNo)}">
              <h3 class="unit-heading">${escapeHtml(unitRowLabel(unitNo, unitItems))} <span>${unitEntries.length}대</span></h3>
              <div class="asset-grid is-unit-grid">${cards}</div>
            </section>
          `);
        }
      } else {
        const cards = standardEntries.map(entry => renderDisplayEntry(entry, setting)).join("");

        sections.push(`
          <section class="unit-group is-unified-assets">
            <h3 class="unit-heading">${escapeHtml(unifiedGroupLabel(inventoryItems))} <span>${standardEntries.length}대</span></h3>
            <div class="asset-grid is-unified-grid">${cards}</div>
          </section>
        `);
      }
    }

    if (visibleGroupedAssets.length > 0) {
      sections.push(`
        <section class="unit-group is-pending-assets is-managed-group-assets" data-asset-group="manure">
          <h3 class="unit-heading">축분 Blower <span>${visibleGroupedAssets.length}대</span></h3>
          <div class="asset-grid is-pending-grid is-managed-group-grid">${visibleGroupedAssets.map(entry => renderDisplayEntry(entry, setting)).join("")}</div>
        </section>
      `);
    }

    if (visiblePendingSlots.length > 0) {
      const pendingLabel = visiblePendingSlots[0].groupLabel || "TAG 확인 대기";
      sections.push(`
        <section class="unit-group is-pending-assets">
          <h3 class="unit-heading">${escapeHtml(pendingLabel)} <span>${visiblePendingSlots.length}대</span></h3>
          <div class="asset-grid is-pending-grid">${visiblePendingSlots.map(renderMissingAssetCard).join("")}</div>
        </section>
      `);
    }

    return sections.join("");
  }

  function renderAssets() {
    const assets = getActiveAssets();
    const missingSlots = getActiveMissingSlots();
    const setting = getActiveSetting();
    const html = buildAssetSectionsHtml(assets, missingSlots, setting, state.statusFilter);

    const total = assets.length + missingSlots.length;
    const visible = state.statusFilter === "all"
      ? total
      : assets.filter(asset => displaySeverity(asset) === state.statusFilter).length
        + (state.statusFilter === "unknown" ? missingSlots.length : 0);

    elements.visibleAssetCount.hidden = state.statusFilter === "all";
    elements.visibleAssetCount.textContent = state.statusFilter === "all"
      ? ""
      : `${visible.toLocaleString("ko-KR")} / ${total.toLocaleString("ko-KR")}대`;
    elements.assetGroups.innerHTML = html || `
      <div class="empty-state compact">선택한 상태의 Blower가 없습니다.</div>
    `;
  }

  function readAveragePeriod() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(AVERAGE_PERIOD_STORAGE_KEY) || "null");
    } catch {
      saved = null;
    }

    const value = Math.max(1, Math.min(120, Number(saved?.value || elements.averagePeriodValue?.value || 12) || 12));
    const unit = saved?.unit === "years" ? "years" : "months";
    return { value: Math.round(value), unit };
  }

  function applySavedAveragePeriod() {
    if (!elements.averagePeriodValue || !elements.averagePeriodUnit) return;
    const period = readAveragePeriod();
    elements.averagePeriodValue.value = String(period.value);
    elements.averagePeriodUnit.value = period.unit;
  }

  function saveAveragePeriod() {
    if (!elements.averagePeriodValue || !elements.averagePeriodUnit) return;
    const value = Math.max(1, Math.min(120, Number(elements.averagePeriodValue.value) || 1));
    const unit = elements.averagePeriodUnit.value === "years" ? "years" : "months";
    elements.averagePeriodValue.value = String(Math.round(value));
    localStorage.setItem(AVERAGE_PERIOD_STORAGE_KEY, JSON.stringify({ value: Math.round(value), unit }));
  }

  function getAverageWindowStart(period) {
    const start = new Date();
    if (period.unit === "years") {
      start.setFullYear(start.getFullYear() - period.value);
    } else {
      start.setMonth(start.getMonth() - period.value);
    }
    return start;
  }

  function buildReplacementIntervals() {
    const period = readAveragePeriod();
    const windowStart = getAverageWindowStart(period);
    const now = new Date();
    const grouped = new Map();

    for (const event of getVisibleEvents()) {
      if (event.blowerType !== state.activeType || event.eventType !== "replacement") continue;
      const parsed = new Date(event.eventDate);
      if (Number.isNaN(parsed.getTime())) continue;
      if (!grouped.has(event.tagNumber)) grouped.set(event.tagNumber, []);
      grouped.get(event.tagNumber).push({ event, parsed });
    }

    const intervals = [];
    const perAsset = new Map();

    for (const [tagNumber, replacements] of grouped.entries()) {
      replacements.sort((a, b) => a.parsed - b.parsed);
      for (let index = 1; index < replacements.length; index += 1) {
        const previous = replacements[index - 1];
        const current = replacements[index];
        if (current.parsed < windowStart || current.parsed > now) continue;
        const days = (current.parsed.getTime() - previous.parsed.getTime()) / 86400000;
        if (!(days > 0 && days < 3650)) continue;

        const item = {
          tagNumber,
          days,
          from: previous.event.eventDate,
          to: current.event.eventDate
        };
        intervals.push(item);
        if (!perAsset.has(tagNumber)) perAsset.set(tagNumber, []);
        perAsset.get(tagNumber).push(item);
      }
    }

    return { period, windowStart, intervals, perAsset };
  }

  function averageOf(values) {
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function formatAverageDays(value) {
    return Number.isFinite(value)
      ? `${value.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}일`
      : "-";
  }

  function renderAverageStats() {
    if (!elements.averageHeadline || !elements.averageMetrics || !elements.averageAssets) return;

    const { period, intervals, perAsset } = buildReplacementIntervals();
    const periodLabel = `최근 ${period.value}${period.unit === "years" ? "년" : "개월"}`;
    const days = intervals.map(item => item.days);
    const average = averageOf(days);

    if (!days.length) {
      elements.averagePanel.hidden = true;
      elements.averageHeadline.textContent = `${periodLabel} · 계산 가능한 연속 교체 이력 없음`;
      elements.averageMetrics.innerHTML = `
        <div class="average-metric"><span>평균</span><strong>-</strong></div>
        <div class="average-metric"><span>표본</span><strong>0회</strong></div>
        <div class="average-metric"><span>최단</span><strong>-</strong></div>
        <div class="average-metric"><span>최장</span><strong>-</strong></div>
      `;
    } else {
      elements.averagePanel.hidden = false;
      elements.averageHeadline.textContent = `${periodLabel} · 평균 ${formatAverageDays(average)}`;
      elements.averageMetrics.innerHTML = `
        <div class="average-metric primary"><span>평균 V-Belt 교체주기</span><strong>${escapeHtml(formatAverageDays(average))}</strong></div>
        <div class="average-metric"><span>표본</span><strong>${days.length.toLocaleString("ko-KR")}회</strong></div>
        <div class="average-metric"><span>최단</span><strong>${escapeHtml(formatAverageDays(Math.min(...days)))}</strong></div>
        <div class="average-metric"><span>최장</span><strong>${escapeHtml(formatAverageDays(Math.max(...days)))}</strong></div>
      `;
    }

    const assets = getActiveAssets()
      .slice()
      .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));

    elements.averageAssets.innerHTML = assets
      .map(asset => {
        const assetIntervals = perAsset.get(asset.tagNumber) || [];
        const assetAverage = averageOf(assetIntervals.map(item => item.days));
        return `
          <div class="average-asset-row">
            <span><strong>${escapeHtml(asset.unitNo === "shared" ? "공용" : `#${asset.unitNo}호기`)} ${escapeHtml(asset.positionLabel)}</strong><small>${escapeHtml(asset.tagNumber)}</small></span>
            <strong>${escapeHtml(formatAverageDays(assetAverage))}</strong>
            <em>${assetIntervals.length}회</em>
          </div>
        `;
      })
      .join("");
  }

  function historySourceLabel(event) {
    return evidenceSourceMeta(event).label;
  }

  function historyRuntimeLabel(event) {
    if (isShiftLogEvent(event)) {
      return Number(event.runtimeHours) > 0
        ? `약 ${formatHours(event.runtimeHours)}`
        : "-";
    }

    return formatHours(event.runtimeHours);
  }

  function displayEventContent(event) {
    if (event?.eventType !== "replacement") {
      return event?.note || event?.sourceText || "-";
    }

    const evidence = fullEvidenceText(event);
    if (evidence) return evidence;
    return emptyEvidenceMessage(event);
  }

  function renderHistory() {
    const filter = elements.historyFilter?.value || "replacement";
    const events = getVisibleEvents().filter(event => {
      if (event.blowerType !== state.activeType) return false;
      return filter === "all" ||
        event.eventType === filter ||
        (filter === "operation" && ["operation_start", "operation_stop"].includes(event.eventType));
    });

    elements.historyEmpty.hidden = events.length > 0;
    elements.historyEmpty.textContent = shouldHideAutomaticData()
      ? "초기 재구성 완료 전에는 수동 등록 이력만 표시합니다."
      : "등록된 이력이 없습니다.";
    elements.historyBody.innerHTML = events
      .map(event => `
        <tr>
          <td>${escapeHtml(["startup", "operation_start", "operation_stop"].includes(event.eventType) ? formatKstDateTimeDisplay(event.eventDate) : formatDate(event.eventDate))}</td>
          <td>
            <strong>${escapeHtml(event.displayName || event.positionLabel)}</strong><br>
            <span class="history-tag">${escapeHtml(event.tagNumber)}</span>
          </td>
          <td><span class="event-badge ${escapeHtml(event.eventType)}">${escapeHtml(eventLabel(event.eventType))}</span></td>
          <td>${escapeHtml(historyRuntimeLabel(event))}</td>
          <td>${escapeHtml(event.issueType || "-")}</td>
          <td>${escapeHtml(event.actionType || "-")}</td>
          <td>${escapeHtml(displayEventContent(event))}</td>
          <td>${escapeHtml(historySourceLabel(event))}${event.createdByName ? `<br><small>${escapeHtml(event.createdByName)}</small>` : ""}</td>
        </tr>
      `)
      .join("");
  }

  function openAssetHistory(tagNumber) {
    const asset = findAsset(tagNumber);
    if (!asset || !elements.historyDialog) return;

    state.historyAssetTag = tagNumber;
    const severity = displaySeverity(asset);
    const awaitingBackfill = isAssetAwaitingBackfill(asset);
    const cycleStartState = String(asset.cycleStartState || "legacy");
    const startupPending = cycleStartState === "pending";
    const actualStarted = cycleStartState === "started" && Boolean(asset.cycleStartedAt);
    const events = getAssetEvents(tagNumber)
      .filter(event => ["replacement", "startup", "operation_start", "operation_stop", "runtime_correction"].includes(event.eventType));
    const latestRuntimeEvent = latestExplicitRuntimeEvent(asset);

    elements.historyDialogTitle.textContent = `${asset.positionLabel} 이력`;
    elements.historyDialogAsset.textContent = `${asset.displayName} · ${asset.tagNumber}`;
    elements.historyCycleSummary.innerHTML = asset.lastReplacementAt && !awaitingBackfill
      ? `
        <span class="status-pill ${escapeHtml(severity)}">${escapeHtml(severityLabel(severity))}</span>
        <div><span>최근 V-Belt 교체</span><strong>${escapeHtml(formatDate(asset.lastReplacementAt))}</strong></div>
        <div><span>현재 운전상태</span><strong>${asset.isRunning ? "운전중" : "정지"}</strong></div>
        <div><span>누적 운전시간</span><strong>${startupPending ? "0시간" : escapeHtml(formatDaysHours(asset.cycleElapsedHours))}</strong></div>
        <div>
          <span>누적시간 관리</span>
          ${hasAuthenticatedWriteAccess() && !startupPending
            ? `<button type="button" class="button secondary history-runtime-edit" data-mobile-write data-history-action="runtime">누적시간 수정</button>`
            : `<strong>${startupPending ? "기동 후 수정 가능" : "조회 전용"}</strong>`}
        </div>
      `
      : awaitingBackfill
        ? `
        <span class="status-pill unknown">재구성 대기</span>
        <div class="history-unknown"><strong>자동 이력을 다시 확인하고 있습니다.</strong><span>재구성 완료 후 확정된 교체일과 경과시간을 표시합니다.</span></div>
      `
        : `
        <span class="status-pill unknown">교체일 미확인</span>
        <div class="history-unknown"><strong>확정된 V-Belt 교체 이력이 없습니다.</strong><span>검토 대기 후보를 확인하거나 최초 이력을 직접 등록해 주세요.</span></div>
      `;

    if (elements.historyRuntimeStateButton) {
      const canManageRuntime = hasAuthenticatedWriteAccess() && Boolean(asset.lastReplacementAt) && !awaitingBackfill;
      elements.historyRuntimeStateButton.hidden = !canManageRuntime;
      elements.historyRuntimeStateButton.disabled = !canManageRuntime;
      if (canManageRuntime) {
        const nextAction = startupPending ? "startup" : "runtime_state_add";
        elements.historyRuntimeStateButton.dataset.historyAction = nextAction;
        elements.historyRuntimeStateButton.dataset.targetState = startupPending || !asset.isRunning ? "running" : "stopped";
        elements.historyRuntimeStateButton.textContent = startupPending || !asset.isRunning
          ? "기동 이력 추가"
          : "정지 이력 추가";
      }
    }

    if (elements.historyRuntimeCorrectionButton) {
      const canCorrectRuntime = hasAuthenticatedWriteAccess() && Boolean(asset.lastReplacementAt) && !awaitingBackfill && !startupPending;
      elements.historyRuntimeCorrectionButton.hidden = !canCorrectRuntime;
      elements.historyRuntimeCorrectionButton.disabled = !canCorrectRuntime;
    }

    elements.assetHistoryList.innerHTML = events.length
      ? events.map(event => {
          const content = displayEventContent(event) || "등록 내용 없음";
          const detail = [event.issueType, event.actionType].filter(Boolean).join(" → ");
          const expectedState = event.eventType === "operation_stop" ? "stopped" : "running";
          const currentState = asset.isRunning ? "running" : "stopped";
          const editableRuntimeEvent = (
            hasAuthenticatedWriteAccess() &&
            Boolean(event.id) &&
            latestRuntimeEvent?.id === event.id &&
            ["operation_start", "operation_stop"].includes(event.eventType) &&
            event.sourceType === "manual" &&
            cycleStartState !== "pending" &&
            expectedState === currentState
          );
          const edited = Boolean(event.updatedAt && event.createdAt && event.updatedAt !== event.createdAt);

          return `
            <article class="asset-history-item">
              <div class="asset-history-date">${escapeHtml(["startup", "operation_start", "operation_stop", "runtime_correction"].includes(event.eventType) ? formatKstDateTimeDisplay(event.eventDate) : formatDate(event.eventDate))}</div>
              <div class="asset-history-content">
                <div class="asset-history-heading">
                  <span class="event-badge ${escapeHtml(event.eventType)}">${escapeHtml(eventLabel(event.eventType))}</span>
                  ${detail ? `<strong>${escapeHtml(detail)}</strong>` : ""}
                  ${edited ? `<span class="event-edited">수정됨</span>` : ""}
                  ${editableRuntimeEvent ? `
                    <span class="asset-history-actions">
                      <button type="button" class="button asset-history-edit" data-mobile-write data-history-action="runtime_state_edit" data-event-id="${escapeHtml(event.id)}">이력 수정</button>
                    </span>
                  ` : ""}
                </div>
                <p>${escapeHtml(content)}</p>
                <small>${escapeHtml(historySourceLabel(event))}${event.createdByName ? ` · ${escapeHtml(event.createdByName)}` : ""}${Number(event.runtimeHours) > 0 ? ` · 당시 ${escapeHtml(historyRuntimeLabel(event))}` : ""}</small>
              </div>
            </article>
          `;
        }).join("")
      : `<div class="empty-state compact">등록된 이력이 없습니다.</div>`;

    elements.historyDialog.showModal();
  }

  function renderCandidates() {
    if (shouldHideAutomaticData()) {
      elements.candidateCountBadge.hidden = true;
      elements.candidateEmpty.hidden = true;
      elements.candidateList.innerHTML = `
        <div class="candidate-rebuild-lock">
          <strong>V13 업무일지 이력 복구를 먼저 완료해 주세요.</strong>
          <span>기존 자동감지 후보는 재구성 완료 후 새 기준으로 다시 표시됩니다. 수동 등록 이력은 영향을 받지 않습니다.</span>
        </div>
      `;
      return;
    }

    const allCandidates = (state.data?.candidates || [])
      .filter(candidate => candidate.detectedType === "replacement");
    const candidates = allCandidates.filter(candidate => candidate.blowerType === state.activeType);

    elements.candidateCountBadge.hidden = allCandidates.length === 0;
    elements.candidateCountBadge.textContent = String(allCandidates.length);
    elements.candidateEmpty.hidden = candidates.length > 0;

    elements.candidateList.innerHTML = candidates
      .map(candidate => `
        <article class="candidate-card">
          <div class="candidate-asset">
            <strong>${escapeHtml(candidate.displayName || candidate.positionLabel)}</strong>
            <span>${escapeHtml(candidate.tagNumber)}</span>
          </div>
          <div class="candidate-source">
            <div class="candidate-meta">
              ${escapeHtml(formatDate(candidate.detectedDate))} · ${escapeHtml(candidate.sourceShift || "-")} · ${escapeHtml(candidate.sourceRole || "-")} · ${escapeHtml(candidate.sourceAuthor || "-")}
              · V-Belt 교체 감지
            </div>
            <p>${escapeHtml(candidate.sourceText)}</p>
          </div>
          <div class="candidate-actions">
            <button type="button" class="button primary" data-mobile-write data-candidate-action="confirm" data-id="${escapeHtml(candidate.id)}">확인/수정</button>
            <button type="button" class="button secondary" data-mobile-write data-candidate-action="exclude" data-id="${escapeHtml(candidate.id)}">제외</button>
          </div>
        </article>
      `)
      .join("");
  }

  function renderBackfillStatus(backfill = state.data?.backfill) {
    const notice = elements.historicalBackfillNotice;
    if (!notice) return;

    const isSuperAdmin = Boolean(state.data?.user?.isSuperAdmin);
    const recovery = state.data?.recoveryV12 || null;
    const recoveryStatus = String(recovery?.status || "pending");
    const recoveryComplete = recoveryStatus === "complete";
    const recoveryBlocked = recoveryStatus === "blocked";
    const recoveryStarted = Boolean(recovery?.hasRun) || !["", "pending"].includes(recoveryStatus);
    const staged = Number(recovery?.stagedEvents || 0);
    const scanned = Number(recovery?.scannedRows || 0);
    const showOverviewCallout = !recoveryComplete || state.backfillRunning;
    const sourceLabel = recovery?.sourceTable === "legacy_logs" ? "과거 업무일지" : "신규 업무일지";
    const cursor = Number(recovery?.cursorRowId || 0).toLocaleString("ko-KR");

    elements.historicalBackfillButton.hidden = !isSuperAdmin || isMobileMonitoringView();
    elements.overviewBackfillButton.hidden = !isSuperAdmin || isMobileMonitoringView();
    elements.overviewBackfillCallout.hidden = !showOverviewCallout;
    elements.overviewBackfillCallout.classList.toggle("is-catchup", false);

    if (showOverviewCallout) {
      elements.overviewBackfillTitle.textContent = recoveryBlocked
        ? "V13 안전 차단"
        : "업무일지 교체 이력 복구 V13";
      elements.overviewBackfillSummary.textContent = state.backfillRunning
        ? `업무일지 한 건 전체 문맥으로 설비를 판정하고 있습니다. 확정 ${staged.toLocaleString("ko-KR")}건 · 원문 ${scanned.toLocaleString("ko-KR")}건 확인 · ${sourceLabel} #${cursor}`
        : recoveryBlocked
          ? (recovery?.message || "자동 확정 가능한 교체이력이 없어 기존 저장값을 유지했습니다. 감사자료를 확인해 주세요.")
          : isSuperAdmin
            ? "TAG·설비명·호기·A/B/C 위치와 같은 업무일지 안의 앞뒤 문맥을 함께 읽어 실제 V-Belt 교체만 복구합니다. 고정 건수 목표는 사용하지 않습니다."
            : "최고관리자의 V13 업무일지 문맥 복구가 완료되면 검증된 교체주기가 표시됩니다.";

      const buttonLabel = state.backfillRunning
        ? "V13 검증·복구 중..."
        : recoveryBlocked
          ? "V13 감사자료 확인"
          : recoveryStarted
            ? "V13 이어서 복구"
            : "업무일지 이력 복구 V13";
      elements.overviewBackfillButton.textContent = buttonLabel;
      elements.historicalBackfillButton.textContent = buttonLabel;
    }

    notice.hidden = false;

    if (state.backfillRunning) {
      notice.dataset.state = "running";
      notice.textContent = `V13 문맥 복구 진행 중 · 확정 ${staged.toLocaleString("ko-KR")}건 · 원문 ${scanned.toLocaleString("ko-KR")}건 확인 · ${sourceLabel} #${cursor}`;
      return;
    }

    if (recoveryComplete) {
      notice.dataset.state = "complete";
      notice.textContent = `V13 업무일지 복구 완료 · 교체 이력 ${staged.toLocaleString("ko-KR")}건 반영`;
      return;
    }

    if (recoveryBlocked) {
      notice.dataset.state = "required";
      notice.textContent = `V13 안전 차단 · 확정 ${staged.toLocaleString("ko-KR")}건 · 기존 저장 이력 유지`;
      return;
    }

    if (recoveryStarted) {
      notice.dataset.state = "required";
      notice.textContent = `V13 문맥 복구 필요 · 확정 ${staged.toLocaleString("ko-KR")}건 · 원문 ${scanned.toLocaleString("ko-KR")}건 확인 · 이어서 실행 가능`;
      return;
    }

    notice.dataset.state = "required";
    notice.textContent = "V13 업무일지 문맥 복구 필요 · 아직 V13 검증을 실행하지 않음";
  }


  /* =======================================================
    [FBHE-VIBRATION-SHADOW-V1]
    OIS 진동값 조회·표시

    실제 기동·정지, 누적시간, V-Belt Cycle은 변경하지 않는다.
  ======================================================= */

  /* =======================================================
    [FBHE-OIS-RUNTIME-ANALYSIS-V2]
    기간 OIS 진동 → 기동/정지 구간 → 누적 운전시간 Shadow 분석
  ======================================================= */

  function maximumFbheVibrationDate() {
    return formatKstDateInput(currentServerDate());
  }

  function addFbheVibrationDays(value, days) {
    const text = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
    const parsed = new Date(`${text}T00:00:00+09:00`);
    if (Number.isNaN(parsed.getTime())) return "";
    parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
    return formatKstDateInput(parsed);
  }

  function countFbheVibrationDays(startDate, endDate) {
    const start = new Date(`${startDate}T00:00:00+09:00`);
    const end = new Date(`${endDate}T00:00:00+09:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
    return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  }

  function defaultFbheVibrationRange() {
    const endDate = maximumFbheVibrationDate();
    const replacementDates = (state.data?.assets || [])
      .filter(asset => asset.blowerType === "fbhe" && asset.lastReplacementAt)
      .map(asset => formatDate(asset.lastReplacementAt))
      .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value))
      .sort();
    const earliestReplacement = replacementDates[0] || "";
    const fallbackStart = addFbheVibrationDays(endDate, -29);
    const oneYearStart = addFbheVibrationDays(endDate, -364);
    const startDate = earliestReplacement && earliestReplacement >= oneYearStart
      ? earliestReplacement
      : (earliestReplacement ? oneYearStart : fallbackStart);

    return {
      startDate,
      endDate,
      preset: "cycle"
    };
  }

  function selectedFbheVibrationRange() {
    const startDate = String(elements.vibrationStartDate.value || "").trim();
    const endDate = String(elements.vibrationEndDate.value || "").trim();
    const dayCount = countFbheVibrationDays(startDate, endDate);
    return {
      startDate,
      endDate,
      dayCount,
      key: startDate && endDate ? `${startDate}~${endDate}` : ""
    };
  }

  function updateFbheVibrationPresetButtons() {
    document.querySelectorAll("[data-vibration-preset]").forEach(button => {
      button.classList.toggle("is-active", button.dataset.vibrationPreset === state.vibrationPreset);
    });
  }

  function applyFbheVibrationPreset(preset) {
    const endDate = maximumFbheVibrationDate();
    let startDate = "";

    if (preset === "cycle") {
      const range = defaultFbheVibrationRange();
      startDate = range.startDate;
    } else if (preset === "month") {
      startDate = `${endDate.slice(0, 7)}-01`;
    } else {
      const days = Number(preset);
      if (!Number.isFinite(days) || days < 1) return;
      startDate = addFbheVibrationDays(endDate, -(days - 1));
    }

    elements.vibrationStartDate.value = startDate;
    elements.vibrationEndDate.value = endDate;
    state.vibrationPreset = String(preset);
    state.vibrationReport = null;
    state.vibrationReportRangeKey = `${startDate}~${endDate}`;
    updateFbheVibrationPresetButtons();
    renderFbheVibrationShadow();
  }

  function canUseFbheVibrationShadow() {
    return Boolean(
      hasAuthenticatedWriteAccess() &&
      state.activeType === "fbhe" &&
      !isMobileMonitoringView() &&
      !isPublicMonitoringView()
    );
  }

  function fbheVibrationStateLabel(stateValue) {
    return ({
      running: "운전",
      stopped: "정지",
      anomaly: "전달 이상",
      unknown: "판정보류"
    })[stateValue] || "판정보류";
  }

  function fbheVibrationManualStateLabel(stateValue) {
    return ({
      running: "운전중",
      stopped: "정지",
      unknown: "이력 없음"
    })[stateValue] || "이력 없음";
  }

  function formatFbheVibrationValue(value) {
    if (value === null || value === undefined || value === "") return "-";
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return "-";
    return numberValue.toLocaleString("ko-KR", { maximumFractionDigits: 4 });
  }

  function formatFbheRuntimeHours(value) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return "-";
    if (numberValue >= 24) return formatDaysHours(numberValue);
    return `${Math.max(0, numberValue).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}시간`;
  }

  function formatFbheSignedHours(value) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return "-";
    const sign = numberValue > 0 ? "+" : numberValue < 0 ? "-" : "±";
    return `${sign}${Math.abs(numberValue).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}h`;
  }

  function formatFbheDateTimeShort(value) {
    if (!value) return "-";
    const text = formatKstDateTimeDisplay(value);
    return text === "-" ? "-" : text.replace(/^\d{4}-/, "");
  }

  function buildFbheVibrationQueueSummary(items = []) {
    const count = status => items.filter(item => item.status === status).length;
    const failedCount = count("failed") + count("expired");
    return {
      chunkCount: items.length,
      completeCount: count("complete"),
      pendingCount: count("pending"),
      processingCount: count("processing"),
      failedCount,
      missingCount: count("missing"),
      status: count("processing") > 0
        ? "processing"
        : count("pending") > 0
          ? "pending"
          : failedCount > 0
            ? "partial_failed"
            : items.length > 0 && count("complete") === items.length
              ? "complete"
              : "partial",
      items
    };
  }

  function renderFbheVibrationShadow() {
    const allowed = canUseFbheVibrationShadow();
    elements.vibrationShadowPanel.hidden = !allowed;
    if (!allowed) return;

    if (!elements.vibrationStartDate.value || !elements.vibrationEndDate.value) {
      const range = defaultFbheVibrationRange();
      elements.vibrationStartDate.value = range.startDate;
      elements.vibrationEndDate.value = range.endDate;
      state.vibrationPreset = range.preset;
    }

    updateFbheVibrationPresetButtons();
    const selected = selectedFbheVibrationRange();
    const report = state.vibrationReport;
    const reportMatchesRange = report && report.startDate === selected.startDate && report.endDate === selected.endDate;

    elements.vibrationQueryButton.disabled = state.vibrationPolling || state.busy;
    elements.vibrationRequeryButton.disabled = state.vibrationPolling || state.busy;
    /* [FBHE-OIS-RESUME-TIMEOUT-V4-R3] */
    elements.vibrationQueryButton.textContent =
      state.vibrationPolling
        ? (
            state.vibrationClientAnalysis
              ? "저장자료 분석 중..."
              : "OIS 수집 중..."
          )
        : "OIS 이어조회";
    elements.vibrationRequeryButton.textContent = "전체 재조회";

    if (!reportMatchesRange) {
      elements.vibrationHeadline.textContent = `현재상태·기동/정지·누적시간 분석 대기 · ${selected.dayCount || 0}일`;
      elements.vibrationStatus.dataset.state = "idle";
      elements.vibrationStatus.textContent = selected.dayCount > 366
        ? "한 번에 최대 1년(366일)까지 조회할 수 있습니다."
        : `${selected.startDate || "시작일"} ~ ${selected.endDate || "종료일"} 기간의 저장자료를 불러오거나 OIS에서 새로 조회할 수 있습니다.`;
      elements.vibrationMetrics.hidden = true;
      elements.vibrationMetrics.replaceChildren();
      elements.vibrationTableWrap.hidden = true;
      elements.vibrationBody.replaceChildren();
      elements.vibrationEmpty.hidden = false;
      return;
    }

    const queue = report.queue || {};
    const chunkCount = Number(queue.chunkCount || 0);
    const completeCount = Number(queue.completeCount || 0);
    const activeCount = Number(queue.pendingCount || 0) + Number(queue.processingCount || 0);
    const failedCount = Number(queue.failedCount || 0);

    if (activeCount > 0) {
      elements.vibrationHeadline.textContent = `OIS 기간 수집 중 · ${completeCount}/${chunkCount}구간 완료`;
      elements.vibrationStatus.dataset.state = "running";
      elements.vibrationStatus.textContent = Number(queue.processingCount || 0) > 0
        ? `회사 PC OIS Agent가 31일 단위 진동자료를 수집하고 있습니다. 완료 ${completeCount} · 처리 중 ${Number(queue.processingCount || 0)} · 대기 ${Number(queue.pendingCount || 0)}`
        : `OIS Agent 처리 대기 중입니다. 완료 ${completeCount} · 대기 ${Number(queue.pendingCount || 0)}`;
      elements.vibrationMetrics.hidden = true;
      elements.vibrationTableWrap.hidden = true;
      elements.vibrationEmpty.hidden = true;
      return;
    }

    const assets = Array.isArray(report.assets) ? report.assets : [];
    if (assets.length === 0) {
      elements.vibrationHeadline.textContent = failedCount > 0
        ? "OIS 기간조회 실패 · 자동 반영 없음"
        : "저장자료 없음 · 자동 반영 없음";
      elements.vibrationStatus.dataset.state = failedCount > 0 ? "error" : "idle";
      elements.vibrationStatus.textContent = failedCount > 0
        ? `${failedCount}개 구간 조회에 실패했습니다. OIS 이어조회를 실행하세요.`
        : "이 기간의 FBHE 진동 분석자료가 아직 없습니다.";
      elements.vibrationMetrics.hidden = true;
      elements.vibrationTableWrap.hidden = true;
      elements.vibrationEmpty.hidden = false;
      return;
    }

    const summary = report.summary || {};
    const averageCoveragePct = Number(summary.averageCoveragePct || 0);
    elements.vibrationHeadline.textContent = [
      `${selected.startDate} ~ ${selected.endDate}`,
      `${selected.dayCount}일`,
      `OIS 상태 ${Number(summary.shadowDecidedCount || 0)}/6대`,
      "자동 반영 없음"
    ].join(" · ");

    const warnings = [];
    if (failedCount > 0) warnings.push(`구간 실패 ${failedCount}개`);
    if (Number(summary.mismatchCount || 0) > 0) warnings.push(`카드상태 불일치 ${Number(summary.mismatchCount)}대`);
    if (Number(summary.anomalyCount || 0) > 0) warnings.push(`동력전달 이상 후보 ${Number(summary.anomalyCount)}건`);
    if (averageCoveragePct < 90) warnings.push(`평균 판정률 ${averageCoveragePct.toFixed(1)}%`);

    elements.vibrationStatus.dataset.state = warnings.length > 0 ? "warning" : "complete";
    elements.vibrationStatus.textContent = warnings.length > 0
      ? `${warnings.join(" · ")}입니다. OIS 계산값만 표시하며 실제 카드 상태와 누적시간은 변경하지 않았습니다.`
      : `시간별 진동으로 기동·정지 구간과 교체 후 누적 운전시간을 계산했습니다. 실제 카드 상태와 누적시간은 변경하지 않았습니다.`;

    const metrics = [
      ["OIS 구간", `${Number(summary.completeChunkCount || 0)}/${Number(summary.chunkCount || 0)}`],
      ["상태 판정", `${Number(summary.shadowDecidedCount || 0)}/6대`],
      ["평균 판정률", `${averageCoveragePct.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`],
      ["기동·정지 전환", `${Number(summary.transitionCount || 0)}건`]
    ];
    elements.vibrationMetrics.innerHTML = metrics.map(([label, value]) => `
      <div class="vibration-shadow-metric">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `).join("");
    elements.vibrationMetrics.hidden = false;

    const rows = assets.map(asset => {
      const runtime = asset.runtime || {};
      const oisState = runtime.oisState || asset.shadowState || "unknown";
      const stateClass = oisState === "running" ? "running" : oisState === "stopped" ? "stopped" : "unknown";
      const rangeCoverage = Number(runtime.rangeCoveragePct || 0);
      const cycleCoverage = Number(runtime.cycleCoveragePct || 0);
      const cycleRuntime = Number(runtime.cycleRuntimeHours);
      const registeredRuntime = Number(runtime.registeredCycleRuntimeHours);
      const runtimeDifference = Number(runtime.runtimeDifferenceHours);
      const hasCycleRuntime = Number.isFinite(cycleRuntime);
      const hasRegisteredRuntime = Number.isFinite(registeredRuntime);
      const latestSample = asset.latestSampleAt ? formatFbheDateTimeShort(asset.latestSampleAt) : "-";
      const cycleNote = !asset.lastReplacementAt
        ? "교체일 없음"
        : runtime.cycleRangeComplete === false
          ? "선택기간이 교체일보다 늦어 일부만 계산"
          : `판정률 ${cycleCoverage.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
      const differenceText = hasCycleRuntime && hasRegisteredRuntime
        ? `등록 ${formatFbheRuntimeHours(registeredRuntime)} · 차이 ${formatFbheSignedHours(runtimeDifference)}`
        : (hasRegisteredRuntime ? `등록 ${formatFbheRuntimeHours(registeredRuntime)}` : "등록 누적 없음");
      const rowClasses = [
        asset.comparison === "mismatch" ? "mismatch" : "",
        Number(asset.anomalyCount || 0) > 0 ? "anomaly" : ""
      ].filter(Boolean).join(" ");

      return `
        <tr class="${rowClasses}">
          <td>
            <strong>${escapeHtml(asset.displayName || asset.tagNumber)}</strong>
            <small>${escapeHtml(asset.tagNumber || "-")}</small>
          </td>
          <td>
            <span class="vibration-shadow-pill ${stateClass}">${escapeHtml(fbheVibrationStateLabel(oisState))}</span>
            <small>현재 카드 ${escapeHtml(fbheVibrationManualStateLabel(asset.currentCardState))}</small>
          </td>
          <td>
            <strong>${escapeHtml(formatFbheRuntimeHours(runtime.rangeRunningHours))}</strong>
            <small>판정률 ${rangeCoverage.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}% · 미판정 ${escapeHtml(formatFbheRuntimeHours(runtime.rangeUnknownHours))}</small>
          </td>
          <td>
            <strong>${escapeHtml(hasCycleRuntime ? formatFbheRuntimeHours(cycleRuntime) : "-")}</strong>
            <small>${escapeHtml(cycleNote)}</small>
            <small>${escapeHtml(differenceText)}</small>
          </td>
          <td>
            <small><b>기동</b> ${escapeHtml(formatFbheDateTimeShort(runtime.latestStartAt))}</small>
            <small><b>정지</b> ${escapeHtml(formatFbheDateTimeShort(runtime.latestStopAt))}</small>
          </td>
          <td>
            <strong>${Number(asset.successfulSensorCount || 0)}/4 TAG</strong>
            <small>${Number(asset.samplePointCount || 0).toLocaleString("ko-KR")}시간점 · 최신 ${escapeHtml(latestSample)}</small>
          </td>
        </tr>
      `;
    }).join("");

    elements.vibrationBody.innerHTML = rows;
    elements.vibrationTableWrap.hidden = rows.length === 0;
    elements.vibrationEmpty.hidden = rows.length > 0;
  }


  /* [FBHE-OIS-CHUNK-ANALYSIS-V5] */
  function buildFbheVibrationAnalysisChunks(startDate, endDate) {
    const chunks = [];
    let cursor = startDate;
    let guard = 0;

    while (
      cursor &&
      cursor <= endDate &&
      guard < 12
    ) {
      const candidateEnd =
        addFbheVibrationDays(
          cursor,
          30
        );
      const chunkEnd =
        candidateEnd &&
        candidateEnd < endDate
          ? candidateEnd
          : endDate;

      chunks.push({
        startDate: cursor,
        endDate: chunkEnd,
        dayCount:
          countFbheVibrationDays(
            cursor,
            chunkEnd
          )
      });

      cursor =
        addFbheVibrationDays(
          chunkEnd,
          1
        );
      guard += 1;
    }

    return chunks;
  }

  function finiteFbheReportNumber(value) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return null;
    }

    const numberValue =
      Number(value);

    return Number.isFinite(numberValue)
      ? numberValue
      : null;
  }

  function roundFbheReportNumber(
    value,
    digits = 3
  ) {
    const numberValue =
      finiteFbheReportNumber(value);

    if (numberValue === null) {
      return null;
    }

    const factor =
      10 ** Math.max(
        0,
        Number(digits) || 0
      );

    return (
      Math.round(
        numberValue *
        factor
      ) /
      factor
    );
  }

  function latestFbheReportDateTime(
    values
  ) {
    return (values || [])
      .filter(Boolean)
      .sort(
        (left, right) =>
          String(left).localeCompare(
            String(right)
          )
      )
      .at(-1) || "";
  }

  function mergeFbheRuntimeSegmentsClient(
    segments
  ) {
    const output = [];

    for (
      const segment of
      (segments || [])
        .filter(Boolean)
        .sort(
          (left, right) =>
            String(left.startAt || "")
              .localeCompare(
                String(right.startAt || "")
              )
        )
    ) {
      const state =
        String(segment.state || "");
      const startAt =
        String(segment.startAt || "");
      const endAt =
        String(segment.endAt || "");

      if (
        !state ||
        !startAt ||
        !endAt ||
        new Date(endAt) <=
          new Date(startAt)
      ) {
        continue;
      }

      const previous =
        output.at(-1);

      if (
        previous &&
        previous.state === state &&
        previous.endAt === startAt
      ) {
        previous.endAt = endAt;
        previous.hours =
          roundFbheReportNumber(
            (
              new Date(endAt).getTime() -
              new Date(
                previous.startAt
              ).getTime()
            ) /
            3600000,
            3
          );
        continue;
      }

      output.push({
        state,
        startAt,
        endAt,
        hours:
          roundFbheReportNumber(
            finiteFbheReportNumber(
              segment.hours
            ) ??
            (
              (
                new Date(
                  endAt
                ).getTime() -
                new Date(
                  startAt
                ).getTime()
              ) /
              3600000
            ),
            3
          )
      });
    }

    return output;
  }

  function firstFbheDefiniteRuntimeState(
    segments
  ) {
    const segment =
      (segments || []).find(
        item =>
          ["running", "stopped"]
            .includes(
              String(
                item?.state ||
                ""
              )
            )
      );

    return segment
      ? {
          state:
            String(segment.state),
          at:
            String(
              segment.startAt ||
              ""
            )
        }
      : null;
  }

  function lastFbheDefiniteRuntimeState(
    segments
  ) {
    const safe =
      [...(segments || [])]
        .reverse();

    const segment =
      safe.find(
        item =>
          ["running", "stopped"]
            .includes(
              String(
                item?.state ||
                ""
              )
            )
      );

    return segment
      ? {
          state:
            String(segment.state),
          at:
            String(
              segment.endAt ||
              segment.startAt ||
              ""
            )
        }
      : null;
  }

  function aggregateFbheVibrationChunkReports(
    reports,
    range,
    analysisErrors = []
  ) {
    const orderedReports =
      (reports || [])
        .filter(
          report =>
            report &&
            report.ok !== false
        )
        .sort(
          (left, right) =>
            String(
              left.startDate ||
              ""
            ).localeCompare(
              String(
                right.startDate ||
                ""
              )
            )
        );

    const queueItems = [];

    for (
      const report of
      orderedReports
    ) {
      const items =
        Array.isArray(
          report?.queue?.items
        )
          ? report.queue.items
          : [];

      if (items.length > 0) {
        queueItems.push(
          ...items
        );
      }
    }

    for (
      const failed of
      analysisErrors || []
    ) {
      queueItems.push({
        id: "",
        targetDate:
          `${failed.startDate || ""}~${failed.endDate || ""}`,
        status:
          "failed",
        requestedAt: "",
        startedAt: "",
        completedAt: "",
        errorMessage:
          failed.message ||
          "저장자료 구간 분석 실패",
        expiresAt: "",
        updatedAt: ""
      });
    }

    const queue =
      buildFbheVibrationQueueSummary(
        queueItems
      );

    const selectedChunks =
      buildFbheVibrationAnalysisChunks(
        range.startDate,
        range.endDate
      );

    queue.chunkCount =
      selectedChunks.length;

    const assetMap =
      new Map();

    for (
      const report of
      orderedReports
    ) {
      for (
        const asset of
        Array.isArray(
          report.assets
        )
          ? report.assets
          : []
      ) {
        const tagNumber =
          String(
            asset?.tagNumber ||
            ""
          ).toUpperCase();

        if (!tagNumber) {
          continue;
        }

        if (
          !assetMap.has(
            tagNumber
          )
        ) {
          assetMap.set(
            tagNumber,
            []
          );
        }

        assetMap
          .get(tagNumber)
          .push({
            report,
            asset
          });
      }
    }

    const assets = [];

    for (
      const [
        tagNumber,
        parts
      ] of assetMap
    ) {
      const orderedParts =
        [...parts].sort(
          (left, right) =>
            String(
              left.report.startDate ||
              ""
            ).localeCompare(
              String(
                right.report.startDate ||
                ""
              )
            )
        );

      const latestPart =
        orderedParts.at(-1);
      const latestAsset =
        latestPart?.asset || {};
      const runtimes =
        orderedParts
          .map(
            part =>
              part.asset?.runtime ||
              null
          )
          .filter(Boolean);

      const sumRuntime =
        field =>
          roundFbheReportNumber(
            runtimes.reduce(
              (sum, runtime) => {
                const value =
                  finiteFbheReportNumber(
                    runtime?.[field]
                  );

                return (
                  sum +
                  (
                    value === null
                      ? 0
                      : value
                  )
                );
              },
              0
            ),
            3
          ) || 0;

      const rangeRunningHours =
        sumRuntime(
          "rangeRunningHours"
        );
      const rangeStoppedHours =
        sumRuntime(
          "rangeStoppedHours"
        );
      const rangeAnomalyHours =
        sumRuntime(
          "rangeAnomalyHours"
        );
      const rangeUnknownHours =
        sumRuntime(
          "rangeUnknownHours"
        );
      const rangeTotalHours =
        sumRuntime(
          "rangeTotalHours"
        );

      const classifiedHours =
        rangeRunningHours +
        rangeStoppedHours;

      const rangeCoveragePct =
        rangeTotalHours > 0
          ? roundFbheReportNumber(
              (
                classifiedHours /
                rangeTotalHours
              ) *
              100,
              1
            ) || 0
          : 0;

      const cycleWindowHours =
        sumRuntime(
          "cycleWindowHours"
        );

      const cycleRuntimeValues =
        runtimes
          .map(
            runtime =>
              finiteFbheReportNumber(
                runtime
                  ?.cycleRuntimeHours
              )
          )
          .filter(
            value =>
              value !== null
          );

      const cycleCoverageValues =
        runtimes
          .map(
            runtime =>
              finiteFbheReportNumber(
                runtime
                  ?.cycleCoverageHours
              )
          )
          .filter(
            value =>
              value !== null
          );

      const cycleRuntimeHours =
        cycleRuntimeValues.length > 0
          ? roundFbheReportNumber(
              cycleRuntimeValues.reduce(
                (sum, value) =>
                  sum + value,
                0
              ),
              3
            )
          : null;

      const cycleCoverageHours =
        cycleCoverageValues.length > 0
          ? roundFbheReportNumber(
              cycleCoverageValues.reduce(
                (sum, value) =>
                  sum + value,
                0
              ),
              3
            )
          : null;

      const cycleCoveragePct =
        cycleWindowHours > 0 &&
        cycleCoverageHours !== null
          ? roundFbheReportNumber(
              (
                cycleCoverageHours /
                cycleWindowHours
              ) *
              100,
              1
            ) || 0
          : 0;

      const cycleStartAt =
        runtimes
          .map(
            runtime =>
              String(
                runtime
                  ?.cycleStartAt ||
                ""
              )
          )
          .find(Boolean) || "";

      const rangeStartAt =
        new Date(
          `${range.startDate}T00:00:00+09:00`
        );

      const cycleStartDate =
        new Date(
          cycleStartAt
        );

      const cycleRangeComplete =
        Boolean(
          cycleStartAt
        ) &&
        !Number.isNaN(
          rangeStartAt.getTime()
        ) &&
        !Number.isNaN(
          cycleStartDate.getTime()
        )
          ? cycleStartDate >=
            rangeStartAt
          : false;

      const registeredRuntime =
        [...runtimes]
          .reverse()
          .map(
            runtime =>
              finiteFbheReportNumber(
                runtime
                  ?.registeredCycleRuntimeHours
              )
          )
          .find(
            value =>
              value !== null
          );

      const runtimeDifferenceHours =
        cycleRuntimeHours !== null &&
        registeredRuntime !==
          undefined &&
        registeredRuntime !== null
          ? roundFbheReportNumber(
              cycleRuntimeHours -
              registeredRuntime,
              3
            )
          : null;

      const combinedSegments =
        mergeFbheRuntimeSegmentsClient(
          runtimes.flatMap(
            runtime =>
              Array.isArray(
                runtime?.segments
              )
                ? runtime.segments
                : []
          )
        );

      let transitionCount =
        runtimes.reduce(
          (sum, runtime) =>
            sum +
            Number(
              runtime
                ?.transitionCount ||
              0
            ),
          0
        );

      const boundaryTransitions = [];
      let previousDefinite = null;

      for (
        const part of
        orderedParts
      ) {
        const runtime =
          part.asset?.runtime ||
          {};
        const segments =
          Array.isArray(
            runtime.segments
          )
            ? runtime.segments
            : [];

        const first =
          firstFbheDefiniteRuntimeState(
            segments
          );
        const last =
          lastFbheDefiniteRuntimeState(
            segments
          );

        if (
          previousDefinite &&
          first &&
          previousDefinite.state !==
            first.state
        ) {
          transitionCount += 1;

          boundaryTransitions.push({
            type:
              first.state ===
              "running"
                ? "start"
                : "stop",
            estimatedAt:
              first.at ||
              part.report
                ?.analysis
                ?.startAt ||
              "",
            method:
              "chunk_boundary",
            confidence:
              "estimated"
          });
        }

        if (last) {
          previousDefinite =
            last;
        }
      }

      const latestStartAt =
        latestFbheReportDateTime(
          [
            ...runtimes.map(
              runtime =>
                runtime
                  ?.latestStartAt
            ),
            ...boundaryTransitions
              .filter(
                item =>
                  item.type ===
                  "start"
              )
              .map(
                item =>
                  item.estimatedAt
              )
          ]
        );

      const latestStopAt =
        latestFbheReportDateTime(
          [
            ...runtimes.map(
              runtime =>
                runtime
                  ?.latestStopAt
            ),
            ...boundaryTransitions
              .filter(
                item =>
                  item.type ===
                  "stop"
              )
              .map(
                item =>
                  item.estimatedAt
              )
          ]
        );

      const combinedTransitions =
        [
          ...orderedParts.flatMap(
            part =>
              Array.isArray(
                part.asset
                  ?.transitions
              )
                ? part.asset
                    .transitions
                : []
          ),
          ...boundaryTransitions
        ]
          .filter(
            item =>
              item &&
              item.type &&
              item.estimatedAt
          )
          .filter(
            (
              item,
              index,
              array
            ) =>
              array.findIndex(
                candidate =>
                  candidate.type ===
                    item.type &&
                  candidate
                    .estimatedAt ===
                    item.estimatedAt
              ) === index
          )
          .sort(
            (left, right) =>
              String(
                left.estimatedAt
              ).localeCompare(
                String(
                  right.estimatedAt
                )
              )
          );

      const latestSampleAt =
        latestFbheReportDateTime(
          orderedParts.map(
            part =>
              part.asset
                ?.latestSampleAt
          )
        );

      const latestSamplePart =
        [...orderedParts]
          .reverse()
          .find(
            part =>
              part.asset
                ?.latestSampleAt ===
              latestSampleAt
          ) ||
        latestPart;

      const latestRuntime =
        latestPart?.asset
          ?.runtime || {};

      assets.push({
        ...latestAsset,
        tagNumber,
        lastReplacementAt:
          latestAsset
            .lastReplacementAt ||
          cycleStartAt,
        successfulSensorCount:
          Math.max(
            0,
            ...orderedParts.map(
              part =>
                Number(
                  part.asset
                    ?.successfulSensorCount ||
                  0
                )
            )
          ),
        failedSensorCount:
          Number(
            latestAsset
              ?.failedSensorCount ||
            0
          ),
        failedSensors:
          Array.isArray(
            latestAsset
              ?.failedSensors
          )
            ? latestAsset
                .failedSensors
            : [],
        samplePointCount:
          orderedParts.reduce(
            (sum, part) =>
              sum +
              Number(
                part.asset
                  ?.samplePointCount ||
                0
              ),
            0
          ),
        latestSampleAt,
        latest:
          latestSamplePart
            ?.asset
            ?.latest ||
          latestAsset.latest ||
          null,
        cluster:
          latestAsset.cluster ||
          null,
        runtime: {
          ...latestRuntime,
          rangeRunningHours,
          rangeStoppedHours,
          rangeAnomalyHours,
          rangeUnknownHours,
          rangeCoveragePct,
          rangeTotalHours,
          oisState:
            latestRuntime
              ?.oisState ||
            latestAsset
              ?.shadowState ||
            "unknown",
          latestStartAt,
          latestStopAt,
          transitionCount,
          segments:
            combinedSegments
              .slice(-500),
          cycleStartAt,
          cycleWindowStartAt:
            runtimes
              .map(
                runtime =>
                  String(
                    runtime
                      ?.cycleWindowStartAt ||
                    ""
                  )
              )
              .find(Boolean) ||
            "",
          cycleWindowHours,
          cycleRuntimeHours,
          cycleCoverageHours,
          cycleCoveragePct,
          cycleRangeComplete,
          registeredCycleRuntimeHours:
            registeredRuntime ===
              undefined
              ? null
              : registeredRuntime,
          runtimeDifferenceHours
        },
        transitions:
          combinedTransitions
            .slice(-1000),
        unrecordedTransitionCount:
          orderedParts.reduce(
            (sum, part) =>
              sum +
              Number(
                part.asset
                  ?.unrecordedTransitionCount ||
                0
              ),
            0
          ),
        anomalyCount:
          orderedParts.reduce(
            (sum, part) =>
              sum +
              Number(
                part.asset
                  ?.anomalyCount ||
                0
              ),
            0
          )
      });
    }

    assets.sort(
      (left, right) => {
        const unitOrder =
          String(
            left.unitNo ||
            ""
          ).localeCompare(
            String(
              right.unitNo ||
              ""
            )
          );

        if (unitOrder !== 0) {
          return unitOrder;
        }

        return String(
          left.positionLabel ||
          left.tagNumber ||
          ""
        ).localeCompare(
          String(
            right.positionLabel ||
            right.tagNumber ||
            ""
          )
        );
      }
    );

    const coverageValues =
      assets
        .map(
          asset =>
            finiteFbheReportNumber(
              asset.runtime
                ?.rangeCoveragePct
            )
        )
        .filter(
          value =>
            value !== null
        );

    const sourceReports =
      orderedReports
        .map(
          report =>
            report.source ||
            null
        )
        .filter(Boolean);

    const summary = {
      assetCount:
        assets.length,
      shadowDecidedCount:
        assets.filter(
          asset =>
            (
              asset.runtime
                ?.oisState ||
              asset.shadowState ||
              "unknown"
            ) !== "unknown"
        ).length,
      matchCount:
        assets.filter(
          asset =>
            asset.comparison ===
            "match"
        ).length,
      mismatchCount:
        assets.filter(
          asset =>
            asset.comparison ===
            "mismatch"
        ).length,
      unknownCount:
        assets.filter(
          asset =>
            (
              asset.runtime
                ?.oisState ||
              asset.shadowState ||
              "unknown"
            ) === "unknown"
        ).length,
      transitionCount:
        assets.reduce(
          (sum, asset) =>
            sum +
            Number(
              asset.runtime
                ?.transitionCount ||
              0
            ),
          0
        ),
      unrecordedTransitionCount:
        assets.reduce(
          (sum, asset) =>
            sum +
            Number(
              asset
                .unrecordedTransitionCount ||
              0
            ),
          0
        ),
      anomalyCount:
        assets.reduce(
          (sum, asset) =>
            sum +
            Number(
              asset.anomalyCount ||
              0
            ),
          0
        ),
      successfulSensorChunkCount:
        sourceReports.reduce(
          (sum, source) =>
            sum +
            Number(
              source
                ?.successfulSensorChunkCount ||
              0
            ),
          0
        ),
      failedSensorChunkCount:
        sourceReports.reduce(
          (sum, source) =>
            sum +
            Number(
              source
                ?.failedSensorChunkCount ||
              0
            ),
          0
        ),
      averageCoveragePct:
        coverageValues.length > 0
          ? roundFbheReportNumber(
              coverageValues.reduce(
                (sum, value) =>
                  sum + value,
                0
              ) /
              coverageValues.length,
              1
            ) || 0
          : 0,
      completeChunkCount:
        Number(
          queue.completeCount ||
          0
        ),
      chunkCount:
        selectedChunks.length,
      analyzedChunkCount:
        orderedReports.length,
      analysisFailedChunkCount:
        analysisErrors.length
    };

    return {
      ok: true,
      startDate:
        range.startDate,
      endDate:
        range.endDate,
      dayCount:
        range.dayCount,
      queue,
      automaticApply: false,
      actualStateChanged: false,
      runtimeChanged: false,
      cycleChanged: false,
      source: {
        source:
          "OIS TAG Log Direct API · 31일 구간별 분석",
        collectedAt:
          latestFbheReportDateTime(
            sourceReports.map(
              source =>
                source
                  ?.collectedAt
            )
          ),
        outputIntervalHours: 1,
        requestedSensorCountPerChunk:
          24,
        successfulSensorChunkCount:
          summary
            .successfulSensorChunkCount,
        failedSensorChunkCount:
          summary
            .failedSensorChunkCount
      },
      analysis: {
        startAt:
          orderedReports[0]
            ?.analysis
            ?.startAt ||
          "",
        endAt:
          orderedReports.at(-1)
            ?.analysis
            ?.endAt ||
          "",
        readOnly: true,
        runtimeUnit: "hour",
        transitionEstimate:
          "hourly_midpoint",
        mode:
          "client_chunk_merge",
        analyzedChunkCount:
          orderedReports.length,
        failedChunkCount:
          analysisErrors.length
      },
      assets,
      summary
    };
  }


/* [FBHE-OIS-SAVED-SLICE-ANALYSIS-V6] */
  function buildFbheSavedAnalysisSlices(
    startDate,
    endDate,
    maximumDays = 7
  ) {
    const output = [];
    let cursor =
      startDate;
    let guard = 0;

    const safeMaximumDays =
      Math.max(
        1,
        Math.min(
          7,
          Number(
            maximumDays
          ) || 7
        )
      );

    while (
      cursor &&
      cursor <= endDate &&
      guard < 64
    ) {
      const candidateEnd =
        addFbheVibrationDays(
          cursor,
          safeMaximumDays - 1
        );

      const sliceEnd =
        candidateEnd &&
        candidateEnd < endDate
          ? candidateEnd
          : endDate;

      output.push({
        startDate:
          cursor,
        endDate:
          sliceEnd,
        dayCount:
          countFbheVibrationDays(
            cursor,
            sliceEnd
          )
      });

      cursor =
        addFbheVibrationDays(
          sliceEnd,
          1
        );

      guard += 1;
    }

    return output;
  }

  function splitFbheSavedAnalysisSlice(
    slice
  ) {
    const dayCount =
      countFbheVibrationDays(
        slice.startDate,
        slice.endDate
      );

    if (dayCount <= 1) {
      return [
        slice
      ];
    }

    const leftDays =
      Math.max(
        1,
        Math.floor(
          dayCount / 2
        )
      );

    const leftEnd =
      addFbheVibrationDays(
        slice.startDate,
        leftDays - 1
      );

    const rightStart =
      addFbheVibrationDays(
        leftEnd,
        1
      );

    return [
      {
        startDate:
          slice.startDate,
        endDate:
          leftEnd,
        dayCount:
          countFbheVibrationDays(
            slice.startDate,
            leftEnd
          )
      },
      {
        startDate:
          rightStart,
        endDate:
          slice.endDate,
        dayCount:
          countFbheVibrationDays(
            rightStart,
            slice.endDate
          )
      }
    ];
  }

  async function requestFbheSavedSliceAnalysis(
    sourceChunk,
    slice
  ) {
    const waits =
      [0, 700, 1800];

    let lastError =
      null;

    for (
      let attempt = 0;
      attempt < waits.length;
      attempt += 1
    ) {
      if (
        waits[attempt] > 0
      ) {
        await waitForMilliseconds(
          waits[attempt]
        );
      }

      try {
        const report =
          await apiRequest({
            url:
              API_URL +
              "?action=vibration_shadow" +
              "&startDate=" +
              encodeURIComponent(
                slice.startDate
              ) +
              "&endDate=" +
              encodeURIComponent(
                slice.endDate
              ) +
              "&sourceTargetDate=" +
              encodeURIComponent(
                sourceChunk.targetDate
              ),
            timeoutMs:
              20000
          });

        if (
          Number(
            report
              ?.queue
              ?.completeCount ||
            0
          ) < 1
        ) {
          const missingError =
            new Error(
              "저장된 OIS 원본 구간(" +
              sourceChunk.startDate +
              " ~ " +
              sourceChunk.endDate +
              ")을 찾지 못했습니다."
            );

          missingError.code =
            "FBHE_SAVED_SOURCE_MISSING";
          missingError.retryable =
            false;

          throw missingError;
        }

        return report;
      } catch (error) {
        lastError =
          error;

        const retryable =
          error?.retryable ===
            true ||
          [0, 429, 502, 503, 504]
            .includes(
              Number(
                error?.status
              )
            );

        if (
          !retryable ||
          attempt >=
            waits.length - 1
        ) {
          throw error;
        }
      }
    }

    throw (
      lastError ||
      new Error(
        "FBHE 저장자료 세부 분석에 실패했습니다."
      )
    );
  }

  async function analyzeFbheSavedSourceChunk(
    sourceChunk,
    sourceIndex,
    sourceCount
  ) {
    const pending =
      buildFbheSavedAnalysisSlices(
        sourceChunk.startDate,
        sourceChunk.endDate,
        7
      );

    const reports = [];
    const errors = [];

    let index = 0;

    while (
      index < pending.length
    ) {
      const slice =
        pending[index];

      elements.vibrationHeadline
        .textContent =
          "저장자료 세부 분석 중 · " +
          (sourceIndex + 1) +
          "/" +
          sourceCount +
          " · " +
          (index + 1) +
          "/" +
          pending.length;

      elements.vibrationStatus
        .dataset.state =
          "running";

      elements.vibrationStatus
        .textContent =
          "OIS 재조회 없이 저장된 " +
          sourceChunk.startDate +
          " ~ " +
          sourceChunk.endDate +
          " 원본에서 " +
          slice.startDate +
          " ~ " +
          slice.endDate +
          " 구간을 분석하고 있습니다.";

      if (
        elements
          .vibrationQueryButton
      ) {
        elements
          .vibrationQueryButton
          .textContent =
            "저장자료 분석 중...";
      }

      try {
        const report =
          await requestFbheSavedSliceAnalysis(
            sourceChunk,
            slice
          );

        reports.push(
          report
        );

        index += 1;
      } catch (error) {
        const retryable =
          error?.retryable ===
            true ||
          [0, 429, 502, 503, 504]
            .includes(
              Number(
                error?.status
              )
            );

        if (
          retryable &&
          slice.dayCount > 1
        ) {
          const smaller =
            splitFbheSavedAnalysisSlice(
              slice
            );

          pending.splice(
            index,
            1,
            ...smaller
          );

          continue;
        }

        errors.push({
          sourceTargetDate:
            sourceChunk.targetDate,
          sourceStartDate:
            sourceChunk.startDate,
          sourceEndDate:
            sourceChunk.endDate,
          ...slice,
          message:
            error?.message ||
            "저장자료 세부 분석 실패"
        });

        index += 1;
      }
    }

    return {
      reports,
      errors
    };
  }

  async function requestFbheSavedChunkAnalysis(
    chunk
  ) {
    return await requestFbheSavedSliceAnalysis(
      {
        ...chunk,
        targetDate:
          chunk.targetDate ||
          (
            chunk.startDate +
            "~" +
            chunk.endDate
          )
      },
      chunk
    );
  }



  /* [FBHE-OIS-BROWSER-RAW-ANALYSIS-V7] */
  const FBHE_BROWSER_SENSOR_ROLES_V7 =
    Object.freeze([
      "blower_de",
      "blower_nde",
      "motor_de",
      "motor_nde"
    ]);

  const FBHE_BROWSER_RUN_MIN_V7 =
    1.0;

  const FBHE_BROWSER_STOP_MAX_V7 =
    0.5;

  const FBHE_BROWSER_RUNTIME_GAP_MS_V7 =
    90 * 60 * 1000;

  function finiteFbheBrowserNumberV7(
    value
  ) {
    if (
      value === null ||
      value === undefined ||
      String(value).trim() === ""
    ) {
      return null;
    }

    const numberValue =
      Number(value);

    return Number.isFinite(
      numberValue
    )
      ? Math.abs(
          numberValue
        )
      : null;
  }

  function roundFbheBrowserNumberV7(
    value,
    digits = 3
  ) {
    const numberValue =
      finiteFbheBrowserNumberV7(
        value
      );

    if (
      numberValue === null
    ) {
      return null;
    }

    const factor =
      10 **
      Math.max(
        0,
        Number(digits) || 0
      );

    return (
      Math.round(
        numberValue *
        factor
      ) /
      factor
    );
  }

  function medianFbheBrowserV7(
    values
  ) {
    const numbers =
      (values || [])
        .map(
          finiteFbheBrowserNumberV7
        )
        .filter(
          value =>
            value !== null
        )
        .sort(
          (left, right) =>
            left - right
        );

    if (
      numbers.length === 0
    ) {
      return null;
    }

    const middle =
      Math.floor(
        numbers.length / 2
      );

    return (
      numbers.length % 2 === 1
        ? numbers[middle]
        : (
            numbers[
              middle - 1
            ] +
            numbers[middle]
          ) /
          2
    );
  }

  function normalizeFbheBrowserDateTimeV7(
    value
  ) {
    const parsed =
      new Date(
        value || 0
      );

    return Number.isNaN(
      parsed.getTime()
    )
      ? ""
      : parsed.toISOString();
  }

  function buildFbheBrowserBoundsV7(
    startDate,
    endDate
  ) {
    const startAt =
      new Date(
        `${startDate}T00:00:00+09:00`
      );

    const nextDate =
      addFbheVibrationDays(
        endDate,
        1
      );

    const endExclusive =
      new Date(
        `${nextDate}T00:00:00+09:00`
      );

    const now =
      currentServerDate();

    const endAt =
      endExclusive > now
        ? now
        : endExclusive;

    return {
      startAt,
      endAt
    };
  }

  function normalizeFbheBrowserSensorV7(
    sensor,
    bounds
  ) {
    const role =
      String(
        sensor?.role ||
        ""
      )
        .trim()
        .toLowerCase();

    if (
      !FBHE_BROWSER_SENSOR_ROLES_V7
        .includes(
          role
        )
    ) {
      return null;
    }

    const sampleMap =
      new Map();

    for (
      const sample of
      Array.isArray(
        sensor?.samples
      )
        ? sensor.samples
        : []
    ) {
      const sampledAt =
        normalizeFbheBrowserDateTimeV7(
          sample?.sampledAt ||
          sample?.sampled_at
        );

      const value =
        finiteFbheBrowserNumberV7(
          sample?.value
        );

      if (
        !sampledAt ||
        value === null
      ) {
        continue;
      }

      const sampleTime =
        new Date(
          sampledAt
        ).getTime();

      if (
        bounds &&
        (
          sampleTime <
            bounds.startAt
              .getTime() ||
          sampleTime >
            bounds.endAt
              .getTime()
        )
      ) {
        continue;
      }

      sampleMap.set(
        sampledAt,
        {
          sampledAt,
          value
        }
      );
    }

    const samples =
      [...sampleMap.values()]
        .sort(
          (left, right) =>
            left.sampledAt
              .localeCompare(
                right.sampledAt
              )
        );

    return {
      role,
      label:
        String(
          sensor?.label ||
          role
        ),
      tag:
        String(
          sensor?.tag ||
          ""
        ),
      itemName:
        String(
          sensor?.itemName ||
          sensor?.item_name ||
          ""
        ),
      unit:
        String(
          sensor?.unit ||
          ""
        ),
      samples,
      sampleCount:
        samples.length,
      error:
        String(
          sensor?.error ||
          ""
        )
    };
  }

  function buildFbheBrowserPointsV7(
    rawAsset,
    bounds
  ) {
    const sensors =
      (
        Array.isArray(
          rawAsset?.sensors
        )
          ? rawAsset.sensors
          : []
      )
        .map(
          sensor =>
            normalizeFbheBrowserSensorV7(
              sensor,
              bounds
            )
        )
        .filter(Boolean);

    const sampleMaps =
      new Map(
        sensors.map(
          sensor => [
            sensor.role,
            new Map(
              sensor.samples.map(
                sample => [
                  sample.sampledAt,
                  sample.value
                ]
              )
            )
          ]
        )
      );

    const sampledAtSet =
      new Set();

    for (
      const sensor of sensors
    ) {
      for (
        const sample of
        sensor.samples
      ) {
        sampledAtSet.add(
          sample.sampledAt
        );
      }
    }

    const points =
      [...sampledAtSet]
        .sort()
        .map(
          sampledAt => {
            const values =
              Object.fromEntries(
                FBHE_BROWSER_SENSOR_ROLES_V7
                  .map(
                    role => [
                      role,
                      sampleMaps
                        .get(role)
                        ?.get(
                          sampledAt
                        ) ??
                        null
                    ]
                  )
              );

            const blowerValues =
              [
                values.blower_de,
                values.blower_nde
              ]
                .filter(
                  value =>
                    value !== null
                );

            const motorValues =
              [
                values.motor_de,
                values.motor_nde
              ]
                .filter(
                  value =>
                    value !== null
                );

            const allValues =
              [
                ...blowerValues,
                ...motorValues
              ];

            const blowerIndex =
              medianFbheBrowserV7(
                blowerValues
              );

            const motorIndex =
              medianFbheBrowserV7(
                motorValues
              );

            const combinedIndex =
              blowerIndex !== null &&
              motorIndex !== null
                ? Math.sqrt(
                    Math.max(
                      0,
                      blowerIndex *
                      motorIndex
                    )
                  )
                : medianFbheBrowserV7(
                    allValues
                  );

            return {
              sampledAt,
              values,
              validSensorCount:
                allValues.length,
              blowerIndex,
              motorIndex,
              combinedIndex
            };
          }
        );

    return {
      sensors,
      points
    };
  }

  function findFbheBrowserClusterV7(
    points
  ) {
    const values =
      (points || [])
        .map(
          point =>
            finiteFbheBrowserNumberV7(
              point?.combinedIndex
            )
        )
        .filter(
          value =>
            value !== null
        )
        .sort(
          (left, right) =>
            left - right
        );

    if (
      values.length < 8
    ) {
      return null;
    }

    const clusterSize =
      Math.max(
        3,
        Math.floor(
          values.length *
          0.25
        )
      );

    const lowerValues =
      values.slice(
        0,
        clusterSize
      );

    const upperValues =
      values.slice(
        -clusterSize
      );

    const lowerMedian =
      medianFbheBrowserV7(
        lowerValues
      );

    const upperMedian =
      medianFbheBrowserV7(
        upperValues
      );

    if (
      lowerMedian === null ||
      upperMedian === null ||
      upperMedian <=
        lowerMedian
    ) {
      return null;
    }

    const separationRatio =
      lowerMedian <= 1e-9
        ? (
            upperMedian >
            1e-9
              ? Number.POSITIVE_INFINITY
              : 1
          )
        : (
            upperMedian /
            lowerMedian
          );

    if (
      separationRatio < 2.5
    ) {
      return null;
    }

    const threshold =
      lowerMedian <= 1e-9
        ? upperMedian *
          0.25
        : Math.sqrt(
            lowerMedian *
            upperMedian
          );

    return {
      threshold,
      lowerMedian,
      upperMedian,
      separationRatio,
      lowerCount:
        lowerValues.length,
      upperCount:
        upperValues.length
    };
  }

  function absoluteFbheBrowserClassV7(
    point
  ) {
    if (
      !point ||
      point.blowerIndex === null ||
      point.motorIndex === null
    ) {
      return "unknown";
    }

    if (
      point.motorIndex >=
        FBHE_BROWSER_RUN_MIN_V7 &&
      point.blowerIndex <=
        FBHE_BROWSER_STOP_MAX_V7
    ) {
      return "drive_anomaly";
    }

    if (
      point.blowerIndex >=
        FBHE_BROWSER_RUN_MIN_V7 &&
      point.motorIndex >=
        FBHE_BROWSER_RUN_MIN_V7
    ) {
      return "high";
    }

    if (
      point.blowerIndex <=
        FBHE_BROWSER_STOP_MAX_V7 &&
      point.motorIndex <=
        FBHE_BROWSER_STOP_MAX_V7
    ) {
      return "low";
    }

    return "unknown";
  }

  function classifyFbheBrowserPointV7(
    point,
    cluster
  ) {
    const absoluteClass =
      absoluteFbheBrowserClassV7(
        point
      );

    if (
      absoluteClass !==
      "unknown"
    ) {
      return absoluteClass;
    }

    if (
      !point ||
      point.blowerIndex === null ||
      point.motorIndex === null ||
      !cluster ||
      point.combinedIndex === null
    ) {
      return "unknown";
    }

    if (
      point.motorIndex >
        cluster.threshold &&
      point.blowerIndex <=
        cluster.threshold &&
      point.motorIndex >=
        Math.max(
          point.blowerIndex * 3,
          cluster.threshold
        )
    ) {
      return "drive_anomaly";
    }

    return (
      point.combinedIndex <=
      cluster.threshold
        ? "low"
        : "high"
    );
  }

  function runtimeFbheBrowserStateV7(
    point,
    cluster
  ) {
    if (!point) {
      return "unknown";
    }

    const validValues =
      Object.values(
        point.values ||
        {}
      )
        .filter(
          value =>
            value !== null &&
            Number.isFinite(
              Number(value)
            )
        );

    if (
      point.validSensorCount >= 3 &&
      validValues.length >= 3 &&
      validValues.every(
        value =>
          Math.abs(
            Number(value)
          ) <= 1e-9
      )
    ) {
      return "stopped";
    }

    const classified =
      classifyFbheBrowserPointV7(
        point,
        cluster
      );

    if (
      classified === "high"
    ) {
      return "running";
    }

    if (
      classified === "low"
    ) {
      return "stopped";
    }

    if (
      classified ===
      "drive_anomaly"
    ) {
      return "anomaly";
    }

    return "unknown";
  }

  function stabilizeFbheBrowserStatesV7(
    points,
    cluster
  ) {
    const states =
      (points || []).map(
        point =>
          runtimeFbheBrowserStateV7(
            point,
            cluster
          )
      );

    const output =
      [...states];

    for (
      let index = 1;
      index <
        states.length - 1;
      index += 1
    ) {
      const previous =
        states[
          index - 1
        ];

      const current =
        states[index];

      const next =
        states[
          index + 1
        ];

      const previousAt =
        new Date(
          points[
            index - 1
          ]?.sampledAt ||
          0
        ).getTime();

      const nextAt =
        new Date(
          points[
            index + 1
          ]?.sampledAt ||
          0
        ).getTime();

      const localSpan =
        nextAt -
        previousAt;

      if (
        !Number.isFinite(
          localSpan
        ) ||
        localSpan >
          2 *
          FBHE_BROWSER_RUNTIME_GAP_MS_V7
      ) {
        continue;
      }

      if (
        [
          "running",
          "stopped"
        ].includes(
          previous
        ) &&
        previous === next &&
        current !== previous &&
        current !== "anomaly"
      ) {
        output[index] =
          previous;
      }
    }

    return output;
  }

  function appendFbheBrowserSegmentV7(
    segments,
    stateValue,
    startAtValue,
    endAtValue
  ) {
    const startAt =
      startAtValue instanceof
      Date
        ? startAtValue
        : new Date(
            startAtValue
          );

    const endAt =
      endAtValue instanceof
      Date
        ? endAtValue
        : new Date(
            endAtValue
          );

    if (
      Number.isNaN(
        startAt.getTime()
      ) ||
      Number.isNaN(
        endAt.getTime()
      ) ||
      endAt <= startAt
    ) {
      return;
    }

    const startText =
      startAt.toISOString();

    const endText =
      endAt.toISOString();

    const previous =
      segments.at(-1);

    if (
      previous &&
      previous.state ===
        stateValue &&
      previous.endAt ===
        startText
    ) {
      previous.endAt =
        endText;

      previous.hours =
        roundFbheBrowserNumberV7(
          (
            new Date(
              previous.endAt
            ).getTime() -
            new Date(
              previous.startAt
            ).getTime()
          ) /
          3600000,
          3
        );

      return;
    }

    segments.push({
      state:
        stateValue,
      startAt:
        startText,
      endAt:
        endText,
      hours:
        roundFbheBrowserNumberV7(
          (
            endAt.getTime() -
            startAt.getTime()
          ) /
          3600000,
          3
        )
    });
  }

  function buildFbheBrowserRuntimeV7(
    points,
    cluster,
    startAt,
    endAt
  ) {
    const safePoints =
      (points || [])
        .filter(
          point => {
            const time =
              new Date(
                point?.sampledAt ||
                0
              ).getTime();

            return (
              Number.isFinite(
                time
              ) &&
              time >=
                startAt.getTime() &&
              time <=
                endAt.getTime()
            );
          }
        )
        .sort(
          (left, right) =>
            left.sampledAt
              .localeCompare(
                right.sampledAt
              )
        );

    const segments = [];

    const totalHours =
      Math.max(
        0,
        (
          endAt.getTime() -
          startAt.getTime()
        ) /
        3600000
      );

    if (
      safePoints.length === 0
    ) {
      return {
        segments,
        runningHours: 0,
        stoppedHours: 0,
        anomalyHours: 0,
        unknownHours:
          roundFbheBrowserNumberV7(
            totalHours,
            3
          ) || 0,
        totalHours:
          roundFbheBrowserNumberV7(
            totalHours,
            3
          ) || 0,
        coveragePct: 0,
        currentState:
          "unknown",
        lastStartAt: "",
        lastStopAt: "",
        transitions: []
      };
    }

    const states =
      stabilizeFbheBrowserStatesV7(
        safePoints,
        cluster
      );

    const pointTimes =
      safePoints.map(
        point =>
          new Date(
            point.sampledAt
          )
      );

    const firstTime =
      pointTimes[0];

    const firstState =
      states[0];

    const leadingGap =
      firstTime.getTime() -
      startAt.getTime();

    appendFbheBrowserSegmentV7(
      segments,
      (
        leadingGap >= 0 &&
        leadingGap <=
          FBHE_BROWSER_RUNTIME_GAP_MS_V7 &&
        [
          "running",
          "stopped",
          "anomaly"
        ].includes(
          firstState
        )
      )
        ? firstState
        : "unknown",
      startAt,
      firstTime
    );

    for (
      let index = 0;
      index <
        safePoints.length - 1;
      index += 1
    ) {
      const leftTime =
        pointTimes[index];

      const rightTime =
        pointTimes[
          index + 1
        ];

      const gapMs =
        rightTime.getTime() -
        leftTime.getTime();

      const leftState =
        states[index];

      const rightState =
        states[
          index + 1
        ];

      if (
        !Number.isFinite(
          gapMs
        ) ||
        gapMs <= 0
      ) {
        continue;
      }

      if (
        gapMs >
        FBHE_BROWSER_RUNTIME_GAP_MS_V7
      ) {
        appendFbheBrowserSegmentV7(
          segments,
          "unknown",
          leftTime,
          rightTime
        );
        continue;
      }

      if (
        leftState ===
          rightState &&
        [
          "running",
          "stopped",
          "anomaly"
        ].includes(
          leftState
        )
      ) {
        appendFbheBrowserSegmentV7(
          segments,
          leftState,
          leftTime,
          rightTime
        );
        continue;
      }

      if (
        [
          "running",
          "stopped"
        ].includes(
          leftState
        ) &&
        [
          "running",
          "stopped"
        ].includes(
          rightState
        )
      ) {
        const midpoint =
          new Date(
            (
              leftTime.getTime() +
              rightTime.getTime()
            ) /
            2
          );

        appendFbheBrowserSegmentV7(
          segments,
          leftState,
          leftTime,
          midpoint
        );

        appendFbheBrowserSegmentV7(
          segments,
          rightState,
          midpoint,
          rightTime
        );

        continue;
      }

      if (
        leftState ===
          "anomaly" ||
        rightState ===
          "anomaly"
      ) {
        appendFbheBrowserSegmentV7(
          segments,
          "anomaly",
          leftTime,
          rightTime
        );
        continue;
      }

      appendFbheBrowserSegmentV7(
        segments,
        "unknown",
        leftTime,
        rightTime
      );
    }

    const lastTime =
      pointTimes.at(-1);

    const lastState =
      states.at(-1);

    const trailingGap =
      endAt.getTime() -
      lastTime.getTime();

    appendFbheBrowserSegmentV7(
      segments,
      (
        trailingGap >= 0 &&
        trailingGap <=
          FBHE_BROWSER_RUNTIME_GAP_MS_V7 &&
        [
          "running",
          "stopped",
          "anomaly"
        ].includes(
          lastState
        )
      )
        ? lastState
        : "unknown",
      lastTime,
      endAt
    );

    const totals = {
      running: 0,
      stopped: 0,
      anomaly: 0,
      unknown: 0
    };

    for (
      const segment of
      segments
    ) {
      totals[
        segment.state
      ] =
        (
          totals[
            segment.state
          ] ||
          0
        ) +
        Number(
          segment.hours ||
          0
        );
    }

    const transitions = [];

    for (
      let index = 1;
      index <
        segments.length;
      index += 1
    ) {
      const previous =
        segments[
          index - 1
        ];

      const current =
        segments[index];

      if (
        [
          "running",
          "stopped"
        ].includes(
          previous.state
        ) &&
        [
          "running",
          "stopped"
        ].includes(
          current.state
        ) &&
        previous.state !==
          current.state
      ) {
        transitions.push({
          type:
            current.state ===
            "running"
              ? "start"
              : "stop",
          estimatedAt:
            current.startAt,
          method:
            "browser_hourly_runtime",
          confidence:
            "high"
        });
      }
    }

    const classifiedHours =
      totals.running +
      totals.stopped;

    const latestSegment =
      segments.at(-1);

    const currentState =
      latestSegment &&
      [
        "running",
        "stopped"
      ].includes(
        latestSegment.state
      ) &&
      latestSegment.endAt ===
        endAt.toISOString()
        ? latestSegment.state
        : "unknown";

    return {
      segments,
      runningHours:
        roundFbheBrowserNumberV7(
          totals.running,
          3
        ) || 0,
      stoppedHours:
        roundFbheBrowserNumberV7(
          totals.stopped,
          3
        ) || 0,
      anomalyHours:
        roundFbheBrowserNumberV7(
          totals.anomaly,
          3
        ) || 0,
      unknownHours:
        roundFbheBrowserNumberV7(
          totals.unknown,
          3
        ) || 0,
      totalHours:
        roundFbheBrowserNumberV7(
          totalHours,
          3
        ) || 0,
      coveragePct:
        totalHours > 0
          ? (
              roundFbheBrowserNumberV7(
                (
                  classifiedHours /
                  totalHours
                ) *
                100,
                1
              ) || 0
            )
          : 0,
      currentState,
      lastStartAt:
        transitions
          .filter(
            item =>
              item.type ===
              "start"
          )
          .at(-1)
          ?.estimatedAt ||
        "",
      lastStopAt:
        transitions
          .filter(
            item =>
              item.type ===
              "stop"
          )
          .at(-1)
          ?.estimatedAt ||
        "",
      transitions
    };
  }

  function sumFbheBrowserSegmentHoursV7(
    segments,
    stateValue,
    startAt,
    endAt
  ) {
    let total = 0;

    for (
      const segment of
      segments || []
    ) {
      if (
        segment.state !==
        stateValue
      ) {
        continue;
      }

      const segmentStart =
        new Date(
          segment.startAt
        );

      const segmentEnd =
        new Date(
          segment.endAt
        );

      const clippedStart =
        segmentStart >
        startAt
          ? segmentStart
          : startAt;

      const clippedEnd =
        segmentEnd <
        endAt
          ? segmentEnd
          : endAt;

      if (
        clippedEnd >
        clippedStart
      ) {
        total +=
          (
            clippedEnd.getTime() -
            clippedStart.getTime()
          ) /
          3600000;
      }
    }

    return (
      roundFbheBrowserNumberV7(
        total,
        3
      ) || 0
    );
  }

  function analyzeFbheRawAssetV7(
    rawAsset,
    assetState,
    sourceChunk
  ) {
    const bounds =
      buildFbheBrowserBoundsV7(
        sourceChunk.startDate,
        sourceChunk.endDate
      );

    const normalized =
      buildFbheBrowserPointsV7(
        rawAsset || {},
        bounds
      );

    const cluster =
      findFbheBrowserClusterV7(
        normalized.points
      );

    const runtime =
      buildFbheBrowserRuntimeV7(
        normalized.points,
        cluster,
        bounds.startAt,
        bounds.endAt
      );

    const latestPoint =
      normalized.points.at(-1) ||
      null;

    const latestClass =
      classifyFbheBrowserPointV7(
        latestPoint,
        cluster
      );

    const shadowState =
      latestClass === "high"
        ? "running"
        : latestClass === "low"
          ? "stopped"
          : runtime.currentState;

    const currentCardState =
      assetState?.isRunning ===
        true
        ? "running"
        : "stopped";

    const comparison =
      ![
        "running",
        "stopped"
      ].includes(
        shadowState
      )
        ? "unknown"
        : shadowState ===
            currentCardState
          ? "match"
          : "mismatch";

    const replacementText =
      String(
        assetState
          ?.lastReplacementAt ||
        ""
      );

    const replacementAt =
      new Date(
        replacementText
      );

    const hasReplacement =
      Boolean(
        replacementText
      ) &&
      !Number.isNaN(
        replacementAt.getTime()
      );

    const cycleWindowStartAt =
      hasReplacement &&
      replacementAt <
        bounds.endAt
        ? (
            replacementAt >
            bounds.startAt
              ? replacementAt
              : bounds.startAt
          )
        : null;

    const cycleWindowEndAt =
      cycleWindowStartAt
        ? bounds.endAt
        : null;

    const cycleWindowHours =
      cycleWindowStartAt &&
      cycleWindowEndAt &&
      cycleWindowEndAt >
        cycleWindowStartAt
        ? (
            cycleWindowEndAt
              .getTime() -
            cycleWindowStartAt
              .getTime()
          ) /
          3600000
        : 0;

    const cycleRuntimeHours =
      cycleWindowStartAt &&
      cycleWindowEndAt
        ? sumFbheBrowserSegmentHoursV7(
            runtime.segments,
            "running",
            cycleWindowStartAt,
            cycleWindowEndAt
          )
        : null;

    const cycleCoverageHours =
      cycleWindowStartAt &&
      cycleWindowEndAt
        ? (
            sumFbheBrowserSegmentHoursV7(
              runtime.segments,
              "running",
              cycleWindowStartAt,
              cycleWindowEndAt
            ) +
            sumFbheBrowserSegmentHoursV7(
              runtime.segments,
              "stopped",
              cycleWindowStartAt,
              cycleWindowEndAt
            )
          )
        : null;

    const cycleCoveragePct =
      cycleWindowHours > 0 &&
      cycleCoverageHours !==
        null
        ? (
            roundFbheBrowserNumberV7(
              (
                cycleCoverageHours /
                cycleWindowHours
              ) *
              100,
              1
            ) || 0
          )
        : 0;

    const registeredRuntime =
      finiteFbheReportNumber(
        assetState
          ?.cycleElapsedHours
      );

    const runtimeDifferenceHours =
      cycleRuntimeHours !==
        null &&
      registeredRuntime !==
        null
        ? roundFbheReportNumber(
            cycleRuntimeHours -
            registeredRuntime,
            3
          )
        : null;

    const sensorByRole =
      new Map(
        normalized.sensors.map(
          sensor => [
            sensor.role,
            sensor
          ]
        )
      );

    const failedSensors =
      FBHE_BROWSER_SENSOR_ROLES_V7
        .filter(
          role =>
            Number(
              sensorByRole
                .get(role)
                ?.sampleCount ||
              0
            ) === 0
        )
        .map(
          role => ({
            role,
            tag:
              String(
                sensorByRole
                  .get(role)
                  ?.tag ||
                ""
              ),
            error:
              String(
                sensorByRole
                  .get(role)
                  ?.error ||
                "TAG 응답 없음"
              )
          })
        );

    const units =
      [
        ...new Set(
          normalized.sensors
            .map(
              sensor =>
                sensor.unit
            )
            .filter(Boolean)
        )
      ];

    const anomalyCount =
      runtime.segments.filter(
        segment =>
          segment.state ===
          "anomaly"
      ).length;

    return {
      tagNumber:
        String(
          assetState
            ?.tagNumber ||
          rawAsset
            ?.assetTag ||
          rawAsset
            ?.tagNumber ||
          ""
        ),
      displayName:
        String(
          assetState
            ?.displayName ||
          rawAsset
            ?.displayName ||
          ""
        ),
      unitNo:
        String(
          assetState
            ?.unitNo ||
          rawAsset
            ?.unitNo ||
          ""
        ),
      positionLabel:
        String(
          assetState
            ?.positionLabel ||
          rawAsset
            ?.positionLabel ||
          ""
        ),
      lastReplacementAt:
        replacementText,
      currentCardState,
      manualState:
        currentCardState,
      shadowState,
      shadowReason:
        shadowState ===
          "running"
          ? "브라우저에서 저장 RAW 진동값의 Blower/Motor 운전 기준을 확인했습니다."
          : shadowState ===
              "stopped"
            ? "브라우저에서 저장 RAW 진동값의 Blower/Motor 정지 기준을 확인했습니다."
            : "저장 RAW 진동값의 현재 상태를 확정하지 못했습니다.",
      signalState:
        latestClass ===
          "drive_anomaly"
          ? "drive_anomaly"
          : latestPoint
            ? "vibration_present"
            : "insufficient",
      comparison,
      successfulSensorCount:
        FBHE_BROWSER_SENSOR_ROLES_V7
          .filter(
            role =>
              Number(
                sensorByRole
                  .get(role)
                  ?.sampleCount ||
                0
              ) > 0
          )
          .length,
      failedSensorCount:
        failedSensors.length,
      failedSensors,
      samplePointCount:
        normalized.points.length,
      latestSampleAt:
        latestPoint
          ?.sampledAt ||
        "",
      latest:
        latestPoint
          ? {
              blowerIndex:
                roundFbheBrowserNumberV7(
                  latestPoint
                    .blowerIndex,
                  4
                ),
              motorIndex:
                roundFbheBrowserNumberV7(
                  latestPoint
                    .motorIndex,
                  4
                ),
              combinedIndex:
                roundFbheBrowserNumberV7(
                  latestPoint
                    .combinedIndex,
                  4
                ),
              validSensorCount:
                latestPoint
                  .validSensorCount,
              values:
                Object.fromEntries(
                  Object.entries(
                    latestPoint.values
                  ).map(
                    ([
                      key,
                      value
                    ]) => [
                      key,
                      roundFbheBrowserNumberV7(
                        value,
                        4
                      )
                    ]
                  )
                ),
              unit:
                units.length === 1
                  ? units[0]
                  : ""
            }
          : null,
      cluster:
        cluster
          ? {
              threshold:
                roundFbheBrowserNumberV7(
                  cluster.threshold,
                  4
                ),
              lowerMedian:
                roundFbheBrowserNumberV7(
                  cluster.lowerMedian,
                  4
                ),
              upperMedian:
                roundFbheBrowserNumberV7(
                  cluster.upperMedian,
                  4
                ),
              separationRatio:
                roundFbheBrowserNumberV7(
                  cluster
                    .separationRatio,
                  2
                ),
              lowerCount:
                cluster.lowerCount,
              upperCount:
                cluster.upperCount
            }
          : null,
      runtime: {
        rangeRunningHours:
          runtime.runningHours,
        rangeStoppedHours:
          runtime.stoppedHours,
        rangeAnomalyHours:
          runtime.anomalyHours,
        rangeUnknownHours:
          runtime.unknownHours,
        rangeCoveragePct:
          runtime.coveragePct,
        rangeTotalHours:
          runtime.totalHours,
        oisState:
          runtime.currentState,
        latestStartAt:
          runtime.lastStartAt,
        latestStopAt:
          runtime.lastStopAt,
        transitionCount:
          runtime.transitions.length,
        segments:
          runtime.segments
            .slice(-500),
        cycleStartAt:
          hasReplacement
            ? replacementAt
                .toISOString()
            : "",
        cycleWindowStartAt:
          cycleWindowStartAt
            ? cycleWindowStartAt
                .toISOString()
            : "",
        cycleWindowHours:
          roundFbheReportNumber(
            cycleWindowHours,
            3
          ) || 0,
        cycleRuntimeHours,
        cycleCoverageHours:
          cycleCoverageHours ===
            null
            ? null
            : roundFbheReportNumber(
                cycleCoverageHours,
                3
              ),
        cycleCoveragePct,
        cycleRangeComplete:
          hasReplacement
            ? replacementAt >=
              bounds.startAt
            : false,
        registeredCycleRuntimeHours:
          registeredRuntime,
        runtimeDifferenceHours
      },
      transitions:
        runtime.transitions,
      unrecordedTransitionCount:
        0,
      anomalyCount
    };
  }

  function analyzeFbheRawChunkV7(
    rawResult,
    sourceChunk
  ) {
    const rawAssets =
      Array.isArray(
        rawResult?.assets
      )
        ? rawResult.assets
        : [];

    const rawByTag =
      new Map(
        rawAssets.map(
          rawAsset => [
            String(
              rawAsset
                ?.assetTag ||
              rawAsset
                ?.tagNumber ||
              ""
            )
              .trim()
              .toUpperCase(),
            rawAsset
          ]
        )
      );

    const assetStates =
      (
        state.data?.assets ||
        []
      )
        .filter(
          asset =>
            asset.blowerType ===
            "fbhe"
        )
        .sort(
          (left, right) =>
            Number(
              left.sortOrder ||
              0
            ) -
            Number(
              right.sortOrder ||
              0
            )
        );

    const assets =
      assetStates.map(
        assetState => {
          const tagNumber =
            String(
              assetState
                ?.tagNumber ||
              ""
            )
              .trim()
              .toUpperCase();

          return analyzeFbheRawAssetV7(
            rawByTag.get(
              tagNumber
            ) ||
            {
              assetTag:
                tagNumber,
              sensors: []
            },
            assetState,
            sourceChunk
          );
        }
      );

    const coverageValues =
      assets
        .map(
          asset =>
            finiteFbheReportNumber(
              asset.runtime
                ?.rangeCoveragePct
            )
        )
        .filter(
          value =>
            value !== null
        );

    const summary = {
      assetCount:
        assets.length,
      shadowDecidedCount:
        assets.filter(
          asset =>
            [
              "running",
              "stopped"
            ].includes(
              asset.runtime
                ?.oisState ||
              asset.shadowState
            )
        ).length,
      matchCount:
        assets.filter(
          asset =>
            asset.comparison ===
            "match"
        ).length,
      mismatchCount:
        assets.filter(
          asset =>
            asset.comparison ===
            "mismatch"
        ).length,
      unknownCount:
        assets.filter(
          asset =>
            ![
              "running",
              "stopped"
            ].includes(
              asset.runtime
                ?.oisState ||
              asset.shadowState
            )
        ).length,
      transitionCount:
        assets.reduce(
          (sum, asset) =>
            sum +
            Number(
              asset.runtime
                ?.transitionCount ||
              0
            ),
          0
        ),
      unrecordedTransitionCount:
        0,
      anomalyCount:
        assets.reduce(
          (sum, asset) =>
            sum +
            Number(
              asset.anomalyCount ||
              0
            ),
          0
        ),
      successfulSensorChunkCount:
        Number(
          rawResult
            ?.successfulSensorCount ||
          0
        ),
      failedSensorChunkCount:
        Number(
          rawResult
            ?.failedSensorCount ||
          0
        ),
      averageCoveragePct:
        coverageValues.length > 0
          ? (
              roundFbheReportNumber(
                coverageValues.reduce(
                  (sum, value) =>
                    sum + value,
                  0
                ) /
                coverageValues.length,
                1
              ) || 0
            )
          : 0,
      completeChunkCount: 1,
      chunkCount: 1
    };

    const bounds =
      buildFbheBrowserBoundsV7(
        sourceChunk.startDate,
        sourceChunk.endDate
      );

    return {
      ok: true,
      startDate:
        sourceChunk.startDate,
      endDate:
        sourceChunk.endDate,
      dayCount:
        sourceChunk.dayCount,
      queue: {
        status:
          "complete",
        chunkCount: 1,
        completeCount: 1,
        pendingCount: 0,
        processingCount: 0,
        failedCount: 0,
        missingCount: 0,
        items: [
          {
            id: "",
            targetDate:
              sourceChunk.targetDate,
            status:
              "complete",
            requestedAt: "",
            startedAt: "",
            completedAt:
              String(
                rawResult
                  ?.collectedAt ||
                ""
              ),
            errorMessage: "",
            expiresAt: "",
            updatedAt: ""
          }
        ]
      },
      automaticApply: false,
      actualStateChanged: false,
      runtimeChanged: false,
      cycleChanged: false,
      source: {
        source:
          "OIS TAG Log Direct API · Browser RAW 분석",
        collectedAt:
          String(
            rawResult
              ?.collectedAt ||
            ""
          ),
        outputIntervalHours:
          Number(
            rawResult
              ?.outputIntervalHours ||
            1
          ),
        requestedSensorCountPerChunk:
          Number(
            rawResult
              ?.requestedSensorCount ||
            24
          ),
        successfulSensorChunkCount:
          Number(
            rawResult
              ?.successfulSensorCount ||
            0
          ),
        failedSensorChunkCount:
          Number(
            rawResult
              ?.failedSensorCount ||
            0
          )
      },
      analysis: {
        startAt:
          bounds.startAt
            .toISOString(),
        endAt:
          bounds.endAt
            .toISOString(),
        readOnly: true,
        runtimeUnit:
          "hour",
        transitionEstimate:
          "hourly_midpoint",
        mode:
          "browser_raw_chunk"
      },
      assets,
      summary
    };
  }

  async function requestFbheRawSourceV7(
    sourceChunk
  ) {
    return await apiRequest({
      url:
        API_URL +
        "?action=vibration_raw" +
        "&targetDate=" +
        encodeURIComponent(
          sourceChunk.targetDate
        ),
      timeoutMs:
        30000
    });
  }


  async function loadFbheVibrationShadowReport(
    options = {}
  ) {
    if (
      !canUseFbheVibrationShadow()
    ) {
      return null;
    }

    const range =
      selectedFbheVibrationRange();

    if (
      range.dayCount < 1 ||
      range.dayCount > 366
    ) {
      return null;
    }

    state.vibrationClientAnalysis =
      true;

    try {
      const sourceChunks =
        buildFbheVibrationAnalysisChunks(
          range.startDate,
          range.endDate
        ).map(
          chunk => ({
            ...chunk,
            targetDate:
              chunk.startDate +
              "~" +
              chunk.endDate
          })
        );

      const reports = [];
      const analysisErrors = [];

      for (
        let index = 0;
        index <
          sourceChunks.length;
        index += 1
      ) {
        const sourceChunk =
          sourceChunks[index];

        elements.vibrationHeadline
          .textContent =
            "브라우저 저장 RAW 분석 중 · " +
            (index + 1) +
            "/" +
            sourceChunks.length;

        elements.vibrationStatus
          .dataset.state =
            "running";

        elements.vibrationStatus
          .textContent =
            "Cloudflare에서 분석하지 않고 저장된 " +
            sourceChunk.startDate +
            " ~ " +
            sourceChunk.endDate +
            " OIS 원본을 이 PC 브라우저에서 계산하고 있습니다.";

        if (
          elements
            .vibrationQueryButton
        ) {
          elements
            .vibrationQueryButton
            .textContent =
              "저장자료 분석 중...";
        }

        try {
          const rawResult =
            await requestFbheRawSourceV7(
              sourceChunk
            );

          reports.push(
            analyzeFbheRawChunkV7(
              rawResult,
              sourceChunk
            )
          );
        } catch (error) {
          analysisErrors.push({
            ...sourceChunk,
            message:
              error?.message ||
              "저장 RAW 원본을 불러오지 못했습니다."
          });

          console.warn(
            "FBHE browser RAW analysis source failed:",
            sourceChunk,
            error
          );
        }

        await waitForMilliseconds(
          20
        );
      }

      if (
        reports.length === 0
      ) {
        throw new Error(
          analysisErrors[0]
            ?.message ||
          "저장된 FBHE OIS 원본을 브라우저에서 분석하지 못했습니다."
        );
      }

      const report =
        aggregateFbheVibrationChunkReports(
          reports,
          range,
          analysisErrors
        );

      if (
        report.analysis
      ) {
        report.analysis.mode =
          "browser_raw_merge";

        report.analysis.rawChunkCount =
          reports.length;

        report.analysis.failedRawChunkCount =
          analysisErrors.length;
      }

      if (
        report.summary
      ) {
        report.summary.chunkCount =
          sourceChunks.length;

        report.summary.completeChunkCount =
          reports.length;

        report.summary.analysisFailedChunkCount =
          analysisErrors.length;
      }

      if (
        report.queue
      ) {
        report.queue.chunkCount =
          sourceChunks.length;

        report.queue.completeCount =
          reports.length;

        report.queue.failedCount =
          analysisErrors.length;

        report.queue.missingCount =
          analysisErrors.length;

        report.queue.pendingCount =
          0;

        report.queue.processingCount =
          0;

        report.queue.status =
          analysisErrors.length === 0
            ? "complete"
            : reports.length > 0
              ? "partial_failed"
              : "failed";
      }

      const finalTargetDate =
        sourceChunks
          .at(-1)
          ?.targetDate ||
        "";

      const finalSourceAvailable =
        reports.some(
          chunkReport =>
            chunkReport
              ?.queue
              ?.items
              ?.some(
                item =>
                  item.targetDate ===
                  finalTargetDate &&
                  item.status ===
                  "complete"
              )
        );

      if (
        !finalSourceAvailable
      ) {
        for (
          const asset of
          report.assets ||
          []
        ) {
          asset.shadowState =
            "unknown";

          if (
            asset.runtime
          ) {
            asset.runtime.oisState =
              "unknown";
          }
        }

        if (
          report.summary
        ) {
          report.summary.shadowDecidedCount =
            0;

          report.summary.unknownCount =
            Number(
              report.summary.assetCount ||
              6
            );
        }
      }

      state.vibrationReport =
        report;

      state.vibrationReportRangeKey =
        range.key;

      renderFbheVibrationShadow();

      if (
        analysisErrors.length > 0 &&
        !options.silent
      ) {
        showToast(
          "저장 RAW " +
          reports.length +
          "/" +
          sourceChunks.length +
          "구간을 브라우저에서 계산했습니다. 누락 " +
          analysisErrors.length +
          "구간은 OIS 이어조회로 보완할 수 있습니다.",
          "error"
        );
      }

      return report;
    } catch (error) {
      if (
        !options.silent
      ) {
        showToast(
          error.message ||
          "FBHE 저장 RAW 브라우저 분석에 실패했습니다.",
          "error"
        );
      }

      throw error;
    } finally {
      state.vibrationClientAnalysis =
        false;
    }
  }

  /* [FBHE-OIS-RESUME-TIMEOUT-V4-R3] */
  async function cancelFbheVibrationRequests(requestIds, reason) {
    const ids = [...new Set((requestIds || []).filter(Boolean))];
    if (ids.length === 0) return null;
    return await apiRequest({
      url: OIS_REQUEST_API_URL,
      method: "POST",
      body: {
        action: "cancel_fbhe_vibration_batch",
        requestIds: ids,
        reason: reason ||
          "FBHE OIS 기간조회가 5분간 진행되지 않아 자동 종료했습니다."
      }
    });
  }

  async function pollFbheVibrationRequests(requestIds, range, initialItems = []) {
    const uniqueIds = [...new Set((requestIds || []).filter(Boolean))];
    if (uniqueIds.length === 0) return [];
    if (uniqueIds.length > 12) {
      throw new Error("FBHE 진동 요청 구간이 12개를 초과했습니다.");
    }

    const itemMap = new Map(initialItems.map(item => [item.id, item]));
    const maximumAttempts = 2400;
    const noProgressTimeoutMs = 5 * 60 * 1000;
    let lastFingerprint = "";
    let lastProgressAt = Date.now();

    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      const result = await apiRequest({
        url: `${OIS_REQUEST_API_URL}?action=status_batch&compact=1&ids=${encodeURIComponent(uniqueIds.join(","))}`
      });

      for (const item of result.items || []) itemMap.set(item.id, item);
      const items = [...itemMap.values()];
      const fingerprint = items
        .map(item => `${item.id}:${item.status}:${item.completedAt || ""}:${item.updatedAt || ""}`)
        .sort()
        .join("|");

      if (!lastFingerprint || fingerprint !== lastFingerprint) {
        lastFingerprint = fingerprint;
        lastProgressAt = Date.now();
      }

      state.vibrationReport = {
        ok: true,
        startDate: range.startDate,
        endDate: range.endDate,
        dayCount: range.dayCount,
        queue: buildFbheVibrationQueueSummary(items),
        automaticApply: false,
        assets: [],
        summary: {}
      };
      renderFbheVibrationShadow();

      const active = items.filter(
        item => ["pending", "processing"].includes(item.status)
      );
      if (active.length === 0) return items;

      if (Date.now() - lastProgressAt >= noProgressTimeoutMs) {
        const activeIds = active.map(item => item.id).filter(Boolean);
        await cancelFbheVibrationRequests(
          activeIds,
          "FBHE OIS 기간조회가 5분간 진행되지 않아 자동 종료했습니다."
        ).catch(error => {
          console.warn("FBHE OIS auto-stop failed:", error);
        });

        const timeoutError = new Error(
          "5분간 진행이 없어 FBHE OIS 조회를 자동 종료했습니다. 이미 완료된 구간은 보존되며, 다음 OIS 이어조회에서 미완료 구간만 다시 조회합니다."
        );
        timeoutError.code = "FBHE_NO_PROGRESS_AUTO_STOP";
        throw timeoutError;
      }

      await waitForMilliseconds(3000);
    }

    throw new Error(
      "FBHE OIS 조회가 최대 대기시간을 초과했습니다. 완료된 구간은 그대로 보존됩니다."
    );
  }

  async function requestFbheVibrationShadow(forceRefresh = false) {
    if (stopMobileMutation() || !canUseFbheVibrationShadow() || state.vibrationPolling) return;

    if (
      forceRefresh &&
      !window.confirm(
        "선택한 FBHE OIS 기간을 처음부터 전체 재조회합니다.\n\n기존 완료자료는 삭제하지 않으며 새 완료자료가 생기면 최신값으로 사용합니다. 계속할까요?"
      )
    ) {
      return;
    }
    const range = selectedFbheVibrationRange();

    if (range.dayCount < 1) {
      showToast("FBHE 진동 조회 시작일과 종료일을 확인해 주세요.", "error");
      return;
    }
    if (range.dayCount > 366) {
      showToast("FBHE 진동은 한 번에 최대 1년(366일)까지 조회할 수 있습니다.", "error");
      return;
    }
    if (range.endDate > maximumFbheVibrationDate()) {
      showToast("미래 날짜의 FBHE 진동은 조회할 수 없습니다.", "error");
      return;
    }

    state.vibrationPolling = true;
    state.vibrationReportRangeKey = range.key;
    renderFbheVibrationShadow();

    try {
      const created = await apiRequest({
        url: OIS_REQUEST_API_URL,
        method: "POST",
        body: {
          action: "create_fbhe_vibration_batch",
          startDate: range.startDate,
          endDate: range.endDate,
          forceRefresh
        }
      });
      const items = Array.isArray(created.items) ? created.items : [];
      state.vibrationPollRequestIds = items.map(item => item.id).filter(Boolean);
      state.vibrationReport = {
        ok: true,
        startDate: range.startDate,
        endDate: range.endDate,
        dayCount: range.dayCount,
        queue: buildFbheVibrationQueueSummary(items),
        automaticApply: false,
        assets: [],
        summary: {}
      };
      renderFbheVibrationShadow();

      const activeIds = items
        .filter(item => ["pending", "processing"].includes(item.status))
        .map(item => item.id)
        .filter(Boolean);

      if (activeIds.length > 0) {
        await pollFbheVibrationRequests(activeIds, range, items);
      }

      await loadFbheVibrationShadowReport();
      showToast(forceRefresh
        ? `FBHE OIS 진동 ${range.dayCount}일을 다시 수집해 운전시간을 분석했습니다.`
        : `FBHE OIS 진동 ${range.dayCount}일의 운전시간 분석을 완료했습니다.`);
    } catch (error) {
      showToast(error.message || "FBHE OIS 기간조회에 실패했습니다.", "error");
      await loadFbheVibrationShadowReport({ silent: true }).catch(() => null);
    } finally {
      state.vibrationPolling = false;
      state.vibrationPollRequestIds = [];
      renderFbheVibrationShadow();
    }
  }

  function renderAll() {
    if (!state.data) return;

    renderHeaderActions();
    renderTypeTabs();
    renderStatusFilters();
    renderSettings();
    renderFbheVibrationShadow();
    renderAverageStats();
    renderMissingTags();
    renderAssets();
    renderHistory();

    if (hasAuthenticatedWriteAccess()) {
      renderCandidates();
      renderBackfillStatus();
    }

    applyPublicMonitoringMode();
    applyMobileMonitoringMode();
  }

  function setBusy(isBusy) {
    state.busy = Boolean(isBusy);
    elements.refreshButton.disabled = state.busy;
    const writeBlocked = !hasAuthenticatedWriteAccess();
    elements.scanButton.disabled = writeBlocked || state.busy || shouldHideAutomaticData();
    elements.historicalBackfillButton.disabled = writeBlocked || state.busy || state.backfillRunning;
    elements.overviewBackfillButton.disabled = writeBlocked || state.busy || state.backfillRunning;
    elements.auditHistoryButton.disabled = writeBlocked || state.busy || state.backfillRunning || state.auditRunning;
    elements.assetManagerButton.disabled = writeBlocked || state.busy;
    if (elements.vibrationQueryButton) elements.vibrationQueryButton.disabled = writeBlocked || state.busy || state.vibrationPolling;
    if (elements.vibrationRequeryButton) elements.vibrationRequeryButton.disabled = writeBlocked || state.busy || state.vibrationPolling;
  }

  async function syncOperationChanges(days = 14) {
    if (
      isMobileMonitoringView() ||
      !hasAuthenticatedWriteAccess() ||
      state.busy && !state.data
    ) {
      return null;
    }

    return apiRequest({
      method: "POST",
      timeoutMs: 30000,
      body: {
        action: "operation_sync",
        days
      }
    });
  }

  async function loadData(options = {}) {
    if (!options.silent) setBusy(true);

    try {
      let data = await apiRequest();
      const applyServerClock = payload => {
        const serverGeneratedAt = Date.parse(payload?.generatedAt || "");
        state.serverClockOffsetMs = Number.isFinite(serverGeneratedAt)
          ? serverGeneratedAt - Date.now()
          : 0;
      };

      applyServerClock(data);
      state.data = data;

      const shouldSyncOperations = (
        options.syncOperations !== false &&
        hasAuthenticatedWriteAccess(data) &&
        !isMobileMonitoringView() &&
        (options.forceOperationSync === true || !state.operationSyncCompleted)
      );
      let operationSyncResult = null;

      if (shouldSyncOperations) {
        state.operationSyncCompleted = true;
        try {
          operationSyncResult = await syncOperationChanges(14);
          if (Number(operationSyncResult?.appliedStateChanges || 0) > 0) {
            data = await apiRequest();
            applyServerClock(data);
            state.data = data;
          }
        } catch (syncError) {
          console.warn("업무일지 교체운전 자동 동기화 실패:", syncError);
          if (options.forceOperationSync) {
            showToast(syncError.message || "교체운전 자동 동기화에 실패했습니다.", "error");
          }
        }
      }

      if (hasAuthenticatedWriteAccess(data)) {
        elements.authNotice.hidden = true;
        elements.authNotice.removeAttribute("data-state");
      } else {
        elements.authNotice.hidden = false;
        elements.authNotice.dataset.state = "public";
        elements.authNotice.textContent = "공유 조회 전용 · 로그인된 업무일지에서 이 메뉴를 열면 OIS 조회·기동/정지·이력 추가/수정·누적시간 보정이 활성화됩니다.";
      }

      if (!(data.types || []).some(type => type.key === state.activeType)) {
        state.activeType = "fbhe";
      }

      renderAll();

      if (Number(operationSyncResult?.appliedStateChanges || 0) > 0) {
        showToast(operationSyncResult.message || "업무일지 교체운전을 자동 반영했습니다.");
      }
    } catch (error) {
      console.error("Blower 이력 데이터 조회 실패:", error);
      elements.authNotice.hidden = false;
      elements.authNotice.textContent = error.message || "Blower 이력을 불러오지 못했습니다.";
      showToast(error.message || "데이터를 불러오지 못했습니다.", "error");
    } finally {
      if (!options.silent) setBusy(false);
    }
  }

  function switchType(type) {
    if (!state.data?.types?.some(item => item.key === type)) return;
    state.activeType = type;
    state.statusFilter = "all";
    renderAll();
  }

  function switchSubview(subview) {
    if (subview === "detect" && (isMobileMonitoringView() || isPublicMonitoringView())) {
      subview = "overview";
    }
    state.subview = subview;

    document.querySelectorAll(".sub-tab").forEach(button => {
      const active = button.dataset.subview === subview;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });

    document.querySelectorAll("[data-subview-panel]").forEach(panel => {
      const active = panel.dataset.subviewPanel === subview;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
  }

  function findAsset(tag) {
    return (state.data?.assets || []).find(asset => asset.tagNumber === tag) || null;
  }

  function explicitRuntimeEvents(asset) {
    const replacementAt = new Date(asset?.lastReplacementAt);
    return getAssetEvents(asset?.tagNumber)
      .filter(event => ["startup", "operation_start", "operation_stop", "runtime_correction"].includes(event.eventType))
      .map(event => ({ event, parsed: new Date(event.eventDate) }))
      .filter(item => !Number.isNaN(item.parsed.getTime()))
      .filter(item => Number.isNaN(replacementAt.getTime()) || item.parsed >= replacementAt)
      .sort((left, right) => {
        const timeDifference = right.parsed.getTime() - left.parsed.getTime();
        if (timeDifference !== 0) return timeDifference;
        return String(right.event.createdAt || "").localeCompare(String(left.event.createdAt || ""));
      });
  }

  function latestExplicitRuntimeEvent(asset) {
    return explicitRuntimeEvents(asset)[0]?.event || null;
  }

  function latestExplicitRuntimeBoundary(asset) {
    const event = latestExplicitRuntimeEvent(asset);
    const parsed = new Date(event?.eventDate);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function previousExplicitRuntimeEvent(asset, selectedEvent) {
    const events = explicitRuntimeEvents(asset);
    const selectedIndex = events.findIndex(item => item.event.id === selectedEvent?.id);
    return selectedIndex >= 0 ? (events[selectedIndex + 1]?.event || null) : null;
  }

  function previousExplicitRuntimeEvents(asset, selectedEvent) {
    const events = explicitRuntimeEvents(asset);
    const selectedIndex = events.findIndex(item => item.event.id === selectedEvent?.id);
    return selectedIndex >= 0 ? events.slice(selectedIndex + 1).map(item => item.event) : [];
  }

  function findEvent(eventId) {
    return (state.data?.events || []).find(event => event.id === eventId) || null;
  }

  function runtimeEventState(event) {
    if (["startup", "operation_start"].includes(event?.eventType)) return "running";
    if (event?.eventType === "operation_stop") return "stopped";
    if (event?.eventType !== "runtime_correction") return "";
    return /(?:정지|stop)/i.test(String(event.actionType || "")) ? "stopped" : "running";
  }

  function resetRecordDialogVisibility() {
    const dateField = elements.recordDate?.closest(".field");
    if (dateField) dateField.hidden = false;
    elements.recordDate.type = "date";
    elements.recordDate.min = "";
    elements.recordDate.max = "";
    elements.recordDate.disabled = false;
    elements.recordEventId.value = "";
    elements.recordExpectedEventUpdatedAt.value = "";
    elements.runtimeEditResetToPending.value = "";
    state.runtimeEditOriginalDate = "";
    elements.issueTypeField.hidden = false;
    elements.actionTypeField.hidden = false;
    elements.replacementRunningField.hidden = true;
    elements.replacementStartupAtField.hidden = true;
    elements.replacementStartupAt.required = false;
    elements.runtimeHoursField.hidden = true;
    elements.runtimeStateField.hidden = true;
    elements.runtimeStateLabel.textContent = "변경할 운전상태";
    elements.runtimeCycleSummary.hidden = true;
    elements.runtimeCycleSummary.innerHTML = "";
    elements.runtimeEditPendingField.hidden = true;
    elements.runtimeEditPendingField.classList.remove("is-selected");
    elements.runtimeEditPendingButton.textContent = "교체 당시부터 정지 · 0시간";
    elements.recordNoteLabel.textContent = "비고 / 작업내용";
    elements.recordSaveButton.textContent = "저장";
    elements.candidateSourcePreview.hidden = true;
  }

  function canResetRuntimeEventToPending(asset, event) {
    const eventAt = new Date(event?.eventDate);
    const anchorAt = new Date(asset?.cycleRuntimeAnchorAt);
    const eventHours = Number(event?.runtimeHours);
    const cycleHours = Number(asset?.cycleElapsedHours);
    return Boolean(
      asset &&
      event?.eventType === "operation_stop" &&
      String(event.sourceType || "") === "manual" &&
      String(asset.cycleStartState || "legacy") !== "pending" &&
      asset.isRunning === false &&
      latestExplicitRuntimeEvent(asset)?.id === event.id &&
      !Number.isNaN(eventAt.getTime()) &&
      !Number.isNaN(anchorAt.getTime()) &&
      eventAt.getTime() === anchorAt.getTime() &&
      Number.isFinite(eventHours) &&
      Number.isFinite(cycleHours) &&
      Math.abs(eventHours - cycleHours) <= 0.05
    );
  }

  function canInferRuntimeEventPendingByDate(asset, event) {
    return Boolean(
      canResetRuntimeEventToPending(asset, event) &&
      String(asset?.cycleStartState || "legacy") === "legacy" &&
      previousExplicitRuntimeEvents(asset, event).length === 0
    );
  }

  function runtimeEditMinimumAt(asset, event) {
    const previous = previousExplicitRuntimeEvent(asset, event);
    if (previous) return new Date(previous.eventDate);
    const replacementAt = new Date(asset?.lastReplacementAt);
    if (
      event?.eventType === "operation_start" &&
      String(asset?.cycleStartState || "legacy") === "started" &&
      Math.abs(Number(event.runtimeHours || 0)) < 0.000001
    ) {
      return Number.isNaN(replacementAt.getTime()) ? null : replacementAt;
    }
    const cycleStartedAt = new Date(asset?.cycleStartedAt);
    if (String(asset?.cycleStartState || "legacy") === "started" && !Number.isNaN(cycleStartedAt.getTime())) {
      return cycleStartedAt;
    }
    return Number.isNaN(replacementAt.getTime()) ? null : replacementAt;
  }

  function updateRuntimeEditPreview() {
    if (elements.recordMode.value !== "runtime_state_edit") return;
    const asset = findAsset(elements.recordTag.value);
    const editedEvent = findEvent(elements.recordEventId.value);
    if (!asset || !editedEvent) return;

    const resetToPending = elements.runtimeEditResetToPending.value === "true";
    const editedAt = new Date(kstDateTimeInputToIso(elements.recordDate.value));
    const replacementAt = new Date(asset.lastReplacementAt);
    const previous = previousExplicitRuntimeEvent(asset, editedEvent);
    const restorePending = resetToPending || (
      canInferRuntimeEventPendingByDate(asset, editedEvent) &&
      (!Number.isNaN(editedAt.getTime()) && !Number.isNaN(replacementAt.getTime()) && editedAt <= replacementAt)
    );
    let previewHtml;

    if (restorePending) {
      previewHtml = `
        <span>수정 후</span>
        <strong>기동 대기 · 누적 0시간</strong>
        <small>${escapeHtml(formatDate(asset.lastReplacementAt))} 교체 후 아직 기동하지 않은 상태로 반영합니다.</small>
        <small>D-day·사용률·알림은 다음 기동 등록 전까지 계산하지 않습니다.</small>
      `;
    } else if (Number.isNaN(editedAt.getTime())) {
      previewHtml = `<span>수정 후</span><strong>시각을 확인해 주세요.</strong>`;
    } else if (editedEvent.eventType === "operation_start") {
      const baseHours = Number(editedEvent.runtimeHours || 0);
      const previewHours = Math.max(0, baseHours + ((currentServerDate().getTime() - editedAt.getTime()) / 3600000));
      previewHtml = `
        <span>수정 후</span>
        <strong>운전중 · 현재 누적 ${escapeHtml(formatDaysHours(previewHours))}</strong>
        <small>수정한 재기동시각부터 현재까지 Cycle 계산을 이어갑니다.</small>
      `;
    } else {
      const baseAt = previous
        ? new Date(previous.eventDate)
        : runtimeEditMinimumAt(asset, editedEvent);
      const baseHours = previous ? Number(previous.runtimeHours || 0) : 0;
      const previewHours = baseAt && !Number.isNaN(baseAt.getTime())
        ? Math.max(0, baseHours + ((editedAt.getTime() - baseAt.getTime()) / 3600000))
        : 0;
      previewHtml = `
        <span>수정 후</span>
        <strong>정지 · 누적 ${escapeHtml(formatDaysHours(previewHours))}</strong>
        <small>입력한 시각에서 Cycle 경과·D-day·사용률·알림을 고정합니다.</small>
      `;
    }

    elements.runtimeCycleSummary.hidden = false;
    elements.runtimeCycleSummary.innerHTML = `
      <span>현재 기록</span>
      <strong>${escapeHtml(formatKstDateTimeDisplay(editedEvent.eventDate))} · ${escapeHtml(eventLabel(editedEvent.eventType))} · 당시 ${escapeHtml(formatDaysHours(editedEvent.runtimeHours))}</strong>
      ${previewHtml}
      <small>기존 값과 수정자·수정일은 감사이력에 보존됩니다.</small>
    `;
  }

  function toggleRuntimeEditStartupPending() {
    if (elements.recordMode.value !== "runtime_state_edit") return;
    const asset = findAsset(elements.recordTag.value);
    const selected = elements.runtimeEditResetToPending.value !== "true";
    elements.runtimeEditResetToPending.value = selected ? "true" : "";
    elements.runtimeEditPendingField.classList.toggle("is-selected", selected);
    elements.runtimeEditPendingButton.textContent = selected
      ? "선택됨 · 교체 당시부터 정지"
      : "교체 당시부터 정지 · 0시간";
    elements.recordDate.disabled = selected;
    elements.recordDate.value = selected
      ? formatKstDateTimeInput(new Date(asset?.lastReplacementAt))
      : state.runtimeEditOriginalDate;
    updateRuntimeEditPreview();
  }

  async function resetRuntimeEventToStartupPending(tagNumber, eventId, event) {
    if (stopMobileMutation(event)) return;
    if (state.busy) return;

    const asset = findAsset(tagNumber);
    const editedEvent = findEvent(eventId);
    if (!asset || !editedEvent || !canResetRuntimeEventToPending(asset, editedEvent)) {
      showToast("최신 정지 이력 또는 현재 Cycle이 변경되었습니다. 새로고침 후 다시 확인해 주세요.", "error");
      return;
    }

    const previousBoundaries = previousExplicitRuntimeEvents(asset, editedEvent);
    const hasRunningBoundary = previousBoundaries.some(boundary => runtimeEventState(boundary) === "running");
    const warning = hasRunningBoundary
      ? "\n\n이전 기동·재기동 또는 운전중 보정 기록이 있습니다. 해당 기록은 감사이력에 보존하지만 현재 Cycle 기준에서는 제외합니다."
      : "";
    const confirmed = window.confirm(
      `${formatDate(asset.lastReplacementAt)} V-Belt 교체 후 한 번도 기동하지 않은 상태로 정정합니다.\n\n` +
      `현재: ${formatKstDateTimeDisplay(editedEvent.eventDate)} 정지 · 누적 ${formatDaysHours(editedEvent.runtimeHours)}\n` +
      "변경: 기동 대기 · 누적 0시간\n\n" +
      "교체일과 등록 근거는 유지되며 다음 실제 기동부터 다시 계산합니다." +
      warning +
      "\n\n계속할까요?"
    );
    if (!confirmed) return;

    setBusy(true);
    elements.historyDialog.close();
    try {
      const result = await apiRequest({
        method: "POST",
        body: {
          action: "runtime_event_edit",
          tagNumber,
          eventId: editedEvent.id,
          eventDate: editedEvent.eventDate,
          resetToStartupPending: true,
          confirmRuntimeBoundaryOverride: true,
          expectedEventUpdatedAt: editedEvent.updatedAt || "",
          expectedCycleRuntimeRevision: asset.cycleRuntimeRevision || "",
          expectedLastReplacementAt: asset.lastReplacementAt || "",
          changeNote: "교체 후 미기동 상태로 0시간 복원",
          note: editedEvent.note || ""
        }
      });
      showToast(result.message || "기동 대기·누적 0시간으로 정정했습니다.");
      await loadData({ silent: true });
      openAssetHistory(tagNumber);
    } catch (error) {
      console.error("Blower 미기동·0시간 복원 실패:", error);
      showToast(error.message || "0시간으로 복원하지 못했습니다.", "error");
      openAssetHistory(tagNumber);
    } finally {
      setBusy(false);
    }
  }

  async function toggleAssetOperation(tagNumber, button = null) {
    if (stopMobileMutation()) return;
    if (state.busy) return;

    const asset = findAsset(tagNumber);
    if (!asset || !asset.lastReplacementAt) {
      showToast("먼저 V-Belt 교체 이력을 등록해 주세요.", "error");
      return;
    }

    const startupPending = String(asset.cycleStartState || "legacy") === "pending";
    const targetRunning = startupPending || !asset.isRunning;
    const eventDate = currentServerDate().toISOString();
    const body = startupPending
      ? {
          action: "startup",
          tagNumber,
          eventDate,
          expectedLastReplacementAt: asset.lastReplacementAt,
          note: "카드에서 직접 기동"
        }
      : {
          action: "runtime_state",
          tagNumber,
          eventDate,
          isRunning: targetRunning,
          expectedCycleRuntimeRevision: asset.cycleRuntimeRevision || "",
          note: targetRunning ? "카드에서 직접 기동" : "카드에서 직접 정지"
        };

    setBusy(true);
    if (button) button.disabled = true;

    try {
      const result = await apiRequest({ method: "POST", body });
      showToast(result.message || (targetRunning ? "기동했습니다." : "정지했습니다."));
      state.operationSyncCompleted = true;
      await loadData({ silent: true, syncOperations: false });
    } catch (error) {
      console.error("Blower 기동·정지 저장 실패:", error);
      showToast(error.message || "기동·정지 상태를 변경하지 못했습니다.", "error");
    } finally {
      if (button) button.disabled = false;
      setBusy(false);
    }
  }

  function openRecordDialog(mode, tagNumber, candidate = null) {
    if (stopMobileMutation()) return;
    const asset = findAsset(tagNumber);
    if (!asset || !elements.recordDialog) return;

    resetRecordDialogVisibility();

    elements.recordMode.value = mode;
    elements.recordTag.value = tagNumber;
    elements.candidateId.value = candidate?.id || "";
    elements.recordDate.value = formatDate(candidate?.detectedDate) !== "-"
      ? formatDate(candidate.detectedDate)
      : formatKstDateInput();
    elements.recordNote.value = "";
    elements.recordAssetLabel.textContent = `${asset.displayName} · ${asset.tagNumber}`;

    if (mode === "replacement") {
      elements.recordDialogEyebrow.textContent = "REPLACEMENT";
      elements.recordDialogTitle.textContent = "V-Belt 교체 등록";
      elements.recordDateLabel.textContent = "V-Belt 교체일";
      elements.issueType.value = "정기주기";
      elements.actionType.value = "V-Belt 교체";
      elements.actionTypeField.hidden = true;
      elements.replacementRunningField.hidden = false;
      elements.replacementRunning.checked = false;
      elements.replacementStartupAt.value = formatKstDateTimeInput();
    }

    if (mode === "startup") {
      elements.recordDialogEyebrow.textContent = "CYCLE START";
      elements.recordDialogTitle.textContent = "실제 기동 등록";
      elements.recordDateLabel.textContent = "실제 기동일시";
      elements.recordDate.type = "datetime-local";
      elements.recordDate.value = formatKstDateTimeInput();
      const replacementAt = new Date(asset.lastReplacementAt);
      const runtimeAnchorAt = new Date(asset.cycleRuntimeAnchorAt);
      const explicitBoundaryAt = latestExplicitRuntimeBoundary(asset);
      const minimumStartupAt = [replacementAt, runtimeAnchorAt, explicitBoundaryAt]
        .filter(value => !Number.isNaN(value.getTime()))
        .sort((left, right) => right.getTime() - left.getTime())[0];
      elements.recordDate.min = !minimumStartupAt
        ? ""
        : formatKstDateTimeInput(minimumStartupAt);
      elements.recordDate.max = formatKstDateTimeInput();
      elements.issueTypeField.hidden = true;
      elements.actionTypeField.hidden = true;
    }

    if (mode === "problem") {
      elements.recordDialogEyebrow.textContent = "PROBLEM";
      elements.recordDialogTitle.textContent = "문제 발생 등록";
      elements.recordDateLabel.textContent = "발생일";
      elements.issueType.value = "기타";
      elements.actionType.value = "확인";
    }

    if (mode === "runtime") {
      elements.recordDialogEyebrow.textContent = "RUNTIME CORRECTION";
      elements.recordDialogTitle.textContent = "누적시간 직접 보정";
      elements.recordDate.closest(".field").hidden = true;
      elements.issueTypeField.hidden = true;
      elements.actionTypeField.hidden = true;
      elements.runtimeHoursField.hidden = false;
      elements.runtimeStateField.hidden = true;
      elements.runtimeHours.value = roundHours(asset.cycleElapsedHours ?? asset.runtimeHours).toFixed(1);
      elements.runtimeState.value = asset.isRunning ? "running" : "stopped";
    }

    if (mode === "runtime_state") {
      const targetRunning = candidate?.targetState === "running";
      const explicitBoundary = latestExplicitRuntimeBoundary(asset);
      const replacementAt = new Date(asset.lastReplacementAt);
      const startedAt = new Date(asset.cycleStartedAt);
      const minimumAt = explicitBoundary || (
        targetRunning
          ? new Date(asset.cycleRuntimeAnchorAt)
          : (String(asset.cycleStartState || "legacy") === "started" ? startedAt : null)
      );
      elements.recordDialogEyebrow.textContent = targetRunning ? "OPERATION START" : "OPERATION STOP";
      elements.recordDialogTitle.textContent = targetRunning ? "재기동 등록" : "정지 등록";
      elements.recordDateLabel.textContent = targetRunning ? "실제 재기동일시 (한국시간)" : "실제 정지일시 (한국시간)";
      elements.recordDate.type = "datetime-local";
      elements.recordDate.value = formatKstDateTimeInput();
      elements.recordDate.min = minimumAt && !Number.isNaN(minimumAt.getTime())
        ? formatKstDateTimeInput(minimumAt)
        : "";
      elements.recordDate.max = formatKstDateTimeInput();
      elements.issueTypeField.hidden = true;
      elements.actionTypeField.hidden = true;
      elements.runtimeStateField.hidden = true;
      elements.runtimeState.value = targetRunning ? "running" : "stopped";
      elements.runtimeCycleSummary.hidden = false;
      elements.runtimeCycleSummary.innerHTML = `
        <span>현재</span>
        <strong>${asset.isRunning ? "운전중" : "정지"} · 누적 ${escapeHtml(formatDaysHours(asset.cycleElapsedHours))}</strong>
        <small>${targetRunning
          ? "등록한 시각부터 정지 전 누적시간에 이어서 계산합니다."
          : "등록한 시각에 Cycle 경과·D-day·사용률·알림을 모두 고정합니다."}</small>
        <small>모든 입력·표시는 한국시간(KST) 기준입니다.</small>
        ${!targetRunning && String(asset.cycleStartState || "legacy") === "legacy" && !explicitBoundary
          ? `<small>최근 교체 전부터 정지였다면 실제 정지시각을 그대로 입력하세요. 현재 Cycle은 기동 대기·0시간으로 바로잡습니다.</small>`
          : minimumAt && !Number.isNaN(minimumAt.getTime())
            ? `<small>입력 가능: ${escapeHtml(formatKstDateTimeDisplay(minimumAt))} 이후</small>`
            : !Number.isNaN(replacementAt.getTime())
              ? `<small>최근 교체: ${escapeHtml(formatKstDateTimeDisplay(replacementAt))}</small>`
              : ""}
      `;
    }

    if (mode === "runtime_state_edit") {
      const editedEvent = candidate;
      const latestEvent = latestExplicitRuntimeEvent(asset);
      const expectedState = editedEvent?.eventType === "operation_stop" ? "stopped" : "running";
      const currentState = asset.isRunning ? "running" : "stopped";

      if (
        !editedEvent ||
        latestEvent?.id !== editedEvent.id ||
        !["operation_start", "operation_stop"].includes(editedEvent.eventType) ||
        editedEvent.sourceType !== "manual" ||
        String(asset.cycleStartState || "legacy") === "pending" ||
        expectedState !== currentState
      ) {
        showToast("현재 Cycle의 최신 수동 정지·재기동 이력만 수정할 수 있습니다.", "error");
        return;
      }

      const resetAvailable = canResetRuntimeEventToPending(asset, editedEvent);
      const resetShortcutAvailable = resetAvailable && previousExplicitRuntimeEvents(asset, editedEvent).length === 0;
      const dateInferenceAvailable = canInferRuntimeEventPendingByDate(asset, editedEvent);
      const minimumAt = runtimeEditMinimumAt(asset, editedEvent);
      const originalValue = formatKstDateTimeInput(new Date(editedEvent.eventDate));
      elements.recordEventId.value = editedEvent.id;
      elements.recordExpectedEventUpdatedAt.value = editedEvent.updatedAt || "";
      elements.recordDialogEyebrow.textContent = "OPERATION HISTORY EDIT";
      elements.recordDialogTitle.textContent = editedEvent.eventType === "operation_stop"
        ? "정지일시 수정"
        : "재기동일시 수정";
      elements.recordDateLabel.textContent = editedEvent.eventType === "operation_stop"
        ? "실제 정지일시 (한국시간)"
        : "실제 재기동일시 (한국시간)";
      elements.recordDate.type = "datetime-local";
      elements.recordDate.value = originalValue;
      elements.recordDate.min = dateInferenceAvailable
        ? ""
        : (minimumAt && !Number.isNaN(minimumAt.getTime()) ? formatKstDateTimeInput(minimumAt) : "");
      elements.recordDate.max = formatKstDateTimeInput();
      elements.issueTypeField.hidden = true;
      elements.actionTypeField.hidden = true;
      elements.runtimeStateField.hidden = true;
      elements.runtimeEditPendingField.hidden = !resetShortcutAvailable;
      elements.recordNoteLabel.textContent = "비고 / 수정 사유";
      elements.recordNote.value = editedEvent.note || "";
      elements.recordSaveButton.textContent = "수정 저장";
      state.runtimeEditOriginalDate = originalValue;
      updateRuntimeEditPreview();
    }

    if (mode === "candidate") {
      const replacement = candidate?.detectedType === "replacement";
      elements.recordDialogEyebrow.textContent = "AUTO DETECTION REVIEW";
      elements.recordDialogTitle.textContent = replacement ? "V-Belt 교체 감지 확인" : "문제 감지 확인";
      elements.recordDateLabel.textContent = replacement ? "V-Belt 교체일" : "발생일";
      elements.issueType.value = candidate?.issueType || (replacement ? "정기주기" : "기타");
      elements.actionType.value = candidate?.actionType || (replacement ? "V-Belt 교체" : "확인");
      elements.replacementRunningField.hidden = !replacement;
      elements.replacementRunning.checked = false;
      elements.replacementStartupAt.value = formatKstDateTimeInput();
      elements.candidateSourcePreview.hidden = false;
      elements.candidateSourcePreview.innerHTML = `
        <strong>업무일지 원문</strong><br>
        ${escapeHtml(candidate?.sourceText || "")}
      `;
    }

    elements.recordDialog.showModal();
  }

  function openSettingsDialog() {
    if (stopMobileMutation()) return;
    if (!hasAuthenticatedWriteAccess()) return;

    const type = getTypeDefinition();
    const setting = getActiveSetting();

    elements.settingsDialogTitle.textContent = `${type?.label || "Blower"} 교체주기 설정`;
    elements.cycleDays.value = setting?.cycleDays ?? "";
    elements.warningDays.value = setting?.warningDays ?? "";
    elements.criticalDays.value = setting?.criticalDays ?? "";
    elements.settingsDialog.showModal();
  }

  function assetTypeLabel(typeKey) {
    return state.data?.types?.find(type => type.key === typeKey)?.label || typeKey || "Blower";
  }

  function assetUnitLabel(unitNo) {
    if (unitNo === "1") return "#1호기";
    if (unitNo === "2") return "#2호기";
    if (unitNo === "shared") return "1·2호기 공용";
    return unitNo || "호기 미설정";
  }

  function suggestAssetDisplayName() {
    if (elements.assetManagerMode.value !== "create" || !state.assetManagerAutoName) return;
    const typeLabel = assetTypeLabel(elements.assetBlowerType.value);
    const unitLabel = elements.assetUnitNo.value === "shared"
      ? ""
      : `${assetUnitLabel(elements.assetUnitNo.value)} `;
    const groupLabel = elements.assetGroup.value === "manure" ? "축분 " : "";
    const position = elements.assetPositionLabel.value.trim();
    elements.assetDisplayName.value = `${unitLabel}${groupLabel}${typeLabel}${position ? ` ${position}` : ""}`.trim();
  }

  function syncAssetGroupOptions() {
    const manureOption = elements.assetGroup.querySelector('option[value="manure"]');
    const organic = elements.assetBlowerType.value === "organic_fuel";
    if (manureOption) manureOption.disabled = !organic;
    if (!organic && elements.assetGroup.value === "manure") elements.assetGroup.value = "";

    if (elements.assetManagerMode.value === "create" && elements.assetBlowerType.value === "flyash_silo") {
      elements.assetUnitNo.value = "shared";
    }

    syncAssetManagerVisibility();
    suggestAssetDisplayName();
  }

  function syncAssetManagerVisibility() {
    const createMode = elements.assetManagerMode.value === "create";
    const organicCreate = createMode && elements.assetBlowerType.value === "organic_fuel";

    elements.assetManagerDialog.dataset.mode = createMode ? "create" : "update";
    elements.assetManagerDialog.querySelectorAll(".asset-manager-create-only").forEach(field => {
      field.hidden = !createMode;
    });
    elements.assetGroupField.hidden = !organicCreate;

    if (createMode && !organicCreate) elements.assetGroup.value = "";

    elements.assetManagerDialogTitle.textContent = createMode ? "새 Blower 추가" : "Blower 정보 수정";
    elements.assetManagerDialogIntro.textContent = createMode
      ? "새 설비의 식별정보를 한 번 등록합니다. 등록 후 TAG와 위치는 잠깁니다."
      : "설비명·표시 순서·사용 상태만 간단히 관리합니다.";
    elements.assetManagerSaveButton.textContent = createMode ? "추가" : "저장";
    elements.assetManagerHelp.innerHTML = createMode
      ? "TAG·종류·호기·위치는 기존 이력 연결을 위해 추가 후 변경할 수 없습니다."
      : "TAG·종류·호기·그룹·위치는 그대로 보호됩니다. 사용 중지해도 기존 교체이력과 운전기록은 보존됩니다.";
  }

  function nextAssetSortOrder(blowerType) {
    const orders = (state.data?.assetCatalog || [])
      .filter(asset => asset.blowerType === blowerType)
      .map(asset => Number(asset.sortOrder || 0))
      .filter(Number.isFinite);
    return orders.length > 0 ? Math.min(9999, Math.max(...orders) + 1) : 1;
  }

  function populateAssetManagerTargets(selectedTag = "__new__") {
    const catalog = [...(state.data?.assetCatalog || [])].sort((left, right) => {
      const typeDifference = String(left.blowerType).localeCompare(String(right.blowerType));
      if (typeDifference !== 0) return typeDifference;
      const sortDifference = Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
      if (sortDifference !== 0) return sortDifference;
      return String(left.tagNumber).localeCompare(String(right.tagNumber));
    });

    elements.assetManagerTarget.innerHTML = [
      '<option value="__new__">＋ 새 Blower 추가</option>',
      ...catalog.map(asset => {
        const status = asset.enabled ? "" : " · 사용 중지";
        return `<option value="${escapeHtml(asset.tagNumber)}">${escapeHtml(assetTypeLabel(asset.blowerType))} · ${escapeHtml(assetUnitLabel(asset.unitNo))} · ${escapeHtml(asset.positionLabel)} · ${escapeHtml(asset.tagNumber)}${escapeHtml(status)}</option>`;
      })
    ].join("");

    elements.assetManagerTarget.value = catalog.some(asset => asset.tagNumber === selectedTag)
      ? selectedTag
      : "__new__";
  }

  function fillAssetManagerForm(tagNumber = "__new__") {
    const asset = (state.data?.assetCatalog || []).find(item => item.tagNumber === tagNumber) || null;
    elements.assetChangeNote.value = "";

    if (!asset) {
      state.assetManagerAutoName = true;
      elements.assetManagerMode.value = "create";
      elements.assetOriginalTag.value = "";
      elements.assetExpectedUpdatedAt.value = "";
      elements.assetBlowerType.disabled = false;
      elements.assetUnitNo.disabled = false;
      elements.assetGroup.disabled = false;
      elements.assetBlowerType.value = state.activeType;
      elements.assetUnitNo.value = state.activeType === "flyash_silo" ? "shared" : "1";
      elements.assetGroup.value = "";
      elements.assetPositionLabel.value = "";
      elements.assetPositionLabel.readOnly = false;
      elements.assetPositionLabel.classList.remove("is-readonly");
      elements.assetDisplayName.value = "";
      elements.assetTagNumber.value = "";
      elements.assetTagNumber.readOnly = false;
      elements.assetTagNumber.classList.remove("is-readonly");
      elements.assetSortOrder.value = String(nextAssetSortOrder(state.activeType));
      elements.assetEnabled.checked = true;
      elements.assetTagHelp.textContent = "TAG는 추가 후 교체이력 연결 보호를 위해 변경할 수 없습니다.";
      elements.assetManagerUpdated.textContent = "새 Blower는 가짜 교체일이나 운전시간 없이 추가됩니다.";
      syncAssetGroupOptions();
      return;
    }

    state.assetManagerAutoName = false;
    elements.assetManagerMode.value = "update";
    elements.assetOriginalTag.value = asset.tagNumber;
    elements.assetExpectedUpdatedAt.value = asset.updatedAt;
    elements.assetBlowerType.value = asset.blowerType;
    elements.assetUnitNo.value = asset.unitNo;
    elements.assetGroup.value = asset.assetGroup || "";
    elements.assetBlowerType.disabled = true;
    elements.assetUnitNo.disabled = true;
    elements.assetGroup.disabled = true;
    elements.assetPositionLabel.value = asset.positionLabel;
    elements.assetPositionLabel.readOnly = true;
    elements.assetPositionLabel.classList.add("is-readonly");
    elements.assetDisplayName.value = asset.displayName;
    elements.assetTagNumber.value = asset.tagNumber;
    elements.assetTagNumber.readOnly = true;
    elements.assetTagNumber.classList.add("is-readonly");
    elements.assetSortOrder.value = String(asset.sortOrder || 0);
    elements.assetEnabled.checked = Boolean(asset.enabled);
    elements.assetTagHelp.textContent = "기존 TAG·종류·호기·그룹·위치는 이력 보호를 위해 변경할 수 없습니다.";
    elements.assetManagerUpdated.textContent = asset.updatedAt
      ? `최근 변경 ${formatDate(asset.updatedAt)}${asset.lastModifiedByName ? ` · ${asset.lastModifiedByName}` : ""}`
      : "기존 설비정보 수정";
    syncAssetGroupOptions();
  }

  function openAssetManagerDialog() {
    if (stopMobileMutation()) return;
    if (!state.data?.user?.isSuperAdmin || !elements.assetManagerDialog) return;

    elements.assetBlowerType.innerHTML = (state.data.types || [])
      .map(type => `<option value="${escapeHtml(type.key)}">${escapeHtml(type.label)}</option>`)
      .join("");
    const activeCatalog = (state.data?.assetCatalog || [])
      .filter(asset => asset.blowerType === state.activeType)
      .sort((left, right) => {
        if (Boolean(left.enabled) !== Boolean(right.enabled)) return left.enabled ? -1 : 1;
        const sortDifference = Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
        return sortDifference || String(left.tagNumber).localeCompare(String(right.tagNumber));
      });
    const initialTag = activeCatalog[0]?.tagNumber || "__new__";
    populateAssetManagerTargets(initialTag);
    fillAssetManagerForm(initialTag);
    elements.assetManagerDialog.showModal();
  }

  function assetIdentityChanged(current, body) {
    if (!current) return false;
    return current.enabled && !body.enabled;
  }

  async function saveManagedAsset(event) {
    event.preventDefault();
    if (stopMobileMutation(event)) return;
    if (state.busy || !state.data?.user?.isSuperAdmin) return;

    const mode = elements.assetManagerMode.value;
    const current = (state.data?.assetCatalog || [])
      .find(asset => asset.tagNumber === elements.assetOriginalTag.value) || null;
    const body = {
      action: "asset_save",
      mode,
      originalTag: elements.assetOriginalTag.value,
      expectedUpdatedAt: elements.assetExpectedUpdatedAt.value,
      tagNumber: mode === "update" ? current?.tagNumber || "" : elements.assetTagNumber.value.trim().toUpperCase(),
      blowerType: mode === "update" ? current?.blowerType || "" : elements.assetBlowerType.value,
      unitNo: mode === "update" ? current?.unitNo || "" : elements.assetUnitNo.value,
      assetGroup: mode === "update" ? current?.assetGroup || "" : elements.assetGroup.value,
      positionLabel: mode === "update" ? current?.positionLabel || "" : elements.assetPositionLabel.value.trim(),
      displayName: elements.assetDisplayName.value.trim(),
      sortOrder: Number(elements.assetSortOrder.value),
      enabled: elements.assetEnabled.checked,
      changeNote: elements.assetChangeNote.value.trim()
    };

    if (assetIdentityChanged(current, body)) {
      const confirmed = window.confirm("이 Blower를 사용 중지하면 현황과 알림에서 제외됩니다. 기존 이력은 보존됩니다. 저장할까요?");
      if (!confirmed) return;
    }

    setBusy(true);
    elements.assetManagerSaveButton.disabled = true;

    try {
      const result = await apiRequest({ method: "POST", body });
      state.activeType = body.blowerType;
      elements.assetManagerDialog.close();
      showToast(result.message || "Blower 정보를 저장했습니다.");
      await loadData({ silent: true });
    } catch (error) {
      showToast(error.message || "Blower 정보를 저장하지 못했습니다.", "error");
      if (error?.code === "ASSET_EDIT_CONFLICT") {
        await loadData({ silent: true });
        populateAssetManagerTargets(body.originalTag);
        fillAssetManagerForm(body.originalTag);
      }
    } finally {
      elements.assetManagerSaveButton.disabled = false;
      setBusy(false);
    }
  }

  async function saveRecord(event) {
    event.preventDefault();
    if (stopMobileMutation(event)) return;
    if (state.busy) return;

    const mode = elements.recordMode.value;
    const tagNumber = elements.recordTag.value;
    setBusy(true);
    elements.recordSaveButton.disabled = true;

    try {
      let body;

      if (mode === "replacement") {
        body = {
          action: "replacement",
          tagNumber,
          eventDate: elements.recordDate.value,
          issueType: elements.issueType.value,
          actionType: "V-Belt 교체",
          startImmediately: elements.replacementRunning.checked,
          startupAt: elements.replacementRunning.checked ? kstDateTimeInputToIso(elements.replacementStartupAt.value) : "",
          note: elements.recordNote.value
        };
      } else if (mode === "startup") {
        const asset = findAsset(tagNumber);
        body = {
          action: "startup",
          tagNumber,
          eventDate: kstDateTimeInputToIso(elements.recordDate.value),
          expectedLastReplacementAt: asset?.lastReplacementAt || "",
          note: elements.recordNote.value
        };
      } else if (mode === "problem") {
        body = {
          action: "problem",
          tagNumber,
          eventDate: elements.recordDate.value,
          issueType: elements.issueType.value,
          actionType: elements.actionType.value,
          note: elements.recordNote.value
        };
      } else if (mode === "runtime") {
        body = {
          action: "runtime",
          tagNumber,
          runtimeHours: Number(elements.runtimeHours.value),
          isRunning: elements.runtimeState.value === "running",
          expectedCycleRuntimeRevision: findAsset(tagNumber)?.cycleRuntimeRevision || "",
          note: elements.recordNote.value
        };
      } else if (mode === "runtime_state") {
        const asset = findAsset(tagNumber);
        const targetRunning = elements.runtimeState.value === "running";
        const eventDate = kstDateTimeInputToIso(elements.recordDate.value);
        const eventAt = new Date(eventDate);
        const replacementAt = new Date(asset?.lastReplacementAt);
        const beforeReplacement = !targetRunning &&
          !Number.isNaN(eventAt.getTime()) &&
          !Number.isNaN(replacementAt.getTime()) &&
          eventAt < replacementAt;
        let initialCycleCorrection = false;

        if (beforeReplacement) {
          initialCycleCorrection = window.confirm(
            "입력한 정지시각은 최근 V-Belt 교체 전입니다.\n\n교체 당시 이미 정지 중이었던 것으로 반영하면 현재 V-Belt Cycle은 기동 대기·누적 0시간이 됩니다. 계속할까요?"
          );
          if (!initialCycleCorrection) return;
        }

        body = {
          action: "runtime_state",
          tagNumber,
          eventDate,
          isRunning: targetRunning,
          initialCycleCorrection,
          expectedCycleRuntimeRevision: asset?.cycleRuntimeRevision || "",
          note: elements.recordNote.value
        };
      } else if (mode === "runtime_state_edit") {
        const asset = findAsset(tagNumber);
        const editedEvent = findEvent(elements.recordEventId.value);
        const correctionAt = new Date(kstDateTimeInputToIso(elements.recordDate.value));
        const replacementAt = new Date(asset?.lastReplacementAt);
        const resetToStartupPending = elements.runtimeEditResetToPending.value === "true";
        const requiresZeroHourConfirmation = (
          resetToStartupPending ||
          (
            canInferRuntimeEventPendingByDate(asset, editedEvent) &&
            !Number.isNaN(correctionAt.getTime()) &&
            !Number.isNaN(replacementAt.getTime()) &&
            correctionAt <= replacementAt
          )
        );

        if (!asset || !editedEvent) {
          throw new Error("수정할 운전상태 이력을 찾을 수 없습니다.");
        }

        if (requiresZeroHourConfirmation) {
          const confirmed = window.confirm(
            "이 Blower는 최근 V-Belt 교체 당시부터 정지 상태였던 것으로 바로잡습니다.\n\n현재 Cycle은 기동 대기·누적 0시간이 되고, 다음 기동 등록 전까지 D-day·사용률·알림을 계산하지 않습니다. 계속할까요?"
          );
          if (!confirmed) return;
        }

        body = {
          action: "runtime_event_edit",
          tagNumber,
          eventId: editedEvent.id,
          eventDate: kstDateTimeInputToIso(elements.recordDate.value),
          resetToStartupPending,
          confirmRuntimeBoundaryOverride: resetToStartupPending,
          expectedEventUpdatedAt: elements.recordExpectedEventUpdatedAt.value,
          expectedCycleRuntimeRevision: asset.cycleRuntimeRevision || "",
          expectedLastReplacementAt: asset.lastReplacementAt || "",
          changeNote: elements.recordNote.value || "운전상태 이력 시각 수정",
          note: elements.recordNote.value
        };
      } else if (mode === "candidate") {
        body = {
          action: "candidate_review",
          id: elements.candidateId.value,
          decision: "confirm",
          eventDate: elements.recordDate.value,
          issueType: elements.issueType.value,
          actionType: elements.actionType.value,
          startImmediately: elements.replacementRunning.checked,
          startupAt: elements.replacementRunning.checked ? kstDateTimeInputToIso(elements.replacementStartupAt.value) : "",
          note: elements.recordNote.value
        };
      } else {
        throw new Error("등록 종류를 확인할 수 없습니다.");
      }

      const result = await apiRequest({ method: "POST", body });
      elements.recordDialog.close();
      showToast(result.message || "저장했습니다.");
      await loadData({ silent: true });
      if (mode === "runtime_state_edit") openAssetHistory(tagNumber);
    } catch (error) {
      console.error("Blower 이력 저장 실패:", error);
      showToast(error.message || "저장하지 못했습니다.", "error");
    } finally {
      elements.recordSaveButton.disabled = false;
      setBusy(false);
    }
  }

  async function saveSettings(event, clear = false) {
    event?.preventDefault?.();
    if (stopMobileMutation(event)) return;
    if (state.busy) return;

    const cycleDays = clear ? null : (elements.cycleDays.value === "" ? null : Number(elements.cycleDays.value));
    const warningDays = clear ? null : (elements.warningDays.value === "" ? null : Number(elements.warningDays.value));
    const criticalDays = clear ? null : (elements.criticalDays.value === "" ? null : Number(elements.criticalDays.value));

    setBusy(true);

    try {
      const result = await apiRequest({
        method: "POST",
        body: {
          action: "settings",
          blowerType: state.activeType,
          cycleDays,
          warningDays,
          criticalDays
        }
      });

      elements.settingsDialog.close();
      showToast(result.message || "교체주기를 저장했습니다.");
      await loadData({ silent: true });
    } catch (error) {
      showToast(error.message || "교체주기를 저장하지 못했습니다.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function downloadRecoveryV12Audits() {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
    const files = [
      ["confirmed", `blower-vbelt-v13-confirmed-${stamp}.json`],
      ["review", `blower-vbelt-v13-review-${stamp}.json`],
      ["unmatched", `blower-vbelt-v13-unmatched-${stamp}.json`]
    ];

    for (const [category, filename] of files) {
      const payload = await apiRequest({
        method: "POST",
        body: { action: "historical_recovery_v12_export", category }
      });
      downloadAuditJson(payload, filename);
      await waitForMilliseconds(180);
    }
  }

  async function requestRecoveryV12Step() {
    const waits = [1000, 2000, 4000, 8000];
    for (let attempt = 0; attempt <= waits.length; attempt += 1) {
      try {
        return await apiRequest({
          method: "POST",
          body: { action: "historical_recovery_v12_step" },
          timeoutMs: 20000
        });
      } catch (error) {
        const retryable = error?.retryable === true || [0, 429, 502, 503, 504].includes(Number(error?.status));
        if (!retryable || attempt >= waits.length) throw error;
        const waitMs = Math.min(15000, Math.max(300, Number(error?.retryAfterMs) || waits[attempt]));
        showToast(`V13 원문 조회 재시도 ${attempt + 1}/${waits.length}`);
        await waitForMilliseconds(waitMs);
      }
    }
    throw new Error("V13 재시도 횟수를 초과했습니다.");
  }

  async function runHistoricalBackfill() {
    if (stopMobileMutation()) return;
    if (
      state.busy
      || state.backfillRunning
      || !hasAuthenticatedWriteAccess()
      || !state.data?.user?.isSuperAdmin
    ) return;

    const recovery = state.data?.recoveryV12 || null;
    if (recovery?.status === "complete") {
      renderBackfillStatus(state.data?.backfill);
      showToast("V13 업무일지 문맥 복구가 이미 완료되어 있습니다.");
      return;
    }
    if (recovery?.status === "blocked") {
      showToast(recovery.message || "V13 문맥 검증이 안전 차단되었습니다. 감사자료를 확인해 주세요.", "error");
      try { await downloadRecoveryV12Audits(); } catch (auditError) { console.error(auditError); }
      return;
    }

    state.backfillRunning = true;
    elements.historicalBackfillButton.disabled = true;
    elements.historicalBackfillButton.textContent = "V13 검증·복구 중...";
    elements.overviewBackfillButton.disabled = true;
    elements.overviewBackfillButton.textContent = "V13 검증·복구 중...";
    elements.scanButton.disabled = true;
    elements.refreshButton.disabled = true;
    elements.auditHistoryButton.disabled = true;
    renderBackfillStatus(state.data?.backfill);
    let lastResult = null;

    try {
      let productiveSteps = 0;
      const recoveryStartedAt = Date.now();
      while (productiveSteps < 2000 && Date.now() - recoveryStartedAt < 30 * 60 * 1000) {
        lastResult = await requestRecoveryV12Step();
        const recovery = lastResult?.recovery;
        if (recovery) {
          const staged = Number(recovery.stagedEvents || 0).toLocaleString("ko-KR");
          const scanned = Number(recovery.scannedRows || 0).toLocaleString("ko-KR");
          const sourceLabel = recovery.sourceTable === "legacy_logs" ? "과거 업무일지" : "신규 업무일지";
          const cursor = Number(recovery.cursorRowId || 0).toLocaleString("ko-KR");
          elements.historicalBackfillNotice.hidden = false;
          elements.historicalBackfillNotice.dataset.state = recovery.status === "complete" ? "complete" : "running";
          elements.historicalBackfillNotice.textContent = `V13 ${recovery.status} · 확정 ${staged}건 · 원문 ${scanned}건 확인 · ${sourceLabel} #${cursor}`;
        }
        if (lastResult?.busy) {
          await waitForMilliseconds(700);
          continue;
        }
        productiveSteps += 1;
        if (lastResult.done) break;
        await waitForMilliseconds(30);
      }
      if (!lastResult?.done && productiveSteps >= 2000) {
        throw new Error("V13 자동 진행 한도에 도달했습니다. 현재 진행상태는 저장되어 있으며 다시 누르면 이어서 진행합니다.");
      }

      await loadData({ silent: true });

      if (lastResult?.done && lastResult?.applied) {
        showToast(`V13 업무일지 교체 이력 ${Number(lastResult?.recovery?.stagedEvents || 0).toLocaleString("ko-KR")}건 복구를 완료했습니다.`);
        try {
          await downloadRecoveryV12Audits();
        } catch (auditError) {
          console.error("V13 감사자료 내려받기 실패:", auditError);
          showToast("복구는 완료됐지만 감사자료 자동 내려받기에 실패했습니다.", "error");
        }
      } else if (lastResult?.busy) {
        showToast(lastResult.message || "다른 V13 복구 작업이 진행 중입니다.");
      } else {
        showToast(lastResult?.message || "V13 문맥 검증 진행상태를 저장했습니다.");
      }
    } catch (error) {
      console.error("Blower V13 문맥 복구 실패:", error);
      if (error?.payload?.blocked || error?.payload?.recovery?.status === "blocked") {
        try { await downloadRecoveryV12Audits(); } catch (auditError) { console.error(auditError); }
        showToast(error.message || "V13 문맥 검증이 안전 차단되었습니다. 기존 저장값은 유지됩니다.", "error");
      } else {
        showToast(error.message || "V13 업무일지 문맥 복구에 실패했습니다.", "error");
      }
      await loadData({ silent: true });
    } finally {
      state.backfillRunning = false;
      elements.historicalBackfillButton.disabled = state.busy;
      elements.historicalBackfillButton.textContent = "업무일지 이력 복구 V13";
      elements.overviewBackfillButton.disabled = state.busy;
      elements.overviewBackfillButton.textContent = "업무일지 이력 복구 V13";
      elements.scanButton.disabled = state.busy || shouldHideAutomaticData();
      elements.refreshButton.disabled = state.busy;
      elements.auditHistoryButton.disabled = state.busy || state.auditRunning;
      renderBackfillStatus();
    }
  }

  async function downloadHistoricalAudit() {
    if (stopMobileMutation()) return;
    if (
      state.busy
      || state.backfillRunning
      || state.auditRunning
      || !hasAuthenticatedWriteAccess()
      || !state.data?.user?.isSuperAdmin
    ) return;

    const startedAt = new Date().toISOString();
    const records = [];
    const apiDiagnostics = [];
    const batches = [];
    const retryEvents = [];
    const recordKeys = new Set();
    const visitedCursors = new Set();
    const auditTuning = {
      analysisLimit: null,
      scanLimit: null
    };
    let aggregateSummary = {};
    let cursor = null;
    let completed = false;
    let scannedRows = 0;

    state.auditRunning = true;
    setBusy(true);
    elements.auditHistoryButton.classList.add("is-running");
    elements.auditHistoryButton.textContent = "진단 중 · 0건";

    try {
      for (let batchIndex = 1; batchIndex <= 5000; batchIndex += 1) {
        const requestedCursor = cursor;
        const result = await requestHistoricalAuditStep(cursor, retry => {
          retryEvents.push({
            ...retry,
            cursor: requestedCursor
          });
          const waitSeconds = Math.max(1, Math.ceil(retry.waitMs / 1000));
          elements.auditHistoryButton.textContent =
            `서버 혼잡 · ${waitSeconds}초 후 재시도 (${retry.attempt}/${retry.maxAttempts})`;
        }, auditTuning);
        const batchRecords = Array.isArray(result.records) ? result.records : [];
        const batchSummary = isPlainObject(result.summary) ? result.summary : {};
        const batchScannedRows = Math.max(0, Number(result.scannedRows) || 0);
        let receivedRecords = 0;

        for (const record of batchRecords) {
          const recordKey = String(record?.key || JSON.stringify(record));
          if (recordKeys.has(recordKey)) continue;
          recordKeys.add(recordKey);
          records.push(record);
          receivedRecords += 1;
        }
        scannedRows += batchScannedRows;
        aggregateSummary = mergeAuditSummary(aggregateSummary, batchSummary);

        if (Array.isArray(result.diagnostics)) {
          apiDiagnostics.push(...result.diagnostics);
        } else if (result.diagnostics !== undefined && result.diagnostics !== null) {
          apiDiagnostics.push(result.diagnostics);
        }

        batches.push({
          batch: batchIndex,
          cursor: requestedCursor,
          scannedRows: batchScannedRows,
          analyzedRows: Math.max(0, Number(result.analyzedRows) || 0),
          receivedRecords,
          done: result.done === true,
          summary: batchSummary
        });
        elements.auditHistoryButton.textContent = `진단 중 · ${scannedRows.toLocaleString("ko-KR")}건`;

        if (result.done === true) {
          completed = true;
          break;
        }

        const nextCursor = result.nextCursor;
        const cursorKey = JSON.stringify(nextCursor ?? null);

        if (nextCursor === undefined || nextCursor === null || visitedCursors.has(cursorKey)) {
          throw new Error("누락 진단의 다음 조회 위치를 확인할 수 없습니다.");
        }

        visitedCursors.add(cursorKey);
        cursor = nextCursor;
        await waitForMilliseconds(250);
      }

      if (!completed) {
        throw new Error("누락 진단 조회 범위를 초과했습니다. 잠시 후 다시 시도해 주세요.");
      }

      const generatedAt = new Date().toISOString();
      const filename = `blower-vbelt-audit-${formatKstDownloadTimestamp()}.json`;
      const payload = {
        version: "v11-r2",
        generatedAt,
        summary: aggregateSummary,
        records,
        diagnostics: {
          readOnly: true,
          startedAt,
          completedAt: generatedAt,
          batchCount: batches.length,
          scannedRowCount: scannedRows,
          recordCount: records.length,
          finalTuning: auditTuning,
          retries: retryEvents,
          batches,
          api: apiDiagnostics
        }
      };

      downloadAuditJson(payload, filename);
      showToast(`누락 진단 ${records.length.toLocaleString("ko-KR")}건을 내려받았습니다.`);
    } catch (error) {
      console.error("Blower 누락 이력 진단 실패:", error);
      const failedAt = new Date().toISOString();
      const filename = `blower-vbelt-audit-partial-${formatKstDownloadTimestamp()}.json`;
      const payload = {
        version: "v11-r2",
        partial: true,
        generatedAt: failedAt,
        summary: aggregateSummary,
        records,
        diagnostics: {
          readOnly: true,
          startedAt,
          failedAt,
          failedCursor: cursor,
          batchCount: batches.length,
          scannedRowCount: scannedRows,
          recordCount: records.length,
          finalTuning: auditTuning,
          retries: retryEvents,
          batches,
          api: apiDiagnostics,
          error: {
            message: String(error?.message || "누락 진단 파일을 만들지 못했습니다."),
            status: Number(error?.status) || 0,
            code: String(error?.code || ""),
            cfRay: String(error?.cfRay || ""),
            diagnostics: isPlainObject(error?.payload?.diagnostics)
              ? error.payload.diagnostics
              : null
          }
        }
      };

      downloadAuditJson(payload, filename);
      showToast(
        `${error?.message || "누락 진단에 실패했습니다."} 부분 진단 파일을 내려받았습니다.`, "error"
      );
    } finally {
      state.auditRunning = false;
      elements.auditHistoryButton.classList.remove("is-running");
      elements.auditHistoryButton.textContent = "누락 진단";
      setBusy(false);
    }
  }

  async function scanShiftLogs() {
    if (stopMobileMutation()) return;
    if (state.busy) return;
    setBusy(true);
    elements.scanButton.textContent = "분석 중...";

    try {
      const days = Number(elements.scanDays.value) || 180;
      const result = await apiRequest({
        method: "POST",
        body: {
          action: "scan",
          days
        }
      });
      const operationResult = await apiRequest({
        method: "POST",
        body: {
          action: "operation_sync",
          days
        }
      });

      state.operationSyncCompleted = true;
      showToast(`${result.message} 새 후보 ${result.insertedCount || 0}건 · 교체운전 상태 ${operationResult.appliedStateChanges || 0}건`);
      await loadData({ silent: true, syncOperations: false });
    } catch (error) {
      showToast(error.message || "업무일지 분석에 실패했습니다.", "error");
    } finally {
      elements.scanButton.textContent = "업무일지 분석";
      setBusy(false);
    }
  }

  async function excludeCandidate(id) {
    if (stopMobileMutation()) return;
    if (state.busy) return;
    setBusy(true);

    try {
      const result = await apiRequest({
        method: "POST",
        body: {
          action: "candidate_review",
          id,
          decision: "exclude"
        }
      });

      showToast(result.message || "후보에서 제외했습니다.");
      await loadData({ silent: true });
    } catch (error) {
      showToast(error.message || "후보 제외에 실패했습니다.", "error");
    } finally {
      setBusy(false);
    }
  }

  function bindEvents() {
    elements.typeTabs.addEventListener("click", event => {
      const button = event.target.closest("[data-type]");
      if (button) switchType(button.dataset.type);
    });

    elements.statusFilters.addEventListener("click", event => {
      const button = event.target.closest("[data-status-filter]");
      if (!button) return;
      state.statusFilter = button.dataset.statusFilter || "all";
      renderStatusFilters();
      renderAssets();
    });

    document.querySelectorAll(".sub-tab").forEach(button => {
      button.addEventListener("click", () => switchSubview(button.dataset.subview));
    });

    elements.assetGroups.addEventListener("click", event => {
      const button = event.target.closest("[data-asset-action]");
      if (!button) return;
      if (button.dataset.assetAction === "history") {
        openAssetHistory(button.dataset.tag);
        return;
      }
      if (button.dataset.assetAction === "operation_toggle") {
        toggleAssetOperation(button.dataset.tag, button);
        return;
      }
      openRecordDialog(
        button.dataset.assetAction,
        button.dataset.tag,
        button.dataset.assetAction === "runtime_state"
          ? { targetState: button.dataset.targetState }
          : null
      );
    });

    elements.historyDialog.addEventListener("click", event => {
      const button = event.target.closest("[data-history-action]");
      if (!button || !state.historyAssetTag) return;
      const action = button.dataset.historyAction;
      const tagNumber = state.historyAssetTag;
      if (action === "runtime_state_edit") {
        const editedEvent = findEvent(button.dataset.eventId);
        if (!editedEvent) {
          showToast("수정할 운전상태 이력을 찾을 수 없습니다.", "error");
          return;
        }
        elements.historyDialog.close();
        openRecordDialog(action, tagNumber, editedEvent);
        return;
      }
      if (action === "runtime_state_add") {
        const targetState = button.dataset.targetState === "running" ? "running" : "stopped";
        elements.historyDialog.close();
        openRecordDialog("runtime_state", tagNumber, { targetState });
        return;
      }
      if (action === "startup") {
        elements.historyDialog.close();
        openRecordDialog("startup", tagNumber);
        return;
      }
      elements.historyDialog.close();
      openRecordDialog(action, tagNumber);
    });

    elements.historyFilter.addEventListener("change", renderHistory);

    elements.averagePeriodValue.addEventListener("change", () => {
      saveAveragePeriod();
      renderAverageStats();
    });
    elements.averagePeriodUnit.addEventListener("change", () => {
      saveAveragePeriod();
      renderAverageStats();
    });
    elements.settingsButton.addEventListener("click", openSettingsDialog);
    elements.assetManagerButton.addEventListener("click", openAssetManagerDialog);
    elements.auditHistoryButton.addEventListener("click", downloadHistoricalAudit);
    elements.refreshButton.addEventListener("click", () => loadData({ forceOperationSync: true }));
    elements.vibrationQueryButton.addEventListener("click", () => requestFbheVibrationShadow(false));
    elements.vibrationRequeryButton.addEventListener("click", () => requestFbheVibrationShadow(true));
    document.querySelectorAll("[data-vibration-preset]").forEach(button => {
      button.addEventListener("click", () => applyFbheVibrationPreset(button.dataset.vibrationPreset));
    });
    const handleVibrationRangeChange = () => {
      state.vibrationPreset = "custom";
      state.vibrationReport = null;
      state.vibrationReportRangeKey = selectedFbheVibrationRange().key;
      updateFbheVibrationPresetButtons();
      renderFbheVibrationShadow();
      if (elements.vibrationShadowPanel.open) {
        loadFbheVibrationShadowReport({ silent: true }).catch(() => null);
      }
    };
    elements.vibrationStartDate.addEventListener("change", handleVibrationRangeChange);
    elements.vibrationEndDate.addEventListener("change", handleVibrationRangeChange);
    elements.vibrationShadowPanel.addEventListener("toggle", () => {
      if (elements.vibrationShadowPanel.open && !state.vibrationPolling) {
        loadFbheVibrationShadowReport({ silent: true }).catch(() => null);
      }
    });
    elements.scanButton.addEventListener("click", scanShiftLogs);
    elements.historicalBackfillButton.addEventListener("click", runHistoricalBackfill);
    elements.overviewBackfillButton.addEventListener("click", runHistoricalBackfill);

    elements.candidateList.addEventListener("click", event => {
      const button = event.target.closest("[data-candidate-action]");
      if (!button) return;

      const candidate = (state.data?.candidates || []).find(item => item.id === button.dataset.id);
      if (!candidate) return;

      if (button.dataset.candidateAction === "exclude") {
        excludeCandidate(candidate.id);
        return;
      }

      openRecordDialog("candidate", candidate.tagNumber, candidate);
    });

    elements.recordForm.addEventListener("submit", saveRecord);
    elements.runtimeEditPendingButton.addEventListener("click", toggleRuntimeEditStartupPending);
    elements.recordDate.addEventListener("input", updateRuntimeEditPreview);
    elements.recordDate.addEventListener("change", updateRuntimeEditPreview);
    elements.replacementRunning.addEventListener("change", () => {
      elements.replacementStartupAtField.hidden = !elements.replacementRunning.checked;
      elements.replacementStartupAt.required = elements.replacementRunning.checked;
      if (elements.replacementRunning.checked && !elements.replacementStartupAt.value) {
        elements.replacementStartupAt.value = formatKstDateTimeInput();
      }
    });
    elements.settingsForm.addEventListener("submit", saveSettings);
    elements.assetManagerForm.addEventListener("submit", saveManagedAsset);
    elements.assetManagerTarget.addEventListener("change", () => {
      fillAssetManagerForm(elements.assetManagerTarget.value);
    });
    elements.assetBlowerType.addEventListener("change", () => {
      if (elements.assetManagerMode.value === "create") {
        elements.assetSortOrder.value = String(nextAssetSortOrder(elements.assetBlowerType.value));
      }
      syncAssetGroupOptions();
    });
    elements.assetUnitNo.addEventListener("change", suggestAssetDisplayName);
    elements.assetGroup.addEventListener("change", suggestAssetDisplayName);
    elements.assetPositionLabel.addEventListener("input", suggestAssetDisplayName);
    elements.assetDisplayName.addEventListener("input", () => {
      if (elements.assetManagerMode.value === "create") state.assetManagerAutoName = false;
    });
    elements.clearSettingsButton.addEventListener("click", () => saveSettings(null, true));

    document.addEventListener("click", event => {
      const button = event.target.closest("[data-close-dialog]");
      if (!button) return;
      const dialog = byId(button.dataset.closeDialog);
      dialog?.close();
    });

  }

  async function initialize() {
    cacheElements();
    elements.vibrationStartDate.max = maximumFbheVibrationDate();
    elements.vibrationEndDate.max = maximumFbheVibrationDate();
    applySavedAveragePeriod();
    bindEvents();
    applyMobileMonitoringMode();

    const mobileMedia = window.matchMedia?.(MOBILE_MONITORING_QUERY);
    const handleMobileModeChange = () => {
      if (state.data) renderAll();
      else applyMobileMonitoringMode();
    };
    if (mobileMedia?.addEventListener) mobileMedia.addEventListener("change", handleMobileModeChange);
    else mobileMedia?.addListener?.(handleMobileModeChange);

    switchSubview("overview");
    await loadData();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
