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
  OIS 에이전트 로컬 환경변수 자동 로딩

  파일:
  local-tools/ois-agent/.env

  특징:
  - PowerShell에서 환경변수를 매번 입력하지 않아도 됨
  - 이미 Windows 환경변수가 있으면 그 값을 우선 사용
  - 아이디·비밀번호·에이전트 키를 JS에 직접 적지 않음
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
    console.warn(
      `.env 파일을 찾지 못했습니다: ${environmentFilePath}`
    );

    return;
  }


  const environmentText =
    fs.readFileSync(
      environmentFilePath,
      "utf8"
    );


  environmentText
    .split(
      /\r?\n/
    )
    .forEach(
      rawLine => {
        const line =
          String(
            rawLine ||
            ""
          ).trim();


        if (
          !line ||
          line.startsWith(
            "#"
          )
        ) {
          return;
        }


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
              equalIndex + 1
            )
            .trim();


        /*
          양쪽 따옴표 제거
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


        /*
          Windows에 이미 설정된 값이 있으면
          그 값을 우선 사용한다.
        */
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


  console.log(
    "OIS 에이전트 로컬 설정을 불러왔습니다."
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
        true

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