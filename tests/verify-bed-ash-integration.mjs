import assert from "node:assert/strict";
import { readFileSync } from "node:fs";


const read = path => readFileSync(path, "utf8");


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

  assert.match(
    html,
    /efficiency\/bed-ash-discharge\.css\?v=20260830-bed-ash-discharge-v4/
  );
  assert.match(
    html,
    /efficiency\/bed-ash-discharge\.js\?v=20260830-bed-ash-discharge-v4/
  );

  const viewStart = html.indexOf('id="efficiencyBedAshDischargeView"');
  const viewEnd = html.indexOf('id="efficiencyArmRollView"', viewStart);
  const viewMarkup = html.slice(viewStart, viewEnd);
  assert.equal(
    (viewMarkup.match(/<th>/g) || []).length,
    6,
    `${label}: event table must have six compact columns`
  );
  assert.match(viewMarkup, /<th>중량 변화<\/th>/);
  assert.match(viewMarkup, /<th>차량별 추정량<\/th>/);
  assert.match(viewMarkup, /연속 하락은 차량 1대 단위 후보로 분리/);
  assert.doesNotMatch(viewMarkup, /<th>감지 전<\/th>/);
}


assert.match(
  desktopHtml,
  /script\.js\?v=20260830-bed-ash-discharge-v1/
);
assert.equal(
  (
    mobileHtml.match(
      /mobile-runtime-v14\.js\?v=20260830-bed-ash-discharge-v1/g
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
assert.match(client, /복수 차량 추정/);
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
assert.match(client, /window\.openBedAshDischargeView/);
assert.match(client, /window\.refreshBedAshDischargeSummary/);
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
  /@media screen and \(max-width: 768px\)[\s\S]*?bed-ash-discharge-table-wrap table \{\s*min-width:\s*640px;/
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
