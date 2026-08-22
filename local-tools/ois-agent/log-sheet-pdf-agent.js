"use strict";


const fs =
  require(
    "node:fs"
  );


const path =
  require(
    "node:path"
  );


const {
  spawn
} =
  require(
    "node:child_process"
  );


const LOG_SHEET_PDF_FILE_API_PATH =
  "/api/log-sheet-pdf-files";


const LOG_SHEET_PDF_PROCESS_TIMEOUT =
  90000;


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
  API 주소
========================================================= */

function getLogSheetPdfApiUrl(
  config,
  query = {}
) {
  const requestUrl =
    new URL(
      LOG_SHEET_PDF_FILE_API_PATH,
      config.shiftLogBaseUrl
    );


  Object.entries(
    query
  ).forEach(
    ([
      key,
      value
    ]) => {
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
  Agent 인증 헤더
========================================================= */

function getLogSheetPdfAgentHeaders(
  config,
  extraHeaders = {}
) {
  return {
    "X-OIS-Agent-Key":
      config.agentKey,

    "X-OIS-Agent-Id":
      config.agentId,

    ...extraHeaders
  };
}


/* =========================================================
  실패 응답 해석
========================================================= */

async function throwLogSheetPdfApiError(
  response,
  fallbackMessage
) {
  const responseText =
    await response
      .text()
      .catch(
        () => ""
      );


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
      result = {};
    }
  }


  throw new Error(
    result.message ||
    result.error ||
    fallbackMessage ||
    `Log Sheet PDF API 요청 실패 (HTTP ${response.status})`
  );
}


/* =========================================================
  XLSX 다운로드

  반환:
  {
    sheetName,
    size
  }
========================================================= */

async function downloadLogSheetWorkbook(
  config,
  requestId,
  outputPath
) {
  const requestUrl =
    getLogSheetPdfApiUrl(
      config,
      {
        action:
          "source",

        id:
          requestId,

        _:
          Date.now()
      }
    );


  const response =
    await fetch(
      requestUrl,
      {
        method:
          "GET",

        headers:
          getLogSheetPdfAgentHeaders(
            config,
            {
              Accept:
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            }
          ),

        cache:
          "no-store"
      }
    );


  if (
    !response.ok
  ) {
    await throwLogSheetPdfApiError(
      response,
      "Log Sheet Excel 원본을 내려받지 못했습니다."
    );
  }


  /*
    [LOG-SHEET-PDF-UNICODE-SHEETNAME-V3]

    서버가 한글 sheetName을 ASCII-safe URI component로 보낸다.
    기존 ASCII 응답과도 호환되도록 encoding header가 있을 때만 decode한다.
  */
  const sheetNameHeader =
    normalizeText(
      response.headers.get(
        "X-Log-Sheet-Name"
      )
    );


  const sheetNameEncoding =
    normalizeText(
      response.headers.get(
        "X-Log-Sheet-Name-Encoding"
      )
    ).toLowerCase();


  let sheetName =
    sheetNameHeader;


  if (
    sheetNameEncoding ===
      "uri-component"
  ) {
    try {
      sheetName =
        decodeURIComponent(
          sheetNameHeader
        );
    } catch (
      error
    ) {
      throw new Error(
        `Log Sheet 시트명 디코딩 실패: ${
          error?.message ||
          error
        }`
      );
    }
  }


  sheetName =
    normalizeText(
      sheetName
    );


  if (
    !sheetName
  ) {
    throw new Error(
      "PDF 변환 대상 Excel 시트명을 확인하지 못했습니다."
    );
  }


  const workbookBuffer =
    Buffer.from(
      await response.arrayBuffer()
    );


  if (
    workbookBuffer.length <
      4 ||
    workbookBuffer[0] !==
      0x50 ||
    workbookBuffer[1] !==
      0x4b
  ) {
    throw new Error(
      "회사 PC로 받은 파일이 올바른 XLSX가 아닙니다."
    );
  }


  fs.writeFileSync(
    outputPath,
    workbookBuffer
  );


  return {
    sheetName,

    size:
      workbookBuffer.length
  };
}


/* =========================================================
  Excel → PDF PowerShell 실행
========================================================= */

const LOG_SHEET_PDF_WORKER_READY_TIMEOUT =
  20000;

let logSheetPdfExcelWorker =
  null;

let logSheetPdfExcelWorkerReadyPromise =
  null;

let logSheetPdfExcelWorkerReadyResolve =
  null;

let logSheetPdfExcelWorkerReadyReject =
  null;

let logSheetPdfExcelWorkerReadyTimeout =
  null;

let logSheetPdfExcelWorkerOutputBuffer =
  "";

let logSheetPdfExcelWorkerStandardError =
  "";

let logSheetPdfExcelWorkerCurrentRequest =
  null;

let logSheetPdfExcelWorkerSequence =
  0;

let logSheetPdfExcelWorkerQueue =
  Promise.resolve();

function getLogSheetPdfPowerShellPath() {
  const systemRoot =
    process.env.SystemRoot ||
    "C:\\Windows";

  return path.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
}

function finishLogSheetPdfExcelWorkerRequest(
  error,
  result = null
) {
  const currentRequest =
    logSheetPdfExcelWorkerCurrentRequest;

  if (
    !currentRequest
  ) {
    return;
  }

  logSheetPdfExcelWorkerCurrentRequest =
    null;

  clearTimeout(
    currentRequest.timeoutId
  );

  if (
    error
  ) {
    currentRequest.reject(
      error
    );

    return;
  }

  currentRequest.resolve(
    result
  );
}

function failLogSheetPdfExcelWorker(
  childProcess,
  error
) {
  if (
    childProcess !==
      logSheetPdfExcelWorker
  ) {
    return;
  }

  if (
    logSheetPdfExcelWorkerReadyTimeout
  ) {
    clearTimeout(
      logSheetPdfExcelWorkerReadyTimeout
    );

    logSheetPdfExcelWorkerReadyTimeout =
      null;
  }

  if (
    logSheetPdfExcelWorkerReadyReject
  ) {
    logSheetPdfExcelWorkerReadyReject(
      error
    );
  }

  logSheetPdfExcelWorkerReadyResolve =
    null;

  logSheetPdfExcelWorkerReadyReject =
    null;

  finishLogSheetPdfExcelWorkerRequest(
    error
  );

  logSheetPdfExcelWorker =
    null;

  logSheetPdfExcelWorkerReadyPromise =
    null;

  logSheetPdfExcelWorkerOutputBuffer =
    "";

  logSheetPdfExcelWorkerStandardError =
    "";

  try {
    if (
      childProcess.exitCode ===
        null &&
      childProcess.signalCode ===
        null
    ) {
      childProcess.kill(
        "SIGKILL"
      );
    }
  }
  catch {}
}

function handleLogSheetPdfExcelWorkerLine(
  childProcess,
  line
) {
  const normalizedLine =
    normalizeText(
      line
    );

  if (
    !normalizedLine
  ) {
    return;
  }

  let message;

  try {
    message =
      JSON.parse(
        normalizedLine
      );
  }
  catch {
    console.warn(
      "Log Sheet Excel PDF Worker ?묐떟 ?댁꽍 ?ㅽ뙣:",
      normalizedLine
    );

    return;
  }

  if (
    message?.type ===
      "ready"
  ) {
    if (
      logSheetPdfExcelWorkerReadyTimeout
    ) {
      clearTimeout(
        logSheetPdfExcelWorkerReadyTimeout
      );

      logSheetPdfExcelWorkerReadyTimeout =
        null;
    }

    const resolveReady =
      logSheetPdfExcelWorkerReadyResolve;

    logSheetPdfExcelWorkerReadyResolve =
      null;

    logSheetPdfExcelWorkerReadyReject =
      null;

    resolveReady?.(
      childProcess
    );

    console.log(
      "Log Sheet Excel PDF Worker 以鍮??꾨즺:",
      `${Number(message.startupMs) || 0}ms`
    );

    return;
  }

  if (
    message?.type ===
      "fatal"
  ) {
    failLogSheetPdfExcelWorker(
      childProcess,
      new Error(
        normalizeText(
          message.error
        ) ||
          "Log Sheet Excel PDF Worker ?쒖옉???ㅽ뙣?덉뒿?덈떎."
      )
    );

    return;
  }

  if (
    message?.type !==
      "result"
  ) {
    return;
  }

  const currentRequest =
    logSheetPdfExcelWorkerCurrentRequest;

  if (
    !currentRequest ||
    normalizeText(
      message.id
    ) !==
      currentRequest.id
  ) {
    return;
  }

  if (
    message.ok !==
      true
  ) {
    finishLogSheetPdfExcelWorkerRequest(
      new Error(
        normalizeText(
          message.error
        ) ||
          "Log Sheet Excel PDF Worker 蹂?섏뿉 ?ㅽ뙣?덉뒿?덈떎."
      )
    );

    return;
  }

  finishLogSheetPdfExcelWorkerRequest(
    null,
    message
  );
}

function ensureLogSheetPdfExcelWorker() {
  if (
    logSheetPdfExcelWorker &&
    logSheetPdfExcelWorker.exitCode ===
      null &&
    logSheetPdfExcelWorker.signalCode ===
      null &&
    logSheetPdfExcelWorkerReadyPromise
  ) {
    return logSheetPdfExcelWorkerReadyPromise;
  }

  const workerPath =
    path.join(
      __dirname,
      "excel-to-pdf-worker.ps1"
    );

  if (
    !fs.existsSync(
      workerPath
    )
  ) {
    return Promise.reject(
      new Error(
        `Excel PDF Worker瑜?李얠? 紐삵뻽?듬땲?? ${workerPath}`
      )
    );
  }

  const childProcess =
    spawn(
      getLogSheetPdfPowerShellPath(),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        workerPath
      ],
      {
        windowsHide:
          true,

        stdio: [
          "pipe",
          "pipe",
          "pipe"
        ]
      }
    );

  logSheetPdfExcelWorker =
    childProcess;

  logSheetPdfExcelWorkerOutputBuffer =
    "";

  logSheetPdfExcelWorkerStandardError =
    "";

  logSheetPdfExcelWorkerReadyPromise =
    new Promise(
      (
        resolve,
        reject
      ) => {
        logSheetPdfExcelWorkerReadyResolve =
          resolve;

        logSheetPdfExcelWorkerReadyReject =
          reject;
      }
    );

  logSheetPdfExcelWorkerReadyTimeout =
    setTimeout(
      () => {
        failLogSheetPdfExcelWorker(
          childProcess,
          new Error(
            "Log Sheet Excel PDF Worker 以鍮??쒓컙??20珥덈? 珥덇낵?덉뒿?덈떎."
          )
        );
      },
      LOG_SHEET_PDF_WORKER_READY_TIMEOUT
    );

  logSheetPdfExcelWorkerReadyTimeout
    .unref?.();

  childProcess.stdout
    .setEncoding(
      "utf8"
    );

  childProcess.stderr
    .setEncoding(
      "utf8"
    );

  childProcess.stdout.on(
    "data",
    chunk => {
      logSheetPdfExcelWorkerOutputBuffer +=
        chunk;

      while (
        true
      ) {
        const lineBreakIndex =
          logSheetPdfExcelWorkerOutputBuffer
            .indexOf(
              "\n"
            );

        if (
          lineBreakIndex <
            0
        ) {
          break;
        }

        const line =
          logSheetPdfExcelWorkerOutputBuffer
            .slice(
              0,
              lineBreakIndex
            )
            .replace(
              /\r$/,
              ""
            );

        logSheetPdfExcelWorkerOutputBuffer =
          logSheetPdfExcelWorkerOutputBuffer
            .slice(
              lineBreakIndex +
                1
            );

        handleLogSheetPdfExcelWorkerLine(
          childProcess,
          line
        );
      }
    }
  );

  childProcess.stderr.on(
    "data",
    chunk => {
      logSheetPdfExcelWorkerStandardError +=
        chunk;

      if (
        logSheetPdfExcelWorkerStandardError.length >
          16000
      ) {
        logSheetPdfExcelWorkerStandardError =
          logSheetPdfExcelWorkerStandardError.slice(
            -16000
          );
      }
    }
  );

  childProcess.on(
    "error",
    error => {
      failLogSheetPdfExcelWorker(
        childProcess,
        new Error(
          `Log Sheet Excel PDF Worker ?ㅽ뻾 ?ㅽ뙣: ${error.message}`
        )
      );
    }
  );

  childProcess.on(
    "close",
    exitCode => {
      if (
        childProcess !==
          logSheetPdfExcelWorker
      ) {
        return;
      }

      const workerError =
        normalizeText(
          logSheetPdfExcelWorkerStandardError
        );

      failLogSheetPdfExcelWorker(
        childProcess,
        new Error(
          workerError ||
          `Log Sheet Excel PDF Worker媛 醫낅즺?섏뿀?듬땲?? (醫낅즺 肄붾뱶 ${exitCode})`
        )
      );
    }
  );

  return logSheetPdfExcelWorkerReadyPromise;
}

async function runLogSheetPdfExcelWorkerRequest(
  inputPath,
  outputPath,
  sheetName
) {
  const childProcess =
    await ensureLogSheetPdfExcelWorker();

  if (
    logSheetPdfExcelWorkerCurrentRequest
  ) {
    throw new Error(
      "Log Sheet Excel PDF Worker??泥섎━ 以묒씤 ?붿껌???⑥븘 ?덉뒿?덈떎."
    );
  }

  const requestId =
    [
      "logsheet",
      process.pid,
      Date.now(),
      ++logSheetPdfExcelWorkerSequence
    ].join(
      "-"
    );

  return await new Promise(
    (
      resolve,
      reject
    ) => {
      const timeoutId =
        setTimeout(
          () => {
            if (
              !logSheetPdfExcelWorkerCurrentRequest ||
              logSheetPdfExcelWorkerCurrentRequest.id !==
                requestId
            ) {
              return;
            }

            const timeoutError =
              new Error(
                "Log Sheet Excel PDF Worker 蹂???쒓컙??90珥덈? 珥덇낵?덉뒿?덈떎."
              );

            finishLogSheetPdfExcelWorkerRequest(
              timeoutError
            );

            failLogSheetPdfExcelWorker(
              childProcess,
              timeoutError
            );
          },
          LOG_SHEET_PDF_PROCESS_TIMEOUT
        );

      timeoutId.unref?.();

      logSheetPdfExcelWorkerCurrentRequest = {
        id:
          requestId,

        resolve,
        reject,
        timeoutId
      };

      const command =
        JSON.stringify({
          type:
            "convert",

          id:
            requestId,

          inputPath,
          outputPath,
          sheetName
        }) +
        "\n";

      try {
        childProcess.stdin.write(
          command,
          "utf8",
          error => {
            if (
              !error
            ) {
              return;
            }

            finishLogSheetPdfExcelWorkerRequest(
              error
            );

            failLogSheetPdfExcelWorker(
              childProcess,
              error
            );
          }
        );
      }
      catch (
        error
      ) {
        finishLogSheetPdfExcelWorkerRequest(
          error
        );

        failLogSheetPdfExcelWorker(
          childProcess,
          error
        );
      }
    }
  );
}

function runExcelToPdfWithWorker(
  inputPath,
  outputPath,
  sheetName
) {
  const execute =
    () =>
      runLogSheetPdfExcelWorkerRequest(
        inputPath,
        outputPath,
        sheetName
      );

  const task =
    logSheetPdfExcelWorkerQueue.then(
      execute,
      execute
    );

  logSheetPdfExcelWorkerQueue =
    task.catch(
      () => undefined
    );

  return task;
}

function runExcelToPdfOneShot(
  inputPath,
  outputPath,
  sheetName
) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      const helperPath =
        path.join(
          __dirname,
          "excel-to-pdf.ps1"
        );


      if (
        !fs.existsSync(
          helperPath
        )
      ) {
        reject(
          new Error(
            `Excel PDF 변환기를 찾지 못했습니다: ${helperPath}`
          )
        );


        return;
      }


      const systemRoot =
        process.env.SystemRoot ||
        "C:\\Windows";


      const powershellPath =
        path.join(
          systemRoot,
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe"
        );


      let childProcess;


      try {
        childProcess =
          spawn(
            powershellPath,
            [
              "-NoLogo",
              "-NoProfile",
              "-NonInteractive",
              "-STA",
              "-ExecutionPolicy",
              "Bypass",

              "-File",
              helperPath,

              "-InputPath",
              inputPath,

              "-OutputPath",
              outputPath,

              "-SheetName",
              sheetName
            ],
            {
              windowsHide:
                true,

              stdio: [
                "ignore",
                "pipe",
                "pipe"
              ]
            }
          );

      } catch (
        error
      ) {
        reject(
          error
        );


        return;
      }


      let standardOutput =
        "";


      let standardError =
        "";


      let settled =
        false;


      const finish =
        (
          error
        ) => {
          if (
            settled
          ) {
            return;
          }


          settled =
            true;


          clearTimeout(
            timeoutId
          );


          if (
            error
          ) {
            reject(
              error
            );

          } else {
            resolve();
          }
        };


      const stopProcess =
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
          } catch {}


          if (
            process.platform ===
              "win32" &&
            Number.isInteger(
              childProcess.pid
            )
          ) {
            try {
              const taskKill =
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


              taskKill.unref();

            } catch {}
          }
        };


      const timeoutId =
        setTimeout(
          () => {
            stopProcess();


            finish(
              new Error(
                "Log Sheet Excel → PDF 변환 시간이 90초를 초과했습니다."
              )
            );
          },
          LOG_SHEET_PDF_PROCESS_TIMEOUT
        );


      timeoutId.unref?.();


      childProcess.stdout
        .setEncoding(
          "utf8"
        );


      childProcess.stderr
        .setEncoding(
          "utf8"
        );


      childProcess.stdout.on(
        "data",
        chunk => {
          standardOutput +=
            chunk;
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
          finish(
            new Error(
              `Windows PowerShell을 실행하지 못했습니다: ${error.message}`
            )
          );
        }
      );


      childProcess.on(
        "close",
        exitCode => {
          if (
            settled
          ) {
            return;
          }


          if (
            exitCode !==
              0
          ) {
            finish(
              new Error(
                normalizeText(
                  standardError
                ) ||
                normalizeText(
                  standardOutput
                ) ||
                `Excel → PDF 변환 실패 (종료 코드 ${exitCode})`
              )
            );


            return;
          }


          if (
            !fs.existsSync(
              outputPath
            )
          ) {
            finish(
              new Error(
                "Excel 변환은 끝났지만 PDF 파일이 생성되지 않았습니다."
              )
            );


            return;
          }


          finish(
            null
          );
        }
      );
    }
  );
}

async function runExcelToPdf(
  inputPath,
  outputPath,
  sheetName
) {
  try {
    const workerResult =
      await runExcelToPdfWithWorker(
        inputPath,
        outputPath,
        sheetName
      );

    if (
      !fs.existsSync(
        outputPath
      )
    ) {
      throw new Error(
        "Excel PDF Worker 蹂?섏? ?꾨즺?먯?留?PDF ?뚯씪???앹꽦?섏? ?딆븯?듬땲??"
      );
    }

    console.log(
      "Log Sheet Excel PDF ?곸＜ Worker ?꾨즺:",
      [
        sheetName,
        `${Number(workerResult?.durationMs) || 0}ms`
      ].join(
        " 쨌 "
      )
    );

    return;
  }
  catch (
    error
  ) {
    console.warn(
      "Log Sheet Excel PDF ?곸＜ Worker ?ㅽ뙣 - 湲곗〈 蹂??諛⑹떇?쇰줈 ?꾪솚:",
      error instanceof Error
        ? error.message
        : error
    );

    return await runExcelToPdfOneShot(
      inputPath,
      outputPath,
      sheetName
    );
  }
}

function warmUpLogSheetPdfWorker() {
  ensureLogSheetPdfExcelWorker()
    .catch(
      error => {
        console.warn(
          "Log Sheet Excel PDF Worker ?ъ쟾 以鍮??ㅽ뙣 - 泥??붿껌?먯꽌 ?ㅼ떆 ?쒕룄?⑸땲??",
          error instanceof Error
            ? error.message
            : error
        );
      }
    );
}

setTimeout(
  warmUpLogSheetPdfWorker,
  0
);

/* =========================================================
  생성 PDF 검사
========================================================= */

function readAndValidatePdf(
  pdfPath
) {
  if (
    !fs.existsSync(
      pdfPath
    )
  ) {
    throw new Error(
      "생성된 PDF 파일을 찾을 수 없습니다."
    );
  }


  const pdfBuffer =
    fs.readFileSync(
      pdfPath
    );


  if (
    pdfBuffer.length <
      5 ||
    pdfBuffer
      .subarray(
        0,
        5
      )
      .toString(
        "ascii"
      ) !==
      "%PDF-"
  ) {
    throw new Error(
      "Microsoft Excel이 생성한 파일이 올바른 PDF가 아닙니다."
    );
  }


  return pdfBuffer;
}


/* =========================================================
  PDF 업로드
========================================================= */

async function uploadLogSheetPdf(
  config,
  requestId,
  pdfBuffer
) {
  const requestUrl =
    getLogSheetPdfApiUrl(
      config,
      {
        action:
          "upload_pdf",

        id:
          requestId
      }
    );


  const response =
    await fetch(
      requestUrl,
      {
        method:
          "POST",

        headers:
          getLogSheetPdfAgentHeaders(
            config,
            {
              Accept:
                "application/json",

              "Content-Type":
                "application/pdf"
            }
          ),

        cache:
          "no-store",

        body:
          pdfBuffer
      }
    );


  if (
    !response.ok
  ) {
    await throwLogSheetPdfApiError(
      response,
      "생성한 PDF를 업무일지 서버에 올리지 못했습니다."
    );
  }


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
        "PDF 업로드 서버 응답이 JSON 형식이 아닙니다."
      );
    }
  }


  if (
    result.ok ===
      false
  ) {
    throw new Error(
      result.message ||
      "PDF 업로드에 실패했습니다."
    );
  }


  return result;
}


/* =========================================================
  Log Sheet PDF 요청 처리

  순서:
  1. R2 XLSX 다운로드
  2. 임시 폴더 저장
  3. Microsoft Excel PDF 변환
  4. PDF 검사
  5. R2 업로드
  6. 임시 파일 삭제
========================================================= */

async function processLogSheetPdfRequest(
  config,
  requestItem
) {
  const requestId =
    normalizeText(
      requestItem?.id
    );


  if (
    !requestId
  ) {
    throw new Error(
      "Log Sheet PDF 요청 ID가 없습니다."
    );
  }


  const targetDate =
    normalizeText(
      requestItem?.targetDate ||
      requestItem?.target_date
    );

  const timingStartedAt =
    Date.now();

  let timingPreviousAt =
    timingStartedAt;

  const logLogSheetPdfTiming =
    label => {
      const now =
        Date.now();

      const stepSeconds =
        ((
          now -
          timingPreviousAt
        ) / 1000).toFixed(2);

      const totalSeconds =
        ((
          now -
          timingStartedAt
        ) / 1000).toFixed(2);

      timingPreviousAt =
        now;

      console.log(
        `[LOGSHEET PDF TIMING] ${label} | step=${stepSeconds}s | total=${totalSeconds}s`
      );
    };


  const temporaryBase =
    process.env.TEMP ||
    process.env.TMP ||
    __dirname;


  const safeRequestId =
    requestId.replace(
      /[^A-Za-z0-9-]/g,
      ""
    );


  const workDirectory =
    path.join(
      temporaryBase,
      [
        "gs-log-sheet-pdf",
        safeRequestId,
        process.pid,
        Date.now()
      ].join(
        "-"
      )
    );


  const sourcePath =
    path.join(
      workDirectory,
      "source.xlsx"
    );


  const pdfPath =
    path.join(
      workDirectory,
      "preview.pdf"
    );


  fs.mkdirSync(
    workDirectory,
    {
      recursive:
        true
    }
  );

  logLogSheetPdfTiming(
    "agent-start"
  );


  try {
    console.log(
      "Log Sheet XLSX 다운로드:",
      requestId
    );


    const sourceInfo =
      await downloadLogSheetWorkbook(
        config,
        requestId,
        sourcePath
      );

    logLogSheetPdfTiming(
      "xlsx-download-complete"
    );


    console.log(
      [
        "Log Sheet Excel PDF 변환 시작",
        sourceInfo.sheetName,
        `${sourceInfo.size} bytes`
      ].join(
        " · "
      )
    );


    await runExcelToPdf(
      sourcePath,
      pdfPath,
      sourceInfo.sheetName
    );

    logLogSheetPdfTiming(
      "excel-pdf-complete"
    );


    const pdfBuffer =
      readAndValidatePdf(
        pdfPath
      );

    logLogSheetPdfTiming(
      "pdf-validate-complete"
    );


    console.log(
      [
        "Log Sheet Excel PDF 변환 완료",
        sourceInfo.sheetName,
        `${pdfBuffer.length} bytes`
      ].join(
        " · "
      )
    );


    const uploadResult =
      await uploadLogSheetPdf(
        config,
        requestId,
        pdfBuffer
      );

    logLogSheetPdfTiming(
      "pdf-upload-complete"
    );


    console.log(
      "Log Sheet PDF 업로드 완료:",
      requestId
    );


    return {
      source:
        "Microsoft Excel ExportAsFixedFormat",

      targetDate,

      sheetName:
        sourceInfo.sheetName,

      workbookSize:
        sourceInfo.size,

      pdfSize:
        pdfBuffer.length,

      previewPath:
        normalizeText(
          uploadResult.previewPath
        ) ||
        `/api/log-sheet-pdf-files?action=preview&id=${encodeURIComponent(
          requestId
        )}`,

      collectedAt:
        new Date()
          .toISOString()
    };

  } finally {
    logLogSheetPdfTiming(
      "cleanup-start"
    );

    try {
      fs.rmSync(
        workDirectory,
        {
          recursive:
            true,

          force:
            true
        }
      );

      logLogSheetPdfTiming(
        "cleanup-complete"
      );

    } catch (
      error
    ) {
      console.warn(
        "Log Sheet PDF 임시 파일 정리 실패:",
        error instanceof Error
          ? error.message
          : error
      );
    }
  }
}


module.exports = {
  processLogSheetPdfRequest
};