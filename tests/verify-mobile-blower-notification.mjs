import assert from "node:assert/strict";
import { readFileSync } from "node:fs";


const read = path => readFileSync(path, "utf8");

const CACHE_KEY =
  "20260902-mobile-blower-preview-v1";


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
  /maintenance\/mobile-blower-main-alert\.js/
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


const activeSources =
  extractFunction(
    dockScript,
    "getActiveSourceDefinitions"
  );

assert.match(
  activeSources,
  /return\s+SOURCE_DEFINITIONS;/,
  "PC must keep all existing alert sources"
);

assert.match(
  activeSources,
  /definition\.id\s*===\s*MOBILE_SOURCE_ID/,
  "mobile must count only the Blower source"
);

assert.match(
  dockScript,
  /const MOBILE_SOURCE_ID\s*=\s*"blowerHistoryMainAlert"/
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
  /definition\.id\s*!==\s*MOBILE_SOURCE_ID/
);

assert.match(
  mobileDetail,
  /const shouldShow\s*=\s*isMobileDockMode\(\)/
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
  /document\.createElement\(\s*"button"\s*\)/
);

assert.match(
  mobileDetail,
  /action\.type\s*=\s*"button"/
);

assert.match(
  mobileDetail,
  /"상세보기"/
);

assert.match(
  mobileDetail,
  /"\/maintenance\/blower-history"/
);

assert.match(
  mobileDetail,
  /GSShiftLogNavigation[\s\S]*?\.navigate/
);

assert.match(
  mobileDetail,
  /window\.location\.assign/
);

assert.match(
  mobileDetail,
  /event\.stopPropagation\(\)/
);

assert.match(
  mobileDetail,
  /source\.insertAdjacentElement\(\s*"afterend"\s*,\s*action\s*\)/,
  "the explicit detail action must follow the inert preview source"
);


assert.match(
  dockScript,
  /isMobile\s*\?\s*"미리보기"\s*:\s*"보기"/
);

assert.match(
  dockScript,
  /isMobile\s*\?\s*"Blower 알림"\s*:\s*"운영 알림"/
);

assert.match(
  dockScript,
  /isMobile\s*\?\s*"Blower 알림 닫기"\s*:\s*"운영 알림 닫기"/
);

assert.match(
  dockScript,
  /mobileBlowerOnly/
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

const closeHandlerStart =
  dockScript.indexOf(
    '"mainNotificationRailClose"'
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


const mobileStyle =
  dockStyle.slice(
    dockStyle.indexOf(
      "MOBILE BLOWER NOTIFICATION PREVIEW V1"
    )
  );

assert.ok(
  mobileStyle.length > 0,
  "mobile Blower notification style marker must exist"
);

assert.match(
  mobileStyle,
  /html\.main-floating-notification-mobile-client/
);

assert.match(
  mobileStyle,
  /inset:\s*auto[\s\S]{0,180}?auto\s*!important/,
  "mobile alert must be anchored at the lower-right instead of spanning both edges"
);

assert.match(
  mobileStyle,
  /width:\s*min\(190px,\s*calc\(100dvw\s*-\s*24px\)\)/
);

assert.match(
  mobileStyle,
  /data-mobile-expanded="true"\][\s\S]{0,180}?width:\s*min\(310px/
);

assert.match(
  mobileStyle,
  /data-mobile-expanded="false"\][\s\S]{0,180}?\.main-floating-notification-dock__summary[\s\S]{0,160}?min-height:\s*32px/
);

assert.match(
  mobileStyle,
  /data-mobile-expanded="true"\][\s\S]{0,200}?\.main-floating-notification-dock__list[\s\S]{0,160}?max-height:\s*178px/
);

assert.match(
  mobileStyle,
  /background:\s*rgba\(248,\s*250,\s*253,\s*0\.34\)/
);

assert.match(
  mobileStyle,
  /data-mobile-expanded="true"\][\s\S]{0,220}?background:\s*rgba\(248,\s*250,\s*253,\s*0\.42\)/
);

assert.match(
  mobileStyle,
  />\s*#bedAshDischargeMainAlert,[\s\S]{0,180}?display:\s*none\s*!important/
);

assert.match(
  mobileStyle,
  />\s*#armRollBoxMainAlert[\s\S]{0,220}?display:\s*none\s*!important/
);

assert.match(
  mobileStyle,
  />\s*#blowerHistoryMainAlert:not\(\[hidden\]\)[\s\S]{0,500}?pointer-events:\s*none\s*!important/
);

assert.match(
  mobileStyle,
  /main-floating-notification-dock__detail-action[\s\S]{0,260}?width:\s*100%\s*!important[\s\S]{0,180}?min-height:\s*40px\s*!important/
);

assert.match(
  mobileStyle,
  /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]{0,360}?transition:\s*none\s*!important/
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


console.log(
  "Mobile Blower notification integration verification passed."
);
