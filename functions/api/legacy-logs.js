"use strict";

/* =========================================================
  GS Shift Log 저장된 과거 업무일지 조회 API

  GET /api/legacy-logs

  사용 예시:

  /api/legacy-logs?date=2026-07-21&shift=DS

  /api/legacy-logs?date=2026-07-21&shift=NS

  /api/legacy-logs?date=2026-07-21

  응답:
  - D1 legacy_logs 테이블에서 조회
  - 기존 script.js가 사용하기 쉬운 형태로 반환
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
  2026-07-21
========================================================= */

function isValidIsoDate(value) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      value
    )
  ) {
    return false;
  }

  const [
    yearText,
    monthText,
    dayText
  ] =
    value.split("-");

  const year =
    Number(
      yearText
    );

  const month =
    Number(
      monthText
    );

  const day =
    Number(
      dayText
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
  근무값 정리

  허용:
  DS
  NS
  빈 값
========================================================= */

function normalizeShift(value) {
  const shift =
    normalizeText(
      value
    )
      .toUpperCase()
      .replace(
        /\//g,
        ""
      );

  if (
    shift === "DS"
  ) {
    return "DS";
  }

  if (
    shift === "NS"
  ) {
    return "NS";
  }

  return "";
}


/* =========================================================
  JSON 문자열 안전하게 분석
========================================================= */

function parseJsonValue(
  value,
  fallback
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return fallback;
  }

  try {
    return JSON.parse(
      String(
        value
      )
    );

  } catch {
    return fallback;
  }
}


/* =========================================================
  DB 행 → API 응답 객체
========================================================= */

function convertRowToLegacyLog(
  row,
  attachments = []
) {
  const entries =
    parseJsonValue(
      row.entries_json,
      []
    );

  const original =
    parseJsonValue(
      row.original_json,
      {}
    );

  const safeAttachments =
    Array.isArray(
      attachments
    )
      ? attachments
      : [];

  return {
    id:
      Number(
        row.id
      ),

    legacyDiaryId:
      String(
        row.legacy_diary_id ||
        ""
      ),

    date:
      String(
        row.work_date ||
        ""
      ),

    shift:
      String(
        row.shift ||
        ""
      ),

    role:
      String(
        row.role ||
        ""
      ),

    author:
      String(
        row.author ||
        ""
      ),

    writerId:
      String(
        row.writer_id ||
        ""
      ),

    status:
      String(
        row.status ||
        "작성중"
      ),

    operationStatus:
      String(
        row.operation_status ||
        ""
      ),

    entries:
      Array.isArray(
        entries
      )
        ? entries
        : [],

    original:
      original &&
      typeof original ===
        "object"
        ? original
        : {},

    legacyPosition:
      String(
        row.legacy_position ||
        ""
      ),

    legacyVersion:
      Number(
        row.legacy_version ||
        0
      ),

    sourceUpdatedAt:
      String(
        row.source_updated_at ||
        ""
      ),

    importedAt:
      String(
        row.imported_at ||
        ""
      ),

    updatedAt:
      String(
        row.updated_at ||
        ""
      ),

    attachments:
      safeAttachments.map(
        attachment => {
          const attachmentId =
            Number(
              attachment.id ||
              0
            );

          return {
            id:
              attachmentId,

            name:
              String(
                attachment.file_name ||
                ""
              ),

            fileName:
              String(
                attachment.file_name ||
                ""
              ),

            mimeType:
              String(
                attachment.mime_type ||
                ""
              ),

            fileSize:
              Number(
                attachment.file_size ||
                0
              ),

            r2Key:
              String(
                attachment.r2_key ||
                ""
              ),

            originalUrl:
              String(
                attachment.original_url ||
                ""
              ),

            uploadedAt:
              String(
                attachment.uploaded_at ||
                ""
              ),

            url:
              attachmentId
                ? `/api/legacy-attachment?id=${encodeURIComponent(
                    attachmentId
                  )}`
                : ""
          };
        }
      ),

    source:
      "legacy-d1"
  };
}

/* =========================================================
  업무일지별 첨부파일 조회

  반환 형태:

  {
    "POCHEON#20260721#DAY#TO": [
      {
        id,
        file_name,
        r2_key,
        mime_type,
        file_size
      }
    ]
  }
========================================================= */

async function loadLegacyAttachmentsByDiaryIds(
  database,
  legacyDiaryIds
) {
  const normalizedDiaryIds = [
    ...new Set(
      (
        Array.isArray(
          legacyDiaryIds
        )
          ? legacyDiaryIds
          : []
      )
        .map(
          legacyDiaryId =>
            normalizeText(
              legacyDiaryId
            )
        )
        .filter(Boolean)
    )
  ];


  if (
    normalizedDiaryIds.length ===
    0
  ) {
    return {};
  }


  /*
    D1 바인딩 자리표시자 생성

    예:
    ?1, ?2, ?3
  */
  const placeholders =
    normalizedDiaryIds
      .map(
        (
          _legacyDiaryId,
          index
        ) => {
          return `?${index + 1}`;
        }
      )
      .join(", ");


  const queryResult =
    await database
      .prepare(
        `
          SELECT
            id,
            legacy_diary_id,
            file_name,
            original_url,
            r2_key,
            mime_type,
            file_size,
            uploaded_at
          FROM legacy_attachments
          WHERE legacy_diary_id IN (
            ${placeholders}
          )
          ORDER BY
            legacy_diary_id ASC,
            id ASC
        `
      )
      .bind(
        ...normalizedDiaryIds
      )
      .all();


  const attachmentRows =
    Array.isArray(
      queryResult.results
    )
      ? queryResult.results
      : [];


  return attachmentRows.reduce(
    (
      attachmentMap,
      attachmentRow
    ) => {
      const legacyDiaryId =
        normalizeText(
          attachmentRow
            .legacy_diary_id
        );


      if (!legacyDiaryId) {
        return attachmentMap;
      }


      if (
        !Array.isArray(
          attachmentMap[
            legacyDiaryId
          ]
        )
      ) {
        attachmentMap[
          legacyDiaryId
        ] = [];
      }


      attachmentMap[
        legacyDiaryId
      ].push(
        attachmentRow
      );


      return attachmentMap;
    },
    {}
  );
}

/* =========================================================
  GET /api/legacy-logs
========================================================= */

export async function onRequestGet(
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


    const requestUrl =
      new URL(
        context.request.url
      );


    const date =
      normalizeText(
        requestUrl.searchParams.get(
          "date"
        )
      );


    const shift =
      normalizeShift(
        requestUrl.searchParams.get(
          "shift"
        )
      );


    if (
      !date
    ) {
      return createJsonResponse(
        {
          success:
            false,

          message:
            "date 값을 입력해야 합니다.",

          example:
            "/api/legacy-logs?date=2026-07-21&shift=DS"
        },
        400
      );
    }


    if (
      !isValidIsoDate(
        date
      )
    ) {
      return createJsonResponse(
        {
          success:
            false,

          message:
            "date는 YYYY-MM-DD 형식의 실제 날짜여야 합니다."
        },
        400
      );
    }


    let queryText = `
      SELECT
        id,
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
      FROM legacy_logs
      WHERE work_date = ?1
    `;


    const bindValues = [
      date
    ];


    if (
      shift
    ) {
      queryText += `
        AND shift = ?2
      `;

      bindValues.push(
        shift
      );
    }


    queryText += `
      ORDER BY
        CASE role
          WHEN '파트장' THEN 1
          WHEN 'TGO' THEN 2
          WHEN 'BCO1' THEN 3
          WHEN 'BCO2' THEN 4
          WHEN 'TO' THEN 5
          WHEN 'BO1' THEN 6
          WHEN 'BO2' THEN 7
          ELSE 99
        END,
        id ASC
    `;


    const statement =
      context.env.DB
        .prepare(
          queryText
        );


    const queryResult =
      await statement
        .bind(
          ...bindValues
        )
        .all();


    const rows =
      Array.isArray(
        queryResult.results
      )
        ? queryResult.results
        : [];


    const items =
      rows.map(
        convertRowToLegacyLog
      );


    return createJsonResponse({
      success:
        true,

      date,

      shift:
        shift || "ALL",

      totalCount:
        items.length,

      items
    });

  } catch (error) {
    console.error(
      "저장된 과거 업무일지 조회 오류:",
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
  지원하지 않는 요청
========================================================= */

export function onRequestPost() {
  return createJsonResponse(
    {
      success:
        false,

      message:
        "이 주소는 GET 요청만 지원합니다."
    },
    405
  );
}