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
    backfillRunning: false
  };

  const elements = {};

  function byId(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    [
      "authNotice",
      "historicalBackfillNotice",
      "typeTabs",
      "candidateCountBadge",
      "statusFilters",
      "visibleAssetCount",
      "settingsSummary",
      "settingsUpdated",
      "settingsButton",
      "missingTagsNotice",
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

  async function apiRequest(options = {}) {
    const method = options.method || "GET";
    const response = await fetch(options.url || API_URL, {
      method,
      headers: getAuthHeaders(
        options.body
          ? { "Content-Type": "application/json; charset=utf-8" }
          : {}
      ),
      cache: "no-store",
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const text = await response.text();
    let result = {};

    if (text.trim()) {
      try {
        result = JSON.parse(text);
      } catch {
        throw new Error("서버 응답 형식을 확인할 수 없습니다.");
      }
    }

    if (!response.ok || result.ok === false) {
      throw new Error(result.message || `요청 실패 (HTTP ${response.status})`);
    }

    return result;
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
          asset => asset.blowerType === type.key && ["warning", "critical", "overdue"].includes(asset.severity)
        ).length;

        return `
          <button
            type="button"
            class="type-tab${active ? " is-active" : ""}${type.important ? " is-important" : ""}"
            data-type="${escapeHtml(type.key)}"
            aria-selected="${active ? "true" : "false"}"
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
        `교체 ${setting.cycleDays}일 (${cycleHours.toLocaleString("ko-KR")}h)`,
        `예정 D-${setting.warningDays} 노란색`,
        `임박 D-${setting.criticalDays} 빨간색`
      ].join(" · ");

      elements.settingsUpdated.textContent = setting.updatedAt
        ? `최근 변경 ${formatDate(setting.updatedAt)}${setting.updatedByName ? ` · ${setting.updatedByName}` : ""}`
        : "";
    }

    elements.settingsButton.hidden = !state.data?.user?.isAdmin;
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
      <strong>TAG 추가 확인 필요</strong> ·
      ${missing.map(item => {
        const unitLabel = item.unitNo === "shared" ? "공용" : `#${item.unitNo}호기`;
        return `${escapeHtml(unitLabel)} ${item.missingCount}대`;
      }).join(" · ")}
      <br><small>알려주지 않은 TAG는 임의로 추정하지 않습니다. 2021년 이후 업무일지에서 정확한 전체 TAG가 발견되면 해당 위치에 자동 등록합니다.</small>
    `;
  }

  function getAssetEvents(tagNumber) {
    return (state.data?.events || []).filter(event => event.tagNumber === tagNumber);
  }

  function getLatestReplacementEvent(asset) {
    const replacements = getAssetEvents(asset.tagNumber)
      .filter(event => event.eventType === "replacement");
    const replacementDate = formatDate(asset.lastReplacementAt);

    return replacements.find(event => formatDate(event.eventDate) === replacementDate)
      || replacements[0]
      || null;
  }

  function isShiftLogEvent(event) {
    return ["shift_log_auto", "shift_log_history_auto"].includes(event?.sourceType);
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
    const replacementFragment = fragments.find(fragment =>
      /(?:v[\s-]?belt|belt|벨트)/i.test(fragment)
      && /(?:교체|완료|실시|시행|replace)/i.test(fragment)
    );
    const text = replacementFragment || fragments.join(" · ") || raw;

    return text.length > 180 ? `${text.slice(0, 177).trim()}…` : text;
  }

  function renderAssetCard(asset, setting) {
    const cycleDays = Number(setting?.cycleDays);
    const runtime = roundHours(asset.runtimeHours);
    const confirmed = Boolean(asset.lastReplacementAt);
    const severity = displaySeverity(asset);
    const progress = Number.isFinite(Number(asset.progressPct)) ? Math.max(0, Math.min(100, Number(asset.progressPct))) : 0;
    const replacementEvent = confirmed ? getLatestReplacementEvent(asset) : null;
    const evidence = readableEvidence(replacementEvent);
    const cycleHours = cycleDays > 0 ? cycleDays * 24 : null;
    const stateLabel = asset.isRunning ? "운전중 · 자동누적" : "정지 · 누적정지";

    return `
      <article class="asset-card" data-severity="${escapeHtml(severity)}" data-tag="${escapeHtml(asset.tagNumber)}">
        <div class="asset-card-header">
          <div class="asset-identity">
            <strong class="asset-position">${escapeHtml(asset.positionLabel)}</strong>
            <span class="asset-tag">${escapeHtml(asset.tagNumber)}</span>
          </div>
          <span class="status-pill ${escapeHtml(severity)}">${escapeHtml(severityLabel(severity))}</span>
        </div>

        ${confirmed ? `
          <div class="runtime-main">
            <span class="cycle-label">현재 교체주기</span>
            <strong>교체 후 ${escapeHtml(formatHours(runtime))}</strong>
            <small>${escapeHtml(formatSignedRemaining(asset))}</small>
            ${cycleHours ? `
              <div class="progress-caption">
                <span>${escapeHtml(formatHours(runtime))}</span>
                <span>${cycleHours.toLocaleString("ko-KR")}h</span>
              </div>
              <div class="progress-track" aria-label="교체주기 진행률 ${Math.round(progress)}%">
                <div class="progress-bar" style="width:${progress.toFixed(2)}%"></div>
              </div>
            ` : ""}
          </div>

          <div class="asset-meta">
            <div><span>최근 교체</span><strong>${escapeHtml(formatDate(asset.lastReplacementAt))}</strong></div>
            <div><span>운전 상태</span><strong>${escapeHtml(stateLabel)}</strong></div>
          </div>

          <div class="asset-evidence${evidence ? "" : " is-empty"}">
            <span>${isShiftLogEvent(replacementEvent) ? "업무일지 근거" : "등록 근거"}</span>
            <p>${escapeHtml(evidence || "교체 이력은 확인되었지만 등록된 근거 문장이 없습니다.")}</p>
            ${replacementEvent ? `<small>${escapeHtml(formatDate(replacementEvent.eventDate))} · ${escapeHtml(historySourceLabel(replacementEvent))}</small>` : ""}
          </div>
        ` : `
          <div class="unknown-cycle">
            <strong>교체일 미확인</strong>
            <p>확정된 V-Belt 교체 이력이 없습니다.</p>
            <small>검토 대기 후보를 확인하거나 최초 교체일을 직접 등록해 주세요.</small>
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

        <div class="unknown-cycle">
          <strong>TAG 확인 필요</strong>
          <p>이 위치의 정확한 TAG가 아직 등록되지 않았습니다.</p>
          <small>업무일지에서 전체 TAG가 확인되면 실제 설비 카드로 전환됩니다.</small>
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
        const cards = [...actualCards, ...placeholderCards].join("");

        if (!cards) return "";

        return `
          <section class="unit-group">
            <h3 class="unit-heading">${escapeHtml(label)} <span>${actualCards.length + placeholderCards.length}대</span></h3>
            <div class="asset-grid">${cards}</div>
          </section>
        `;
      })
      .join("");

    const total = assets.length + missingSlots.length;
    const visible = state.statusFilter === "all"
      ? total
      : assets.filter(asset => displaySeverity(asset) === state.statusFilter).length
        + (state.statusFilter === "unknown" ? missingSlots.length : 0);

    elements.visibleAssetCount.textContent = `${visible.toLocaleString("ko-KR")} / ${total.toLocaleString("ko-KR")}대`;
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

    for (const event of state.data?.events || []) {
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
      elements.averageHeadline.textContent = `${periodLabel} · 계산 가능한 연속 교체 이력 없음`;
      elements.averageMetrics.innerHTML = `
        <div class="average-metric"><span>평균</span><strong>-</strong></div>
        <div class="average-metric"><span>표본</span><strong>0회</strong></div>
        <div class="average-metric"><span>최단</span><strong>-</strong></div>
        <div class="average-metric"><span>최장</span><strong>-</strong></div>
      `;
    } else {
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

  function renderHistory() {
    const filter = elements.historyFilter?.value || "replacement";
    const events = (state.data?.events || []).filter(event => {
      if (event.blowerType !== state.activeType) return false;
      return filter === "all" || event.eventType === filter;
    });

    elements.historyEmpty.hidden = events.length > 0;
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
          <td>${escapeHtml(
            event.eventType === "replacement"
              ? (readableEvidence(event) || event.note || event.sourceText || "-")
              : (event.note || event.sourceText || "-")
          )}</td>
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
    const events = getAssetEvents(tagNumber)
      .filter(event => event.eventType === "replacement");

    elements.historyDialogTitle.textContent = `${asset.positionLabel} 이력`;
    elements.historyDialogAsset.textContent = `${asset.displayName} · ${asset.tagNumber}`;
    elements.historyCycleSummary.innerHTML = asset.lastReplacementAt
      ? `
        <span class="status-pill ${escapeHtml(severity)}">${escapeHtml(severityLabel(severity))}</span>
        <div><span>최근 V-Belt 교체</span><strong>${escapeHtml(formatDate(asset.lastReplacementAt))}</strong></div>
        <div><span>교체 후 누적 운전</span><strong>${escapeHtml(formatHours(asset.runtimeHours))}</strong></div>
        <div><span>현재 주기</span><strong>${escapeHtml(formatSignedRemaining(asset))}</strong></div>
      `
      : `
        <span class="status-pill unknown">교체일 미확인</span>
        <div class="history-unknown"><strong>확정된 V-Belt 교체 이력이 없습니다.</strong><span>검토 대기 후보를 확인하거나 최초 이력을 직접 등록해 주세요.</span></div>
      `;

    elements.assetHistoryList.innerHTML = events.length
      ? events.map(event => {
          const content = readableEvidence(event) || event.note || event.sourceText || "등록 내용 없음";
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
    elements.historicalBackfillButton.hidden = !isSuperAdmin;

    if (!backfill) {
      notice.hidden = false;
      notice.dataset.state = "required";
      notice.textContent = "과거 이력 재구성 필요 · 아직 실행 기록이 없습니다.";
      return;
    }

    const scanned = Number(backfill.scannedLogs || 0).toLocaleString("ko-KR");
    const events = Number(backfill.autoConfirmedEvents || 0).toLocaleString("ko-KR");
    const pending = Number(backfill.pendingCandidates || 0).toLocaleString("ko-KR");
    const target = backfill.targetDate || formatKstDateInput();

    notice.hidden = false;

    if (state.backfillRunning) {
      notice.dataset.state = "running";
      notice.textContent = `과거 이력 재구성 진행 중 · ${target}까지 ${scanned}건 확인 · 교체 이력 ${events}건 반영 · 검토 대기 ${pending}건`;
      return;
    }

    if (backfill.isCompleteForToday) {
      notice.dataset.state = "complete";
      notice.textContent = `과거 이력 재구성 완료 · ${target}까지 ${scanned}건 확인 · 교체 이력 ${events}건 반영`;
      return;
    }

    notice.dataset.state = "required";
    notice.textContent = backfill.status === "running"
      ? `과거 이력 재구성 필요 · 중단 지점부터 재개 가능 · 기존 확인 ${scanned}건`
      : `과거 이력 재구성 필요 · 마지막 기준 ${target} · 기존 확인 ${scanned}건`;
  }

  function renderAll() {
    if (!state.data) return;

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
    elements.scanButton.disabled = state.busy;
    elements.historicalBackfillButton.disabled = state.busy || state.backfillRunning;
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
      button.classList.toggle("is-active", button.dataset.subview === subview);
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

  async function runHistoricalBackfill() {
    if (
      state.backfillRunning
      || !getSessionToken()
      || !state.data?.user?.isSuperAdmin
    ) return;

    const today = formatKstDateInput();
    if (state.data?.backfill?.isCompleteForToday && state.data?.backfill?.targetDate === today) {
      renderBackfillStatus(state.data.backfill);
      showToast("오늘 기준 과거 이력 재구성이 완료되어 있습니다.");
      return;
    }

    state.backfillRunning = true;
    elements.historicalBackfillButton.disabled = true;
    elements.historicalBackfillButton.textContent = "재구성 중...";
    elements.scanButton.disabled = true;
    elements.refreshButton.disabled = true;
    renderBackfillStatus(state.data?.backfill);
    let lastResult = null;

    try {
      for (let step = 0; step < 500; step += 1) {
        lastResult = await apiRequest({
          method: "POST",
          body: { action: "historical_backfill_step" }
        });

        if (lastResult.backfill) {
          renderBackfillStatus(lastResult.backfill);
        }

        if (lastResult.done || lastResult.busy) {
          break;
        }
      }

      await loadData({ silent: true });

      if (lastResult?.done) {
        showToast("과거 이력 재구성을 오늘 기준까지 완료했습니다.");
      } else if (lastResult?.busy) {
        showToast(lastResult.message || "다른 재구성 작업이 진행 중입니다.");
      } else {
        showToast("과거 이력 재구성 진행상태를 저장했습니다.");
      }
    } catch (error) {
      console.error("과거 Blower 이력 재구성 실패:", error);
      showToast(error.message || "과거 이력 재구성에 실패했습니다.", "error");
    } finally {
      state.backfillRunning = false;
      elements.historicalBackfillButton.disabled = state.busy;
      elements.historicalBackfillButton.textContent = "과거 이력 재구성";
      elements.scanButton.disabled = state.busy;
      elements.refreshButton.disabled = state.busy;
      renderBackfillStatus();
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
    elements.refreshButton.addEventListener("click", () => loadData());
    elements.scanButton.addEventListener("click", scanShiftLogs);
    elements.historicalBackfillButton.addEventListener("click", runHistoricalBackfill);

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
