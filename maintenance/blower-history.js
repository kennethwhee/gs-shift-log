"use strict";

(() => {
  const API_URL = "/api/blower-history";
  const AUTH_STORAGE_KEY = "gsShiftLog.currentUser";

  const state = {
    data: null,
    activeType: "fbhe",
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
      "assetCount",
      "warningCount",
      "criticalCount",
      "overdueCount",
      "settingsSummary",
      "settingsUpdated",
      "settingsButton",
      "missingTagsNotice",
      "activeTypeTitle",
      "assetGroups",
      "historyFilter",
      "historyBody",
      "historyEmpty",
      "scanDays",
      "scanButton",
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
    if (asset.severity === "reference") {
      const referenceDate = formatDate(asset.latestReference?.referenceDate);
      return `교체일 미검출 · 최근 기록 ${referenceDate} 기준`;
    }
    if (asset.severity === "uninitialized") return "2021년 이후 관련 기록 미검출";
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
      reference: "최근 기록 기준",
      uninitialized: "과거 이력 미검출"
    }[severity] || "확인 필요";
  }

  function eventLabel(type) {
    return {
      replacement: "교체",
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

  function renderSummary() {
    const assets = getActiveAssets();
    const missingSlots = getActiveMissingSlots();
    const count = severity => assets.filter(asset => asset.severity === severity).length;

    elements.assetCount.textContent = String(assets.length + missingSlots.length);
    elements.warningCount.textContent = String(count("warning"));
    elements.criticalCount.textContent = String(count("critical"));
    elements.overdueCount.textContent = String(count("overdue"));
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

  function renderAssetCard(asset, setting) {
    const cycleDays = Number(setting?.cycleDays);
    const runtime = roundHours(asset.runtimeHours);
    const referenceElapsed = roundHours(asset.referenceElapsedHours);
    const runtimeText = asset.lastReplacementAt
      ? `${formatDaysHours(runtime)} / ${cycleDays > 0 ? `${cycleDays}일` : "기준 미설정"}`
      : asset.latestReference
        ? `최근 기록 후 ${formatDaysHours(referenceElapsed)} 경과`
        : "2021년 이후 관련 이력 미검출";
    const progress = Number.isFinite(Number(asset.progressPct)) ? Math.max(0, Math.min(100, Number(asset.progressPct))) : 0;
    const latestProblem = asset.latestProblem;

    return `
      <article class="asset-card" data-severity="${escapeHtml(asset.severity)}" data-tag="${escapeHtml(asset.tagNumber)}">
        <div class="asset-card-header">
          <div class="asset-identity">
            <strong class="asset-position">${escapeHtml(asset.positionLabel)}</strong>
            <span class="asset-tag">${escapeHtml(asset.tagNumber)}</span>
          </div>
          <span class="status-pill ${escapeHtml(asset.severity)}">${escapeHtml(severityLabel(asset.severity))}</span>
        </div>

        <div class="runtime-main">
          <strong>${escapeHtml(runtimeText)}</strong>
          <small>${escapeHtml(formatSignedRemaining(asset))}</small>
          <div class="progress-track" aria-label="교체주기 진행률">
            <div class="progress-bar" style="width:${progress.toFixed(2)}%"></div>
          </div>
        </div>

        <div class="asset-meta">
          <div>
            <span>최근 교체</span>
            <strong>${asset.lastReplacementAt ? escapeHtml(formatDate(asset.lastReplacementAt)) : "미검출"}</strong>
          </div>
          <div>
            <span>${asset.lastReplacementAt ? "누적 운전" : "최근 기록"}</span>
            <strong>${asset.lastReplacementAt ? escapeHtml(formatHours(runtime)) : escapeHtml(formatDate(asset.latestReference?.referenceDate))}</strong>
          </div>
          <div>
            <span>운전 상태</span>
            <strong>${asset.lastReplacementAt ? (asset.isRunning ? "운전중 · 자동누적" : "정지 · 누적정지") : (asset.latestReference ? "최근 이력 기준 · 교체일 미확정" : "기준 이력 없음")}</strong>
          </div>
          <div>
            <span>주기 진행</span>
            <strong>${asset.lastReplacementAt ? (asset.progressPct === null ? "-" : `${Math.round(progress)}%`) : "교체일 확인 필요"}</strong>
          </div>
        </div>

        <div class="asset-problem">
          ${latestProblem
            ? `최근 문제 · ${escapeHtml(formatDate(latestProblem.eventDate))} · <strong>${escapeHtml(latestProblem.issueType || "확인")}</strong>${latestProblem.actionType ? ` → ${escapeHtml(latestProblem.actionType)}` : ""}`
            : asset.latestReference
              ? `최근 업무일지 · ${escapeHtml(formatDate(asset.latestReference.referenceDate))}${asset.latestReference.sourceText ? ` · ${escapeHtml(String(asset.latestReference.sourceText).slice(0, 120))}` : ""}`
              : "2021년 이후 이 설비로 확정 가능한 업무일지 이력이 없습니다."}
        </div>

        <div class="asset-actions">
          <button type="button" class="asset-action primary" data-asset-action="replacement" data-tag="${escapeHtml(asset.tagNumber)}">교체 등록</button>
          <button type="button" class="asset-action danger" data-asset-action="problem" data-tag="${escapeHtml(asset.tagNumber)}">문제 등록</button>
          <button type="button" class="asset-action" data-asset-action="runtime" data-tag="${escapeHtml(asset.tagNumber)}">운전시간/상태 보정</button>
        </div>
      </article>
    `;
  }

  function renderMissingAssetCard(slot) {
    return `
      <article class="asset-card is-placeholder" data-severity="uninitialized">
        <div class="asset-card-header">
          <div class="asset-identity">
            <strong class="asset-position">${escapeHtml(slot.positionLabel)}</strong>
            <span class="asset-tag">TAG 자동확인 대기</span>
          </div>
          <span class="status-pill uninitialized">TAG 미확인</span>
        </div>

        <div class="runtime-main">
          <strong>설비 위치 등록됨</strong>
          <small>2021년 이후 업무일지에서 정확한 전체 TAG를 찾고 있습니다.</small>
          <div class="progress-track" aria-hidden="true"><div class="progress-bar" style="width:0%"></div></div>
        </div>

        <div class="asset-meta">
          <div><span>위치</span><strong>${escapeHtml(slot.positionLabel)}</strong></div>
          <div><span>TAG</span><strong>확인 필요</strong></div>
          <div><span>과거 이력</span><strong>자동 탐색</strong></div>
          <div><span>Cycle</span><strong>TAG 확인 후 자동 계산</strong></div>
        </div>

        <div class="asset-problem">정확한 TAG가 업무일지에서 발견되면 이 카드가 실제 설비 카드로 자동 전환됩니다.</div>
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
          .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder))
          .map(asset => renderAssetCard(asset, setting));
        const placeholderCards = (missingGroups.get(unitNo) || [])
          .sort((a, b) => String(a.positionLabel).localeCompare(String(b.positionLabel)))
          .map(renderMissingAssetCard);
        const cards = [...actualCards, ...placeholderCards].join("");

        return `
          <section class="unit-group">
            <h3 class="unit-heading">${escapeHtml(label)}</h3>
            <div class="asset-grid">${cards}</div>
          </section>
        `;
      })
      .join("");

    elements.assetGroups.innerHTML = html || `
      <div class="empty-state">이 탭에 등록된 Blower가 없습니다.</div>
    `;
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
    const filter = elements.historyFilter?.value || "all";
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
          <td>${escapeHtml(event.note || event.sourceText || "-")}</td>
          <td>${escapeHtml(historySourceLabel(event))}${event.createdByName ? `<br><small>${escapeHtml(event.createdByName)}</small>` : ""}</td>
        </tr>
      `)
      .join("");
  }

  function renderCandidates() {
    const allCandidates = state.data?.candidates || [];
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
              · ${candidate.detectedType === "replacement" ? "교체 감지" : "문제 감지"}
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

    if (!backfill) {
      notice.hidden = false;
      notice.textContent = "2021년부터 오늘까지 과거 업무일지 이력 자동 반영 상태를 확인하고 있습니다.";
      return;
    }

    const scanned = Number(backfill.scannedLogs || 0).toLocaleString("ko-KR");
    const events = Number(backfill.autoConfirmedEvents || 0).toLocaleString("ko-KR");
    const pending = Number(backfill.pendingCandidates || 0).toLocaleString("ko-KR");
    const target = backfill.targetDate || formatKstDateInput();

    notice.hidden = false;

    if (backfill.isCompleteForToday) {
      notice.textContent = `2021년부터 과거 업무일지 자동 반영 완료 · ${target}까지 ${scanned}건 확인 · 이력 ${events}건 자동 반영`;
      return;
    }

    notice.textContent = `2021년부터 과거 업무일지 자동 반영 중 · ${target}까지 ${scanned}건 확인 · 이력 ${events}건 자동 반영`;
  }

  function renderAll() {
    if (!state.data) return;

    renderTypeTabs();
    renderSummary();
    renderSettings();
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
      elements.recordDialogTitle.textContent = "교체 등록";
      elements.recordDateLabel.textContent = "교체일";
      elements.issueType.value = "정기주기";
      elements.actionType.value = "교체";
      elements.actionTypeField.hidden = true;
      elements.replacementRunningField.hidden = false;
      elements.replacementRunning.checked = true;
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
      elements.recordDialogTitle.textContent = replacement ? "교체 감지 확인" : "문제 감지 확인";
      elements.recordDateLabel.textContent = replacement ? "교체일" : "발생일";
      elements.issueType.value = candidate?.issueType || (replacement ? "정기주기" : "기타");
      elements.actionType.value = candidate?.actionType || (replacement ? "교체" : "확인");
      elements.replacementRunningField.hidden = !replacement;
      elements.replacementRunning.checked = true;
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
          actionType: "교체",
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
    if (state.backfillRunning || !getSessionToken()) return;

    const today = formatKstDateInput();
    if (state.data?.backfill?.isCompleteForToday && state.data?.backfill?.targetDate === today) {
      renderBackfillStatus(state.data.backfill);
      return;
    }

    state.backfillRunning = true;
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

        if (lastResult.done) {
          break;
        }
      }

      await loadData({ silent: true });

      if (lastResult?.done) {
        showToast("과거 업무일지 이력을 오늘 기준까지 자동 반영했습니다.");
      } else {
        showToast("과거 업무일지 자동 반영 진행상태를 저장했습니다.");
      }
    } catch (error) {
      console.error("과거 Blower 이력 자동 반영 실패:", error);
      showToast(error.message || "과거 업무일지 자동 반영에 실패했습니다.", "error");
    } finally {
      state.backfillRunning = false;
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

    document.querySelectorAll(".sub-tab").forEach(button => {
      button.addEventListener("click", () => switchSubview(button.dataset.subview));
    });

    elements.assetGroups.addEventListener("click", event => {
      const button = event.target.closest("[data-asset-action]");
      if (!button) return;
      openRecordDialog(button.dataset.assetAction, button.dataset.tag);
    });

    elements.historyFilter.addEventListener("change", renderHistory);
    elements.settingsButton.addEventListener("click", openSettingsDialog);
    elements.refreshButton.addEventListener("click", () => loadData());
    elements.scanButton.addEventListener("click", scanShiftLogs);

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
    bindEvents();
    switchSubview("overview");
    await loadData();
    await runHistoricalBackfill();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();