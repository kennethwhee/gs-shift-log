import assert from "node:assert/strict";
import { readFileSync } from "node:fs";


const CACHE_KEY =
  "20260902-arm-roll-compact-v2";

const mobileHtml =
  readFileSync(
    "mobile-app/index.html",
    "utf8"
  );

const mobileLayout =
  readFileSync(
    "mobile-app/mobile-layout-v17.css",
    "utf8"
  );

const layoutKeys = [
  ...mobileHtml.matchAll(
    /mobile-layout-v17\.css\?v=([^"'&\s>]+)/g
  )
].map(
  match => match[1]
);

assert.deepEqual(
  layoutKeys,
  [CACHE_KEY, CACHE_KEY],
  "normal and noscript mobile layout links must share the new cache key"
);

assert.match(
  mobileHtml,
  /id="armRollBoxThresholdAlertTitle"[^>]*>\s*70% 이상 BOX가 있습니다\.\s*</
);

assert.match(
  mobileHtml,
  /id="armRollBoxThresholdAlertMessage"[^>]*>\s*최신 레벨을 확인해주세요\.\s*</
);

assert.match(
  mobileLayout,
  /ARM ROLL BOX MOBILE COMPACT V1/
);

assert.match(
  mobileLayout,
  /\.efficiency-team-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/s,
  "four efficiency tabs must fit on one mobile row"
);

assert.match(
  mobileLayout,
  /#efficiencyBedAshDischargeTab\s*> \.efficiency-team-tab__badge:not\(\[hidden\]\)\s*\{[^}]*position: absolute !important;/s,
  "a visible Bed Ash badge must not create an implicit second tab row"
);

assert.match(
  mobileLayout,
  /> #efficiencyArmRollTab,[\s\S]{0,220}?> #efficiencyBedAshDischargeTab\s*\{[^}]*grid-template-columns:\s*16px\s*minmax\(0, 1fr\) !important;[^}]*padding-right: 3px !important;/s,
  "high-specificity ARM and Bed Ash tab rules must fit the four-column rail"
);

assert.match(
  mobileLayout,
  /#armRollBoxThresholdAlert:not\(\[hidden\]\)\s*\{[^}]*grid-template-areas: none !important;[^}]*min-height: 44px !important;/s,
  "the compact alert must discard the generated named-grid layout"
);

assert.match(
  mobileLayout,
  /\.arm-roll-box-threshold-alert__content\s*\{[^}]*display: grid !important;[^}]*grid-area: auto !important;[^}]*visibility: visible !important;[^}]*opacity: 1 !important;/s,
  "the warning copy must use a visible real grid container"
);

for (
  const id of [
    "armRollBoxThresholdAlertTitle",
    "armRollBoxThresholdAlertMessage"
  ]
) {
  assert.match(
    mobileLayout,
    new RegExp(
      `#${id}\\s*\\{[^}]*display: block !important;[^}]*visibility: visible !important;[^}]*opacity: 1 !important;`,
      "s"
    ),
    `${id} must stay visible on iOS Safari`
  );
}

assert.match(
  mobileLayout,
  /\.arm-roll-box-query-card\s*\{[^}]*display: flex !important;[^}]*flex-direction: column !important;/s,
  "the compact query card must not reactivate its desktop three-column grid"
);

assert.match(
  mobileLayout,
  /#armRollBoxSearchForm\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)\s*minmax\(0, 1fr\)\s*54px !important;/s,
  "date fields and query action must share one compact row"
);

assert.match(
  mobileLayout,
  /#armRollBoxSearchForm\s*> label\.form-field\s*\{[^}]*grid-template-rows:\s*9px\s*34px !important;[^}]*row-gap: 2px !important;/s,
  "high-specificity generated date rows must be compacted"
);

assert.match(
  mobileLayout,
  /\.arm-roll-box-current-grid\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\) !important;/s,
  "ARM and SCRAP cards must remain a compact two-column grid"
);

console.log(
  "ARM ROLL BOX mobile compact layout verified."
);
