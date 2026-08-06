"use strict";

const {
  chromium
} = require(
  "playwright"
);

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

async function loginOis() {
  const userId =
    String(
      process.env.OIS_ID ||
      ""
    ).trim();


  const password =
    String(
      process.env.OIS_PASSWORD ||
      ""
    );


  if (
    !userId ||
    !password
  ) {
    throw new Error(
      "OIS_ID와 OIS_PASSWORD가 설정되지 않았습니다."
    );
  }


  const browser =
    await chromium.launch({
      channel:
        "msedge",

      headless:
        false,

      slowMo:
        80
    });


  const context =
    await browser.newContext();


  const page =
    await context.newPage();


  try {
    console.log(
      "OIS 로그인 페이지에 접속합니다."
    );


    await page.goto(
      "http://ois.gspoge.com/jsp/login/index",
      {
        waitUntil:
          "domcontentloaded",

        timeout:
          30000
      }
    );


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
        15000
    });


    await userIdInput.fill(
      userId
    );


    await passwordInput.fill(
      password
    );


    await passwordInput.press(
      "Enter"
    );


    await page.waitForURL(
      /\/jsp\/login\/main/,
      {
        timeout:
          30000
      }
    );


    console.log(
      "OIS 로그인이 완료되었습니다."
    );


    /* ===================================================
      환경 화면 열기 및 수처리 값 수집
    ==================================================== */

    const waterValues =
      await extractOisWaterTreatmentValues(
        page
      );


    const outputPath =
      saveOisWaterTreatmentValues(
        waterValues
      );


    console.log(
      "수처리 자료를 읽었습니다."
    );


    console.table({
      "기준일":
        waterValues.sourceDate,

      "원수 입고량":
        waterValues.rawWaterInflow,

      "순수 생산량":
        waterValues.demiProduction,

      "순수 사용량":
        waterValues.pureWaterUsage,

      "원수 TANK 저장량":
        waterValues.rawWaterTankAmount,

      "원수 TANK 저장율":
        waterValues.rawWaterTankRate,

      "여과수 TANK 저장량":
        waterValues.filteredWaterTankAmount,

      "여과수 TANK 저장율":
        waterValues.filteredWaterTankRate,

      "순수 TANK 저장량":
        waterValues.demiWaterTankAmount,

      "순수 TANK 저장율":
        waterValues.demiWaterTankRate
    });


    console.log(
      "저장 위치:",
      outputPath
    );


    await context.storageState({
      path:
        "ois-session.json"
    });


    /*
      결과를 눈으로 확인할 수 있도록
      3초 후 브라우저를 닫는다.
    */
    await page.waitForTimeout(
      3000
    );

  } catch (
    error
  ) {
    console.error(
      "OIS 수처리 자료 수집 오류:",
      error
    );


    await page.screenshot({
      path:
        "ois-water-error.png",

      fullPage:
        true
    });


    throw error;

  } finally {
    await browser.close();
  }
}

loginOis()
  .catch(
    error => {
      console.error(
        error.message
      );


      process.exitCode =
        1;
    }
  );