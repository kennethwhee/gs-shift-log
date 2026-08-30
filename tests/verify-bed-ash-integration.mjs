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
    /efficiency\/bed-ash-discharge\.css\?v=20260830-bed-ash-discharge-v3/
  );
  assert.match(
    html,
    /efficiency\/bed-ash-discharge\.js\?v=20260830-bed-ash-discharge-v3/
  );

  const viewStart = html.indexOf('id="efficiencyBedAshDischargeView"');
  const viewEnd = html.indexOf('id="efficiencyArmRollView"', viewStart);
  const viewMarkup = html.slice(viewStart, viewEnd);
  assert.equal(
    (viewMarkup.match(/<th>/g) || []).length,
    9,
    `${label}: event table must have nine columns`
  );
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
