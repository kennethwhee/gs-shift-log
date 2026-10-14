"use strict";

/* =========================================================
  Bed Ash 반출 자동 감지 · 효율팀 확인

  - 일별 / 주별 / 월별 저장 자료 조회
  - PC에서 누락 OIS 자료 수집 및 효율팀 확인
  - 모바일에서는 저장된 결과만 읽기
  - 확인 대기는 메뉴 배지와 PC 우측 알림 레일에 표시
========================================================= */

(function installBedAshDischargeFeature() {
  if (window.__bedAshDischargeFeatureInstalled === true) {
    return;
  }

  window.__bedAshDischargeFeatureInstalled = true;

  const API_URL = "/api/bed-ash-discharge";
  const OIS_REQUEST_API_URL = "/api/ois-data-requests";
  const AUTH_STORAGE_KEY = "gsShiftLog.currentUser";
  const ROUTE_KEY = "bed-ash-discharge";
  const DETECTOR_ALGORITHM_VERSION = "bed-ash-drop-v2";
  const MINUTE_DETECTOR_ALGORITHM_VERSION = "bed-ash-drop-minute-v3";
  const MINUTE_DETECTOR_VERSIONS = new Set(["bed-ash-drop-minute-v1", "bed-ash-drop-minute-v2", MINUTE_DETECTOR_ALGORITHM_VERSION]);
  const CURRENT_DETECTOR_VERSIONS = new Set([
    DETECTOR_ALGORITHM_VERSION, ...MINUTE_DETECTOR_VERSIONS
  ]);
  const PERIODS = new Set(["daily", "weekly", "monthly"]);
  const FILTERS = new Set(["all", "pending", "confirmed", "excluded"]);
  const RANGE_STALE_MS = 5 * 60 * 1000;
  const SUMMARY_REFRESH_MS = 10 * 60 * 1000;
  const POLL_INTERVAL_MS = 2000;
  const STATUS_BATCH_SIZE = 12;
  const POLL_TIMEOUT_MS = 10 * 60 * 1000;
  const REQUEST_TIMEOUT_MS = 30 * 1000;
  const SUMMARY_REQUEST_TIMEOUT_MS = 15 * 1000;
  const OIS_REQUEST_CONCURRENCY = 3;

  const emptyUnitSummary = () => ({
    confirmedCount: 0, confirmedTon: 0, pendingCount: 0,
    pendingEstimatedTon: 0, incompleteCount: 0, observationCount: 0,
    observedCount: 0, observedTon: 0, observedGapCount: 0, sharedObservedCount: 0
  });
  const emptySummary = () => ({
    confirmedCount: 0,
    confirmedTon: 0,
    pendingCount: 0,
    pendingEstimatedTon: 0,
    incompleteCount: 0,
    observationCount: 0,
    observedCount: 0,
    observedTon: 0,
    observedGapCount: 0,
    sharedObservedCount: 0,
    unit1Ton: 0,
    unit2Ton: 0,
    units: { 1: emptyUnitSummary(), 2: emptyUnitSummary() }
  });

  const state = {
    period: "daily",
    anchorDate: "",
    filter: "all",
    events: [],
    minorObservations: [],
    minorObservationsOmitted: 0,
    summary: emptySummary(),
    latestLevels: {
      1: null,
      2: null
    },
    unitCoverage: { 1: null, 2: null },
    coverage: null,
    loadedRangeKey: "",
    loadedAt: 0,
    loadSequence: 0,
    loading: false,
    activeRangeLoad: null,
    queryTiming: null,
    queryTimerId: 0,
    summarySequence: 0,
    summaryLoading: false,
    summaryRefreshQueued: false,
    summaryLoadedAt: 0,
    summaryNextAttemptAt: 0,
    latestPendingSummary: null,
    lastSessionToken: "",
    expandedReviewEventKey: "",
    reviewDrafts: new Map(),
    submittingEventKeys: new Set(),
    reviewSubmissionControlsLocked: false,
    reviewSubmissionControlStates: new Map(),
    composingReviewEventKey: "",
    renderEventsQueued: false,
    bound: false,
    initialized: false
  };

  function text(value) {
    return String(value ?? "").trim();
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function uniqueDateList(values) {
    return [
      ...new Set(
        (Array.isArray(values) ? values : [])
          .map(value => text(value))
          .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value))
      )
    ].sort();
  }

  function getElements() {
    return {
      tab: document.getElementById("efficiencyBedAshDischargeTab"),
      badge: document.getElementById("efficiencyBedAshDischargeBadge"),
      view: document.getElementById("efficiencyBedAshDischargeView"),
      periodButtons: [
        ...document.querySelectorAll("[data-bed-ash-period]")
      ],
      weekSelector: document.getElementById("bedAshDischargeWeekSelector"),
      weekButtons: [
        ...document.querySelectorAll("[data-bed-ash-week]")
      ],
      monthSelector: document.getElementById("bedAshDischargeMonthSelector"),
      monthButtons: [
        ...document.querySelectorAll("[data-bed-ash-month]")
      ],
      previousButton: document.getElementById("bedAshDischargePreviousPeriodButton"),
      anchorDate: document.getElementById("bedAshDischargeAnchorDate"),
      anchorDateLabel: document.querySelector(
        'label[for="bedAshDischargeAnchorDate"]'
      ),
      todayButton: document.getElementById("bedAshDischargeTodayButton"),
      nextButton: document.getElementById("bedAshDischargeNextPeriodButton"),
      refreshButton: document.getElementById("refreshBedAshDischargeButton"),
      rangeLabel: document.getElementById("bedAshDischargeRangeLabel"),
      status: document.getElementById("bedAshDischargeStatus"),
      elapsedTime: document.getElementById("bedAshDischargeElapsedTime"),
      readOnlyNotice: document.getElementById("bedAshDischargeReadOnlyNotice"),
      totalAmount: document.getElementById("bedAshDischargeTotalAmount"),
      unitOneAmount: document.getElementById("bedAshDischargeUnitOneAmount"),
      unitTwoAmount: document.getElementById("bedAshDischargeUnitTwoAmount"),
      pendingCount: document.getElementById("bedAshDischargePendingCount"),
      unitOneLatestLevel: document.getElementById("bedAshDischargeUnitOneLatestLevel"),
      unitOneLatestAt: document.getElementById("bedAshDischargeUnitOneLatestAt"),
      unitTwoLatestLevel: document.getElementById("bedAshDischargeUnitTwoLatestLevel"),
      unitTwoLatestAt: document.getElementById("bedAshDischargeUnitTwoLatestAt"),
      statusFilter: document.getElementById("bedAshDischargeStatusFilter"),
      eventCount: document.getElementById("bedAshDischargeEventCount"),
      minorObservations: document.getElementById("bedAshDischargeMinorObservations"),
      minorObservationSummary: document.getElementById("bedAshDischargeMinorObservationSummary"),
      minorObservationList: document.getElementById("bedAshDischargeMinorObservationList"),
      tableBody: document.getElementById("bedAshDischargeEventTableBody"),
      sourceDetails: document.getElementById("bedAshDischargeSourceDetails"),
      sourceDetailText: document.getElementById("bedAshDischargeSourceDetailText"),
      sourceStatusText: document.getElementById("bedAshDischargeSourceStatusText"),
      loadingState: document.getElementById("bedAshDischargeLoadingState"),
      emptyState: document.getElementById("bedAshDischargeEmptyState"),
      mainAlert: document.getElementById("bedAshDischargeMainAlert"),
      mainAlertDetail: document.getElementById("bedAshDischargeMainAlertDetail"),
      mainAlertCount: document.getElementById("bedAshDischargeMainAlertCount")
    };
  }

  function isMobileClient() {
    return (
      window.__GS_MOBILE_RUNTIME_V14 === true ||
      /^\/mobile-app(?:\/|$)/.test(window.location.pathname)
    );
  }

  function getReviewSubmissionControls(elements = getElements()) {
    return [
      ...new Set([
        ...elements.periodButtons,
        ...elements.weekButtons,
        ...elements.monthButtons,
        elements.previousButton,
        elements.anchorDate,
        elements.todayButton,
        elements.nextButton,
        elements.refreshButton,
        elements.statusFilter
      ].filter(Boolean))
    ];
  }

  function setReviewSubmissionControlsLocked(isLocked) {
    if (isLocked) {
      if (state.reviewSubmissionControlsLocked) {
        return;
      }

      state.reviewSubmissionControlsLocked = true;
      state.reviewSubmissionControlStates.clear();
      getReviewSubmissionControls().forEach(control => {
        state.reviewSubmissionControlStates.set(control, control.disabled);
        control.disabled = true;
      });
      return;
    }

    state.reviewSubmissionControlsLocked = false;
    state.reviewSubmissionControlStates.forEach((wasDisabled, control) => {
      if (control.isConnected) {
        control.disabled = wasDisabled;
      }
    });
    state.reviewSubmissionControlStates.clear();
  }

  function loadStoredCurrentUser() {
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  function getSessionToken() {
    if (typeof window.getShiftLogSessionToken === "function") {
      return text(window.getShiftLogSessionToken());
    }

    const currentUser = loadStoredCurrentUser();
    return text(currentUser?.sessionToken || currentUser?.session_token);
  }

  function getRequestHeaders(includeJson = false) {
    const token = getSessionToken();
    const headers = {
      Accept: "application/json",
      "Cache-Control": "no-store",
      "X-GS-Client-Mode": isMobileClient() ? "mobile" : "pc"
    };

    if (includeJson) {
      headers["Content-Type"] = "application/json; charset=utf-8";
    }

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return headers;
  }

  async function requestJson(url, options = {}) {
    const timeoutMs = Math.max(
      1000,
      number(options.timeoutMs, REQUEST_TIMEOUT_MS)
    );
    const fetchOptions = { ...options };
    delete fetchOptions.timeoutMs;

    const controller = typeof AbortController === "function"
      ? new AbortController()
      : null;
    const timeoutId = controller
      ? window.setTimeout(() => controller.abort(), timeoutMs)
      : 0;

    if (controller) {
      fetchOptions.signal = controller.signal;
    }

    try {
      const response = await fetch(url, {
        cache: "no-store",
        ...fetchOptions
      });
      const responseText = await response.text();
      let payload = {};

      if (responseText.trim()) {
        try {
          payload = JSON.parse(responseText);
        } catch {
          const error = new Error("서버 응답 형식이 올바르지 않습니다.");
          error.status = response.status;
          throw error;
        }
      }

      if (!response.ok || payload.ok === false) {
        const error = new Error(
          text(payload.message) || `요청을 처리하지 못했습니다. (${response.status})`
        );
        error.status = response.status;
        error.payload = payload;
        throw error;
      }

      return payload.data ?? payload;
    } catch (error) {
      if (error?.name === "AbortError") {
        const timeoutError = new Error(
          `서버 응답 대기 시간이 ${Math.round(timeoutMs / 1000)}초를 초과했습니다.`
        );
        timeoutError.name = "TimeoutError";
        throw timeoutError;
      }
      throw error;
    } finally {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    }
  }

  function parseDate(value) {
    const match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return null;
    }

    const result = new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
    );
    return Number.isNaN(result.getTime()) ? null : result;
  }

  function formatInputDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return "";
    }

    return [
      String(date.getUTCFullYear()).padStart(4, "0"),
      String(date.getUTCMonth() + 1).padStart(2, "0"),
      String(date.getUTCDate()).padStart(2, "0")
    ].join("-");
  }

  function addDays(value, amount) {
    const date = parseDate(value);
    if (!date) {
      return "";
    }

    date.setUTCDate(date.getUTCDate() + amount);
    return formatInputDate(date);
  }

  function getMonthLastDay(year, monthIndex) {
    return new Date(Date.UTC(year, monthIndex + 1, 0, 12)).getUTCDate();
  }

  function getFixedWeekRange(year, monthIndex, weekNumber) {
    const normalizedWeek = Math.min(5, Math.max(1, Math.trunc(number(weekNumber, 1))));
    const lastDay = getMonthLastDay(year, monthIndex);
    const startDay = (normalizedWeek - 1) * 7 + 1;
    const available = startDay <= lastDay;
    const endDay = Math.min(startDay + 6, lastDay);

    return {
      weekNumber: normalizedWeek,
      startDate: available
        ? formatInputDate(new Date(Date.UTC(year, monthIndex, startDay, 12)))
        : "",
      endDate: available
        ? formatInputDate(new Date(Date.UTC(year, monthIndex, endDay, 12)))
        : "",
      available
    };
  }

  function getFixedWeekNumber(date) {
    return Math.min(5, Math.floor((date.getUTCDate() - 1) / 7) + 1);
  }

  function shiftWeeklyMonth(value, amount) {
    const date = parseDate(value) || parseDate(getKstToday());
    const today = parseDate(getKstToday());
    const weekNumber = getFixedWeekNumber(date);
    const targetMonth = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1, 12)
    );
    let targetRange = getFixedWeekRange(
      targetMonth.getUTCFullYear(),
      targetMonth.getUTCMonth(),
      weekNumber
    );

    if (!targetRange.available) {
      targetRange = getFixedWeekRange(
        targetMonth.getUTCFullYear(),
        targetMonth.getUTCMonth(),
        4
      );
    }

    if (targetRange.startDate > formatInputDate(today)) {
      targetRange = getFixedWeekRange(
        targetMonth.getUTCFullYear(),
        targetMonth.getUTCMonth(),
        getFixedWeekNumber(today)
      );
    }

    return targetRange.startDate;
  }

  function shiftMonthlyYear(value, amount) {
    const date = parseDate(value) || parseDate(getKstToday());
    const today = parseDate(getKstToday());
    const targetYear = date.getUTCFullYear() + amount;
    const targetMonth = targetYear === today.getUTCFullYear()
      ? Math.min(date.getUTCMonth(), today.getUTCMonth())
      : date.getUTCMonth();

    return formatInputDate(new Date(Date.UTC(targetYear, targetMonth, 1, 12)));
  }

  function getKstToday() {
    return new Date(Date.now() + 9 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  }

  function getKstNowDateTimeLocal() {
    return new Date(Date.now() + 9 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 16);
  }

  function calculatePeriod(period, anchorDate) {
    const today = getKstToday();
    const anchor = parseDate(anchorDate) || parseDate(today);
    let start = new Date(anchor.getTime());
    let end = new Date(anchor.getTime());

    if (period === "weekly") {
      const fixedWeek = getFixedWeekRange(
        anchor.getUTCFullYear(),
        anchor.getUTCMonth(),
        getFixedWeekNumber(anchor)
      );
      start = parseDate(fixedWeek.startDate);
      end = parseDate(fixedWeek.endDate);
    } else if (period === "monthly") {
      start.setUTCDate(1);
      end = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 12)
      );
    }

    const startDate = formatInputDate(start);
    const endDate = formatInputDate(end);
    const queryStartDate = startDate <= today ? startDate : "";
    const queryEndDate = queryStartDate ? (endDate < today ? endDate : today) : "";

    return {
      period,
      anchorDate: formatInputDate(anchor),
      startDate,
      endDate,
      queryStartDate,
      queryEndDate,
      today
    };
  }

  function enumerateDates(startDate, endDate) {
    if (!startDate || !endDate || startDate > endDate) {
      return [];
    }

    const dates = [];
    let cursor = startDate;

    while (cursor && cursor <= endDate && dates.length < 370) {
      dates.push(cursor);
      cursor = addDays(cursor, 1);
    }

    return dates;
  }

  function formatKoreanDate(value, includeYear = true) {
    const date = parseDate(value);
    if (!date) {
      return "-";
    }

    const parts = [];
    if (includeYear) {
      parts.push(`${date.getUTCFullYear()}년`);
    }
    parts.push(`${date.getUTCMonth() + 1}월`, `${date.getUTCDate()}일`);
    return parts.join(" ");
  }

  function formatPeriodLabel(range) {
    if (range.startDate === range.endDate) {
      return formatKoreanDate(range.startDate);
    }

    const base = `${formatKoreanDate(range.startDate)} ~ ${formatKoreanDate(range.endDate)}`;
    if (range.queryEndDate && range.queryEndDate < range.endDate) {
      return `${base} · ${formatKoreanDate(range.queryEndDate)}까지 조회`;
    }

    return base;
  }

  function getTimestampParts(value) {
    const raw = text(value);
    if (!raw) {
      return null;
    }

    const naive = raw.match(
      /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/
    );
    if (naive) {
      return {
        year: naive[1],
        month: naive[2],
        day: naive[3],
        hour: naive[4],
        minute: naive[5],
        second: naive[6] || "00"
      };
    }

    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(date).map(part => [part.type, part.value])
    );

    return {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second
    };
  }

  function formatTimestamp(value) {
    const parts = getTimestampParts(value);
    if (!parts) {
      return "-";
    }

    return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`;
  }

  function toDateTimeLocalValue(value) {
    const parts = getTimestampParts(value);
    if (!parts) {
      return "";
    }

    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  }

  function timestampToInputDate(value) {
    const parts = getTimestampParts(value);
    return parts ? `${parts.year}-${parts.month}-${parts.day}` : "";
  }

  function formatHourlyRange(startAt, endAt, includeSeconds = false) {
    const start = getTimestampParts(startAt);
    const end = getTimestampParts(endAt);
    if (!start || !end) {
      return "감지 시간 없음";
    }

    const startDate = `${start.year}.${start.month}.${start.day}`;
    const endDate = `${end.year}.${end.month}.${end.day}`;
    const startTime = `${start.hour}:${start.minute}${includeSeconds ? `:${start.second}` : ""}`;
    const endTime = `${end.hour}:${end.minute}${includeSeconds ? `:${end.second}` : ""}`;
    if (startDate === endDate) {
      return `${startDate} ${startTime} ~ ${endTime}`;
    }

    return `${startDate} ${startTime} ~ ${endDate} ${endTime}`;
  }

  function isMinuteEvent(event) {
    return MINUTE_DETECTOR_VERSIONS.has(event.algorithmVersion) ||
      (event.sourceKind === "dataparc_bed_ash_minute" && event.sampleIntervalSeconds === 60);
  }

  function isRapidDischargeEvent(event) {
    return event.algorithmVersion === MINUTE_DETECTOR_ALGORITHM_VERSION && event.isRapidDecline === true;
  }

  function formatDetectionRange(startAt, endAt) {
    const start = getTimestampParts(startAt), end = getTimestampParts(endAt);
    if (state.period === "daily" && start && end &&
      start.year === end.year && start.month === end.month && start.day === end.day) {
      return `${start.hour}:${start.minute} ~ ${end.hour}:${end.minute}`;
    }
    return formatHourlyRange(startAt, endAt);
  }

  function eventSourceLabel(event) {
    return isMinuteEvent(event) ? "DataPARC · 1분 자료" : "운영정보 · 시간자료";
  }

  function sourceGapMetadata(value) {
    const count = typeof value?.sourceGapCount === "number" && Number.isFinite(value.sourceGapCount)
      ? Math.max(0, Math.trunc(value.sourceGapCount)) : 0;
    return { sourceGapCount: count, hasSourceGaps: value?.hasSourceGaps === true || count > 0 };
  }

  function normalizeMinuteObservations(value, unitNo) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.filter(item => {
      const valid = item && item.sourceKind === "dataparc_bed_ash_minute" &&
        item.sampleIntervalSeconds === 60 && (item.reviewReady === true || sourceGapMetadata(item).hasSourceGaps) &&
        text(item.unitNo) === unitNo && text(item.eventKey) && !seen.has(text(item.eventKey)) &&
        getTimestampParts(item.startAt) && getTimestampParts(item.endAt) &&
        Date.parse(item.startAt) < Date.parse(item.endAt) &&
        [item.startLevelTon, item.endLevelTon, item.estimatedTon].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0);
      if (!valid) return false;
      seen.add(text(item.eventKey));
      return true;
    }).map(item => {
      const gaps = sourceGapMetadata(item);
      return {
        eventKey: text(item.eventKey), unitNo, startAt: text(item.startAt), endAt: text(item.endAt),
        startLevelTon: item.startLevelTon, endLevelTon: item.endLevelTon, estimatedTon: item.estimatedTon,
        algorithmVersion: text(item.algorithmVersion), isRapidDecline: item.isRapidDecline === true,
        sourceKind: "dataparc_bed_ash_minute", sampleIntervalSeconds: 60,
        ...gaps, reviewReady: item.reviewReady === true && !gaps.hasSourceGaps,
        overlapOtherUnit: item.overlapOtherUnit === true,
        sharedReviewedEvidence: item.sharedReviewedEvidence === true,
        relatedReviewedEventKeys: Array.isArray(item.relatedReviewedEventKeys) ? item.relatedReviewedEventKeys.map(text) : []
      };
    }).sort((first, second) => first.startAt.localeCompare(second.startAt));
  }

  function normalizeMinorObservations(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(item => item && item.sourceKind === "dataparc_bed_ash_minute" &&
      item.sampleIntervalSeconds === 60 && ["1", "2"].includes(text(item.unitNo)) &&
      getTimestampParts(item.startAt) && getTimestampParts(item.endAt) && Date.parse(item.startAt) < Date.parse(item.endAt) &&
      [item.startLevelTon, item.endLevelTon, item.estimatedTon].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0) &&
      item.estimatedTon >= 0.5 && (item.estimatedTon < 3 ||
        (item.algorithmVersion === MINUTE_DETECTOR_ALGORITHM_VERSION &&
          item.observationReason === "slow_decline" && item.isRapidDecline === false))
    ).slice(0, 128).map(item => ({
      unitNo: text(item.unitNo), startAt: text(item.startAt), endAt: text(item.endAt),
      startLevelTon: item.startLevelTon, endLevelTon: item.endLevelTon, estimatedTon: item.estimatedTon,
      closeReason: text(item.closeReason), detectionClosedAt: text(item.detectionClosedAt),
      algorithmVersion: text(item.algorithmVersion), sourceKind: "dataparc_bed_ash_minute", sampleIntervalSeconds: 60,
      observationReason: item.estimatedTon < 3 ? "below_threshold" : "slow_decline",
      isRapidDecline: false, ...sourceGapMetadata(item), reviewReady: false
    })).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  }

  function formatTon(value) {
    const numericValue = number(value);
    return `${numericValue.toLocaleString("ko-KR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2
    })}t`;
  }

  function normalizeEvent(rawEvent) {
    const event = rawEvent && typeof rawEvent === "object" ? rawEvent : {};
    const normalizedStatus = FILTERS.has(text(event.status)) && text(event.status) !== "all"
      ? text(event.status)
      : "pending";
    const gaps = sourceGapMetadata(event);

    return {
      eventKey: text(event.eventKey),
      revision: Math.max(1, Math.trunc(number(event.revision, 1))),
      unitNo: text(event.unitNo) === "2" ? "2" : "1",
      tagNumber: text(event.tagNumber),
      startAt: text(event.startAt),
      endAt: text(event.endAt),
      thresholdCrossedAt: text(event.thresholdCrossedAt),
      startLevelTon: number(event.startLevelTon),
      endLevelTon: number(event.endLevelTon),
      estimatedTon: number(event.estimatedTon),
      confidence: gaps.hasSourceGaps ? "low" : text(event.confidence) || "medium",
      ...gaps,
      algorithmVersion: text(event.algorithmVersion),
      isRapidDecline: event.isRapidDecline === true,
      sourceKind: text(event.sourceKind),
      sampleIntervalSeconds: Math.max(0, number(event.sampleIntervalSeconds)),
      overlapOtherUnit: event.overlapOtherUnit === true,
      overlapStartAt: text(event.overlapStartAt),
      overlapEndAt: text(event.overlapEndAt),
      overlapEventKeys: Array.isArray(event.overlapEventKeys) ? event.overlapEventKeys.map(text) : [],
      minuteObservations: normalizeMinuteObservations(event.minuteObservations, text(event.unitNo) === "2" ? "2" : "1"),
      closeReason: text(event.closeReason),
      status: normalizedStatus,
      confirmedAt: text(event.confirmedAt),
      confirmedTon: event.confirmedTon === null || event.confirmedTon === undefined
        ? null
        : number(event.confirmedTon),
      note: text(event.note),
      reviewer: event.reviewer && typeof event.reviewer === "object"
        ? {
            employeeNo: text(event.reviewer.employeeNo),
            name: text(event.reviewer.name),
            reviewedAt: text(event.reviewer.reviewedAt)
          }
        : null,
      evidenceFingerprint: text(event.evidenceFingerprint),
      reviewReady: event.reviewReady === true && !gaps.hasSourceGaps
    };
  }

  function normalizeSummary(rawSummary) {
    const source = rawSummary && typeof rawSummary === "object" ? rawSummary : {};
    return {
      confirmedCount: Math.max(0, Math.trunc(number(source.confirmedCount))),
      confirmedTon: Math.max(0, number(source.confirmedTon)),
      pendingCount: Math.max(0, Math.trunc(number(source.pendingCount))),
      pendingEstimatedTon: Math.max(0, number(source.pendingEstimatedTon)),
      unit1Ton: Math.max(0, number(source.unit1Ton)),
      unit2Ton: Math.max(0, number(source.unit2Ton))
    };
  }

  function summarizeVisibleEvents(events) {
    const summary = emptySummary();
    const visibleEvents = Array.isArray(events)
      ? events.filter(event => event.status !== "excluded")
      : [];

    // Observed silo decreases and manually confirmed quantities are independent.
    // A partial day still has usable observed endpoints. Shared corrected evidence
    // attached to several reviewed records is counted once, never allocated.
    const observed = new Map();
    const addObservation = (observation, unitNo) => {
      const amount = observation?.estimatedTon;
      if (!["1", "2"].includes(text(unitNo)) || typeof amount !== "number" ||
          !Number.isFinite(amount) || amount <= 0) return;
      const key = `${unitNo}:${text(observation.eventKey) || `${text(observation.startAt)}:${text(observation.endAt)}`}`;
      const hasSourceGaps = sourceGapMetadata(observation).hasSourceGaps;
      const sharedReviewedEvidence = observation.sharedReviewedEvidence === true;
      const previous = observed.get(key);
      if (previous) {
        previous.hasSourceGaps ||= hasSourceGaps;
        previous.sharedReviewedEvidence ||= sharedReviewedEvidence;
        return;
      }
      observed.set(key, { unitNo, amount, hasSourceGaps, sharedReviewedEvidence });
    };
    visibleEvents.forEach(event => {
      const linked = Array.isArray(event.minuteObservations) ? event.minuteObservations : [];
      if (linked.length) linked.forEach(item => addObservation(item, event.unitNo));
      else addObservation(event, event.unitNo);
    });
    for (const { unitNo, amount, hasSourceGaps, sharedReviewedEvidence } of observed.values()) {
      const unit = summary.units[unitNo];
      summary.observedCount += 1; unit.observedCount += 1;
      summary.observedTon += amount; unit.observedTon += amount;
      if (hasSourceGaps) {
        summary.observedGapCount += 1; unit.observedGapCount += 1;
      }
      if (sharedReviewedEvidence) {
        summary.sharedObservedCount += 1; unit.sharedObservedCount += 1;
      }
    }

    visibleEvents.forEach(event => {
      const unit = summary.units[text(event.unitNo) === "2" ? 2 : 1];
      if (event.status === "confirmed") {
        const eventTon = typeof event.confirmedTon === "number" && Number.isFinite(event.confirmedTon)
          ? Math.max(0, event.confirmedTon) : 0;
        summary.confirmedCount += 1;
        summary.confirmedTon += eventTon;
        unit.confirmedCount += 1;
        unit.confirmedTon += eventTon;
      } else if (event.reviewReady === true && !sourceGapMetadata(event).hasSourceGaps) {
        summary.observationCount += 1;
        unit.observationCount += 1;
        const eventTon = Math.max(0, number(event.estimatedTon));
        summary.pendingCount += 1;
        summary.pendingEstimatedTon += eventTon;
        unit.pendingCount += 1;
        unit.pendingEstimatedTon += eventTon;
      } else {
        summary.observationCount += 1;
        unit.observationCount += 1;
        summary.incompleteCount += 1;
        unit.incompleteCount += 1;
      }
    });

    ["confirmedTon", "pendingEstimatedTon", "observedTon"].forEach(key => {
      summary[key] = Math.round(summary[key] * 1000) / 1000;
    });
    for (const unit of Object.values(summary.units)) {
      for (const key of ["confirmedTon", "pendingEstimatedTon", "observedTon"]) {
        unit[key] = Math.round(unit[key] * 1000) / 1000;
      }
    }
    summary.unit1Ton = summary.units[1].confirmedTon;
    summary.unit2Ton = summary.units[2].confirmedTon;

    return summary;
  }
  function normalizeLatestLevel(rawLevel) {
    if (!rawLevel || typeof rawLevel !== "object") {
      return null;
    }

    const sampledAt = text(rawLevel.sampledAt);
    const levelTon = rawLevel.levelTon;
    if (!sampledAt || typeof levelTon !== "number" || !Number.isFinite(levelTon) || levelTon < 0) {
      return null;
    }

    return {
      unitNo: text(rawLevel.unitNo),
      tagNumber: text(rawLevel.tagNumber),
      sampledAt,
      levelTon,
      sourceDate: text(rawLevel.sourceDate)
    };
  }

  function normalizeUnitCoverage(raw) {
    if (!raw || typeof raw !== "object") return null;
    const count = value => Math.max(0, Math.trunc(number(value)));
    return {
      hasMinuteSource: raw.hasMinuteSource === true,
      minuteSampleCount: count(raw.minuteSampleCount),
      validMinuteSampleCount: count(raw.validMinuteSampleCount),
      missingMinuteSampleCount: count(raw.missingMinuteSampleCount),
      hasGaps: raw.hasGaps === true,
      latestMinuteBucketAt: text(raw.latestMinuteBucketAt),
      latestMinuteMissing: raw.latestMinuteMissing === true,
      latestValidAt: text(raw.latestValidAt),
      hourlySampleCount: count(raw.hourlySampleCount)
    };
  }

  function unitCoverageMessage(coverage) {
    if (!coverage) return "자료 수신 상태 확인 필요";
    if (coverage.hasMinuteSource) {
      if (!coverage.validMinuteSampleCount) return "1분 자료 미수신 · 반출 여부 확인 불가";
      return `1분 자료 ${coverage.validMinuteSampleCount}/${coverage.minuteSampleCount}개` +
        (coverage.hasGaps ? " · 누락 있음" : "");
    }
    return coverage.hourlySampleCount ? "시간 자료 기준" : "자료 미수신 · 반출 여부 확인 불가";
  }

  function normalizeCoverage(rawCoverage, requestedDates) {
    const coverage = rawCoverage && typeof rawCoverage === "object" ? rawCoverage : {};
    const completeDates = uniqueDateList(coverage.completeDates);
    const pendingDates = uniqueDateList(coverage.pendingDates);
    const failedDates = uniqueDateList(coverage.failedDates);
    const statedDates = uniqueDateList(coverage.dates);
    const allDates = uniqueDateList(
      statedDates.length > 0 ? statedDates : requestedDates
    );
    const occupied = new Set([...completeDates, ...pendingDates, ...failedDates]);
    const missingDates = uniqueDateList([
      ...(Array.isArray(coverage.missingDates) ? coverage.missingDates : []),
      ...allDates.filter(date => !occupied.has(date))
    ]).filter(date => !occupied.has(date));

    const normalizeSupportCoverage = (rawSupport, defaultAvailable = true) => {
      if (
        !rawSupport ||
        typeof rawSupport !== "object" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(text(rawSupport.date))
      ) {
        return null;
      }

      const status = text(rawSupport.status).toLowerCase() || "missing";
      const available = rawSupport.available !== false && defaultAvailable;
      const pending = Boolean(
        available &&
        (
          rawSupport.pending === true ||
          ["pending", "processing"].includes(status)
        )
      );
      const failed = Boolean(
        available &&
        (
          rawSupport.failed === true ||
          ["failed", "expired"].includes(status)
        )
      );
      const complete = available && rawSupport.complete === true;

      return {
        date: text(rawSupport.date),
        available,
        status,
        complete,
        missing: Boolean(
          available &&
          !complete &&
          !pending &&
          !failed
        ),
        pending,
        failed,
        requestId: text(rawSupport.requestId),
        updatedAt: text(rawSupport.updatedAt),
        errorMessage: text(rawSupport.errorMessage)
      };
    };

    const baseline = normalizeSupportCoverage(coverage.baseline);
    const lookahead = normalizeSupportCoverage(
      coverage.lookahead,
      coverage.lookahead?.available !== false
    );

    return {
      dates: allDates,
      completeDates,
      minuteDates: uniqueDateList(coverage.minuteDates),
      hourlyDates: uniqueDateList(coverage.hourlyDates),
      precisionFailures: Array.isArray(coverage.precisionFailures) ? coverage.precisionFailures : [],
      missingDates,
      pendingDates,
      failedDates,
      requests: Array.isArray(coverage.requests) ? coverage.requests : [],
      baseline,
      lookahead,
      reviewReady: coverage.reviewReady === true
    };
  }

  function hasMinuteRange(coverage, requestedDates = coverage?.dates) {
    const dates = uniqueDateList(requestedDates);
    const minuteDates = new Set(coverage?.minuteDates || []);
    return dates.length > 0 && dates.every(date => minuteDates.has(date));
  }

  function hasCoverageWarning(coverage) {
    return Boolean(coverage?.precisionFailures?.length || coverage?.failedDates?.length ||
      coverage?.missingDates?.length || coverage?.pendingDates?.length ||
      (!hasMinuteRange(coverage) && ((coverage?.baseline && !coverage.baseline.complete) ||
        (coverage?.lookahead?.available && !coverage.lookahead.complete))) ||
      state.summary.incompleteCount || Object.values(state.unitCoverage).some(unit => unit?.hasGaps));
  }

  function setStatus(message, tone = "idle", compactMessage = "") {
    const { status, sourceDetails, sourceDetailText, sourceStatusText } = getElements();
    if (!status) {
      return;
    }

    status.textContent = text(compactMessage || message);
    status.title = compactMessage ? text(message) : "";
    status.dataset.state = tone;
    if (sourceStatusText) {
      sourceStatusText.textContent = compactMessage ? text(message) : "";
      sourceStatusText.hidden = !compactMessage;
    }
    if (sourceDetails) {
      sourceDetails.hidden = !text(sourceDetailText?.textContent) && !compactMessage;
    }
  }

  function isQueryTimerVisible() {
    const view = document.getElementById?.("efficiencyBedAshDischargeView");
    const modal = document.getElementById?.("efficiencyTeamModal");
    return Boolean(view && !view.hidden && view.classList.contains("is-active") &&
      document.visibilityState !== "hidden" &&
      (!modal || (!modal.hidden && modal.getAttribute("aria-hidden") !== "true")));
  }

  function stopQueryTimerInterval() {
    if (state.queryTimerId) window.clearInterval(state.queryTimerId);
    state.queryTimerId = 0;
  }

  function renderQueryElapsedTime() {
    const elapsedTime = document.getElementById?.("bedAshDischargeElapsedTime");
    if (!elapsedTime) return;
    const timing = state.queryTiming;
    elapsedTime.hidden = !timing;
    if (!timing) {
      elapsedTime.textContent = "";
      return;
    }
    const seconds = Math.max(0, Math.floor(((timing.endedAt ?? Date.now()) - timing.startedAt) / 1000));
    const duration = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    const outcome = { complete: "완료", failed: "실패", timeout: "시간 초과", unsettled: "자료 확인 필요" }[timing.outcome];
    elapsedTime.textContent = `조회 경과 ${duration} · ${timing.phase}${outcome ? ` · ${outcome}` : ""}`;
    elapsedTime.dataset.state = timing.outcome;
  }

  function synchronizeQueryTimerVisibility() {
    const timing = state.queryTiming;
    renderQueryElapsedTime();
    if (!timing || timing.endedAt !== null || !isQueryTimerVisible()) {
      stopQueryTimerInterval();
      return;
    }
    if (state.queryTimerId) return;
    const timerId = window.setInterval(() => {
      if (state.queryTiming !== timing || state.queryTimerId !== timerId) return;
      if (!isQueryTimerVisible()) {
        stopQueryTimerInterval();
        return;
      }
      renderQueryElapsedTime();
    }, 1000);
    state.queryTimerId = timerId;
  }

  function startQueryTiming(sequence) {
    stopQueryTimerInterval();
    state.queryTiming = { sequence, startedAt: Date.now(), endedAt: null, phase: "저장 자료", outcome: "running" };
    synchronizeQueryTimerVisibility();
  }

  function setQueryPhase(sequence, phase) {
    if (state.queryTiming?.sequence !== sequence) return;
    state.queryTiming.phase = phase;
    renderQueryElapsedTime();
  }

  function finishQueryTiming(sequence, outcome) {
    if (state.queryTiming?.sequence !== sequence || state.queryTiming.endedAt !== null) return;
    state.queryTiming.endedAt = Date.now();
    state.queryTiming.outcome = outcome;
    stopQueryTimerInterval();
    renderQueryElapsedTime();
  }

  function clearQueryTiming() {
    stopQueryTimerInterval();
    state.queryTiming = null;
    renderQueryElapsedTime();
  }

  function setLoading(isLoading) {
    state.loading = isLoading;
    const elements = getElements();

    if (elements.view) {
      elements.view.setAttribute("aria-busy", String(isLoading));
    }
    if (elements.loadingState) {
      elements.loadingState.hidden = !isLoading;
    }
    if (elements.refreshButton) {
      elements.refreshButton.disabled = isLoading || isMobileClient();
    }
    renderPeriodControls();
  }

  function setCardSupportingText(valueElement, value) {
    const supportingText = valueElement?.closest("article")?.querySelector("small");
    if (supportingText) {
      supportingText.textContent = value;
    }
  }

  function renderSummaryCards() {
    const elements = getElements();
    const summary = state.summary;

    if (elements.totalAmount) {
      elements.totalAmount.textContent = summary.observedCount ? formatTon(summary.observedTon) : "감지 내역 없음";
      elements.totalAmount.dataset.state = summary.observedCount ? "observed" : "none";
      setCardSupportingText(
        elements.totalAmount,
        observedCardDetail(summary)
      );
    }
    if (elements.unitOneAmount) {
      renderUnitSummary(elements.unitOneAmount, summary.units[1], state.unitCoverage[1]);
    }
    if (elements.unitTwoAmount) {
      renderUnitSummary(elements.unitTwoAmount, summary.units[2], state.unitCoverage[2]);
    }
    if (elements.pendingCount) {
      elements.pendingCount.textContent = `${summary.pendingCount}건`;
      setCardSupportingText(
        elements.pendingCount,
        `계근 확인 전 ${formatTon(summary.pendingEstimatedTon)}`
      );
    }
    const coverageLines = [1, 2].map(unitNo => state.unitCoverage[unitNo]
      ? `${unitNo}호기: ${unitCoverageMessage(state.unitCoverage[unitNo])} · ${latestLevelSourceMessage(state.latestLevels[unitNo], state.unitCoverage[unitNo])}`
      : "").filter(Boolean);
    if (elements.sourceDetails) elements.sourceDetails.hidden = coverageLines.length === 0;
    if (elements.sourceDetailText) elements.sourceDetailText.textContent = coverageLines.join(" / ");
  }

  function observedCardDetail(summary) {
    return `감지 ${summary.observedCount}구간 · 계근 확정 ${summary.confirmedCount}건 · ${formatTon(summary.confirmedTon)}` +
      (summary.observedGapCount ? ` · 공백 포함 ${summary.observedGapCount}구간` : "") +
      (summary.sharedObservedCount ? ` · 공유 근거 ${summary.sharedObservedCount}구간` : "");
  }

  function renderUnitSummary(element, unit, coverage) {
    const hasSource = Boolean(coverage?.validMinuteSampleCount || coverage?.hourlySampleCount);
    element.textContent = unit.observedCount ? formatTon(unit.observedTon)
      : hasSource ? "감지 내역 없음" : "자료 없음";
    element.dataset.state = unit.observedCount ? "observed" : hasSource ? "none" : "unknown";
    setCardSupportingText(element, observedCardDetail(unit) +
      (!unit.observedCount && !hasSource ? " · 반출 여부 확인 불가" : ""));
  }

  function renderLatestLevel(level, levelElement, timeElement, coverage) {
    if (!level) {
      if (levelElement) {
        levelElement.textContent = "--.-t";
      }
      if (timeElement) {
        timeElement.textContent = coverage?.latestMinuteMissing
          ? `${formatLatestClock(coverage.latestMinuteBucketAt)} 자료 미수신`
          : "유효 중량 자료 없음";
        timeElement.title = latestLevelSourceMessage(level, coverage);
      }
      return;
    }

    if (levelElement) {
      levelElement.textContent = formatTon(level.levelTon);
    }
    if (timeElement) {
      timeElement.textContent = `${formatLatestClock(level.sampledAt)} 기준` +
        (coverage?.latestMinuteMissing
          ? " · 이후 미수신"
          : coverage?.hasGaps ? " · 중간 공백" : "");
      timeElement.title = latestLevelSourceMessage(level, coverage);
    }
  }

  function latestLevelSourceMessage(level, coverage) {
    const latest = level
      ? `${formatTimestamp(level.sampledAt)} 마지막 유효값${level.sourceDate ? ` · 원자료 ${level.sourceDate}` : ""}`
      : "유효 중량 자료 없음";
    return latest + (coverage?.latestMinuteMissing
      ? ` · ${formatTimestamp(coverage.latestMinuteBucketAt)} 자료 미수신`
      : coverage?.hasGaps ? " · 중간 자료 누락 있음" : "");
  }

  function formatLatestClock(value) {
    const parts = getTimestampParts(value);
    if (!parts) return "-";
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const includeDate = state.period !== "daily" || (state.anchorDate && state.anchorDate !== date);
    return `${includeDate ? `${parts.month}.${parts.day} ` : ""}${parts.hour}:${parts.minute}`;
  }

  function renderLatestLevels() {
    const elements = getElements();
    renderLatestLevel(
      state.latestLevels[1],
      elements.unitOneLatestLevel,
      elements.unitOneLatestAt,
      state.unitCoverage[1]
    );
    renderLatestLevel(
      state.latestLevels[2],
      elements.unitTwoLatestLevel,
      elements.unitTwoLatestAt,
      state.unitCoverage[2]
    );
  }

  function createElement(tagName, className, content) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (content !== undefined) {
      element.textContent = String(content);
    }
    return element;
  }

  function getStatusLabel(status) {
    if (status === "confirmed") {
      return "확인 완료";
    }
    if (status === "excluded") {
      return "제외";
    }
    return "확인 대기";
  }

  function createReviewInput(labelText, type, className, value) {
    const label = createElement("label", "bed-ash-discharge-review-field");
    const labelSpan = createElement("span", "", labelText);
    const input = document.createElement("input");
    input.type = type;
    input.className = className;
    input.value = value;
    input.dataset.bedAshReviewField = "";
    input.setAttribute("aria-label", labelText);
    label.append(labelSpan, input);
    return { label, input };
  }

  function createReviewControls(event) {
    const wrapper = createElement("div", "bed-ash-discharge-review-controls");
    const draft = state.reviewDrafts.get(event.eventKey);
    const isSubmitting = state.submittingEventKeys.has(event.eventKey);
    const actualAt = createReviewInput(
      "실제 반출시각",
      "datetime-local",
      "bed-ash-discharge-review-at",
      draft
        ? draft.actualAt
        : toDateTimeLocalValue(
            event.confirmedAt || event.thresholdCrossedAt || event.endAt
          )
    );
    actualAt.input.dataset.bedAshReviewField = "actualAt";
    actualAt.input.step = "60";
    actualAt.input.max = getKstNowDateTimeLocal();
    actualAt.input.addEventListener("focus", () => {
      actualAt.input.max = getKstNowDateTimeLocal();
    });

    const actualTon = createReviewInput(
      "실제 반출량",
      "number",
      "bed-ash-discharge-review-ton bed-ash-discharge-actual-amount-input",
      draft
        ? draft.actualTon
        : number(event.confirmedTon ?? event.estimatedTon).toFixed(1)
    );
    actualTon.input.dataset.bedAshReviewField = "actualTon";
    actualTon.input.min = "0.1";
    actualTon.input.max = "10000";
    actualTon.input.step = "0.1";
    actualTon.input.inputMode = "decimal";

    const note = createReviewInput(
      "확인 메모",
      "text",
      "bed-ash-discharge-review-note",
      draft ? draft.note : event.note
    );
    note.input.dataset.bedAshReviewField = "note";
    note.input.maxLength = 200;
    note.input.placeholder = "선택 입력";

    const actions = createElement("div", "bed-ash-discharge-review-actions");
    const confirmButton = createElement(
      "button",
      "bed-ash-discharge-review-confirm",
      "반출 확인"
    );
    confirmButton.type = "button";
    confirmButton.dataset.bedAshReviewAction = "confirm";
    confirmButton.dataset.eventKey = event.eventKey;

    const excludeButton = createElement(
      "button",
      "bed-ash-discharge-review-exclude",
      "제외"
    );
    excludeButton.type = "button";
    excludeButton.dataset.bedAshReviewAction = "exclude";
    excludeButton.dataset.eventKey = event.eventKey;

    [actualAt.input, actualTon.input, note.input].forEach(input => {
      input.disabled = isSubmitting;
    });
    confirmButton.disabled = isSubmitting;
    excludeButton.disabled = isSubmitting;

    actions.append(confirmButton, excludeButton);
    wrapper.append(actualAt.label, actualTon.label, note.label, actions);
    return wrapper;
  }

  function storeReviewDraft(reviewRow) {
    if (!(reviewRow instanceof Element)) {
      return;
    }

    const eventKey = text(reviewRow.dataset.eventKey);
    const wrapper = reviewRow.querySelector(".bed-ash-discharge-review-controls");
    if (!eventKey || !wrapper) {
      return;
    }

    state.reviewDrafts.set(eventKey, {
      actualAt: String(
        wrapper.querySelector(".bed-ash-discharge-review-at")?.value ?? ""
      ),
      actualTon: String(
        wrapper.querySelector(".bed-ash-discharge-review-ton")?.value ?? ""
      ),
      note: String(
        wrapper.querySelector(".bed-ash-discharge-review-note")?.value ?? ""
      )
    });
  }

  function captureReviewEditorFocus(tableBody) {
    const activeElement = document.activeElement;
    if (
      !(tableBody instanceof Element) ||
      !(activeElement instanceof Element) ||
      !tableBody.contains(activeElement) ||
      !activeElement.matches("[data-bed-ash-review-field]")
    ) {
      return null;
    }

    const reviewRow = activeElement.closest(".bed-ash-discharge-review-row");
    const eventKey = text(reviewRow?.dataset.eventKey);
    const fieldName = text(activeElement.dataset.bedAshReviewField);
    if (!eventKey || !fieldName) {
      return null;
    }

    let selectionStart = null;
    let selectionEnd = null;
    let selectionDirection = "none";
    try {
      selectionStart = activeElement.selectionStart;
      selectionEnd = activeElement.selectionEnd;
      selectionDirection = activeElement.selectionDirection || "none";
    } catch {
      selectionStart = null;
      selectionEnd = null;
    }

    return {
      eventKey,
      fieldName,
      selectionStart,
      selectionEnd,
      selectionDirection
    };
  }

  function restoreReviewEditorFocus(tableBody, focusState) {
    if (!(tableBody instanceof Element) || !focusState) {
      return;
    }

    const reviewRow = [...tableBody.querySelectorAll(
      ".bed-ash-discharge-review-row"
    )].find(row => text(row.dataset.eventKey) === focusState.eventKey);
    const field = reviewRow?.querySelector(
      `[data-bed-ash-review-field="${focusState.fieldName}"]`
    );
    if (!field || field.disabled) {
      return;
    }

    try {
      field.focus({ preventScroll: true });
    } catch {
      field.focus();
    }

    if (
      Number.isInteger(focusState.selectionStart) &&
      Number.isInteger(focusState.selectionEnd)
    ) {
      try {
        field.setSelectionRange(
          focusState.selectionStart,
          focusState.selectionEnd,
          focusState.selectionDirection
        );
      } catch {
        // number/datetime-local inputs do not expose text selection APIs.
      }
    }
  }

  function createReviewRow(event) {
    const row = createElement(
      "tr",
      "bed-ash-discharge-review-row"
    );
    row.id = getReviewPanelId(event.eventKey);
    row.dataset.eventKey = event.eventKey;

    const cell = createElement(
      "td",
      "bed-ash-discharge-review-panel-cell"
    );
    cell.colSpan = 6;
    cell.appendChild(createReviewControls(event));
    row.appendChild(cell);
    return row;
  }

  function getReviewPanelId(eventKey) {
    let hash = 2166136261;
    for (const character of text(eventKey)) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `bedAshDischargeReviewPanel-${(hash >>> 0).toString(36)}`;
  }

  function appendSourceGapNotice(container, observation) {
    if (!observation.hasSourceGaps) return;
    const notice = createElement("small", "bed-ash-discharge-minute-pending-note", "자료 공백 포함 · 계근 확인");
    notice.title = observation.sourceGapCount
      ? `NoData 분 자료 ${observation.sourceGapCount}개가 포함된 전후 관측입니다. 차량별 반출시각·반출량은 계근 기록을 확인하세요.`
      : "자료 공백이 포함된 전후 관측입니다. 차량별 반출시각·반출량은 계근 기록을 확인하세요.";
    container.appendChild(notice);
  }

  function createEventRow(event) {
    const row = createElement(
      "tr",
      `bed-ash-discharge-event-row is-${event.status}`
    );
    row.dataset.eventKey = event.eventKey;

    const timeCell = createElement("td", "bed-ash-discharge-time-cell");
    const detectionRange = formatDetectionRange(event.startAt, event.endAt);
    const observations = event.minuteObservations || [];
    if (event.hasSourceGaps || observations.some(item => item.hasSourceGaps)) row.classList.add("has-source-gaps");
    const confirmedTime = event.status === "confirmed" && event.confirmedAt
      ? formatTimestamp(event.confirmedAt)
      : "";
    if (observations.length) {
      for (const observation of observations) {
        const observedRange = createElement("strong", "bed-ash-discharge-minute-range",
          formatDetectionRange(observation.startAt, observation.endAt));
        observedRange.title = `전후 관측 시각 ${formatHourlyRange(observation.startAt, observation.endAt, true)}`;
        timeCell.appendChild(observedRange);
        appendSourceGapNotice(timeCell, observation);
      }
      timeCell.appendChild(createElement("small", "", "DataPARC · 1분 감지 근거"));
      timeCell.appendChild(createElement("small", "", "새 관측 근거 · 읽기 전용"));
      const original = createElement("details", "bed-ash-discharge-original-evidence");
      original.append(createElement("summary", "", isMinuteEvent(event) ? "기존 분 감지 기록" : "기존 시간기록"),
        createElement("small", "", `${eventSourceLabel(event)} · ${formatHourlyRange(event.startAt, event.endAt)}${confirmedTime ? ` · 확정 시각 ${confirmedTime}` : ""}`));
      timeCell.appendChild(original);
      if (observations.some(item => item.sharedReviewedEvidence)) {
        timeCell.appendChild(createElement("small", "bed-ash-discharge-minute-pending-note",
          "공유 감지 근거 · 개별 반출 연결 미확정"));
      }
    } else {
      timeCell.title = `${eventSourceLabel(event)} · 전후 관측 시각 ${formatHourlyRange(event.startAt, event.endAt, true)}`;
      timeCell.append(
      createElement(
        "strong",
        "",
        confirmedTime && !isMinuteEvent(event) ? `실제 ${confirmedTime}`
          : event.status === "pending" && isMinuteEvent(event)
            ? `${isRapidDischargeEvent(event) ? "감지 구간" : "관측 구간"} ${detectionRange}` : detectionRange
      ),
      createElement(
        "small",
        event.status === "pending" && isMinuteEvent(event) ? "bed-ash-discharge-repeated-source" : "",
        confirmedTime && !isMinuteEvent(event)
          ? `${eventSourceLabel(event)} ${detectionRange}`
          : eventSourceLabel(event)
      )
      );
    }
    if (!observations.length && isMinuteEvent(event) && confirmedTime) {
      timeCell.appendChild(createElement("small", "", `확정 시각 ${confirmedTime}`));
    }
    if ((event.overlapOtherUnit || observations.some(item => item.overlapOtherUnit)) && event.status !== "excluded") {
      row.classList.add("is-unit-overlap");
      const overlapNote = createElement(
        "small", "bed-ash-discharge-overlap-note",
        "시간 겹침 · 차량 확인"
      );
      overlapNote.setAttribute("title", "1·2호기 감지 구간이 겹칩니다. 차량별 계근 기록을 확인하세요.");
      timeCell.appendChild(overlapNote);
    }
    if (isMinuteEvent(event) && event.status === "pending" && !event.reviewReady) {
      if (event.hasSourceGaps) appendSourceGapNotice(timeCell, event);
      else timeCell.appendChild(createElement(
        "small", "bed-ash-discharge-minute-pending-note",
        "관측 구간 확인 중 · 종료 자료 확인 필요"
      ));
    }
    row.appendChild(timeCell);

    const unitCell = createElement("td", "bed-ash-discharge-unit-cell");
    unitCell.appendChild(
      createElement("span", `is-unit-${event.unitNo}`, `${event.unitNo || "-"}호기`)
    );
    row.appendChild(unitCell);

    const levelChangeCell = createElement(
      "td",
      "bed-ash-discharge-level-change-cell"
    );
    if (observations.length) {
      for (const observation of observations) {
        levelChangeCell.append(createElement("strong", "bed-ash-discharge-minute-range",
          `${formatTon(observation.startLevelTon)} → ${formatTon(observation.endLevelTon)}`),
          createElement("small", "", `${isRapidDischargeEvent(observation) ? "반출 감지량 · 추정" : "관측 감소량"} ${formatTon(observation.estimatedTon)}`));
      }
    } else levelChangeCell.appendChild(
      createElement(
        "strong",
        "",
        `${formatTon(event.startLevelTon)} → ${formatTon(event.endLevelTon)}`
      )
    );
    row.appendChild(levelChangeCell);

    const estimatedCell = createElement("td", "bed-ash-discharge-estimated-cell");
    const visibleAmountTon =
      event.status === "confirmed" && event.confirmedTon !== null
        ? event.confirmedTon
        : event.estimatedTon;
    const isTruckBoundaryUnresolved =
      event.closeReason === "truck_boundary_unresolved";
    const isLegacyReviewedEvent =
      !CURRENT_DETECTOR_VERSIONS.has(event.algorithmVersion) &&
      ["confirmed", "excluded"].includes(event.status);
    if (observations.length) {
      estimatedCell.append(createElement("strong", "", formatTon(visibleAmountTon)),
        createElement("small", "", event.status === "confirmed" ? "기존 확정량" : "기존 제외 기록"),
        createElement("small", "", "구간별 배분 안 함"));
    } else if (isTruckBoundaryUnresolved) {
      estimatedCell.classList.add("is-truck-boundary-unresolved");
      estimatedCell.append(
        createElement("strong", "", formatTon(visibleAmountTon)),
        createElement("small", "", isMinuteEvent(event) ? "관측 감소량 · 계근 확인" : "반출량")
      );
    } else if (isLegacyReviewedEvent) {
      estimatedCell.classList.add("is-legacy-reviewed-event");
      estimatedCell.append(
        createElement(
          "strong",
          "",
          event.status === "confirmed"
            ? "기존 방식 확정 합계"
            : "기존 방식 제외 기록"
        ),
        createElement(
          "small",
          "",
          `${event.status === "confirmed" ? "확정량" : "기록 하락량"} ${formatTon(visibleAmountTon)}`
        )
      );
    } else {
      estimatedCell.append(
        createElement("strong", "", formatTon(visibleAmountTon)),
        createElement("small", "", event.status === "confirmed" ? "계근 확정량"
          : isRapidDischargeEvent(event) ? "반출 감지량 · 추정"
          : isMinuteEvent(event) ? "관측 감소량 · 계근 확인" : "반출량")
      );
    }
    row.appendChild(estimatedCell);

    const statusCell = createElement("td", "bed-ash-discharge-status-cell");
    const isProvisional = event.status === "pending" && !event.reviewReady;
    statusCell.appendChild(
      createElement(
        "span",
        `bed-ash-discharge-status-badge is-${
          isTruckBoundaryUnresolved
            ? "boundary-unresolved"
            : isProvisional
              ? "provisional"
              : event.status
        }`,
        isTruckBoundaryUnresolved
          ? "시간 경계 확인 필요"
          : event.status === "pending" && isRapidDischargeEvent(event)
            ? "Silo 반출 감지"
            : isProvisional
              ? event.hasSourceGaps ? "자료 공백 포함 · 계근 확인" : "자료 확인 중"
              : getStatusLabel(event.status)
      )
    );
    if (event.status === "confirmed" && event.confirmedTon !== null) {
      statusCell.appendChild(
        createElement("small", "", `계근 확정량 ${formatTon(event.confirmedTon)}`)
      );
    }
    if (event.reviewer) {
      const reviewerSummary = createElement(
        "span",
        "bed-ash-discharge-reviewer-summary"
      );
      reviewerSummary.append(
        createElement(
          "strong",
          "",
          event.reviewer.name || event.reviewer.employeeNo || "확인자"
        ),
        createElement(
          "small",
          "",
          formatTimestamp(event.reviewer.reviewedAt || event.confirmedAt)
        )
      );
      statusCell.appendChild(reviewerSummary);
    }
    row.appendChild(statusCell);

    const actionCell = createElement("td", "bed-ash-discharge-action-cell");
    if (isTruckBoundaryUnresolved) {
      actionCell.appendChild(
        createElement(
          "span",
          "bed-ash-discharge-boundary-note",
          "시간 경계 확인 필요"
        )
      );
    } else if (event.status === "pending" && !event.reviewReady) {
      const provisionalNote = createElement(
        "span",
        "bed-ash-discharge-provisional-note",
        event.hasSourceGaps ? "원자료·계근 확인 필요" : "종료 자료 확인 필요"
      );
      provisionalNote.title = event.hasSourceGaps
        ? "자료 공백이 포함된 관측 구간은 자동 확정하지 않습니다. 원자료와 계근 기록을 확인하세요."
        : isMinuteEvent(event) ? "연속된 관측 구간과 종료 자료를 확인한 후 계근 기록을 확인하세요."
          : "첫날 기준·마지막 날 후속 자료 수집 후 확인 가능";
      actionCell.appendChild(provisionalNote);
    } else if (event.status === "pending" && !isMobileClient()) {
      const isSubmitting = state.submittingEventKeys.has(event.eventKey);
      const isAnotherEventSubmitting =
        !isSubmitting && state.submittingEventKeys.size > 0;
      const toggleButton = createElement(
        "button",
        "bed-ash-discharge-review-toggle",
        isSubmitting
          ? "저장 중"
          : isAnotherEventSubmitting
            ? "저장 대기"
          : state.expandedReviewEventKey === event.eventKey
            ? "입력 닫기"
            : "확인 입력"
      );
      toggleButton.type = "button";
      toggleButton.disabled = isSubmitting || isAnotherEventSubmitting;
      toggleButton.dataset.bedAshReviewToggle = "";
      toggleButton.dataset.eventKey = event.eventKey;
      toggleButton.setAttribute(
        "aria-expanded",
        String(state.expandedReviewEventKey === event.eventKey)
      );
      toggleButton.setAttribute(
        "aria-controls",
        getReviewPanelId(event.eventKey)
      );
      actionCell.appendChild(toggleButton);
    } else if (event.status === "pending") {
      actionCell.appendChild(
        createElement("span", "bed-ash-discharge-action-state", "PC에서 확인")
      );
    } else {
      actionCell.appendChild(
        createElement(
          "span",
          "bed-ash-discharge-action-state",
          "-"
        )
      );
    }
    row.appendChild(actionCell);

    return row;
  }

  function renderEvents() {
    const elements = getElements();
    if (!elements.tableBody) {
      return;
    }
    if (state.composingReviewEventKey) {
      state.renderEventsQueued = true;
      return;
    }

    const currentReviewRow = elements.tableBody.querySelector(
      ".bed-ash-discharge-review-row"
    );
    if (
      currentReviewRow &&
      text(currentReviewRow.dataset.eventKey) === state.expandedReviewEventKey
    ) {
      storeReviewDraft(currentReviewRow);
    }
    const focusState = captureReviewEditorFocus(elements.tableBody);
    state.renderEventsQueued = false;

    const visibleEvents = state.events.filter(event => {
      return event.status !== "excluded";
    });
    const expandedEvent = visibleEvents.find(event => {
      return (
        event.eventKey === state.expandedReviewEventKey &&
        event.status === "pending" &&
        event.reviewReady &&
        event.closeReason !== "truck_boundary_unresolved" &&
        !isMobileClient()
      );
    });
    if (!expandedEvent) {
      state.expandedReviewEventKey = "";
    }

    const fragment = document.createDocumentFragment();
    visibleEvents.forEach(event => {
      fragment.appendChild(createEventRow(event));
      if (event.eventKey === state.expandedReviewEventKey) {
        fragment.appendChild(createReviewRow(event));
      }
    });
    elements.tableBody.replaceChildren(fragment);
    restoreReviewEditorFocus(elements.tableBody, focusState);

    if (elements.eventCount) {
      const observed = visibleEvents.filter(event => event.status === "pending").length;
      const confirmed = visibleEvents.filter(event => event.status === "confirmed").length;
      elements.eventCount.textContent = `감지 ${observed}구간 · 계근 확정 ${confirmed}건`;
    }
    if (elements.emptyState) {
      elements.emptyState.hidden = state.loading || visibleEvents.length > 0;
      if (visibleEvents.length === 0 && state.filter !== "all") {
        elements.emptyState.textContent = "선택한 확인 상태에 해당하는 내역이 없습니다.";
      } else {
        elements.emptyState.textContent =
          "표시할 반출 감지 내역이 없습니다. 계근 기록은 별도로 확인하세요.";
      }
    }
  }

  function renderMinorObservations() {
    const elements = getElements();
    if (!elements.minorObservations || !elements.minorObservationList) return;
    const observations = state.minorObservations;
    elements.minorObservations.hidden = observations.length === 0 && state.minorObservationsOmitted === 0;
    if (elements.minorObservationSummary) {
      elements.minorObservationSummary.textContent = `기타 중량 감소 ${observations.length}구간 · 3t 미만·완만한 감소` +
        (state.minorObservationsOmitted ? ` · 추가 ${state.minorObservationsOmitted}구간 생략` : "");
    }
    const fragment = document.createDocumentFragment();
    for (const observation of observations) {
      const row = createElement("div", "bed-ash-discharge-minor-row");
      const range = createElement("strong", "", `${observation.unitNo}호기 · 관측 구간 ${formatDetectionRange(observation.startAt, observation.endAt)}`);
      range.title = `전후 관측 시각 ${formatHourlyRange(observation.startAt, observation.endAt, true)}`;
      row.append(range, createElement("small", "", `${formatTon(observation.startLevelTon)} → ${formatTon(observation.endLevelTon)} · 관측 감소 ${formatTon(observation.estimatedTon)} · ${observation.observationReason === "slow_decline" ? "완만한 감소" : "3.0t 미만"} · 읽기 전용`));
      appendSourceGapNotice(row, observation);
      fragment.appendChild(row);
    }
    elements.minorObservationList.replaceChildren(fragment);
  }

  function preserveReviewedEventInRangeData(data, savedEvent) {
    if (
      !data ||
      typeof data !== "object" ||
      !Array.isArray(data.events) ||
      !savedEvent ||
      !["confirmed", "excluded"].includes(savedEvent.status)
    ) {
      return data;
    }

    let matched = false;
    const events = data.events.map(rawEvent => {
      if (text(rawEvent?.eventKey) !== savedEvent.eventKey) {
        return rawEvent;
      }
      matched = true;
      const refreshedEvent = normalizeEvent(rawEvent);
      return refreshedEvent.status === "pending"
        ? {
            ...(rawEvent && typeof rawEvent === "object" ? rawEvent : {}),
            ...savedEvent
          }
        : rawEvent;
    });

    return matched ? { ...data, events } : data;
  }

  function renderData(data, requestedDates) {
    const events = Array.isArray(data?.events) ? data.events.map(normalizeEvent) : [];
    state.events = events.sort((first, second) => {
      return text(second.endAt).localeCompare(text(first.endAt));
    });
    state.summary = summarizeVisibleEvents(state.events);
    state.minorObservations = normalizeMinorObservations(data?.minorObservations);
    state.minorObservationsOmitted = Math.max(0, Math.trunc(number(data?.minorObservationsOmitted)));
    state.latestLevels = {
      1: normalizeLatestLevel(data?.latestLevels?.["1"]),
      2: normalizeLatestLevel(data?.latestLevels?.["2"])
    };
    state.unitCoverage = {
      1: normalizeUnitCoverage(data?.unitCoverage?.["1"]),
      2: normalizeUnitCoverage(data?.unitCoverage?.["2"])
    };
    state.coverage = normalizeCoverage(data?.coverage, requestedDates);

    renderSummaryCards();
    renderLatestLevels();
    renderEvents();
    renderMinorObservations();
  }

  function clearDetailData(message = "저장된 Bed Ash Silo 자료를 불러옵니다.") {
    state.events = [];
    state.minorObservations = [];
    state.minorObservationsOmitted = 0;
    state.expandedReviewEventKey = "";
    state.reviewDrafts.clear();
    state.composingReviewEventKey = "";
    state.renderEventsQueued = false;
    state.summary = emptySummary();
    state.latestLevels = { 1: null, 2: null };
    state.unitCoverage = { 1: null, 2: null };
    state.coverage = null;
    state.loadedRangeKey = "";
    state.loadedAt = 0;
    renderSummaryCards();
    renderLatestLevels();
    renderEvents();
    renderMinorObservations();
    setStatus(message, "idle");
  }

  function renderPeriodControls() {
    const elements = getElements();
    const range = calculatePeriod(state.period, state.anchorDate || getKstToday());
    state.anchorDate = range.anchorDate;
    const anchor = parseDate(state.anchorDate);
    const today = parseDate(range.today);
    const selectedWeek = getFixedWeekNumber(anchor);
    const selectedMonth = anchor.getUTCMonth() + 1;
    const displayedMonthStart = formatInputDate(
      new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1, 12))
    );
    const todayMonthStart = formatInputDate(
      new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1, 12))
    );

    elements.periodButtons.forEach(button => {
      const isSelected = button.dataset.bedAshPeriod === state.period;
      button.classList.toggle("is-active", isSelected);
      button.setAttribute("aria-pressed", String(isSelected));
    });

    if (elements.weekSelector) {
      elements.weekSelector.hidden = state.period !== "weekly";
      elements.weekSelector.setAttribute(
        "aria-label",
        `${anchor.getUTCFullYear()}년 ${anchor.getUTCMonth() + 1}월 주 선택`
      );
    }
    elements.weekButtons.forEach(button => {
      const weekNumber = Math.trunc(number(button.dataset.bedAshWeek, 0));
      const fixedWeek = getFixedWeekRange(
        anchor.getUTCFullYear(),
        anchor.getUTCMonth(),
        weekNumber
      );
      const isSelected = state.period === "weekly" && weekNumber === selectedWeek;
      const isFuture = fixedWeek.available && fixedWeek.startDate > range.today;

      button.hidden = weekNumber === 5 && !fixedWeek.available;
      button.disabled =
        state.reviewSubmissionControlsLocked ||
        state.loading ||
        !fixedWeek.available ||
        isFuture;
      button.classList.toggle("is-active", isSelected);
      button.setAttribute("aria-pressed", String(isSelected));
    });

    if (elements.monthSelector) {
      elements.monthSelector.hidden = state.period !== "monthly";
      elements.monthSelector.setAttribute(
        "aria-label",
        `${anchor.getUTCFullYear()}년 월 선택`
      );
    }
    elements.monthButtons.forEach(button => {
      const monthNumber = Math.trunc(number(button.dataset.bedAshMonth, 0));
      const monthStart = formatInputDate(
        new Date(Date.UTC(anchor.getUTCFullYear(), monthNumber - 1, 1, 12))
      );
      const isSelected = state.period === "monthly" && monthNumber === selectedMonth;

      button.disabled =
        state.reviewSubmissionControlsLocked ||
        state.loading ||
        monthNumber < 1 ||
        monthNumber > 12 ||
        monthStart > range.today;
      button.classList.toggle("is-active", isSelected);
      button.setAttribute("aria-pressed", String(isSelected));
    });

    if (elements.anchorDate) {
      elements.anchorDate.value = state.anchorDate;
      elements.anchorDate.max = range.today;
      elements.anchorDate.disabled =
        state.reviewSubmissionControlsLocked ||
        state.loading ||
        state.period !== "daily";
    }
    if (elements.anchorDateLabel) {
      elements.anchorDateLabel.hidden = state.period !== "daily";
    }
    if (elements.rangeLabel) {
      elements.rangeLabel.textContent = formatPeriodLabel(range);
    }
    if (elements.nextButton) {
      const hasNextPeriod = state.period === "daily"
        ? state.anchorDate < range.today
        : state.period === "weekly"
          ? displayedMonthStart < todayMonthStart
          : anchor.getUTCFullYear() < today.getUTCFullYear();
      elements.nextButton.disabled =
        state.reviewSubmissionControlsLocked ||
        !hasNextPeriod ||
        state.loading;
    }
    if (elements.previousButton) {
      elements.previousButton.disabled =
        state.reviewSubmissionControlsLocked || state.loading;
    }
    if (elements.readOnlyNotice) {
      elements.readOnlyNotice.hidden = !isMobileClient();
    }
    if (elements.view) {
      elements.view.dataset.bedAshMobileClient = String(isMobileClient());
      elements.view.dataset.bedAshPeriod = state.period;
    }
    if (elements.mainAlert) {
      elements.mainAlert.dataset.bedAshMobileClient = String(isMobileClient());
    }
    if (elements.refreshButton) {
      elements.refreshButton.hidden = isMobileClient();
      elements.refreshButton.disabled =
        state.reviewSubmissionControlsLocked ||
        isMobileClient() ||
        state.loading;
    }

    return range;
  }

  function rangeKey(range) {
    return `${state.period}:${range.queryStartDate}:${range.queryEndDate}`;
  }

  async function fetchRangeData(range, timeoutMs = REQUEST_TIMEOUT_MS) {
    if (!range.queryStartDate || !range.queryEndDate) {
      return {
        range: null,
        events: [],
        summary: emptySummary(),
        latestLevels: { 1: null, 2: null },
        coverage: {
          dates: [],
          completeDates: [],
          missingDates: [],
          pendingDates: [],
          failedDates: [],
          requests: []
        }
      };
    }

    const query = new URLSearchParams({
      startDate: range.queryStartDate,
      endDate: range.queryEndDate
    });
    return requestJson(`${API_URL}?${query.toString()}`, {
      headers: getRequestHeaders(),
      timeoutMs
    });
  }

  async function createOisRequest(targetDate, forceRefresh) {
    return requestJson(OIS_REQUEST_API_URL, {
      method: "POST",
      headers: getRequestHeaders(true),
      body: JSON.stringify({
        requestType: "bed_ash_level",
        targetDate,
        forceRefresh: Boolean(forceRefresh)
      })
    });
  }

  function buildOisRequestPlans(coverage, requestedDates, forceRefresh) {
    const normalizedCoverage = coverage || {
      missingDates: [],
      failedDates: [],
      baseline: null,
      lookahead: null,
      requests: []
    };
    const baseline = normalizedCoverage.baseline;
    const lookahead = normalizedCoverage.lookahead;
    let plans = [];

    if (forceRefresh) {
      // The minute packet includes its own midnight boundaries. Prior/next
      // hourly support jobs continue on the company computer independently.
      return requestedDates.map(date => ({
        date,
        forceRefresh: true,
        baseline: false,
        lookahead: false
      }));
    }

    const missing = new Set(normalizedCoverage.missingDates || []);
    const failed = new Set(normalizedCoverage.failedDates || []);
    const receivedMinuteDates = new Set(normalizedCoverage.minuteDates || []);
    plans = [...missing, ...failed]
      .filter((date, index, values) => values.indexOf(date) === index && !receivedMinuteDates.has(date))
      .map(date => ({
        date,
        forceRefresh: missing.has(date) || failed.has(date),
        baseline: false,
        lookahead: false
      }));

    const needsSupport = !hasMinuteRange(normalizedCoverage, requestedDates);
    if (needsSupport && baseline?.date && (baseline.missing || baseline.failed)) {
      plans.unshift({
        date: baseline.date,
        forceRefresh: baseline.failed || baseline.status === "complete",
        baseline: true,
        lookahead: false
      });
    }

    if (
      needsSupport && lookahead?.date &&
      lookahead.available &&
      (lookahead.missing || lookahead.failed)
    ) {
      plans.push({
        date: lookahead.date,
        forceRefresh: lookahead.failed || lookahead.status === "complete",
        baseline: false,
        lookahead: true
      });
    }

    return plans;
  }

  async function mapWithConcurrency(items, concurrency, worker) {
    const queue = [...items];
    const results = [];
    const workerCount = Math.min(Math.max(1, concurrency), queue.length);

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          try {
            results.push({ item, value: await worker(item), error: null });
          } catch (error) {
            results.push({ item, value: null, error });
          }
        }
      })
    );

    return results;
  }

  function coverageStatusMessage(coverage, eventCount) {
    if (!coverage) {
      return "조회된 Bed Ash 자료가 없습니다.";
    }

    const total = coverage.dates.length;
    const complete = coverage.completeDates.length;
    const pending = coverage.pendingDates.length;
    const failed = coverage.failedDates.length;
    const minuteDates = new Set(coverage.minuteDates || []);
    const partialMinuteCount = coverage.missingDates.filter(date => minuteDates.has(date)).length;
    const missing = coverage.missingDates.filter(date => !minuteDates.has(date)).length;
    const needsSupport = !hasMinuteRange(coverage);
    const baseline = needsSupport ? coverage.baseline : null;
    const lookahead = needsSupport ? coverage.lookahead : null;
    const minuteCount = coverage.minuteDates?.length || 0;
    const hourlyCount = coverage.hourlyDates?.length || 0;
    const precision = minuteCount || hourlyCount
      ? ` · DataPARC 1분 자료 ${minuteCount}일${hourlyCount ? ` / 시간 자료 ${hourlyCount}일` : ""}`
      : "";
    const quality = [1, 2].flatMap(unitNo => {
      const unit = state.unitCoverage[unitNo];
      return unit?.hasMinuteSource && unit.hasGaps
        ? [`${unitNo}호기 ${unit.validMinuteSampleCount ? "자료 누락 있음" : "1분 자료 미수신"}`] : [];
    });
    const incomplete = state.summary.incompleteCount
      ? [`자료 확인 ${state.summary.incompleteCount}구간`] : [];
    const fallback = (coverage.precisionFailures?.length
      ? " · 정밀 조회 미수신 · 기존 자료 표시"
      : "") + (partialMinuteCount ? ` · 1분 자료 일부 미수신 ${partialMinuteCount}일` : "") +
      [...quality, ...incomplete].map(message => ` · ${message}`).join("");

    if (pending > 0 || baseline?.pending || lookahead?.pending) {
      const baselineMessage = baseline?.pending ? " · 첫날 자정 기준 처리 중" : "";
      const lookaheadMessage = lookahead?.pending
        ? " · 마지막 날 후속 자료 처리 중"
        : "";
      return `DataPARC 조회 중 · ${complete}/${total}일 완료 · ${pending}일 처리 중${baselineMessage}${lookaheadMessage}${precision}${fallback}`;
    }
    if (lookahead && !lookahead.available && (hourlyCount > 0 || minuteCount === 0)) {
      const selectedDataMessage = missing > 0 || failed > 0
        ? ` · 자료 없음 ${missing}일 · 수집 실패 ${failed}일`
        : "";
      const baselineMessage = baseline && !baseline.complete
        ? baseline.failed
          ? " · 첫날 자정 기준 수집 실패"
          : " · 첫날 자정 기준 자료 없음"
        : "";
      return `조회 완료 · ${eventCount}건 감지 · 시간자료의 마지막 날 반출량은 다음 날 08시 자료 수집 후 확인 가능${selectedDataMessage}${baselineMessage}${precision}${fallback}`;
    }
    if (
      failed > 0 ||
      missing > 0 ||
      (baseline && !baseline.complete) ||
      (lookahead?.available && !lookahead.complete)
    ) {
      const baselineMessage = baseline && !baseline.complete
        ? baseline.failed
          ? " · 첫날 자정 기준 수집 실패"
          : " · 첫날 자정 기준 자료 없음"
        : "";
      const lookaheadMessage = lookahead?.available && !lookahead.complete
        ? lookahead.failed
          ? " · 마지막 날 후속 자료 수집 실패"
          : " · 마지막 날 후속 자료 보완 필요"
        : "";
      return `조회 완료 · ${eventCount}건 감지 · 자료 없음 ${missing}일 · 수집 실패 ${failed}일${baselineMessage}${lookaheadMessage}${precision}${fallback}`;
    }
    const received = coverage.dates.filter(date => minuteDates.has(date) || coverage.completeDates.includes(date)).length;
    return `조회 완료 · ${received}/${total}일 자료 수신 · 내역 ${eventCount}건${precision}${fallback}`;
  }

  function compactCoverageStatusMessage(coverage) {
    // Only collapse routine completion copy. Failures, active work, empty days
    // and hourly boundary warnings must remain visible without opening details.
    if (!coverage || coverage.pendingDates.length || coverage.failedDates.length ||
        coverage.precisionFailures.length ||
        coverage.missingDates.some(date => !coverage.minuteDates.includes(date)) ||
        (!hasMinuteRange(coverage) && ((coverage.baseline && !coverage.baseline.complete) ||
          (coverage.lookahead && !coverage.lookahead.complete)))) return "";
    const missingUnits = [1, 2].filter(unitNo => {
      const unit = state.unitCoverage[unitNo];
      return unit?.hasMinuteSource && !unit.validMinuteSampleCount;
    });
    const gaps = Object.values(state.unitCoverage).some(unit => unit?.hasGaps) ||
      state.summary.observedGapCount > 0;
    return `조회 완료 · 반출 감지 ${state.summary.observedCount}구간` +
      (missingUnits.length ? ` · ${missingUnits.map(unitNo => `${unitNo}호기 미수신`).join(" · ")}` : gaps ? " · 자료 공백 있음" : "") +
      (state.summary.incompleteCount && !gaps && !missingUnits.length ? " · 종료 자료 확인 필요" : "");
  }

  function delay(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
  }

  // BED ASH FAST QUERY V1: only exact OIS job IDs are polled. Saved
  // coverage can remain complete while a newer request is still processing.
  function isCurrentRangeLoad(sequence, token, selectedRangeKey) {
    return sequence === state.loadSequence && Boolean(token) &&
      token === getSessionToken() &&
      selectedRangeKey === rangeKey(calculatePeriod(
        state.period, state.anchorDate || getKstToday()
      ));
  }

  function addTrackedRequest(tracked, requestId, date) {
    const id = text(requestId);
    const targetDate = text(date);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      throw new Error("OIS 요청번호를 확인할 수 없습니다. 잠시 후 다시 조회해 주세요.");
    }
    const existing = tracked.get(id);
    if (existing && existing.targetDate !== targetDate) {
      throw new Error("OIS 요청번호와 조회 날짜가 일치하지 않습니다.");
    }
    if (!existing) {
      tracked.set(id, { id, targetDate, status: "unknown", refreshed: false });
    }
  }

  function trackCoverageRequests(tracked, coverage, options = {}) {
    const requestedDates = options.requestedDates || coverage?.dates || [];
    const selectedDates = new Set(requestedDates);
    const selectedOnly = options.selectedOnly === true || hasMinuteRange(coverage, requestedDates);
    if (selectedOnly && selectedDates.size) {
      for (const [id, request] of tracked) {
        if (!selectedDates.has(request.targetDate)) tracked.delete(id);
      }
    }
    const requests = Array.isArray(coverage?.requests) ? coverage.requests : [];
    const pendingDates = new Set(coverage?.pendingDates || []);
    for (const row of requests) {
      if (["pending", "processing"].includes(text(row?.status))) {
        addTrackedRequest(tracked, row.requestId, row.date);
        pendingDates.delete(text(row.date));
      }
    }
    if (pendingDates.size) {
      throw new Error("처리 중인 OIS 요청번호가 누락되었습니다. 잠시 후 다시 조회해 주세요.");
    }
    for (const support of selectedOnly ? [] : [coverage?.baseline, coverage?.lookahead]) {
      if (support?.available !== false && support?.pending) {
        addTrackedRequest(tracked, support.requestId, support.date);
      }
    }
    return tracked;
  }

  function isTerminalRequest(request) {
    return ["complete", "failed", "expired"].includes(request.status);
  }

  function collectionStatusMessage(tracked, requestedDates = []) {
    const requests = [...tracked.values()];
    const complete = requests.filter(row => row.status === "complete").length;
    const failed = requests.filter(row => ["failed", "expired"].includes(row.status)).length;
    const selectedDates = new Set(requestedDates);
    const selected = requests.filter(row => selectedDates.has(row.targetDate));
    const support = requests.filter(row => !selectedDates.has(row.targetDate));
    const progress = rows => `${rows.filter(row => row.status === "complete").length}/${rows.length}건`;
    return `저장된 자료 표시 중 · OIS 수집 ${complete}/${requests.length}건 완료` +
      (failed ? ` · 실패 ${failed}건` : "") +
      (selected.length ? ` · 선택일 ${progress(selected)}` : "") +
      (support.length ? ` · 시간자료 보완 ${progress(support)}` : "");
  }

  async function fetchCompactStatuses(requests, isCurrent, timeoutMs) {
    const batches = [];
    for (let offset = 0; offset < requests.length; offset += STATUS_BATCH_SIZE) {
      batches.push(requests.slice(offset, offset + STATUS_BATCH_SIZE));
    }
    return mapWithConcurrency(batches, OIS_REQUEST_CONCURRENCY, async batch => {
      if (!isCurrent()) return null;
      const query = new URLSearchParams({
        action: "status_batch", compact: "1", ids: batch.map(row => row.id).join(",")
      });
      const data = await requestJson(`${OIS_REQUEST_API_URL}?${query}`, {
        headers: getRequestHeaders(), timeoutMs
      });
      if (!isCurrent()) return null;
      const items = Array.isArray(data?.items) ? data.items : [];
      const received = new Map();
      for (const item of items) {
        if (received.has(text(item?.id))) {
          throw new Error("OIS 요청 상태 응답에 중복된 요청번호가 있습니다.");
        }
        received.set(text(item?.id), item);
      }
      return batch.map(request => {
        const row = received.get(request.id);
        if (!row || (Array.isArray(data?.missingIds) && data.missingIds.includes(request.id))) {
          throw new Error("OIS 요청 상태가 누락되었습니다. 잠시 후 다시 조회해 주세요.");
        }
        if (row.requestType !== "bed_ash_level" || row.targetDate !== request.targetDate ||
            !["pending", "processing", "complete", "failed", "expired"].includes(row.status)) {
          throw new Error("OIS 요청 상태의 종류 또는 날짜를 확인할 수 없습니다.");
        }
        return { request, status: row.status, errorMessage: text(row.errorMessage) };
      });
    });
  }

  async function pollRange(
    range,
    sequence,
    requestedDates,
    tracked = new Map(),
    preservedReviewedEvent = null,
    token = getSessionToken(),
    options = {}
  ) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    const selectedRangeKey = rangeKey(range);
    const isCurrent = () => isCurrentRangeLoad(sequence, token, selectedRangeKey);
    let consecutiveFailures = 0;
    const trackingOptions = { ...options, requestedDates };
    trackCoverageRequests(tracked, state.coverage, trackingOptions);

    while (isCurrent() && Date.now() < deadline) {
      const pending = [...tracked.values()].filter(row => !isTerminalRequest(row));
      let statusFailure = null;
      if (pending.length) {
        const results = await fetchCompactStatuses(
          pending, isCurrent,
          Math.max(1000, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()))
        );
        if (!isCurrent()) return "cancelled";
        const authFailure = results.find(result => [401, 403].includes(result.error?.status));
        if (authFailure) throw authFailure.error;
        for (const result of results) {
          if (result.error) {
            statusFailure = result.error;
          } else {
            for (const update of result.value || []) {
              update.request.status = update.status;
              update.request.errorMessage = update.errorMessage;
            }
          }
        }
      }

      // A terminal transition causes one coalesced range refresh. Unchanged
      // pending jobs never re-run the expensive detector / history sync.
      const newlyTerminal = [...tracked.values()].filter(row => isTerminalRequest(row) && !row.refreshed);
      if (newlyTerminal.length) {
        try {
          const data = await fetchRangeData(
            range, Math.max(1000, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()))
          );
          if (!isCurrent()) return "cancelled";
          renderData(preserveReviewedEventInRangeData(data, preservedReviewedEvent), requestedDates);
          for (const row of newlyTerminal) row.refreshed = true;
          trackCoverageRequests(tracked, state.coverage, trackingOptions);
        } catch (error) {
          if (!isCurrent()) return "cancelled";
          if ([401, 403].includes(error.status)) throw error;
          statusFailure = error;
        }
      }
      if (!isCurrent()) return "cancelled";
      if (statusFailure) {
        consecutiveFailures += 1;
        setStatus(
          `저장된 자료 표시 중 · OIS 상태 확인 재시도 ${consecutiveFailures}회 · ${text(statusFailure.message)}`,
          "warning"
        );
      } else {
        consecutiveFailures = 0;
        if ([...tracked.values()].every(row => isTerminalRequest(row) && row.refreshed)) {
          if ([...tracked.values()].some(row => row.status !== "complete")) return "failed";
          // Status completion does not by itself establish range readiness.
          // A lagging/contradictory authoritative range must stay a warning.
          const needsSupport = options.selectedOnly !== true && !hasMinuteRange(state.coverage, requestedDates);
          if (state.coverage?.pendingDates?.length || (needsSupport &&
              (state.coverage?.baseline?.pending ||
                (state.coverage?.lookahead?.available && state.coverage.lookahead.pending)))) return "unsettled";
          return "complete";
        }
        setStatus(collectionStatusMessage(tracked, requestedDates), "loading");
      }
      await delay(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
    }
    return isCurrent() ? "timeout" : "cancelled";
  }

  function scheduleReviewRangePolling(options) {
    const {
      range,
      sequence,
      requestedDates,
      waitForBaseline,
      waitForLookahead,
      savedEvent,
      selectedRangeKey
    } = options;

    const token = getSessionToken();
    window.setTimeout(() => {
      if (
        !isCurrentRangeLoad(sequence, token, selectedRangeKey) ||
        state.submittingEventKeys.size > 0
      ) {
        return;
      }

      pollRange(
        range,
        sequence,
        requestedDates,
        new Map(),
        savedEvent,
        token
      ).then(result => {
        if (!isCurrentRangeLoad(sequence, token, selectedRangeKey) || result === "cancelled") {
          return;
        }
        state.loadedRangeKey = selectedRangeKey;
        state.loadedAt = Date.now();
        if (result === "unsettled") {
          state.loadedAt = 0;
          setStatus("확인은 저장됐지만 OIS 기간 자료 반영을 확인하지 못했습니다. 잠시 후 다시 조회해 주세요.", "warning");
          return;
        }
        if (result === "timeout") {
          state.loadedAt = 0;
          setStatus(
            "확인은 저장됐지만 OIS 자료 수집이 10분 이상 지연되고 있습니다.",
            "warning"
          );
          return;
        }
        const coverage = state.coverage;
        const warning = result === "failed" || hasCoverageWarning(coverage);
        setStatus(
          result === "failed"
            ? `OIS 수집 일부 실패 · ${coverageStatusMessage(coverage, state.events.length)}`
            : coverageStatusMessage(coverage, state.events.length),
          warning ? "warning" : "success"
        );
      }).catch(error => {
        if (!isCurrentRangeLoad(sequence, token, selectedRangeKey)) {
          return;
        }
        setStatus(
          error.status === 401
            ? "로그인 정보가 만료되었습니다. 다시 로그인해 주세요."
            : `OIS 처리 상태 자동 조회 실패 · ${text(error.message)}`,
          "warning"
        );
        if (error.status === 401) {
          clearSummaryAlert();
        }
      });
    }, 0);
  }

  function scheduleAuthoritativeRangeReload() {
    window.setTimeout(() => {
      if (
        state.submittingEventKeys.size > 0 ||
        state.loading ||
        !getSessionToken()
      ) {
        return;
      }
      loadSelectedRange().catch(error => {
        setStatus(
          `Bed Ash 반출 자료 재조회 실패 · ${text(error.message)}`,
          "warning"
        );
      });
    }, 0);
  }

  async function loadSelectedRange(options = {}) {
    const forceRefresh = options.forceRefresh === true;
    const range = renderPeriodControls();
    const selectedRangeKey = rangeKey(range);
    const requestedDates = enumerateDates(range.queryStartDate, range.queryEndDate);
    const token = getSessionToken();
    if (state.activeRangeLoad?.sequence === state.loadSequence &&
        state.activeRangeLoad.key === selectedRangeKey && state.activeRangeLoad.token === token &&
        (!forceRefresh || state.activeRangeLoad.forceRefresh === true)) {
      return;
    }
    const sequence = ++state.loadSequence;
    const isCurrent = () => isCurrentRangeLoad(sequence, token, selectedRangeKey);
    if (!token) {
      clearQueryTiming();
      setLoading(false);
      clearDetailData("로그인 후 Bed Ash 반출 내역을 확인할 수 있습니다.");
      clearSummaryAlert();
      return;
    }
    if (requestedDates.length === 0) {
      clearQueryTiming();
      setLoading(false);
      clearDetailData("미래 날짜는 OIS 자료를 조회하지 않습니다.");
      return;
    }

    // A saved-data load may only be waiting for an adjacent day's hourly
    // support. Promote it when the user explicitly requests minute data for
    // the selected range; the new sequence discards old browser callbacks.
    // Existing company jobs are adopted below, and repeated forced clicks
    // keep this same load instead of creating another request.
    state.activeRangeLoad = { key: selectedRangeKey, token, sequence, forceRefresh };
    startQueryTiming(sequence);
    let queryOutcome = "complete";
    let detailLoaded = false;
    setLoading(true);
    renderEvents();
    setStatus("저장된 Bed Ash Silo 자료를 불러오고 있습니다.", "loading");
    try {
      const data = await fetchRangeData(range);
      if (!isCurrent()) return;
      renderData(data, requestedDates);
      detailLoaded = true;
      state.loadedRangeKey = selectedRangeKey;
      state.loadedAt = Date.now();
      // Reading saved data is finished. OIS collection continues in the status
      // line while the displayed history and date controls remain usable.
      setLoading(false);
      renderEvents();
      const tracked = trackCoverageRequests(new Map(), state.coverage, { requestedDates, selectedOnly: forceRefresh });
      const activeDates = new Set([...tracked.values()].map(row => row.targetDate));
      const requestPlans = isMobileClient() ? [] : buildOisRequestPlans(
        state.coverage, requestedDates, forceRefresh
      ).filter(plan => !activeDates.has(plan.date));
      const requestFailures = [];
      if (tracked.size || requestPlans.length) setQueryPhase(sequence, "DataPARC 수집");
      if (requestPlans.length > 0) {
        setStatus(`저장된 자료 표시 중 · OIS 조회 ${requestPlans.length}건 요청 중`, "loading");
        let authenticationFailed = false;
        const results = await mapWithConcurrency(requestPlans, OIS_REQUEST_CONCURRENCY, async plan => {
          if (!isCurrent() || isMobileClient() || authenticationFailed) return null;
          let response;
          try {
            response = await createOisRequest(plan.date, plan.forceRefresh);
          } catch (error) {
            if ([401, 403].includes(error.status)) authenticationFailed = true;
            throw error;
          }
          if (!isCurrent()) return null;
          const item = response?.item;
          if (item?.requestType !== "bed_ash_level" || item?.targetDate !== plan.date) {
            throw new Error("새 OIS 요청의 종류 또는 날짜를 확인할 수 없습니다.");
          }
          addTrackedRequest(tracked, item.id, plan.date);
          return response;
        });
        if (!isCurrent()) return;
        const authFailure = results.find(result => [401, 403].includes(result.error?.status));
        if (authFailure) throw authFailure.error;
        requestFailures.push(...results.filter(result => result.error));
      }
      const pollResult = tracked.size ? await pollRange(
        range, sequence, requestedDates, tracked, null, token, { selectedOnly: forceRefresh }
      ) : "complete";
      if (!isCurrent() || pollResult === "cancelled") return;
      state.loadedRangeKey = selectedRangeKey;
      state.loadedAt = Date.now();
      if (pollResult === "unsettled") {
        queryOutcome = "unsettled";
        state.loadedAt = 0;
        setStatus("OIS 처리는 끝났지만 기간 자료 반영을 확인하지 못했습니다. 잠시 후 다시 조회해 주세요.", "warning");
      } else if (pollResult === "timeout") {
        queryOutcome = "timeout";
        state.loadedAt = 0;
        setStatus("저장된 자료 표시 중 · OIS 수집 또는 상태 확인이 10분 이상 지연되고 있습니다. 잠시 후 다시 조회해 주세요.", "warning");
      } else {
        if (requestFailures.length || pollResult === "failed") queryOutcome = "failed";
        const coverage = state.coverage;
        const warning = requestFailures.length || pollResult === "failed" || hasCoverageWarning(coverage);
        const prefix = requestFailures.length
          ? `OIS 조회 요청 ${requestFailures.length}건 실패 · `
          : pollResult === "failed" ? "OIS 수집 일부 실패 · " : "";
        setStatus(prefix + coverageStatusMessage(coverage, state.events.length), warning ? "warning" : "success",
          prefix ? "" : compactCoverageStatusMessage(coverage));
      }
      // Summary has its own authenticated background refresh cycle. It must
      // not delay detail completion or add another expensive GET on each poll.
    } catch (error) {
      if (!isCurrent()) return;
      queryOutcome = error.name === "TimeoutError" ? "timeout" : "failed";
      const authFailure = [401, 403].includes(error.status);
      const message = authFailure
        ? "로그인 정보가 만료되었습니다. 다시 로그인해 주세요."
        : `Bed Ash 반출 자료 조회 실패 · ${text(error.message)}`;
      if (!detailLoaded || authFailure) clearDetailData(message);
      if (authFailure) clearSummaryAlert();
      setStatus(message, "error");
    } finally {
      if (state.activeRangeLoad?.sequence === sequence) state.activeRangeLoad = null;
      if (sequence === state.loadSequence) {
        finishQueryTiming(sequence, queryOutcome);
        setLoading(false);
        renderPeriodControls();
        renderEvents();
      }
    }
  }

  function clearSummaryAlert() {
    state.latestPendingSummary = null;
    const elements = getElements();
    if (elements.badge) {
      elements.badge.hidden = true;
      elements.badge.textContent = "0";
      elements.badge.setAttribute("aria-label", "확인 대기 0건");
    }
    if (elements.mainAlert) {
      elements.mainAlert.hidden = true;
      elements.mainAlert.removeAttribute("title");
      elements.mainAlert.setAttribute(
        "aria-label",
        "확인이 필요한 Bed Ash 반출 내역 보기"
      );
    }
    if (elements.mainAlertDetail) {
      elements.mainAlertDetail.textContent = "";
    }
    if (elements.mainAlertCount) {
      elements.mainAlertCount.textContent = "0건";
    }
  }

  function renderSummaryAlert(summaryData) {
    const elements = getElements();
    const pendingCount = Math.max(0, Math.trunc(number(summaryData?.pendingCount)));
    const latestPending = summaryData?.latestPending
      ? normalizeEvent(summaryData.latestPending)
      : null;

    if (pendingCount === 0) {
      clearSummaryAlert();
      return;
    }

    state.latestPendingSummary = latestPending;

    if (elements.badge) {
      elements.badge.hidden = false;
      elements.badge.textContent = pendingCount > 99 ? "99+" : String(pendingCount);
      elements.badge.setAttribute("aria-label", `확인 대기 ${pendingCount}건`);
    }

    if (isMobileClient()) {
      if (elements.mainAlert) {
        elements.mainAlert.hidden = true;
      }
      return;
    }

    const detail = latestPending
      ? `${latestPending.unitNo}호기 · ${formatHourlyRange(
          latestPending.startAt,
          latestPending.endAt
        )} · 추정 반출량 ${formatTon(latestPending.estimatedTon)}`
      : "효율팀 확인이 필요한 자동 감지 내역이 있습니다.";

    if (elements.mainAlertDetail) {
      elements.mainAlertDetail.textContent = detail;
    }
    if (elements.mainAlertCount) {
      elements.mainAlertCount.textContent = `${pendingCount}건`;
    }
    if (elements.mainAlert) {
      elements.mainAlert.hidden = false;
      elements.mainAlert.title = `Bed Ash 반출 확인 대기 ${pendingCount}건\n${detail}`;
      elements.mainAlert.setAttribute(
        "aria-label",
        `Bed Ash 반출 확인 대기 ${pendingCount}건. ${detail}`
      );
    }
  }

  async function refreshSummary(options = {}) {
    if (state.summaryLoading) {
      if (options.force === true) {
        state.summaryRefreshQueued = true;
      }
      return;
    }

    const token = getSessionToken();
    if (!token) {
      state.summaryLoadedAt = 0;
      state.summaryNextAttemptAt = 0;
      clearSummaryAlert();
      return;
    }

    const sequence = ++state.summarySequence;
    state.summaryLoading = true;
    state.summaryNextAttemptAt = Date.now() + 30 * 1000;
    try {
      const data = await requestJson(`${API_URL}?mode=summary`, {
        headers: getRequestHeaders(),
        timeoutMs: SUMMARY_REQUEST_TIMEOUT_MS
      });
      if (sequence !== state.summarySequence) {
        return;
      }

      renderSummaryAlert(data);
      state.summaryLoadedAt = Date.now();
      state.summaryNextAttemptAt = state.summaryLoadedAt + SUMMARY_REFRESH_MS;
    } catch (error) {
      if (sequence === state.summarySequence) {
        state.summaryLoadedAt = 0;
        state.summaryNextAttemptAt = Date.now() + 30 * 1000;
        clearSummaryAlert();
        if (!options.silent) {
          console.warn("Bed Ash 반출 확인 대기 조회 실패:", error);
        }
      }
    } finally {
      if (sequence === state.summarySequence) {
        state.summaryLoading = false;
        if (state.summaryRefreshQueued) {
          state.summaryRefreshQueued = false;
          window.setTimeout(
            () => refreshSummary({ silent: true, force: true }),
            0
          );
        }
      }
    }
  }

  function openBedAshDischargeView() {
    const range = renderPeriodControls();
    const currentRangeKey = rangeKey(range);
    const isStale = Date.now() - state.loadedAt >= RANGE_STALE_MS;
    if (state.loading ||
        (state.activeRangeLoad?.sequence === state.loadSequence &&
          state.activeRangeLoad.key === currentRangeKey &&
          state.activeRangeLoad.token === getSessionToken()) ||
        (state.loadedRangeKey === currentRangeKey && !isStale)) {
      return;
    }

    loadSelectedRange();
  }

  function openFromMainAlert() {
    const latestPendingDate = timestampToInputDate(
      state.latestPendingSummary?.thresholdCrossedAt ||
      state.latestPendingSummary?.endAt
    );
    if (latestPendingDate && latestPendingDate <= getKstToday()) {
      state.period = "daily";
      state.anchorDate = latestPendingDate;
      state.filter = "pending";
      state.expandedReviewEventKey = "";
      state.reviewDrafts.clear();
      state.composingReviewEventKey = "";
      state.renderEventsQueued = false;
      const { statusFilter } = getElements();
      if (statusFilter) {
        statusFilter.value = "pending";
      }
      renderPeriodControls();
    }

    if (typeof window.openEfficiencyTeamModal === "function") {
      window.openEfficiencyTeamModal();
    }

    window.setTimeout(() => {
      if (typeof window.switchEfficiencyTeamView === "function") {
        window.switchEfficiencyTeamView(ROUTE_KEY);
      }
      // A previous weekly/monthly request may still be polling OIS. Loading
      // directly increments loadSequence so that stale work cannot overwrite
      // the pending event day selected by this alert.
      loadSelectedRange();
    }, 0);
  }

  function updateEventFromConflict(currentEvent, requestedEventKey = "") {
    if (requestedEventKey === state.expandedReviewEventKey) {
      state.expandedReviewEventKey = "";
    }
    if (requestedEventKey) {
      state.reviewDrafts.delete(requestedEventKey);
    }
    if (!currentEvent) {
      if (requestedEventKey) {
        state.events = state.events.filter(event => {
          return event.eventKey !== requestedEventKey;
        });
        renderEvents();
      }
      return;
    }

    const normalized = normalizeEvent(currentEvent);
    const eventIndex = state.events.findIndex(event => event.eventKey === normalized.eventKey);
    if (eventIndex >= 0) {
      state.events.splice(eventIndex, 1, normalized);
    } else {
      state.events.unshift(normalized);
    }
    renderEvents();
  }

  async function submitReview(event, actionCell, status) {
    if (isMobileClient() || !event || event.status !== "pending") {
      return;
    }
    if (!event.reviewReady || sourceGapMetadata(event).hasSourceGaps) {
      setStatus(sourceGapMetadata(event).hasSourceGaps
        ? "자료 공백이 포함된 관측 구간입니다. 원자료와 계근 기록을 확인해 주세요."
        : "관측 구간과 종료 자료를 확인한 후 계근 기록을 확인해 주세요.", "warning");
      return;
    }
    if (state.submittingEventKeys.size > 0) {
      if (!state.submittingEventKeys.has(event.eventKey)) {
        setStatus("다른 반출 확인을 저장하고 있습니다.", "warning");
      }
      return;
    }
    if (event.closeReason === "truck_boundary_unresolved") {
      setStatus(
        "복수 차량 가능성이 있어 시간 경계 확인 전에는 반출 확인을 저장할 수 없습니다.",
        "warning"
      );
      return;
    }

    storeReviewDraft(actionCell.closest(".bed-ash-discharge-review-row"));
    const wrapper = actionCell.querySelector(".bed-ash-discharge-review-controls");
    const actualAt = text(wrapper?.querySelector(".bed-ash-discharge-review-at")?.value);
    const actualTonValue = wrapper?.querySelector(".bed-ash-discharge-review-ton")?.value;
    const actualTon = Number(actualTonValue);
    const note = text(wrapper?.querySelector(".bed-ash-discharge-review-note")?.value);

    if (status === "confirmed" && !actualAt) {
      setStatus("실제 반출시각을 입력해 주세요.", "warning");
      wrapper?.querySelector(".bed-ash-discharge-review-at")?.focus();
      return;
    }
    if (status === "confirmed" && actualAt > getKstNowDateTimeLocal()) {
      setStatus("실제 반출시각은 현재 시각 이후로 입력할 수 없습니다.", "warning");
      wrapper?.querySelector(".bed-ash-discharge-review-at")?.focus();
      return;
    }
    if (
      status === "confirmed" &&
      (!Number.isFinite(actualTon) || actualTon <= 0 || actualTon > 10000)
    ) {
      setStatus("실제 반출량을 0.1~10,000t 범위로 입력해 주세요.", "warning");
      wrapper?.querySelector(".bed-ash-discharge-review-ton")?.focus();
      return;
    }

    const reviewRange = calculatePeriod(
      state.period,
      state.anchorDate || getKstToday()
    );
    const reviewRangeKey = `${reviewRange.period}:${reviewRange.queryStartDate}:${reviewRange.queryEndDate}`;
    const reviewRequestedDates = enumerateDates(
      reviewRange.queryStartDate,
      reviewRange.queryEndDate
    );
    const reviewLoadSequence = ++state.loadSequence;
    setLoading(false);
    const interactiveControls = [
      ...actionCell.querySelectorAll("input, button")
    ];
    let savedEvent = null;
    let authoritativeReviewRefreshComplete = false;
    let backgroundPollingOptions = null;
    state.submittingEventKeys.add(event.eventKey);

    try {
      setReviewSubmissionControlsLocked(true);
      interactiveControls.forEach(control => {
        control.disabled = true;
      });
      renderEvents();
      setStatus(
        status === "confirmed"
          ? "반출 확인 내용을 저장하고 있습니다."
          : "자동 감지 내역을 제외하고 있습니다.",
        "loading"
      );

      const data = await requestJson(API_URL, {
        method: "POST",
        headers: getRequestHeaders(true),
        body: JSON.stringify({
          action: "review",
          eventKey: event.eventKey,
          revision: event.revision,
          status,
          ...(status === "confirmed"
            ? {
                confirmedAt: actualAt,
                confirmedTon: actualTon
              }
            : {}),
          ...(note ? { note } : {})
        })
      });

      savedEvent = normalizeEvent(data?.event);
      state.reviewDrafts.delete(event.eventKey);
      if (reviewLoadSequence === state.loadSequence) {
        const index = state.events.findIndex(item => {
          return item.eventKey === savedEvent.eventKey;
        });
        if (index >= 0) {
          state.events.splice(index, 1, savedEvent);
        }
        if (state.expandedReviewEventKey === event.eventKey) {
          state.expandedReviewEventKey = "";
        }
        renderEvents();
        setStatus(
          status === "confirmed"
            ? `확인 완료 · 실제 반출량 ${formatTon(savedEvent.confirmedTon)}`
            : "자동 감지 내역을 반출 대상에서 제외했습니다.",
          "success"
        );

        try {
          const refreshed = await fetchRangeData(reviewRange);
          if (reviewLoadSequence === state.loadSequence) {
            renderData(
              preserveReviewedEventInRangeData(refreshed, savedEvent),
              reviewRequestedDates
            );
            state.loadedRangeKey = reviewRangeKey;
            state.loadedAt = Date.now();

            const waitForBaseline = Boolean(
              state.coverage?.baseline?.pending
            );
            const waitForLookahead = Boolean(
              state.coverage?.lookahead?.available &&
              state.coverage.lookahead.pending
            );
            const shouldResumePolling = Boolean(
              state.coverage?.pendingDates?.length ||
              waitForBaseline ||
              waitForLookahead
            );
            if (shouldResumePolling) {
              backgroundPollingOptions = {
                range: reviewRange,
                sequence: reviewLoadSequence,
                requestedDates: reviewRequestedDates,
                waitForBaseline,
                waitForLookahead,
                savedEvent,
                selectedRangeKey: reviewRangeKey
              };
            }
            authoritativeReviewRefreshComplete = true;
          }
        } catch (refreshError) {
          if (reviewLoadSequence === state.loadSequence) {
            setStatus(
              `확인은 저장됐지만 최신 목록 조회에 실패했습니다. · ${text(
                refreshError.message
              )}`,
              "warning"
            );
          }
        }
      }
      refreshSummary({ silent: true, force: true }).catch(error => {
        console.warn("Bed Ash 반출 확인 대기 갱신 실패:", error);
      });
    } catch (error) {
      if (error.status === 409) {
        if (reviewLoadSequence === state.loadSequence) {
          updateEventFromConflict(
            error.payload?.data?.currentEvent,
            event.eventKey
          );
          setStatus(
            "다른 사용자가 먼저 확인했습니다. 최신 확인 상태로 갱신했습니다.",
            "warning"
          );
        }
        refreshSummary({ silent: true, force: true }).catch(summaryError => {
          console.warn("Bed Ash 반출 확인 대기 갱신 실패:", summaryError);
        });
      } else {
        if (reviewLoadSequence === state.loadSequence) {
          setStatus(
            error.status === 401
              ? "로그인 정보가 만료되었습니다. 다시 로그인해 주세요."
              : `효율팀 확인 저장 실패 · ${text(error.message)}`,
            "error"
          );
        }
        if (error.status === 401) {
          clearSummaryAlert();
        }
      }
    } finally {
      state.submittingEventKeys.delete(event.eventKey);
      setReviewSubmissionControlsLocked(false);
      interactiveControls.forEach(control => {
        if (control.isConnected) {
          control.disabled = false;
        }
      });
      renderEvents();
      if (backgroundPollingOptions) {
        scheduleReviewRangePolling(backgroundPollingOptions);
      } else if (!authoritativeReviewRefreshComplete && getSessionToken()) {
        scheduleAuthoritativeRangeReload();
      }
    }
  }

  function bindEvents() {
    if (state.bound) {
      return;
    }

    const elements = getElements();
    if (!elements.view || !elements.tab) {
      return;
    }

    elements.periodButtons.forEach(button => {
      button.addEventListener("click", () => {
        const requested = text(button.dataset.bedAshPeriod);
        if (!PERIODS.has(requested) || requested === state.period) {
          return;
        }
        state.period = requested;
        state.filter = "all";
        state.expandedReviewEventKey = "";
        state.reviewDrafts.clear();
        state.composingReviewEventKey = "";
        state.renderEventsQueued = false;
        if (elements.statusFilter) {
          elements.statusFilter.value = "all";
        }
        renderPeriodControls();
        loadSelectedRange();
      });
    });

    elements.weekButtons.forEach(button => {
      button.addEventListener("click", () => {
        if (state.period !== "weekly" || button.disabled) {
          return;
        }

        const anchor = parseDate(state.anchorDate) || parseDate(getKstToday());
        const fixedWeek = getFixedWeekRange(
          anchor.getUTCFullYear(),
          anchor.getUTCMonth(),
          button.dataset.bedAshWeek
        );
        if (!fixedWeek.available || fixedWeek.startDate > getKstToday()) {
          return;
        }

        state.expandedReviewEventKey = "";
        state.reviewDrafts.clear();
        state.composingReviewEventKey = "";
        state.renderEventsQueued = false;
        state.anchorDate = fixedWeek.startDate;
        renderPeriodControls();
        loadSelectedRange();
      });
    });

    elements.monthButtons.forEach(button => {
      button.addEventListener("click", () => {
        if (state.period !== "monthly" || button.disabled) {
          return;
        }

        const anchor = parseDate(state.anchorDate) || parseDate(getKstToday());
        const monthNumber = Math.trunc(number(button.dataset.bedAshMonth, 0));
        const monthStart = formatInputDate(
          new Date(Date.UTC(anchor.getUTCFullYear(), monthNumber - 1, 1, 12))
        );
        if (monthNumber < 1 || monthNumber > 12 || monthStart > getKstToday()) {
          return;
        }

        state.expandedReviewEventKey = "";
        state.reviewDrafts.clear();
        state.composingReviewEventKey = "";
        state.renderEventsQueued = false;
        state.anchorDate = monthStart;
        renderPeriodControls();
        loadSelectedRange();
      });
    });

    elements.previousButton?.addEventListener("click", () => {
      state.expandedReviewEventKey = "";
      state.reviewDrafts.clear();
      state.composingReviewEventKey = "";
      state.renderEventsQueued = false;
      state.anchorDate = state.period === "monthly"
        ? shiftMonthlyYear(state.anchorDate, -1)
        : state.period === "weekly"
          ? shiftWeeklyMonth(state.anchorDate, -1)
          : addDays(state.anchorDate, -1);
      renderPeriodControls();
      loadSelectedRange();
    });

    elements.nextButton?.addEventListener("click", () => {
      if (elements.nextButton.disabled) {
        return;
      }
      state.expandedReviewEventKey = "";
      state.reviewDrafts.clear();
      state.composingReviewEventKey = "";
      state.renderEventsQueued = false;
      state.anchorDate = state.period === "monthly"
        ? shiftMonthlyYear(state.anchorDate, 1)
        : state.period === "weekly"
          ? shiftWeeklyMonth(state.anchorDate, 1)
          : addDays(state.anchorDate, 1);
      renderPeriodControls();
      loadSelectedRange();
    });

    elements.todayButton?.addEventListener("click", () => {
      state.expandedReviewEventKey = "";
      state.reviewDrafts.clear();
      state.composingReviewEventKey = "";
      state.renderEventsQueued = false;
      state.anchorDate = getKstToday();
      renderPeriodControls();
      loadSelectedRange();
    });

    elements.anchorDate?.addEventListener("change", () => {
      if (state.period !== "daily") {
        return;
      }
      state.expandedReviewEventKey = "";
      state.reviewDrafts.clear();
      state.composingReviewEventKey = "";
      state.renderEventsQueued = false;
      const chosenDate = text(elements.anchorDate.value);
      state.anchorDate = parseDate(chosenDate) && chosenDate <= getKstToday()
        ? chosenDate
        : getKstToday();
      renderPeriodControls();
      loadSelectedRange();
    });

    elements.refreshButton?.addEventListener("click", () => {
      if (!isMobileClient()) {
        state.expandedReviewEventKey = "";
        return loadSelectedRange({ forceRefresh: true });
      }
    });

    elements.statusFilter?.addEventListener("change", () => {
      const requestedFilter = text(elements.statusFilter.value);
      state.filter = FILTERS.has(requestedFilter) ? requestedFilter : "all";
      state.expandedReviewEventKey = "";
      renderEvents();
    });

    const captureReviewDraft = event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.matches("[data-bed-ash-review-field]")) {
        return;
      }
      storeReviewDraft(target.closest(".bed-ash-discharge-review-row"));
    };
    elements.tableBody?.addEventListener("input", captureReviewDraft);
    elements.tableBody?.addEventListener("change", captureReviewDraft);
    elements.tableBody?.addEventListener("compositionstart", event => {
      const target = event.target instanceof Element ? event.target : null;
      const reviewRow = target?.closest(".bed-ash-discharge-review-row");
      if (target?.matches("[data-bed-ash-review-field]") && reviewRow) {
        state.composingReviewEventKey = text(reviewRow.dataset.eventKey);
      }
    });
    elements.tableBody?.addEventListener("compositionend", event => {
      const target = event.target instanceof Element ? event.target : null;
      const reviewRow = target?.closest(".bed-ash-discharge-review-row");
      storeReviewDraft(reviewRow);
      if (
        reviewRow &&
        state.composingReviewEventKey === text(reviewRow.dataset.eventKey)
      ) {
        state.composingReviewEventKey = "";
      }
      if (state.renderEventsQueued) {
        window.setTimeout(() => {
          if (!state.composingReviewEventKey && state.renderEventsQueued) {
            renderEvents();
          }
        }, 0);
      }
    });

    elements.tableBody?.addEventListener("click", event => {
      const target = event.target instanceof Element ? event.target : null;
      const toggleButton = target?.closest("[data-bed-ash-review-toggle]");
      if (toggleButton && !isMobileClient()) {
        const eventKey = text(toggleButton.dataset.eventKey);
        const detectedEvent = state.events.find(item => item.eventKey === eventKey);
        if (
          detectedEvent &&
          detectedEvent.status === "pending" &&
          detectedEvent.reviewReady &&
          detectedEvent.closeReason !== "truck_boundary_unresolved" &&
          state.submittingEventKeys.size === 0
        ) {
          storeReviewDraft(
            elements.tableBody.querySelector(".bed-ash-discharge-review-row")
          );
          state.expandedReviewEventKey =
            state.expandedReviewEventKey === eventKey ? "" : eventKey;
          renderEvents();
          if (state.expandedReviewEventKey) {
            window.requestAnimationFrame(() => {
              elements.tableBody
                ?.querySelector(
                  ".bed-ash-discharge-review-row .bed-ash-discharge-review-at"
                )
                ?.focus();
            });
          }
        }
        return;
      }

      const button = target?.closest("[data-bed-ash-review-action]");
      if (!button) {
        return;
      }

      const eventKey = text(button.dataset.eventKey);
      const requestedAction = text(button.dataset.bedAshReviewAction);
      const reviewStatus = requestedAction === "confirm"
        ? "confirmed"
        : requestedAction === "exclude"
          ? "excluded"
          : "";
      if (!reviewStatus) {
        return;
      }

      const detectedEvent = state.events.find(item => item.eventKey === eventKey);
      const actionCell = button.closest("td");
      if (detectedEvent && actionCell) {
        submitReview(detectedEvent, actionCell, reviewStatus);
      }
    });

    elements.tab.addEventListener("click", () => {
      window.setTimeout(openBedAshDischargeView, 0);
    });
    elements.mainAlert?.addEventListener("click", openFromMainAlert);

    const viewObserver = new MutationObserver(() => {
      synchronizeQueryTimerVisibility();
      if (isQueryTimerVisible()) {
        openBedAshDischargeView();
      }
    });
    viewObserver.observe(elements.view, {
      attributes: true,
      attributeFilter: ["hidden", "class"]
    });
    const modal = document.getElementById("efficiencyTeamModal");
    if (modal) viewObserver.observe(modal, {
      attributes: true, attributeFilter: ["hidden", "class", "aria-hidden"]
    });

    document.addEventListener("visibilitychange", () => {
      synchronizeQueryTimerVisibility();
      if (document.visibilityState === "visible") {
        refreshSummary({ silent: true, force: true });
        if (!elements.view.hidden && elements.view.classList.contains("is-active")) {
          openBedAshDischargeView();
        }
      }
    });

    window.addEventListener("storage", event => {
      if (event.key === AUTH_STORAGE_KEY) {
        state.lastSessionToken = "";
        watchAuthentication();
      }
    });
    window.addEventListener("pagehide", stopQueryTimerInterval);
    window.addEventListener("pageshow", synchronizeQueryTimerVisibility);

    state.bound = true;
  }

  function watchAuthentication() {
    const token = getSessionToken();
    if (token !== state.lastSessionToken) {
      clearQueryTiming();
      state.lastSessionToken = token;
      state.loadSequence += 1;
      state.activeRangeLoad = null;
      state.summarySequence += 1;
      state.summaryLoading = false;
      state.summaryRefreshQueued = false;
      state.summaryNextAttemptAt = 0;
      setLoading(false);
      if (token) {
        clearDetailData("저장된 Bed Ash Silo 자료를 불러옵니다.");
        refreshSummary({ silent: true, force: true });
      } else {
        clearSummaryAlert();
        clearDetailData("로그인 후 Bed Ash 반출 내역을 확인할 수 있습니다.");
      }
      return;
    }

    if (token && Date.now() >= state.summaryNextAttemptAt) {
      refreshSummary({ silent: true });
    }
  }

  function initialize() {
    if (state.initialized) {
      return;
    }

    state.anchorDate = getKstToday();
    state.initialized = true;
    bindEvents();
    renderPeriodControls();
    renderSummaryCards();
    renderLatestLevels();
    renderEvents();
    watchAuthentication();

    window.setInterval(watchAuthentication, 2000);
  }

  window.openBedAshDischargeView = openBedAshDischargeView;
  window.refreshBedAshDischargeSummary = refreshSummary;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
