"use strict";


const fs =
  require(
    "node:fs"
  );


const path =
  require(
    "node:path"
  );


const crypto =
  require(
    "node:crypto"
  );


const {
  chromium
} =
  require(
    "playwright"
  );


/* =========================================================
  기본 설정
========================================================= */

const OIS_LOGIN_URL =
  "http://ois.gspoge.com/jsp/login/index";


const OIS_SESSION_FILE_PATH =
  path.join(
    process.cwd(),
    "ois-session.json"
  );


const OIS_TIMEOUT =
  30000;


/* =========================================================
  진단 결과 파일명

  실행할 때마다 새로운 파일을 만든다.
========================================================= */

function getDiagnosticTimestamp() {
  const now =
    new Date();


  return [
    now.getFullYear(),

    String(
      now.getMonth() +
      1
    ).padStart(
      2,
      "0"
    ),

    String(
      now.getDate()
    ).padStart(
      2,
      "0"
    ),

    "-",

    String(
      now.getHours()
    ).padStart(
      2,
      "0"
    ),

    String(
      now.getMinutes()
    ).padStart(
      2,
      "0"
    ),

    String(
      now.getSeconds()
    ).padStart(
      2,
      "0"
    )
  ].join(
    ""
  );
}


const DIAGNOSTIC_OUTPUT_PATH =
  path.join(
    process.cwd(),

    `ois-logsheet-diagnostic-${getDiagnosticTimestamp()}.jsonl`
  );


/* =========================================================
  문자열 정리
========================================================= */

function normalizeText(
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
  .env 파일 읽기

  사용:
  OIS_ID
  OIS_PASSWORD
========================================================= */

function loadLocalEnvironment() {
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


  environmentText =
    environmentText.replace(
      /^\uFEFF/,
      ""
    );


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
            .trim();


        let value =
          line
            .slice(
              equalIndex +
              1
            )
            .trim();


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
      }
    );


  const userId =
    normalizeText(
      process.env.OIS_ID
    );


  const password =
    String(
      process.env.OIS_PASSWORD ||
      ""
    );


  if (
    !userId
  ) {
    throw new Error(
      ".env의 OIS_ID가 비어 있습니다."
    );
  }


  if (
    !password
  ) {
    throw new Error(
      ".env의 OIS_PASSWORD가 비어 있습니다."
    );
  }


  return {
    userId,
    password
  };
}


/* =========================================================
  JSONL 한 줄 저장
========================================================= */

function appendDiagnosticRecord(
  record
) {
  fs.appendFileSync(
    DIAGNOSTIC_OUTPUT_PATH,

    `${JSON.stringify(
      record
    )}\n`,

    "utf8"
  );
}


/* =========================================================
  JSON 파싱
========================================================= */

function tryParseJson(
  value
) {
  const text =
    String(
      value ||
      ""
    ).trim();


  if (
    !text
  ) {
    return null;
  }


  try {
    return JSON.parse(
      text
    );

  } catch {
    return null;
  }
}


/* =========================================================
  요청 BODY에서 OIS cmd 후보 찾기

  예:
  oi.LogSheetService.listLogSheetSearch
========================================================= */

function findOisCommandCandidates(
  requestBody
) {
  const source =
    String(
      requestBody ||
      ""
    );


  const result =
    new Set();


  /*
    oi.XXXXXService.XXXXX 형태
  */

  const serviceMatches =
    source.match(
      /oi\.[A-Za-z0-9_$.-]+/g
    ) ||
    [];


  serviceMatches.forEach(
    value => {
      result.add(
        value
      );
    }
  );


  /*
    URL 인코딩된 BODY도 검사
  */

  try {
    const decoded =
      decodeURIComponent(
        source.replace(
          /\+/g,
          " "
        )
      );


    const decodedMatches =
      decoded.match(
        /oi\.[A-Za-z0-9_$.-]+/g
      ) ||
      [];


    decodedMatches.forEach(
      value => {
        result.add(
          value
        );
      }
    );

  } catch {
    // 무시
  }


  /*
    form-urlencoded 검사
  */

  try {
    const parameters =
      new URLSearchParams(
        source
      );


    for (
      const [
        key,
        value
      ] of parameters.entries()
    ) {
      if (
        /cmd|command|service|method/i.test(
          key
        )
      ) {
        const normalizedValue =
          normalizeText(
            value
          );


        if (
          normalizedValue
        ) {
          result.add(
            normalizedValue
          );
        }
      }


      const nestedMatches =
        String(
          value ||
          ""
        ).match(
          /oi\.[A-Za-z0-9_$.-]+/g
        ) ||
        [];


      nestedMatches.forEach(
        candidate => {
          result.add(
            candidate
          );
        }
      );
    }

  } catch {
    // 무시
  }


  return [
    ...result
  ];
}


/* =========================================================
  응답 JSON에서 의미 있어 보이는 필드 찾기

  콘솔 표시용이다.
  원본 응답은 별도로 전체 저장된다.
========================================================= */

function collectInterestingFields(
  value,
  result = [],
  parentPath =
    "",
  depth =
    0
) {
  if (
    depth >
    7 ||
    result.length >=
      80
  ) {
    return result;
  }


  if (
    Array.isArray(
      value
    )
  ) {
    value
      .slice(
        0,
        20
      )
      .forEach(
        (
          child,
          index
        ) => {
          collectInterestingFields(
            child,
            result,

            `${parentPath}[${index}]`,

            depth +
            1
          );
        }
      );


    return result;
  }


  if (
    !value ||
    typeof value !==
      "object"
  ) {
    return result;
  }


  Object.entries(
    value
  ).forEach(
    (
      [
        key,
        childValue
      ]
    ) => {
      if (
        result.length >=
        80
      ) {
        return;
      }


      const currentPath =
        parentPath
          ? `${parentPath}.${key}`
          : key;


      /*
        과거 업무일지와 관련 있을 가능성이 높은 필드명
      */

      if (
        /remark|bigo|memo|note|content|work|log|worker|emp|user|name|shift|day|night|approval|approve|appr|part|근무|비고|결재|내용/i.test(
          key
        )
      ) {
        let previewValue =
          childValue;


        if (
          typeof childValue ===
            "string" &&
          childValue.length >
            500
        ) {
          previewValue =
            `${childValue.slice(0, 500)} ...`;
        }


        if (
          typeof childValue !==
            "object" ||
          childValue ===
            null
        ) {
          result.push({
            path:
              currentPath,

            value:
              previewValue
          });
        }
      }


      if (
        childValue &&
        typeof childValue ===
          "object"
      ) {
        collectInterestingFields(
          childValue,
          result,
          currentPath,
          depth +
            1
        );
      }
    }
  );


  return result;
}


/* =========================================================
  OIS 로그인
========================================================= */

async function ensureLoggedIn(
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
        OIS_TIMEOUT
    }
  );


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
      OIS_TIMEOUT
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
        OIS_TIMEOUT
    }
  );


  console.log(
    "OIS 로그인이 완료되었습니다."
  );
}


/* =========================================================
  /ajax/data 응답 감시

  사용자가 화면에서 무엇을 클릭하는지는 건드리지 않는다.
========================================================= */

function attachAjaxDiagnostic(
  page
) {
  if (
    page.__oisDiagnosticAttached
  ) {
    return;
  }


  page.__oisDiagnosticAttached =
    true;


  console.log(
    "OIS AJAX 감시 시작:",
    page.url()
  );


  page.on(
    "response",
    async response => {
      try {
        const request =
          response.request();


        const requestUrl =
          String(
            request.url() ||
            ""
          );


        const requestMethod =
          String(
            request.method() ||
            ""
          ).toUpperCase();


        /*
          OIS 내부 AJAX 데이터만 기록
        */

        if (
          !requestUrl.includes(
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
          );


        let responseBody =
          "";


        try {
          responseBody =
            await response.text();

        } catch (
          error
        ) {
          responseBody =
            `[response.text 실패: ${
              error instanceof
                Error
                ? error.message
                : String(
                    error
                  )
            }]`;
        }


        const responseJson =
          tryParseJson(
            responseBody
          );


        const commandCandidates =
          findOisCommandCandidates(
            requestBody
          );


        const interestingFields =
          responseJson
            ? collectInterestingFields(
                responseJson
              )
            : [];


        const record = {
          type:
            "ajax",

          capturedAt:
            new Date()
              .toISOString(),

          pageUrl:
            page.url(),

          requestUrl,

          requestMethod,

          commandCandidates,

          requestBody,

          responseStatus:
            response.status(),

          responseBody
        };


        appendDiagnosticRecord(
          record
        );


        console.log(
          ""
        );


        console.log(
          "=========================================="
        );


        console.log(
          "OIS /ajax/data 감지"
        );


        console.log(
          "시간:",
          record.capturedAt
        );


        console.log(
          "HTTP:",
          response.status()
        );


        if (
          commandCandidates.length >
          0
        ) {
          console.log(
            "CMD 후보:"
          );


          commandCandidates.forEach(
            command => {
              console.log(
                " -",
                command
              );
            }
          );

        } else {
          console.log(
            "CMD 후보: 자동 식별 안 됨"
          );
        }


        if (
          responseJson
        ) {
          console.log(
            "응답 최상위 KEY:",
            Object.keys(
              responseJson
            ).join(
              ", "
            )
          );


          if (
            Array.isArray(
              responseJson.result
            )
          ) {
            console.log(
              "result 행 수:",
              responseJson
                .result
                .length
            );
          }
        }


        if (
          interestingFields.length >
          0
        ) {
          console.log(
            "업무일지 관련 후보 필드:"
          );


          interestingFields
            .slice(
              0,
              30
            )
            .forEach(
              item => {
                console.log(
                  ` - ${item.path}:`,
                  item.value
                );
              }
            );
        }


        console.log(
          "전체 원본은 파일에 저장했습니다."
        );


        console.log(
          "=========================================="
        );

      } catch (
        error
      ) {
        console.error(
          "AJAX 진단 기록 오류:",
          error
        );
      }
    }
  );
}


/* =========================================================
  결재세부보기 팝업 DOM 읽기

  API를 못 찾더라도 화면에 표시된 실제 값은
  별도로 기록한다.
========================================================= */

async function readApprovalPopupSnapshot(
  page
) {
  for (
    const frame of
    page.frames()
  ) {
    try {
      const snapshot =
        await frame.evaluate(
          () => {
            const normalize = (
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


            const isVisible = (
              element
            ) => {
              if (
                !(element instanceof
                  Element)
              ) {
                return false;
              }


              const rectangle =
                element.getBoundingClientRect();


              if (
                rectangle.width <=
                  0 ||
                rectangle.height <=
                  0
              ) {
                return false;
              }


              const style =
                window.getComputedStyle(
                  element
                );


              return (
                style.display !==
                  "none" &&
                style.visibility !==
                  "hidden" &&
                Number(
                  style.opacity
                ) !==
                  0
              );
            };


            const candidateElements = [
              ...document.querySelectorAll(
                `
                  div,
                  section,
                  article,
                  table
                `
              )
            ];


            const popupCandidates =
              candidateElements
                .map(
                  element => {
                    if (
                      !isVisible(
                        element
                      )
                    ) {
                      return null;
                    }


                    const text =
                      normalize(
                        element.innerText ||
                        element.textContent ||
                        ""
                      );


                    if (
                      !text.includes(
                        "결재세부보기"
                      )
                    ) {
                      return null;
                    }


                    if (
                      !text.includes(
                        "근무구분"
                      ) ||
                      !text.includes(
                        "비고"
                      ) ||
                      !text.includes(
                        "결재"
                      )
                    ) {
                      return null;
                    }


                    const rectangle =
                      element.getBoundingClientRect();


                    return {
                      element,

                      text,

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
                    return (
                      first.area -
                      second.area
                    );
                  }
                );


            const popup =
              popupCandidates[0]
                ?.element ||
              null;


            if (
              !popup
            ) {
              return null;
            }


            const readControlValue = (
              element
            ) => {
              if (
                element instanceof
                  HTMLInputElement ||
                element instanceof
                  HTMLTextAreaElement
              ) {
                return element.value;
              }


              if (
                element instanceof
                  HTMLSelectElement
              ) {
                return (
                  element
                    .selectedOptions?.[0]
                    ?.textContent ||
                  element.value
                );
              }


              return "";
            };


            const rows = [
              ...popup.querySelectorAll(
                "tr"
              )
            ]
              .map(
                row => {
                  const cells = [
                    ...row.querySelectorAll(
                      ":scope > th, :scope > td"
                    )
                  ]
                    .map(
                      cell => {
                        const controlValues = [
                          ...cell.querySelectorAll(
                            `
                              input,
                              textarea,
                              select
                            `
                          )
                        ]
                          .map(
                            control => {
                              return normalize(
                                readControlValue(
                                  control
                                )
                              );
                            }
                          )
                          .filter(
                            Boolean
                          );


                        const text =
                          normalize(
                            cell.innerText ||
                            cell.textContent ||
                            ""
                          );


                        return {
                          text,

                          values:
                            controlValues
                        };
                      }
                    );


                  return cells;
                }
              )
              .filter(
                cells => {
                  return cells.some(
                    cell => {
                      return (
                        cell.text ||
                        cell.values.length >
                          0
                      );
                    }
                  );
                }
              );


            const textareas = [
              ...popup.querySelectorAll(
                "textarea"
              )
            ].map(
              element => {
                return {
                  id:
                    element.id ||
                    "",

                  name:
                    element.name ||
                    "",

                  value:
                    element.value ||
                    ""
                };
              }
            );


            const inputs = [
              ...popup.querySelectorAll(
                "input"
              )
            ]
              .filter(
                element => {
                  const type =
                    String(
                      element.type ||
                      ""
                    ).toLowerCase();


                  return ![
                    "hidden",
                    "password"
                  ].includes(
                    type
                  );
                }
              )
              .map(
                element => {
                  return {
                    type:
                      element.type ||
                      "",

                    id:
                      element.id ||
                      "",

                    name:
                      element.name ||
                      "",

                    value:
                      element.value ||
                      ""
                  };
                }
              );


            const selects = [
              ...popup.querySelectorAll(
                "select"
              )
            ].map(
              element => {
                return {
                  id:
                    element.id ||
                    "",

                  name:
                    element.name ||
                    "",

                  value:
                    element.value ||
                    "",

                  text:
                    normalize(
                      element
                        .selectedOptions?.[0]
                        ?.textContent ||
                      ""
                    )
                };
              }
            );


            return {
              frameUrl:
                location.href,

              popupText:
                popup.innerText ||
                popup.textContent ||
                "",

              rows,

              textareas,

              inputs,

              selects
            };
          }
        );


      if (
        snapshot
      ) {
        return snapshot;
      }

    } catch {
      // 다른 프레임 계속 확인
    }
  }


  return null;
}


/* =========================================================
  팝업 변경 감시

  같은 내용은 중복 저장하지 않는다.
========================================================= */

function startPopupMonitor(
  page
) {
  let lastSnapshotHash =
    "";


  const timer =
    setInterval(
      async () => {
        try {
          if (
            page.isClosed()
          ) {
            return;
          }


          const snapshot =
            await readApprovalPopupSnapshot(
              page
            );


          if (
            !snapshot
          ) {
            return;
          }


          const snapshotJson =
            JSON.stringify(
              snapshot
            );


          const snapshotHash =
            crypto
              .createHash(
                "sha1"
              )
              .update(
                snapshotJson
              )
              .digest(
                "hex"
              );


          if (
            snapshotHash ===
            lastSnapshotHash
          ) {
            return;
          }


          lastSnapshotHash =
            snapshotHash;


          appendDiagnosticRecord({
            type:
              "approval-popup",

            capturedAt:
              new Date()
                .toISOString(),

            pageUrl:
              page.url(),

            snapshot
          });


          console.log(
            ""
          );


          console.log(
            "******************************************"
          );


          console.log(
            "결재세부보기 팝업을 감지했습니다."
          );


          console.log(
            "근무자/비고 화면값을 진단 파일에 저장했습니다."
          );


          console.log(
            "******************************************"
          );

        } catch (
          error
        ) {
          console.warn(
            "결재 팝업 확인 중 오류:",
            error instanceof
              Error
              ? error.message
              : error
          );
        }
      },

      1000
    );


  return () => {
    clearInterval(
      timer
    );
  };
}


/* =========================================================
  진단 프로그램 실행
========================================================= */

async function runDiagnostic() {
  const config =
    loadLocalEnvironment();


  console.log(
    "=========================================="
  );


  console.log(
    "OIS LOG SHEET 과거 업무일지 진단"
  );


  console.log(
    "=========================================="
  );


  console.log(
    "저장 파일:"
  );


  console.log(
    DIAGNOSTIC_OUTPUT_PATH
  );


  console.log(
    ""
  );


  console.log(
    "이 프로그램은 결재/저장 버튼을 자동으로 누르지 않습니다."
  );


  const browser =
    await chromium.launch({
      channel:
        "msedge",

      /*
        이번 진단에서는 사람이 직접 OIS 화면을
        조작해야 하므로 반드시 false
      */
      headless:
        false,

      slowMo:
        30
    });


  let context;


  if (
    fs.existsSync(
      OIS_SESSION_FILE_PATH
    )
  ) {
    try {
      context =
        await browser.newContext({
          storageState:
            OIS_SESSION_FILE_PATH
        });

    } catch (
      error
    ) {
      console.warn(
        "기존 OIS 세션을 불러오지 못해 새 세션으로 시작합니다."
      );


      context =
        await browser.newContext();
    }

  } else {
    context =
      await browser.newContext();
  }


  const page =
    context.pages()[0] ||
    await context.newPage();


  /*
    현재 페이지 감시
  */

  attachAjaxDiagnostic(
    page
  );


  let stopPopupMonitor =
    startPopupMonitor(
      page
    );


  /*
    새 창이 열리는 OIS 기능도 대응
  */

  context.on(
    "page",
    newPage => {
      console.log(
        "새 OIS 창을 감지했습니다."
      );


      attachAjaxDiagnostic(
        newPage
      );


      startPopupMonitor(
        newPage
      );
    }
  );


  await ensureLoggedIn(
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
    ""
  );


  console.log(
    "=========================================="
  );


  console.log(
    "준비 완료"
  );


  console.log(
    "=========================================="
  );


  console.log(
    ""
  );


  console.log(
    "이제 열린 Edge에서 직접 다음 순서로 진행하세요."
  );


  console.log(
    ""
  );


  console.log(
    "운영정보 → LOG SHEET → LOG SHEET작성"
  );


  console.log(
    ""
  );


  console.log(
    "첫 테스트:"
  );


  console.log(
    "일자  : 2022/11/15"
  );


  console.log(
    "SHEET : BOARD LOGSHEET (BCO1)"
  );


  console.log(
    ""
  );


  console.log(
    "그 다음 [결재요청] 버튼을 눌러"
  );


  console.log(
    "[결재세부보기] 창까지만 열어 주세요."
  );


  console.log(
    ""
  );


  console.log(
    "실제 결재완료/저장 작업은 하지 마세요."
  );


  console.log(
    ""
  );


  console.log(
    "팝업이 열린 뒤 5초 정도 기다렸다가"
  );


  console.log(
    "PowerShell 창에서 Ctrl + C를 누르면 됩니다."
  );


  let isClosing =
    false;


  const closeDiagnostic =
    async () => {
      if (
        isClosing
      ) {
        return;
      }


      isClosing =
        true;


      console.log(
        ""
      );


      console.log(
        "진단 프로그램을 종료합니다."
      );


      stopPopupMonitor();


      await context
        .storageState({
          path:
            OIS_SESSION_FILE_PATH
        })
        .catch(
          () => null
        );


      await context
        .close()
        .catch(
          () => null
        );


      await browser
        .close()
        .catch(
          () => null
        );


      console.log(
        ""
      );


      console.log(
        "진단 결과 파일:"
      );


      console.log(
        DIAGNOSTIC_OUTPUT_PATH
      );


      console.log(
        ""
      );


      console.log(
        "이 파일을 ChatGPT에 올려주세요."
      );


      process.exit(
        0
      );
    };


  process.once(
    "SIGINT",
    closeDiagnostic
  );


  process.once(
    "SIGTERM",
    closeDiagnostic
  );


  /*
    사용자가 Ctrl+C를 누를 때까지 계속 실행
  */

  await new Promise(
    () => {}
  );
}


/* =========================================================
  실행
========================================================= */

runDiagnostic()
  .catch(
    error => {
      console.error(
        ""
      );


      console.error(
        "OIS LOG SHEET 진단 프로그램 오류:"
      );


      console.error(
        error
      );


      process.exitCode =
        1;
    }
  );