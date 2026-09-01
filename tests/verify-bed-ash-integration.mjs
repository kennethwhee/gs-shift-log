import assert from "node:assert/strict";
import { readFileSync } from "node:fs";


const read = path => readFileSync(path, "utf8");

const BED_ASH_V6_CACHE_KEY = "20260901-bed-ash-no-period-nav-v6-1";

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} helper must exist`);

  const parametersStart = source.indexOf("(", start);
  let parameterDepth = 0;
  let parametersEnd = -1;
  for (let index = parametersStart; index < source.length; index += 1) {
    if (source[index] === "(") {
      parameterDepth += 1;
    } else if (source[index] === ")") {
      parameterDepth -= 1;
      if (parameterDepth === 0) {
        parametersEnd = index;
        break;
      }
    }
  }
  assert.ok(parametersEnd >= 0, `${name} helper parameters must be balanced`);

  const bodyStart = source.indexOf("{", parametersEnd);
  assert.ok(bodyStart >= 0, `${name} helper must have a function body`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  assert.fail(`${name} helper body must be balanced`);
}


const desktopHtml = read("index.html");
const mobileHtml = read("mobile-app/index.html");
const desktopRuntime = read("script.js");
const mobileRuntime = read("mobile-app/mobile-runtime-v14.js");
const client = read("efficiency/bed-ash-discharge.js");
const style = read("efficiency/bed-ash-discharge.css");
const api = read("functions/api/bed-ash-discharge.js");
const requestApi = read("functions/api/ois-data-requests.js");
const agent = read("local-tools/ois-agent/ois-login.js");


const requiredIds = [
  "bedAshDischargeMainAlert",
  "bedAshDischargeMainAlertDetail",
  "bedAshDischargeMainAlertCount",
  "efficiencyBedAshDischargeTab",
  "efficiencyBedAshDischargeBadge",
  "efficiencyBedAshDischargeView",
  "refreshBedAshDischargeButton",
  "bedAshDischargePeriodDaily",
  "bedAshDischargePeriodWeekly",
  "bedAshDischargePeriodMonthly",
  "bedAshDischargePreviousPeriodButton",
  "bedAshDischargeAnchorDate",
  "bedAshDischargeTodayButton",
  "bedAshDischargeNextPeriodButton",
  "bedAshDischargeWeekSelector",
  "bedAshDischargeMonthSelector",
  "bedAshDischargeRangeLabel",
  "bedAshDischargeStatus",
  "bedAshDischargeReadOnlyNotice",
  "bedAshDischargeTotalAmount",
  "bedAshDischargeUnitOneAmount",
  "bedAshDischargeUnitTwoAmount",
  "bedAshDischargePendingCount",
  "bedAshDischargeUnitOneLatestLevel",
  "bedAshDischargeUnitOneLatestAt",
  "bedAshDischargeUnitTwoLatestLevel",
  "bedAshDischargeUnitTwoLatestAt",
  "bedAshDischargeStatusFilter",
  "bedAshDischargeEventCount",
  "bedAshDischargeEventTableBody",
  "bedAshDischargeLoadingState",
  "bedAshDischargeEmptyState"
];


for (const [label, html] of [
  ["desktop", desktopHtml],
  ["mobile", mobileHtml]
]) {
  for (const id of requiredIds) {
    const count = html.split(`id="${id}"`).length - 1;
    assert.equal(count, 1, `${label}: ${id} must occur once`);
  }

  assert.ok(
    html.indexOf('data-efficiency-tab="auxiliary-materials"') <
      html.indexOf('data-efficiency-tab="bed-ash-discharge"'),
    `${label}: Bed Ash tab must follow auxiliary materials`
  );
  assert.ok(
    html.indexOf('data-efficiency-tab="bed-ash-discharge"') <
      html.indexOf('data-efficiency-tab="arm-roll"'),
    `${label}: Bed Ash tab must precede ARM ROLL`
  );

  const stylesheetCacheKeys = [
    ...html.matchAll(/efficiency\/bed-ash-discharge\.css\?v=([^"'&\s>]+)/g)
  ].map(match => match[1]);
  const clientCacheKeys = [
    ...html.matchAll(/efficiency\/bed-ash-discharge\.js\?v=([^"'&\s>]+)/g)
  ].map(match => match[1]);
  assert.deepEqual(
    stylesheetCacheKeys,
    [BED_ASH_V6_CACHE_KEY],
    `${label}: Bed Ash stylesheet must use only the V6 cache key`
  );
  assert.deepEqual(
    clientCacheKeys,
    [BED_ASH_V6_CACHE_KEY],
    `${label}: Bed Ash client must use only the V6 cache key`
  );

  assert.equal(
    (html.match(/data-bed-ash-week="[1-5]"/g) || []).length,
    5,
    `${label}: weekly selector must contain exactly five options`
  );
  assert.equal(
    (html.match(/data-bed-ash-month="(?:[1-9]|1[0-2])"/g) || []).length,
    12,
    `${label}: monthly selector must contain exactly twelve options`
  );

  for (let week = 1; week <= 5; week += 1) {
    const weekButton = new RegExp(
      `<button[^>]*data-bed-ash-week="${week}"[^>]*>[\\s\\S]*?${week}주[\\s\\S]*?<\\/button>`
    );
    assert.match(html, weekButton, `${label}: ${week}주 selector must exist`);
  }

  for (let month = 1; month <= 12; month += 1) {
    const monthButton = new RegExp(
      `<button[^>]*data-bed-ash-month="${month}"[^>]*>[\\s\\S]*?${month}월[\\s\\S]*?<\\/button>`
    );
    assert.match(html, monthButton, `${label}: ${month}월 selector must exist`);
  }

  const viewStart = html.indexOf('id="efficiencyBedAshDischargeView"');
  const viewEnd = html.indexOf('id="efficiencyArmRollView"', viewStart);
  const viewMarkup = html.slice(viewStart, viewEnd);
  assert.equal(
    (viewMarkup.match(/<th>/g) || []).length,
    6,
    `${label}: event table must have six compact columns`
  );
  assert.match(viewMarkup, /<th>중량 변화<\/th>/);
  assert.match(viewMarkup, /<th>반출량<\/th>/);
  assert.match(viewMarkup, /연속 하락은 실제 시간별 OIS 경계에서 차량 단위로 분리/);
  assert.doesNotMatch(viewMarkup, /<th>감지 전<\/th>/);
}


assert.match(
  desktopHtml,
  /script\.js\?v=20260901-floating-notification-v1/
);
assert.equal(
  (
    mobileHtml.match(
      /mobile-runtime-v14\.js\?v=20260901-floating-notification-v1/g
    ) || []
  ).length,
  2
);


assert.match(desktopRuntime, /"bed-ash-discharge"/);
assert.match(desktopRuntime, /openBedAshDischargeView/);
assert.match(desktopRuntime, /efficiencyBedAshDischargeView/);
assert.match(desktopRuntime, /data-bed-ash-review-field/);


const generatedWhitelist =
  '"auxiliary-materials","bed-ash-discharge","arm-roll"';
assert.equal(
  mobileRuntime.split(generatedWhitelist).length - 1,
  1,
  "mobile generated runtime must contain the Bed Ash route once"
);
assert.equal(
  mobileRuntime.split("window.openBedAshDischargeView()").length - 1,
  1,
  "mobile generated runtime must contain the open hook once"
);
assert.match(mobileRuntime, /efficiencyBedAshDischargeView/);
assert.match(mobileRuntime, /data-bed-ash-review-field/);


assert.match(client, /requestType:\s*"bed_ash_level"/);
assert.match(client, /X-GS-Client-Mode/);
assert.match(client, /lookahead/);
assert.match(client, /event\.reviewReady/);
assert.match(client, /자료 확인 중/);
assert.match(client, /마지막 날 후속/);
assert.match(client, /expandedReviewEventKey/);
assert.match(client, /reviewDrafts:\s*new Map\(\)/);
assert.match(client, /submittingEventKeys:\s*new Set\(\)/);
assert.match(client, /composingReviewEventKey/);
assert.match(client, /captureReviewEditorFocus/);
assert.match(client, /restoreReviewEditorFocus/);
assert.match(client, /addEventListener\("compositionstart"/);
assert.match(client, /addEventListener\("compositionend"/);
assert.match(
  client,
  /if \(state\.composingReviewEventKey\) \{\s*state\.renderEventsQueued = true;\s*return;/
);
assert.match(client, /state\.reviewDrafts\.set\(eventKey/);
assert.match(client, /addEventListener\("input",\s*captureReviewDraft\)/);
assert.match(client, /state\.submittingEventKeys\.has\(event\.eventKey\)/);
assert.match(client, /input\.disabled\s*=\s*isSubmitting/);
assert.match(client, /reviewSubmissionControlsLocked:\s*false/);
assert.match(client, /reviewSubmissionControlStates:\s*new Map\(\)/);
assert.match(client, /function setReviewSubmissionControlsLocked\(isLocked\)/);
assert.match(
  client,
  /reviewSubmissionControlStates\.set\(control, control\.disabled\)/
);
assert.match(client, /control\.disabled\s*=\s*wasDisabled/);
assert.match(
  client,
  /state\.expandedReviewEventKey\s*===\s*event\.eventKey\)\s*\{\s*state\.expandedReviewEventKey\s*=\s*"";/
);
assert.match(
  client,
  /text\(currentReviewRow\.dataset\.eventKey\)\s*===\s*state\.expandedReviewEventKey/
);
assert.match(client, /bed-ash-discharge-review-row/);
assert.match(client, /cell\.colSpan\s*=\s*6/);
assert.match(client, /"aria-controls",\s*getReviewPanelId\(event\.eventKey\)/);
assert.match(client, /dataset\.bedAshPeriod\s*=\s*state\.period/);
assert.match(client, /truck_boundary_unresolved/);
assert.match(client, /createElement\("small", "", "반출량"\)/);
assert.match(client, /시간 경계 확인 필요/);
assert.match(client, /DETECTOR_ALGORITHM_VERSION\s*=\s*"bed-ash-drop-v2"/);
assert.match(client, /기존 방식 확정 합계/);
assert.match(client, /기존 방식 제외 기록/);
assert.match(
  client,
  /detectedEvent\.closeReason\s*!==\s*"truck_boundary_unresolved"/
);
assert.match(
  client,
  /forceRefresh:\s*missing\.has\(date\) \|\| failed\.has\(date\)/
);
assert.match(client, /maximumFractionDigits:\s*2/);

const periodHelpers = new Function(`
  ${extractFunction(client, "text")}
  ${extractFunction(client, "number")}
  ${extractFunction(client, "parseDate")}
  ${extractFunction(client, "formatInputDate")}
  ${extractFunction(client, "getMonthLastDay")}
  ${extractFunction(client, "getFixedWeekRange")}
  ${extractFunction(client, "getFixedWeekNumber")}
  ${extractFunction(client, "getKstToday")}
  ${extractFunction(client, "calculatePeriod")}
  return { getFixedWeekRange, calculatePeriod };
`)();

const august2026Weeks = [
  ["2026-08-01", "2026-08-07"],
  ["2026-08-08", "2026-08-14"],
  ["2026-08-15", "2026-08-21"],
  ["2026-08-22", "2026-08-28"],
  ["2026-08-29", "2026-08-31"]
];
august2026Weeks.forEach(([startDate, endDate], index) => {
  const weekNumber = index + 1;
  assert.deepEqual(periodHelpers.getFixedWeekRange(2026, 7, weekNumber), {
    weekNumber,
    startDate,
    endDate,
    available: true
  });
});
assert.deepEqual(periodHelpers.getFixedWeekRange(2026, 1, 4), {
  weekNumber: 4,
  startDate: "2026-02-22",
  endDate: "2026-02-28",
  available: true
});
assert.deepEqual(periodHelpers.getFixedWeekRange(2026, 1, 5), {
  weekNumber: 5,
  startDate: "",
  endDate: "",
  available: false
});
assert.deepEqual(periodHelpers.getFixedWeekRange(2028, 1, 5), {
  weekNumber: 5,
  startDate: "2028-02-29",
  endDate: "2028-02-29",
  available: true
});

const augustFifthWeek = periodHelpers.calculatePeriod("weekly", "2026-08-31");
assert.equal(augustFifthWeek.startDate, "2026-08-29");
assert.equal(augustFifthWeek.endDate, "2026-08-31");
const augustMonth = periodHelpers.calculatePeriod("monthly", "2026-08-25");
assert.equal(augustMonth.startDate, "2026-08-01");
assert.equal(augustMonth.endDate, "2026-08-31");

const createEventRowSource = extractFunction(client, "createEventRow");
assert.match(
  createEventRowSource,
  /const visibleAmountTon\s*=\s*event\.status\s*===\s*"confirmed"\s*&&\s*event\.confirmedTon\s*!==\s*null\s*\?\s*event\.confirmedTon\s*:\s*event\.estimatedTon/,
  "confirmed history rows must show confirmedTon and all other rows estimatedTon"
);
assert.ok(
  (createEventRowSource.match(/formatTon\(visibleAmountTon\)/g) || []).length >= 2,
  "visible history amount cells must render the selected amount"
);
assert.doesNotMatch(
  createEventRowSource,
  /formatTon\(event\.estimatedTon\)/,
  "history amount cells must not bypass the confirmed amount selection"
);

const setLoadingSource = extractFunction(client, "setLoading");
assert.ok(
  setLoadingSource.indexOf("state.loading = isLoading") <
    setLoadingSource.indexOf("renderPeriodControls()"),
  "loading state must be applied before period controls are rerendered"
);
const loadSelectedRangeSource = extractFunction(client, "loadSelectedRange");
assert.match(loadSelectedRangeSource, /setLoading\(true\)/);

assert.match(client, /function summarizeVisibleEvents\(events\)/);
assert.match(
  client,
  /state\.summary\s*=\s*summarizeVisibleEvents\(state\.events\)/
);
const refreshHandlerStart = client.indexOf(
  'elements.refreshButton?.addEventListener("click"'
);
const refreshHandlerEnd = client.indexOf(
  'elements.statusFilter?.addEventListener("change"',
  refreshHandlerStart
);
const refreshHandlerSource = client.slice(
  refreshHandlerStart,
  refreshHandlerEnd
);
assert.ok(
  refreshHandlerStart >= 0 && refreshHandlerEnd > refreshHandlerStart
);
assert.match(refreshHandlerSource, /loadSelectedRange\(\)/);
assert.doesNotMatch(refreshHandlerSource, /forceRefresh:\s*true/);
assert.match(client, /window\.openBedAshDischargeView/);
assert.match(client, /window\.refreshBedAshDischargeSummary/);
assert.match(client, /document\.getElementById\("bedAshDischargeWeekSelector"\)/);
assert.match(client, /document\.querySelectorAll\("\[data-bed-ash-week\]"\)/);
assert.match(client, /document\.getElementById\("bedAshDischargeMonthSelector"\)/);
assert.match(client, /document\.querySelectorAll\("\[data-bed-ash-month\]"\)/);
assert.match(client, /button\.hidden\s*=\s*weekNumber\s*===\s*5\s*&&\s*!fixedWeek\.available/);
assert.match(client, /shiftWeeklyMonth\(state\.anchorDate,\s*-1\)/);
assert.match(client, /shiftWeeklyMonth\(state\.anchorDate,\s*1\)/);
assert.match(client, /shiftMonthlyYear\(state\.anchorDate,\s*-1\)/);
assert.match(client, /shiftMonthlyYear\(state\.anchorDate,\s*1\)/);
assert.doesNotMatch(client, /\.innerHTML\s*=/);
const mainAlertStart = client.indexOf("function openFromMainAlert()");
const mainAlertEnd = client.indexOf("function updateEventFromConflict", mainAlertStart);
const mainAlertSource = client.slice(mainAlertStart, mainAlertEnd);
assert.ok(mainAlertStart >= 0 && mainAlertEnd > mainAlertStart);
assert.match(mainAlertSource, /loadSelectedRange\(\)/);
assert.doesNotMatch(mainAlertSource, /openBedAshDischargeView\(\)/);
assert.match(style, /@media screen and \(min-width: 1840px\)/);
assert.match(style, /data-bed-ash-mobile-client="true"/);
assert.match(style, /bed-ash-discharge-level-change-cell/);
assert.match(style, /bed-ash-discharge-review-toggle/);
assert.match(style, /is-truck-boundary-unresolved/);
assert.match(style, /is-boundary-unresolved/);
assert.match(style, /is-legacy-reviewed-event/);
assert.match(style, /BED ASH COMPACT PERIOD V6\.1/);
assert.match(
  style,
  /bed-ash-discharge-summary-card\.is-pending,[\s\S]{0,700}?display:\s*none\s*!important/
);
assert.match(
  style,
  /bed-ash-discharge-summary-grid \{\s*grid-template-columns:\s*repeat\(3/
);
assert.match(
  style,
  /bed-ash-discharge-table-wrap th,\s*#efficiencyTeamModal \.bed-ash-discharge-table-wrap td \{[\s\S]{0,700}?font-size:\s*14px;/
);
assert.match(
  style,
  /bed-ash-discharge-table-wrap th \{[\s\S]{0,500}?font-size:\s*13px;/
);
assert.match(
  style,
  /bed-ash-discharge-time-cell > strong,[\s\S]{0,260}?font-size:\s*14\.5px;/
);
assert.match(
  style,
  /bed-ash-discharge-review-field > input \{[\s\S]{0,700}?font-size:\s*13px;/
);
assert.match(
  style,
  /\[data-bed-ash-review-action\],[\s\S]{0,420}?font-size:\s*13px;/
);
assert.match(
  style,
  /bed-ash-discharge-heading p \{[\s\S]{0,220}?color:\s*#5d6d80;[\s\S]{0,160}?font-size:\s*13px;/
);
assert.match(
  style,
  /bed-ash-discharge-table-wrap th,\s*#efficiencyTeamModal \.bed-ash-discharge-table-wrap td \{\s*padding:\s*6px 5px;\s*font-size:\s*11px;/
);
assert.match(
  style,
  /@media screen and \(max-width: 768px\)[\s\S]*?bed-ash-discharge-time-cell > strong,[\s\S]{0,260}?font-size:\s*12px;/
);
assert.match(
  style,
  /@media screen and \(max-width: 768px\)[\s\S]*?bed-ash-discharge-time-cell > small,[\s\S]{0,450}?font-size:\s*10\.5px;/
);

const compactV6Style = style.slice(style.indexOf("BED ASH COMPACT PERIOD V6.1"));
assert.match(
  compactV6Style,
  /#efficiencyBedAshDischargeView\[data-bed-ash-period="weekly"\][\s\S]{0,100}?\.bed-ash-discharge-date-navigation,[\s\S]{0,140}?#efficiencyBedAshDischargeView\[data-bed-ash-period="monthly"\][\s\S]{0,100}?\.bed-ash-discharge-date-navigation\s*\{\s*display:\s*none\s*!important/,
  "weekly and monthly views must remove the redundant previous/today/next row"
);
assert.match(
  compactV6Style,
  /bed-ash-discharge-summary-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
  "mobile V6 summary must keep total, unit 1 and unit 2 on one row"
);
assert.match(
  compactV6Style,
  /bed-ash-discharge-level-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  "mobile V6 inventory must keep unit 1 and unit 2 on one row"
);
assert.match(
  compactV6Style,
  /bed-ash-discharge-summary-card > strong\s*\{[^}]*font-size:\s*18px/,
  "mobile V6 summary values must remain readable"
);
assert.match(
  compactV6Style,
  /bed-ash-discharge-level-card__value strong\s*\{[^}]*font-size:\s*18px/,
  "mobile V6 inventory values must remain readable"
);
assert.match(
  compactV6Style,
  /bed-ash-discharge-table-wrap\s*\{[^}]*overflow-x:\s*hidden/,
  "mobile V6 history wrapper must not horizontally scroll"
);
assert.match(
  compactV6Style,
  /bed-ash-discharge-table-wrap table\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*table-layout:\s*fixed/,
  "mobile V6 history table must fit the viewport"
);
assert.doesNotMatch(
  compactV6Style,
  /(?:min-width:\s*(?:580|620|640)px|overflow-x:\s*auto)/,
  "mobile V6 must not restore a wide or horizontally scrolling history table"
);
assert.match(
  compactV6Style,
  /bed-ash-discharge-time-cell > small,[\s\S]{0,260}?bed-ash-discharge-estimated-cell:not\(\.is-legacy-reviewed-event\)[\s\S]{0,80}?> small\s*\{\s*display:\s*none/,
  "mobile V6 history must hide repeated detector-detail sublines"
);
assert.match(
  compactV6Style,
  /bed-ash-discharge-estimated-cell\.is-legacy-reviewed-event[\s\S]{0,80}?> strong\s*\{\s*display:\s*none/,
  "mobile V6 history must hide the verbose legacy amount heading"
);
assert.match(
  compactV6Style,
  /bed-ash-discharge-estimated-cell\.is-legacy-reviewed-event[\s\S]{0,80}?> small\s*\{[^}]*display:\s*block/,
  "mobile V6 history must preserve the legacy reviewed amount"
);

const submitReviewStart = client.indexOf("async function submitReview(");
const submitReviewEnd = client.indexOf("function bindEvents()", submitReviewStart);
const submitReviewSource = client.slice(submitReviewStart, submitReviewEnd);
assert.ok(submitReviewStart >= 0 && submitReviewEnd > submitReviewStart);
assert.match(submitReviewSource, /reviewLoadSequence\s*=\s*\+\+state\.loadSequence/);
assert.match(submitReviewSource, /preserveReviewedEventInRangeData/);
assert.match(submitReviewSource, /reviewLoadSequence\s*===\s*state\.loadSequence/);
assert.match(submitReviewSource, /setReviewSubmissionControlsLocked\(true\)/);
assert.match(submitReviewSource, /setReviewSubmissionControlsLocked\(false\)/);
assert.match(submitReviewSource, /shouldResumePolling/);
assert.match(submitReviewSource, /backgroundPollingOptions\s*=\s*\{/);
assert.match(submitReviewSource, /scheduleReviewRangePolling\(backgroundPollingOptions\)/);
assert.doesNotMatch(submitReviewSource, /await pollRange\(/);
assert.match(
  submitReviewSource,
  /!authoritativeReviewRefreshComplete\s*&&\s*getSessionToken\(\)/
);
assert.match(submitReviewSource, /scheduleAuthoritativeRangeReload\(\)/);
assert.ok(
  submitReviewSource.indexOf("setReviewSubmissionControlsLocked(false)") <
    submitReviewSource.indexOf("scheduleReviewRangePolling(backgroundPollingOptions)"),
  "review controls must unlock before background polling starts"
);
const backgroundPollStart = client.indexOf("function scheduleReviewRangePolling(");
const backgroundPollEnd = client.indexOf("async function loadSelectedRange(", backgroundPollStart);
const backgroundPollSource = client.slice(backgroundPollStart, backgroundPollEnd);
assert.ok(backgroundPollStart >= 0 && backgroundPollEnd > backgroundPollStart);
assert.match(backgroundPollSource, /pollRange\(/);
assert.match(backgroundPollSource, /\.catch\(error\s*=>/);
const pollRangeStart = client.indexOf("async function pollRange(");
const pollRangeEnd = client.indexOf(
  "function scheduleReviewRangePolling(",
  pollRangeStart
);
const pollRangeSource = client.slice(pollRangeStart, pollRangeEnd);
assert.ok(pollRangeStart >= 0 && pollRangeEnd > pollRangeStart);
assert.match(
  pollRangeSource,
  /catch \(error\) \{\s*if \(sequence !== state\.loadSequence\) \{\s*return "cancelled";/
);
assert.ok(
  submitReviewSource.indexOf("++state.loadSequence") <
    submitReviewSource.indexOf("await requestJson(API_URL"),
  "review must invalidate older range loads before POST"
);


assert.match(api, /const MAXIMUM_QUERY_DAYS\s*=\s*\n\s*31/);
assert.match(api, /const DISCHARGE_THRESHOLD_TON\s*=\s*\n\s*5/);
assert.match(
  api,
  /const MINIMUM_REAL_BOUNDARY_TRUCK_TON\s*=\s*\n\s*DISCHARGE_THRESHOLD_TON/
);
assert.match(api, /const minimumSegmentTon\s*=/);
assert.match(api, /FROM json_each\(\?\)/);
assert.match(api, /status = 'pending'/);
assert.match(api, /status = 'confirmed'/);
assert.match(api, /status = 'excluded'/);
assert.match(api, /review_ready INTEGER NOT NULL DEFAULT 0/);
assert.match(api, /AND review_ready = 1/);
assert.match(api, /lookahead/);
assert.match(api, /hasRequestCoverageThrough/);
assert.match(api, /hasRequestHourRangeCoverage/);
assert.match(api, /hasContinuousEventDateSupport/);
assert.match(api, /blockedReviewDates/);
assert.equal(
  (api.match(/FROM json_each\(\?\) AS expected/g) || []).length,
  2,
  "evidence refresh and final review must guard OIS request snapshots"
);
assert.match(api, /REQUEST_SNAPSHOT_CTES_SQL/);
assert.match(api, /expected_requests AS/);
assert.match(api, /current_requests AS/);
assert.match(api, /FROM current_requests\s+EXCEPT\s+SELECT/);
assert.match(api, /FROM expected_requests\s+EXCEPT\s+SELECT/);
assert.match(api, /snapshotRetryCount/);
assert.match(api, /synchronizationResult\.synchronized/);
assert.match(api, /isMobileClient/);
assert.match(api, /bed_ash_discharge_review_history/);
assert.match(api, /idx_bed_ash_events_reviewed_overlap_v2/);
assert.match(
  api,
  /ORDER BY\s+legacy_or_current\.threshold_crossed_at DESC,\s+CASE\s+WHEN legacy_or_current\.algorithm_version = \?/
);


assert.match(requestApi, /"bed_ash_level"/);
assert.match(requestApi, /normalizeBedAshLevelResult/);
assert.match(requestApi, /104HDC01CW101XQ01/);
assert.match(requestApi, /204HDC01CW101XQ01/);


assert.match(agent, /"bed_ash_level"/);
assert.match(agent, /104HDC01CW101XQ01/);
assert.match(agent, /204HDC01CW101XQ01/);
assert.match(agent, /collectOisBedAshLevelValues/);
assert.match(agent, /AbortController/);


console.log("Bed Ash integration verification passed.");
