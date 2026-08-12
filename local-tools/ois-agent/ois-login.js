"use strict";


const fs =
  require(
    "node:fs"
  );

const {
  spawn
} =
  require(
    "node:child_process"
  );



const path =
  require(
    "node:path"
  );


const {
  chromium
} =
  require(
    "playwright"
  );

/* =========================================================
  OIS 에이전트 로컬 환경변수 자동 로딩

  대응:
  - UTF-8 BOM 제거
  - KEY 앞뒤 공백 제거
  - 따옴표 제거
  - 필수 설정 누락 확인
  - 비밀번호 실제 값은 로그에 출력하지 않음
========================================================= */

function loadOisAgentLocalEnvironment() {
  const environmentFilePath =
    path.join(
      __dirname,
      ".env"
    );


  if (
    !fs.existsSync(
      environmentFilePath
    )
  ) {
    throw new Error(
      `.env 파일을 찾지 못했습니다: ${environmentFilePath}`
    );
  }


  let environmentText =
    fs.readFileSync(
      environmentFilePath,
      "utf8"
    );


  /*
    메모장에서 UTF-8로 저장할 때
    파일 첫 부분에 붙을 수 있는 BOM을 제거한다.
  */
  environmentText =
    environmentText.replace(
      /^\uFEFF/,
      ""
    );


  const loadedKeys = [];


  environmentText
    .split(
      /\r?\n/
    )
    .forEach(
      rawLine => {
        let line =
          String(
            rawLine ||
            ""
          )
            .replace(
              /^\uFEFF/,
              ""
            )
            .trim();


        if (
          !line ||
          line.startsWith(
            "#"
          )
        ) {
          return;
        }


        /*
          export OIS_ID=...
          형태로 적혀 있어도 허용한다.
        */
        line =
          line.replace(
            /^export\s+/i,
            ""
          );


        const equalIndex =
          line.indexOf(
            "="
          );


        if (
          equalIndex <=
          0
        ) {
          return;
        }


        const key =
          line
            .slice(
              0,
              equalIndex
            )
            .replace(
              /^\uFEFF/,
              ""
            )
            .trim();


        let value =
          line
            .slice(
              equalIndex + 1
            )
            .trim();


        if (
          !/^[A-Za-z_][A-Za-z0-9_]*$/.test(
            key
          )
        ) {
          console.warn(
            `올바르지 않은 .env 설정 이름을 건너뜁니다: ${key}`
          );


          return;
        }


        /*
          "값" 또는 '값'의 양쪽 따옴표 제거
        */
        if (
          (
            value.startsWith(
              '"'
            ) &&
            value.endsWith(
              '"'
            )
          ) ||
          (
            value.startsWith(
              "'"
            ) &&
            value.endsWith(
              "'"
            )
          )
        ) {
          value =
            value.slice(
              1,
              -1
            );
        }


        if (
          !process.env[
            key
          ]
        ) {
          process.env[
            key
          ] =
            value;
        }


        loadedKeys.push(
          key
        );
      }
    );


  /*
    Excel 전용 요청은 OIS 로그인이 필요하지 않다.

    프로그램 시작과 요청 대기에는 에이전트 인증키만
    필수로 사용하고, OIS 계정은 실제 OIS 요청이
    들어왔을 때 별도로 확인한다.
  */

  const requiredKeys = [
    "OIS_AGENT_KEY"
  ];


  const missingKeys =
    requiredKeys.filter(
      key => {
        return !String(
          process.env[
            key
          ] ||
          ""
        ).trim();
      }
    );


  if (
    missingKeys.length >
      0
  ) {
    throw new Error(
      [
        ".env 필수 설정이 비어 있습니다.",
        `누락 항목: ${missingKeys.join(", ")}`,
        `파일 위치: ${environmentFilePath}`
      ].join(
        "\n"
      )
    );
  }


  console.log(
    "OIS 에이전트 로컬 설정을 불러왔습니다."
  );


  console.log(
    "확인된 설정:",
    loadedKeys.join(
      ", "
    )
  );
}


loadOisAgentLocalEnvironment();

const DEFAULT_SHIFT_LOG_BASE_URL =
  "https://gs-shift-log.pages.dev";


const OIS_LOGIN_URL =
  "http://ois.gspoge.com/jsp/login/index";


const OIS_REQUEST_API_PATH =
  "/api/ois-data-requests";


const OIS_AGENT_POLL_INTERVAL =
  5000;


const OIS_AGENT_ERROR_RETRY_INTERVAL =
  10000;


const OIS_QUERY_TIMEOUT =
  30000;


const OIS_SESSION_FILE_PATH =
  path.join(
    process.cwd(),
    "ois-session.json"
  );


const OIS_UNIT_DEFINITIONS = [
  {
    unit:
      1,

    sheetLabel:
      "BOARD LOGSHEET (BCO1)",

    tag:
      "103HRJ01CW201XQ01"
  },

  {
    unit:
      2,

    sheetLabel:
      "BOARD LOGSHEET (BCO2)",

    tag:
      "203HRJ01CW201XQ01"
  }
];

/* =========================================================
  오전회의 증기생산량 조회 정의

  - 1호기: BOARD LOGSHEET (BCO1)
  - 2호기: BOARD LOGSHEET (BCO2)
  - MAIN STM FLOW 01~24시 합산
========================================================= */

const OIS_STEAM_PRODUCTION_DEFINITIONS = [
  {
    unit: 1,
    resultKey: "unitOne",
    sheetLabel: "BOARD LOGSHEET (BCO1)",
    tag: "106LBA01CF901-CAL"
  },
  {
    unit: 2,
    resultKey: "unitTwo",
    sheetLabel: "BOARD LOGSHEET (BCO2)",
    tag: "206LBA01CF901-CAL"
  }
];

/* =========================================================
  부재료 일별 조회 정의

  1호기: BOARD LOGSHEET (BCO1)
  2호기: BOARD LOGSHEET (BCO2)

  시간별 01~24 값을 평균하여 저장한다.
========================================================= */

const OIS_AUXILIARY_MATERIAL_DEFINITIONS = [
  {
    unit:
      1,

    sheetLabel:
      "BOARD LOGSHEET (BCO1)",

    tags: {
      limestone:
        "103HRJ01CW201XQ01",

      limeSlurryA:
        "104HT21CF201XQ31",

      limeSlurryB:
        "104HT22CF201XQ31",

      limeSlurryC:
        "104HT23CF201XQ31",

      limeSlurryDensity:
        "104HT10CD001XQ31",

      ammonia:
        "104HS01CF201XQ31",

      sox:
        "104HNE10CQ202XJ41",

      nox:
        "104HNE10CQ203XJ41"
    }
  },

  {
    unit:
      2,

    sheetLabel:
      "BOARD LOGSHEET (BCO2)",

    tags: {
      limestone:
        "203HRJ01CW201XQ01",

      limeSlurryA:
        "204HT21CF201XQ31",

      limeSlurryB:
        "204HT22CF201XQ31",

      limeSlurryC:
        "204HT23CF201XQ31",

      limeSlurryDensity:
        "204HT10CD001XQ31",

      ammonia:
        "204HS01CF201XQ31",

      sox:
        "204HNE10CQ202XJ41",

      nox:
        "204HNE10CQ203XJ41"
    }
  }
];


/* =========================================================
  터빈 Gear Wheel / Pinion 조회 정의

  BOARD LOGSHEET (TGO)의 전일 값:
  decimal_pnt
========================================================= */

const OIS_TURBINE_GEAR_PINION_DEFINITION = {
  sheetLabel:
    "BOARD LOGSHEET (TGO)",

  valueField:
    "decimal_pnt",

  gearWheel: {
    label:
      "Gear Wheel",

    tag:
      "MAD11FG905-ZE01_V2"
  },

  pinion: {
    label:
      "Pinion",

    tag:
      "MAD41FY905-ZE01_V2"
  }
};

/* =========================================================
  오전회의 Silo Level 조회 정의

  회의자료 기준:
  예) 2026-08-08 회의자료
      → targetDate = 2026-08-07
      → 2026-08-07 24시 값 사용

  조회 화면:
  운영정보
  → LOG SHEET
  → TAG별 LOG 조회

  대상:
  - Fly Ash Silo Level
    003ETH01CW201XQ01

  - Bio Storage Silo Level
    EBF20CW201
========================================================= */

const OIS_SILO_LEVEL_DEFINITIONS = [
  {
    resultKey:
      "flyAsh",

    label:
      "Fly Ash Silo Level",

    tag:
      "003ETH01CW201XQ01"
  },

  {
    resultKey:
      "bioStorage",

    label:
      "Bio Storage Silo Level",

    tag:
      "EBF20CW201"
  }
];

/* =========================================================
  오전회의 월간 일일DATA관리 Excel 조회 정의

  대상 통합문서:
  - 조회 대상일 기준 yy.MM-일일DATA관리.xlsx
  - Plant!F4 = yyyy년 MM월
  - Plant!F5:AJ5 = 1~31일

  수기·계산 완료값:
  - 1·2호기 증기생산량
  - 태양광 일일 발전량
  - 발전량 / 수전량 / 송전량
  - 저압·고압 증기 판매량
  - 하수슬러지 1~10번째 입고량

  DataPARC 자동값:
  - 유기성 Day Silo
  - 유기성 Storage Silo A
  - 유기성 Storage Silo B

  기존 steam_status 요청형과 호환 필드를 유지한다.
========================================================= */

const DAILY_DATA_WORKBOOK_FIELD_DEFINITIONS = [
  {
    resultKey:
      "unitOneProduction",

    label:
      "#1 CFBC BLR(Totalizer)",

    row:
      51,

    unit:
      "ton"
  },

  {
    resultKey:
      "unitTwoProduction",

    label:
      "#2 CFBC BLR(Totalizer)",

    row:
      52,

    unit:
      "ton"
  },

  {
    resultKey:
      "solarDailyGeneration",

    label:
      "태양광 일일 발전량",

    row:
      55,

    unit:
      "kWh"
  },

  {
    resultKey:
      "generatorEcmsGen1",

    label:
      "발전량 (Generator) / ECMS gen1",

    row:
      56,

    unit:
      "kWh"
  },

  {
    resultKey:
      "ismartReception",

    label:
      "수전량 (I-Smart)",

    row:
      58,

    unit:
      "kWh"
  },

  {
    resultKey:
      "epowerTransmission",

    label:
      "송전량 (ePower)",

    row:
      63,

    unit:
      "kWh"
  },

  {
    resultKey:
      "steamSalesLowPressure",

    label:
      "저압증기(Totalizer) * Aux BLR로 STM Service시 Aux BLR Data 이용",

    row:
      72,

    unit:
      "ton"
  },

  {
    resultKey:
      "steamSalesHighPressure",

    label:
      "고압증기",

    row:
      73,

    unit:
      "ton"
  }
];


const DAILY_DATA_WORKBOOK_SLUDGE_DEFINITIONS =
  Array.from(
    {
      length:
        10
    },

    (
      unusedValue,
      index
    ) => {
      const sequence =
        index +
        1;


      return {
        sequence,

        row:
          287 +
          sequence,

        label:
          `${sequence}번째 입고량`
      };
    }
  );


const DAILY_DATA_WORKBOOK_ORGANIC_SILO_DEFINITIONS = [
  {
    resultKey:
      "organicDaySilo",

    label:
      "Day Silo 재고량",

    row:
      286,

    tag:
      "GSPOGE.ABB_DCS.104SDF01CW001XQ01/PLOT"
  },

  {
    resultKey:
      "organicStorageSiloA",

    label:
      "Storage Silo A 재고량",

    row:
      284,

    tag:
      "GSPOGE.ABB_DCS.003SDF01CW001XQ01/PLOT"
  },

  {
    resultKey:
      "organicStorageSiloB",

    label:
      "Storage Silo B 재고량",

    row:
      285,

    tag:
      "GSPOGE.ABB_DCS.003SDF02CW001XQ01/PLOT"
  }
];


const DAILY_DATA_WORKBOOK_RESULT_MARKER =
  "__DAILY_DATA_WORKBOOK_RESULT__";


const DAILY_DATA_WORKBOOK_STAGE_MARKER =
  "__DAILY_DATA_WORKBOOK_STAGE__";


const DAILY_DATA_WORKBOOK_PROCESS_TIMEOUT =
  45000;


/*
  기존 검증 완료된 PowerShell 실행기의 내부 이름을
  1단계에서 그대로 재사용하기 위한 호환 별칭이다.
*/

const DATAPARC_STEAM_RESULT_MARKER =
  DAILY_DATA_WORKBOOK_RESULT_MARKER;


const DATAPARC_STEAM_STAGE_MARKER =
  DAILY_DATA_WORKBOOK_STAGE_MARKER;


const DATAPARC_STEAM_PROCESS_TIMEOUT =
  DAILY_DATA_WORKBOOK_PROCESS_TIMEOUT;

/* =========================================================
  DataPARC Tag Browser 통신 진단

  실행 방법:
  $env:DATAPARC_TAG_BROWSER_TRACE = "1"
  node --use-system-ca ".\\local-tools\\ois-agent\\ois-login.js"

  진단 목적:
  - Excel / DataPARC 추가 기능을 사용하지 않는다.
  - 보이는 Edge에서 Tag Browser 조회를 사용자가 한 번 실행한다.
  - 그때 발생한 HTTP 요청·응답과 WebSocket 프레임을 JSONL로 기록한다.
  - Cookie, Authorization, 비밀번호, 토큰 등 민감정보는 기록 전에 제거한다.

  주의:
  - 진단 모드에서는 기존 OIS 요청 폴링을 시작하지 않는다.
  - Cloudflare 또는 업무일지 코드는 변경하지 않는다.
========================================================= */

const DATAPARC_TAG_BROWSER_TRACE_ENV =
  "DATAPARC_TAG_BROWSER_TRACE";


const DATAPARC_TAG_BROWSER_URL =
  process.env.DATAPARC_TAG_BROWSER_URL ||
  "http://dp.gspoge.com";


const DATAPARC_TRACE_BODY_LIMIT =
  512 *
  1024;


const DATAPARC_TRACE_SENSITIVE_KEY_PATTERN =
  /(?:authorization|proxy-authorization|cookie|set-cookie|pass(?:word)?|passwd|pwd|secret|token|jwt|credential|client[_-]?secret|session(?:id)?|jsessionid|ticket|sso)/i;


function isDataParcTagBrowserTraceEnabled() {
  return [
    "1",
    "true",
    "yes",
    "on"
  ].includes(
    String(
      process.env[
        DATAPARC_TAG_BROWSER_TRACE_ENV
      ] ||
      ""
    )
      .trim()
      .toLowerCase()
  );
}


function isDataParcTraceSensitiveKey(
  key
) {
  return DATAPARC_TRACE_SENSITIVE_KEY_PATTERN.test(
    String(
      key ||
      ""
    )
  );
}


function sanitizeDataParcTraceValue(
  value,
  key =
    "",
  depth =
    0
) {
  if (
    isDataParcTraceSensitiveKey(
      key
    )
  ) {
    return "[REDACTED]";
  }


  if (
    depth >
      12
  ) {
    return "[MAX_DEPTH]";
  }


  if (
    Array.isArray(
      value
    )
  ) {
    return value.map(
      item => {
        return sanitizeDataParcTraceValue(
          item,
          "",
          depth +
            1
        );
      }
    );
  }


  if (
    value &&
    typeof value ===
      "object"
  ) {
    return Object.fromEntries(
      Object.entries(
        value
      ).map(
        ([
          childKey,
          childValue
        ]) => {
          return [
            childKey,
            sanitizeDataParcTraceValue(
              childValue,
              childKey,
              depth +
                1
            )
          ];
        }
      )
    );
  }


  if (
    typeof value ===
      "string"
  ) {
    return sanitizeDataParcTraceText(
      value
    );
  }


  return value;
}


function sanitizeDataParcTraceText(
  value
) {
  return String(
    value ??
    ""
  )
    .replace(
      /((?:authorization|proxy-authorization|cookie|set-cookie|pass(?:word)?|passwd|pwd|secret|token|jwt|credential|client[_-]?secret|session(?:id)?|jsessionid|ticket|sso)\s*["']?\s*[:=]\s*["']?)([^&\s,"'<>}]+)/gi,
      "$1[REDACTED]"
    );
}


function sanitizeDataParcTraceUrl(
  rawUrl
) {
  const value =
    String(
      rawUrl ||
      ""
    );


  try {
    const parsedUrl =
      new URL(
        value
      );


    if (
      parsedUrl.username
    ) {
      parsedUrl.username =
        "[REDACTED]";
    }


    if (
      parsedUrl.password
    ) {
      parsedUrl.password =
        "[REDACTED]";
    }


    parsedUrl.pathname =
      parsedUrl.pathname.replace(
        /((?:;|\/)(?:jsessionid|sessionid|access[_-]?token|auth[_-]?token)=)[^/;]+/gi,
        "$1[REDACTED]"
      );


    for (
      const key of
      Array.from(
        parsedUrl.searchParams.keys()
      )
    ) {
      if (
        isDataParcTraceSensitiveKey(
          key
        )
      ) {
        parsedUrl.searchParams.set(
          key,
          "[REDACTED]"
        );
      }
    }


    return parsedUrl.toString();

  } catch {
    return sanitizeDataParcTraceText(
      value
    );
  }
}


function sanitizeDataParcTraceHeaders(
  headers
) {
  return Object.fromEntries(
    Object.entries(
      headers ||
      {}
    ).map(
      ([
        key,
        value
      ]) => {
        return [
          key,
          isDataParcTraceSensitiveKey(
            key
          )
            ? "[REDACTED]"
            : sanitizeDataParcTraceText(
                value
              )
        ];
      }
    )
  );
}


function sanitizeDataParcTraceBodyText(
  rawText,
  contentType =
    ""
) {
  const value =
    String(
      rawText ??
      ""
    );


  if (
    !value
  ) {
    return "";
  }


  try {
    return JSON.stringify(
      sanitizeDataParcTraceValue(
        JSON.parse(
          value
        )
      )
    );

  } catch {
    // JSON이 아닌 요청 본문은 아래 방식으로 계속 확인한다.
  }


  if (
    /x-www-form-urlencoded/i.test(
      String(
        contentType ||
        ""
      )
    )
  ) {
    try {
      const formData =
        new URLSearchParams(
          value
        );


      let fieldCount =
        0;


      for (
        const [
          key
        ] of
        formData.entries()
      ) {
        fieldCount +=
          1;


        if (
          isDataParcTraceSensitiveKey(
            key
          )
        ) {
          formData.set(
            key,
            "[REDACTED]"
          );
        }
      }


      if (
        fieldCount >
          0
      ) {
        return formData.toString();
      }

    } catch {
      // 일반 문자열로 처리한다.
    }
  }


  return sanitizeDataParcTraceText(
    value
  );
}


function buildDataParcTraceBody(
  rawBuffer,
  contentType =
    ""
) {
  if (
    !rawBuffer ||
    rawBuffer.length ===
      0
  ) {
    return null;
  }


  const truncated =
    rawBuffer.length >
      DATAPARC_TRACE_BODY_LIMIT;


  const limitedBuffer =
    rawBuffer.subarray(
      0,
      DATAPARC_TRACE_BODY_LIMIT
    );


  const isText =
    /(?:json|text|xml|html|javascript|x-www-form-urlencoded|graphql)/i.test(
      String(
        contentType ||
        ""
      )
    );


  if (
    isText
  ) {
    return {
      encoding:
        "utf8",

      value:
        sanitizeDataParcTraceBodyText(
          limitedBuffer.toString(
            "utf8"
          ),
          contentType
        ),

      byteLength:
        rawBuffer.length,

      truncated
    };
  }


  return {
    encoding:
      "base64",

    value:
      limitedBuffer.toString(
        "base64"
      ),

    byteLength:
      rawBuffer.length,

    truncated
  };
}


function buildDataParcTracePostData(
  request
) {
  const rawBuffer =
    request.postDataBuffer();


  if (
    rawBuffer ===
      null
  ) {
    return null;
  }


  const headers =
    request.headers();


  return buildDataParcTraceBody(
    rawBuffer,
    headers[
      "content-type"
    ] ||
      "text/plain"
  );
}


function readDataParcTraceResponseBody(
  response,
  timeoutMilliseconds =
    10000
) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      const timeoutId =
        setTimeout(
          () => {
            reject(
              new Error(
                `응답 본문 대기 시간이 ${timeoutMilliseconds}ms를 초과했습니다.`
              )
            );
          },
          timeoutMilliseconds
        );


      response
        .body()
        .then(
          body => {
            clearTimeout(
              timeoutId
            );


            resolve(
              body
            );
          },
          error => {
            clearTimeout(
              timeoutId
            );


            reject(
              error
            );
          }
        );
    }
  );
}


function shouldCaptureDataParcTraceRequest(
  request
) {
  return ![
    "image",
    "font",
    "media",
    "stylesheet"
  ].includes(
    request.resourceType()
  );
}


function waitForDataParcTraceEnter(
  message
) {
  console.log(
    ""
  );


  console.log(
    message
  );


  return new Promise(
    resolve => {
      process.stdin.resume();


      process.stdin.once(
        "data",
        () => {
          process.stdin.pause();


          resolve();
        }
      );
    }
  );
}


function getDataParcTraceTimestampForFile() {
  const now =
    new Date();


  const pad =
    value => {
      return String(
        value
      ).padStart(
        2,
        "0"
      );
    };


  return [
    now.getFullYear(),
    pad(
      now.getMonth() +
        1
    ),
    pad(
      now.getDate()
    ),
    "-",
    pad(
      now.getHours()
    ),
    pad(
      now.getMinutes()
    ),
    pad(
      now.getSeconds()
    )
  ].join(
    ""
  );
}


async function runDataParcTagBrowserTrace() {
  const traceFilePath =
    path.join(
      __dirname,
      `dataparc-tag-browser-trace-${getDataParcTraceTimestampForFile()}.jsonl`
    );


  let browser =
    null;


  let context =
    null;


  let recording =
    false;


  let captureStartedAt =
    0;


  let traceEntryCount =
    0;


  const pendingTasks =
    new Set();


  const attachedPages =
    new WeakSet();


  const writeTrace =
    (
      eventType,
      data =
        {}
    ) => {
      traceEntryCount +=
        1;


      const record = {
        sequence:
          traceEntryCount,

        capturedAt:
          new Date()
            .toISOString(),

        elapsedMilliseconds:
          captureStartedAt
            ? Date.now() -
              captureStartedAt
            : 0,

        eventType,

        ...data
      };


      fs.appendFileSync(
        traceFilePath,
        `${JSON.stringify(record)}\r\n`,
        "utf8"
      );
    };


  const trackTask =
    promise => {
      pendingTasks.add(
        promise
      );


      promise.then(
        () => {
          pendingTasks.delete(
            promise
          );
        },
        () => {
          pendingTasks.delete(
            promise
          );
        }
      );
    };


  const attachPageListeners =
    page => {
      if (
        attachedPages.has(
          page
        )
      ) {
        return;
      }


      attachedPages.add(
        page
      );


      page.on(
        "websocket",
        webSocket => {
          const webSocketUrl =
            sanitizeDataParcTraceUrl(
              webSocket.url()
            );


          if (
            recording
          ) {
            writeTrace(
              "websocket-open",
              {
                url:
                  webSocketUrl,

                pageUrl:
                  sanitizeDataParcTraceUrl(
                    page.url()
                  )
              }
            );


            console.log(
              "[DP TRACE] WebSocket 연결:",
              webSocketUrl
            );
          }


          const writeFrame =
            (
              direction,
              frame
            ) => {
              if (
                !recording
              ) {
                return;
              }


              const payload =
                frame?.payload;


              const isBuffer =
                Buffer.isBuffer(
                  payload
                );


              writeTrace(
                direction,
                {
                  url:
                    webSocketUrl,

                  payload: {
                    encoding:
                      isBuffer
                        ? "base64"
                        : "utf8",

                    value:
                      isBuffer
                        ? payload
                            .subarray(
                              0,
                              DATAPARC_TRACE_BODY_LIMIT
                            )
                            .toString(
                              "base64"
                            )
                        : sanitizeDataParcTraceBodyText(
                            String(
                              payload ??
                              ""
                            ).slice(
                              0,
                              DATAPARC_TRACE_BODY_LIMIT
                            )
                          ),

                    truncated:
                      isBuffer
                        ? payload.length >
                          DATAPARC_TRACE_BODY_LIMIT
                        : String(
                            payload ??
                            ""
                          ).length >
                          DATAPARC_TRACE_BODY_LIMIT
                  }
                }
              );
            };


          webSocket.on(
            "framesent",
            frame => {
              writeFrame(
                "websocket-frame-sent",
                frame
              );
            }
          );


          webSocket.on(
            "framereceived",
            frame => {
              writeFrame(
                "websocket-frame-received",
                frame
              );
            }
          );


          webSocket.on(
            "socketerror",
            error => {
              if (
                recording
              ) {
                writeTrace(
                  "websocket-error",
                  {
                    url:
                      webSocketUrl,

                    error:
                      sanitizeDataParcTraceText(
                        error
                      )
                  }
                );
              }
            }
          );


          webSocket.on(
            "close",
            () => {
              if (
                recording
              ) {
                writeTrace(
                  "websocket-close",
                  {
                    url:
                      webSocketUrl
                  }
                );
              }
            }
          );
        }
      );
    };


  try {
    console.log(
      "=========================================="
    );


    console.log(
      "DataPARC Tag Browser 통신 진단"
    );


    console.log(
      "=========================================="
    );


    console.log(
      "Excel과 DataPARC 추가 기능은 사용하지 않습니다."
    );


    console.log(
      "진단 주소:",
      DATAPARC_TAG_BROWSER_URL
    );


    browser =
      await chromium.launch({
        channel:
          "msedge",

        headless:
          false,

        slowMo:
          40
      });


    context =
      await browser.newContext({
        ignoreHTTPSErrors:
          true,

        viewport:
          null
      });


    context.on(
      "page",
      page => {
        attachPageListeners(
          page
        );
      }
    );


    context.on(
      "request",
      request => {
        if (
          !recording ||
          !shouldCaptureDataParcTraceRequest(
            request
          )
        ) {
          return;
        }


        let frameUrl =
          "";


        try {
          frameUrl =
            request.frame()
              .url();

        } catch {
          frameUrl =
            "";
        }


        const record = {
          method:
            request.method(),

          resourceType:
            request.resourceType(),

          url:
            sanitizeDataParcTraceUrl(
              request.url()
            ),

          frameUrl:
            sanitizeDataParcTraceUrl(
              frameUrl
            ),

          headers:
            sanitizeDataParcTraceHeaders(
              request.headers()
            ),

          postData:
            buildDataParcTracePostData(
              request
            )
        };


        writeTrace(
          "http-request",
          record
        );


        if (
          [
            "xhr",
            "fetch",
            "document",
            "eventsource"
          ].includes(
            record.resourceType
          )
        ) {
          console.log(
            `[DP TRACE] ${record.method} ${record.resourceType}:`,
            record.url
          );
        }
      }
    );


    context.on(
      "response",
      response => {
        if (
          !recording ||
          !shouldCaptureDataParcTraceRequest(
            response.request()
          )
        ) {
          return;
        }


        const task =
          (
            async () => {
              const request =
                response.request();


              const headers =
                await response
                  .allHeaders()
                  .catch(
                    () => response.headers()
                  );


              const contentType =
                headers[
                  "content-type"
                ] ||
                "";


              let body =
                null;


              let bodyError =
                "";


              if (
                [
                  "xhr",
                  "fetch",
                  "document",
                  "script",
                  "eventsource"
                ].includes(
                  request.resourceType()
                ) ||
                /(?:json|text|xml|javascript|octet-stream)/i.test(
                  contentType
                )
              ) {
                try {
                  body =
                    buildDataParcTraceBody(
                      await readDataParcTraceResponseBody(
                        response
                      ),
                      contentType
                    );

                } catch (
                  error
                ) {
                  bodyError =
                    String(
                      error?.message ||
                      error ||
                      ""
                    );
                }
              }


              writeTrace(
                "http-response",
                {
                  status:
                    response.status(),

                  statusText:
                    response.statusText(),

                  resourceType:
                    request.resourceType(),

                  url:
                    sanitizeDataParcTraceUrl(
                      response.url()
                    ),

                  headers:
                    sanitizeDataParcTraceHeaders(
                      headers
                    ),

                  body,

                  bodyError:
                    sanitizeDataParcTraceText(
                      bodyError
                    )
                }
              );
            }
          )();


        trackTask(
          task
        );
      }
    );


    const page =
      await context.newPage();


    attachPageListeners(
      page
    );


    await page
      .goto(
        DATAPARC_TAG_BROWSER_URL,
        {
          waitUntil:
            "domcontentloaded",

          timeout:
            30000
        }
      )
      .catch(
        error => {
          console.warn(
            "DataPARC 첫 화면 자동 열기 실패. 열린 Edge 주소창에서 직접 접속하세요:",
            error instanceof Error
              ? error.message
              : error
          );
        }
      );


    await waitForDataParcTraceEnter(
      [
        "1) 열린 Edge에서 dp.gspoge.com에 접속합니다.",
        "2) Tag Browser 화면까지만 엽니다.",
        "3) 아직 태그 선택·날짜 입력·조회는 하지 않습니다.",
        "4) 준비가 끝나면 이 PowerShell로 돌아와 Enter를 누르세요."
      ].join(
        "\n"
      )
    );


    fs.writeFileSync(
      traceFilePath,
      "",
      "utf8"
    );


    captureStartedAt =
      Date.now();


    recording =
      true;


    writeTrace(
      "capture-start",
      {
        startPageUrls:
          context.pages()
            .map(
              currentPage => {
                return sanitizeDataParcTraceUrl(
                  currentPage.url()
                );
              }
            )
      }
    );


    console.log(
      ""
    );


    console.log(
      "통신 기록을 시작했습니다. 이제 Edge에서 태그 선택부터 결과 조회까지 한 번만 진행하세요."
    );


    await waitForDataParcTraceEnter(
      [
        "Tag Browser 결과가 화면에 완전히 표시될 때까지 기다리세요.",
        "결과가 표시되면 이 PowerShell로 돌아와 Enter를 누르세요."
      ].join(
        "\n"
      )
    );


    await new Promise(
      resolve => {
        setTimeout(
          resolve,
          1500
        );
      }
    );


    recording =
      false;


    await Promise.allSettled(
      Array.from(
        pendingTasks
      )
    );


    writeTrace(
      "capture-stop",
      {
        finalPageUrls:
          context.pages()
            .map(
              currentPage => {
                return sanitizeDataParcTraceUrl(
                  currentPage.url()
                );
              }
            ),

        entryCountBeforeStop:
          traceEntryCount
      }
    );


    console.log(
      ""
    );


    console.log(
      "DataPARC Tag Browser 통신 진단이 완료되었습니다."
    );


    console.log(
      "기록 건수:",
      traceEntryCount
    );


    console.log(
      "진단 파일:",
      traceFilePath
    );

  } finally {
    recording =
      false;


    if (
      context
    ) {
      await context
        .close()
        .catch(
          () => null
        );
    }


    if (
      browser
    ) {
      await browser
        .close()
        .catch(
          () => null
        );
    }
  }
}

/* =========================================================
  TAG별 LOG 조회 화면 프레임 찾기

  화면 확인 기준:
  - TAG NO
  - 출력시간
  - 조회
========================================================= */

async function findOisTagLogFrame(
  page,
  timeoutMilliseconds =
    OIS_QUERY_TIMEOUT
) {
  const startedAt =
    Date.now();


  while (
    Date.now() -
      startedAt <
    timeoutMilliseconds
  ) {
    for (
      const frame of
      page.frames()
    ) {
      const bodyText =
        normalizeOisAgentText(
          await frame
            .locator(
              "body"
            )
            .innerText()
            .catch(
              () => ""
            )
        );


      const hasTagNo =
        /TAG\s*NO/i.test(
          bodyText
        );


      const hasOutputTime =
        bodyText.includes(
          "출력시간"
        );


      const hasSearch =
        bodyText.includes(
          "조회"
        );


      if (
        hasTagNo &&
        hasOutputTime &&
        hasSearch
      ) {
        return frame;
      }
    }


    await page.waitForTimeout(
      250
    );
  }


  return null;
}


/* =========================================================
  OIS TAG별 LOG 조회 화면 열기

  탐색:
  운영정보
  → LOG SHEET
  → TAG별 LOG 조회
========================================================= */

async function openOisTagLogLookup(
  page
) {
  /*
    이미 화면이 열려 있으면 그대로 사용한다.
  */

  const existingFrame =
    await findOisTagLogFrame(
      page,
      1500
    );


  if (
    existingFrame
  ) {
    return existingFrame;
  }


  let menuFrame =
    await findOisNavigationFrame(
      page,
      OIS_QUERY_TIMEOUT
    );


  if (
    !menuFrame
  ) {
    throw new Error(
      "OIS 왼쪽 메뉴 영역을 찾지 못했습니다."
    );
  }


  const tagLogMenuNames = [
    "TAG별 LOG 조회",
    "TAG별 LOG조회",
    "TAG 별 LOG 조회"
  ];


  /*
    현재 바로 보이는지 확인
  */

  let tagLogMenu =
    await findVisibleOisNavigationItem(
      menuFrame,
      tagLogMenuNames,
      1000
    );


  /*
    안 보이면 운영정보부터 연다.
  */

  if (
    !tagLogMenu
  ) {
    const operationMenu =
      await findVisibleOisNavigationItem(
        menuFrame,
        "운영정보",
        1500
      );


    if (
      operationMenu
    ) {
      await clickOisNavigationItem(
        menuFrame,
        "운영정보",
        "운영정보"
      );


      menuFrame =
        await findOisNavigationFrame(
          page,
          OIS_QUERY_TIMEOUT
        );
    }
  }


  if (
    !menuFrame
  ) {
    throw new Error(
      "운영정보 메뉴를 연 뒤 왼쪽 메뉴를 찾지 못했습니다."
    );
  }


  /*
    운영정보를 연 뒤 바로 보이는지 재확인
  */

  tagLogMenu =
    await findVisibleOisNavigationItem(
      menuFrame,
      tagLogMenuNames,
      1000
    );


  /*
    그래도 안 보이면 LOG SHEET을 연다.
  */

  if (
    !tagLogMenu
  ) {
    const logSheetMenu =
      await findVisibleOisNavigationItem(
        menuFrame,
        "LOG SHEET",
        3000
      );


    if (
      logSheetMenu
    ) {
      await clickOisNavigationItem(
        menuFrame,
        "LOG SHEET",
        "LOG SHEET"
      );


      menuFrame =
        await findOisNavigationFrame(
          page,
          OIS_QUERY_TIMEOUT
        );
    }
  }


  if (
    !menuFrame
  ) {
    throw new Error(
      "LOG SHEET 메뉴를 연 뒤 왼쪽 메뉴를 찾지 못했습니다."
    );
  }


  tagLogMenu =
    await findVisibleOisNavigationItem(
      menuFrame,
      tagLogMenuNames,
      10000
    );


  if (
    !tagLogMenu
  ) {
    throw new Error(
      "OIS의 TAG별 LOG 조회 메뉴를 찾지 못했습니다."
    );
  }


  const clicked =
    await clickOisNavigationItem(
      menuFrame,
      tagLogMenuNames,
      "TAG별 LOG 조회"
    );


  if (
    !clicked
  ) {
    throw new Error(
      "OIS의 TAG별 LOG 조회 메뉴를 클릭하지 못했습니다."
    );
  }


  const tagLogFrame =
    await findOisTagLogFrame(
      page,
      OIS_QUERY_TIMEOUT
    );


  if (
    !tagLogFrame
  ) {
    throw new Error(
      "OIS TAG별 LOG 조회 화면이 열리지 않았습니다."
    );
  }


  console.log(
    "OIS TAG별 LOG 조회 화면을 열었습니다."
  );


  return tagLogFrame;
}


/* =========================================================
  TAG별 LOG 조회 조건 입력

  입력:
  - TAG NO
  - 시작일
  - 종료일

  Silo는 하루만 조회하므로:
  시작일 = 종료일 = targetDate
========================================================= */

async function setOisTagLogSearchConditions(
  frame,
  targetTag,
  targetDate
) {
  const normalizedTag =
    normalizeOisAgentText(targetTag);

  if (!normalizedTag) {
    throw new Error(
      "OIS TAG NO가 비어 있습니다."
    );
  }

  if (!isValidOisAgentDate(targetDate)) {
    throw new Error(
      "OIS TAG별 LOG 조회 날짜가 올바르지 않습니다."
    );
  }

  const slashDate =
    targetDate.replace(/-/g, "/");

  const inputs =
    frame.locator("input");

  const inputCount =
    await inputs.count();

  const tagCandidates = [];
  const dateInputs = [];

  for (
    let index = 0;
    index < inputCount;
    index += 1
  ) {
    const input =
      inputs.nth(index);

    const isVisible =
      await input
        .isVisible()
        .catch(() => false);

    if (!isVisible) {
      continue;
    }

    const information =
      await input
        .evaluate(element => {
          const normalizeText = value => {
            return String(value ?? "")
              .replace(/\u00a0/g, " ")
              .replace(/\s+/g, " ")
              .trim();
          };

          const rectangle =
            element.getBoundingClientRect();

          const labelText =
            Array.from(
              element.labels || []
            )
              .map(label => {
                return normalizeText(
                  label.innerText ||
                  label.textContent ||
                  ""
                );
              })
              .join(" ");

          const nearbyContainer =
            element.closest(
              "tr, li, .form-row, .search-row, .input-row"
            );

          return {
            type:
              String(
                element.type || ""
              ).toLowerCase(),

            value:
              String(
                element.value || ""
              ),

            directIdentity:
              [
                element.id,
                element.name,
                element.title,
                element.placeholder,
                element.getAttribute(
                  "aria-label"
                )
              ]
                .filter(Boolean)
                .join(" "),

            nearbyText:
              normalizeText(
                [
                  labelText,
                  element
                    .parentElement
                    ?.innerText ||
                    "",
                  nearbyContainer
                    ?.innerText ||
                    ""
                ].join(" ")
              ),

            top:
              rectangle.top,

            left:
              rectangle.left
          };
        })
        .catch(() => null);

    if (!information) {
      continue;
    }

    if (
      [
        "hidden",
        "button",
        "submit",
        "reset",
        "image",
        "checkbox",
        "radio",
        "file"
      ].includes(information.type)
    ) {
      continue;
    }

    const currentValue =
      String(
        information.value || ""
      ).trim();

    const directIdentity =
      String(
        information.directIdentity || ""
      );

    const nearbyText =
      String(
        information.nearbyText || ""
      );

    const isDateInput =
      information.type === "date" ||
      /^\d{4}[/-]\d{2}[/-]\d{2}$/.test(
        currentValue
      ) ||
      /일자|날짜|date/i.test(
        directIdentity
      );

    if (isDateInput) {
      dateInputs.push({
        input,
        type:
          information.type,
        top:
          information.top,
        left:
          information.left,
        index
      });

      continue;
    }

    let score = 0;

    if (
      /TAG\s*NO/i.test(
        directIdentity
      )
    ) {
      score += 100;
    }

    if (
      /tag.*no|no.*tag/i.test(
        directIdentity
      )
    ) {
      score += 80;
    }

    if (
      /tag/i.test(
        directIdentity
      )
    ) {
      score += 50;
    }

    if (
      /TAG\s*NO/i.test(
        nearbyText
      )
    ) {
      score += 40;
    }

    if (
      [
        "",
        "text",
        "search",
        "tel"
      ].includes(
        information.type
      )
    ) {
      score += 10;
    }

    if (!currentValue) {
      score += 5;
    }

    tagCandidates.push({
      input,
      score,
      top:
        information.top,
      left:
        information.left,
      index
    });
  }

  tagCandidates.sort(
    (left, right) => {
      if (
        right.score !==
        left.score
      ) {
        return (
          right.score -
          left.score
        );
      }

      if (
        left.top !==
        right.top
      ) {
        return (
          left.top -
          right.top
        );
      }

      return (
        left.left -
        right.left
      );
    }
  );

  const tagInput =
    tagCandidates[0]
      ?.input ||
    null;

  if (!tagInput) {
    throw new Error(
      "OIS TAG별 LOG 조회의 TAG NO 입력칸을 찾지 못했습니다."
    );
  }

  const setInputValue =
    async (
      input,
      value
    ) => {
      await input.evaluate(
        (
          element,
          nextValue
        ) => {
          const valueSetter =
            Object
              .getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                "value"
              )
              ?.set;

          if (valueSetter) {
            valueSetter.call(
              element,
              nextValue
            );
          } else {
            element.value =
              nextValue;
          }

          element.dispatchEvent(
            new Event(
              "input",
              {
                bubbles: true
              }
            )
          );

          element.dispatchEvent(
            new Event(
              "change",
              {
                bubbles: true
              }
            )
          );

          element.dispatchEvent(
            new Event(
              "blur",
              {
                bubbles: true
              }
            )
          );
        },

        value
      );
    };

  await setInputValue(
    tagInput,
    normalizedTag
  );

  const enteredTag =
    normalizeOisAgentText(
      await tagInput
        .inputValue()
        .catch(() => "")
    );

  if (
    enteredTag.toUpperCase() !==
    normalizedTag.toUpperCase()
  ) {
    throw new Error(
      "OIS TAG NO 입력값이 정상적으로 반영되지 않았습니다."
    );
  }

  if (
    dateInputs.length < 1
  ) {
    throw new Error(
      "OIS TAG별 LOG 조회의 날짜 입력칸을 찾지 못했습니다."
    );
  }

  dateInputs.sort(
    (left, right) => {
      if (
        Math.abs(
          left.top -
          right.top
        ) > 5
      ) {
        return (
          left.top -
          right.top
        );
      }

      return (
        left.left -
        right.left
      );
    }
  );

  const targetDateInputs =
    dateInputs.slice(0, 2);

  for (
    const dateInput of
    targetDateInputs
  ) {
    const inputValue =
      dateInput.type === "date"
        ? targetDate
        : slashDate;

    await setInputValue(
      dateInput.input,
      inputValue
    );
  }

  console.log(
    [
      "OIS TAG별 LOG 조회조건",
      normalizedTag,
      targetDate
    ].join(" · ")
  );
}


/* =========================================================
  TAG별 LOG 조회 응답에서 24시 값 읽기

  중요:
  - 요청일과 같은 날짜만 사용
  - TAG가 같은 자료만 사용
  - hd_24 우선
  - hb_24는 사용하지 않음

  이유:
  hb_24는 전일 계열 값일 수 있으므로
  회의 기준일을 틀리지 않게 명시적으로 제외한다.
========================================================= */

async function captureOisTagLog24HourValueFromApi(
  page,
  targetTag,
  targetDate,
  triggerSearch
) {
  const normalizedTargetTag =
    normalizeOisAgentText(
      targetTag
    ).toUpperCase();


  const compactTargetDate =
    targetDate.replace(
      /-/g,
      ""
    );


  return await new Promise(
    (
      resolve,
      reject
    ) => {
      let isSettled =
        false;


      let timeoutId =
        null;


      const cleanup = () => {
        if (
          timeoutId
        ) {
          clearTimeout(
            timeoutId
          );


          timeoutId =
            null;
        }


        page.off(
          "response",
          handleResponse
        );
      };


      const finishResolve = (
        value
      ) => {
        if (
          isSettled
        ) {
          return;
        }


        isSettled =
          true;


        cleanup();


        resolve(
          value
        );
      };


      const finishReject = (
        error
      ) => {
        if (
          isSettled
        ) {
          return;
        }


        isSettled =
          true;


        cleanup();


        reject(
          error
        );
      };


      const handleResponse =
        async response => {
          try {
            const responseUrl =
              String(
                response.url() ||
                ""
              );


            const request =
              response.request();


            const requestMethod =
              String(
                request.method() ||
                ""
              ).toUpperCase();


            if (
              !responseUrl.includes(
                "/ajax/data"
              ) ||
              requestMethod !==
                "POST"
            ) {
              return;
            }


            const requestBody =
              String(
                request.postData() ||
                ""
              ).toUpperCase();


            const responseText =
              await response.text();


            if (
              !responseText.trim()
            ) {
              return;
            }


            let responseData = {};


            try {
              responseData =
                JSON.parse(
                  responseText
                );

            } catch {
              return;
            }


            const rows =
              Array.isArray(
                responseData.result
              )
                ? responseData.result
                : [];


            for (
              const row of
              rows
            ) {
              const rowTag =
                normalizeOisAgentText(
                  row?.tag_no ||
                  row?.tag ||
                  row?.tagno ||
                  ""
                ).toUpperCase();


              const rowDate =
                String(
                  row?.base_date ||
                  row?.schbase_date ||
                  row?.date ||
                  row?.work_date ||
                  ""
                )
                  .replace(
                    /[^0-9]/g,
                    ""
                  )
                  .slice(
                    0,
                    8
                  );


              /*
                TAG가 명시된 행이면 정확히 같은 TAG만 허용
              */

              if (
                rowTag &&
                rowTag !==
                  normalizedTargetTag
              ) {
                continue;
              }


              /*
                TAG 필드가 없는 응답은
                요청 또는 응답 자체에 TAG가 포함된 경우만 허용
              */

              if (
                !rowTag &&
                !requestBody.includes(
                  normalizedTargetTag
                ) &&
                !responseText
                  .toUpperCase()
                  .includes(
                    normalizedTargetTag
                  )
              ) {
                continue;
              }


              /*
                날짜가 들어 있는 경우
                반드시 요청일과 같아야 한다.
              */

              if (
                rowDate &&
                rowDate !==
                  compactTargetDate
              ) {
                continue;
              }


              /*
                24시 값 후보

                hb_24는 고의로 제외한다.
              */

              const valueCandidates = [
                [
                  "hd_24",
                  row?.hd_24
                ],

                [
                  "h_24",
                  row?.h_24
                ],

                [
                  "hour_24",
                  row?.hour_24
                ],

                [
                  "hour24",
                  row?.hour24
                ],

                [
                  "value_24",
                  row?.value_24
                ],

                [
                  "value24",
                  row?.value24
                ],

                [
                  "24",
                  row?.["24"]
                ]
              ];


              let capturedValue =
                null;


              let capturedField =
                "";


              for (
                const [
                  fieldName,
                  rawValue
                ] of
                valueCandidates
              ) {
                const numericValue =
                  parseOisAgentNumber(
                    rawValue
                  );


                if (
                  numericValue ===
                    null
                ) {
                  continue;
                }


                capturedValue =
                  numericValue;


                capturedField =
                  fieldName;


                break;
              }


              if (
                capturedValue ===
                  null
              ) {
                continue;
              }


              const result = {
                value:
                  capturedValue,

                valueField:
                  capturedField,

                tag:
                  rowTag ||
                  normalizedTargetTag,

                sourceDate:
                  rowDate ||
                  compactTargetDate,

                itemName:
                  normalizeOisAgentText(
                    row?.tag_name ||
                    row?.tag_name_kor ||
                    row?.mid_name ||
                    ""
                  ),

                unit:
                  normalizeOisAgentText(
                    row?.unit_code ||
                    row?.unit ||
                    ""
                  )
              };


              console.log(
                "OIS TAG별 LOG 24시 자료 확인:",
                {
                  targetDate,

                  targetTag,

                  ...result
                }
              );


              finishResolve(
                result
              );


              return;
            }

          } catch (
            error
          ) {
            finishReject(
              error
            );
          }
        };


      /*
        조회 버튼 클릭 전에
        응답 감시부터 시작
      */

      page.on(
        "response",
        handleResponse
      );


      timeoutId =
        setTimeout(
          () => {
            finishReject(
              new Error(
                `${targetTag}의 ${targetDate} 24시 값을 읽지 못했습니다.`
              )
            );
          },

          OIS_QUERY_TIMEOUT
        );


      Promise.resolve()
        .then(
          triggerSearch
        )
        .catch(
          finishReject
        );
    }
  );
}


/* =========================================================
  오전회의 Silo Level 실제 조회

  targetDate:
  회의일 전날

  예:
  회의일 2026-08-08
  → targetDate 2026-08-07

  결과:
  2026-08-07 24시
========================================================= */

async function collectOisSiloLevelValues(
  page,
  config,
  targetDate
) {
  if (
    !isValidOisAgentDate(
      targetDate
    )
  ) {
    throw new Error(
      "Silo Level 조회 날짜가 올바르지 않습니다."
    );
  }


  await ensureOisAgentLoggedIn(
    page,
    config
  );


  const capturedValues = {};


  for (
    const definition of
    OIS_SILO_LEVEL_DEFINITIONS
  ) {
    let frame =
      await openOisTagLogLookup(
        page
      );


    await setOisTagLogSearchConditions(
      frame,
      definition.tag,
      targetDate
    );


    await page.waitForTimeout(
      200
    );


    frame =
      await findOisTagLogFrame(
        page,
        3000
      ) ||
      frame;


    const capturedValue =
      await captureOisTagLog24HourValueFromApi(
        page,
        definition.tag,
        targetDate,

        async () => {
          /*
            기존 조회버튼 함수는
            화면 안의 "조회" 버튼을 찾아 클릭하므로
            TAG별 LOG 화면에서도 재사용한다.
          */

          await clickOisLogSheetSearchButton(
            frame
          );
        }
      );


    capturedValues[
      definition.resultKey
    ] = {
      ...capturedValue,

      label:
        definition.label
    };
  }


  const result = {
    source:
      "OIS TAG별 LOG 조회",

    targetDate,

    valueColumn:
      "24시",

    flyAshSiloLevel:
      capturedValues
        .flyAsh
        .value,

    bioStorageSiloLevel:
      capturedValues
        .bioStorage
        .value,

    flyAshTag:
      capturedValues
        .flyAsh
        .tag,

    bioStorageTag:
      capturedValues
        .bioStorage
        .tag,

    flyAshItemName:
      capturedValues
        .flyAsh
        .itemName,

    bioStorageItemName:
      capturedValues
        .bioStorage
        .itemName,

    flyAshUnit:
      capturedValues
        .flyAsh
        .unit,

    bioStorageUnit:
      capturedValues
        .bioStorage
        .unit,

    flyAshValueField:
      capturedValues
        .flyAsh
        .valueField,

    bioStorageValueField:
      capturedValues
        .bioStorage
        .valueField,

    collectedAt:
      new Date()
        .toISOString()
  };


  console.log(
    [
      "OIS Silo Level 조회 완료",

      targetDate,

      `Fly Ash ${result.flyAshSiloLevel}${result.flyAshUnit || ""}`,

      `Bio Storage ${result.bioStorageSiloLevel}${result.bioStorageUnit || ""}`
    ].join(
      " · "
    )
  );


  return result;
}

/* =========================================================
  OIS 과거 LOG SHEET 업무일지 조회 정의

  로그시트 결재 조회:
  oi.LogSheetService.listApprovalInfo

  설비운영팀:
  dept_code = 5030

  전체 근무:
  s_time = S

  대상 보직:
  TGO / BCO1 / BCO2 / TO / BO1 / BO2
========================================================= */

const OIS_LEGACY_LOG_DEFINITION = {
  command:
    "oi.LogSheetService.listApprovalInfo",

  plantCode:
    "8000",

  departmentCode:
    "5030",

  allShiftCode:
    "S",

  rowStatus:
    "C",

  roles: [
    "TGO",
    "BCO1",
    "BCO2",
    "TO",
    "BO1",
    "BO2"
  ]
};


/* =========================================================
  OIS 여러 줄 원문 정리

  중요:
  업무일지 rmk의 줄바꿈은 그대로 보존한다.
========================================================= */

function normalizeOisMultilineText(
  value
) {
  return String(
    value ??
    ""
  )
    .replace(
      /\r\n?/g,
      "\n"
    )
    .split(
      "\n"
    )
    .map(
      line => {
        return line.replace(
          /[ \t]+$/g,
          ""
        );
      }
    )
    .join(
      "\n"
    )
    .trim();
}

/* =========================================================
  OIS 문자열 정리
========================================================= */

function normalizeOisText(
  value
) {
  return String(
    value ??
    ""
  )
    .replace(
      /\u00a0/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


/* =========================================================
  OIS 숫자 변환

  예:
  7,880.000 → 7880
  72.098 → 72.098

  숫자만 들어 있는 셀만 변환한다.
  저장량(m3) 같은 문구는 숫자로 처리하지 않는다.
========================================================= */

function parseOisNumericCell(
  value
) {
  const normalizedValue =
    normalizeOisText(
      value
    )
      .replace(
        /,/g,
        ""
      );


  if (
    !/^-?\d+(?:\.\d+)?$/.test(
      normalizedValue
    )
  ) {
    return null;
  }


  const numericValue =
    Number(
      normalizedValue
    );


  return Number.isFinite(
    numericValue
  )
    ? numericValue
    : null;
}


/* =========================================================
  특정 문구가 있는 OIS 프레임 찾기
========================================================= */

async function findOisFrameContainingText(
  page,
  searchText,
  timeoutMilliseconds = 30000
) {
  const startedAt =
    Date.now();


  while (
    Date.now() -
      startedAt <
    timeoutMilliseconds
  ) {
    for (
      const frame of
      page.frames()
    ) {
      const textLocator =
        frame.getByText(
          searchText,
          {
            exact:
              false
          }
        );


      const count =
        await textLocator
          .count()
          .catch(
            () => 0
          );


      for (
        let index = 0;
        index <
          count;
        index +=
          1
      ) {
        const isVisible =
          await textLocator
            .nth(
              index
            )
            .isVisible()
            .catch(
              () => false
            );


        if (
          isVisible
        ) {
          return frame;
        }
      }
    }


    await page.waitForTimeout(
      500
    );
  }


  return null;
}


/* =========================================================
  여러 문구가 함께 들어 있는 표 찾기
========================================================= */

async function findOisTableByTexts(
  frame,
  requiredTexts
) {
  const tables =
    frame.locator(
      "table"
    );


  const tableCount =
    await tables.count();


  for (
    let index = 0;
    index <
      tableCount;
    index +=
      1
  ) {
    const table =
      tables.nth(
        index
      );


    const isVisible =
      await table
        .isVisible()
        .catch(
          () => false
        );


    if (
      !isVisible
    ) {
      continue;
    }


    const tableText =
      normalizeOisText(
        await table
          .innerText()
          .catch(
            () => ""
          )
      );


    const hasAllTexts =
      requiredTexts.every(
        requiredText => {
          return tableText.includes(
            requiredText
          );
        }
      );


    if (
      hasAllTexts
    ) {
      return table;
    }
  }


  return null;
}

/* =========================================================
  표에서 특정 문구가 있는 행의 셀 값 가져오기

  OIS 표 지원:
  - 일반 td 텍스트
  - input.value
  - textarea.value
  - select 선택값
  - data-value
  - data-text

  숫자가 문구와 같은 셀에 있어도
  순수 숫자 토큰을 별도로 추출한다.

  예:
  "장자산단 7,880.000"
  →
  "장자산단 7,880.000"
  "7,880.000"
========================================================= */

async function getOisTableRowCells(
  table,
  rowKeyword
) {
  const normalizedKeyword =
    normalizeOisText(
      rowKeyword
    );


  const rows =
    table.locator(
      "tr"
    );


  const rowCount =
    await rows.count();


  for (
    let index = 0;
    index <
      rowCount;
    index +=
      1
  ) {
    const row =
      rows.nth(
        index
      );


    const rowResult =
      await row
        .evaluate(
          (
            rowElement,
            keyword
          ) => {
            const normalizeText = (
              value
            ) => {
              return String(
                value ??
                ""
              )
                .replace(
                  /\u00a0/g,
                  " "
                )
                .replace(
                  /\s+/g,
                  " "
                )
                .trim();
            };


            /*
              tr 바로 아래에 있는 th·td만 사용한다.

              셀 내부에 또 다른 table이 있어도
              그 하위 td를 중복 수집하지 않는다.
            */

            const cellElements = [
              ...rowElement.children
            ].filter(
              element => {
                return [
                  "TH",
                  "TD"
                ].includes(
                  element.tagName
                );
              }
            );


            const rowValues =
              [];


            cellElements.forEach(
              cellElement => {
                const cellValues =
                  [];


                const seenValues =
                  new Set();


                const appendValue = (
                  rawValue
                ) => {
                  const value =
                    normalizeText(
                      rawValue
                    );


                  if (
                    !value ||
                    seenValues.has(
                      value
                    )
                  ) {
                    return;
                  }


                  seenValues.add(
                    value
                  );


                  cellValues.push(
                    value
                  );
                };


                const appendNumericTokens = (
                  rawValue
                ) => {
                  const sourceText =
                    normalizeText(
                      rawValue
                    );


                  if (
                    !sourceText
                  ) {
                    return;
                  }


                  sourceText
                    .split(
                      /[\s|:：()[\]{}]+/
                    )
                    .map(
                      token => {
                        return normalizeText(
                          token
                        );
                      }
                    )
                    .filter(
                      token => {
                        return /^-?[\d,]+(?:\.\d+)?$/.test(
                          token
                        );
                      }
                    )
                    .forEach(
                      appendValue
                    );
                };


                /*
                  화면에 표시되는 일반 텍스트
                */

                const visibleText =
                  normalizeText(
                    cellElement.innerText ||
                    cellElement.textContent ||
                    ""
                  );


                if (
                  visibleText
                ) {
                  visibleText
                    .split(
                      /\r?\n/
                    )
                    .forEach(
                      textLine => {
                        appendValue(
                          textLine
                        );


                        appendNumericTokens(
                          textLine
                        );
                      }
                    );
                }


                /*
                  input·textarea·select의 실제 값

                  input 값은 innerText에 포함되지 않으므로
                  별도로 읽는다.
                */

                cellElement
                  .querySelectorAll(
                    `
                      input,
                      textarea,
                      select
                    `
                  )
                  .forEach(
                    control => {
                      if (
                        control instanceof
                          HTMLInputElement
                      ) {
                        const inputType =
                          String(
                            control.type ||
                            ""
                          ).toLowerCase();


                        if (
                          [
                            "button",
                            "submit",
                            "reset",
                            "checkbox",
                            "radio",
                            "image",
                            "file"
                          ].includes(
                            inputType
                          )
                        ) {
                          return;
                        }


                        appendValue(
                          control.value
                        );


                        appendNumericTokens(
                          control.value
                        );


                        return;
                      }


                      if (
                        control instanceof
                          HTMLTextAreaElement
                      ) {
                        appendValue(
                          control.value
                        );


                        appendNumericTokens(
                          control.value
                        );


                        return;
                      }


                      if (
                        control instanceof
                          HTMLSelectElement
                      ) {
                        const selectedText =
                          normalizeText(
                            control
                              .selectedOptions?.[0]
                              ?.textContent ||
                            control.value
                          );


                        appendValue(
                          selectedText
                        );


                        appendNumericTokens(
                          selectedText
                        );
                      }
                    }
                  );


                /*
                  TossPlatform 또는 사내 그리드에서
                  데이터 속성에 값이 들어 있는 경우
                */

                cellElement
                  .querySelectorAll(
                    `
                      [data-value],
                      [data-text]
                    `
                  )
                  .forEach(
                    valueElement => {
                      const dataValue =
                        valueElement.getAttribute(
                          "data-value"
                        );


                      const dataText =
                        valueElement.getAttribute(
                          "data-text"
                        );


                      appendValue(
                        dataValue
                      );


                      appendNumericTokens(
                        dataValue
                      );


                      appendValue(
                        dataText
                      );


                      appendNumericTokens(
                        dataText
                      );
                    }
                  );


                rowValues.push(
                  ...cellValues
                );
              }
            );


            /*
              행 검색에는 일반 텍스트와
              input 등의 실제 값을 모두 사용한다.
            */

            const rowSearchText =
              normalizeText(
                [
                  rowElement.innerText,
                  rowElement.textContent,
                  ...rowValues
                ].join(
                  " "
                )
              );


            return {
              matched:
                rowSearchText.includes(
                  keyword
                ),

              values:
                rowValues,

              searchText:
                rowSearchText
            };
          },

          normalizedKeyword
        )
        .catch(
          error => {
            return {
              matched:
                false,

              values:
                [],

              searchText:
                "",

              error:
                error?.message ||
                String(
                  error
                )
            };
          }
        );


    if (
      !rowResult.matched
    ) {
      continue;
    }


    /*
      실제 추출값 확인용 로그

      다음 오류 발생 시 이 로그를 보면
      OIS 표 구조를 바로 확인할 수 있다.
    */

    console.log(
      `OIS "${normalizedKeyword}" 행 셀:`,
      rowResult.values
    );


    return rowResult.values;
  }


  throw new Error(
    `"${normalizedKeyword}" 행을 찾지 못했습니다.`
  );
}

/* =========================================================
  셀 목록에서 숫자만 추출
========================================================= */

function getOisNumericCells(
  cellTexts
) {
  return (
    Array.isArray(
      cellTexts
    )
      ? cellTexts
      : []
  )
    .map(
      parseOisNumericCell
    )
    .filter(
      value => {
        return value !==
          null;
      }
    );
}


/* =========================================================
  특정 셀 앞쪽에서 가장 가까운 숫자 찾기
========================================================= */

function findNearestOisNumberBefore(
  cellTexts,
  startIndex
) {
  for (
    let index =
      startIndex -
      1;
    index >=
      0;
    index -=
      1
  ) {
    const numericValue =
      parseOisNumericCell(
        cellTexts[
          index
        ]
      );


    if (
      numericValue !==
        null
    ) {
      return numericValue;
    }
  }


  return null;
}


/* =========================================================
  특정 셀 뒤쪽에서 가장 가까운 숫자 찾기
========================================================= */

function findNearestOisNumberAfter(
  cellTexts,
  startIndex
) {
  for (
    let index =
      startIndex +
      1;
    index <
      cellTexts.length;
    index +=
      1
  ) {
    const numericValue =
      parseOisNumericCell(
        cellTexts[
          index
        ]
      );


    if (
      numericValue !==
        null
    ) {
      return numericValue;
    }
  }


  return null;
}

/* =========================================================
  OIS 일일 운전일지(환경) 화면 열기

  탐색 순서:
  1. 운영정보
  2. 일일현황
  3. 일일 운전일지(환경)

  이미 환경일지가 열려 있으면 현재 화면을 재사용한다.
========================================================= */

async function openOisEnvironmentDailyLog(
  page
) {
  /* =====================================================
    이미 환경일지가 열려 있으면 재사용
  ====================================================== */

  const alreadyOpenedFrame =
    await findOisFrameContainingText(
      page,
      "1. 원수 (RAW WATER)",
      1500
    );


  if (
    alreadyOpenedFrame
  ) {
    return alreadyOpenedFrame;
  }


  console.log(
    "OIS 일일 운전일지(환경) 화면을 엽니다."
  );


  /* =====================================================
    왼쪽 메뉴 프레임
  ====================================================== */

  let menuFrame =
    await findOisNavigationFrame(
      page,
      OIS_QUERY_TIMEOUT
    );


  if (
    !menuFrame
  ) {
    throw new Error(
      "OIS 왼쪽 메뉴 영역을 찾지 못했습니다."
    );
  }


  /* =====================================================
    환경일지 메뉴가 이미 보이는지 확인
  ====================================================== */

  let environmentMenu =
    await findVisibleOisNavigationItem(
      menuFrame,
      [
        "일일 운전일지(환경)",
        "일일 운전일지 (환경)"
      ],
      1000
    );


  /* =====================================================
    환경일지가 안 보이면 운영정보 선택
  ====================================================== */

  if (
    !environmentMenu
  ) {
    const operationMenu =
      await findVisibleOisNavigationItem(
        menuFrame,
        "운영정보",
        1500
      );


    if (
      operationMenu
    ) {
      await clickOisNavigationItem(
        menuFrame,
        "운영정보",
        "운영정보"
      );


      menuFrame =
        await findOisNavigationFrame(
          page,
          OIS_QUERY_TIMEOUT
        );


      if (
        !menuFrame
      ) {
        throw new Error(
          "운영정보 메뉴를 연 뒤 왼쪽 메뉴를 찾지 못했습니다."
        );
      }


      environmentMenu =
        await findVisibleOisNavigationItem(
          menuFrame,
          [
            "일일 운전일지(환경)",
            "일일 운전일지 (환경)"
          ],
          1000
        );
    }
  }


  /* =====================================================
    환경일지가 아직 안 보이면 일일현황 펼치기
  ====================================================== */

  if (
    !environmentMenu
  ) {
    const dailyStatusMenu =
      await findVisibleOisNavigationItem(
        menuFrame,
        [
          "일일현황",
          "일일 현황"
        ],
        10000
      );


    if (
      !dailyStatusMenu
    ) {
      throw new Error(
        "OIS의 일일현황 메뉴를 찾지 못했습니다."
      );
    }


    const dailyStatusClicked =
      await clickOisNavigationItem(
        menuFrame,
        [
          "일일현황",
          "일일 현황"
        ],
        "일일현황"
      );


    if (
      !dailyStatusClicked
    ) {
      throw new Error(
        "OIS의 일일현황 메뉴를 열지 못했습니다."
      );
    }


    menuFrame =
      await findOisNavigationFrame(
        page,
        OIS_QUERY_TIMEOUT
      );


    if (
      !menuFrame
    ) {
      throw new Error(
        "일일현황 메뉴를 연 뒤 왼쪽 메뉴를 찾지 못했습니다."
      );
    }


    environmentMenu =
      await findVisibleOisNavigationItem(
        menuFrame,
        [
          "일일 운전일지(환경)",
          "일일 운전일지 (환경)"
        ],
        10000
      );
  }


  if (
    !environmentMenu
  ) {
    throw new Error(
      "OIS의 일일 운전일지(환경) 메뉴를 찾지 못했습니다."
    );
  }


  /* =====================================================
    환경일지 메뉴 클릭
  ====================================================== */

  const environmentMenuClicked =
    await clickOisNavigationItem(
      menuFrame,
      [
        "일일 운전일지(환경)",
        "일일 운전일지 (환경)"
      ],
      "일일 운전일지(환경)"
    );


  if (
    !environmentMenuClicked
  ) {
    throw new Error(
      "일일 운전일지(환경) 메뉴를 클릭하지 못했습니다."
    );
  }


  /* =====================================================
    환경일지 화면 로딩
  ====================================================== */

  const environmentFrame =
    await findOisFrameContainingText(
      page,
      "1. 원수 (RAW WATER)",
      OIS_QUERY_TIMEOUT
    );


  if (
    !environmentFrame
  ) {
    throw new Error(
      "일일 운전일지(환경) 화면이 열리지 않았습니다."
    );
  }


  console.log(
    "일일 운전일지(환경) 화면을 열었습니다."
  );


  return environmentFrame;
}

/* =========================================================
  특정 행에서 제목 뒤에 있는 숫자만 가져오기

  예:
  [
    "동두천",
    "0.000",
    "8,978.000",
    "1,944.000",
    "7,063.100",
    "저장량(m3)",
    "3,382.326",
    "9,453.110",
    "5,631.713"
  ]

  "저장량" 뒤 숫자 3개:
  3,382.326
  9,453.110
  5,631.713
========================================================= */

function getOisNumericValuesAfterKeyword(
  cellTexts,
  keyword,
  requiredCount
) {
  const safeCellTexts =
    Array.isArray(
      cellTexts
    )
      ? cellTexts
      : [];


  const normalizedKeyword =
    normalizeOisText(
      keyword
    );


  const keywordIndex =
    safeCellTexts.findIndex(
      cellText => {
        return normalizeOisText(
          cellText
        ).includes(
          normalizedKeyword
        );
      }
    );


  if (
    keywordIndex <
      0
  ) {
    throw new Error(
      `"${normalizedKeyword}" 셀을 찾지 못했습니다.`
    );
  }


  const numericValues = [];


  for (
    let index =
      keywordIndex +
      1;

    index <
      safeCellTexts.length;

    index +=
      1
  ) {
    const numericValue =
      parseOisNumericCell(
        safeCellTexts[
          index
        ]
      );


    if (
      numericValue ===
        null
    ) {
      continue;
    }


    numericValues.push(
      numericValue
    );


    if (
      numericValues.length >=
      requiredCount
    ) {
      break;
    }
  }


  if (
    numericValues.length <
      requiredCount
  ) {
    throw new Error(
      `"${normalizedKeyword}" 뒤의 숫자 ${requiredCount}개를 읽지 못했습니다.`
    );
  }


  return numericValues;
}


/* =========================================================
  특정 제목의 바로 아래에 있는 숫자 찾기

  사용:
  순수사용량
  ↓
  1,720.000

  같은 행 오른쪽 숫자가 아니라
  화면상 바로 아래 값을 찾는다.
========================================================= */

async function findOisNumericValueBelowKeyword(
  table,
  keyword
) {
  const normalizedKeyword =
    normalizeOisText(
      keyword
    );


  const rawValue =
    await table.evaluate(
      (
        tableElement,
        keywordText
      ) => {
        const normalizeText = (
          value
        ) => {
          return String(
            value ??
            ""
          )
            .replace(
              /\u00a0/g,
              " "
            )
            .replace(
              /\s+/g,
              " "
            )
            .trim();
        };


        const parsePureNumber = (
          value
        ) => {
          const normalizedValue =
            normalizeText(
              value
            )
              .replace(
                /,/g,
                ""
              );


          if (
            !/^-?\d+(?:\.\d+)?$/.test(
              normalizedValue
            )
          ) {
            return null;
          }


          const numericValue =
            Number(
              normalizedValue
            );


          return Number.isFinite(
            numericValue
          )
            ? numericValue
            : null;
        };


        const getElementText = (
          element
        ) => {
          if (
            element instanceof
              HTMLInputElement ||
            element instanceof
              HTMLTextAreaElement
          ) {
            return normalizeText(
              element.value
            );
          }


          if (
            element instanceof
              HTMLSelectElement
          ) {
            return normalizeText(
              element
                .selectedOptions?.[0]
                ?.textContent ||
              element.value
            );
          }


          const dataValue =
            normalizeText(
              element.getAttribute?.(
                "data-value"
              )
            );


          if (
            dataValue
          ) {
            return dataValue;
          }


          const dataText =
            normalizeText(
              element.getAttribute?.(
                "data-text"
              )
            );


          if (
            dataText
          ) {
            return dataText;
          }


          return normalizeText(
            element.innerText ||
            element.textContent ||
            ""
          );
        };


        const getRectangle = (
          element
        ) => {
          if (
            !(element instanceof
              Element)
          ) {
            return null;
          }


          const rectangle =
            element.getBoundingClientRect();


          if (
            rectangle.width <=
              0 ||
            rectangle.height <=
              0
          ) {
            return null;
          }


          const style =
            window.getComputedStyle(
              element
            );


          if (
            style.display ===
              "none" ||
            style.visibility ===
              "hidden" ||
            Number(
              style.opacity
            ) ===
              0
          ) {
            return null;
          }


          return {
            left:
              rectangle.left,

            right:
              rectangle.right,

            top:
              rectangle.top,

            bottom:
              rectangle.bottom,

            width:
              rectangle.width,

            height:
              rectangle.height,

            centerX:
              rectangle.left +
              rectangle.width /
              2,

            centerY:
              rectangle.top +
              rectangle.height /
              2
          };
        };


        const allElements = [
          tableElement,

          ...tableElement.querySelectorAll(
            "*"
          )
        ];


        /* =================================================
          순수사용량 제목 후보
        ================================================= */

        const labelCandidates =
          allElements
            .map(
              element => {
                const text =
                  getElementText(
                    element
                  );


                const rectangle =
                  getRectangle(
                    element
                  );


                if (
                  !text ||
                  !rectangle ||
                  !text.includes(
                    keywordText
                  )
                ) {
                  return null;
                }


                return {
                  element,
                  text,
                  rectangle,

                  exact:
                    text ===
                    keywordText,

                  area:
                    rectangle.width *
                    rectangle.height
                };
              }
            )
            .filter(
              Boolean
            )
            .sort(
              (
                first,
                second
              ) => {
                if (
                  first.exact !==
                  second.exact
                ) {
                  return first.exact
                    ? -1
                    : 1;
                }


                return (
                  first.area -
                  second.area
                );
              }
            );


        for (
          const labelCandidate
          of labelCandidates
        ) {
          const numericCandidates =
            allElements
              .map(
                element => {
                  const text =
                    getElementText(
                      element
                    );


                  const numericValue =
                    parsePureNumber(
                      text
                    );


                  const rectangle =
                    getRectangle(
                      element
                    );


                  if (
                    numericValue ===
                      null ||
                    !rectangle
                  ) {
                    return null;
                  }


                  /*
                    제목보다 아래쪽 숫자만 허용한다.
                    같은 행 오른쪽의 0 값은 제외된다.
                  */

                  if (
                    rectangle.centerY <=
                    labelCandidate
                      .rectangle
                      .centerY +
                    2
                  ) {
                    return null;
                  }


                  const horizontalDifference =
                    Math.abs(
                      rectangle.centerX -
                      labelCandidate
                        .rectangle
                        .centerX
                    );


                  const verticalDifference =
                    rectangle.centerY -
                    labelCandidate
                      .rectangle
                      .centerY;


                  const allowedHorizontalDifference =
                    Math.max(
                      55,

                      labelCandidate
                        .rectangle
                        .width *
                      0.8
                    );


                  if (
                    horizontalDifference >
                      allowedHorizontalDifference ||
                    verticalDifference >
                      120
                  ) {
                    return null;
                  }


                  return {
                    value:
                      numericValue,

                    text,

                    horizontalDifference,
                    verticalDifference,

                    area:
                      rectangle.width *
                      rectangle.height
                  };
                }
              )
              .filter(
                Boolean
              )
              .sort(
                (
                  first,
                  second
                ) => {
                  const verticalDifference =
                    first.verticalDifference -
                    second.verticalDifference;


                  if (
                    Math.abs(
                      verticalDifference
                    ) >
                    2
                  ) {
                    return verticalDifference;
                  }


                  const horizontalDifference =
                    first.horizontalDifference -
                    second.horizontalDifference;


                  if (
                    Math.abs(
                      horizontalDifference
                    ) >
                    2
                  ) {
                    return horizontalDifference;
                  }


                  return (
                    first.area -
                    second.area
                  );
                }
              );


          if (
            numericCandidates.length >
            0
          ) {
            return numericCandidates[
              0
            ].value;
          }
        }


        return null;
      },

      normalizedKeyword
    );


  const numericValue =
    parseOisNumericCell(
      rawValue
    );


  if (
    numericValue ===
      null
  ) {
    throw new Error(
      `"${normalizedKeyword}" 바로 아래 숫자를 읽지 못했습니다.`
    );
  }


  return numericValue;
}

/* =========================================================
  OIS 수처리 자료 읽기

  정확한 위치 기준:
  - 장자산단 뒤 첫 번째 숫자
  - 저장량 뒤 숫자 3개
  - 저장율 뒤 숫자 3개
  - 순수 생산량은 순수사용량 왼쪽
  - 순수 사용량은 순수사용량 바로 아래
========================================================= */

async function extractOisWaterTreatmentValues(
  page
) {
  const frame =
    await openOisEnvironmentDailyLog(
      page
    );


  /* =====================================================
    1. 원수·저장조 표
  ====================================================== */

  const rawWaterTable =
    await findOisTableByTexts(
      frame,
      [
        "장자산단",
        "원수 TANK",
        "여과수 TANK",
        "순수 TANK"
      ]
    );


  if (
    !rawWaterTable
  ) {
    throw new Error(
      "원수 및 용수 저장조 표를 찾지 못했습니다."
    );
  }


  const industrialComplexCells =
    await getOisTableRowCells(
      rawWaterTable,
      "장자산단"
    );


  const storageAmountCells =
    await getOisTableRowCells(
      rawWaterTable,
      "저장량"
    );


  const storageRateCells =
    await getOisTableRowCells(
      rawWaterTable,
      "저장율"
    );


  /*
    장자산단 왼쪽·오른쪽의 다른 숫자를 제외하고
    장자산단 뒤 첫 번째 숫자만 사용한다.
  */

  const [
    rawWaterInflow
  ] =
    getOisNumericValuesAfterKeyword(
      industrialComplexCells,
      "장자산단",
      1
    );


  /*
    저장량(m3) 뒤의 세 숫자

    원수 → 여과수 → 순수
  */

  const storageAmounts =
    getOisNumericValuesAfterKeyword(
      storageAmountCells,
      "저장량",
      3
    );


  /*
    저장율(%) 뒤의 세 숫자

    원수 → 여과수 → 순수
  */

  const storageRates =
    getOisNumericValuesAfterKeyword(
      storageRateCells,
      "저장율",
      3
    );


  /* =====================================================
    2. DEMI WATER 표
  ====================================================== */

  const demiWaterTable =
    await findOisTableByTexts(
      frame,
      [
        "MBE",
        "순수사용량",
        "2nd RO"
      ]
    );


  if (
    !demiWaterTable
  ) {
    throw new Error(
      "수처리 생산설비 표를 찾지 못했습니다."
    );
  }


  const pureWaterSummaryCells =
    await getOisTableRowCells(
      demiWaterTable,
      "순수사용량"
    );


  const pureWaterUsageIndex =
    pureWaterSummaryCells.findIndex(
      cellText => {
        return normalizeOisText(
          cellText
        ).includes(
          "순수사용량"
        );
      }
    );


  if (
    pureWaterUsageIndex <
      0
  ) {
    throw new Error(
      "순수사용량 셀을 찾지 못했습니다."
    );
  }


  /*
    순수 생산량:
    순수사용량 제목의 바로 왼쪽 숫자

    예:
    1,632.000 | 순수사용량
  */

  const demiProduction =
    findNearestOisNumberBefore(
      pureWaterSummaryCells,
      pureWaterUsageIndex
    );


  if (
    demiProduction ===
      null
  ) {
    throw new Error(
      "순수 생산량을 읽지 못했습니다."
    );
  }


  /*
    순수 사용량:
    순수사용량 제목의 바로 아래 숫자

    예:
    순수사용량
    1,720.000
  */

  const pureWaterUsage =
    await findOisNumericValueBelowKeyword(
      demiWaterTable,
      "순수사용량"
    );


  /* =====================================================
    기준일
  ====================================================== */

  const pageText =
    normalizeOisText(
      await frame
        .locator(
          "body"
        )
        .innerText()
        .catch(
          () => ""
        )
    );


  const dateMatch =
    pageText.match(
      /기준일\s*(\d{4}\/\d{2}\/\d{2})/
    );


  const sourceDate =
    dateMatch?.[1]
      ? dateMatch[1].replace(
          /\//g,
          "-"
        )
      : "";


  const result = {
    source:
      "OIS 일일 운전일지(환경)",

    sourceDate,

    collectedAt:
      new Date()
        .toISOString(),

    rawWaterInflow,

    demiProduction,

    pureWaterUsage,

    rawWaterTankAmount:
      storageAmounts[
        0
      ],

    rawWaterTankRate:
      storageRates[
        0
      ],

    filteredWaterTankAmount:
      storageAmounts[
        1
      ],

    filteredWaterTankRate:
      storageRates[
        1
      ],

    demiWaterTankAmount:
      storageAmounts[
        2
      ],

    demiWaterTankRate:
      storageRates[
        2
      ]
  };


  console.log(
    "OIS 수처리 최종 추출값:",
    result
  );


  return result;
}

/* =========================================================
  추출 결과 JSON 저장
========================================================= */

function saveOisWaterTreatmentValues(
  values
) {
  const outputPath =
    path.join(
      process.cwd(),
      "ois-water-values.json"
    );


  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      values,
      null,
      2
    ),
    "utf8"
  );


  return outputPath;
}

/* =========================================================
  OIS 일일 운전일지(환경) 기준일 변경 및 조회
========================================================= */

async function setOisEnvironmentDate(
  page,
  targetDate
) {
  const normalizedDate =
    String(
      targetDate ||
      ""
    )
      .trim()
      .replace(
        /-/g,
        "/"
      );


  if (
    !/^\d{4}\/\d{2}\/\d{2}$/.test(
      normalizedDate
    )
  ) {
    throw new Error(
      "OIS 조회일은 YYYY-MM-DD 형식으로 입력해 주세요."
    );
  }


  const environmentFrame =
    await openOisEnvironmentDailyLog(
      page
    );


  console.log(
    `OIS 기준일을 ${normalizedDate}로 변경합니다.`
  );


  /* =====================================================
    현재 YYYY/MM/DD 형식의 값이 들어 있는 날짜 입력칸 검색
  ====================================================== */

  const inputs =
    environmentFrame.locator(
      "input"
    );


  const inputCount =
    await inputs.count();


  let dateInput =
    null;


  for (
    let index = 0;
    index <
      inputCount;
    index +=
      1
  ) {
    const input =
      inputs.nth(
        index
      );


    const inputType =
      String(
        await input
          .getAttribute(
            "type"
          )
          .catch(
            () => ""
          ) ||
        ""
      )
        .trim()
        .toLowerCase();


    if (
      [
        "hidden",
        "button",
        "submit",
        "checkbox",
        "radio"
      ].includes(
        inputType
      )
    ) {
      continue;
    }


    const currentValue =
      String(
        await input
          .inputValue()
          .catch(
            () => ""
          )
      ).trim();


    if (
      /^\d{4}\/\d{2}\/\d{2}$/.test(
        currentValue
      )
    ) {
      dateInput =
        input;


      break;
    }
  }


  /* =====================================================
    값 기준 검색 실패 시 '기준일' 뒤 입력칸 검색
  ====================================================== */

  if (
    !dateInput
  ) {
    const labelBasedInput =
      environmentFrame.locator(
        `
          xpath=
          //*[contains(
            normalize-space(.),
            "기준일"
          )]
          /following::input[1]
        `
      );


    if (
      await labelBasedInput
        .count()
        .catch(
          () => 0
        ) >
        0
    ) {
      dateInput =
        labelBasedInput.first();
    }
  }


  if (
    !dateInput
  ) {
    throw new Error(
      "OIS 기준일 입력칸을 찾지 못했습니다."
    );
  }


  /* =====================================================
    TossPlatform 입력값 변경 이벤트까지 발생
  ====================================================== */

  await dateInput.evaluate(
    (
      element,
      value
    ) => {
      element.focus();


      element.value =
        value;


      element.dispatchEvent(
        new Event(
          "input",
          {
            bubbles:
              true
          }
        )
      );


      element.dispatchEvent(
        new Event(
          "change",
          {
            bubbles:
              true
          }
        )
      );


      element.blur();
    },
    normalizedDate
  );


  /* =====================================================
    조회 버튼 찾기
  ====================================================== */

  const queryCandidates = [
    environmentFrame.getByRole(
      "button",
      {
        name:
          "조회",

        exact:
          true
      }
    ),

    environmentFrame.locator(
      'input[type="button"][value="조회"]'
    ),

    environmentFrame.locator(
      'input[type="submit"][value="조회"]'
    ),

    environmentFrame.getByText(
      "조회",
      {
        exact:
          true
      }
    )
  ];


  let queryButton =
    null;


  for (
    const candidate of
    queryCandidates
  ) {
    const candidateCount =
      await candidate
        .count()
        .catch(
          () => 0
        );


    for (
      let index = 0;
      index <
        candidateCount;
      index +=
        1
    ) {
      const target =
        candidate.nth(
          index
        );


      const isVisible =
        await target
          .isVisible()
          .catch(
            () => false
          );


      if (
        isVisible
      ) {
        queryButton =
          target;


        break;
      }
    }


    if (
      queryButton
    ) {
      break;
    }
  }


  if (
    !queryButton
  ) {
    throw new Error(
      "OIS 조회 버튼을 찾지 못했습니다."
    );
  }


  await queryButton.click({
    timeout:
      10000,

    force:
      true
  });


  /* =====================================================
    조회 결과 날짜 확인

    예:
    2026년 08월 04일
  ====================================================== */

  const [
    year,
    month,
    day
  ] =
    normalizedDate.split(
      "/"
    );


  const expectedDateText =
    `${year}년 ${month}월 ${day}일`;


  const timeoutMilliseconds =
    30000;


  const startedAt =
    Date.now();


  while (
    Date.now() -
      startedAt <
    timeoutMilliseconds
  ) {
    const bodyText =
      normalizeOisText(
        await environmentFrame
          .locator(
            "body"
          )
          .innerText()
          .catch(
            () => ""
          )
      );


    if (
      bodyText.includes(
        expectedDateText
      )
    ) {
      console.log(
        `${expectedDateText} 환경자료 조회가 완료되었습니다.`
      );


      return environmentFrame;
    }


    await page.waitForTimeout(
      500
    );
  }


  throw new Error(
    `${expectedDateText} 조회 결과가 화면에 표시되지 않았습니다.`
  );
}

/* =========================================================
  OIS 환경일지 재계산 버튼 클릭
========================================================= */

async function clickOisEnvironmentRecalculateButton(
  page
) {
  const environmentFrame =
    await openOisEnvironmentDailyLog(
      page
    );


  const candidates = [
    environmentFrame.getByRole(
      "button",
      {
        name:
          "재계산",

        exact:
          true
      }
    ),

    environmentFrame.locator(
      'input[type="button"][value="재계산"]'
    ),

    environmentFrame.locator(
      'input[type="submit"][value="재계산"]'
    ),

    environmentFrame.getByText(
      "재계산",
      {
        exact:
          true
      }
    )
  ];


  let recalculateButton =
    null;


  for (
    const candidate of
    candidates
  ) {
    const candidateCount =
      await candidate
        .count()
        .catch(
          () => 0
        );


    for (
      let index = 0;
      index <
        candidateCount;
      index +=
        1
    ) {
      const target =
        candidate.nth(
          index
        );


      const isVisible =
        await target
          .isVisible()
          .catch(
            () => false
          );


      if (
        !isVisible
      ) {
        continue;
      }


      recalculateButton =
        target;


      break;
    }


    if (
      recalculateButton
    ) {
      break;
    }
  }


  if (
    !recalculateButton
  ) {
    throw new Error(
      "OIS 환경일지의 재계산 버튼을 찾지 못했습니다."
    );
  }


  try {
    await recalculateButton.click({
      timeout:
        10000,

      force:
        true
    });

  } catch {
    await recalculateButton.evaluate(
      element => {
        const clickableElement =
          element.closest(
            `
              button,
              input,
              a,
              [onclick],
              [role="button"]
            `
          ) ||
          element;


        clickableElement.dispatchEvent(
          new MouseEvent(
            "click",
            {
              bubbles:
                true,

              cancelable:
                true,

              view:
                window
            }
          )
        );
      }
    );
  }


  console.log(
    "OIS 환경일지 재계산 버튼을 클릭했습니다."
  );


  await page.waitForTimeout(
    1000
  );


  return environmentFrame;
}


/* =========================================================
  재계산 완료 후 수처리 9개 값 대기
========================================================= */

async function waitForOisWaterTreatmentValues(
  page,
  targetDate
) {
  const startedAt =
    Date.now();


  let lastError =
    null;


  while (
    Date.now() -
      startedAt <
    OIS_QUERY_TIMEOUT
  ) {
    try {
      const values =
        await extractOisWaterTreatmentValues(
          page
        );


      const sourceDate =
        normalizeOisAgentText(
          values?.sourceDate
        );


      if (
        sourceDate &&
        sourceDate !==
          targetDate
      ) {
        throw new Error(
          [
            "OIS 환경일지 기준일이 다릅니다.",
            `요청일 ${targetDate}`,
            `화면일 ${sourceDate}`
          ].join(
            " · "
          )
        );
      }


      return {
        ...values,

        targetDate,

        sourceDate:
          sourceDate ||
          targetDate,

        collectedAt:
          normalizeOisAgentText(
            values?.collectedAt
          ) ||
          new Date()
            .toISOString()
      };

    } catch (
      error
    ) {
      lastError =
        error;


      await page.waitForTimeout(
        500
      );
    }
  }


  throw (
    lastError ||
    new Error(
      "OIS 수처리 값을 제한 시간 안에 읽지 못했습니다."
    )
  );
}


/* =========================================================
  선택일 OIS 수처리 현황 수집

  처리:
  1. OIS 로그인 확인
  2. 일일 운전일지(환경) 열기
  3. 기준일 변경
  4. 조회
  5. 재계산
  6. 수처리 9개 값 추출
========================================================= */

async function collectOisWaterTreatmentValues(
  page,
  config,
  targetDate
) {
  if (
    !isValidOisAgentDate(
      targetDate
    )
  ) {
    throw new Error(
      "OIS 수처리 조회 날짜가 올바르지 않습니다."
    );
  }


  await ensureOisAgentLoggedIn(
    page,
    config
  );


  await setOisEnvironmentDate(
    page,
    targetDate
  );


  await clickOisEnvironmentRecalculateButton(
    page
  );


  const result =
    await waitForOisWaterTreatmentValues(
      page,
      targetDate
    );


  const outputPath =
    saveOisWaterTreatmentValues(
      result
    );


  console.log(
    "OIS 수처리 결과 JSON 저장:",
    outputPath
  );


  return result;
}

/* =========================================================
  잠시 대기
========================================================= */

function waitOisAgent(
  milliseconds
) {
  return new Promise(
    resolve => {
      setTimeout(
        resolve,
        milliseconds
      );
    }
  );
}


/* =========================================================
  문자열 정리
========================================================= */

function normalizeOisAgentText(
  value
) {
  return String(
    value ??
    ""
  )
    .replace(
      /\u00a0/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


/* =========================================================
  날짜 검사
========================================================= */

function isValidOisAgentDate(
  value
) {
  const normalizedDate =
    normalizeOisAgentText(
      value
    );


  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      normalizedDate
    )
  ) {
    return false;
  }


  const parsedDate =
    new Date(
      `${normalizedDate}T00:00:00`
    );


  if (
    Number.isNaN(
      parsedDate.getTime()
    )
  ) {
    return false;
  }


  return [
    parsedDate.getFullYear(),

    String(
      parsedDate.getMonth() +
      1
    ).padStart(
      2,
      "0"
    ),

    String(
      parsedDate.getDate()
    ).padStart(
      2,
      "0"
    )
  ].join(
    "-"
  ) ===
    normalizedDate;
}


/* =========================================================
  날짜 더하기
========================================================= */

function addOisAgentDateDays(
  dateValue,
  dayCount
) {
  const parsedDate =
    new Date(
      `${dateValue}T00:00:00`
    );


  if (
    Number.isNaN(
      parsedDate.getTime()
    )
  ) {
    return "";
  }


  parsedDate.setDate(
    parsedDate.getDate() +
    Number(
      dayCount ||
      0
    )
  );


  return [
    parsedDate.getFullYear(),

    String(
      parsedDate.getMonth() +
      1
    ).padStart(
      2,
      "0"
    ),

    String(
      parsedDate.getDate()
    ).padStart(
      2,
      "0"
    )
  ].join(
    "-"
  );
}


/* =========================================================
  OIS 숫자 변환
========================================================= */

function parseOisAgentNumber(
  value
) {
  const normalizedValue =
    normalizeOisAgentText(
      value
    )
      .replace(
        /,/g,
        ""
      );


  if (
    !/^-?\d+(?:\.\d+)?$/.test(
      normalizedValue
    )
  ) {
    return null;
  }


  const numericValue =
    Number(
      normalizedValue
    );


  return Number.isFinite(
    numericValue
  )
    ? Math.round(
        numericValue *
        1000
      ) /
      1000
    : null;
}


/* =========================================================
  프로그램 환경설정 확인
========================================================= */

function getOisAgentConfig() {
  const userId =
    normalizeOisAgentText(
      process.env.OIS_ID
    );


  const password =
    String(
      process.env.OIS_PASSWORD ||
      ""
    );


  const agentKey =
    normalizeOisAgentText(
      process.env.OIS_AGENT_KEY
    );


  const agentId =
    normalizeOisAgentText(
      process.env.OIS_AGENT_ID
    ) ||
    "OIS-COMPANY-PC";


  const shiftLogBaseUrl =
    normalizeOisAgentText(
      process.env.SHIFT_LOG_BASE_URL
    ) ||
    DEFAULT_SHIFT_LOG_BASE_URL;


  const requestedAgentMode =
    normalizeOisAgentText(
      process.env.OIS_AGENT_MODE
    )
      .toLowerCase()
      .replace(
        /[\s-]+/g,
        "_"
      );


  const hasOisLoginCredentials =
    Boolean(
      userId &&
      password
    );


  const agentMode =
    [
      "excel",
      "excel_only"
    ].includes(
      requestedAgentMode
    )
      ? "excel"
      : [
          "hybrid",
          "ois"
        ].includes(
          requestedAgentMode
        )
        ? "hybrid"
        : hasOisLoginCredentials
          ? "hybrid"
          : "excel";


  if (
    !agentKey
  ) {
    throw new Error(
      "OIS_AGENT_KEY 환경변수가 설정되지 않았습니다."
    );
  }


  if (
    agentMode ===
      "hybrid" &&
    !hasOisLoginCredentials
  ) {
    throw new Error(
      [
        "OIS + Excel 연동 모드에는 OIS 계정 설정이 필요합니다.",
        "OIS_ID와 OIS_PASSWORD를 설정하거나,",
        "집 PC에서는 OIS_AGENT_MODE=excel을 사용해 주세요."
      ].join(
        "\n"
      )
    );
  }


  return {
    userId,

    password,

    agentKey,

    agentId,

    agentMode,

    shiftLogBaseUrl:
      shiftLogBaseUrl.replace(
        /\/+$/,
        ""
      )
  };
}

/* =========================================================
  OIS 브라우저를 실제로 사용할 때만 계정 확인
========================================================= */

function assertOisLoginCredentials(
  config
) {
  const missingKeys = [];


  if (
    !normalizeOisAgentText(
      config?.userId
    )
  ) {
    missingKeys.push(
      "OIS_ID"
    );
  }


  if (
    !String(
      config?.password ||
      ""
    )
  ) {
    missingKeys.push(
      "OIS_PASSWORD"
    );
  }


  if (
    missingKeys.length >
      0
  ) {
    throw new Error(
      [
        "OIS 조회 요청을 처리하려면 OIS 계정 설정이 필요합니다.",
        `누락 항목: ${missingKeys.join(", ")}`,
        "일일 DATA Excel 요청은 이 설정 없이도 처리됩니다."
      ].join(
        "\n"
      )
    );
  }
}


/* =========================================================
  업무일지 OIS 요청 API 주소
========================================================= */

function getOisAgentApiUrl(
  config,
  query = {}
) {
  const requestUrl =
    new URL(
      OIS_REQUEST_API_PATH,
      config.shiftLogBaseUrl
    );


  Object.entries(
    query
  ).forEach(
    (
      [
        key,
        value
      ]
    ) => {
      if (
        value ===
          undefined ||
        value ===
          null ||
        value ===
          ""
      ) {
        return;
      }


      requestUrl.searchParams.set(
        key,
        String(
          value
        )
      );
    }
  );


  return requestUrl.toString();
}


/* =========================================================
  에이전트 API 요청
========================================================= */

async function requestOisAgentApi(
  config,
  requestUrl,
  options = {}
) {
  const response =
    await fetch(
      requestUrl,
      {
        method:
          options.method ||
          "GET",

        headers: {
          Accept:
            "application/json",

          "X-OIS-Agent-Key":
            config.agentKey,

          "X-OIS-Agent-Id":
            config.agentId,

          ...(
            options.body
              ? {
                  "Content-Type":
                    "application/json"
                }
              : {}
          )
        },

        cache:
          "no-store",

        body:
          options.body
            ? JSON.stringify(
                options.body
              )
            : undefined
      }
    );


  const responseText =
    await response.text();


  let result = {};


  if (
    responseText.trim()
  ) {
    try {
      result =
        JSON.parse(
          responseText
        );

    } catch {
      throw new Error(
        "업무일지 OIS API 응답이 JSON 형식이 아닙니다."
      );
    }
  }


  if (
    !response.ok ||
    result.ok ===
      false
  ) {
    throw new Error(
      result.message ||
      result.error ||
      `업무일지 OIS API 요청 실패 (HTTP ${response.status})`
    );
  }


  return result;
}

/* =========================================================
  로그인된 OIS 브라우저에서
  /ajax/data 직접 요청

  OIS는 application/x-www-form-urlencoded 형식으로:

  tossdata=...
  cmd=...

  두 값을 전송한다.
========================================================= */

async function requestOisInternalAjaxData(
  page,
  command,
  selectItem
) {
  const requestResult =
    await page.evaluate(
      async (
        {
          command,
          selectItem
        }
      ) => {
        const parameters =
          new URLSearchParams();


        parameters.set(
          "tossdata",
          JSON.stringify({
            select: [
              selectItem
            ]
          })
        );


        parameters.set(
          "cmd",
          command
        );


        const response =
          await fetch(
            "/ajax/data",
            {
              method:
                "POST",

              headers: {
                Accept:
                  "application/json, text/javascript, */*; q=0.01",

                "Content-Type":
                  "application/x-www-form-urlencoded; charset=UTF-8",

                "X-Requested-With":
                  "XMLHttpRequest"
              },

              credentials:
                "same-origin",

              cache:
                "no-store",

              body:
                parameters.toString()
            }
          );


        const responseText =
          await response.text();


        return {
          ok:
            response.ok,

          status:
            response.status,

          responseText
        };
      },

      {
        command,
        selectItem
      }
    );


  if (
    !requestResult?.ok
  ) {
    throw new Error(
      `OIS 내부 API 요청 실패 (HTTP ${requestResult?.status || 0})`
    );
  }


  const responseText =
    String(
      requestResult.responseText ||
      ""
    ).trim();


  if (
    !responseText
  ) {
    return {};
  }


  let responseData = {};


  try {
    responseData =
      JSON.parse(
        responseText
      );

  } catch {
    throw new Error(
      "OIS 과거 업무일지 응답이 JSON 형식이 아닙니다."
    );
  }


  return responseData;
}


/* =========================================================
  선택일 OIS 과거 LOG SHEET 업무일지 수집

  조회:
  - 설비운영팀
  - 선택일
  - All 근무

  대상:
  - TGO
  - BCO1
  - BCO2
  - TO
  - BO1
  - BO2

  원본 근무:
  - DAY
  - AFTER
  - NIGHT

  중요:
  이 단계에서는 2교대/3교대를 변환하지 않는다.
  OIS 원본을 그대로 반환한다.
========================================================= */

async function collectOisLegacyLogApprovalValues(
  page,
  config,
  targetDate
) {
  if (
    !isValidOisAgentDate(
      targetDate
    )
  ) {
    throw new Error(
      "OIS 과거 업무일지 조회 날짜가 올바르지 않습니다."
    );
  }


  await ensureOisAgentLoggedIn(
    page,
    config
  );


  const compactDate =
    targetDate.replace(
      /-/g,
      ""
    );


  const responseData =
    await requestOisInternalAjaxData(
      page,

      OIS_LEGACY_LOG_DEFINITION
        .command,

      {
        schepow_stat_code:
          OIS_LEGACY_LOG_DEFINITION
            .plantCode,

        dept_code:
          OIS_LEGACY_LOG_DEFINITION
            .departmentCode,

        schbase_date:
          compactDate,

        s_time:
          OIS_LEGACY_LOG_DEFINITION
            .allShiftCode,

        rowstatus:
          OIS_LEGACY_LOG_DEFINITION
            .rowStatus
      }
    );


  const rawRows =
    Array.isArray(
      responseData?.result
    )
      ? responseData.result
      : [];


  const allowedRoles =
    new Set(
      OIS_LEGACY_LOG_DEFINITION
        .roles
    );


  const records =
    rawRows
      .map(
        (
          row,
          sourceRowIndex
        ) => {
          const role =
            normalizeOisAgentText(
              row?.sheet_alias ||
              row?.sheetAlias ||
              ""
            )
              .toUpperCase();


          if (
            !allowedRoles.has(
              role
            )
          ) {
            return null;
          }


          const originalShift =
            normalizeOisAgentText(
              row?.time ||
              row?.work_time ||
              ""
            )
              .toUpperCase();


          const content =
            normalizeOisMultilineText(
              row?.rmk ||
              ""
            );


          return {
            date:
              targetDate,

            role,

            /*
              OIS 원래 근무형태

              DAY
              AFTER
              NIGHT
            */
            originalShift,

            worker:
              normalizeOisAgentText(
                row?.worker ||
                ""
              ),

            /*
              실제 과거 업무일지 내용
              줄바꿈을 그대로 보존한다.
            */
            content,

            hasContent:
              Boolean(
                content
              ),

            workerApproval:
              normalizeOisAgentText(
                row?.work_state ||
                ""
              ),

            partApproval:
              normalizeOisAgentText(
                row?.part_state ||
                ""
              ),

            approvalState:
              normalizeOisAgentText(
                row?.aprv_state ||
                ""
              ),

            state:
              normalizeOisAgentText(
                row?.state ||
                ""
              ),

            sheetCode:
              normalizeOisAgentText(
                row?.sheet ||
                row?.sheet_code ||
                row?.pos_info_code ||
                ""
              ),

            sourceRowIndex,

            /*
              향후 변환 오류가 있어도
              OIS 원본을 복구할 수 있도록
              전체 행을 그대로 보관한다.
            */
            original:
              row
          };
        }
      )
      .filter(
        Boolean
      );


  const countContentRows = (
    shiftName
  ) => {
    return records.filter(
      record => {
        return (
          record.originalShift ===
            shiftName &&
          record.hasContent
        );
      }
    ).length;
  };


  const dayContentCount =
    countContentRows(
      "DAY"
    );


  const afterContentCount =
    countContentRows(
      "AFTER"
    );


  const nightContentCount =
    countContentRows(
      "NIGHT"
    );


  const contentRowCount =
    records.filter(
      record => {
        return record.hasContent;
      }
    ).length;


  const result = {
    source:
      "OIS 로그시트 결재 조회",

    command:
      OIS_LEGACY_LOG_DEFINITION
        .command,

    targetDate,

    departmentCode:
      OIS_LEGACY_LOG_DEFINITION
        .departmentCode,

    rawRowCount:
      rawRows.length,

    targetRoleRowCount:
      records.length,

    contentRowCount,

    /*
      교대체계 판단 참고자료

      여기서는 자동으로
      2교대/3교대라고 확정하지 않는다.
    */
    shiftEvidence: {
      dayContentCount,

      afterContentCount,

      nightContentCount,

      hasAfterContent:
        afterContentCount >
        0,

      onlyDayNightHaveContent:
        afterContentCount ===
          0 &&
        (
          dayContentCount >
            0 ||
          nightContentCount >
            0
        )
    },

    records,

    collectedAt:
      new Date()
        .toISOString()
  };


  console.log(
    [
      "OIS 과거 업무일지 조회 완료",
      targetDate,
      `대상 ${records.length}건`,
      `내용 있음 ${contentRowCount}건`,
      `DAY ${dayContentCount}건`,
      `AFTER ${afterContentCount}건`,
      `NIGHT ${nightContentCount}건`
    ].join(
      " · "
    )
  );


  return result;
}

/* =========================================================
  다음 대기 요청 가져오기

  지원:
  - water_environment
  - limestone_stock
  - auxiliary_materials
  - turbine_gear_pinion
  - silo_level
  - daily_data_excel
  - steam_status
  - logsheet_approval

  daily_data_excel:
  - 현재 Excel 전용 요청

  steam_status:
  - 배포 전 생성된 기존 요청 호환용

  여덟 요청 유형을 번갈아 확인한다.
========================================================= */

async function getNextOisAgentRequest(
  config
) {
  const excelRequestTypes = [
    "daily_data_excel",
    "steam_status"
  ];


  const oisRequestTypes = [
    "water_environment",
    "limestone_stock",
    "auxiliary_materials",
    "turbine_gear_pinion",
    "silo_level",
    "logsheet_approval"
  ];


  const requestTypes =
    config.agentMode ===
      "excel"
      ? excelRequestTypes
      : [
          ...oisRequestTypes,
          ...excelRequestTypes
        ];


  const startIndex =
    Number(
      getNextOisAgentRequest
        .nextTypeIndex ||
      0
    ) %
    requestTypes.length;


  for (
    let offset = 0;
    offset <
      requestTypes.length;
    offset +=
      1
  ) {
    const requestTypeIndex =
      (
        startIndex +
        offset
      ) %
      requestTypes.length;


    const requestType =
      requestTypes[
        requestTypeIndex
      ];


    const result =
      await requestOisAgentApi(
        config,

        getOisAgentApiUrl(
          config,
          {
            action:
              "next",

            requestType,

            _:
              Date.now()
          }
        )
      );


    if (
      result.item
    ) {
      getNextOisAgentRequest
        .nextTypeIndex =
        (
          requestTypeIndex +
          1
        ) %
        requestTypes.length;


      return result.item;
    }
  }


  getNextOisAgentRequest
    .nextTypeIndex =
    (
      startIndex +
      1
    ) %
    requestTypes.length;


  return null;
}

/* =========================================================
  요청 유형 정규화
========================================================= */

function getOisAgentRequestType(
  requestItem
) {
  const requestType =
    normalizeOisAgentText(
      requestItem?.requestType ||
      requestItem?.request_type
    )
      .toLowerCase();


  /*
    기존 석회석 요청에는 유형이 없을 수도 있으므로
    limestone_stock을 기본값으로 사용한다.
  */

  return (
    requestType ||
    "limestone_stock"
  );
}

/* =========================================================
  OIS 브라우저가 필요 없는 Excel 전용 요청

  steam_status는 기존 배포본이 만든 대기 요청을
  계속 처리하기 위한 호환 유형이다.
========================================================= */

function isDailyDataExcelRequestType(
  requestType
) {
  const normalizedRequestType =
    normalizeOisAgentText(
      requestType
    )
      .toLowerCase();


  return [
    "daily_data_excel",
    "steam_status"
  ].includes(
    normalizedRequestType
  );
}

/* =========================================================
  요청 유형 표시 이름
========================================================= */

function getOisAgentRequestLabel(
  requestType
) {
  if (
    requestType ===
      "water_environment"
  ) {
    return "수처리 현황";
  }


  if (
    requestType ===
      "limestone_stock"
  ) {
    return "석회석 재고";
  }


if (
  requestType ===
    "auxiliary_materials"
) {
  return "부재료 일별 자료";
}


if (
  requestType ===
    "turbine_gear_pinion"
) {
  return "Gear Wheel / Pinion";
}


  if (
    requestType ===
      "silo_level"
  ) {
    return "Silo Level";
  }


  if (
    isDailyDataExcelRequestType(
      requestType
    )
  ) {
    return "일일 DATA 현황";
  }


  if (
    requestType ===
      "logsheet_approval"
  ) {
    return "과거 LOG SHEET 업무일지";
  }


  return requestType;
}

/* =========================================================
  DataPARC 증기 생산량 자동 조회

  열린 월간 적산 Excel에서 증기 누적값을 직접 읽는다.

  - 새 통합문서·임시 시트를 만들지 않는다.
  - DataPARC 수식 입력·재계산을 하지 않는다.
  - 사용자가 연 Excel을 저장·종료하지 않는다.
========================================================= */

const DATAPARC_STEAM_OPEN_WORKBOOK_POWERSHELL_SCRIPT =
  String.raw`
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8

$excel = $null
$workbooks = $null
$workbook = $null
$worksheets = $null
$plantWorksheet = $null
$dataWorksheet = $null
$usedRange = $null
$usedRows = $null
$usedColumns = $null
$headerRange = $null
$dateRange = $null

$stageMarker = "__DAILY_DATA_WORKBOOK_STAGE__"

function Write-DailyDataStage {
  param(
    [string]$Message
  )

  [Console]::WriteLine(
    $stageMarker + $Message
  )

  [Console]::Out.Flush()
}

function Release-ExcelComObject {
  param(
    $Value
  )

  if (
    $null -eq $Value
  ) {
    return
  }

  try {
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject(
      $Value
    )
  }
  catch {
  }
}

function Normalize-ExcelText {
  param(
    $Value
  )

  if (
    $null -eq $Value -or
    $Value -is [Runtime.InteropServices.ErrorWrapper]
  ) {
    return ""
  }

  $normalizedText =
    [regex]::Replace(
      [string]$Value,
      '\s+',
      ' '
    )

  $normalizedText =
    $normalizedText.Trim()

  return $normalizedText.Normalize(
    [Text.NormalizationForm]::FormC
  )
}


function ConvertTo-ExcelColumnName {
  param(
    [int]$ColumnNumber
  )

  [string]$columnName =
    ""

  [int]$remaining =
    $ColumnNumber

  while (
    $remaining -gt 0
  ) {
    $remaining -=
      1

    $columnName =
      [char](
        65 +
        (
          $remaining %
          26
        )
      ) +
      $columnName

    $remaining =
      [int][Math]::Floor(
        $remaining /
        26
      )
  }

  return $columnName
}

function Get-ExcelAddress {
  param(
    [int]$RowNumber,
    [int]$ColumnNumber
  )

  return (
    (
      ConvertTo-ExcelColumnName -ColumnNumber $ColumnNumber
    ) +
    [string]$RowNumber
  )
}

function Read-ExcelCellValue {
  param(
    $Worksheet,
    [string]$Address
  )

  $cell =
    $null

  try {
    $cell =
      $Worksheet.Range(
        $Address
      )

    return $cell.Value2
  }
  finally {
    Release-ExcelComObject -Value $cell
  }
}

function Get-FiniteExcelNumber {
  param(
    $Value,
    [string]$Label,
    [bool]$AllowBlank = $false
  )

  if (
    $null -eq $Value -or
    $Value -is [Runtime.InteropServices.ErrorWrapper] -or
    (
      $Value -is [string] -and
      [string]::IsNullOrWhiteSpace(
        $Value
      )
    )
  ) {
    if (
      $AllowBlank
    ) {
      return $null
    }

    throw (
      $Label +
      "이 비어 있거나 Excel 오류값입니다."
    )
  }

  if (
    $Value -is [bool]
  ) {
    throw (
      $Label +
      "을 숫자로 읽지 못했습니다."
    )
  }

  try {
    $numericValue =
      [Convert]::ToDouble(
        $Value,
        [Globalization.CultureInfo]::InvariantCulture
      )
  }
  catch {
    throw (
      $Label +
      "을 숫자로 읽지 못했습니다."
    )
  }

  if (
    [double]::IsNaN(
      $numericValue
    ) -or
    [double]::IsInfinity(
      $numericValue
    )
  ) {
    throw (
      $Label +
      "이 올바른 숫자가 아닙니다."
    )
  }

  return $numericValue
}

function Test-ExcelTimestamp {
  param(
    $Value,
    [datetime]$Target,
    [bool]$Date1904
  )

  if (
    $null -eq $Value -or
    $Value -is [bool] -or
    $Value -is [Runtime.InteropServices.ErrorWrapper]
  ) {
    return $false
  }

  if (
    $Value -is [datetime]
  ) {
    return (
      [Math]::Abs(
        (
          $Value -
          $Target
        ).TotalSeconds
      ) -le 1
    )
  }

  if (
    $Value -isnot [string]
  ) {
    try {
      $numericValue =
        [Convert]::ToDouble(
          $Value,
          [Globalization.CultureInfo]::InvariantCulture
        )

      $expectedSerial =
        $Target.ToOADate()

      if (
        $Date1904
      ) {
        $expectedSerial -=
          1462
      }

      return (
        [Math]::Abs(
          $numericValue -
          $expectedSerial
        ) -le
          (
            1.0 /
            86400.0
          )
      )
    }
    catch {
      return $false
    }
  }

  $text =
    $Value.Trim()

  $formats =
    [string[]]@(
      "yyyy-MM-dd HH:mm:ss",
      "yyyy-MM-dd HH:mm",
      "yyyy-MM-dd",
      "yyyy/M/d HH:mm:ss",
      "yyyy/M/d HH:mm",
      "yyyy/M/d",
      "M/d/yyyy HH:mm:ss",
      "M/d/yyyy HH:mm",
      "M/d/yyyy"
    )

  $parsedValue =
    [datetime]::MinValue

  if (
    [datetime]::TryParseExact(
      $text,
      $formats,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::AllowWhiteSpaces,
      [ref]$parsedValue
    )
  ) {
    return (
      [Math]::Abs(
        (
          $parsedValue -
          $Target
        ).TotalSeconds
      ) -le 1
    )
  }

  return $false
}

function Read-XlsxZipEntryText {
  param(
    $Archive,
    [string]$EntryName
  )

  $entry =
    $Archive.GetEntry(
      $EntryName.Replace(
        "\",
        "/"
      )
    )

  if (
    $null -eq $entry
  ) {
    throw (
      "Excel 내부 파일을 찾지 못했습니다: " +
      $EntryName
    )
  }

  $stream =
    $null

  $reader =
    $null

  try {
    $stream =
      $entry.Open()

    $reader =
      [System.IO.StreamReader]::new(
        $stream,
        [Text.Encoding]::UTF8,
        $true
      )

    return $reader.ReadToEnd()
  }
  finally {
    if (
      $null -ne $reader
    ) {
      $reader.Dispose()
    }

    if (
      $null -ne $stream
    ) {
      $stream.Dispose()
    }
  }
}

function Read-SolarHistoryWorkbookValues {
  param(
    [string]$WorkbookPath,
    [datetime]$MonthDate
  )

  if (
    !(
      Test-Path -LiteralPath $WorkbookPath -PathType Leaf
    )
  ) {
    throw (
      "태양광 누적 계산용 파일을 찾지 못했습니다: " +
      $WorkbookPath
    )
  }

  [void][Reflection.Assembly]::LoadWithPartialName(
    "System.IO.Compression"
  )

  [void][Reflection.Assembly]::LoadWithPartialName(
    "System.IO.Compression.FileSystem"
  )

  $archive =
    $null

  try {
    $archive =
      [System.IO.Compression.ZipFile]::OpenRead(
        $WorkbookPath
      )

    [xml]$workbookDocument =
      Read-XlsxZipEntryText -Archive $archive -EntryName "xl/workbook.xml"

    $workbookNamespaces =
      [System.Xml.XmlNamespaceManager]::new(
        $workbookDocument.NameTable
      )

    $workbookNamespaces.AddNamespace(
      "x",
      "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    )

    $workbookNamespaces.AddNamespace(
      "r",
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    )

    $plantSheet =
      $workbookDocument.SelectSingleNode(
        "//x:sheets/x:sheet[@name='Plant']",
        $workbookNamespaces
      )

    if (
      $null -eq $plantSheet
    ) {
      throw "통합문서에서 Plant 시트를 찾지 못했습니다."
    }

    $relationshipId =
      $plantSheet.GetAttribute(
        "id",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
      )

    [xml]$relationshipDocument =
      Read-XlsxZipEntryText -Archive $archive -EntryName "xl/_rels/workbook.xml.rels"

    $relationshipNamespaces =
      [System.Xml.XmlNamespaceManager]::new(
        $relationshipDocument.NameTable
      )

    $relationshipNamespaces.AddNamespace(
      "p",
      "http://schemas.openxmlformats.org/package/2006/relationships"
    )

    $relationship =
      $relationshipDocument.SelectSingleNode(
        (
          "//p:Relationship[@Id='" +
          $relationshipId +
          "']"
        ),
        $relationshipNamespaces
      )

    if (
      $null -eq $relationship
    ) {
      throw "Plant 시트의 내부 경로를 찾지 못했습니다."
    }

    $sheetEntryName =
      [string]$relationship.GetAttribute(
        "Target"
      )

    $sheetEntryName =
      $sheetEntryName.Replace(
        "\",
        "/"
      ).TrimStart(
        [char]"/"
      )

    if (
      !$sheetEntryName.StartsWith(
        "xl/"
      )
    ) {
      $sheetEntryName =
        "xl/" +
        $sheetEntryName
    }

    [xml]$plantDocument =
      Read-XlsxZipEntryText -Archive $archive -EntryName $sheetEntryName

    $plantNamespaces =
      [System.Xml.XmlNamespaceManager]::new(
        $plantDocument.NameTable
      )

    $plantNamespaces.AddNamespace(
      "x",
      "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    )

    $values =
      [ordered]@{}

    $daysInMonth =
      [datetime]::DaysInMonth(
        $MonthDate.Year,
        $MonthDate.Month
      )

    for (
      $day = 1;
      $day -le $daysInMonth;
      $day += 1
    ) {
      $columnName =
        ConvertTo-ExcelColumnName -ColumnNumber (
          5 +
          $day
        )

      $address =
        $columnName +
        "55"

      $cell =
        $plantDocument.SelectSingleNode(
          (
            "//x:sheetData/x:row/x:c[@r='" +
            $address +
            "']"
          ),
          $plantNamespaces
        )

      $dateKey =
        (
          Get-Date -Year $MonthDate.Year -Month $MonthDate.Month -Day $day
        ).ToString(
          "yyyy-MM-dd",
          [Globalization.CultureInfo]::InvariantCulture
        )

      if (
        $null -eq $cell
      ) {
        $values[$dateKey] =
          $null

        continue
      }

      if (
        [string]$cell.GetAttribute(
          "t"
        ) -eq
          "e"
      ) {
        throw (
          "태양광 값이 Excel 오류입니다: Plant!" +
          $address
        )
      }

      $valueNode =
        $cell.SelectSingleNode(
          "*[local-name()='v']"
        )

      if (
        $null -eq $valueNode -or
        [string]::IsNullOrWhiteSpace(
          [string]$valueNode.InnerText
        )
      ) {
        $values[$dateKey] =
          $null

        continue
      }

      $numericValue =
        Get-FiniteExcelNumber -Value $valueNode.InnerText -Label (
          "태양광 일일 발전량 (" +
          $dateKey +
          ", Plant!" +
          $address +
          ")"
        )

      if (
        $numericValue -lt 0
      ) {
        throw (
          "태양광 일일 발전량이 0보다 작습니다: " +
          $dateKey
        )
      }

      $values[$dateKey] =
        [double]$numericValue
    }

    return ,$values
  }
  finally {
    if (
      $null -ne $archive
    ) {
      $archive.Dispose()
    }
  }
}

function Resolve-SolarHistoryWorkbookPath {
  param(
    [string]$CurrentWorkbookFullName,
    [datetime]$MonthDate
  )

  $currentDirectory =
    Split-Path -Parent $CurrentWorkbookFullName

  $parentDirectory =
    Split-Path -Parent $currentDirectory

  $fileName =
    $MonthDate.ToString(
      "yy.MM",
      [Globalization.CultureInfo]::InvariantCulture
    ) +
    "-일일DATA관리.xlsx"

  $candidates =
    @(
      (
        Join-Path -Path $currentDirectory -ChildPath $fileName
      ),

      (
        Join-Path -Path (
          Join-Path -Path $parentDirectory -ChildPath (
            [string]$MonthDate.Year
          )
        ) -ChildPath $fileName
      )
    ) |
      Select-Object -Unique

  foreach (
    $candidate in
      $candidates
  ) {
    if (
      Test-Path -LiteralPath $candidate -PathType Leaf
    ) {
      return $candidate
    }
  }

  return $candidates[0]
}

function Get-SolarCumulativeRangeResult {
  param(
    $DailyValues,
    [datetime]$StartDate,
    [datetime]$EndDate
  )

  $total =
    0.0

  $missingDates =
    @()

  $cursor =
    $StartDate.Date

  while (
    $cursor -le
      $EndDate.Date
  ) {
    $dateKey =
      $cursor.ToString(
        "yyyy-MM-dd",
        [Globalization.CultureInfo]::InvariantCulture
      )

    if (
      !$DailyValues.Contains(
        $dateKey
      ) -or
      $null -eq $DailyValues[$dateKey]
    ) {
      $missingDates +=
        $dateKey
    }
    else {
      $total +=
        [double]$DailyValues[$dateKey]
    }

    $cursor =
      $cursor.AddDays(
        1
      )
  }

  $complete =
    $missingDates.Count -eq
      0

  $resultTotal =
    $null

  if (
    $complete
  ) {
    $resultTotal =
      [Math]::Round(
        $total,
        3
      )
  }

  return [ordered]@{
    startDate =
      $StartDate.ToString(
        "yyyy-MM-dd",
        [Globalization.CultureInfo]::InvariantCulture
      )

    endDate =
      $EndDate.ToString(
        "yyyy-MM-dd",
        [Globalization.CultureInfo]::InvariantCulture
      )

    complete =
      $complete

    total =
      $resultTotal

    missingDates =
      $missingDates
  }
}

function Get-SolarCumulativeWorkbookResult {
  param(
    $PlantWorksheet,
    [string]$WorkbookFullName,
    [datetime]$TargetDateValue,
    [string]$TargetDate,
    [double]$ExpectedDailyValue
  )

  $dailyValues =
    [ordered]@{}

  $sourceWorkbooks =
    @(
      $WorkbookFullName
    )

  $missingWorkbooks =
    @()

  $historyErrors =
    @()

  $day =
    1

  while (
    $day -le
      $TargetDateValue.Day
  ) {
    $columnName =
      ConvertTo-ExcelColumnName -ColumnNumber (
        5 +
        $day
      )

    $address =
      $columnName +
      "55"

    $dateValue =
      Get-Date -Year $TargetDateValue.Year -Month $TargetDateValue.Month -Day $day

    $dateKey =
      $dateValue.ToString(
        "yyyy-MM-dd",
        [Globalization.CultureInfo]::InvariantCulture
      )

    try {
      $solarValue =
        Get-FiniteExcelNumber -Value (
          Read-ExcelCellValue -Worksheet $PlantWorksheet -Address $address
        ) -Label (
          "태양광 일일 발전량 (" +
          $dateKey +
          ", Plant!" +
          $address +
          ")"
        )

      if (
        $solarValue -lt 0
      ) {
        throw (
          "태양광 일일 발전량이 0보다 작습니다: " +
          $dateKey
        )
      }

      $dailyValues[$dateKey] =
        [double]$solarValue
    }
    catch {
      $dailyValues[$dateKey] =
        $null

      $historyErrors +=
        $_.Exception.Message
    }

    $day +=
      1
  }

  $weekOffset =
    (
      [int]$TargetDateValue.DayOfWeek +
      6
    ) %
    7

  $weekStart =
    $TargetDateValue.AddDays(
      -$weekOffset
    ).Date

  $monthStart =
    Get-Date -Year $TargetDateValue.Year -Month $TargetDateValue.Month -Day 1

  $yearStart =
    Get-Date -Year $TargetDateValue.Year -Month 1 -Day 1

  $requiredMonths =
    [ordered]@{}

  $monthCursor =
    $yearStart

  while (
    $monthCursor -lt
      $monthStart
  ) {
    $monthKey =
      $monthCursor.ToString(
        "yyyy-MM",
        [Globalization.CultureInfo]::InvariantCulture
      )

    $requiredMonths[$monthKey] =
      $monthCursor

    $monthCursor =
      $monthCursor.AddMonths(
        1
      )
  }

  if (
    $weekStart -lt
      $monthStart
  ) {
    $weekMonthStart =
      Get-Date -Year $weekStart.Year -Month $weekStart.Month -Day 1

    $weekMonthKey =
      $weekMonthStart.ToString(
        "yyyy-MM",
        [Globalization.CultureInfo]::InvariantCulture
      )

    $requiredMonths[$weekMonthKey] =
      $weekMonthStart
  }

  if (
    [string]::IsNullOrWhiteSpace(
      $WorkbookFullName
    )
  ) {
    $historyErrors +=
      "현재 통합문서의 저장 경로를 확인하지 못했습니다."
  }
  else {
    foreach (
      $monthEntry in
        $requiredMonths.GetEnumerator()
    ) {
      $monthDate =
        [datetime]$monthEntry.Value

      $historyWorkbookPath =
        Resolve-SolarHistoryWorkbookPath -CurrentWorkbookFullName $WorkbookFullName -MonthDate $monthDate

      if (
        !(
          Test-Path -LiteralPath $historyWorkbookPath -PathType Leaf
        )
      ) {
        $missingWorkbooks +=
          $historyWorkbookPath

        $historyErrors +=
          (
            "태양광 누적 계산용 파일을 찾지 못했습니다: " +
            $historyWorkbookPath
          )

        continue
      }

      try {
        $historyValues =
          Read-SolarHistoryWorkbookValues -WorkbookPath $historyWorkbookPath -MonthDate $monthDate

        foreach (
          $historyEntry in
            $historyValues.GetEnumerator()
        ) {
          $dailyValues[$historyEntry.Key] =
            $historyEntry.Value
        }

        $sourceWorkbooks +=
          $historyWorkbookPath
      }
      catch {
        $historyErrors +=
          (
            [System.IO.Path]::GetFileName(
              $historyWorkbookPath
            ) +
            ": " +
            $_.Exception.Message
          )
      }
    }
  }

  $weeklyResult =
    Get-SolarCumulativeRangeResult -DailyValues $dailyValues -StartDate $weekStart -EndDate $TargetDateValue

  $monthlyResult =
    Get-SolarCumulativeRangeResult -DailyValues $dailyValues -StartDate $monthStart -EndDate $TargetDateValue

  $yearlyResult =
    Get-SolarCumulativeRangeResult -DailyValues $dailyValues -StartDate $yearStart -EndDate $TargetDateValue

  $targetSolarValue =
    $dailyValues[$TargetDate]

  if (
    $null -eq $targetSolarValue -or
    [Math]::Abs(
      [double]$targetSolarValue -
      $ExpectedDailyValue
    ) -gt 0.001
  ) {
    throw "태양광 일일값과 누적 계산의 조회일 값이 일치하지 않습니다."
  }

  return [ordered]@{
    source =
      "Plant!55 태양광 일일 발전량"

    week =
      $weeklyResult

    month =
      $monthlyResult

    year =
      $yearlyResult

    sourceWorkbooks =
      @(
        $sourceWorkbooks |
          Where-Object {
            ![string]::IsNullOrWhiteSpace(
              [string]$_
            )
          } |
          Select-Object -Unique
      )

    missingWorkbooks =
      @(
        $missingWorkbooks |
          Select-Object -Unique
      )

    errors =
      @(
        $historyErrors |
          Select-Object -Unique
      )
  }
}

try {
  Write-DailyDataStage -Message (
    "월간 일일DATA관리 Excel 조회 시작"
  )

  $targetDate =
    $env:GS_STEAM_TARGET_DATE

  $resultMarker =
    $env:GS_STEAM_RESULT_MARKER

  if (
    $targetDate -notmatch
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  ) {
    throw (
      "일일DATA관리 조회 날짜가 올바르지 않습니다: " +
      $targetDate
    )
  }

  $targetDateValue =
    [datetime]::ParseExact(
      $targetDate,
      "yyyy-MM-dd",
      [Globalization.CultureInfo]::InvariantCulture
    )

  $fieldDefinitions =
    @(
      $env:GS_DAILY_FIELDS_JSON |
        ConvertFrom-Json
    )

  $sludgeDefinitions =
    @(
      $env:GS_DAILY_SLUDGE_JSON |
        ConvertFrom-Json
    )

  $organicDefinitions =
    @(
      $env:GS_DAILY_ORGANIC_JSON |
        ConvertFrom-Json
    )

  if (
    $fieldDefinitions.Count -lt 1 -or
    $sludgeDefinitions.Count -ne 10 -or
    $organicDefinitions.Count -ne 3
  ) {
    throw "일일DATA관리 조회 정의를 읽지 못했습니다."
  }

  $expectedWorkbookName =
    (
      $targetDateValue.ToString(
        "yy.MM",
        [Globalization.CultureInfo]::InvariantCulture
      ) +
      "-일일DATA관리.xlsx"
    ).Normalize(
      [Text.NormalizationForm]::FormC
    )

  $expectedMonthText =
    $targetDateValue.ToString(
      "yyyy년 MM월",
      [Globalization.CultureInfo]::InvariantCulture
    )

  Write-DailyDataStage -Message (
    "실행 중인 Excel 연결 시도"
  )

  try {
    $excel =
      [Runtime.InteropServices.Marshal]::GetActiveObject(
        "Excel.Application"
      )
  }
  catch {
    throw (
      "실행 중인 Excel을 찾지 못했습니다. " +
      $expectedWorkbookName +
      "를 먼저 열어 주세요."
    )
  }

  if (
    $null -eq $excel
  ) {
    throw "실행 중인 Excel 연결 결과가 비어 있습니다."
  }

  Write-DailyDataStage -Message (
    "실행 중인 Excel 연결 완료"
  )

  $workbooks =
    $excel.Workbooks

  $openWorkbookNames =
    @()

  Write-DailyDataStage -Message (
    "대상 월 통합문서 찾기 · " +
    $expectedWorkbookName
  )

  for (
    $workbookIndex = 1;
    $workbookIndex -le
      [int]$workbooks.Count;
    $workbookIndex += 1
  ) {
    $candidateWorkbook =
      $null

    try {
      $candidateWorkbook =
        $workbooks.Item(
          $workbookIndex
        )

      $candidateName =
        [string]$candidateWorkbook.Name

      $openWorkbookNames +=
        $candidateName

      $normalizedCandidateName =
        $candidateName.Normalize(
          [Text.NormalizationForm]::FormC
        )

      if (
        $normalizedCandidateName -ieq
          $expectedWorkbookName
      ) {
        if (
          $null -ne $workbook
        ) {
          throw (
            "같은 이름의 대상 월 통합문서가 두 개 이상 열려 있습니다: " +
            $expectedWorkbookName
          )
        }

        $workbook =
          $candidateWorkbook

        $candidateWorkbook =
          $null
      }
    }
    finally {
      Release-ExcelComObject -Value $candidateWorkbook
    }
  }

  if (
    $null -eq $workbook
  ) {
    $openWorkbookText =
      if (
        $openWorkbookNames.Count -gt 0
      ) {
        $openWorkbookNames -join ", "
      }
      else {
        "없음"
      }

    $excelProcessCount =
      @(
        Get-Process -Name "EXCEL" -ErrorAction SilentlyContinue
      ).Count

    $multipleInstanceHelp =
      if (
        $excelProcessCount -gt 1
      ) {
        " Excel이 여러 창으로 따로 실행 중입니다. 대상 파일이 있는 Excel 창만 남기고 다시 확인해 주세요."
      }
      else {
        ""
      }

    throw (
      "조회일 " +
      $targetDate +
      "에 필요한 " +
      $expectedWorkbookName +
      "를 찾지 못했습니다. 현재 열린 파일: " +
      $openWorkbookText +
      "." +
      $multipleInstanceHelp
    )
  }

  $workbookName =
    [string]$workbook.Name

  $workbookFullName =
    try {
      [string]$workbook.FullName
    }
    catch {
      ""
    }

  $workbookSaved =
    try {
      [bool]$workbook.Saved
    }
    catch {
      $false
    }

  $workbookReadOnly =
    try {
      [bool]$workbook.ReadOnly
    }
    catch {
      $false
    }

  Write-DailyDataStage -Message (
    "대상 월 통합문서 연결 완료 · " +
    $workbookName
  )

  $worksheets =
    $workbook.Worksheets

  try {
    $plantWorksheet =
      $worksheets.Item(
        "Plant"
      )
  }
  catch {
    throw (
      $workbookName +
      "에서 Plant 시트를 찾지 못했습니다."
    )
  }

  $actualMonthText =
    Normalize-ExcelText -Value (
      Read-ExcelCellValue -Worksheet $plantWorksheet -Address "F4"
    )

  if (
    $actualMonthText -ne
      $expectedMonthText
  ) {
    throw (
      $workbookName +
      "의 Plant!F4 월 표시가 조회일과 다릅니다. 기대값: " +
      $expectedMonthText +
      ", 실제값: " +
      $actualMonthText
    )
  }

  $targetDay =
    [int]$targetDateValue.Day

  $expectedDayColumn =
    5 +
    $targetDay

  $dayMatches =
    @()

  for (
    $columnNumber = 6;
    $columnNumber -le 36;
    $columnNumber += 1
  ) {
    $dayAddress =
      Get-ExcelAddress -RowNumber 5 -ColumnNumber $columnNumber

    $dayValue =
      Read-ExcelCellValue -Worksheet $plantWorksheet -Address $dayAddress

    try {
      $numericDay =
        [Convert]::ToDouble(
          $dayValue,
          [Globalization.CultureInfo]::InvariantCulture
        )

      if (
        [Math]::Abs(
          $numericDay -
          $targetDay
        ) -le 0.000001
      ) {
        $dayMatches +=
          $columnNumber
      }
    }
    catch {
    }
  }

  if (
    $dayMatches.Count -ne 1
  ) {
    throw (
      $workbookName +
      "의 Plant!F5:AJ5에서 " +
      $targetDay +
      "일을 정확히 한 곳 찾지 못했습니다. 확인 건수: " +
      $dayMatches.Count
    )
  }

  $targetColumnNumber =
    [int]$dayMatches[0]

  if (
    $targetColumnNumber -ne
      $expectedDayColumn
  ) {
    throw (
      $workbookName +
      "의 Plant 5행 날짜 배열이 올바르지 않습니다. " +
      $targetDay +
      "일 기대 열: " +
      (
        ConvertTo-ExcelColumnName -ColumnNumber $expectedDayColumn
      ) +
      ", 실제 열: " +
      (
        ConvertTo-ExcelColumnName -ColumnNumber $targetColumnNumber
      )
    )
  }

  $targetColumnName =
    ConvertTo-ExcelColumnName -ColumnNumber $targetColumnNumber

  $targetDayCell =
    $targetColumnName +
    "5"

  Write-DailyDataStage -Message (
    "Plant 조회일 열 확인 · " +
    $targetDate +
    " · " +
    $targetDayCell
  )

  $calculationDeadline =
    [datetime]::UtcNow.AddSeconds(
      15
    )

  while (
    [datetime]::UtcNow -lt
      $calculationDeadline
  ) {
    $calculationState =
      try {
        [int]$excel.CalculationState
      }
      catch {
        0
      }

    if (
      $calculationState -eq 0
    ) {
      break
    }

    Start-Sleep -Milliseconds 250
  }

  $finalCalculationState =
    try {
      [int]$excel.CalculationState
    }
    catch {
      0
    }

  if (
    $finalCalculationState -ne 0
  ) {
    throw "Excel 계산이 완료되지 않아 값을 읽지 않았습니다. 계산 완료 후 다시 조회해 주세요."
  }

  $manualValues =
    [ordered]@{}

  $cellMap =
    [ordered]@{}

  foreach (
    $definition in
      $fieldDefinitions
  ) {
    $rowNumber =
      [int]$definition.row

    $resultKey =
      [string]$definition.resultKey

    $expectedLabel =
      Normalize-ExcelText -Value (
        $definition.label
      )

    $labelAddress =
      "C" +
      [string]$rowNumber

    $actualLabel =
      Normalize-ExcelText -Value (
        Read-ExcelCellValue -Worksheet $plantWorksheet -Address $labelAddress
      )

    if (
      $actualLabel -ne
        $expectedLabel
    ) {
      throw (
        $workbookName +
        "의 Plant!" +
        $labelAddress +
        " 항목명이 다릅니다. 기대값: " +
        $expectedLabel +
        ", 실제값: " +
        $actualLabel
      )
    }

    $valueAddress =
      $targetColumnName +
      [string]$rowNumber

    $numericValue =
      Get-FiniteExcelNumber -Value (
        Read-ExcelCellValue -Worksheet $plantWorksheet -Address $valueAddress
      ) -Label (
        $expectedLabel +
        " (Plant!" +
        $valueAddress +
        ")"
      )

    if (
      $numericValue -lt 0
    ) {
      throw (
        $expectedLabel +
        " 값이 0보다 작습니다: " +
        $numericValue +
        " (Plant!" +
        $valueAddress +
        ")"
      )
    }

    $manualValues[$resultKey] =
      $numericValue

    $cellMap[$resultKey] =
      "Plant!" +
      $valueAddress
  }

  Write-DailyDataStage -Message (
    "태양광 누적 발전량 계산 시작"
  )

  $solarCumulativeParameters =
    @{
      PlantWorksheet =
        $plantWorksheet

      WorkbookFullName =
        $workbookFullName

      TargetDateValue =
        $targetDateValue

      TargetDate =
        $targetDate

      ExpectedDailyValue =
        [double]$manualValues.solarDailyGeneration
    }

  $solarCumulativeResult =
    Get-SolarCumulativeWorkbookResult @solarCumulativeParameters

  Write-DailyDataStage -Message (
    "태양광 누적 발전량 계산 완료"
  )

  $sludgeEntries =
    @()

  $sludgeTruckCount =
    0

  $sludgeTotal =
    0.0

  foreach (
    $definition in
      $sludgeDefinitions
  ) {
    $sequence =
      [int]$definition.sequence

    $rowNumber =
      [int]$definition.row

    $expectedLabel =
      Normalize-ExcelText -Value (
        $definition.label
      )

    $labelAddress =
      "C" +
      [string]$rowNumber

    $actualLabel =
      Normalize-ExcelText -Value (
        Read-ExcelCellValue -Worksheet $plantWorksheet -Address $labelAddress
      )

    if (
      $actualLabel -ne
        $expectedLabel
    ) {
      throw (
        $workbookName +
        "의 Plant!" +
        $labelAddress +
        " 항목명이 다릅니다. 기대값: " +
        $expectedLabel +
        ", 실제값: " +
        $actualLabel
      )
    }

    $valueAddress =
      $targetColumnName +
      [string]$rowNumber

    $amount =
      Get-FiniteExcelNumber -Value (
        Read-ExcelCellValue -Worksheet $plantWorksheet -Address $valueAddress
      ) -Label (
        $expectedLabel +
        " (Plant!" +
        $valueAddress +
        ")"
      ) -AllowBlank $true

    if (
      $null -ne $amount -and
      $amount -lt 0
    ) {
      throw (
        $expectedLabel +
        " 값이 0보다 작습니다: " +
        $amount +
        " (Plant!" +
        $valueAddress +
        ")"
      )
    }

    if (
      $null -ne $amount
    ) {
      $sludgeTotal +=
        $amount

      if (
        $amount -gt 0
      ) {
        $sludgeTruckCount +=
          1
      }
    }

    $sludgeEntries +=
      [ordered]@{
        sequence =
          $sequence

        amount =
          $amount

        cell =
          "Plant!" +
          $valueAddress
      }
  }

  $plantOrganicValues =
    [ordered]@{}

  foreach (
    $definition in
      $organicDefinitions
  ) {
    $rowNumber =
      [int]$definition.row

    $resultKey =
      [string]$definition.resultKey

    $expectedLabel =
      Normalize-ExcelText -Value (
        $definition.label
      )

    $labelAddress =
      "C" +
      [string]$rowNumber

    $actualLabel =
      Normalize-ExcelText -Value (
        Read-ExcelCellValue -Worksheet $plantWorksheet -Address $labelAddress
      )

    if (
      $actualLabel -ne
        $expectedLabel
    ) {
      throw (
        $workbookName +
        "의 Plant!" +
        $labelAddress +
        " 항목명이 다릅니다. 기대값: " +
        $expectedLabel +
        ", 실제값: " +
        $actualLabel
      )
    }

    $valueAddress =
      $targetColumnName +
      [string]$rowNumber

    $plantValue =
      Get-FiniteExcelNumber -Value (
        Read-ExcelCellValue -Worksheet $plantWorksheet -Address $valueAddress
      ) -Label (
        $expectedLabel +
        " (Plant!" +
        $valueAddress +
        ")"
      )

    if (
      $plantValue -lt 0
    ) {
      throw (
        $expectedLabel +
        " 값이 0보다 작습니다: " +
        $plantValue
      )
    }

    $plantOrganicValues[$resultKey] =
      $plantValue

    $cellMap[$resultKey + "Plant"] =
      "Plant!" +
      $valueAddress
  }

  $organicTotalAddress =
    $targetColumnName +
    "287"

  $organicTotalLabel =
    Normalize-ExcelText -Value (
      Read-ExcelCellValue -Worksheet $plantWorksheet -Address "C287"
    )

  if (
    $organicTotalLabel -ne
      "총 재고량 *Day Silo + Storage Silo"
  ) {
    throw (
      $workbookName +
      "의 Plant!C287 항목명이 다릅니다. 실제값: " +
      $organicTotalLabel
    )
  }

  $plantOrganicTotal =
    Get-FiniteExcelNumber -Value (
      Read-ExcelCellValue -Worksheet $plantWorksheet -Address $organicTotalAddress
    ) -Label (
      "유기성 Silo 총 재고량 (Plant!" +
      $organicTotalAddress +
      ")"
    )

  if (
    $plantOrganicTotal -lt 0
  ) {
    throw "유기성 Silo 총 재고량이 0보다 작습니다."
  }

  try {
    $dataWorksheet =
      $worksheets.Item(
        "Data Normalize (2)"
      )
  }
  catch {
    throw (
      $workbookName +
      "에서 Data Normalize (2) 시트를 찾지 못했습니다."
    )
  }

  Write-DailyDataStage -Message (
    "DataPARC 유기성 Silo TAG 위치 확인"
  )

  $usedRange =
    $dataWorksheet.UsedRange

  $usedRows =
    $usedRange.Rows

  $usedColumns =
    $usedRange.Columns

  $rowCount =
    [int]$usedRows.Count

  $columnCount =
    [int]$usedColumns.Count

  $firstRow =
    [int]$usedRange.Row

  $firstColumn =
    [int]$usedRange.Column

  $lastRow =
    $firstRow +
    $rowCount -
    1

  $lastColumn =
    $firstColumn +
    $columnCount -
    1

  if (
    $rowCount -lt 2 -or
    $columnCount -lt 2
  ) {
    throw "Data Normalize (2) 시트의 자료 범위가 비어 있습니다."
  }

  $headerEndRow =
    [Math]::Min(
      $firstRow +
        17,
      $lastRow
    )

  $headerRangeAddress =
    (
      ConvertTo-ExcelColumnName -ColumnNumber $firstColumn
    ) +
    [string]$firstRow +
    ":" +
    (
      ConvertTo-ExcelColumnName -ColumnNumber $lastColumn
    ) +
    [string]$headerEndRow

  $headerRange =
    $dataWorksheet.Range(
      $headerRangeAddress
    )

  $headerValues =
    $headerRange.Value2

  if (
    $headerValues -isnot [array] -or
    $headerValues.Rank -ne 2
  ) {
    throw "Data Normalize (2) 헤더 범위를 읽지 못했습니다."
  }

  $headerFirstRow =
    [int]$headerRange.Row

  $headerFirstColumn =
    [int]$headerRange.Column

  $headerRowLower =
    $headerValues.GetLowerBound(
      0
    )

  $headerRowUpper =
    $headerValues.GetUpperBound(
      0
    )

  $headerColumnLower =
    $headerValues.GetLowerBound(
      1
    )

  $headerColumnUpper =
    $headerValues.GetUpperBound(
      1
    )

  $dateHeaderMatches =
    @()

  $tagMatches =
    @{}

  foreach (
    $definition in
      $organicDefinitions
  ) {
    $tagMatches[
      [string]$definition.resultKey
    ] =
      @()
  }

  for (
    $arrayRow = $headerRowLower;
    $arrayRow -le $headerRowUpper;
    $arrayRow += 1
  ) {
    for (
      $arrayColumn = $headerColumnLower;
      $arrayColumn -le $headerColumnUpper;
      $arrayColumn += 1
    ) {
      $cellText =
        [string](
          $headerValues[
            $arrayRow,
            $arrayColumn
          ]
        )

      $sheetRow =
        $headerFirstRow +
        (
          $arrayRow -
          $headerRowLower
        )

      $sheetColumn =
        $headerFirstColumn +
        (
          $arrayColumn -
          $headerColumnLower
        )

      if (
        $cellText -eq
          "Tag Name"
      ) {
        $dateHeaderMatches +=
          [pscustomobject]@{
            RowNumber =
              $sheetRow

            ColumnNumber =
              $sheetColumn
          }
      }

      foreach (
        $definition in
          $organicDefinitions
      ) {
        if (
          $cellText -ceq
            [string]$definition.tag
        ) {
          $resultKey =
            [string]$definition.resultKey

          $tagMatches[$resultKey] +=
            [pscustomobject]@{
              RowNumber =
                $sheetRow

              ColumnNumber =
                $sheetColumn
            }
        }
      }
    }
  }

  if (
    $dateHeaderMatches.Count -ne 1
  ) {
    throw (
      "Data Normalize (2)의 Tag Name 헤더를 정확히 한 곳 찾지 못했습니다. 확인 건수: " +
      $dateHeaderMatches.Count
    )
  }

  $dateHeaderPosition =
    $dateHeaderMatches[0]

  $tagPositions =
    @{}

  foreach (
    $definition in
      $organicDefinitions
  ) {
    $resultKey =
      [string]$definition.resultKey

    $matches =
      @(
        $tagMatches[$resultKey]
      )

    if (
      $matches.Count -ne 1
    ) {
      throw (
        [string]$definition.tag +
        " TAG를 정확히 한 곳 찾지 못했습니다. 확인 건수: " +
        $matches.Count
      )
    }

    if (
      [int]$matches[0].RowNumber -ne
        [int]$dateHeaderPosition.RowNumber
    ) {
      throw (
        [string]$definition.tag +
        " TAG와 Tag Name이 같은 헤더 행에 있지 않습니다."
      )
    }

    $tagPositions[$resultKey] =
      $matches[0]
  }

  $dateColumnNumber =
    [int]$dateHeaderPosition.ColumnNumber

  $dateStartRow =
    [int]$dateHeaderPosition.RowNumber +
    1

  $dateColumnName =
    ConvertTo-ExcelColumnName -ColumnNumber $dateColumnNumber

  $dateRangeAddress =
    $dateColumnName +
    [string]$dateStartRow +
    ":" +
    $dateColumnName +
    [string]$lastRow

  $dateRange =
    $dataWorksheet.Range(
      $dateRangeAddress
    )

  $dateValues =
    $dateRange.Value2

  if (
    $dateValues -isnot [array] -or
    $dateValues.Rank -ne 2
  ) {
    throw "Data Normalize (2)의 날짜축 범위를 읽지 못했습니다."
  }

  $dateRowLower =
    $dateValues.GetLowerBound(
      0
    )

  $dateRowUpper =
    $dateValues.GetUpperBound(
      0
    )

  $dateColumnLower =
    $dateValues.GetLowerBound(
      1
    )

  $dateRangeFirstRow =
    [int]$dateRange.Row

  $date1904 =
    [bool]$workbook.Date1904

  $targetDateRows =
    @()

  for (
    $arrayRow = $dateRowLower;
    $arrayRow -le $dateRowUpper;
    $arrayRow += 1
  ) {
    $candidateDateValue =
      $dateValues[
        $arrayRow,
        $dateColumnLower
      ]

    if (
      Test-ExcelTimestamp -Value $candidateDateValue -Target $targetDateValue -Date1904 $date1904
    ) {
      $targetDateRows +=
        (
          $dateRangeFirstRow +
          (
            $arrayRow -
            $dateRowLower
          )
        )
    }
  }

  if (
    $targetDateRows.Count -ne 1
  ) {
    throw (
      "Data Normalize (2)에서 " +
      $targetDate +
      " 날짜 행을 정확히 한 곳 찾지 못했습니다. 확인 건수: " +
      $targetDateRows.Count +
      ". DataPARC Get Data 완료 여부를 확인해 주세요."
    )
  }

  $dataTargetRow =
    [int]$targetDateRows[0]

  $dataDateCell =
    Get-ExcelAddress -RowNumber $dataTargetRow -ColumnNumber $dateColumnNumber

  $organicValues =
    [ordered]@{}

  $organicMetadata =
    [ordered]@{}

  foreach (
    $definition in
      $organicDefinitions
  ) {
    $resultKey =
      [string]$definition.resultKey

    $tagPosition =
      $tagPositions[$resultKey]

    $tagColumnNumber =
      [int]$tagPosition.ColumnNumber

    $tagCell =
      Get-ExcelAddress -RowNumber (
        [int]$tagPosition.RowNumber
      ) -ColumnNumber $tagColumnNumber

    $valueCell =
      Get-ExcelAddress -RowNumber $dataTargetRow -ColumnNumber $tagColumnNumber

    $dataValue =
      Get-FiniteExcelNumber -Value (
        Read-ExcelCellValue -Worksheet $dataWorksheet -Address $valueCell
      ) -Label (
        [string]$definition.label +
        " DataPARC 값 (Data Normalize (2)!" +
        $valueCell +
        ")"
      )

    if (
      $dataValue -lt 0
    ) {
      throw (
        [string]$definition.label +
        " DataPARC 값이 0보다 작습니다: " +
        $dataValue
      )
    }

    $plantValue =
      [double]$plantOrganicValues[$resultKey]

    if (
      [Math]::Abs(
        $dataValue -
        $plantValue
      ) -gt 0.001
    ) {
      throw (
        [string]$definition.label +
        "의 Plant 값과 DataPARC 값이 다릅니다. Plant: " +
        $plantValue +
        ", DataPARC: " +
        $dataValue
      )
    }

    $organicValues[$resultKey] =
      $dataValue

    $organicMetadata[$resultKey] =
      [ordered]@{
        tag =
          [string]$definition.tag

        tagCell =
          "Data Normalize (2)!" +
          $tagCell

        valueCell =
          "Data Normalize (2)!" +
          $valueCell

        plantCell =
          $cellMap[$resultKey + "Plant"]

        plantValue =
          $plantValue

        dataParcValue =
          $dataValue
      }
  }

  $organicSiloTotal =
    [double]$organicValues.organicDaySilo +
    [double]$organicValues.organicStorageSiloA +
    [double]$organicValues.organicStorageSiloB

  if (
    [Math]::Abs(
      $organicSiloTotal -
      $plantOrganicTotal
    ) -gt 0.001
  ) {
    throw (
      "유기성 Silo 3개 합계와 Plant 총 재고량이 다릅니다. 3개 합계: " +
      $organicSiloTotal +
      ", Plant!" +
      $organicTotalAddress +
      ": " +
      $plantOrganicTotal
    )
  }

  $unitOneProduction =
    [double]$manualValues.unitOneProduction

  $unitTwoProduction =
    [double]$manualValues.unitTwoProduction

  $totalProduction =
    $unitOneProduction +
    $unitTwoProduction

  $steamSalesLowPressure =
    [double]$manualValues.steamSalesLowPressure

  $steamSalesHighPressure =
    [double]$manualValues.steamSalesHighPressure

  $steamSales =
    $steamSalesLowPressure +
    $steamSalesHighPressure

  $averageSteamSales =
    $steamSales /
    24

  $salesRate =
    if (
      $totalProduction -gt 0
    ) {
      $steamSales /
      $totalProduction *
      100
    }
    else {
      $null
    }

  $result =
    [ordered]@{
      schemaVersion =
        2

      source =
        "월간 일일DATA관리 Excel"

      productionSource =
        "Plant 수기·계산 완료값"

      salesSource =
        "Plant 저압·고압증기 수기값"

      organicSiloSource =
        "DataPARC / Data Normalize (2)"

      targetDate =
        $targetDate

      sourceDate =
        $targetDate

      workbook =
        $workbookName

      workbookFullName =
        $workbookFullName

      workbookSaved =
        $workbookSaved

      workbookReadOnly =
        $workbookReadOnly

      expectedWorkbook =
        $expectedWorkbookName

      plantWorksheet =
        "Plant"

      dataParcWorksheet =
        "Data Normalize (2)"

      monthCell =
        "Plant!F4"

      monthText =
        $actualMonthText

      dayCell =
        "Plant!" +
        $targetDayCell

      targetColumn =
        $targetColumnName

      dataParcDateCell =
        "Data Normalize (2)!" +
        $dataDateCell

      cellMap =
        $cellMap

      unit =
        "ton"

      salesUnit =
        "ton"

      hourCount =
        24

      outputInterval =
        "대상일 일일값"

      hourRange =
        "00:00~24:00"

      generatorEcmsGen1 =
        [double]$manualValues.generatorEcmsGen1

      ismartReception =
        [double]$manualValues.ismartReception

      electricityReceived =
        [double]$manualValues.ismartReception

      epowerTransmission =
        [double]$manualValues.epowerTransmission

      electricityTransmitted =
        [double]$manualValues.epowerTransmission

      solarDailyGeneration =
        [double]$manualValues.solarDailyGeneration

      solarDaily =
        [double]$manualValues.solarDailyGeneration

      solarWeeklyCumulative =
        $solarCumulativeResult.week.total

      solarMonthlyCumulative =
        $solarCumulativeResult.month.total

      solarYearlyCumulative =
        $solarCumulativeResult.year.total

      solarCumulative =
        $solarCumulativeResult

      steamSalesLowPressure =
        $steamSalesLowPressure

      steamSalesHighPressure =
        $steamSalesHighPressure

      steamSales =
        $steamSales

      averageSteamSales =
        $averageSteamSales

      unitOneProduction =
        $unitOneProduction

      unitTwoProduction =
        $unitTwoProduction

      totalProduction =
        $totalProduction

      salesRate =
        $salesRate

      unitOne =
        [ordered]@{
          source =
            "Plant 수기·계산 완료값"

          unit =
            1

          valueCell =
            $cellMap.unitOneProduction

          productionTotal =
            $unitOneProduction

          startValue =
            $null

          endValue =
            $null
        }

      unitTwo =
        [ordered]@{
          source =
            "Plant 수기·계산 완료값"

          unit =
            2

          valueCell =
            $cellMap.unitTwoProduction

          productionTotal =
            $unitTwoProduction

          startValue =
            $null

          endValue =
            $null
        }

      sludgeEntries =
        $sludgeEntries

      sludgeTruckCount =
        $sludgeTruckCount

      sludgeTotal =
        $sludgeTotal

      organicDaySilo =
        [double]$organicValues.organicDaySilo

      organicDaySiloLevel =
        [double]$organicValues.organicDaySilo

      organicStorageSiloA =
        [double]$organicValues.organicStorageSiloA

      organicStorageSiloALevel =
        [double]$organicValues.organicStorageSiloA

      organicStorageSiloB =
        [double]$organicValues.organicStorageSiloB

      organicStorageSiloBLevel =
        [double]$organicValues.organicStorageSiloB

      organicSiloTotal =
        $organicSiloTotal

      organicSiloMetadata =
        $organicMetadata

      dataParcHost =
        [bool](
          Get-Process -Name "CTCExcelAddIn.PARCviewHost" -ErrorAction SilentlyContinue
        )

      collectedAt =
        [datetime]::UtcNow.ToString(
          "o",
          [Globalization.CultureInfo]::InvariantCulture
        )
    }

  Write-DailyDataStage -Message (
    "월간 일일DATA관리 값 읽기 완료"
  )

  [Console]::WriteLine(
    $resultMarker +
    (
      $result |
        ConvertTo-Json -Compress -Depth 8
    )
  )

  [Console]::Out.Flush()
}
finally {
  foreach (
    $comObject in
      @(
        $dateRange,
        $headerRange,
        $usedColumns,
        $usedRows,
        $usedRange,
        $dataWorksheet,
        $plantWorksheet,
        $worksheets,
        $workbook,
        $workbooks,
        $excel
      )
  ) {
    Release-ExcelComObject -Value $comObject
  }
}
`;

function runDataParcSteamPowerShell(
  environment
) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      const systemRoot =
        process.env.SystemRoot ||
        "C:\\Windows";


      const powerShellPath =
        path.join(
          systemRoot,
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe"
        );


      /*
        Windows 명령줄 길이 제한을 피하기 위해
        UTF-8 BOM 임시 PowerShell 파일로 실행한다.
      */

      const temporaryDirectory =
        process.env.TEMP ||
        process.env.TMP ||
        __dirname;


      const powerShellScriptPath =
        path.join(
          temporaryDirectory,

          [
            "gs-shift-dataparc-steam",
            process.pid,
            Date.now(),
            Math.random()
              .toString(16)
              .slice(2)
          ].join("-") +
            ".ps1"
        );


      fs.writeFileSync(
        powerShellScriptPath,
        `\uFEFF${DATAPARC_STEAM_OPEN_WORKBOOK_POWERSHELL_SCRIPT}`,
        "utf8"
      );


      let childProcess;


      try {
        childProcess =
          spawn(
            powerShellPath,

            [
              "-NoLogo",
              "-NoProfile",
              "-NonInteractive",
              "-STA",
              "-ExecutionPolicy",
              "Bypass",
              "-File",
              powerShellScriptPath
            ],

            {
              windowsHide:
                true,

              stdio: [
                "ignore",
                "pipe",
                "pipe"
              ],

              env: {
                ...process.env,
                ...environment
              }
            }
          );

      } catch (
        error
      ) {
        try {
          fs.unlinkSync(
            powerShellScriptPath
          );
        } catch (
          cleanupError
        ) {
        }


        throw error;
      }


      let standardOutput =
        "";


      let standardError =
        "";


      let isSettled =
        false;


      let stdoutLineBuffer =
        "";


      let lastStage =
        "PowerShell 실행 직후";


      let cleanupTimeoutId =
        null;


      let isPowerShellScriptRemoved =
        false;


      const removePowerShellScript =
        () => {
          if (
            isPowerShellScriptRemoved
          ) {
            return;
          }


          isPowerShellScriptRemoved =
            true;


          try {
            fs.unlinkSync(
              powerShellScriptPath
            );
          } catch (
            error
          ) {
          }
        };


      const resultMarker =
        normalizeOisAgentText(
          environment
            .GS_STEAM_RESULT_MARKER
        );


      const stopChildProcess =
        () => {
          if (
            childProcess.exitCode !==
              null ||
            childProcess.signalCode !==
              null
          ) {
            return;
          }


          try {
            childProcess.kill(
              "SIGKILL"
            );
          } catch (
            error
          ) {
          }


          if (
            process.platform ===
              "win32" &&
            Number.isInteger(
              childProcess.pid
            )
          ) {
            try {
              const taskKillProcess =
                spawn(
                  path.join(
                    systemRoot,
                    "System32",
                    "taskkill.exe"
                  ),

                  [
                    "/PID",
                    String(
                      childProcess.pid
                    ),
                    "/T",
                    "/F"
                  ],

                  {
                    windowsHide:
                      true,

                    stdio:
                      "ignore"
                  }
                );


              taskKillProcess.unref();

            } catch (
              error
            ) {
            }
          }
        };


      const finish = (
        error,
        value
      ) => {
        if (
          isSettled
        ) {
          return;
        }


        isSettled =
          true;


        clearTimeout(
          timeoutId
        );


        if (
          error &&
          cleanupTimeoutId
        ) {
          clearTimeout(
            cleanupTimeoutId
          );


          cleanupTimeoutId =
            null;
        }


        if (
          error
        ) {
          reject(
            error
          );


          return;
        }


        resolve(
          value
        );
      };


      const timeoutId =
        setTimeout(
          () => {
            stopChildProcess();


            finish(
              new Error(
                [
                  "월간 일일DATA관리 Excel 조회가 45초를 초과해 중단되었습니다.",
                  `마지막 단계: ${lastStage}`
                ].join(
                  " "
                )
              )
            );
          },

          DATAPARC_STEAM_PROCESS_TIMEOUT
        );


      childProcess.stdout
        .setEncoding(
          "utf8"
        );


      childProcess.stderr
        .setEncoding(
          "utf8"
        );


      const handleStandardOutputLine =
        line => {
          const normalizedLine =
            String(
              line ||
              ""
            )
              .trim();


          if (
            !normalizedLine
          ) {
            return;
          }


          if (
            normalizedLine.startsWith(
              DATAPARC_STEAM_STAGE_MARKER
            )
          ) {
            lastStage =
              normalizedLine
                .slice(
                  DATAPARC_STEAM_STAGE_MARKER.length
                )
                .trim() ||
              lastStage;


            console.log(
              `DataPARC 진행 · ${lastStage}`
            );


            return;
          }


          if (
            resultMarker &&
            normalizedLine.startsWith(
              resultMarker
            )
          ) {
            cleanupTimeoutId =
              setTimeout(
                () => {
                  stopChildProcess();
                },

                3000
              );


            cleanupTimeoutId.unref?.();


            finish(
              null,
              normalizedLine
            );
          }
        };


      childProcess.stdout.on(
        "data",
        chunk => {
          standardOutput +=
            chunk;


          stdoutLineBuffer +=
            chunk;


          const lines =
            stdoutLineBuffer.split(
              /\r?\n/
            );


          stdoutLineBuffer =
            lines.pop() ||
            "";


          for (
            const line of
            lines
          ) {
            handleStandardOutputLine(
              line
            );
          }
        }
      );


      childProcess.stderr.on(
        "data",
        chunk => {
          standardError +=
            chunk;
        }
      );


      childProcess.on(
        "error",
        error => {
          removePowerShellScript();


          stopChildProcess();


          finish(
            new Error(
              [
                `Windows PowerShell을 실행하지 못했습니다: ${error.message}`,
                `마지막 단계: ${lastStage}`
              ].join(
                " "
              )
            )
          );
        }
      );


      childProcess.on(
        "close",
        exitCode => {
          removePowerShellScript();


          if (
            cleanupTimeoutId
          ) {
            clearTimeout(
              cleanupTimeoutId
            );


            cleanupTimeoutId =
              null;
          }


          if (
            stdoutLineBuffer
          ) {
            handleStandardOutputLine(
              stdoutLineBuffer
            );


            stdoutLineBuffer =
              "";
          }


          if (
            isSettled
          ) {
            return;
          }


          const errorText =
            normalizeOisAgentText(
              standardError
            );


          const outputText =
            normalizeOisAgentText(
              standardOutput
            );


          const hasResultMarker =
            Boolean(
              resultMarker
            ) &&
            standardOutput
              .split(
                /\r?\n/
              )
              .some(
                line => {
                  return line
                    .trim()
                    .startsWith(
                      resultMarker
                    );
                }
              );


          if (
            exitCode !==
              0 ||
            !hasResultMarker
          ) {
            const detailText =
              errorText ||
              outputText;


            finish(
              new Error(
                [
                  detailText ||
                    [
                      "DataPARC 조회 결과가 출력되지 않았습니다.",
                      `종료 코드: ${exitCode}`
                    ].join(
                      " "
                    ),

                  `마지막 단계: ${lastStage}`
                ].join(
                  " "
                )
              )
            );


            return;
          }


          finish(
            null,
            standardOutput
          );
        }
      );
    }
  );
}


function parseDailyDataWorkbookNumber(
  value,
  label
) {
  if (
    value ===
      null ||
    value ===
      undefined ||
    normalizeOisAgentText(
      value
    ) ===
      ""
  ) {
    throw new Error(
      `${label}이 비어 있습니다.`
    );
  }


  const numericValue =
    Number(
      value
    );


  if (
    !Number.isFinite(
      numericValue
    )
  ) {
    throw new Error(
      `${label}이 올바른 숫자가 아닙니다.`
    );
  }


  return numericValue;
}


function roundDailyDataNumber(
  value,
  fractionDigits =
    3
) {
  const multiplier =
    10 **
    fractionDigits;


  return Math.round(
    value *
    multiplier
  ) /
    multiplier;
}


async function collectDailyDataWorkbookValues(
  targetDate
) {
  if (
    !isValidOisAgentDate(
      targetDate
    )
  ) {
    throw new Error(
      "월간 일일DATA관리 조회 날짜가 올바르지 않습니다."
    );
  }


  console.log(
    [
      "월간 일일DATA관리 Excel 조회 시작",
      targetDate
    ].join(
      " · "
    )
  );


  const standardOutput =
    await runDataParcSteamPowerShell({
      GS_STEAM_TARGET_DATE:
        targetDate,

      GS_STEAM_RESULT_MARKER:
        DAILY_DATA_WORKBOOK_RESULT_MARKER,

      GS_DAILY_FIELDS_JSON:
        JSON.stringify(
          DAILY_DATA_WORKBOOK_FIELD_DEFINITIONS
        ),

      GS_DAILY_SLUDGE_JSON:
        JSON.stringify(
          DAILY_DATA_WORKBOOK_SLUDGE_DEFINITIONS
        ),

      GS_DAILY_ORGANIC_JSON:
        JSON.stringify(
          DAILY_DATA_WORKBOOK_ORGANIC_SILO_DEFINITIONS
        )
    });


  const resultLine =
    standardOutput
      .split(
        /\r?\n/
      )
      .map(
        line => {
          return line.trim();
        }
      )
      .reverse()
      .find(
        line => {
          return line.startsWith(
            DAILY_DATA_WORKBOOK_RESULT_MARKER
          );
        }
      );


  if (
    !resultLine
  ) {
    throw new Error(
      "월간 일일DATA관리 조회 결과 JSON을 확인하지 못했습니다."
    );
  }


  let capturedResult;


  try {
    capturedResult =
      JSON.parse(
        resultLine.slice(
          DAILY_DATA_WORKBOOK_RESULT_MARKER.length
        )
      );

  } catch (
    error
  ) {
    throw new Error(
      `월간 일일DATA관리 조회 결과를 해석하지 못했습니다: ${error.message}`
    );
  }


  if (
    Number(
      capturedResult.schemaVersion
    ) !==
      2
  ) {
    throw new Error(
      "월간 일일DATA관리 조회 결과 버전이 올바르지 않습니다."
    );
  }


  if (
    normalizeOisAgentText(
      capturedResult.targetDate
    ) !==
      targetDate ||
    normalizeOisAgentText(
      capturedResult.sourceDate
    ) !==
      targetDate
  ) {
    throw new Error(
      "월간 일일DATA관리 조회 날짜와 결과 날짜가 일치하지 않습니다."
    );
  }


  const expectedWorkbook =
    `${targetDate.slice(
      2,
      4
    )}.${targetDate.slice(
      5,
      7
    )}-일일DATA관리.xlsx`;


  if (
    normalizeOisAgentText(
      capturedResult.workbook
    ).normalize(
      "NFC"
    ).toLowerCase() !==
      expectedWorkbook
        .normalize(
          "NFC"
        )
        .toLowerCase()
  ) {
    throw new Error(
      `조회 대상 월 통합문서가 다릅니다. 기대값: ${expectedWorkbook}, 실제값: ${capturedResult.workbook || "없음"}`
    );
  }


  const unitOneProduction =
    roundDailyDataNumber(
      parseDailyDataWorkbookNumber(
        capturedResult.unitOneProduction,
        "1호기 증기생산량"
      )
    );


  const unitTwoProduction =
    roundDailyDataNumber(
      parseDailyDataWorkbookNumber(
        capturedResult.unitTwoProduction,
        "2호기 증기생산량"
      )
    );


  const steamSalesLowPressure =
    roundDailyDataNumber(
      parseDailyDataWorkbookNumber(
        capturedResult.steamSalesLowPressure,
        "저압증기 판매량"
      )
    );


  const steamSalesHighPressure =
    roundDailyDataNumber(
      parseDailyDataWorkbookNumber(
        capturedResult.steamSalesHighPressure,
        "고압증기 판매량"
      )
    );


  const totalProduction =
    roundDailyDataNumber(
      unitOneProduction +
      unitTwoProduction
    );


  const steamSales =
    roundDailyDataNumber(
      steamSalesLowPressure +
      steamSalesHighPressure
    );


  if (
    totalProduction <=
      0
  ) {
    throw new Error(
      "총 증기생산량이 0 이하이므로 판매율을 계산할 수 없습니다."
    );
  }


  const averageSteamSales =
    roundDailyDataNumber(
      steamSales /
      24
    );


  const salesRate =
    roundDailyDataNumber(
      steamSales /
      totalProduction *
      100
    );


  const generatorEcmsGen1 =
    roundDailyDataNumber(
      parseDailyDataWorkbookNumber(
        capturedResult.generatorEcmsGen1,
        "발전량 (Generator) / ECMS gen1"
      )
    );


  const ismartReception =
    roundDailyDataNumber(
      parseDailyDataWorkbookNumber(
        capturedResult.ismartReception ??
          capturedResult.electricityReceived,
        "수전량 (I-Smart)"
      )
    );


  const epowerTransmission =
    roundDailyDataNumber(
      parseDailyDataWorkbookNumber(
        capturedResult.epowerTransmission ??
          capturedResult.electricityTransmitted,
        "송전량 (ePower)"
      )
    );


  const solarDailyGeneration =
    roundDailyDataNumber(
      parseDailyDataWorkbookNumber(
        capturedResult.solarDailyGeneration ??
          capturedResult.solarDaily,
        "태양광 일일 발전량"
      )
    );


  const organicDaySilo =
    roundDailyDataNumber(
      parseDailyDataWorkbookNumber(
        capturedResult.organicDaySilo ??
          capturedResult.organicDaySiloLevel,
        "유기성 Day Silo"
      ),
      6
    );


  const organicStorageSiloA =
    roundDailyDataNumber(
      parseDailyDataWorkbookNumber(
        capturedResult.organicStorageSiloA ??
          capturedResult.organicStorageSiloALevel,
        "유기성 Storage Silo A"
      ),
      6
    );


  const organicStorageSiloB =
    roundDailyDataNumber(
      parseDailyDataWorkbookNumber(
        capturedResult.organicStorageSiloB ??
          capturedResult.organicStorageSiloBLevel,
        "유기성 Storage Silo B"
      ),
      6
    );


  const organicSiloTotal =
    roundDailyDataNumber(
      organicDaySilo +
      organicStorageSiloA +
      organicStorageSiloB,
      6
    );


  const sludgeEntries =
    Array.isArray(
      capturedResult.sludgeEntries
    )
      ? capturedResult.sludgeEntries
          .slice(
            0,
            10
          )
          .map(
            (
              item,
              index
            ) => {
              const rawAmount =
                item?.amount;


              const amount =
                rawAmount ===
                    null ||
                  rawAmount ===
                    undefined ||
                  normalizeOisAgentText(
                    rawAmount
                  ) ===
                    ""
                  ? null
                  : roundDailyDataNumber(
                      parseDailyDataWorkbookNumber(
                        rawAmount,
                        `${index + 1}번째 하수슬러지 입고량`
                      )
                    );


              return {
                sequence:
                  index +
                  1,

                amount,

                cell:
                  normalizeOisAgentText(
                    item?.cell
                  )
              };
            }
          )
      : [];


  while (
    sludgeEntries.length <
      10
  ) {
    sludgeEntries.push({
      sequence:
        sludgeEntries.length +
        1,

      amount:
        null,

      cell:
        ""
    });
  }


  const calculatedSludgeTruckCount =
    sludgeEntries.filter(
      item => {
        return (
          Number.isFinite(
            item.amount
          ) &&
          item.amount >
            0
        );
      }
    ).length;


  const calculatedSludgeTotal =
    roundDailyDataNumber(
      sludgeEntries.reduce(
        (
          sum,
          item
        ) => {
          return sum +
            (
              Number.isFinite(
                item.amount
              )
                ? item.amount
                : 0
            );
        },
        0
      )
    );


  const capturedSludgeTruckCount =
    Number(
      capturedResult.sludgeTruckCount
    );


  const capturedSludgeTotal =
    Number(
      capturedResult.sludgeTotal
    );


  if (
    capturedSludgeTruckCount !==
      calculatedSludgeTruckCount ||
    !Number.isFinite(
      capturedSludgeTotal
    ) ||
    Math.abs(
      capturedSludgeTotal -
      calculatedSludgeTotal
    ) >
      0.001
  ) {
    throw new Error(
      "하수슬러지 입고 차량 수 또는 총 입고량 계산값이 일치하지 않습니다."
    );
  }


  const result = {
    schemaVersion:
      2,

    source:
      "월간 일일DATA관리 Excel",

    productionSource:
      "Plant 수기·계산 완료값",

    salesSource:
      "Plant 저압·고압증기 수기값",

    organicSiloSource:
      "DataPARC / Data Normalize (2)",

    targetDate,

    sourceDate:
      targetDate,

    workbook:
      normalizeOisAgentText(
        capturedResult.workbook
      ),

    workbookFullName:
      normalizeOisAgentText(
        capturedResult.workbookFullName
      ),

    workbookSaved:
      capturedResult.workbookSaved ===
        true,

    workbookReadOnly:
      capturedResult.workbookReadOnly ===
        true,

    plantWorksheet:
      "Plant",

    dataParcWorksheet:
      "Data Normalize (2)",

    monthCell:
      normalizeOisAgentText(
        capturedResult.monthCell
      ),

    monthText:
      normalizeOisAgentText(
        capturedResult.monthText
      ),

    dayCell:
      normalizeOisAgentText(
        capturedResult.dayCell
      ),

    targetColumn:
      normalizeOisAgentText(
        capturedResult.targetColumn
      ),

    dataParcDateCell:
      normalizeOisAgentText(
        capturedResult.dataParcDateCell
      ),

    cellMap:
      capturedResult.cellMap &&
      typeof capturedResult.cellMap ===
        "object"
        ? capturedResult.cellMap
        : {},

    outputInterval:
      "대상일 일일값",

    hourRange:
      "00:00~24:00",

    hourCount:
      24,

    unit:
      "ton",

    salesUnit:
      "ton",

    generatorEcmsGen1,

    ismartReception,

    electricityReceived:
      ismartReception,

    epowerTransmission,

    electricityTransmitted:
      epowerTransmission,

    solarDailyGeneration,

    solarDaily:
      solarDailyGeneration,

    steamSalesLowPressure,

    steamSalesHighPressure,

    steamSales,

    averageSteamSales,

    unitOneProduction,

    unitTwoProduction,

    totalProduction,

    salesRate,

    unitOne: {
      source:
        "Plant 수기·계산 완료값",

      unit:
        1,

      valueCell:
        normalizeOisAgentText(
          capturedResult.unitOne
            ?.valueCell
        ),

      productionTotal:
        unitOneProduction,

      startValue:
        null,

      endValue:
        null
    },

    unitTwo: {
      source:
        "Plant 수기·계산 완료값",

      unit:
        2,

      valueCell:
        normalizeOisAgentText(
          capturedResult.unitTwo
            ?.valueCell
        ),

      productionTotal:
        unitTwoProduction,

      startValue:
        null,

      endValue:
        null
    },

    sludgeEntries,

    sludgeTruckCount:
      calculatedSludgeTruckCount,

    sludgeTotal:
      calculatedSludgeTotal,

    organicDaySilo,

    organicDaySiloLevel:
      organicDaySilo,

    organicStorageSiloA,

    organicStorageSiloALevel:
      organicStorageSiloA,

    organicStorageSiloB,

    organicStorageSiloBLevel:
      organicStorageSiloB,

    organicSiloTotal,

    organicSiloMetadata:
      capturedResult.organicSiloMetadata &&
      typeof capturedResult.organicSiloMetadata ===
        "object"
        ? capturedResult.organicSiloMetadata
        : {},

    dataParcHost:
      capturedResult.dataParcHost ===
        true,

    collectedAt:
      normalizeOisAgentText(
        capturedResult.collectedAt
      ) ||
      new Date()
        .toISOString(),

    productionComplete:
      true,

    salesComplete:
      true
  };


  console.log(
    [
      "월간 일일DATA관리 Excel 조회 완료",
      targetDate,
      result.workbook,
      `열 ${result.targetColumn}`,
      `1호기 ${result.unitOneProduction} ton`,
      `2호기 ${result.unitTwoProduction} ton`,
      `저압 ${result.steamSalesLowPressure} ton`,
      `고압 ${result.steamSalesHighPressure} ton`,
      `판매합계 ${result.steamSales} ton`,
      `하수슬러지 ${result.sludgeTruckCount}대 / ${result.sludgeTotal} ton`
    ].join(
      " · "
    )
  );


  return result;
}

/* =========================================================
  오전회의 일일DATA 현황 수집

  요청형:
  - daily_data_excel: 현재 요청
  - steam_status: 기존 요청 호환

  변경된 자료원:
  - 생산량: Plant 51·52행
  - 판매량: Plant 72·73행 저압·고압 합계
  - 발전·수전·송전·태양광: Plant 수기값
  - 하수슬러지: Plant 288~297행
  - 유기성 Silo 3개: Data Normalize (2) DataPARC 값

  OIS 일별 증기 판매량 조회는 사용하지 않는다.
========================================================= */

async function collectOisSteamStatusValues(
  page,
  config,
  targetDate
) {
  return await collectDailyDataWorkbookValues(
    targetDate
  );
}

/* =========================================================
  요청 유형별 OIS 자료 수집
========================================================= */

async function collectOisAgentRequestResult(
  page,
  config,
  requestItem
) {
  const requestType =
    getOisAgentRequestType(
      requestItem
    );


  const targetDate =
    normalizeOisAgentText(
      requestItem?.targetDate ||
      requestItem?.target_date
    );


  if (
    requestType ===
      "water_environment"
  ) {
    return await collectOisWaterTreatmentValues(
      page,
      config,
      targetDate
    );
  }


  if (
    requestType ===
      "limestone_stock"
  ) {
    return await collectOisLimestoneStocks(
      page,
      config,
      targetDate
    );
  }

if (
  requestType ===
    "auxiliary_materials"
) {
  return await collectOisAuxiliaryMaterialValues(
    page,
    config,
    targetDate
  );
}




  if (
    requestType ===
      "turbine_gear_pinion"
  ) {
    return await collectOisTurbineGearPinionValues(
      page,
      config,
      targetDate
    );
  }


  if (
    requestType ===
      "silo_level"
  ) {
    return await collectOisSiloLevelValues(
      page,
      config,
      targetDate
    );
  }


  if (
    isDailyDataExcelRequestType(
      requestType
    )
  ) {
    return await collectOisSteamStatusValues(
      page,
      config,
      targetDate
    );
  }


  if (
    requestType ===
      "logsheet_approval"
  ) {
    return await collectOisLegacyLogApprovalValues(
      page,
      config,
      targetDate
    );
  }


  throw new Error(
    `지원하지 않는 OIS 요청 유형입니다: ${requestType}`
  );
}

/* =========================================================
  요청 결과 콘솔 출력
========================================================= */

function printOisAgentRequestResult(
  requestType,
  result
) {
  if (
    requestType ===
      "water_environment"
  ) {
    console.table({
      "장자산단 원수 유입량":
        result.rawWaterInflow,

      "원수 TANK 저장량":
        result.rawWaterTankAmount,

      "원수 TANK 저장율":
        result.rawWaterTankRate,

      "여과수 TANK 저장량":
        result.filteredWaterTankAmount,

      "여과수 TANK 저장율":
        result.filteredWaterTankRate,

      "순수 TANK 저장량":
        result.demiWaterTankAmount,

      "순수 TANK 저장율":
        result.demiWaterTankRate,

      "순수 생산량":
        result.demiProduction,

      "순수 사용량":
        result.pureWaterUsage
    });


    return;
  }


  if (
    requestType ===
      "limestone_stock"
  ) {
    console.table({
      "1호기 시작 재고":
        result
          .unitOne
          .startStock,

      "1호기 종료 재고":
        result
          .unitOne
          .endStock,

      "2호기 시작 재고":
        result
          .unitTwo
          .startStock,

      "2호기 종료 재고":
        result
          .unitTwo
          .endStock
    });


    return;
  }


  if (
    requestType ===
      "turbine_gear_pinion"
  ) {
    console.table({
      "조회일":
        result.targetDate,

      "조회 열":
        result.valueColumn,

      "Gear Wheel":
        result.gearWheel,

      "Pinion":
        result.pinion,

      "Gear Wheel TAG":
        result.gearWheelTag,

      "Pinion TAG":
        result.pinionTag
    });


    return;
  }


  if (
    requestType ===
      "silo_level"
  ) {
    console.table({
      "조회일":
        result.targetDate,

      "조회 기준":
        result.valueColumn,

      "Fly Ash Silo Level":
        result.flyAshSiloLevel,

      "Bio Storage Silo Level":
        result.bioStorageSiloLevel,

      "Fly Ash TAG":
        result.flyAshTag,

      "Bio Storage TAG":
        result.bioStorageTag,

      "Fly Ash 단위":
        result.flyAshUnit,

      "Bio Storage 단위":
        result.bioStorageUnit
    });


    return;
  }


  if (
    isDailyDataExcelRequestType(
      requestType
    )
  ) {
    console.table({
      "조회일":
        result.targetDate,

      "월간 파일":
        result.workbook,

      "Plant 조회 열":
        result.targetColumn,

      "발전량(ECMS gen1)":
        result.generatorEcmsGen1,

      "수전량(I-Smart)":
        result.ismartReception,

      "송전량(ePower)":
        result.epowerTransmission,

      "태양광 일일 발전량":
        result.solarDailyGeneration,

      "저압증기":
        result.steamSalesLowPressure,

      "고압증기":
        result.steamSalesHighPressure,

      "총 증기 판매량":
        result.steamSales,

      "시간당 평균 판매량":
        result.averageSteamSales,

      "1호기 증기생산량":
        result.unitOneProduction,

      "2호기 증기생산량":
        result.unitTwoProduction,

      "총 증기생산량":
        result.totalProduction,

      "판매율":
        result.salesRate,

      "하수슬러지 차량":
        result.sludgeTruckCount,

      "하수슬러지 총 입고량":
        result.sludgeTotal,

      "유기성 Day Silo":
        result.organicDaySilo,

      "유기성 Storage Silo A":
        result.organicStorageSiloA,

      "유기성 Storage Silo B":
        result.organicStorageSiloB,

      "유기성 Silo 합계":
        result.organicSiloTotal
    });


    console.table(
      Array.isArray(
        result.sludgeEntries
      )
        ? result.sludgeEntries.map(
            item => {
              return {
                "입고 순번":
                  item.sequence,

                "입고량(ton)":
                  item.amount,

                "원본 셀":
                  item.cell
              };
            }
          )
        : []
    );


    return;
  }

  if (
    requestType ===
      "logsheet_approval"
  ) {
    console.log(
      [
        `조회일 ${result.targetDate}`,
        `대상 ${result.targetRoleRowCount}건`,
        `내용 있음 ${result.contentRowCount}건`,
        `DAY ${result.shiftEvidence?.dayContentCount || 0}건`,
        `AFTER ${result.shiftEvidence?.afterContentCount || 0}건`,
        `NIGHT ${result.shiftEvidence?.nightContentCount || 0}건`
      ].join(
        " · "
      )
    );


    console.table(
      (
        Array.isArray(
          result.records
        )
          ? result.records
          : []
      )
        .filter(
          record => {
            return record.hasContent;
          }
        )
        .map(
          record => {
            const preview =
              String(
                record.content ||
                ""
              )
                .replace(
                  /\s+/g,
                  " "
                )
                .slice(
                  0,
                  80
                );


            return {
              보직:
                record.role,

              근무:
                record.originalShift,

              근무자:
                record.worker,

              내용:
                preview,

              근무자결재:
                record.workerApproval,

              파트장결재:
                record.partApproval
            };
          }
        )
    );
  }
}

/* =========================================================
  요청 완료 전송
========================================================= */

async function completeOisAgentRequest(
  config,
  requestId,
  result
) {
  return await requestOisAgentApi(
    config,

    getOisAgentApiUrl(
      config
    ),

    {
      method:
        "POST",

      body: {
        action:
          "complete",

        requestId,

        result
      }
    }
  );
}


/* =========================================================
  요청 실패 전송
========================================================= */

async function failOisAgentRequest(
  config,
  requestId,
  error
) {
  return await requestOisAgentApi(
    config,

    getOisAgentApiUrl(
      config
    ),

    {
      method:
        "POST",

      body: {
        action:
          "fail",

        requestId,

        errorMessage:
          error instanceof
            Error
            ? error.message
            : String(
                error ||
                "OIS 조회에 실패했습니다."
              )
      }
    }
  );
}


/* =========================================================
  OIS 로그인 확인 및 로그인
========================================================= */

async function ensureOisAgentLoggedIn(
  page,
  config
) {
  const currentUrl =
    String(
      page.url() ||
      ""
    );


  if (
    /\/jsp\/login\/main/i.test(
      currentUrl
    )
  ) {
    return;
  }


  await page.goto(
    OIS_LOGIN_URL,
    {
      waitUntil:
        "domcontentloaded",

      timeout:
        OIS_QUERY_TIMEOUT
    }
  );


  /*
    저장된 세션이 유효하면 로그인 주소에서
    메인 화면으로 자동 이동할 수 있다.
  */
  await page.waitForTimeout(
    800
  );


  if (
    /\/jsp\/login\/main/i.test(
      page.url()
    )
  ) {
    return;
  }


  const userIdInput =
    page.locator(
      "#userid input"
    );


  const passwordInput =
    page.locator(
      "#pw input"
    );


  await userIdInput.waitFor({
    state:
      "visible",

    timeout:
      OIS_QUERY_TIMEOUT
  });


  await userIdInput.fill(
    config.userId
  );


  await passwordInput.fill(
    config.password
  );


  await passwordInput.press(
    "Enter"
  );


  await page.waitForURL(
    /\/jsp\/login\/main/i,
    {
      timeout:
        OIS_QUERY_TIMEOUT
    }
  );


  await page.context()
    .storageState({
      path:
        OIS_SESSION_FILE_PATH
    });


  console.log(
    "OIS 로그인이 완료되었습니다."
  );
}


/* =========================================================
  LOG SHEET 선택항목이 있는 프레임인지 확인
========================================================= */

async function isOisLogSheetFrame(
  frame
) {
  try {
    return await frame
      .locator(
        "select"
      )
      .evaluateAll(
        selectElements => {
          return selectElements.some(
            selectElement => {
              return [
                ...selectElement.options
              ].some(
                option => {
                  return String(
                    option.textContent ||
                    ""
                  )
                    .replace(
                      /\s+/g,
                      " "
                    )
                    .trim()
                    .includes(
                      "BOARD LOGSHEET (BCO1)"
                    );
                }
              );
            }
          );
        }
      );

  } catch {
    return false;
  }
}


/* =========================================================
  LOG SHEET 조회 화면 프레임 찾기
========================================================= */

async function findOisLogSheetFrame(
  page,
  timeoutMilliseconds =
    OIS_QUERY_TIMEOUT
) {
  const startedAt =
    Date.now();


  while (
    Date.now() -
      startedAt <
    timeoutMilliseconds
  ) {
    for (
      const frame of
      page.frames()
    ) {
      if (
        await isOisLogSheetFrame(
          frame
        )
      ) {
        return frame;
      }
    }


    await page.waitForTimeout(
      300
    );
  }


  return null;
}

/* =========================================================
  OIS 왼쪽 메뉴 프레임 찾기

  메뉴 프레임 확인 문구:
  - 메가메뉴선택
  - 운영정보
========================================================= */

async function findOisNavigationFrame(
  page,
  timeoutMilliseconds =
    OIS_QUERY_TIMEOUT
) {
  const startedAt =
    Date.now();


  while (
    Date.now() -
      startedAt <
    timeoutMilliseconds
  ) {
    for (
      const frame of
      page.frames()
    ) {
      const bodyText =
        normalizeOisAgentText(
          await frame
            .locator(
              "body"
            )
            .innerText()
            .catch(
              () => ""
            )
        );


      const isNavigationFrame =
        bodyText.includes(
          "운영정보"
        ) &&
        (
          bodyText.includes(
            "메가메뉴선택"
          ) ||
          bodyText.includes(
            "기준정보"
          ) ||
          bodyText.includes(
            "LOG SHEET"
          )
        );


      if (
        isNavigationFrame
      ) {
        return frame;
      }
    }


    await page.waitForTimeout(
      250
    );
  }


  return null;
}


/* =========================================================
  왼쪽 메뉴에서 정확한 글자 찾기
========================================================= */

async function findVisibleOisNavigationItem(
  frame,
  menuTexts,
  timeoutMilliseconds =
    7000
) {
  const textCandidates =
    Array.isArray(
      menuTexts
    )
      ? menuTexts
      : [
          menuTexts
        ];


  const startedAt =
    Date.now();


  while (
    Date.now() -
      startedAt <
    timeoutMilliseconds
  ) {
    for (
      const menuText of
      textCandidates
    ) {
      const exactLocator =
        frame.getByText(
          menuText,
          {
            exact:
              true
          }
        );


      const exactCount =
        await exactLocator
          .count()
          .catch(
            () => 0
          );


      for (
        let index = 0;
        index <
          exactCount;
        index +=
          1
      ) {
        const target =
          exactLocator.nth(
            index
          );


        const isVisible =
          await target
            .isVisible()
            .catch(
              () => false
            );


        if (
          isVisible
        ) {
          return target;
        }
      }
    }


    await frame.page()
      .waitForTimeout(
        250
      );
  }


  return null;
}


/* =========================================================
  OIS 왼쪽 메뉴 클릭

  일반 클릭 실패 시:
  - onclick 요소
  - 링크
  - 버튼
  - 메뉴 행

  순서로 실제 클릭 대상을 찾아 클릭한다.
========================================================= */

async function clickOisNavigationItem(
  frame,
  menuTexts,
  menuName
) {
  const target =
    await findVisibleOisNavigationItem(
      frame,
      menuTexts,
      7000
    );


  if (
    !target
  ) {
    return false;
  }


  await target
    .scrollIntoViewIfNeeded()
    .catch(
      () => null
    );


  try {
    await target.click({
      timeout:
        5000,

      force:
        true
    });

  } catch (
    error
  ) {
    await target.evaluate(
      element => {
        const clickableElement =
          element.closest(
            `
              [onclick],
              a,
              button,
              [role="button"],
              li,
              td
            `
          ) ||
          element;


        clickableElement.dispatchEvent(
          new MouseEvent(
            "click",
            {
              bubbles:
                true,

              cancelable:
                true,

              view:
                window
            }
          )
        );
      }
    );
  }


  console.log(
    `${menuName} 메뉴를 클릭했습니다.`
  );


  await frame.page()
    .waitForTimeout(
      700
    );


  return true;
}

/* =========================================================
  OIS LOG SHEET 조회 화면 열기 최종본

  실제 탐색 순서:
  1. 운영정보
  2. LOG SHEET
  3. LOG SHEET조회
========================================================= */

async function openOisLogSheetLookup(
  page
) {
  /* =====================================================
    이미 LOG SHEET 조회 화면이 열려 있다면 재사용
  ====================================================== */

  const existingLogSheetFrame =
    await findOisLogSheetFrame(
      page,
      1500
    );


  if (
    existingLogSheetFrame
  ) {
    return existingLogSheetFrame;
  }


  /* =====================================================
    왼쪽 메뉴 프레임 찾기
  ====================================================== */

  let menuFrame =
    await findOisNavigationFrame(
      page,
      OIS_QUERY_TIMEOUT
    );


  if (
    !menuFrame
  ) {
    throw new Error(
      "OIS 왼쪽 메뉴 영역을 찾지 못했습니다."
    );
  }


  /* =====================================================
    1. LOG SHEET조회 메뉴가 이미 보이는지 확인
  ====================================================== */

  let lookupMenu =
    await findVisibleOisNavigationItem(
      menuFrame,
      [
        "LOG SHEET조회",
        "LOG SHEET 조회"
      ],
      1000
    );


  if (
    !lookupMenu
  ) {
    /* ===================================================
      2. LOG SHEET 상위 메뉴 확인
    ==================================================== */

    let logSheetMenu =
      await findVisibleOisNavigationItem(
        menuFrame,
        "LOG SHEET",
        1000
      );


    /* ===================================================
      3. LOG SHEET이 안 보이면 운영정보부터 클릭
    ==================================================== */

    if (
      !logSheetMenu
    ) {
      const operationMenuClicked =
        await clickOisNavigationItem(
          menuFrame,
          "운영정보",
          "운영정보"
        );


      if (
        !operationMenuClicked
      ) {
        throw new Error(
          "OIS의 운영정보 메뉴를 찾지 못했습니다."
        );
      }


      /*
        운영정보 클릭으로 메뉴 프레임 내부가
        다시 그려질 수 있으므로 프레임을 다시 찾는다.
      */
      menuFrame =
        await findOisNavigationFrame(
          page,
          OIS_QUERY_TIMEOUT
        );


      if (
        !menuFrame
      ) {
        throw new Error(
          "운영정보 메뉴를 연 뒤 왼쪽 메뉴를 다시 찾지 못했습니다."
        );
      }


      logSheetMenu =
        await findVisibleOisNavigationItem(
          menuFrame,
          "LOG SHEET",
          10000
        );
    }


    if (
      !logSheetMenu
    ) {
      throw new Error(
        "OIS의 LOG SHEET 상위 메뉴를 찾지 못했습니다."
      );
    }


    /* ===================================================
      4. LOG SHEET 상위 메뉴 클릭
    ==================================================== */

    const logSheetMenuClicked =
      await clickOisNavigationItem(
        menuFrame,
        "LOG SHEET",
        "LOG SHEET"
      );


    if (
      !logSheetMenuClicked
    ) {
      throw new Error(
        "OIS의 LOG SHEET 상위 메뉴를 열지 못했습니다."
      );
    }


    /*
      LOG SHEET 클릭 후 하위 메뉴가 다시 그려질 수 있으므로
      메뉴 프레임을 다시 찾는다.
    */
    menuFrame =
      await findOisNavigationFrame(
        page,
        OIS_QUERY_TIMEOUT
      );


    if (
      !menuFrame
    ) {
      throw new Error(
        "LOG SHEET 메뉴를 연 뒤 왼쪽 메뉴를 다시 찾지 못했습니다."
      );
    }


    lookupMenu =
      await findVisibleOisNavigationItem(
        menuFrame,
        [
          "LOG SHEET조회",
          "LOG SHEET 조회"
        ],
        10000
      );
  }


  if (
    !lookupMenu
  ) {
    throw new Error(
      "OIS의 LOG SHEET조회 하위 메뉴를 찾지 못했습니다."
    );
  }


  /* =====================================================
    5. LOG SHEET조회 메뉴 클릭
  ====================================================== */

  const lookupMenuClicked =
    await clickOisNavigationItem(
      menuFrame,
      [
        "LOG SHEET조회",
        "LOG SHEET 조회"
      ],
      "LOG SHEET조회"
    );


  if (
    !lookupMenuClicked
  ) {
    throw new Error(
      "OIS의 LOG SHEET조회 메뉴를 클릭하지 못했습니다."
    );
  }


  /* =====================================================
    6. 조회 화면 로딩 대기

    확인 기준:
    SHEET 선택항목 안에
    BOARD LOGSHEET (BCO1)이 존재하는지 확인
  ====================================================== */

  const logSheetFrame =
    await findOisLogSheetFrame(
      page,
      OIS_QUERY_TIMEOUT
    );


  if (
    !logSheetFrame
  ) {
    throw new Error(
      "OIS LOG SHEET 조회 화면이 열리지 않았습니다."
    );
  }


  console.log(
    "OIS LOG SHEET 조회 화면을 열었습니다."
  );


  return logSheetFrame;
}

/* =========================================================
  특정 옵션이 있는 select 선택
========================================================= */

async function selectOisOptionByLabel(
  frame,
  optionLabel,
  required =
    true
) {
  const normalizedOptionLabel =
    normalizeOisAgentText(
      optionLabel
    );


  const selects =
    frame.locator(
      "select"
    );


  const selectCount =
    await selects.count();


  for (
    let index = 0;
    index <
      selectCount;
    index +=
      1
  ) {
    const select =
      selects.nth(
        index
      );


    const options =
      await select.evaluate(
        element => {
          return [
            ...element.options
          ].map(
            option => {
              return {
                value:
                  option.value,

                label:
                  String(
                    option.textContent ||
                    ""
                  )
                    .replace(
                      /\s+/g,
                      " "
                    )
                    .trim()
              };
            }
          );
        }
      );


    const matchedOption =
      options.find(
        option => {
          return (
            normalizeOisAgentText(
              option.label
            ) ===
            normalizedOptionLabel
          );
        }
      );


    if (
      !matchedOption
    ) {
      continue;
    }


    await select.selectOption({
      value:
        matchedOption.value
    });


    await select.evaluate(
      element => {
        element.dispatchEvent(
          new Event(
            "change",
            {
              bubbles:
                true
            }
          )
        );
      }
    );


    return true;
  }


  if (
    required
  ) {
    throw new Error(
      `OIS 선택항목 "${normalizedOptionLabel}"을 찾지 못했습니다.`
    );
  }


  return false;
}


/* =========================================================
  조회 날짜 입력
========================================================= */

async function setOisLogSheetDate(
  frame,
  targetDate
) {
  const slashDate =
    targetDate.replace(
      /-/g,
      "/"
    );


  const inputs =
    frame.locator(
      "input"
    );


  const inputCount =
    await inputs.count();


  let bestCandidate =
    null;


  let bestScore =
    -1;


  for (
    let index = 0;
    index <
      inputCount;
    index +=
      1
  ) {
    const input =
      inputs.nth(
        index
      );


    const inputInformation =
      await input.evaluate(
        element => {
          return {
            type:
              String(
                element.type ||
                ""
              ).toLowerCase(),

            value:
              String(
                element.value ||
                ""
              ),

            identity:
              [
                element.id,
                element.name,
                element.title,
                element.placeholder,
                element.getAttribute(
                  "aria-label"
                )
              ]
                .filter(
                  Boolean
                )
                .join(
                  " "
                )
          };
        }
      );


    if (
      [
        "hidden",
        "button",
        "submit",
        "checkbox",
        "radio"
      ].includes(
        inputInformation.type
      )
    ) {
      continue;
    }


    let score =
      0;


    if (
      inputInformation.type ===
        "date"
    ) {
      score +=
        20;
    }


    if (
      /^\d{4}[/-]\d{2}[/-]\d{2}$/.test(
        inputInformation.value
      )
    ) {
      score +=
        15;
    }


    if (
      /일자|날짜|date/i.test(
        inputInformation.identity
      )
    ) {
      score +=
        10;
    }


    const isVisible =
      await input
        .isVisible()
        .catch(
          () => false
        );


    if (
      isVisible
    ) {
      score +=
        5;
    }


    if (
      score >
      bestScore
    ) {
      bestScore =
        score;


      bestCandidate =
        input;
    }
  }


  if (
    !bestCandidate ||
    bestScore <=
      0
  ) {
    throw new Error(
      "OIS LOG SHEET 날짜 입력칸을 찾지 못했습니다."
    );
  }


  const inputType =
    await bestCandidate
      .getAttribute(
        "type"
      )
      .catch(
        () => ""
      );


  const inputValue =
    String(
      inputType ||
      ""
    ).toLowerCase() ===
      "date"
        ? targetDate
        : slashDate;


  await bestCandidate.evaluate(
    (
      element,
      value
    ) => {
      const valueSetter =
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        )?.set;


      if (
        valueSetter
      ) {
        valueSetter.call(
          element,
          value
        );

      } else {
        element.value =
          value;
      }


      element.dispatchEvent(
        new Event(
          "input",
          {
            bubbles:
              true
          }
        )
      );


      element.dispatchEvent(
        new Event(
          "change",
          {
            bubbles:
              true
          }
        )
      );


      element.dispatchEvent(
        new Event(
          "blur",
          {
            bubbles:
              true
          }
        )
      );
    },
    inputValue
  );
}


/* =========================================================
  조회 버튼 클릭
========================================================= */

async function clickOisLogSheetSearchButton(
  frame
) {
  const candidates = [
    frame.getByRole(
      "button",
      {
        name:
          "조회",

        exact:
          true
      }
    ),

    frame.locator(
      'input[type="button"][value="조회"]'
    ),

    frame.locator(
      'input[type="submit"][value="조회"]'
    ),

    frame.getByText(
      "조회",
      {
        exact:
          true
      }
    )
  ];


  for (
    const candidate of
    candidates
  ) {
    const count =
      await candidate
        .count()
        .catch(
          () => 0
        );


    for (
      let index = 0;
      index <
        count;
      index +=
        1
    ) {
      const button =
        candidate.nth(
          index
        );


      const isVisible =
        await button
          .isVisible()
          .catch(
            () => false
          );


      if (
        !isVisible
      ) {
        continue;
      }


      await button.click({
        timeout:
          10000,

        force:
          true
      });


      return;
    }
  }


  throw new Error(
    "OIS LOG SHEET 조회 버튼을 찾지 못했습니다."
  );
}

/* =========================================================
  OIS 석회석 행의 전일·24시 재고 읽기

  기준:
  - TAG 행을 화면에서 찾는다.
  - 상단 헤더의 "전일"과 "24" 위치를 찾는다.
  - TAG 행과 같은 높이의 값을 각각 읽는다.

  반환:
  {
    startStock: 전일 재고,
    endStock: 24시 재고
  }
========================================================= */

async function readOisLimestoneDayStocks(
  frame,
  targetTag
) {
  const rawResult =
    await frame.evaluate(
      tagValue => {
        const normalizeText = (
          value
        ) => {
          return String(
            value ??
            ""
          )
            .replace(
              /\u00a0/g,
              " "
            )
            .replace(
              /\s+/g,
              " "
            )
            .trim();
        };


        const normalizeKey = (
          value
        ) => {
          return normalizeText(
            value
          )
            .replace(
              /\s+/g,
              ""
            )
            .toUpperCase();
        };


        const parsePureNumber = (
          value
        ) => {
          const normalizedValue =
            normalizeText(
              value
            )
              .replace(
                /,/g,
                ""
              );


          if (
            !/^-?\d+(?:\.\d+)?$/.test(
              normalizedValue
            )
          ) {
            return null;
          }


          const numericValue =
            Number(
              normalizedValue
            );


          return Number.isFinite(
            numericValue
          )
            ? numericValue
            : null;
        };


        const getElementValue = (
          element
        ) => {
          if (
            !(element instanceof Element)
          ) {
            return "";
          }


          if (
            element instanceof
              HTMLInputElement ||
            element instanceof
              HTMLTextAreaElement
          ) {
            return normalizeText(
              element.value
            );
          }


          if (
            element instanceof
              HTMLSelectElement
          ) {
            return normalizeText(
              element
                .selectedOptions?.[0]
                ?.textContent ||
              element.value
            );
          }


          const directText =
            normalizeText(
              [
                ...element.childNodes
              ]
                .filter(
                  node => {
                    return (
                      node.nodeType ===
                      Node.TEXT_NODE
                    );
                  }
                )
                .map(
                  node => {
                    return node.textContent;
                  }
                )
                .join(
                  " "
                )
            );


          if (
            directText
          ) {
            return directText;
          }


          const attributeValues = [
            element.getAttribute(
              "data-text"
            ),

            element.getAttribute(
              "data-value"
            ),

            element.getAttribute(
              "aria-label"
            ),

            element.getAttribute(
              "title"
            )
          ]
            .map(
              normalizeText
            )
            .filter(
              Boolean
            );


          if (
            attributeValues.length >
              0
          ) {
            return attributeValues[0];
          }


          if (
            element.children.length ===
              0
          ) {
            return normalizeText(
              element.textContent
            );
          }


          return "";
        };


        const getVisibleRectangle = (
          element
        ) => {
          if (
            !(element instanceof Element)
          ) {
            return null;
          }


          const rectangle =
            element.getBoundingClientRect();


          if (
            rectangle.width <=
              0 ||
            rectangle.height <=
              0
          ) {
            return null;
          }


          const style =
            window.getComputedStyle(
              element
            );


          if (
            style.display ===
              "none" ||
            style.visibility ===
              "hidden" ||
            Number(
              style.opacity
            ) ===
              0
          ) {
            return null;
          }


          return {
            left:
              rectangle.left,

            right:
              rectangle.right,

            top:
              rectangle.top,

            bottom:
              rectangle.bottom,

            width:
              rectangle.width,

            height:
              rectangle.height,

            centerX:
              rectangle.left +
              rectangle.width /
              2,

            centerY:
              rectangle.top +
              rectangle.height /
              2
          };
        };


        const allElements = [
          ...document.querySelectorAll(
            "body *"
          )
        ];


        const targetTagKey =
          normalizeKey(
            tagValue
          );


        /* =================================================
          TAG 셀
        ================================================= */

        const tagCandidates =
          allElements
            .map(
              element => {
                const text =
                  getElementValue(
                    element
                  );


                const rectangle =
                  getVisibleRectangle(
                    element
                  );


                if (
                  !text ||
                  !rectangle
                ) {
                  return null;
                }


                const textKey =
                  normalizeKey(
                    text
                  );


                if (
                  textKey !==
                    targetTagKey &&
                  !textKey.includes(
                    targetTagKey
                  )
                ) {
                  return null;
                }


                return {
                  text,
                  rectangle,

                  exact:
                    textKey ===
                    targetTagKey,

                  area:
                    rectangle.width *
                    rectangle.height
                };
              }
            )
            .filter(
              Boolean
            )
            .sort(
              (
                first,
                second
              ) => {
                if (
                  first.exact !==
                  second.exact
                ) {
                  return first.exact
                    ? -1
                    : 1;
                }


                return (
                  first.area -
                  second.area
                );
              }
            );


        const tagCell =
          tagCandidates[0] ||
          null;


        if (
          !tagCell
        ) {
          return {
            startStock:
              null,

            endStock:
              null,

            reason:
              "tag-not-found"
          };
        }


        /* =================================================
          헤더 위치 찾기

          전일:
          화면 왼쪽에 있는 첫 번째 시간 데이터 열

          24:
          화면 오른쪽 스크롤 후 표시되는 24 열
        ================================================= */

        const findHeader = (
          headerText
        ) => {
          const candidates =
            allElements
              .map(
                element => {
                  const text =
                    getElementValue(
                      element
                    );


                  const rectangle =
                    getVisibleRectangle(
                      element
                    );


                  if (
                    !rectangle ||
                    normalizeText(
                      text
                    ) !==
                      headerText
                  ) {
                    return null;
                  }


                  /*
                    TAG 행보다 위에 있는 헤더만 허용한다.
                  */
                  if (
                    rectangle.centerY >=
                    tagCell
                      .rectangle
                      .centerY
                  ) {
                    return null;
                  }


                  return {
                    text,
                    rectangle,

                    verticalDistance:
                      tagCell
                        .rectangle
                        .top -
                      rectangle.bottom,

                    area:
                      rectangle.width *
                      rectangle.height
                  };
                }
              )
              .filter(
                Boolean
              )
              .sort(
                (
                  first,
                  second
                ) => {
                  const distanceCompare =
                    first.verticalDistance -
                    second.verticalDistance;


                  if (
                    Math.abs(
                      distanceCompare
                    ) >
                    2
                  ) {
                    return distanceCompare;
                  }


                  return (
                    first.area -
                    second.area
                  );
                }
              );


          return candidates[0] ||
            null;
        };


        const previousHeader =
          findHeader(
            "전일"
          );


        const hour24Header =
          findHeader(
            "24"
          );


        /* =================================================
          특정 헤더 아래, TAG와 같은 행의 숫자 찾기
        ================================================= */

        const findValueUnderHeader = (
          header
        ) => {
          if (
            !header
          ) {
            return null;
          }


          const candidates =
            allElements
              .map(
                element => {
                  const text =
                    getElementValue(
                      element
                    );


                  const value =
                    parsePureNumber(
                      text
                    );


                  const rectangle =
                    getVisibleRectangle(
                      element
                    );


                  if (
                    value ===
                      null ||
                    !rectangle
                  ) {
                    return null;
                  }


                  const horizontalDifference =
                    Math.abs(
                      rectangle.centerX -
                      header
                        .rectangle
                        .centerX
                    );


                  const verticalDifference =
                    Math.abs(
                      rectangle.centerY -
                      tagCell
                        .rectangle
                        .centerY
                    );


                  const allowedHorizontalDifference =
                    Math.max(
                      8,
                      header
                        .rectangle
                        .width *
                        0.65
                    );


                  const allowedVerticalDifference =
                    Math.max(
                      10,
                      tagCell
                        .rectangle
                        .height *
                        0.8
                    );


                  if (
                    horizontalDifference >
                      allowedHorizontalDifference ||
                    verticalDifference >
                      allowedVerticalDifference
                  ) {
                    return null;
                  }


                  return {
                    value,
                    text,
                    rectangle,
                    horizontalDifference,
                    verticalDifference,
                    area:
                      rectangle.width *
                      rectangle.height
                  };
                }
              )
              .filter(
                Boolean
              )
              .sort(
                (
                  first,
                  second
                ) => {
                  const horizontalCompare =
                    first.horizontalDifference -
                    second.horizontalDifference;


                  if (
                    Math.abs(
                      horizontalCompare
                    ) >
                    1
                  ) {
                    return horizontalCompare;
                  }


                  const verticalCompare =
                    first.verticalDifference -
                    second.verticalDifference;


                  if (
                    Math.abs(
                      verticalCompare
                    ) >
                    1
                  ) {
                    return verticalCompare;
                  }


                  return (
                    first.area -
                    second.area
                  );
                }
              );


          return candidates[0] ||
            null;
        };


        const startValue =
          findValueUnderHeader(
            previousHeader
          );


        const endValue =
          findValueUnderHeader(
            hour24Header
          );


        return {
          startStock:
            startValue?.value ??
            null,

          endStock:
            endValue?.value ??
            null,

          startRawText:
            startValue?.text ||
            "",

          endRawText:
            endValue?.text ||
            "",

          hasPreviousHeader:
            Boolean(
              previousHeader
            ),

          hasHour24Header:
            Boolean(
              hour24Header
            ),

          tagRectangle:
            tagCell.rectangle,

          previousHeaderRectangle:
            previousHeader?.rectangle ||
            null,

          hour24HeaderRectangle:
            hour24Header?.rectangle ||
            null
        };
      },
      targetTag
    );


  const startStock =
    parseOisAgentNumber(
      rawResult?.startStock
    );


  const endStock =
    parseOisAgentNumber(
      rawResult?.endStock
    );


  console.log(
    "OIS 석회석 재고 읽기 결과:",
    {
      tag:
        targetTag,

      startStock,

      endStock,

      diagnosis:
        rawResult
    }
  );


  if (
    startStock ===
      null ||
    endStock ===
      null
  ) {
    return null;
  }


  return {
    startStock,
    endStock
  };
}

/* =========================================================
  OIS 전일·24시 재고값 대기
========================================================= */

async function waitForOisLimestoneDayStocks(
  frame,
  targetTag
) {
  const startedAt =
    Date.now();


  let attemptCount =
    0;


  while (
    Date.now() -
      startedAt <
    OIS_QUERY_TIMEOUT
  ) {
    attemptCount +=
      1;


    const stocks =
      await readOisLimestoneDayStocks(
        frame,
        targetTag
      ).catch(
        error => {
          console.warn(
            `OIS 석회석 재고 확인 ${attemptCount}회차 오류:`,
            error
          );


          return null;
        }
      );


    if (
      stocks &&
      stocks.startStock !==
        null &&
      stocks.endStock !==
        null
    ) {
      console.log(
        [
          targetTag,
          `전일 ${stocks.startStock} t`,
          `24시 ${stocks.endStock} t`
        ].join(
          " · "
        )
      );


      return stocks;
    }


    await waitOisAgent(
      500
    );
  }


  throw new Error(
    `${targetTag}의 전일·24시 재고값을 읽지 못했습니다.`
  );
}

/* =========================================================
  OIS LOG SHEET 조회 API 응답에서 TAG 자료 읽기

  OIS 요청:
  POST /ajax/data

  cmd:
  oi.LogSheetService.listLogSheetSearch

  필드:
  decimal_pnt = 전일 재고
  hd_24       = 24시 재고
========================================================= */

async function captureOisLogSheetStockFromApi(
  page,
  targetTag,
  triggerSearch
) {
  const normalizedTargetTag =
    normalizeOisAgentText(
      targetTag
    ).toUpperCase();


  return await new Promise(
    (
      resolve,
      reject
    ) => {
      let isSettled =
        false;


      const cleanup = () => {
        windowClearTimeout();


        page.off(
          "response",
          handleResponse
        );
      };


      let timeoutId =
        null;


      const windowClearTimeout = () => {
        if (
          timeoutId
        ) {
          clearTimeout(
            timeoutId
          );


          timeoutId =
            null;
        }
      };


      const finishResolve = (
        value
      ) => {
        if (
          isSettled
        ) {
          return;
        }


        isSettled =
          true;


        cleanup();


        resolve(
          value
        );
      };


      const finishReject = (
        error
      ) => {
        if (
          isSettled
        ) {
          return;
        }


        isSettled =
          true;


        cleanup();


        reject(
          error
        );
      };


      const handleResponse =
        async response => {
          try {
            const responseUrl =
              String(
                response.url() ||
                ""
              );


            const request =
              response.request();


            const requestMethod =
              String(
                request.method() ||
                ""
              ).toUpperCase();


            const requestBody =
              String(
                request.postData() ||
                ""
              );


            /*
              LOG SHEET 조회 요청만 확인한다.
            */
            if (
              !responseUrl.includes(
                "/ajax/data"
              ) ||
              requestMethod !==
                "POST" ||
              !requestBody.includes(
                "oi.LogSheetService.listLogSheetSearch"
              )
            ) {
              return;
            }


            const responseText =
              await response.text();


            if (
              !responseText.trim()
            ) {
              return;
            }


            let responseData = {};


            try {
              responseData =
                JSON.parse(
                  responseText
                );

            } catch {
              return;
            }


            const resultRows =
              Array.isArray(
                responseData.result
              )
                ? responseData.result
                : [];


            const targetRow =
              resultRows.find(
                row => {
                  const rowTag =
                    normalizeOisAgentText(
                      row?.tag_no
                    ).toUpperCase();


                  return (
                    rowTag ===
                    normalizedTargetTag
                  );
                }
              ) ||
              null;


            /*
              다른 조회 응답이면 계속 기다린다.
            */
            if (
              !targetRow
            ) {
              return;
            }


            const startStock =
              parseOisAgentNumber(
                targetRow.decimal_pnt
              );


            const endStock =
              parseOisAgentNumber(
                targetRow.hd_24
              );


            if (
              startStock ===
                null ||
              endStock ===
                null
            ) {
              finishReject(
                new Error(
                  `${targetTag}의 전일 또는 24시 재고값이 올바르지 않습니다.`
                )
              );


              return;
            }


            console.log(
              "OIS LOG SHEET API 자료 확인:",
              {
                tag:
                  targetTag,

                itemName:
                  normalizeOisAgentText(
                    targetRow.mid_name
                  ),

                startStock,

                endStock,

                startField:
                  "decimal_pnt",

                endField:
                  "hd_24"
              }
            );


            finishResolve({
              startStock,

              endStock,

              tag:
                normalizeOisAgentText(
                  targetRow.tag_no
                ),

              itemName:
                normalizeOisAgentText(
                  targetRow.mid_name
                ),

              unit:
                normalizeOisAgentText(
                  targetRow.unit_code
                )
            });

          } catch (
            error
          ) {
            finishReject(
              error
            );
          }
        };


      /*
        조회 버튼을 누르기 전에
        응답 감시를 먼저 시작한다.
      */
      page.on(
        "response",
        handleResponse
      );


      timeoutId =
        setTimeout(
          () => {
            finishReject(
              new Error(
                `${targetTag}가 포함된 OIS LOG SHEET 응답을 받지 못했습니다.`
              )
            );
          },
          OIS_QUERY_TIMEOUT
        );


      Promise.resolve()
        .then(
          triggerSearch
        )
        .catch(
          finishReject
        );
    }
  );
}

/* =========================================================
  OIS LOG SHEET API 응답에서
  Gear Wheel / Pinion 전일 값 읽기

  조회 화면:
  BOARD LOGSHEET (TGO)

  응답:
  POST /ajax/data
  oi.LogSheetService.listLogSheetSearch

  사용 필드:
  decimal_pnt = 전일 값
========================================================= */

async function captureOisTurbineGearPinionFromApi(
  page,
  triggerSearch
) {
  const definitions = [
    {
      resultKey:
        "gearWheel",

      label:
        OIS_TURBINE_GEAR_PINION_DEFINITION
          .gearWheel
          .label,

      tag:
        OIS_TURBINE_GEAR_PINION_DEFINITION
          .gearWheel
          .tag
    },

    {
      resultKey:
        "pinion",

      label:
        OIS_TURBINE_GEAR_PINION_DEFINITION
          .pinion
          .label,

      tag:
        OIS_TURBINE_GEAR_PINION_DEFINITION
          .pinion
          .tag
    }
  ];


  return await new Promise(
    (
      resolve,
      reject
    ) => {
      let isSettled =
        false;


      let timeoutId =
        null;


      const capturedValues = {};


      const clearRequestTimeout = () => {
        if (
          timeoutId
        ) {
          clearTimeout(
            timeoutId
          );


          timeoutId =
            null;
        }
      };


      const cleanup = () => {
        clearRequestTimeout();


        page.off(
          "response",
          handleResponse
        );
      };


      const finishResolve = (
        value
      ) => {
        if (
          isSettled
        ) {
          return;
        }


        isSettled =
          true;


        cleanup();


        resolve(
          value
        );
      };


      const finishReject = (
        error
      ) => {
        if (
          isSettled
        ) {
          return;
        }


        isSettled =
          true;


        cleanup();


        reject(
          error
        );
      };


      const handleResponse =
        async response => {
          try {
            const responseUrl =
              String(
                response.url() ||
                ""
              );


            const request =
              response.request();


            const requestMethod =
              String(
                request.method() ||
                ""
              ).toUpperCase();


            const requestBody =
              String(
                request.postData() ||
                ""
              );


            /* =============================================
              LOG SHEET 조회 응답만 확인
            ============================================== */

            if (
              !responseUrl.includes(
                "/ajax/data"
              ) ||
              requestMethod !==
                "POST" ||
              !requestBody.includes(
                "oi.LogSheetService.listLogSheetSearch"
              )
            ) {
              return;
            }


            const responseText =
              await response.text();


            if (
              !responseText.trim()
            ) {
              return;
            }


            let responseData = {};


            try {
              responseData =
                JSON.parse(
                  responseText
                );

            } catch {
              return;
            }


            const resultRows =
              Array.isArray(
                responseData.result
              )
                ? responseData.result
                : [];


            /* =============================================
              두 TAG를 응답에서 각각 찾기
            ============================================== */

            for (
              const definition of
              definitions
            ) {
              if (
                capturedValues[
                  definition.resultKey
                ]
              ) {
                continue;
              }


              const normalizedTargetTag =
                normalizeOisAgentText(
                  definition.tag
                ).toUpperCase();


              const targetRow =
                resultRows.find(
                  row => {
                    const rowTag =
                      normalizeOisAgentText(
                        row?.tag_no
                      ).toUpperCase();


                    return (
                      rowTag ===
                      normalizedTargetTag
                    );
                  }
                ) ||
                null;


              if (
                !targetRow
              ) {
                continue;
              }


              const value =
                parseOisAgentNumber(
                  targetRow[
                    OIS_TURBINE_GEAR_PINION_DEFINITION
                      .valueField
                  ]
                );


              if (
                value ===
                  null
              ) {
                finishReject(
                  new Error(
                    `${definition.label}의 전일 값이 올바르지 않습니다.`
                  )
                );


                return;
              }


              capturedValues[
                definition.resultKey
              ] = {
                value,

                tag:
                  normalizeOisAgentText(
                    targetRow.tag_no
                  ),

                itemName:
                  normalizeOisAgentText(
                    targetRow.mid_name
                  ),

                unit:
                  normalizeOisAgentText(
                    targetRow.unit_code
                  ),

                valueField:
                  OIS_TURBINE_GEAR_PINION_DEFINITION
                    .valueField
              };


              console.log(
                "OIS TGO 전일 자료 확인:",
                {
                  label:
                    definition.label,

                  tag:
                    definition.tag,

                  itemName:
                    capturedValues[
                      definition.resultKey
                    ].itemName,

                  value,

                  field:
                    OIS_TURBINE_GEAR_PINION_DEFINITION
                      .valueField
                }
              );
            }


            /* =============================================
              두 값이 모두 확인되면 완료
            ============================================== */

            if (
              capturedValues.gearWheel &&
              capturedValues.pinion
            ) {
              finishResolve({
                gearWheel:
                  capturedValues
                    .gearWheel,

                pinion:
                  capturedValues
                    .pinion
              });
            }

          } catch (
            error
          ) {
            finishReject(
              error
            );
          }
        };


      /*
        조회 버튼보다 응답 감시를 먼저 시작한다.
      */

      page.on(
        "response",
        handleResponse
      );


      timeoutId =
        setTimeout(
          () => {
            const missingLabels =
              definitions
                .filter(
                  definition => {
                    return !capturedValues[
                      definition.resultKey
                    ];
                  }
                )
                .map(
                  definition => {
                    return definition.label;
                  }
                );


            finishReject(
              new Error(
                [
                  "OIS TGO LOG SHEET에서 전일 값을 읽지 못했습니다.",
                  `누락: ${missingLabels.join(", ")}`
                ].join(
                  " "
                )
              )
            );
          },
          OIS_QUERY_TIMEOUT
        );


      Promise.resolve()
        .then(
          triggerSearch
        )
        .catch(
          finishReject
        );
    }
  );
}


/* =========================================================
  선택일 Gear Wheel / Pinion 수집

  조회:
  - 설비운영팀
  - BOARD LOGSHEET (TGO)
  - 선택일
  - 전일 열

  결과:
  {
    gearWheel: 0.771,
    pinion: 1.957
  }
========================================================= */

async function collectOisTurbineGearPinionValues(
  page,
  config,
  targetDate
) {
  if (
    !isValidOisAgentDate(
      targetDate
    )
  ) {
    throw new Error(
      "Gear Wheel / Pinion 조회 날짜가 올바르지 않습니다."
    );
  }


  await ensureOisAgentLoggedIn(
    page,
    config
  );


  let frame =
    await openOisLogSheetLookup(
      page
    );


  /* =====================================================
    부서 선택

    화면에 부서 선택란이 없는 경우도 있으므로
    required는 false로 처리한다.
  ====================================================== */

  await selectOisOptionByLabel(
    frame,
    "설비운영팀",
    false
  );


  frame =
    await findOisLogSheetFrame(
      page
    ) ||
    frame;


  /* =====================================================
    BOARD LOGSHEET (TGO) 선택
  ====================================================== */

  await selectOisOptionByLabel(
    frame,
    OIS_TURBINE_GEAR_PINION_DEFINITION
      .sheetLabel,
    true
  );


  await page.waitForTimeout(
    500
  );


  frame =
    await findOisLogSheetFrame(
      page
    ) ||
    frame;


  /* =====================================================
    조회일 입력
  ====================================================== */

  await setOisLogSheetDate(
    frame,
    targetDate
  );


  await page.waitForTimeout(
    200
  );


  /* =====================================================
    조회 버튼 클릭 후 API 응답에서 두 값 추출
  ====================================================== */

  const capturedValues =
    await captureOisTurbineGearPinionFromApi(
      page,
      async () => {
        await clickOisLogSheetSearchButton(
          frame
        );
      }
    );


  const result = {
    source:
      "OIS BOARD LOGSHEET (TGO)",

    targetDate,

    sourceDate:
      targetDate,

    sheetLabel:
      OIS_TURBINE_GEAR_PINION_DEFINITION
        .sheetLabel,

    valueColumn:
      "전일",

    valueField:
      OIS_TURBINE_GEAR_PINION_DEFINITION
        .valueField,

    gearWheel:
      capturedValues
        .gearWheel
        .value,

    pinion:
      capturedValues
        .pinion
        .value,

    gearWheelTag:
      capturedValues
        .gearWheel
        .tag,

    pinionTag:
      capturedValues
        .pinion
        .tag,

    gearWheelItemName:
      capturedValues
        .gearWheel
        .itemName,

    pinionItemName:
      capturedValues
        .pinion
        .itemName,

    gearWheelUnit:
      capturedValues
        .gearWheel
        .unit,

    pinionUnit:
      capturedValues
        .pinion
        .unit,

    collectedAt:
      new Date()
        .toISOString()
  };


  console.log(
    [
      "OIS TGO 조회 완료",
      targetDate,
      `Gear Wheel ${result.gearWheel}`,
      `Pinion ${result.pinion}`
    ].join(
      " · "
    )
  );


  return result;
}

/* =========================================================
  부재료 LOG SHEET 행의 01~24시 평균

  OIS API 필드:
  hd_01 ~ hd_24
========================================================= */

function readOisAuxiliaryHourlyAverage(
  row
) {
  const values = [];


  for (
    let hour = 1;
    hour <=
      24;
    hour +=
      1
  ) {
    const hourText =
      String(
        hour
      ).padStart(
        2,
        "0"
      );


    const candidates = [
      row?.[
        `hd_${hourText}`
      ],

      row?.[
        `h_${hourText}`
      ],

      row?.[
        `hour_${hourText}`
      ],

      row?.[
        hourText
      ],

      row?.[
        String(
          hour
        )
      ]
    ];


    let numericValue =
      null;


    for (
      const candidate of
      candidates
    ) {
      numericValue =
        parseOisAgentNumber(
          candidate
        );


      if (
        numericValue !==
          null
      ) {
        break;
      }
    }


    if (
      numericValue !==
        null
    ) {
      values.push(
        numericValue
      );
    }
  }


  if (
    values.length <
      1
  ) {
    return {
      average:
        null,

      sampleCount:
        0
    };
  }


  const average =
    values.reduce(
      (
        total,
        value
      ) => {
        return total +
          value;
      },
      0
    ) /
    values.length;


  return {
    average:
      Math.round(
        average *
        1000000
      ) /
      1000000,

    sampleCount:
      values.length
  };
}

/* =========================================================
  LOG SHEET 조회 API 응답에서 부재료 대상 행 전체 수집
========================================================= */

async function captureOisAuxiliaryMaterialRowsFromApi(
  page,
  unitDefinition,
  triggerSearch
) {
  const targetEntries =
    Object.entries(
      unitDefinition.tags
    );


  const normalizeTagKey =
    value => {
      return normalizeOisAgentText(
        value
      )
        .toUpperCase()
        .replace(
          /XJ41$/,
          ""
        );
    };


  const targetTagSet =
    new Set(
      targetEntries.map(
        (
          [
            ,
            tag
          ]
        ) => {
          return normalizeTagKey(
            tag
          );
        }
      )
    );


  return await new Promise(
    (
      resolve,
      reject
    ) => {
      let isSettled =
        false;


      let timeoutId =
        null;


      const cleanup = () => {
        if (
          timeoutId
        ) {
          clearTimeout(
            timeoutId
          );


          timeoutId =
            null;
        }


        page.off(
          "response",
          handleResponse
        );
      };


      const finish = (
        error,
        value
      ) => {
        if (
          isSettled
        ) {
          return;
        }


        isSettled =
          true;


        cleanup();


        if (
          error
        ) {
          reject(
            error
          );

        } else {
          resolve(
            value
          );
        }
      };


      const handleResponse =
        async response => {
          try {
            const responseUrl =
              String(
                response.url() ||
                ""
              );


            const request =
              response.request();


            const requestBody =
              String(
                request.postData() ||
                ""
              );


            if (
              !responseUrl.includes(
                "/ajax/data"
              ) ||
              String(
                request.method() ||
                ""
              ).toUpperCase() !==
                "POST" ||
              !requestBody.includes(
                "oi.LogSheetService.listLogSheetSearch"
              )
            ) {
              return;
            }


            const responseText =
              await response.text();


            let responseData;


            try {
              responseData =
                JSON.parse(
                  responseText
                );

            } catch {
              return;
            }


            const rows =
              Array.isArray(
                responseData?.result
              )
                ? responseData.result
                : [];


            const rowMap =
              new Map();


            rows.forEach(
              row => {
                const rowTag =
                  normalizeTagKey(
                    row?.tag_no
                  );


                if (
                  targetTagSet.has(
                    rowTag
                  )
                ) {
                  rowMap.set(
                    rowTag,
                    row
                  );
                }
              }
            );


            const missingTags =
              [
                ...targetTagSet
              ].filter(
                tag => {
                  return !rowMap.has(
                    tag
                  );
                }
              );


            if (
              missingTags.length >
                0
            ) {
              finish(
                new Error(
                  `${unitDefinition.unit}호기 부재료 TAG를 찾지 못했습니다: ${missingTags.join(", ")}`
                )
              );


              return;
            }


            const namedRows = {};


            targetEntries.forEach(
              (
                [
                  key,
                  tag
                ]
              ) => {
                namedRows[
                  key
                ] =
                  rowMap.get(
                    normalizeTagKey(
                      tag
                    )
                  );
              }
            );


            finish(
              null,
              namedRows
            );

          } catch (
            error
          ) {
            finish(
              error
            );
          }
        };


      page.on(
        "response",
        handleResponse
      );


      timeoutId =
        setTimeout(
          () => {
            finish(
              new Error(
                `${unitDefinition.unit}호기 부재료 LOG SHEET 응답을 받지 못했습니다.`
              )
            );
          },
          OIS_QUERY_TIMEOUT
        );


      Promise.resolve()
        .then(
          triggerSearch
        )
        .catch(
          error => {
            finish(
              error
            );
          }
        );
    }
  );
}

/* =========================================================
  호기별 부재료 일별 자료 조회
========================================================= */

async function queryOisAuxiliaryMaterialUnit(
  page,
  unitDefinition,
  targetDate
) {
  let frame =
    await openOisLogSheetLookup(
      page
    );


  await selectOisOptionByLabel(
    frame,
    "설비운영팀",
    false
  );


  frame =
    await findOisLogSheetFrame(
      page
    ) ||
    frame;


  await selectOisOptionByLabel(
    frame,
    unitDefinition.sheetLabel,
    true
  );


  await page.waitForTimeout(
    500
  );


  frame =
    await findOisLogSheetFrame(
      page
    ) ||
    frame;


  await setOisLogSheetDate(
    frame,
    targetDate
  );


  const rows =
    await captureOisAuxiliaryMaterialRowsFromApi(
      page,
      unitDefinition,
      async () => {
        await clickOisLogSheetSearchButton(
          frame
        );
      }
    );


  const limeSlurryA =
    readOisAuxiliaryHourlyAverage(
      rows.limeSlurryA
    );


  const limeSlurryB =
    readOisAuxiliaryHourlyAverage(
      rows.limeSlurryB
    );


  const limeSlurryC =
    readOisAuxiliaryHourlyAverage(
      rows.limeSlurryC
    );


  const density =
    readOisAuxiliaryHourlyAverage(
      rows.limeSlurryDensity
    );


  const ammonia =
    readOisAuxiliaryHourlyAverage(
      rows.ammonia
    );


  const sox =
    readOisAuxiliaryHourlyAverage(
      rows.sox
    );


  const nox =
    readOisAuxiliaryHourlyAverage(
      rows.nox
    );


  const sampleCounts = [
    limeSlurryA.sampleCount,
    limeSlurryB.sampleCount,
    limeSlurryC.sampleCount,
    density.sampleCount,
    ammonia.sampleCount,
    sox.sampleCount,
    nox.sampleCount
  ];


  const limeSlurryFlowM3h =
    [
      limeSlurryA.average,
      limeSlurryB.average,
      limeSlurryC.average
    ].every(
      value =>
        value !== null
    )
      ? Math.round(
          (
            limeSlurryA.average +
            limeSlurryB.average +
            limeSlurryC.average
          ) *
          1000000
        ) /
        1000000
      : null;


  return {
    startStock:
      parseOisAgentNumber(
        rows.limestone?.decimal_pnt
      ),

    endStock:
      parseOisAgentNumber(
        rows.limestone?.hd_24
      ),

    limeSlurryFlowM3h,

    limeSlurryDensityKgm3:
      density.average,

    ammoniaFlowM3h:
      ammonia.average,

    soxPpm:
      sox.average,

    noxPpm:
      nox.average,

    sampleCount:
      Math.min(
        ...sampleCounts
      ),

    sampleCounts: {
      limeSlurryA:
        limeSlurryA.sampleCount,

      limeSlurryB:
        limeSlurryB.sampleCount,

      limeSlurryC:
        limeSlurryC.sampleCount,

      density:
        density.sampleCount,

      ammonia:
        ammonia.sampleCount,

      sox:
        sox.sampleCount,

      nox:
        nox.sampleCount
    },

    tags: {
      ...unitDefinition.tags
    }
  };
}

/* =========================================================
  선택 기간의 날짜 1일에 대한 1·2호기 부재료 수집
========================================================= */

async function collectOisAuxiliaryMaterialValues(
  page,
  config,
  targetDate
) {
  if (
    !isValidOisAgentDate(
      targetDate
    )
  ) {
    throw new Error(
      "OIS 부재료 조회 날짜가 올바르지 않습니다."
    );
  }


  await ensureOisAgentLoggedIn(
    page,
    config
  );


  const result = {
    targetDate,

    unitOne:
      null,

    unitTwo:
      null,

    collectedAt:
      ""
  };


  for (
    const unitDefinition of
    OIS_AUXILIARY_MATERIAL_DEFINITIONS
  ) {
    const unitResult =
      await queryOisAuxiliaryMaterialUnit(
        page,
        unitDefinition,
        targetDate
      );


    if (
      unitDefinition.unit ===
        1
    ) {
      result.unitOne =
        unitResult;

    } else {
      result.unitTwo =
        unitResult;
    }
  }


  result.collectedAt =
    new Date()
      .toISOString();


  return result;
}

/* =========================================================
  호기별 석회석 전일·24시 재고 조회

  화면의 표를 읽지 않고,
  조회 버튼 클릭 후 발생하는 OIS API 응답에서 읽는다.

  decimal_pnt = 전일
  hd_24       = 24시
========================================================= */

async function queryOisLimestonePreviousStock(
  page,
  unitDefinition,
  targetDate
) {
  let frame =
    await openOisLogSheetLookup(
      page
    );


  /*
    부서명:
    설비운영팀
  */
  await selectOisOptionByLabel(
    frame,
    "설비운영팀",
    false
  );


  frame =
    await findOisLogSheetFrame(
      page
    ) ||
    frame;


  /*
    1호기:
    BOARD LOGSHEET (BCO1)

    2호기:
    BOARD LOGSHEET (BCO2)
  */
  await selectOisOptionByLabel(
    frame,
    unitDefinition.sheetLabel,
    true
  );


  /*
    SHEET 선택에 따른 화면 갱신 대기
  */
  await page.waitForTimeout(
    500
  );


  frame =
    await findOisLogSheetFrame(
      page
    ) ||
    frame;


  /*
    조회 날짜 입력
  */
  await setOisLogSheetDate(
    frame,
    targetDate
  );


  await page.waitForTimeout(
    200
  );


  /*
    응답 감시를 먼저 시작한 뒤
    조회 버튼을 클릭한다.
  */
  const stocks =
    await captureOisLogSheetStockFromApi(
      page,
      unitDefinition.tag,
      async () => {
        await clickOisLogSheetSearchButton(
          frame
        );
      }
    );


  console.log(
    [
      `${unitDefinition.unit}호기`,
      targetDate,
      `전일 ${stocks.startStock} ton`,
      `24시 ${stocks.endStock} ton`
    ].join(
      " · "
    )
  );


  return {
    startStock:
      stocks.startStock,

    endStock:
      stocks.endStock
  };
}

/* =========================================================
  선택일의 1·2호기 석회석 재고 수집

  기존:
  - 선택일 전일
  - 다음 날 전일

  변경:
  - 선택일 전일
  - 선택일 24시

  날짜 조회는 호기별 한 번만 실행한다.
========================================================= */

async function collectOisLimestoneStocks(
  page,
  config,
  targetDate
) {
  if (
    !isValidOisAgentDate(
      targetDate
    )
  ) {
    throw new Error(
      "OIS 석회석 조회 날짜가 올바르지 않습니다."
    );
  }


  await ensureOisAgentLoggedIn(
    page,
    config
  );


  const collectedResult = {
    targetDate,

    /*
      API 기존 구조와의 호환을 위해
      다음 날짜 정보는 유지한다.
      재고값 자체는 선택일 24시 값이다.
    */
    nextDate:
      addOisAgentDateDays(
        targetDate,
        1
      ),

    unitOne: {
      tag:
        OIS_UNIT_DEFINITIONS[0]
          .tag,

      startStock:
        null,

      endStock:
        null
    },

    unitTwo: {
      tag:
        OIS_UNIT_DEFINITIONS[1]
          .tag,

      startStock:
        null,

      endStock:
        null
    },

    collectedAt:
      ""
  };


  for (
    const unitDefinition of
    OIS_UNIT_DEFINITIONS
  ) {
    const stocks =
      await queryOisLimestonePreviousStock(
        page,
        unitDefinition,
        targetDate
      );


    const resultKey =
      unitDefinition.unit ===
        1
          ? "unitOne"
          : "unitTwo";


    collectedResult[
      resultKey
    ].startStock =
      stocks.startStock;


    collectedResult[
      resultKey
    ].endStock =
      stocks.endStock;
  }


  collectedResult.collectedAt =
    new Date()
      .toISOString();


  return collectedResult;
}

/* =========================================================
  요청 처리 중 오류 화면 저장
========================================================= */

async function saveOisAgentErrorScreenshot(
  page,
  requestId
) {
  const safeRequestId =
    normalizeOisAgentText(
      requestId
    )
      .replace(
        /[^a-zA-Z0-9_-]/g,
        ""
      )
      .slice(
        0,
        40
      ) ||
    "unknown";


  const screenshotPath =
    path.join(
      process.cwd(),
      `ois-agent-error-${safeRequestId}.png`
    );


  await page.screenshot({
    path:
      screenshotPath,

    fullPage:
      true
  }).catch(
    () => null
  );


  return screenshotPath;
}

/* =========================================================
  OIS 브라우저 세션 자동 복구

  목적:
  - Edge 창이 닫힘
  - Playwright page/context/browser 종료
  - OIS 브라우저 연결 끊김

  위 상황이 발생해도 Node 에이전트 자체는 유지하고
  새 Edge 세션을 만들어 자동 로그인한다.
========================================================= */

function isOisAgentBrowserClosedError(
  error
) {
  const message =
    String(
      error?.message ||
      error ||
      ""
    )
      .toLowerCase();


  return [
    "target page, context or browser has been closed",
    "target page has been closed",
    "page has been closed",
    "context has been closed",
    "browser has been closed",
    "target closed",
    "browser closed",
    "context closed",
    "page closed"
  ].some(
    keyword => {
      return message.includes(
        keyword
      );
    }
  );
}


function isOisAgentBrowserSessionUsable(
  session
) {
  if (
    !session?.browser ||
    !session?.context ||
    !session?.page
  ) {
    return false;
  }


  try {
    return (
      session.browser.isConnected() ===
        true &&

      session.page.isClosed() !==
        true
    );

  } catch {
    return false;
  }
}


async function closeOisAgentBrowserSession(
  session,
  saveState =
    true
) {
  if (
    !session
  ) {
    return;
  }


  if (
    saveState &&
    session.context
  ) {
    await session.context
      .storageState({
        path:
          OIS_SESSION_FILE_PATH
      })
      .catch(
        () => null
      );
  }


  if (
    session.context
  ) {
    await session.context
      .close()
      .catch(
        () => null
      );
  }


  if (
    session.browser
  ) {
    await session.browser
      .close()
      .catch(
        () => null
      );
  }
}


async function createOisAgentBrowserSession(
  config
) {
  console.log(
    "OIS Edge 브라우저 세션을 시작합니다."
  );


  const browser =
    await chromium.launch({
      channel:
        "msedge",

      headless:
        true,

      slowMo:
        60
    });


  const storedSessionExists =
    fs.existsSync(
      OIS_SESSION_FILE_PATH
    );


  let context;


  try {
    context =
      await browser.newContext(
        storedSessionExists
          ? {
              storageState:
                OIS_SESSION_FILE_PATH
            }
          : {}
      );

  } catch (
    error
  ) {
    console.warn(
      "저장된 OIS 세션을 재사용하지 못했습니다. 새 세션으로 시작합니다.",
      error instanceof Error
        ? error.message
        : error
    );


    context =
      await browser.newContext();
  }


  const page =
    context.pages()[0] ||
    await context.newPage();


  const session = {
    browser,
    context,
    page
  };


  browser.on(
    "disconnected",
    () => {
      console.warn(
        "OIS Edge 브라우저 연결이 종료되었습니다. 자동 복구를 대기합니다."
      );
    }
  );


  page.on(
    "close",
    () => {
      console.warn(
        "OIS 자동화 페이지가 닫혔습니다. 자동 복구를 대기합니다."
      );
    }
  );


  try {
    await ensureOisAgentLoggedIn(
      page,
      config
    );


    await context
      .storageState({
        path:
          OIS_SESSION_FILE_PATH
      })
      .catch(
        () => null
      );


    console.log(
      "OIS Edge 브라우저 세션이 준비되었습니다."
    );


    return session;

  } catch (
    error
  ) {
    await closeOisAgentBrowserSession(
      session,
      false
    );


    throw error;
  }
}


async function ensureOisAgentBrowserSession(
  session,
  config,
  reason =
    ""
) {
  if (
    isOisAgentBrowserSessionUsable(
      session
    )
  ) {
    try {
      await ensureOisAgentLoggedIn(
        session.page,
        config
      );


      return session;

    } catch (
      error
    ) {
      if (
        !isOisAgentBrowserClosedError(
          error
        ) &&
        isOisAgentBrowserSessionUsable(
          session
        )
      ) {
        throw error;
      }
    }
  }


  console.warn(
    [
      "OIS 브라우저 세션을 자동 복구합니다.",

      reason
        ? `사유: ${reason}`
        : ""
    ]
      .filter(
        Boolean
      )
      .join(
        " "
      )
  );


  await closeOisAgentBrowserSession(
    session,
    false
  );


  await waitOisAgent(
    1000
  );


  return await createOisAgentBrowserSession(
    config
  );
}

/* =========================================================
  OIS · 일일 DATA Excel 상시 연동 에이전트

  지원 요청:
  - 석회석 재고
  - 수처리 현황
  - Gear Wheel / Pinion
  - 일일 DATA Excel
========================================================= */

async function loginOis() {
  const config =
    getOisAgentConfig();


  console.log(
    "=========================================="
  );


  console.log(
    "GS Shift Log OIS · Excel 연동 프로그램"
  );


  console.log(
    "=========================================="
  );


  console.log(
    "업무일지 주소:",
    config.shiftLogBaseUrl
  );


  console.log(
    "에이전트 ID:",
    config.agentId
  );


  console.log(
    "연동 모드:",
    config.agentMode ===
      "excel"
      ? "Excel 전용"
      : "OIS + Excel"
  );


  console.log(
    "요청 확인 주기:",
    `${OIS_AGENT_POLL_INTERVAL / 1000}초`
  );


  console.log(
    "지원 요청:",
    config.agentMode ===
      "excel"
      ? "일일 DATA Excel"
      : "석회석 재고 · 수처리 현황 · Gear Wheel / Pinion · 일일 DATA Excel"
  );


  let browserSession =
    null;


  let isShuttingDown =
    false;


  let recoveryCount =
    0;


  function isBrowserClosedError(
    error
  ) {
    const message =
      String(
        error?.message ||
        error ||
        ""
      )
        .toLowerCase();


    return [
      "target page, context or browser has been closed",
      "target page has been closed",
      "page has been closed",
      "context has been closed",
      "browser has been closed",
      "target closed"
    ].some(
      keyword => {
        return message.includes(
          keyword
        );
      }
    );
  }


  function getLivePage(
    session
  ) {
    if (
      !session?.browser ||
      !session?.context
    ) {
      return null;
    }


    try {
      if (
        session.browser.isConnected() !==
          true
      ) {
        return null;
      }


      if (
        session.page &&
        session.page.isClosed() !==
          true
      ) {
        return session.page;
      }


      const replacementPage =
        session.context
          .pages()
          .find(
            page => {
              return page.isClosed() !==
                true;
            }
          ) ||
        null;


      if (
        replacementPage
      ) {
        session.page =
          replacementPage;
      }


      return replacementPage;

    } catch {
      return null;
    }
  }


  function isBrowserSessionUsable(
    session
  ) {
    return Boolean(
      getLivePage(
        session
      )
    );
  }


  async function closeBrowserSession(
    session,
    saveState =
      true
  ) {
    if (
      !session
    ) {
      return;
    }


    if (
      saveState &&
      session.context
    ) {
      await session.context
        .storageState({
          path:
            OIS_SESSION_FILE_PATH
        })
        .catch(
          () => null
        );
    }


    if (
      session.context
    ) {
      await session.context
        .close()
        .catch(
          () => null
        );
    }


    if (
      session.browser
    ) {
      await session.browser
        .close()
        .catch(
          () => null
        );
    }
  }


  async function createBrowserSession() {
    /*
      여기까지 들어왔다는 것은 실제 OIS 자료 요청이다.
      Excel 전용 요청은 이 함수를 호출하지 않는다.
    */

    assertOisLoginCredentials(
      config
    );


    console.log(
      "OIS Edge 브라우저 세션을 시작합니다."
    );


    const browser =
      await chromium.launch({
        channel:
          "msedge",

        headless:
          true,

        slowMo:
          60
      });


    const contextOptions =
      fs.existsSync(
        OIS_SESSION_FILE_PATH
      )
        ? {
            storageState:
              OIS_SESSION_FILE_PATH
          }
        : {};


    let context;


    try {
      context =
        await browser.newContext(
          contextOptions
        );

    } catch (
      error
    ) {
      console.warn(
        "저장된 OIS 세션을 재사용하지 못했습니다. 새 세션으로 시작합니다.",
        error instanceof
          Error
          ? error.message
          : error
      );


      context =
        await browser.newContext();
    }


    const page =
      context.pages()[0] ||
      await context.newPage();


    const session = {
      browser,
      context,
      page
    };


    browser.on(
      "disconnected",
      () => {
        console.warn(
          "OIS Edge 브라우저 연결이 종료되었습니다."
        );
      }
    );


    try {
      await ensureOisAgentLoggedIn(
        session.page,
        config
      );


      /*
        로그인 직후 기존 페이지가 닫히고
        같은 context에 새 페이지가 만들어지는 경우도
        살아 있는 페이지로 다시 연결한다.
      */
      await waitOisAgent(
        300
      );


      const livePage =
        getLivePage(
          session
        );


      if (
        !livePage
      ) {
        throw new Error(
          "OIS 로그인 후 사용할 브라우저 페이지가 닫혔습니다."
        );
      }


      session.page =
        livePage;


      await session.context
        .storageState({
          path:
            OIS_SESSION_FILE_PATH
        })
        .catch(
          () => null
        );


      console.log(
        "OIS Edge 브라우저 세션이 준비되었습니다."
      );


      return session;

    } catch (
      error
    ) {
      await closeBrowserSession(
        session,
        false
      );


      throw error;
    }
  }


  async function ensureBrowserSession(
    reason =
      ""
  ) {
    const currentPage =
      getLivePage(
        browserSession
      );


    if (
      currentPage
    ) {
      browserSession.page =
        currentPage;


      try {
        await ensureOisAgentLoggedIn(
          browserSession.page,
          config
        );


        return browserSession;

      } catch (
        error
      ) {
        if (
          !isBrowserClosedError(
            error
          ) &&
          isBrowserSessionUsable(
            browserSession
          )
        ) {
          throw error;
        }
      }
    }


    console.warn(
      [
        "OIS 브라우저 세션을 자동 복구합니다.",

        reason
          ? `사유: ${reason}`
          : ""
      ]
        .filter(
          Boolean
        )
        .join(
          " "
        )
    );


    await closeBrowserSession(
      browserSession,
      false
    );


    browserSession =
      null;


    await waitOisAgent(
      1000
    );


    browserSession =
      await createBrowserSession();


    recoveryCount +=
      1;


    console.log(
      `OIS 브라우저 자동 복구 완료 (${recoveryCount}회)`
    );


    return browserSession;
  }


  const closeAgent =
    async () => {
      if (
        isShuttingDown
      ) {
        return;
      }


      isShuttingDown =
        true;


      console.log(
        ""
      );


      console.log(
        "OIS 연동 프로그램을 종료합니다."
      );


      await closeBrowserSession(
        browserSession,
        true
      );


      process.exit(
        0
      );
    };


  process.once(
    "SIGINT",
    closeAgent
  );


  process.once(
    "SIGTERM",
    closeAgent
  );


  try {
    console.log(
      "업무일지의 OIS · Excel 요청을 기다립니다."
    );


    while (
      !isShuttingDown
    ) {
      let requestItem =
        null;


      try {
        requestItem =
          await getNextOisAgentRequest(
            config
          );

      } catch (
        error
      ) {
        console.error(
          "업무일지 요청 확인 실패:",
          error instanceof
            Error
            ? error.message
            : error
        );


        await waitOisAgent(
          OIS_AGENT_ERROR_RETRY_INTERVAL
        );


        continue;
      }


      /*
        요청이 없을 때는 OIS Edge를 열거나 복구하지 않는다.

        실제 OIS 요청이 들어왔을 때만 브라우저 세션을
        지연 생성하므로, 집에서도 Excel 전용 요청을
        OIS 로그인 없이 처리할 수 있다.
      */
      if (
        !requestItem
      ) {
        await waitOisAgent(
          OIS_AGENT_POLL_INTERVAL
        );


        continue;
      }


      const requestId =
        normalizeOisAgentText(
          requestItem.id
        );


      const requestType =
        getOisAgentRequestType(
          requestItem
        );


      const requestLabel =
        getOisAgentRequestLabel(
          requestType
        );


      const requestNeedsOisBrowser =
        !isDailyDataExcelRequestType(
          requestType
        );


      const requestSourceLabel =
        requestNeedsOisBrowser
          ? "OIS"
          : "Excel";


      const targetDate =
        normalizeOisAgentText(
          requestItem.targetDate ||
          requestItem.target_date
        );


      console.log(
        ""
      );


      console.log(
        "------------------------------------------"
      );


      console.log(
        `${requestLabel} 조회 요청을 받았습니다.`
      );


      console.log(
        "요청 유형:",
        requestType
      );


      console.log(
        "요청 ID:",
        requestId
      );


      console.log(
        "조회일:",
        targetDate
      );


      console.log(
        "------------------------------------------"
      );


      try {
        let result;


        if (
          !requestNeedsOisBrowser
        ) {
          /*
            Excel 전용 요청:
            OIS Edge 및 로그인 없이 열린 통합문서만 읽는다.
          */

          result =
            await collectOisAgentRequestResult(
              null,
              config,
              requestItem
            );

        } else {
          /*
            실제 OIS 요청:
            이 시점에만 브라우저를 지연 생성·로그인한다.
          */

          await ensureBrowserSession(
            `${requestLabel} 요청 처리 전`
          );


          try {
            result =
              await collectOisAgentRequestResult(
                browserSession.page,
                config,
                requestItem
              );

          } catch (
            firstError
          ) {
            /*
              브라우저 종료 오류인 경우
              Edge를 새로 열고 같은 요청을 한 번 재시도한다.
            */
            if (
              !isBrowserClosedError(
                firstError
              ) &&
              isBrowserSessionUsable(
                browserSession
              )
            ) {
              throw firstError;
            }


            console.warn(
              `OIS ${requestLabel} 처리 중 브라우저 종료를 감지했습니다. 자동 복구 후 1회 재시도합니다.`
            );


            await closeBrowserSession(
              browserSession,
              false
            );


            browserSession =
              null;


            await ensureBrowserSession(
              `${requestLabel} 처리 중 브라우저 종료`
            );


            result =
              await collectOisAgentRequestResult(
                browserSession.page,
                config,
                requestItem
              );
          }
        }


        await completeOisAgentRequest(
          config,
          requestId,
          result
        );


        if (
          requestNeedsOisBrowser &&
          isBrowserSessionUsable(
            browserSession
          )
        ) {
          await browserSession.context
            .storageState({
              path:
                OIS_SESSION_FILE_PATH
            })
            .catch(
              () => null
            );
        }


        console.log(
          `${requestSourceLabel} ${requestLabel} 조회가 완료되었습니다.`
        );


        printOisAgentRequestResult(
          requestType,
          result
        );

      } catch (
        error
      ) {
        console.error(
          `${requestSourceLabel} ${requestLabel} 요청 처리 실패:`,
          error
        );


        /*
          실패했는데 브라우저가 죽은 상태라면
          다음 요청 전에 바로 복구한다.
        */
        if (
          requestNeedsOisBrowser &&
          browserSession &&
          (
            isBrowserClosedError(
              error
            ) ||
            !isBrowserSessionUsable(
              browserSession
            )
          )
        ) {
          try {
            await ensureBrowserSession(
              `${requestLabel} 실패 후 복구`
            );

          } catch (
            recoveryError
          ) {
            console.error(
              "OIS 브라우저 자동 복구 실패:",
              recoveryError
            );
          }
        }


        let screenshotPath =
          "";


        if (
          requestNeedsOisBrowser &&
          isBrowserSessionUsable(
            browserSession
          )
        ) {
          screenshotPath =
            await saveOisAgentErrorScreenshot(
              browserSession.page,
              requestId
            );
        }


        if (
          screenshotPath
        ) {
          console.error(
            "오류 화면 저장:",
            screenshotPath
          );

        } else if (
          requestNeedsOisBrowser
        ) {
          console.error(
            "오류 화면 저장 생략: 사용할 수 있는 OIS 페이지가 없습니다."
          );
        }


        await failOisAgentRequest(
          config,
          requestId,
          error
        ).catch(
          failError => {
            console.error(
              "업무일지에 실패 결과를 전달하지 못했습니다.",
              failError
            );
          }
        );
      }


      await waitOisAgent(
        1000
      );
    }

  } finally {
    if (
      !isShuttingDown
    ) {
      await closeBrowserSession(
        browserSession,
        true
      );
    }
  }
}

/* =========================================================
  OIS 연동 프로그램 실행

  DATAPARC_TAG_BROWSER_TRACE=1:
  - OIS 폴링 대신 Tag Browser 통신 진단만 실행한다.

  그 외:
  - 기존 OIS 상시 연동 에이전트를 그대로 실행한다.
========================================================= */

const oisAgentStartPromise =
  isDataParcTagBrowserTraceEnabled()
    ? runDataParcTagBrowserTrace()
    : loginOis();


oisAgentStartPromise
  .catch(
    error => {
      console.error(
        ""
      );


      console.error(
        isDataParcTagBrowserTraceEnabled()
          ? "DataPARC Tag Browser 통신 진단 실패:"
          : "OIS 연동 프로그램 실행 실패:"
      );


      console.error(
        error
      );


      process.exitCode =
        1;
    }
  );
