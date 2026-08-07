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
      const fileName =
        normalizeText(
          attachmentRow.file_name
        );


      /*
        과거 시스템의 안내용 값은
        실제 첨부파일에서 제외한다.

        제목
        유첨: 제목
        유첨 : 제목
      */
      const normalizedFileLabel =
        fileName
          .normalize("NFKC")
          .replace(
            /\s+/g,
            ""
          )
          .replace(
            /：/g,
            ":"
          )
          .toLowerCase();


      const isPlaceholderAttachment =
        [
          "제목",
          "유첨:제목"
        ].includes(
          normalizedFileLabel
        );


      if (
        isPlaceholderAttachment
      ) {
        return attachmentMap;
      }


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
  삭제한 과거 업무일지 차단 테이블 확인

  shift-logs.js에서도 동일 테이블을 사용한다.

  여기에서도 CREATE TABLE IF NOT EXISTS를 실행하는 이유:
  아직 한 번도 삭제가 발생하지 않은 서버에서도
  legacy-logs 조회가 오류 없이 동작하게 하기 위함이다.
========================================================= */

async function ensureLegacyLogSuppressionTable(
  database
) {
  if (
    !database
  ) {
    return;
  }


  await database
    .prepare(`
      CREATE TABLE IF NOT EXISTS
        legacy_log_suppressions
      (
        legacy_diary_id TEXT NOT NULL,

        work_date TEXT NOT NULL,

        shift TEXT NOT NULL,

        role TEXT NOT NULL,

        source_log_id TEXT NOT NULL DEFAULT '',

        deleted_by_id TEXT NOT NULL DEFAULT '',

        deleted_by_name TEXT NOT NULL DEFAULT '',

        deleted_at TEXT NOT NULL,

        reason TEXT NOT NULL DEFAULT 'user-delete',

        PRIMARY KEY (
          legacy_diary_id,
          work_date,
          shift,
          role
        )
      )
    `)
    .run();


  await database
    .prepare(`
      CREATE INDEX IF NOT EXISTS
        idx_legacy_log_suppressions_date

      ON legacy_log_suppressions (
        work_date,
        shift,
        role
      )
    `)
    .run();
}

/* =========================================================
  GET /api/legacy-logs

  삭제 차단 적용 최종본

  처리:
  1. 날짜/근무 기준 legacy_logs 조회
  2. legacy_log_suppressions에 등록된 자료 제외
  3. 남은 자료의 첨부파일만 조회
  4. script.js에 반환

  따라서 사용자가 삭제한 동기화 업무일지는
  원본이 legacy_logs에 남아 있어도 다시 반환되지 않는다.
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


    /* =====================================================
      삭제 차단 테이블 준비
    ====================================================== */

    await ensureLegacyLogSuppressionTable(
      context.env.DB
    );


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


    /* =====================================================
      날짜 검사
    ====================================================== */

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


    /* =====================================================
      과거 업무일지 조회

      중요:
      legacy_log_suppressions에 동일한

      legacy_diary_id
      + 날짜
      + 근무
      + 보직

      조합이 있으면 조회에서 제외한다.
    ====================================================== */

    let queryText = `
      SELECT
        legacy.id,
        legacy.legacy_diary_id,
        legacy.work_date,
        legacy.shift,
        legacy.role,
        legacy.author,
        legacy.writer_id,
        legacy.status,
        legacy.operation_status,
        legacy.entries_json,
        legacy.original_json,
        legacy.legacy_position,
        legacy.legacy_version,
        legacy.source_updated_at,
        legacy.imported_at,
        legacy.updated_at

      FROM legacy_logs AS legacy

      WHERE
        legacy.work_date = ?1

        AND NOT EXISTS (
          SELECT
            1

          FROM legacy_log_suppressions AS suppressed

          WHERE
            suppressed.legacy_diary_id =
              legacy.legacy_diary_id

            AND suppressed.work_date =
              legacy.work_date

            AND suppressed.shift =
              legacy.shift

            AND suppressed.role =
              legacy.role
        )
    `;


    const bindValues = [
      date
    ];


    /* =====================================================
      특정 근무만 조회
    ====================================================== */

    if (
      shift
    ) {
      queryText += `
        AND legacy.shift = ?2
      `;


      bindValues.push(
        shift
      );
    }


    /* =====================================================
      보직 순서
    ====================================================== */

    queryText += `
      ORDER BY
        CASE legacy.role
          WHEN '파트장' THEN 1
          WHEN 'TGO' THEN 2
          WHEN 'BCO1' THEN 3
          WHEN 'BCO2' THEN 4
          WHEN 'TO' THEN 5
          WHEN 'BO1' THEN 6
          WHEN 'BO2' THEN 7
          ELSE 99
        END,

        legacy.id ASC
    `;


    const queryResult =
      await context.env.DB
        .prepare(
          queryText
        )
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


    /* =====================================================
      조회된 업무일지 ID 목록

      suppression에서 제외된 자료는
      여기에도 들어오지 않는다.
    ====================================================== */

    const legacyDiaryIds =
      rows
        .map(
          row => {
            return normalizeText(
              row.legacy_diary_id
            );
          }
        )
        .filter(
          Boolean
        );


    /* =====================================================
      남아 있는 업무일지의 첨부파일만 조회
    ====================================================== */

    const attachmentMap =
      await loadLegacyAttachmentsByDiaryIds(
        context.env.DB,
        legacyDiaryIds
      );


    /* =====================================================
      업무일지 + 첨부파일 결합
    ====================================================== */

    const items =
      rows.map(
        row => {
          const legacyDiaryId =
            normalizeText(
              row.legacy_diary_id
            );


          return convertRowToLegacyLog(
            row,
            attachmentMap[
              legacyDiaryId
            ] ||
            []
          );
        }
      );


    const attachmentCount =
      items.reduce(
        (
          total,
          item
        ) => {
          return (
            total +
            (
              item.attachments
                ?.length ||
              0
            )
          );
        },
        0
      );


    /* =====================================================
      응답
    ====================================================== */

    return createJsonResponse({
      success:
        true,

      date,

      shift:
        shift ||
        "ALL",

      totalCount:
        items.length,

      attachmentCount,

      items
    });

  } catch (
    error
  ) {
    console.error(
      "저장된 과거 업무일지 조회 오류:",
      error
    );


    return createJsonResponse(
      {
        success:
          false,

        message:
          error instanceof
            Error
            ? error.message
            : String(
                error
              ),

        error:
          error instanceof
            Error
            ? error.message
            : String(
                error
              )
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