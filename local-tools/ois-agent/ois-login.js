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
  chromium
} =
  require(
    "playwright"
  );


/* =========================================================
  OIS 연동 프로그램 설정

  업무일지 주소가 달라졌다면
  PowerShell의 SHIFT_LOG_BASE_URL로 변경할 수 있다.
========================================================= */

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

const fs =
  require(
    "node:fs"
  );


const path =
  require(
    "node:path"
  );


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
  표에서 특정 문구가 있는 행의 셀 목록 가져오기
========================================================= */

async function getOisTableRowCells(
  table,
  rowKeyword
) {
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


    const rowText =
      normalizeOisText(
        await row
          .innerText()
          .catch(
            () => ""
          )
      );


    if (
      !rowText.includes(
        rowKeyword
      )
    ) {
      continue;
    }


    const cells =
      row.locator(
        "th, td"
      );


    const cellCount =
      await cells.count();


    const cellTexts = [];


    for (
      let cellIndex = 0;
      cellIndex <
        cellCount;
      cellIndex +=
        1
    ) {
      cellTexts.push(
        normalizeOisText(
          await cells
            .nth(
              cellIndex
            )
            .innerText()
            .catch(
              () => ""
            )
        )
      );
    }


    return cellTexts;
  }


  throw new Error(
    `"${rowKeyword}" 행을 찾지 못했습니다.`
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
  일일 운전일지(환경) 메뉴 열기
========================================================= */

async function openOisEnvironmentDailyLog(
  page
) {
  /*
    이미 환경 화면이 열려 있으면
    메뉴를 다시 누르지 않는다.
  */
  const alreadyOpenedFrame =
    await findOisFrameContainingText(
      page,
      "1. 원수 (RAW WATER)",
      2000
    );


  if (
    alreadyOpenedFrame
  ) {
    return alreadyOpenedFrame;
  }


  console.log(
    "일일 운전일지(환경) 메뉴를 엽니다."
  );


  let menuClicked =
    false;


  for (
    const frame of
    page.frames()
  ) {
    const menuLocator =
      frame.getByText(
        "일일 운전일지(환경)",
        {
          exact:
            true
        }
      );


    const menuCount =
      await menuLocator
        .count()
        .catch(
          () => 0
        );


    for (
      let index = 0;
      index <
        menuCount;
      index +=
        1
    ) {
      const menu =
        menuLocator.nth(
          index
        );


      const isVisible =
        await menu
          .isVisible()
          .catch(
            () => false
          );


      if (
        !isVisible
      ) {
        continue;
      }


      await menu.click({
        timeout:
          10000
      });


      menuClicked =
        true;


      break;
    }


    if (
      menuClicked
    ) {
      break;
    }
  }


  if (
    !menuClicked
  ) {
    throw new Error(
      "일일 운전일지(환경) 메뉴를 찾지 못했습니다."
    );
  }


  const environmentFrame =
    await findOisFrameContainingText(
      page,
      "1. 원수 (RAW WATER)",
      30000
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
  OIS 수처리 자료 읽기

  추출:
  - 장자산단 원수 입고량
  - 순수 생산량
  - 순수 사용량
  - 원수 TANK 저장량·저장율
  - 여과수 TANK 저장량·저장율
  - 순수 TANK 저장량·저장율
========================================================= */

async function extractOisWaterTreatmentValues(
  page
) {
  const frame =
    await openOisEnvironmentDailyLog(
      page
    );


  /* =====================================================
    1. 원수 표
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


  const industrialComplexNumbers =
    getOisNumericCells(
      industrialComplexCells
    );


  const storageAmounts =
    getOisNumericCells(
      storageAmountCells
    );


  const storageRates =
    getOisNumericCells(
      storageRateCells
    );


  if (
    industrialComplexNumbers.length <
      1
  ) {
    throw new Error(
      "장자산단 원수 입고량을 읽지 못했습니다."
    );
  }


  if (
    storageAmounts.length <
      3
  ) {
    throw new Error(
      "원수·여과수·순수 TANK 저장량을 읽지 못했습니다."
    );
  }


  if (
    storageRates.length <
      3
  ) {
    throw new Error(
      "원수·여과수·순수 TANK 저장율을 읽지 못했습니다."
    );
  }


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
        return cellText.includes(
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


  const demiProduction =
    findNearestOisNumberBefore(
      pureWaterSummaryCells,
      pureWaterUsageIndex
    );


  const pureWaterUsage =
    findNearestOisNumberAfter(
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


  if (
    pureWaterUsage ===
      null
  ) {
    throw new Error(
      "순수 사용량을 읽지 못했습니다."
    );
  }


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


  return {
    source:
      "OIS 일일 운전일지(환경)",

    sourceDate,

    collectedAt:
      new Date()
        .toISOString(),

    rawWaterInflow:
      industrialComplexNumbers[
        0
      ],

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


  if (
    !userId
  ) {
    throw new Error(
      "OIS_ID 환경변수가 설정되지 않았습니다."
    );
  }


  if (
    !password
  ) {
    throw new Error(
      "OIS_PASSWORD 환경변수가 설정되지 않았습니다."
    );
  }


  if (
    !agentKey
  ) {
    throw new Error(
      "OIS_AGENT_KEY 환경변수가 설정되지 않았습니다."
    );
  }


  return {
    userId,

    password,

    agentKey,

    agentId,

    shiftLogBaseUrl:
      shiftLogBaseUrl.replace(
        /\/+$/,
        ""
      )
  };
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
  다음 대기 요청 가져오기
========================================================= */

async function getNextOisAgentRequest(
  config
) {
  const result =
    await requestOisAgentApi(
      config,

      getOisAgentApiUrl(
        config,
        {
          action:
            "next",

          requestType:
            "limestone_stock",

          _:
            Date.now()
        }
      )
    );


  return (
    result.item ||
    null
  );
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
  LOG SHEET 조회 메뉴 클릭
========================================================= */

async function openOisLogSheetLookup(
  page
) {
  const existingFrame =
    await findOisLogSheetFrame(
      page,
      1500
    );


  if (
    existingFrame
  ) {
    return existingFrame;
  }


  let clicked =
    false;


  for (
    const frame of
    page.frames()
  ) {
    const menuLocator =
      frame.getByText(
        /LOG\s*SHEET\s*조회/i
      );


    const count =
      await menuLocator
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
      const menuItem =
        menuLocator.nth(
          index
        );


      const isVisible =
        await menuItem
          .isVisible()
          .catch(
            () => false
          );


      if (
        !isVisible
      ) {
        continue;
      }


      await menuItem.click({
        timeout:
          10000
      });


      clicked =
        true;


      break;
    }


    if (
      clicked
    ) {
      break;
    }
  }


  if (
    !clicked
  ) {
    throw new Error(
      "OIS의 LOG SHEET 조회 메뉴를 찾지 못했습니다."
    );
  }


  const logSheetFrame =
    await findOisLogSheetFrame(
      page
    );


  if (
    !logSheetFrame
  ) {
    throw new Error(
      "OIS LOG SHEET 조회 화면이 열리지 않았습니다."
    );
  }


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
  TAG 행의 전일값 읽기

  HTML 표의 rowspan·colspan을 계산하여
  전일 열과 TAG 행의 교차값을 읽는다.

  표 구조가 달라졌을 때는 TAG 뒤에서
  첫 번째 순수 숫자를 찾는 방식으로 재시도한다.
========================================================= */

async function readOisPreviousStockValue(
  frame,
  targetTag
) {
  const rawResult =
    await frame.evaluate(
      tagValue => {
        const normalizeText =
          value => {
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


        const parseNumber =
          value => {
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


        const tables = [
          ...document.querySelectorAll(
            "table"
          )
        ];


        for (
          const table of
          tables
        ) {
          const rows = [
            ...table.rows
          ];


          if (
            rows.length ===
              0
          ) {
            continue;
          }


          const grid = [];


          rows.forEach(
            (
              row,
              rowIndex
            ) => {
              grid[
                rowIndex
              ] =
                grid[
                  rowIndex
                ] ||
                [];


              let columnIndex =
                0;


              [
                ...row.cells
              ].forEach(
                cell => {
                  while (
                    grid[
                      rowIndex
                    ][
                      columnIndex
                    ]
                  ) {
                    columnIndex +=
                      1;
                  }


                  const rowSpan =
                    Math.max(
                      1,
                      Number(
                        cell.rowSpan ||
                        1
                      )
                    );


                  const columnSpan =
                    Math.max(
                      1,
                      Number(
                        cell.colSpan ||
                        1
                      )
                    );


                  const cellInformation = {
                    text:
                      normalizeText(
                        cell.innerText ||
                        cell.textContent
                      )
                  };


                  for (
                    let rowOffset =
                      0;
                    rowOffset <
                      rowSpan;
                    rowOffset +=
                      1
                  ) {
                    const targetRowIndex =
                      rowIndex +
                      rowOffset;


                    grid[
                      targetRowIndex
                    ] =
                      grid[
                        targetRowIndex
                      ] ||
                      [];


                    for (
                      let columnOffset =
                        0;
                      columnOffset <
                        columnSpan;
                      columnOffset +=
                        1
                    ) {
                      const targetColumnIndex =
                        columnIndex +
                        columnOffset;


                      if (
                        !grid[
                          targetRowIndex
                        ][
                          targetColumnIndex
                        ]
                      ) {
                        grid[
                          targetRowIndex
                        ][
                          targetColumnIndex
                        ] =
                          cellInformation;
                      }
                    }
                  }


                  columnIndex +=
                    columnSpan;
                }
              );
            }
          );


          let tagRowIndex =
            -1;


          let tagColumnIndex =
            -1;


          grid.forEach(
            (
              row,
              rowIndex
            ) => {
              row.forEach(
                (
                  cell,
                  columnIndex
                ) => {
                  if (
                    normalizeText(
                      cell?.text
                    ) ===
                    tagValue
                  ) {
                    tagRowIndex =
                      rowIndex;


                    tagColumnIndex =
                      columnIndex;
                  }
                }
              );
            }
          );


          if (
            tagRowIndex <
              0
          ) {
            continue;
          }


          let previousColumnIndex =
            -1;


          grid.forEach(
            row => {
              row.forEach(
                (
                  cell,
                  columnIndex
                ) => {
                  if (
                    previousColumnIndex >=
                      0
                  ) {
                    return;
                  }


                  const cellText =
                    normalizeText(
                      cell?.text
                    );


                  if (
                    cellText ===
                      "전일" ||
                    cellText ===
                      "전일값"
                  ) {
                    previousColumnIndex =
                      columnIndex;
                  }
                }
              );
            }
          );


          if (
            previousColumnIndex >=
              0
          ) {
            const previousCellText =
              normalizeText(
                grid[
                  tagRowIndex
                ]?.[
                  previousColumnIndex
                ]?.text
              );


            const previousValue =
              parseNumber(
                previousCellText
              );


            if (
              previousValue !==
                null
            ) {
              return {
                value:
                  previousValue,

                rawText:
                  previousCellText,

                method:
                  "header-column"
              };
            }
          }


          /*
            전일 헤더 탐색 실패 시
            TAG 이후의 첫 번째 순수 숫자를 사용한다.

            석회석 행은:
            TAG → TON → 0~650 → 빈 칸 → 빈 칸 → 전일값

            순서이므로 0~650은 숫자로 인식되지 않고
            전일값이 첫 번째 순수 숫자가 된다.
          */
          const targetRow =
            rows[
              tagRowIndex
            ];


          const rowCells = [
            ...targetRow.cells
          ];


          let tagCellIndex =
            rowCells.findIndex(
              cell => {
                return (
                  normalizeText(
                    cell.innerText ||
                    cell.textContent
                  ) ===
                  tagValue
                );
              }
            );


          if (
            tagCellIndex <
              0
          ) {
            tagCellIndex =
              Math.max(
                0,
                tagColumnIndex
              );
          }


          for (
            let index =
              tagCellIndex +
              1;
            index <
              rowCells.length;
            index +=
              1
          ) {
            const cellText =
              normalizeText(
                rowCells[
                  index
                ].innerText ||
                rowCells[
                  index
                ].textContent
              );


            const numericValue =
              parseNumber(
                cellText
              );


            if (
              numericValue !==
                null
            ) {
              return {
                value:
                  numericValue,

                rawText:
                  cellText,

                method:
                  "first-number-after-tag"
              };
            }
          }
        }


        return null;
      },
      targetTag
    );


  const numericValue =
    parseOisAgentNumber(
      rawResult?.value
    );


  return numericValue;
}


/* =========================================================
  TAG 값이 나타날 때까지 대기
========================================================= */

async function waitForOisPreviousStockValue(
  frame,
  targetTag
) {
  const startedAt =
    Date.now();


  while (
    Date.now() -
      startedAt <
    OIS_QUERY_TIMEOUT
  ) {
    const value =
      await readOisPreviousStockValue(
        frame,
        targetTag
      ).catch(
        () => null
      );


    if (
      value !==
        null
    ) {
      return value;
    }


    await waitOisAgent(
      400
    );
  }


  throw new Error(
    `${targetTag}의 전일 재고값을 읽지 못했습니다.`
  );
}


/* =========================================================
  호기·날짜별 석회석 전일 재고 조회
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
    부서 선택항목이 있으면 설비운영팀을 선택한다.
    이미 선택된 경우에도 동일하게 유지된다.
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


  await selectOisOptionByLabel(
    frame,
    unitDefinition
      .sheetLabel,
    true
  );


  /*
    SHEET 변경 후 화면 내부 데이터가 갱신될 시간을 준다.
  */
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


  await clickOisLogSheetSearchButton(
    frame
  );


  /*
    TossPlatform 그리드 갱신 대기
  */
  await page.waitForTimeout(
    1500
  );


  frame =
    await findOisLogSheetFrame(
      page
    ) ||
    frame;


  const stockValue =
    await waitForOisPreviousStockValue(
      frame,
      unitDefinition.tag
    );


  console.log(
    [
      `${unitDefinition.unit}호기`,
      targetDate,
      "전일 재고",
      `${stockValue} ton`
    ].join(
      " · "
    )
  );


  return stockValue;
}


/* =========================================================
  선택일·다음 날의 1·2호기 석회석 재고 수집
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


  const nextDate =
    addOisAgentDateDays(
      targetDate,
      1
    );


  const collectedResult = {
    targetDate,

    nextDate,

    unitOne: {
      tag:
        OIS_UNIT_DEFINITIONS[
          0
        ].tag,

      startStock:
        null,

      endStock:
        null
    },

    unitTwo: {
      tag:
        OIS_UNIT_DEFINITIONS[
          1
        ].tag,

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
    const startStock =
      await queryOisLimestonePreviousStock(
        page,
        unitDefinition,
        targetDate
      );


    const endStock =
      await queryOisLimestonePreviousStock(
        page,
        unitDefinition,
        nextDate
      );


    const resultKey =
      unitDefinition.unit ===
        1
          ? "unitOne"
          : "unitTwo";


    collectedResult[
      resultKey
    ].startStock =
      startStock;


    collectedResult[
      resultKey
    ].endStock =
      endStock;
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
  OIS 상시 연동 에이전트

  PowerShell을 닫기 전까지:
  - 5초마다 업무일지 요청 확인
  - 요청이 있으면 OIS 자동 조회
  - 결과를 업무일지 서버로 전송
========================================================= */

async function loginOis() {
  const config =
    getOisAgentConfig();


  console.log(
    "=========================================="
  );


  console.log(
    "GS Shift Log OIS 연동 프로그램"
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
    "석회석 요청 확인 주기:",
    `${OIS_AGENT_POLL_INTERVAL / 1000}초`
  );


  const browser =
    await chromium.launch({
      channel:
        "msedge",

      headless:
        false,

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


  const context =
    await browser.newContext(
      contextOptions
    );


  const page =
    await context.newPage();


  let isShuttingDown =
    false;


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


      await context
        .storageState({
          path:
            OIS_SESSION_FILE_PATH
        })
        .catch(
          () => null
        );


      await browser
        .close()
        .catch(
          () => null
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
    await ensureOisAgentLoggedIn(
      page,
      config
    );


    console.log(
      "업무일지의 OIS 요청을 기다립니다."
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
          error.message
        );


        await waitOisAgent(
          OIS_AGENT_ERROR_RETRY_INTERVAL
        );


        continue;
      }


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


      const targetDate =
        normalizeOisAgentText(
          requestItem.targetDate
        );


      console.log(
        ""
      );


      console.log(
        "------------------------------------------"
      );


      console.log(
        "석회석 재고 조회 요청을 받았습니다."
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
        const result =
          await collectOisLimestoneStocks(
            page,
            config,
            targetDate
          );


        await completeOisAgentRequest(
          config,
          requestId,
          result
        );


        await context.storageState({
          path:
            OIS_SESSION_FILE_PATH
        });


        console.log(
          "OIS 석회석 재고 조회가 완료되었습니다."
        );


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

      } catch (
        error
      ) {
        console.error(
          "OIS 요청 처리 실패:",
          error
        );


        const screenshotPath =
          await saveOisAgentErrorScreenshot(
            page,
            requestId
          );


        console.error(
          "오류 화면 저장:",
          screenshotPath
        );


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
      await browser.close();
    }
  }
}

/* =========================================================
  OIS 연동 프로그램 실행
========================================================= */

loginOis()
  .catch(
    error => {
      console.error(
        ""
      );


      console.error(
        "OIS 연동 프로그램 실행 실패:"
      );


      console.error(
        error
      );


      process.exitCode =
        1;
    }
  );