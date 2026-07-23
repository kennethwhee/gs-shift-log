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
  과거 업무일지 첨부파일 S3 기본 주소
========================================================= */

const LEGACY_ATTACHMENT_BASE_URL =
  "https://in-and-out-storage-enr-prod-pocheon.s3.ap-northeast-2.amazonaws.com";


/* =========================================================
  첨부파일명 정리

  경로 조작이나 잘못된 파일명을 방지한다.
========================================================= */

function sanitizeLegacyAttachmentFileName(
  fileName
) {
  const normalizedFileName =
    normalizeText(
      fileName
    )
      .replace(
        /\\/g,
        "/"
      )
      .split("/")
      .pop()
      .replace(
        /[\u0000-\u001F\u007F]/g,
        ""
      );

  if (
    !normalizedFileName ||
    normalizedFileName === "." ||
    normalizedFileName === ".."
  ) {
    return "";
  }

  return normalizedFileName;
}


/* =========================================================
  첨부파일 목록 가져오기
========================================================= */

function getLegacyAttachmentFileNames(
  legacyItem
) {
  const fileUris =
    Array.isArray(
      legacyItem?.file_uris
    )
      ? legacyItem.file_uris
      : Array.isArray(
          legacyItem?.fileUris
        )
        ? legacyItem.fileUris
        : [];

  return [
    ...new Set(
      fileUris
        .map(
          fileName =>
            sanitizeLegacyAttachmentFileName(
              fileName
            )
        )
        .filter(Boolean)
    )
  ];
}


/* =========================================================
  과거 S3 첨부파일 URL 생성
========================================================= */

function createLegacyAttachmentSourceUrl(
  legacyDiaryId,
  fileName
) {
  const encodedDiaryId =
    encodeURIComponent(
      legacyDiaryId
    );

  const encodedFileName =
    encodeURIComponent(
      fileName
    );

  return [
    LEGACY_ATTACHMENT_BASE_URL,
    "diaries",
    encodedDiaryId,
    "attachments",
    encodedFileName
  ].join("/");
}


/* =========================================================
  R2 저장 키 생성

  예:
  legacy/2026/07/21/POCHEON%2320260721%23DAY%23TO/
  scaled_IMG_8704.jpeg
========================================================= */

function createLegacyAttachmentR2Key(
  date,
  legacyDiaryId,
  fileName
) {
  const year =
    date.slice(
      0,
      4
    );

  const month =
    date.slice(
      4,
      6
    );

  const day =
    date.slice(
      6,
      8
    );

  return [
    "legacy",
    year,
    month,
    day,
    encodeURIComponent(
      legacyDiaryId
    ),
    encodeURIComponent(
      fileName
    )
  ].join("/");
}


/* =========================================================
  Content-Type 결정

  S3 응답에 Content-Type이 없을 때 사용한다.
========================================================= */

function detectAttachmentContentType(
  fileName
) {
  const extension =
    normalizeText(
      fileName
    )
      .toLowerCase()
      .split(".")
      .pop();

  const contentTypeMap = {
    jpg:
      "image/jpeg",

    jpeg:
      "image/jpeg",

    png:
      "image/png",

    gif:
      "image/gif",

    webp:
      "image/webp",

    bmp:
      "image/bmp",

    heic:
      "image/heic",

    heif:
      "image/heif",

    pdf:
      "application/pdf"
  };

  return (
    contentTypeMap[
      extension
    ] ||
    "application/octet-stream"
  );
}


/* =========================================================
  기존 첨부정보 조회
========================================================= */

async function findExistingLegacyAttachment(
  database,
  legacyDiaryId,
  fileName
) {
  return database
    .prepare(
      `
        SELECT
          id,
          r2_key,
          file_size,
          mime_type
        FROM legacy_attachments
        WHERE legacy_diary_id = ?1
          AND file_name = ?2
        LIMIT 1
      `
    )
    .bind(
      legacyDiaryId,
      fileName
    )
    .first();
}


/* =========================================================
  첨부정보 DB 저장 또는 갱신
========================================================= */

async function saveLegacyAttachmentRecord(
  database,
  attachment
) {
  await database
    .prepare(
      `
        INSERT INTO legacy_attachments (
          legacy_diary_id,
          file_name,
          original_url,
          r2_key,
          mime_type,
          file_size,
          uploaded_at
        )
        VALUES (
          ?1,
          ?2,
          ?3,
          ?4,
          ?5,
          ?6,
          CURRENT_TIMESTAMP
        )

        ON CONFLICT (
          legacy_diary_id,
          file_name
        )
        DO UPDATE SET
          original_url =
            excluded.original_url,

          r2_key =
            excluded.r2_key,

          mime_type =
            excluded.mime_type,

          file_size =
            excluded.file_size,

          uploaded_at =
            CURRENT_TIMESTAMP
      `
    )
    .bind(
      attachment.legacyDiaryId,
      attachment.fileName,
      attachment.originalUrl,
      attachment.r2Key,
      attachment.mimeType,
      attachment.fileSize
    )
    .run();
}


/* =========================================================
  첨부파일 1개 다운로드 및 R2 저장
========================================================= */

async function importLegacyAttachment(
  context,
  {
    legacyDiaryId,
    date,
    fileName
  }
) {
  const safeFileName =
    sanitizeLegacyAttachmentFileName(
      fileName
    );

  if (!safeFileName) {
    return {
      success:
        false,

      skipped:
        true,

      fileName:
        normalizeText(
          fileName
        ),

      message:
        "첨부파일명이 올바르지 않습니다."
    };
  }


  const existingAttachment =
    await findExistingLegacyAttachment(
      context.env.DB,
      legacyDiaryId,
      safeFileName
    );


  /*
    DB와 R2에 이미 모두 존재하면
    다시 다운로드하지 않는다.
  */
  if (
    existingAttachment?.r2_key
  ) {
    const existingR2Object =
      await context.env.ATTACHMENTS.head(
        existingAttachment.r2_key
      );

    if (existingR2Object) {
      return {
        success:
          true,

        skipped:
          true,

        action:
          "existing",

        fileName:
          safeFileName,

        r2Key:
          existingAttachment.r2_key,

        fileSize:
          Number(
            existingAttachment.file_size ||
            existingR2Object.size ||
            0
          ),

        mimeType:
          normalizeText(
            existingAttachment.mime_type
          )
      };
    }
  }


  const originalUrl =
    createLegacyAttachmentSourceUrl(
      legacyDiaryId,
      safeFileName
    );


  const r2Key =
    createLegacyAttachmentR2Key(
      date,
      legacyDiaryId,
      safeFileName
    );


  const response =
    await fetch(
      originalUrl,
      {
        method:
          "GET",

        headers: {
          Accept:
            "image/*,application/pdf,*/*"
        },

        cache:
          "no-store"
      }
    );


  if (!response.ok) {
    throw new Error(
      [
        "첨부파일 다운로드 실패",
        safeFileName,
        `HTTP ${response.status}`
      ].join(" / ")
    );
  }


  const contentType =
    normalizeText(
      response.headers.get(
        "content-type"
      )
    ) ||
    detectAttachmentContentType(
      safeFileName
    );


  const fileData =
    await response.arrayBuffer();


  const fileSize =
    fileData.byteLength;


  if (
    fileSize <= 0
  ) {
    throw new Error(
      `${safeFileName} 첨부파일의 크기가 0입니다.`
    );
  }


  await context.env.ATTACHMENTS.put(
    r2Key,
    fileData,
    {
      httpMetadata: {
        contentType,

        contentDisposition:
          `inline; filename="${safeFileName.replace(
            /"/g,
            ""
          )}"`
      },

      customMetadata: {
        legacyDiaryId,

        originalFileName:
          safeFileName,

        originalUrl,

        importedFrom:
          "GS ENR legacy diary"
      }
    }
  );


  await saveLegacyAttachmentRecord(
    context.env.DB,
    {
      legacyDiaryId,

      fileName:
        safeFileName,

      originalUrl,

      r2Key,

      mimeType:
        contentType,

      fileSize
    }
  );


  return {
    success:
      true,

    skipped:
      false,

    action:
      existingAttachment
        ? "updated"
        : "created",

    fileName:
      safeFileName,

    originalUrl,

    r2Key,

    mimeType:
      contentType,

    fileSize
  };
}


/* =========================================================
  업무일지 1건의 첨부파일 전체 동기화

  사진 한 장이 실패해도
  나머지 파일은 계속 처리한다.
========================================================= */

async function importLegacyAttachments(
  context,
  legacyItem,
  date,
  legacyDiaryId
) {
  const fileNames =
    getLegacyAttachmentFileNames(
      legacyItem
    );


  const results = [];

  let attachmentFetchedCount =
    fileNames.length;

  let attachmentCreatedCount =
    0;

  let attachmentUpdatedCount =
    0;

  let attachmentSkippedCount =
    0;

  let attachmentFailedCount =
    0;


  for (
    const fileName of
    fileNames
  ) {
    try {
      const result =
        await importLegacyAttachment(
          context,
          {
            legacyDiaryId,

            date,

            fileName
          }
        );


      results.push(
        result
      );


      if (
        result.skipped
      ) {
        attachmentSkippedCount +=
          1;

      } else if (
        result.action ===
        "created"
      ) {
        attachmentCreatedCount +=
          1;

      } else if (
        result.action ===
        "updated"
      ) {
        attachmentUpdatedCount +=
          1;
      }

    } catch (error) {
      attachmentFailedCount +=
        1;


      console.error(
        `${legacyDiaryId} 첨부파일 동기화 실패:`,
        fileName,
        error
      );


      results.push({
        success:
          false,

        skipped:
          false,

        fileName,

        message:
          error instanceof Error
            ? error.message
            : String(error)
      });
    }
  }


  return {
    attachmentFetchedCount,

    attachmentCreatedCount,

    attachmentUpdatedCount,

    attachmentSkippedCount,

    attachmentFailedCount,

    results
  };
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
  context,
  legacyItem,
  date,
  legacyShift,
  itemIndex
) {
  const database =
    context.env.DB;


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


  /* =====================================================
    기존 업무일지 존재 여부 확인
  ===================================================== */

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


  /* =====================================================
    과거 업무일지 D1 저장 또는 갱신
  ===================================================== */

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


  /* =====================================================
    첨부파일 동기화 기본 결과

    첨부파일이 없거나 R2 바인딩이 없어도
    업무일지 본문 저장은 정상 완료한다.
  ===================================================== */

  let attachmentResult = {
    attachmentFetchedCount:
      0,

    attachmentCreatedCount:
      0,

    attachmentUpdatedCount:
      0,

    attachmentSkippedCount:
      0,

    attachmentFailedCount:
      0,

    results:
      []
  };


  /* =====================================================
    첨부파일 다운로드 및 R2 저장

    사진 동기화에 실패하더라도
    업무일지 본문 동기화는 실패시키지 않는다.
  ===================================================== */

  if (
    context.env.ATTACHMENTS
  ) {
    try {
      attachmentResult =
        await importLegacyAttachments(
          context,
          legacyItem,
          date,
          legacyDiaryId
        );

    } catch (error) {
      console.error(
        `${legacyDiaryId} 첨부파일 전체 동기화 실패:`,
        error
      );


      attachmentResult = {
        attachmentFetchedCount:
          getLegacyAttachmentFileNames(
            legacyItem
          ).length,

        attachmentCreatedCount:
          0,

        attachmentUpdatedCount:
          0,

        attachmentSkippedCount:
          0,

        attachmentFailedCount:
          getLegacyAttachmentFileNames(
            legacyItem
          ).length,

        results: [
          {
            success:
              false,

            message:
              error instanceof Error
                ? error.message
                : String(error)
          }
        ]
      };
    }

  } else {
    const attachmentFileNames =
      getLegacyAttachmentFileNames(
        legacyItem
      );


    /*
      첨부파일이 존재하지만 R2 바인딩이 없다면
      결과에 원인을 남긴다.
    */
    if (
      attachmentFileNames.length >
      0
    ) {
      attachmentResult = {
        attachmentFetchedCount:
          attachmentFileNames.length,

        attachmentCreatedCount:
          0,

        attachmentUpdatedCount:
          0,

        attachmentSkippedCount:
          0,

        attachmentFailedCount:
          attachmentFileNames.length,

        results: [
          {
            success:
              false,

            message:
              "R2 바인딩 ATTACHMENTS가 등록되지 않아 첨부파일을 저장하지 못했습니다."
          }
        ]
      };
    }
  }


  /* =====================================================
    업무일지 및 첨부파일 처리 결과 반환
  ===================================================== */

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

    author,

    attachments:
      attachmentResult
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

  let attachmentFetchedCount = 0;
  let attachmentCreatedCount = 0;
  let attachmentUpdatedCount = 0;
  let attachmentSkippedCount = 0;
  let attachmentFailedCount = 0;

  const savedLogs = [];

  for (
    let itemIndex = 0;
    itemIndex < legacyItems.length;
    itemIndex += 1
  ) {

    const saveResult =
      await saveLegacyLog(
        context,
        legacyItems[itemIndex],
        date,
        legacyShift,
        itemIndex
      );

    if (
      saveResult.action === "created"
    ) {
      createdCount++;
    } else {
      updatedCount++;
    }

    if (saveResult.attachments) {

      attachmentFetchedCount +=
        saveResult.attachments.attachmentFetchedCount || 0;

      attachmentCreatedCount +=
        saveResult.attachments.attachmentCreatedCount || 0;

      attachmentUpdatedCount +=
        saveResult.attachments.attachmentUpdatedCount || 0;

      attachmentSkippedCount +=
        saveResult.attachments.attachmentSkippedCount || 0;

      attachmentFailedCount +=
        saveResult.attachments.attachmentFailedCount || 0;
    }

    savedLogs.push(saveResult);
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

    attachmentFetchedCount,

    attachmentCreatedCount,

    attachmentUpdatedCount,

    attachmentSkippedCount,

    attachmentFailedCount,

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
      Cloudflare 실행시간과
      과도한 요청 방지
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


    const dateResults =
      [];


    /* =====================================================
      업무일지 전체 합계
    ===================================================== */

    let totalFetchedCount =
      0;


    let totalCreatedCount =
      0;


    let totalUpdatedCount =
      0;


    /* =====================================================
      첨부파일 전체 합계
    ===================================================== */

    let totalAttachmentFetchedCount =
      0;


    let totalAttachmentCreatedCount =
      0;


    let totalAttachmentUpdatedCount =
      0;


    let totalAttachmentSkippedCount =
      0;


    let totalAttachmentFailedCount =
      0;


    let failedDateCount =
      0;


    /* =====================================================
      날짜별 순차 동기화

      특정 날짜 또는 근무가 실패해도
      다음 작업은 계속 진행한다.
    ====================================================== */

    for (
      const importDate of
      importDates
    ) {
      const shiftResults =
        [];


      /* ===================================================
        해당 날짜 업무일지 합계
      =================================================== */

      let dateFetchedCount =
        0;


      let dateCreatedCount =
        0;


      let dateUpdatedCount =
        0;


      /* ===================================================
        해당 날짜 첨부파일 합계
      =================================================== */

      let dateAttachmentFetchedCount =
        0;


      let dateAttachmentCreatedCount =
        0;


      let dateAttachmentUpdatedCount =
        0;


      let dateAttachmentSkippedCount =
        0;


      let dateAttachmentFailedCount =
        0;


      const errors =
        [];


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


          /* ===============================================
            업무일지 합계
          =============================================== */

          dateFetchedCount +=
            Number(
              shiftResult
                .fetchedCount ||
              0
            );


          dateCreatedCount +=
            Number(
              shiftResult
                .createdCount ||
              0
            );


          dateUpdatedCount +=
            Number(
              shiftResult
                .updatedCount ||
              0
            );


          /* ===============================================
            첨부파일 합계
          =============================================== */

          dateAttachmentFetchedCount +=
            Number(
              shiftResult
                .attachmentFetchedCount ||
              0
            );


          dateAttachmentCreatedCount +=
            Number(
              shiftResult
                .attachmentCreatedCount ||
              0
            );


          dateAttachmentUpdatedCount +=
            Number(
              shiftResult
                .attachmentUpdatedCount ||
              0
            );


          dateAttachmentSkippedCount +=
            Number(
              shiftResult
                .attachmentSkippedCount ||
              0
            );


          dateAttachmentFailedCount +=
            Number(
              shiftResult
                .attachmentFailedCount ||
              0
            );

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


      /* ===================================================
        전체 업무일지 합산
      =================================================== */

      totalFetchedCount +=
        dateFetchedCount;


      totalCreatedCount +=
        dateCreatedCount;


      totalUpdatedCount +=
        dateUpdatedCount;


      /* ===================================================
        전체 첨부파일 합산
      =================================================== */

      totalAttachmentFetchedCount +=
        dateAttachmentFetchedCount;


      totalAttachmentCreatedCount +=
        dateAttachmentCreatedCount;


      totalAttachmentUpdatedCount +=
        dateAttachmentUpdatedCount;


      totalAttachmentSkippedCount +=
        dateAttachmentSkippedCount;


      totalAttachmentFailedCount +=
        dateAttachmentFailedCount;


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

        attachmentFetchedCount:
          dateAttachmentFetchedCount,

        attachmentCreatedCount:
          dateAttachmentCreatedCount,

        attachmentUpdatedCount:
          dateAttachmentUpdatedCount,

        attachmentSkippedCount:
          dateAttachmentSkippedCount,

        attachmentFailedCount:
          dateAttachmentFailedCount,

        success:
          errors.length ===
          0,

        errors,

        shiftResults
      });
    }


    /* =====================================================
      최종 응답
    ====================================================== */

    return createJsonResponse({
      success:
        true,

      message:
        [
          `과거 업무일지 ${importDates.length}일 동기화 완료`,

          `업무일지 조회 ${totalFetchedCount}건`,

          `업무일지 신규 ${totalCreatedCount}건`,

          `업무일지 갱신 ${totalUpdatedCount}건`,

          `첨부파일 조회 ${totalAttachmentFetchedCount}개`,

          `첨부파일 신규 ${totalAttachmentCreatedCount}개`,

          `첨부파일 갱신 ${totalAttachmentUpdatedCount}개`,

          `첨부파일 기존 ${totalAttachmentSkippedCount}개`,

          `첨부파일 실패 ${totalAttachmentFailedCount}개`,

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

      attachmentFetchedCount:
        totalAttachmentFetchedCount,

      attachmentCreatedCount:
        totalAttachmentCreatedCount,

      attachmentUpdatedCount:
        totalAttachmentUpdatedCount,

      attachmentSkippedCount:
        totalAttachmentSkippedCount,

      attachmentFailedCount:
        totalAttachmentFailedCount,

      failedDateCount,

      r2BindingAvailable:
        Boolean(
          context.env
            .ATTACHMENTS
        ),

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