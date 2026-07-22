"use strict";

/* =========================================================
  GS Shift Log 과거 업무일지 D1 가져오기 API

  POST /api/legacy-import

  요청 예시:

  하루 주간:
  {
    "date": "20260721",
    "shift": "DAY"
  }

  하루 야간:
  {
    "date": "20260721",
    "shift": "NIGHT"
  }

  하루 주간·야간 모두:
  {
    "date": "20260721",
    "shift": "ALL"
  }

  처리:
  1. 기존 /api/legacy-diaries 호출
  2. 과거 업무일지 원본 수신
  3. legacy_logs 테이블에 저장
  4. 같은 legacy_diary_id는 업데이트
========================================================= */


/* =========================================================
  JSON 응답
========================================================= */

function createJsonResponse(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=UTF-8",

        "Cache-Control":
          "no-store"
      }
    }
  );
}


/* =========================================================
  문자열 정리
========================================================= */

function normalizeText(value) {
  return String(
    value ?? ""
  ).trim();
}


/* =========================================================
  날짜 확인

  허용:
  20260721
========================================================= */

function isValidLegacyDate(value) {
  if (
    !/^\d{8}$/.test(
      value
    )
  ) {
    return false;
  }

  const year =
    Number(
      value.slice(
        0,
        4
      )
    );

  const month =
    Number(
      value.slice(
        4,
        6
      )
    );

  const day =
    Number(
      value.slice(
        6,
        8
      )
    );

  const date =
    new Date(
      year,
      month - 1,
      day
    );

  return (
    date.getFullYear() ===
      year &&
    date.getMonth() ===
      month - 1 &&
    date.getDate() ===
      day
  );
}


/* =========================================================
  YYYYMMDD → YYYY-MM-DD
========================================================= */

function convertLegacyDateToIso(
  legacyDate
) {
  return [
    legacyDate.slice(
      0,
      4
    ),

    legacyDate.slice(
      4,
      6
    ),

    legacyDate.slice(
      6,
      8
    )
  ].join("-");
}


/* =========================================================
  기존 근무 → 현재 근무
========================================================= */

function convertLegacyShift(
  shift
) {
  return (
    String(
      shift || ""
    )
      .trim()
      .toUpperCase() ===
      "DAY"
      ? "DS"
      : "NS"
  );
}


/* =========================================================
  기존 보직 → 현재 보직
========================================================= */

function convertLegacyPositionToRole(
  position
) {
  const normalizedPosition =
    normalizeText(
      position
    )
      .toUpperCase()
      .replace(
        /\s+/g,
        "_"
      );

  const roleMap = {
    GROUP_LEADER:
      "파트장",

    LEADER:
      "파트장",

    TGO:
      "TGO",

    BCO1:
      "BCO1",

    BCO2:
      "BCO2",

    TO:
      "TO",

    BO1:
      "BO1",

    BO2:
      "BO2"
  };

  return (
    roleMap[
      normalizedPosition
    ] ||
    normalizedPosition ||
    "미지정"
  );
}


/* =========================================================
  기존 결재상태 → 현재 상태
========================================================= */

function convertLegacyStatus(
  status
) {
  const normalizedStatus =
    normalizeText(
      status
    ).toUpperCase();

  const statusMap = {
    APPROVED:
      "결재완료",

    SUBMITTED:
      "작성완료",

    REQUESTED:
      "작성완료",

    DRAFT:
      "작성중",

    WRITING:
      "작성중",

    REJECTED:
      "작성중"
  };

  return (
    statusMap[
      normalizedStatus
    ] ||
    "작성중"
  );
}


/* =========================================================
  body 배열에서 특정 index 내용 가져오기

  index 0:
  운전현황
========================================================= */

function getLegacyBodyContent(
  body,
  targetIndex
) {
  const bodyItems =
    Array.isArray(
      body
    )
      ? body
      : [];

  const matchedItem =
    bodyItems.find(
      (
        item,
        itemIndex
      ) => {
        const currentIndex =
          Number(
            item?.index ??
            itemIndex
          );

        return (
          currentIndex ===
          Number(
            targetIndex
          )
        );
      }
    );

  return normalizeText(
    matchedItem?.content
  );
}


/* =========================================================
  저장용 작업내역 생성

  body index 0은 운전현황이므로 제외한다.

  기존 원본 형태를 최대한 유지하기 위해
  body의 나머지 내용을 배열로 저장한다.
========================================================= */

function createStoredEntries(
  legacyItem
) {
  const bodyItems =
    Array.isArray(
      legacyItem?.body
    )
      ? legacyItem.body
      : [];

  return bodyItems
    .map(
      (
        bodyItem,
        bodyIndex
      ) => {
        const index =
          Number(
            bodyItem?.index ??
            bodyIndex
          );

        return {
          index,

          content:
            normalizeText(
              bodyItem?.content
            )
        };
      }
    )
    .filter(
      entry => {
        return (
          entry.index !== 0 &&
          entry.content
        );
      }
    );
}


/* =========================================================
  과거 일지 ID 생성

  과거 서버 diary_id가 있으면 그대로 사용한다.

  diary_id가 없을 경우:
  날짜 + 근무 + 보직 + 작성자 + 배열번호로 생성한다.
========================================================= */

function createLegacyDiaryId(
  legacyItem,
  date,
  shift,
  itemIndex
) {
  const originalId =
    normalizeText(
      legacyItem?.diary_id ??
      legacyItem?.diaryId ??
      legacyItem?.id
    );

  if (originalId) {
    return originalId;
  }

  const position =
    normalizeText(
      legacyItem?.position
    ) ||
    "UNKNOWN";

  const writerId =
    normalizeText(
      legacyItem?.writer_id ??
      legacyItem?.writerId
    ) ||
    "UNKNOWN";

  return [
    "fallback",
    date,
    shift,
    position,
    writerId,
    itemIndex
  ].join("-");
}


/* =========================================================
  현재 사이트의 기존 업무일지 API 호출

  GET /api/legacy-diaries
========================================================= */

async function fetchLegacyDiaries(
  request,
  date,
  shift
) {
  const currentUrl =
    new URL(
      request.url
    );

  const requestUrl =
    new URL(
      "/api/legacy-diaries",
      currentUrl.origin
    );

  requestUrl.searchParams.set(
    "date",
    date
  );

  requestUrl.searchParams.set(
    "shift",
    shift
  );

  const response =
    await fetch(
      requestUrl.toString(),
      {
        method:
          "GET",

        headers: {
          Accept:
            "application/json"
        },

        cache:
          "no-store"
      }
    );

  const responseText =
    await response.text();

  let result = {};

  try {
    result =
      responseText
        ? JSON.parse(
            responseText
          )
        : {};

  } catch {
    throw new Error(
      `${shift} 기존 업무일지 서버 응답이 JSON 형식이 아닙니다.`
    );
  }

  if (
    !response.ok ||
    !result.success
  ) {
    throw new Error(
      result.message ||
      result.error ||
      `${shift} 기존 업무일지를 불러오지 못했습니다.`
    );
  }

  return Array.isArray(
    result.items
  )
    ? result.items
    : [];
}


/* =========================================================
  과거 업무일지 1건 저장 또는 갱신
========================================================= */

async function saveLegacyLog(
  database,
  legacyItem,
  date,
  legacyShift,
  itemIndex
) {
  const legacyDiaryId =
    createLegacyDiaryId(
      legacyItem,
      date,
      legacyShift,
      itemIndex
    );

  const workDate =
    convertLegacyDateToIso(
      date
    );

  const currentShift =
    convertLegacyShift(
      legacyShift
    );

  const role =
    convertLegacyPositionToRole(
      legacyItem?.position
    );

  const author =
    normalizeText(
      legacyItem?.writer_name ??
      legacyItem?.writerName ??
      legacyItem?.writer_id ??
      legacyItem?.writerId
    );

  const writerId =
    normalizeText(
      legacyItem?.writer_id ??
      legacyItem?.writerId
    );

  const status =
    convertLegacyStatus(
      legacyItem?.diary_status ??
      legacyItem?.diaryStatus
    );

  const operationStatus =
    getLegacyBodyContent(
      legacyItem?.body,
      0
    );

  const entries =
    createStoredEntries(
      legacyItem
    );

  const legacyPosition =
    normalizeText(
      legacyItem?.position
    );

  const legacyVersion =
    Number(
      legacyItem?.version ??
      0
    ) || 0;

  const sourceUpdatedAt =
    normalizeText(
      legacyItem?.updated_at ??
      legacyItem?.updatedAt ??
      legacyItem?.created_at ??
      legacyItem?.createdAt
    );

  const originalJson =
    JSON.stringify(
      legacyItem
    );

  const entriesJson =
    JSON.stringify(
      entries
    );

  const existingLog =
    await database
      .prepare(
        `
          SELECT
            id
          FROM legacy_logs
          WHERE legacy_diary_id = ?1
          LIMIT 1
        `
      )
      .bind(
        legacyDiaryId
      )
      .first();

  await database
    .prepare(
      `
        INSERT INTO legacy_logs (
          legacy_diary_id,
          work_date,
          shift,
          role,
          author,
          writer_id,
          status,
          operation_status,
          entries_json,
          original_json,
          legacy_position,
          legacy_version,
          source_updated_at,
          imported_at,
          updated_at
        )
        VALUES (
          ?1,
          ?2,
          ?3,
          ?4,
          ?5,
          ?6,
          ?7,
          ?8,
          ?9,
          ?10,
          ?11,
          ?12,
          ?13,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )

        ON CONFLICT (
          legacy_diary_id
        )
        DO UPDATE SET
          work_date =
            excluded.work_date,

          shift =
            excluded.shift,

          role =
            excluded.role,

          author =
            excluded.author,

          writer_id =
            excluded.writer_id,

          status =
            excluded.status,

          operation_status =
            excluded.operation_status,

          entries_json =
            excluded.entries_json,

          original_json =
            excluded.original_json,

          legacy_position =
            excluded.legacy_position,

          legacy_version =
            excluded.legacy_version,

          source_updated_at =
            excluded.source_updated_at,

          updated_at =
            CURRENT_TIMESTAMP
      `
    )
    .bind(
      legacyDiaryId,
      workDate,
      currentShift,
      role,
      author,
      writerId,
      status,
      operationStatus,
      entriesJson,
      originalJson,
      legacyPosition,
      legacyVersion,
      sourceUpdatedAt
    )
    .run();

  return {
    action:
      existingLog
        ? "updated"
        : "created",

    legacyDiaryId,

    workDate,

    shift:
      currentShift,

    role,

    author
  };
}


/* =========================================================
  특정 근무의 과거 업무일지 전체 저장
========================================================= */

async function importLegacyShift(
  context,
  date,
  legacyShift
) {
  const legacyItems =
    await fetchLegacyDiaries(
      context.request,
      date,
      legacyShift
    );

  let createdCount = 0;
  let updatedCount = 0;

  const savedLogs = [];

  for (
    let itemIndex = 0;
    itemIndex <
      legacyItems.length;
    itemIndex += 1
  ) {
    const saveResult =
      await saveLegacyLog(
        context.env.DB,
        legacyItems[
          itemIndex
        ],
        date,
        legacyShift,
        itemIndex
      );

    if (
      saveResult.action ===
      "created"
    ) {
      createdCount += 1;
    } else {
      updatedCount += 1;
    }

    savedLogs.push(
      saveResult
    );
  }

  return {
    legacyShift,

    currentShift:
      convertLegacyShift(
        legacyShift
      ),

    fetchedCount:
      legacyItems.length,

    createdCount,

    updatedCount,

    savedLogs
  };
}


/* =========================================================
  POST /api/legacy-import
========================================================= */

export async function onRequestPost(
  context
) {
  try {
    if (
      !context.env.DB
    ) {
      throw new Error(
        "D1 바인딩 DB가 등록되지 않았습니다."
      );
    }


    let body = {};


    try {
      body =
        await context.request.json();

    } catch {
      return createJsonResponse(
        {
          success:
            false,

          message:
            "요청 데이터 형식이 올바르지 않습니다."
        },
        400
      );
    }


    const singleDate =
      normalizeText(
        body.date
      );


    const startDate =
      normalizeText(
        body.startDate
      );


    const endDate =
      normalizeText(
        body.endDate
      );


    const requestedShift =
      normalizeText(
        body.shift ||
        "ALL"
      ).toUpperCase();


    if (
      ![
        "DAY",
        "NIGHT",
        "ALL"
      ].includes(
        requestedShift
      )
    ) {
      return createJsonResponse(
        {
          success:
            false,

          message:
            "shift는 DAY, NIGHT 또는 ALL만 사용할 수 있습니다."
        },
        400
      );
    }


    /* =====================================================
      날짜 목록 생성

      단일:
      {
        date: "20260721"
      }

      기간:
      {
        startDate: "20260701",
        endDate: "20260721"
      }
    ====================================================== */

    let importDates = [];


    if (
      singleDate
    ) {
      if (
        !isValidLegacyDate(
          singleDate
        )
      ) {
        return createJsonResponse(
          {
            success:
              false,

            message:
              "date는 YYYYMMDD 형식의 실제 날짜여야 합니다."
          },
          400
        );
      }


      importDates = [
        singleDate
      ];

    } else {
      if (
        !isValidLegacyDate(
          startDate
        ) ||
        !isValidLegacyDate(
          endDate
        )
      ) {
        return createJsonResponse(
          {
            success:
              false,

            message:
              "startDate와 endDate는 YYYYMMDD 형식의 실제 날짜여야 합니다."
          },
          400
        );
      }


      const start =
        new Date(
          Number(
            startDate.slice(
              0,
              4
            )
          ),
          Number(
            startDate.slice(
              4,
              6
            )
          ) - 1,
          Number(
            startDate.slice(
              6,
              8
            )
          )
        );


      const end =
        new Date(
          Number(
            endDate.slice(
              0,
              4
            )
          ),
          Number(
            endDate.slice(
              4,
              6
            )
          ) - 1,
          Number(
            endDate.slice(
              6,
              8
            )
          )
        );


      if (
        start >
        end
      ) {
        return createJsonResponse(
          {
            success:
              false,

            message:
              "시작일은 종료일보다 늦을 수 없습니다."
          },
          400
        );
      }


      const currentDate =
        new Date(
          start
        );


      while (
        currentDate <=
        end
      ) {
        importDates.push(
          [
            currentDate
              .getFullYear(),

            String(
              currentDate
                .getMonth() +
              1
            ).padStart(
              2,
              "0"
            ),

            String(
              currentDate
                .getDate()
            ).padStart(
              2,
              "0"
            )
          ].join("")
        );


        currentDate.setDate(
          currentDate.getDate() +
          1
        );
      }
    }


    /*
      Cloudflare 실행시간과 과도한 요청 방지
    */
    if (
      importDates.length >
      31
    ) {
      return createJsonResponse(
        {
          success:
            false,

          message:
            "한 번에 최대 31일까지 동기화할 수 있습니다.",

          requestedDateCount:
            importDates.length
        },
        400
      );
    }


    const importShifts =
      requestedShift ===
      "ALL"
        ? [
            "DAY",
            "NIGHT"
          ]
        : [
            requestedShift
          ];


    const dateResults = [];


    let totalFetchedCount =
      0;


    let totalCreatedCount =
      0;


    let totalUpdatedCount =
      0;


    let failedDateCount =
      0;


    /* =====================================================
      날짜별 순차 동기화

      특정 날짜가 실패해도
      다음 날짜는 계속 진행한다.
    ====================================================== */

    for (
      const importDate of
      importDates
    ) {
      const shiftResults = [];


      let dateFetchedCount =
        0;


      let dateCreatedCount =
        0;


      let dateUpdatedCount =
        0;


      const errors = [];


      for (
        const legacyShift of
        importShifts
      ) {
        try {
          const shiftResult =
            await importLegacyShift(
              context,
              importDate,
              legacyShift
            );


          shiftResults.push(
            shiftResult
          );


          dateFetchedCount +=
            shiftResult
              .fetchedCount;


          dateCreatedCount +=
            shiftResult
              .createdCount;


          dateUpdatedCount +=
            shiftResult
              .updatedCount;

        } catch (error) {
          console.error(
            `${importDate} ${legacyShift} 동기화 실패:`,
            error
          );


          errors.push({
            shift:
              legacyShift,

            message:
              error instanceof Error
                ? error.message
                : String(error)
          });
        }
      }


      if (
        errors.length >
        0
      ) {
        failedDateCount +=
          1;
      }


      totalFetchedCount +=
        dateFetchedCount;


      totalCreatedCount +=
        dateCreatedCount;


      totalUpdatedCount +=
        dateUpdatedCount;


      dateResults.push({
        date:
          importDate,

        workDate:
          convertLegacyDateToIso(
            importDate
          ),

        fetchedCount:
          dateFetchedCount,

        createdCount:
          dateCreatedCount,

        updatedCount:
          dateUpdatedCount,

        success:
          errors.length ===
          0,

        errors,

        shiftResults
      });
    }


    return createJsonResponse({
      success:
        true,

      message:
        [
          `과거 업무일지 ${importDates.length}일 동기화 완료`,

          `조회 ${totalFetchedCount}건`,

          `신규 ${totalCreatedCount}건`,

          `갱신 ${totalUpdatedCount}건`,

          `실패 날짜 ${failedDateCount}일`
        ].join(" / "),

      startDate:
        importDates[0],

      endDate:
        importDates[
          importDates.length -
          1
        ],

      requestedShift,

      requestedDateCount:
        importDates.length,

      fetchedCount:
        totalFetchedCount,

      createdCount:
        totalCreatedCount,

      updatedCount:
        totalUpdatedCount,

      failedDateCount,

      dateResults
    });

  } catch (error) {
    console.error(
      "과거 업무일지 기간 동기화 오류:",
      error
    );


    return createJsonResponse(
      {
        success:
          false,

        message:
          error instanceof Error
            ? error.message
            : String(error),

        error:
          error instanceof Error
            ? error.message
            : String(error)
      },
      500
    );
  }
}


/* =========================================================
  GET 요청 안내
========================================================= */

export function onRequestGet() {
  return createJsonResponse(
    {
      success:
        false,

      message:
        "과거 업무일지 가져오기는 POST 요청으로 실행해야 합니다.",

      example: {
        date:
          "20260721",

        shift:
          "ALL"
      }
    },
    405
  );
}