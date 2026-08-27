"use strict";

(() => {
  const API_URL = "/api/blower-history";
  const AUTH_STORAGE_KEY = "gsShiftLog.currentUser";
  const AVERAGE_PERIOD_STORAGE_KEY = "gsShiftLog.blowerHistory.averagePeriod";

  const state = {
    data: null,
    activeType: "fbhe",
    statusFilter: "all",
    historyAssetTag: "",
    subview: "overview",
    busy: false,
    backfillRunning: false,
    auditRunning: false
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
      "settingsButton",
      "missingTagsNotice",
      "averagePanel",
      "averageHeadline",
      "averageSubline",
      "averagePeriodValue",
      "averagePeriodUnit",
      "averageMetrics",
      "averageAssets",
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
      "closeButton",
      "recordDialog",
      "recordForm",
      "recordMode",
      "recordTag",
      "candidateId",
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
      "runtimeHoursField",
      "runtimeHours",
      "runtimeStateField",
      "runtimeState",
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
      "historyDialog",
      "historyDialogTitle",
      "historyDialogAsset",
      "historyCycleSummary",
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
      ...extra,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
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
    let response;

    try {
      response = await fetch(options.url || API_URL, {
        method,
        headers: getAuthHeaders(
          options.body
            ? { "Content-Type": "application/json; charset=utf-8" }
            : {}
        ),
        cache: "no-store",
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    } catch (cause) {
      const error = new Error("서버에 연결할 수 없습니다.");
      error.status = 0;
      error.code = "NETWORK_ERROR";
      error.retryable = true;
      error.cause = cause;
      throw error;
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

  function formatKstDateInput(date = new Date()) {
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

  function formatSignedRemaining(asset) {
    if (!asset.lastReplacementAt) return "확정된 V-Belt 교체 이력이 없습니다.";
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
      unset: "기준 미설정",
      unknown: "교체일 미확인"
    }[severity] || "확인 필요";
  }

  function displaySeverity(asset) {
    if (!asset?.lastReplacementAt) return "unknown";
    if (isAssetAwaitingBackfill(asset)) return "unknown";
    return ["normal", "warning", "critical", "overdue", "unset"].includes(asset.severity)
      ? asset.severity
      : "normal";
  }

  function eventLabel(type) {
    return {
      replacement: "V-Belt 교체",
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

    elements.typeTabs.innerHTML = (state.data.types || [])
      .map(type => {
        const active = type.key === state.activeType;
        const typeAlerts = (state.data.assets || []).filter(
          asset => asset.blowerType === type.key && ["warning", "critical", "overdue"].includes(displaySeverity(asset))
        ).length;

        return `
          <button
            type="button"
            class="type-tab${active ? " is-active" : ""}${type.important ? " is-important" : ""}"
            data-type="${escapeHtml(type.key)}"
            aria-pressed="${active ? "true" : "false"}"
            ${active ? 'aria-current="page"' : ""}
          >
            ${escapeHtml(type.label)}${typeAlerts > 0 ? ` · ${typeAlerts}` : ""}
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

    elements.activeTypeTitle.textContent = type?.label || "Blower";

    if (!setting || !(Number(setting.cycleDays) > 0)) {
      elements.settingsSummary.textContent = "교체주기 미설정";
      elements.settingsUpdated.textContent = "";
    } else {
      const cycleHours = Number(setting.cycleDays) * 24;
      elements.settingsSummary.textContent = [
        `${setting.cycleDays}일 (${cycleHours.toLocaleString("ko-KR")}h)`,
        `예정 D-${setting.warningDays}`,
        `임박 D-${setting.criticalDays}`
      ].join(" · ");

      elements.settingsUpdated.textContent = setting.updatedAt
        ? `최근 변경 ${formatDate(setting.updatedAt)}${setting.updatedByName ? ` · ${setting.updatedByName}` : ""}`
        : "";
    }

    elements.settingsButton.hidden = !state.data?.user?.isAdmin;
  }

  function renderHeaderActions() {
    elements.auditHistoryButton.hidden = !state.data?.user?.isSuperAdmin;
  }

  function renderMissingTags() {
    const missing = (state.data?.missingTags || []).filter(item => item.blowerType === state.activeType);

    if (missing.length === 0) {
      elements.missingTagsNotice.hidden = true;
      elements.missingTagsNotice.textContent = "";
      return;
    }

    elements.missingTagsNotice.hidden = false;
    elements.missingTagsNotice.innerHTML = `
      <strong>TAG 확인 대기</strong>
      <span>${missing.map(item => {
        const unitLabel = item.unitNo === "shared" ? "공용" : `#${item.unitNo}호기`;
        return `${escapeHtml(unitLabel)} ${item.missingCount}대`;
      }).join(" · ")}</span>
      <small>정확한 전체 TAG가 업무일지에서 확인되면 자동 등록됩니다.</small>
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
    return ["shift_log_auto", "shift_log_history_auto", "shift_log_history_v12"].includes(event?.sourceType);
  }

  function readableEvidence(event) {
    if (!event) return "";

    const raw = String(
      isShiftLogEvent(event)
        ? (event.sourceText || event.note || "")
        : (event.note || event.sourceText || "")
    )
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

    if (isShiftLogEvent(event) && !replacementFragment) return "";

    const text = replacementFragment || fragments.join(" · ") || raw;

    return text.length > 180 ? `${text.slice(0, 177).trim()}…` : text;
  }

  function renderAssetCard(asset, setting) {
    const cycleDays = Number(setting?.cycleDays);
    const cycleElapsedHours = roundHours(asset.cycleElapsedHours);
    const replacementEvent = asset.lastReplacementAt ? getLatestReplacementEvent(asset) : null;
    const awaitingBackfill = isAssetAwaitingBackfill(asset);
    const confirmed = Boolean(asset.lastReplacementAt) && !awaitingBackfill;
    const severity = displaySeverity(asset);
    const evidence = readableEvidence(replacementEvent);
    const cycleHours = cycleDays > 0 ? cycleDays * 24 : null;
    const progress = cycleHours
      ? Math.max(0, Math.min(100, (cycleElapsedHours / cycleHours) * 100))
      : 0;
    const cycleHeadline = cycleHours
      ? `교체 후 ${formatDaysHours(cycleElapsedHours)} / ${cycleDays.toLocaleString("ko-KR")}일`
      : `교체 후 ${formatDaysHours(cycleElapsedHours)}`;

    return `
      <article class="asset-card" data-severity="${escapeHtml(severity)}" data-tag="${escapeHtml(asset.tagNumber)}">
        <div class="asset-card-header">
          <div class="asset-identity">
            <strong class="asset-position">${escapeHtml(asset.positionLabel)}</strong>
            <span class="asset-tag">${escapeHtml(asset.tagNumber)}</span>
          </div>
          <span class="status-pill ${escapeHtml(severity)}">${escapeHtml(awaitingBackfill ? "재구성 대기" : severityLabel(severity))}</span>
        </div>

        ${confirmed ? `
          <div class="runtime-main">
            <span class="cycle-label">현재 교체주기</span>
            <strong>${escapeHtml(cycleHeadline)}</strong>
            <small>${escapeHtml(formatSignedRemaining(asset))}</small>
            ${cycleHours ? `
              <div class="progress-caption">
                <span>${escapeHtml(formatDaysHours(cycleElapsedHours))}</span>
                <span>${cycleDays.toLocaleString("ko-KR")}일</span>
              </div>
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
            ` : ""}
          </div>

          <div class="asset-meta">
            <div><span>최근 교체</span><strong>${escapeHtml(formatDate(asset.lastReplacementAt))}</strong></div>
            <div><span>계산 기준</span><strong>교체일 기준 자동계산</strong></div>
          </div>

          <div class="asset-evidence${evidence ? "" : " is-empty"}">
            <span>${isShiftLogEvent(replacementEvent) ? "업무일지 근거" : "등록 근거"}</span>
            <p>${escapeHtml(evidence || "교체 이력은 확인되었지만 등록된 근거 문장이 없습니다.")}</p>
            ${replacementEvent ? `<small>${escapeHtml(formatDate(replacementEvent.eventDate))} · ${escapeHtml(historySourceLabel(replacementEvent))}</small>` : ""}
          </div>
        ` : awaitingBackfill ? `
          <div class="unknown-cycle is-rebuild-pending">
            <strong>자동 이력 재확인 중</strong>
            <p>V12 확정 복구 후 교체일과 경과시간을 표시합니다.</p>
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
          <button type="button" class="asset-action primary" data-asset-action="replacement" data-tag="${escapeHtml(asset.tagNumber)}">V-Belt 교체 등록</button>
          <button type="button" class="asset-action" data-asset-action="history" data-tag="${escapeHtml(asset.tagNumber)}">이력 보기</button>
          <details class="asset-more">
            <summary aria-label="추가 관리 메뉴">•••</summary>
            <div class="asset-more-menu">
              <button type="button" data-asset-action="runtime" data-tag="${escapeHtml(asset.tagNumber)}">운전시간/상태 보정</button>
            </div>
          </details>
        </div>
      </article>
    `;
  }

  function renderMissingAssetCard(slot) {
    return `
      <article class="asset-card is-placeholder" data-severity="unknown">
        <div class="asset-card-header">
          <div class="asset-identity">
            <strong class="asset-position">${escapeHtml(slot.positionLabel)}</strong>
            <span class="asset-tag">TAG 자동확인 대기</span>
          </div>
          <span class="status-pill unknown">TAG 미확인</span>
        </div>

        <div class="placeholder-note">
          정확한 전체 TAG가 업무일지에서 확인되면 설비 카드로 자동 전환됩니다.
        </div>
      </article>
    `;
  }

  function renderAssets() {
    const assets = getActiveAssets();
    const missingSlots = getActiveMissingSlots();
    const setting = getActiveSetting();
    const groupOrder = ["1", "2", "shared"];
    const groups = new Map();
    const missingGroups = new Map();

    for (const asset of assets) {
      if (!groups.has(asset.unitNo)) groups.set(asset.unitNo, []);
      groups.get(asset.unitNo).push(asset);
    }

    for (const slot of missingSlots) {
      if (!missingGroups.has(slot.unitNo)) missingGroups.set(slot.unitNo, []);
      missingGroups.get(slot.unitNo).push(slot);
    }

    const html = groupOrder
      .filter(unitNo => groups.has(unitNo) || missingGroups.has(unitNo))
      .map(unitNo => {
        const label = unitNo === "shared" ? "#1 · #2호기 공용" : `#${unitNo}호기`;
        const actualCards = (groups.get(unitNo) || [])
          .filter(asset => state.statusFilter === "all" || displaySeverity(asset) === state.statusFilter)
          .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder))
          .map(asset => renderAssetCard(asset, setting));
        const placeholderCards = (missingGroups.get(unitNo) || [])
          .filter(() => ["all", "unknown"].includes(state.statusFilter))
          .sort((a, b) => String(a.positionLabel).localeCompare(String(b.positionLabel)))
          .map(renderMissingAssetCard);
        const visibleCards = [...actualCards, ...placeholderCards];
        const cards = visibleCards.join("");

        if (!cards) return "";

        return `
          <section class="unit-group">
            <h3 class="unit-heading">${escapeHtml(label)} <span>${actualCards.length + placeholderCards.length}대</span></h3>
            <div class="asset-grid${visibleCards.length === 2 ? " is-two" : visibleCards.length === 1 ? " is-single" : ""}">${cards}</div>
          </section>
        `;
      })
      .join("");

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
    if (event.sourceType === "shift_log_history_auto") {
      return "업무일지 과거 자동반영";
    }

    if (event.sourceType === "shift_log_auto") {
      return "업무일지 자동감지";
    }

    return "수동";
  }

  function historyRuntimeLabel(event) {
    if (event.sourceType === "shift_log_history_auto") {
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

    const evidence = readableEvidence(event);
    if (evidence) return evidence;
    if (isShiftLogEvent(event)) return "업무일지 교체 근거 확인 필요";
    return event?.note || event?.sourceText || "-";
  }

  function renderHistory() {
    const filter = elements.historyFilter?.value || "replacement";
    const events = getVisibleEvents().filter(event => {
      if (event.blowerType !== state.activeType) return false;
      return filter === "all" || event.eventType === filter;
    });

    elements.historyEmpty.hidden = events.length > 0;
    elements.historyEmpty.textContent = shouldHideAutomaticData()
      ? "초기 재구성 완료 전에는 수동 등록 이력만 표시합니다."
      : "등록된 이력이 없습니다.";
    elements.historyBody.innerHTML = events
      .map(event => `
        <tr>
          <td>${escapeHtml(formatDate(event.eventDate))}</td>
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
    const events = getAssetEvents(tagNumber)
      .filter(event => event.eventType === "replacement");

    elements.historyDialogTitle.textContent = `${asset.positionLabel} 이력`;
    elements.historyDialogAsset.textContent = `${asset.displayName} · ${asset.tagNumber}`;
    elements.historyCycleSummary.innerHTML = asset.lastReplacementAt && !awaitingBackfill
      ? `
        <span class="status-pill ${escapeHtml(severity)}">${escapeHtml(severityLabel(severity))}</span>
        <div><span>최근 V-Belt 교체</span><strong>${escapeHtml(formatDate(asset.lastReplacementAt))}</strong></div>
        <div><span>교체 후 경과시간</span><strong>${escapeHtml(formatDaysHours(asset.cycleElapsedHours))}</strong></div>
        <div><span>현재 주기</span><strong>${escapeHtml(formatSignedRemaining(asset))}</strong></div>
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

    elements.assetHistoryList.innerHTML = events.length
      ? events.map(event => {
          const content = displayEventContent(event) || "등록 내용 없음";
          const detail = [event.issueType, event.actionType].filter(Boolean).join(" → ");

          return `
            <article class="asset-history-item">
              <div class="asset-history-date">${escapeHtml(formatDate(event.eventDate))}</div>
              <div class="asset-history-content">
                <div class="asset-history-heading">
                  <span class="event-badge ${escapeHtml(event.eventType)}">${escapeHtml(eventLabel(event.eventType))}</span>
                  ${detail ? `<strong>${escapeHtml(detail)}</strong>` : ""}
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
          <strong>V12 확정 이력 복구를 먼저 완료해 주세요.</strong>
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
            <button type="button" class="button primary" data-candidate-action="confirm" data-id="${escapeHtml(candidate.id)}">확인/수정</button>
            <button type="button" class="button secondary" data-candidate-action="exclude" data-id="${escapeHtml(candidate.id)}">제외</button>
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
    const expected = Number(recovery?.expectedEvents || 76);
    const scanned = Number(recovery?.scannedRows || 0);
    const showOverviewCallout = !recoveryComplete || state.backfillRunning;

    elements.historicalBackfillButton.hidden = !isSuperAdmin;
    elements.overviewBackfillButton.hidden = !isSuperAdmin;
    elements.overviewBackfillCallout.hidden = !showOverviewCallout;
    elements.overviewBackfillCallout.classList.toggle("is-catchup", false);

    if (showOverviewCallout) {
      elements.overviewBackfillTitle.textContent = recoveryBlocked
        ? "V12 안전 차단"
        : "확정 교체 이력 복구 필요";
      elements.overviewBackfillSummary.textContent = state.backfillRunning
        ? `업무일지 원문을 V12 기준으로 검증하고 있습니다. 확정 ${staged}/${expected}건 · 원문 ${scanned.toLocaleString("ko-KR")}건 확인`
        : recoveryBlocked
          ? (recovery?.message || `확정 ${staged}/${expected}건으로 기대값과 달라 기존 저장값을 유지했습니다.`)
          : isSuperAdmin
            ? "기존 과거 재구성 완료 여부와 관계없이 V12 전용 검증을 별도로 실행합니다. 확정 76건이 맞을 때만 기존 자동 교체 이력을 교체합니다."
            : "최고관리자의 V12 확정 복구가 완료되면 검증된 교체주기가 표시됩니다.";

      const buttonLabel = state.backfillRunning
        ? "V12 검증·복구 중..."
        : recoveryBlocked
          ? "V12 감사자료 확인"
          : recoveryStarted
            ? "V12 이어서 복구"
            : "확정 이력 복구 V12";
      elements.overviewBackfillButton.textContent = buttonLabel;
      elements.historicalBackfillButton.textContent = buttonLabel;
    }

    notice.hidden = false;

    if (state.backfillRunning) {
      notice.dataset.state = "running";
      notice.textContent = `V12 확정 복구 진행 중 · 확정 ${staged}/${expected}건 · 원문 ${scanned.toLocaleString("ko-KR")}건 확인`;
      return;
    }

    if (recoveryComplete) {
      notice.dataset.state = "complete";
      notice.textContent = `V12 확정 복구 완료 · 교체 이력 ${staged}건 반영`;
      return;
    }

    if (recoveryBlocked) {
      notice.dataset.state = "required";
      notice.textContent = `V12 안전 차단 · 확정 ${staged}/${expected}건 · 기존 저장 이력 유지`;
      return;
    }

    if (recoveryStarted) {
      notice.dataset.state = "required";
      notice.textContent = `V12 확정 복구 필요 · 확정 ${staged}/${expected}건 · 원문 ${scanned.toLocaleString("ko-KR")}건 확인 · 이어서 실행 가능`;
      return;
    }

    notice.dataset.state = "required";
    notice.textContent = "V12 확정 복구 필요 · 아직 V12 전용 검증을 실행하지 않음";
  }

  function renderAll() {
    if (!state.data) return;

    renderHeaderActions();
    renderTypeTabs();
    renderStatusFilters();
    renderSettings();
    renderAverageStats();
    renderMissingTags();
    renderAssets();
    renderHistory();
    renderCandidates();
    renderBackfillStatus();
  }

  function setBusy(isBusy) {
    state.busy = Boolean(isBusy);
    elements.refreshButton.disabled = state.busy;
    elements.scanButton.disabled = state.busy || shouldHideAutomaticData();
    elements.historicalBackfillButton.disabled = state.busy || state.backfillRunning;
    elements.overviewBackfillButton.disabled = state.busy || state.backfillRunning;
    elements.auditHistoryButton.disabled = state.busy || state.backfillRunning || state.auditRunning;
  }

  async function loadData(options = {}) {
    if (!getSessionToken()) {
      elements.authNotice.hidden = false;
      elements.authNotice.textContent = "업무일지 로그인 세션을 확인할 수 없습니다. 업무일지에서 로그인한 뒤 다시 열어 주세요.";
      return;
    }

    if (!options.silent) setBusy(true);

    try {
      const data = await apiRequest();
      state.data = data;
      elements.authNotice.hidden = true;

      if (!(data.types || []).some(type => type.key === state.activeType)) {
        state.activeType = "fbhe";
      }

      renderAll();
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

  function resetRecordDialogVisibility() {
    const dateField = elements.recordDate?.closest(".field");
    if (dateField) dateField.hidden = false;
    elements.issueTypeField.hidden = false;
    elements.actionTypeField.hidden = false;
    elements.replacementRunningField.hidden = true;
    elements.runtimeHoursField.hidden = true;
    elements.runtimeStateField.hidden = true;
    elements.candidateSourcePreview.hidden = true;
  }

  function openRecordDialog(mode, tagNumber, candidate = null) {
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
      elements.replacementRunning.checked = Boolean(asset.isRunning);
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
      elements.recordDialogTitle.textContent = "운전시간 / 상태 보정";
      elements.recordDate.closest(".field").hidden = true;
      elements.issueTypeField.hidden = true;
      elements.actionTypeField.hidden = true;
      elements.runtimeHoursField.hidden = false;
      elements.runtimeStateField.hidden = false;
      elements.runtimeHours.value = roundHours(asset.runtimeHours).toFixed(1);
      elements.runtimeState.value = asset.isRunning ? "running" : "stopped";
    }

    if (mode === "candidate") {
      const replacement = candidate?.detectedType === "replacement";
      elements.recordDialogEyebrow.textContent = "AUTO DETECTION REVIEW";
      elements.recordDialogTitle.textContent = replacement ? "V-Belt 교체 감지 확인" : "문제 감지 확인";
      elements.recordDateLabel.textContent = replacement ? "V-Belt 교체일" : "발생일";
      elements.issueType.value = candidate?.issueType || (replacement ? "정기주기" : "기타");
      elements.actionType.value = candidate?.actionType || (replacement ? "V-Belt 교체" : "확인");
      elements.replacementRunningField.hidden = !replacement;
      elements.replacementRunning.checked = Boolean(asset.isRunning);
      elements.candidateSourcePreview.hidden = false;
      elements.candidateSourcePreview.innerHTML = `
        <strong>업무일지 원문</strong><br>
        ${escapeHtml(candidate?.sourceText || "")}
      `;
    }

    elements.recordDialog.showModal();
  }

  function openSettingsDialog() {
    if (!state.data?.user?.isAdmin) return;

    const type = getTypeDefinition();
    const setting = getActiveSetting();

    elements.settingsDialogTitle.textContent = `${type?.label || "Blower"} 교체주기 설정`;
    elements.cycleDays.value = setting?.cycleDays ?? "";
    elements.warningDays.value = setting?.warningDays ?? "";
    elements.criticalDays.value = setting?.criticalDays ?? "";
    elements.settingsDialog.showModal();
  }

  async function saveRecord(event) {
    event.preventDefault();
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
          isRunning: elements.replacementRunning.checked,
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
          isRunning: elements.replacementRunning.checked,
          note: elements.recordNote.value
        };
      } else {
        throw new Error("등록 종류를 확인할 수 없습니다.");
      }

      const result = await apiRequest({ method: "POST", body });
      elements.recordDialog.close();
      showToast(result.message || "저장했습니다.");
      await loadData({ silent: true });
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
      ["confirmed", `blower-vbelt-v12-confirmed-${stamp}.json`],
      ["review", `blower-vbelt-v12-review-${stamp}.json`],
      ["unmatched", `blower-vbelt-v12-unmatched-${stamp}.json`]
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
          body: { action: "historical_recovery_v12_step" }
        });
      } catch (error) {
        const retryable = error?.retryable === true || [0, 429, 502, 503, 504].includes(Number(error?.status));
        if (!retryable || attempt >= waits.length) throw error;
        const waitMs = Math.min(15000, Math.max(300, Number(error?.retryAfterMs) || waits[attempt]));
        showToast(`V12 원문 조회 재시도 ${attempt + 1}/${waits.length}`);
        await waitForMilliseconds(waitMs);
      }
    }
    throw new Error("V12 재시도 횟수를 초과했습니다.");
  }

  async function runHistoricalBackfill() {
    if (
      state.busy
      || state.backfillRunning
      || !getSessionToken()
      || !state.data?.user?.isSuperAdmin
    ) return;

    const recovery = state.data?.recoveryV12 || null;
    if (recovery?.status === "complete") {
      renderBackfillStatus(state.data?.backfill);
      showToast("V12 확정 복구가 이미 완료되어 있습니다.");
      return;
    }
    if (recovery?.status === "blocked") {
      showToast(recovery.message || "V12 사전검증이 안전 차단되었습니다. 감사자료를 확인해 주세요.", "error");
      try { await downloadRecoveryV12Audits(); } catch (auditError) { console.error(auditError); }
      return;
    }

    state.backfillRunning = true;
    elements.historicalBackfillButton.disabled = true;
    elements.historicalBackfillButton.textContent = "V12 검증·복구 중...";
    elements.overviewBackfillButton.disabled = true;
    elements.overviewBackfillButton.textContent = "V12 검증·복구 중...";
    elements.scanButton.disabled = true;
    elements.refreshButton.disabled = true;
    elements.auditHistoryButton.disabled = true;
    renderBackfillStatus(state.data?.backfill);
    let lastResult = null;

    try {
      for (let step = 0; step < 1000; step += 1) {
        lastResult = await requestRecoveryV12Step();
        const recovery = lastResult?.recovery;
        if (recovery) {
          const staged = Number(recovery.stagedEvents || 0).toLocaleString("ko-KR");
          const expected = Number(recovery.expectedEvents || 76).toLocaleString("ko-KR");
          elements.historicalBackfillNotice.hidden = false;
          elements.historicalBackfillNotice.dataset.state = recovery.status === "complete" ? "complete" : "running";
          elements.historicalBackfillNotice.textContent = `V12 ${recovery.status} · 확정 ${staged}/${expected}건 · 원문 ${Number(recovery.scannedRows || 0).toLocaleString("ko-KR")}건 확인`;
        }
        if (lastResult.done || lastResult.busy) break;
      }

      await loadData({ silent: true });

      if (lastResult?.done && lastResult?.applied) {
        showToast("V12 확정 교체 이력 76건 복구를 완료했습니다.");
        try {
          await downloadRecoveryV12Audits();
        } catch (auditError) {
          console.error("V12 감사자료 내려받기 실패:", auditError);
          showToast("복구는 완료됐지만 감사자료 자동 내려받기에 실패했습니다.", "error");
        }
      } else if (lastResult?.busy) {
        showToast(lastResult.message || "다른 V12 복구 작업이 진행 중입니다.");
      } else {
        showToast(lastResult?.message || "V12 사전검증 진행상태를 저장했습니다.");
      }
    } catch (error) {
      console.error("Blower V12 확정 복구 실패:", error);
      if (error?.payload?.blocked || error?.payload?.recovery?.status === "blocked") {
        try { await downloadRecoveryV12Audits(); } catch (auditError) { console.error(auditError); }
        showToast(error.message || "확정 건수가 76건과 달라 안전 차단했습니다. 기존 저장값은 유지됩니다.", "error");
      } else {
        showToast(error.message || "V12 확정 복구에 실패했습니다.", "error");
      }
      await loadData({ silent: true });
    } finally {
      state.backfillRunning = false;
      elements.historicalBackfillButton.disabled = state.busy;
      elements.historicalBackfillButton.textContent = "확정 이력 복구 V12";
      elements.overviewBackfillButton.disabled = state.busy;
      elements.overviewBackfillButton.textContent = "확정 이력 복구 V12";
      elements.scanButton.disabled = state.busy || shouldHideAutomaticData();
      elements.refreshButton.disabled = state.busy;
      elements.auditHistoryButton.disabled = state.busy || state.auditRunning;
      renderBackfillStatus();
    }
  }

  async function downloadHistoricalAudit() {
    if (
      state.busy
      || state.backfillRunning
      || state.auditRunning
      || !getSessionToken()
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
    if (state.busy) return;
    setBusy(true);
    elements.scanButton.textContent = "분석 중...";

    try {
      const result = await apiRequest({
        method: "POST",
        body: {
          action: "scan",
          days: Number(elements.scanDays.value) || 180
        }
      });

      showToast(`${result.message} 새 후보 ${result.insertedCount || 0}건`);
      await loadData({ silent: true });
    } catch (error) {
      showToast(error.message || "업무일지 분석에 실패했습니다.", "error");
    } finally {
      elements.scanButton.textContent = "업무일지 분석";
      setBusy(false);
    }
  }

  async function excludeCandidate(id) {
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
      openRecordDialog(button.dataset.assetAction, button.dataset.tag);
    });

    elements.historyDialog.addEventListener("click", event => {
      const button = event.target.closest("[data-history-action]");
      if (!button || !state.historyAssetTag) return;
      const action = button.dataset.historyAction;
      const tagNumber = state.historyAssetTag;
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
    elements.auditHistoryButton.addEventListener("click", downloadHistoricalAudit);
    elements.refreshButton.addEventListener("click", () => loadData());
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
    elements.settingsForm.addEventListener("submit", saveSettings);
    elements.clearSettingsButton.addEventListener("click", () => saveSettings(null, true));

    document.addEventListener("click", event => {
      const button = event.target.closest("[data-close-dialog]");
      if (!button) return;
      const dialog = byId(button.dataset.closeDialog);
      dialog?.close();
    });

    elements.closeButton.addEventListener("click", () => {
      if (window.opener && !window.opener.closed) {
        window.close();
        return;
      }
      window.location.assign("/");
    });
  }

  async function initialize() {
    cacheElements();
    applySavedAveragePeriod();
    bindEvents();
    switchSubview("overview");
    await loadData();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
