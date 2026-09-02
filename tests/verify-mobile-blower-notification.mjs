import assert from "node:assert/strict";
import { readFileSync } from "node:fs";


const read = path => readFileSync(path, "utf8");

const CACHE_KEY =
  "20260902-arm-roll-compact-v2";


function extractFunction(
  source,
  name
) {
  const start =
    source.indexOf(
      `function ${name}(`
    );

  assert.ok(
    start >= 0,
    `${name} helper must exist`
  );

  const parametersStart =
    source.indexOf(
      "(",
      start
    );

  let parameterDepth =
    0;

  let parametersEnd =
    -1;

  for (
    let index = parametersStart;
    index < source.length;
    index += 1
  ) {
    if (
      source[index] === "("
    ) {
      parameterDepth +=
        1;
    } else if (
      source[index] === ")"
    ) {
      parameterDepth -=
        1;

      if (
        parameterDepth === 0
      ) {
        parametersEnd =
          index;

        break;
      }
    }
  }

  assert.ok(
    parametersEnd >= 0,
    `${name} helper parameters must be balanced`
  );

  const bodyStart =
    source.indexOf(
      "{",
      parametersEnd
    );

  assert.ok(
    bodyStart >= 0,
    `${name} helper must have a body`
  );

  let depth =
    0;

  for (
    let index = bodyStart;
    index < source.length;
    index += 1
  ) {
    if (
      source[index] === "{"
    ) {
      depth +=
        1;
    } else if (
      source[index] === "}"
    ) {
      depth -=
        1;

      if (
        depth === 0
      ) {
        return source.slice(
          start,
          index + 1
        );
      }
    }
  }

  assert.fail(
    `${name} helper body must be balanced`
  );
}


const desktopHtml =
  read("index.html");

const mobileHtml =
  read("mobile-app/index.html");

const dockScript =
  read(
    "maintenance/main-floating-notification-dock.js"
  );

const dockStyle =
  read(
    "maintenance/main-floating-notification-dock.css"
  );

const blowerSource =
  read(
    "maintenance/mobile-blower-main-alert.js"
  );


for (
  const [label, html] of [
    ["desktop", desktopHtml],
    ["mobile", mobileHtml]
  ]
) {
  const styleKeys = [
    ...html.matchAll(
      /main-floating-notification-dock\.css\?v=([^"'&\s>]+)/g
    )
  ].map(
    match => match[1]
  );

  const scriptKeys = [
    ...html.matchAll(
      /main-floating-notification-dock\.js\?v=([^"'&\s>]+)/g
    )
  ].map(
    match => match[1]
  );

  assert.deepEqual(
    styleKeys,
    [CACHE_KEY],
    `${label}: dock stylesheet must use the current cache key exactly once`
  );

  assert.deepEqual(
    scriptKeys,
    [CACHE_KEY],
    `${label}: dock script must use the current cache key exactly once`
  );
}


assert.match(
  mobileHtml,
  new RegExp(
    `maintenance/mobile-blower-main-alert\\.js\\?v=${CACHE_KEY}`
  )
);

const blowerScriptKeys = [
  ...mobileHtml.matchAll(
    /mobile-blower-main-alert\.js\?v=([^"'&\s>]+)/g
  )
].map(
  match => match[1]
);

assert.deepEqual(
  blowerScriptKeys,
  [CACHE_KEY],
  "mobile Blower preview source must use the current cache key exactly once"
);

assert.doesNotMatch(
  `${desktopHtml}\n${mobileHtml}`,
  /20260902-mobile-blower-preview-v1/
);

assert.doesNotMatch(
  `${desktopHtml}\n${mobileHtml}`,
  /20260902-mobile-notification-center-v1-1/
);

assert.match(
  mobileHtml,
  /id="bedAshDischargeMainAlert"/
);

assert.match(
  mobileHtml,
  /id="armRollBoxMainAlert"/
);


const mobileMode =
  extractFunction(
    dockScript,
    "isMobileDockMode"
  );

assert.match(
  mobileMode,
  /return\s+IS_MOBILE_CLIENT/
);

assert.doesNotMatch(
  mobileMode,
  /matchMedia|innerWidth|clientWidth/,
  "mobile-only behavior must follow the dedicated client route, not PC viewport width"
);

assert.match(
  dockScript,
  /let mobileExpanded\s*=\s*false/,
  "mobile notification preview must start folded"
);


const activeSources =
  extractFunction(
    dockScript,
    "getActiveSourceDefinitions"
  );

assert.match(
  activeSources,
  /return\s+SOURCE_DEFINITIONS;/,
  "PC and mobile must keep the two supported alert sources"
);

assert.doesNotMatch(
  activeSources,
  /filter|MOBILE_SOURCE_ID/,
  "mobile must not filter ARM ROLL BOX out of the notification center"
);

assert.match(
  dockScript,
  /id:\s*"blowerHistoryMainAlert"[\s\S]{0,220}?detailType:\s*"blower-history"/
);

assert.match(
  dockScript,
  /id:\s*"armRollBoxMainAlert"[\s\S]{0,220}?detailType:\s*"arm-roll-box"/
);

const sourceDefinitionsStart =
  dockScript.indexOf(
    "const SOURCE_DEFINITIONS"
  );

const sourceDefinitionsEnd =
  dockScript.indexOf(
    "];",
    sourceDefinitionsStart
  );

const sourceDefinitions =
  dockScript.slice(
    sourceDefinitionsStart,
    sourceDefinitionsEnd + 2
  );

assert.doesNotMatch(
  sourceDefinitions,
  /bedAsh/i,
  "Bed Ash must remain outside the mobile notification source list"
);

assert.match(
  dockScript,
  /const states\s*=\s*getActiveSourceDefinitions\(\)/
);


const mobileDetail =
  extractFunction(
    dockScript,
    "syncMobileDetailAction"
  );

assert.match(
  mobileDetail,
  /const shouldShow\s*=\s*isMobileDockMode\(\)/
);

assert.match(
  mobileDetail,
  /if\s*\(\s*!shouldShow\s*\)[\s\S]*?action\?\.remove\(\)[\s\S]*?source\.removeAttribute\(\s*"inert"\s*\)[\s\S]*?previousState\.tabindex/,
  "PC must restore the existing source interactions"
);

assert.match(
  mobileDetail,
  /source\.setAttribute\(\s*"inert"/,
  "the source preview must not retain its direct navigation action"
);

assert.match(
  mobileDetail,
  /"tabindex"\s*,\s*"-1"/
);

assert.doesNotMatch(
  mobileDetail,
  /"aria-hidden"\s*,\s*"true"/,
  "hiding the source from the accessibility tree must not erase it from alert counting"
);

assert.match(
  mobileDetail,
  /main-floating-notification-dock__detail-action/
);

assert.match(
  mobileDetail,
  /document\.createElement\(\s*"section"\s*\)/,
  "mobile preview must project each source into a compact section"
);

for (
  const className of [
    "main-floating-notification-dock__source-group",
    "main-floating-notification-dock__source-header",
    "main-floating-notification-dock__source-title",
    "main-floating-notification-dock__source-count",
    "main-floating-notification-dock__source-rows"
  ]
) {
  assert.match(
    mobileDetail,
    new RegExp(className)
  );
}

assert.match(
  mobileDetail,
  /mainNotificationRailDetail-\$\{definition\.id\}/,
  "each source must own a stable detail button"
);

assert.match(
  mobileDetail,
  /mainFloatingDetailSource/
);

assert.match(
  mobileDetail,
  /document\.createElement\(\s*"button"\s*\)/
);

assert.match(
  mobileDetail,
  /action\.type\s*=\s*"button"/
);

assert.match(
  mobileDetail,
  /"상세보기 ›"/
);

assert.match(
  mobileDetail,
  /event\.stopPropagation\(\)/
);

assert.match(
  mobileDetail,
  /source\.insertAdjacentElement\(\s*"afterend"\s*,\s*group\s*\)/,
  "the compact source group must follow its original data source"
);

assert.match(
  mobileDetail,
  /groupHeader\?\.appendChild\(\s*action\s*\)/,
  "the detail action must stay inline inside the compact source header"
);

assert.match(
  mobileDetail,
  /setHidden\(\s*action\s*,\s*!sourceIsVisible\s*\)/,
  "a hidden source must not leave an orphan detail action"
);

assert.match(
  mobileDetail,
  /setHidden\(\s*group\s*,\s*!sourceIsVisible\s*\)/,
  "a hidden source must also hide its compact source group"
);

const mobileRows =
  extractFunction(
    dockScript,
    "getMobileSourceRows"
  );

assert.match(
  mobileRows,
  /const normalizePreviewText/
);

assert.doesNotMatch(
  mobileRows,
  /normalizeIdentityText/,
  "display rows must preserve percentage and remaining-time numbers"
);

assert.match(
  mobileRows,
  /blower-history-main-alert__preview-item/
);

assert.match(
  mobileRows,
  /\.forEach\(/
);

assert.doesNotMatch(
  mobileRows,
  /\.slice\(/,
  "the compact projection must keep every Blower preview supplied by the API"
);

assert.match(
  mobileRows,
  /\.split\(\s*\/\\s\*·\\s\*\//,
  "ARM ROLL BOX summaries must split into individual flat rows"
);

assert.match(
  mobileRows,
  /\(\.\*\?BOX\)[\s\S]{0,120}?요청\\s\*필요/
);

const mobileGroupSync =
  extractFunction(
    dockScript,
    "syncMobileSourceGroup"
  );

for (
  const className of [
    "main-floating-notification-dock__source-row",
    "main-floating-notification-dock__source-row-title",
    "main-floating-notification-dock__source-row-meta"
  ]
) {
  assert.match(
    mobileGroupSync,
    new RegExp(className)
  );
}

assert.match(
  mobileGroupSync,
  /mainFloatingRowsSignature/
);

assert.match(
  mobileGroupSync,
  /rowsNode\?\.replaceChildren\(\s*fragment\s*\)/,
  "projection rows must update only through the signature-guarded fragment"
);

const openMobileDetail =
  extractFunction(
    dockScript,
    "openMobileDetail"
  );

assert.match(
  openMobileDetail,
  /detailType\s*===\s*"arm-roll-box"/
);

assert.match(
  openMobileDetail,
  /openEfficiencyTeamModal/
);

assert.match(
  openMobileDetail,
  /switchEfficiencyTeamView\(\s*"arm-roll"\s*\)/
);

assert.match(
  openMobileDetail,
  /"\/maintenance\/blower-history"/
);

assert.match(
  openMobileDetail,
  /GSShiftLogNavigation[\s\S]*?\.navigate/
);

assert.match(
  openMobileDetail,
  /window\.location\.assign/
);


const dockSummary =
  extractFunction(
    dockScript,
    "createDockSummary"
  );

assert.match(
  dockSummary,
  /main-floating-notification-dock__summary-mark/
);

assert.match(
  dockSummary,
  />!<\/span>/
);

assert.match(
  dockSummary,
  /mainNotificationRailSummaryCount/
);

assert.match(
  dockSummary,
  /"aria-expanded"\s*,\s*"false"/
);

const badgeFormatterSource =
  extractFunction(
    dockScript,
    "formatBadgeCount"
  );

const formatBadgeCount =
  Function(
    `return (${badgeFormatterSource});`
  )();

assert.equal(
  formatBadgeCount(99),
  "99"
);

assert.equal(
  formatBadgeCount(100),
  "99+"
);

const dockHeader =
  extractFunction(
    dockScript,
    "createDockHeader"
  );

assert.match(
  dockHeader,
  /main-floating-notification-dock__controls/
);

assert.ok(
  dockHeader.indexOf(
    "mainNotificationRailCollapse"
  ) <
    dockHeader.indexOf(
      "mainNotificationRailClose"
    ),
  "collapse must sit immediately before close in the expanded header"
);

assert.match(
  dockHeader,
  />접기<\/button>/
);

assert.match(
  dockScript,
  /mobileNotificationCenter/
);

assert.doesNotMatch(
  dockScript,
  /mobileBlowerOnly|Blower 알림 \$\{total\}|Blower 알림이/
);

assert.match(
  dockScript,
  /event\.key\s*!==\s*"Escape"/
);

assert.match(
  dockScript,
  /rail\.contains\(\s*target\s*\)/,
  "tapping outside the expanded preview must collapse it"
);

assert.match(
  dockScript,
  /rail[\s\S]{0,120}?\.querySelector\(\s*":scope > \.main-floating-notification-dock__header"\s*\)[\s\S]{0,100}?\.focus/,
  "opening the preview must focus the neutral header instead of drawing a blue detail-button outline"
);

const bindingStart =
  dockScript.indexOf(
    ".mainFloatingNotificationBound"
  );

const collapseHandlerStart =
  dockScript.indexOf(
    '"mainNotificationRailCollapse"',
    bindingStart
  );

const closeHandlerStart =
  dockScript.indexOf(
    '"mainNotificationRailClose"',
    collapseHandlerStart
  );

const collapseHandler =
  dockScript.slice(
    collapseHandlerStart,
    closeHandlerStart
  );

assert.match(
  collapseHandler,
  /mobileExpanded\s*=\s*false/
);

assert.match(
  collapseHandler,
  /summary\.focus/
);

assert.doesNotMatch(
  collapseHandler,
  /dismissedSignature/
);

const closeHandlerEnd =
  dockScript.indexOf(
    "summary.addEventListener",
    closeHandlerStart
  );

const closeHandler =
  dockScript.slice(
    closeHandlerStart,
    closeHandlerEnd
  );

assert.match(
  closeHandler,
  /mobileExpanded\s*=\s*false/
);

assert.ok(
  closeHandler.indexOf(
    "mobileExpanded"
  ) <
    closeHandler.indexOf(
      "dismissedSignature"
    ),
  "closing the alert must also reset preview expansion"
);

const readiness =
  extractFunction(
    dockScript,
    "isMobileArmRollBoxRefreshReady"
  );

assert.match(
  readiness,
  /refreshArmRollBoxDashboard/
);

assert.match(
  readiness,
  /appShell[\s\S]*?loadCurrentUser[\s\S]*?getShiftLogSessionToken/
);

assert.match(
  readiness,
  /armRollBoxStartDate[\s\S]*?armRollBoxEndDate/
);

const armRefresh =
  extractFunction(
    dockScript,
    "runMobileArmRollBoxAlertRefresh"
  );

assert.match(
  armRefresh,
  /mobileArmRollBoxRefreshAttempts\s*>=\s*120/
);

assert.match(
  armRefresh,
  /requestIdleCallback/
);

assert.match(
  armRefresh,
  /timeout:\s*3500/
);

assert.match(
  armRefresh,
  /refreshArmRollBoxDashboard\(\)/
);

assert.match(
  armRefresh,
  /\.catch[\s\S]*?\.finally[\s\S]*?scheduleSync\(\)/
);

const startDock =
  extractFunction(
    dockScript,
    "start"
  );

assert.match(
  startDock,
  /scheduleMobileArmRollBoxAlertRefresh\(\)/
);

const scheduleArmRefresh =
  extractFunction(
    dockScript,
    "scheduleMobileArmRollBoxAlertRefresh"
  );

assert.match(
  scheduleArmRefresh,
  /!isMobileDockMode\(\)/
);

assert.match(
  scheduleArmRefresh,
  /mobileArmRollBoxRefreshState\s*!==\s*"idle"[\s\S]*?mobileArmRollBoxRefreshTimer/
);

assert.match(
  scheduleArmRefresh,
  /setTimeout\(\s*runMobileArmRollBoxAlertRefresh\s*,\s*800\s*\)/
);


const mobileStyle =
  dockStyle.slice(
    dockStyle.lastIndexOf(
      "MOBILE NOTIFICATION CENTER V1.2"
    )
  );

assert.ok(
  mobileStyle.length > 0,
  "mobile notification center V1.2 style marker must exist"
);

assert.match(
  mobileStyle,
  /html\.main-floating-notification-mobile-client/
);

assert.match(
  dockStyle,
  /inset:\s*auto[\s\S]{0,180}?auto\s*!important/,
  "mobile alert must be anchored at the lower-right instead of spanning both edges"
);

assert.match(
  mobileStyle,
  /width:\s*min\(132px,\s*calc\(100dvw\s*-\s*24px\)\)[\s\S]{0,100}?max-height:\s*52px/
);

assert.match(
  mobileStyle,
  /data-mobile-expanded="true"\][\s\S]{0,180}?width:\s*min\(304px/
);

assert.match(
  mobileStyle,
  /data-mobile-expanded="false"\][\s\S]{0,240}?main-floating-notification-dock__header,[\s\S]{0,240}?main-floating-notification-dock__list[\s\S]{0,80}?display:\s*none\s*!important/
);

assert.match(
  mobileStyle,
  /data-mobile-expanded="false"\][\s\S]{0,220}?main-floating-notification-dock__summary[\s\S]{0,160}?display:\s*grid\s*!important/
);

assert.match(
  mobileStyle,
  /data-mobile-expanded="false"\][\s\S]{0,380}?main-floating-notification-dock__summary[\s\S]{0,260}?min-height:\s*44px\s*!important/
);

assert.match(
  mobileStyle,
  /main-floating-notification-dock__summary-mark[\s\S]{0,300}?display:\s*inline-flex\s*!important/
);

assert.match(
  mobileStyle,
  /main-floating-notification-dock__summary-count[\s\S]{0,300}?display:\s*inline-flex\s*!important/
);

assert.match(
  mobileStyle,
  /main-floating-notification-dock__collapse,[\s\S]{0,180}?main-floating-notification-dock__close[\s\S]{0,420}?width:\s*40px\s*!important[\s\S]{0,160}?height:\s*40px\s*!important[\s\S]{0,160}?border:\s*0\s*!important[\s\S]{0,160}?background:\s*transparent\s*!important/
);

assert.match(
  mobileStyle,
  /data-mobile-expanded="true"\][\s\S]{0,220}?main-floating-notification-dock__list[\s\S]{0,260}?max-height:\s*min\(43dvh,\s*318px\)\s*!important[\s\S]{0,220}?overflow-y:\s*auto\s*!important[\s\S]{0,160}?overscroll-behavior:\s*contain\s*!important[\s\S]{0,160}?-webkit-overflow-scrolling:\s*touch\s*!important/
);

assert.match(
  mobileStyle,
  /#mainNotificationRail\.main-floating-notification-dock\[data-mobile-notification-center="true"\][\s\S]{0,140}?#mainNotificationRailList[\s\S]{0,80}?>\s*#blowerHistoryMainAlert,[\s\S]{0,240}?data-mobile-notification-center="true"[\s\S]{0,140}?>\s*#armRollBoxMainAlert,[\s\S]{0,240}?data-mobile-notification-center="true"[\s\S]{0,140}?>\s*#bedAshDischargeMainAlert[\s\S]{0,100}?display:\s*none\s*!important/,
  "mobile must use a stronger rail-scoped rule to hide the original nested cards and keep Bed Ash excluded"
);

for (
  const className of [
    "main-floating-notification-dock__source-group",
    "main-floating-notification-dock__source-header",
    "main-floating-notification-dock__source-title",
    "main-floating-notification-dock__source-count",
    "main-floating-notification-dock__source-rows",
    "main-floating-notification-dock__source-row",
    "main-floating-notification-dock__source-row-title",
    "main-floating-notification-dock__source-row-meta"
  ]
) {
  assert.match(
    mobileStyle,
    new RegExp(className)
  );
}

assert.match(
  mobileStyle,
  /main-floating-notification-dock__source-group[\s\S]{0,320}?border:\s*0\s*!important[\s\S]{0,180}?border-top:\s*1px[\s\S]{0,180}?border-radius:\s*0\s*!important[\s\S]{0,160}?background:\s*transparent\s*!important/,
  "source groups must use one divider instead of another rounded card"
);

assert.match(
  mobileStyle,
  /main-floating-notification-dock__source-header[\s\S]{0,180}?main-floating-notification-dock__detail-action[\s\S]{0,300}?width:\s*auto\s*!important[\s\S]{0,180}?min-height:\s*36px\s*!important[\s\S]{0,180}?border:\s*0\s*!important[\s\S]{0,180}?border-radius:\s*0\s*!important[\s\S]{0,180}?background:\s*transparent\s*!important/,
  "detail navigation must be a small inline text action"
);

assert.match(
  mobileStyle,
  /data-mobile-expanded="true"\][\s\S]{0,420}?background:\s*rgba\(248,\s*250,\s*253,\s*0\.34\)\s*!important/,
  "expanded mobile notification center must use the lighter translucent surface"
);

assert.match(
  mobileStyle,
  /main-floating-notification-dock__source-row-title\s*\{[\s\S]{0,300}?-webkit-line-clamp:\s*2\s*!important[\s\S]{0,180}?white-space:\s*normal\s*!important/,
  "long Blower names must retain enough room to distinguish their suffixes"
);

assert.match(
  mobileStyle,
  /main-floating-notification-dock__source-row\s*\{[\s\S]{0,520}?border:\s*0\s*!important[\s\S]{0,180}?border-top:\s*1px[\s\S]{0,180}?border-radius:\s*0\s*!important[\s\S]{0,160}?background:\s*transparent\s*!important/,
  "individual notifications must be flat rows separated by one line"
);

assert.doesNotMatch(
  mobileStyle,
  /main-floating-notification-dock__detail-action\s*\{[\s\S]{0,220}?min-height:\s*44px/,
  "V1.2 must not restore the large full-width detail buttons"
);

assert.match(
  dockStyle,
  /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]{0,420}?transition:\s*none\s*!important/
);


assert.match(
  blowerSource,
  /BLOWER_HISTORY_URL\s*=\s*"\/maintenance\/blower-history"/
);

assert.match(
  blowerSource,
  /BLOWER_HISTORY_API_URL\s*=\s*"\/api\/blower-history\?action=summary"/
);

assert.match(
  blowerSource,
  /id\s*=\s*"blowerHistoryMainAlert"/
);

assert.match(
  blowerSource,
  /id="blowerHistoryMainAlertCount"/
);

const blowerPreview =
  extractFunction(
    blowerSource,
    "renderMainAlertPreviewItems"
  );

assert.match(
  blowerPreview,
  /blower-history-main-alert__preview-list/
);

assert.match(
  blowerPreview,
  /"role"\s*,\s*"list"/
);

assert.match(
  blowerPreview,
  /\?\s*summary\.alerts\s*:\s*\[\]/
);

assert.doesNotMatch(
  blowerPreview,
  /\.slice\(/,
  "the preview must render every alert supplied by the summary API"
);

assert.match(
  blowerPreview,
  /alerts\.forEach/
);

assert.match(
  blowerPreview,
  /"role"\s*,\s*"listitem"/
);

assert.match(
  blowerPreview,
  /displayName/
);

assert.match(
  blowerPreview,
  /getSeverityLabel/
);

assert.match(
  blowerPreview,
  /formatRemaining/
);

assert.match(
  blowerPreview,
  /total\s*>\s*alerts\.length/
);

assert.match(
  blowerPreview,
  /preview-remainder/
);

assert.match(
  blowerPreview,
  /외 \$\{total - alerts\.length\}건은 상세보기에서 확인/
);

const blowerRenderSummary =
  extractFunction(
    blowerSource,
    "renderSummary"
  );

assert.match(
  blowerRenderSummary,
  /renderMainAlertPreviewItems\(alertButton,\s*summary\)/
);

assert.match(
  dockStyle,
  /MAIN FLOATING NOTIFICATION DOCK V3/
);

assert.match(
  dockStyle,
  /MOBILE NOTIFICATION CENTER V1\.2/
);

assert.match(
  dockStyle,
  /#mainNotificationRail\.main-floating-notification-dock\s*\{[\s\S]{0,1200}?background:\s*rgba\(248, 250, 253, 0\.44\)\s*!important/
);

assert.match(
  dockStyle,
  /> \.blower-history-main-alert\s*\{[\s\S]{0,240}?background:\s*rgba\(255, 241, 243, 0\.20\)\s*!important/
);

assert.match(
  dockStyle,
  /> \.arm-roll-box-main-alert\s*\{[\s\S]{0,240}?background:\s*rgba\(255, 248, 232, 0\.22\)\s*!important/
);

assert.match(
  dockStyle,
  /MOBILE NOTIFICATION CENTER V1\.2[\s\S]{0,900}?background:\s*rgba\(248, 250, 253, 0\.24\)\s*!important/
);

assert.match(
  dockStyle,
  /> #blowerHistoryMainAlert:not\(\[hidden\]\)\s*\{[\s\S]{0,360}?background:\s*rgba\(255, 241, 243, 0\.20\)\s*!important/
);


console.log(
  "Mobile notification center integration verification passed."
);
