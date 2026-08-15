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


  const sheetName =
    normalizeText(
      response.headers.get(
        "X-Log-Sheet-Name"
      )
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

function runExcelToPdf(
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


    const pdfBuffer =
      readAndValidatePdf(
        pdfPath
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