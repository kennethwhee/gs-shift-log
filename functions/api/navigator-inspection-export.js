"use strict";


/* =========================================================
  Facility Navigator 수동 최신화용 업무일지 내보내기 API

  주소:
  GET /api/navigator-inspection-export

  인증:
  Authorization: Bearer FACILITY_NAVIGATOR_SYNC_SECRET

  반환:
  - 현재 D1에 존재하는 모든 업무일지
  - 결재완료 + TAG가 있는 TM/BM/CM 항목은 publish
  - 나머지는 purge
  - 한 번에 최대 200건
  - cursor 방식 페이지 이동

  중요:
  Navigator는 전체 페이지를 모두 받은 뒤
  이번 최신화에서 넘어오지 않은 기존 연동 항목을 정리한다.
========================================================= */

const VALID_MEMBER_ROLES =
  new Set([
    "TGO",
    "BCO1",
    "BCO2",
    "TO",
    "BO1",
    "BO2"
  ]);


const VALID_LOG_ROLES =
  new Set([
    "파트장",
    ...VALID_MEMBER_ROLES
  ]);


const INSPECTION_CATEGORIES =
  new Set([
    "TM 발행",
    "TM 작업",
    "BM 발행",
    "BM 작업",
    "CM 발행",
    "CM 작업"
  ]);


const DEFAULT_PAGE_LIMIT =
  100;


const MAXIMUM_PAGE_LIMIT =
  200;


/* =========================================================
  JSON 응답
========================================================= */

function jsonResponse(
  data,
  status = 200
) {
  return Response.json(
    data,
    {
      status,

      headers: {
        "Cache-Control":
          "no-store, no-cache, must-revalidate"
      }
    }
  );
}


/* =========================================================
  문자열 정리
========================================================= */

function normalizeText(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


/* =========================================================
  보직 정리
========================================================= */

function normalizeLogRole(
  value
) {
  const role =
    normalizeText(
      value
    )
      .replace(
        /\s+/g,
        ""
      )
      .toUpperCase();


  const roleMap = {
    파트장:
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
      role
    ] ||
    ""
  );
}


/* =========================================================
  근무 정리
========================================================= */

function normalizeShift(
  value
) {
  const shift =
    normalizeText(
      value
    )
      .toUpperCase()
      .replace(
        /[^A-Z]/g,
        ""
      );


  if (
    [
      "DS",
      "D"
    ].includes(
      shift
    )
  ) {
    return "DS";
  }


  if (
    [
      "NS",
      "N"
    ].includes(
      shift
    )
  ) {
    return "NS";
  }


  return "";
}


/* =========================================================
  상태 정리
========================================================= */

function normalizeStatus(
  value
) {
  const status =
    normalizeText(
      value
    );


  const statusMap = {
    작성중:
      "임시저장",

    임시저장:
      "임시저장",

    작성완료:
      "결재요청",

    결재요청:
      "결재요청",

    결재완료:
      "결재완료",

    저장완료:
      "저장완료"
  };


  return (
    statusMap[
      status
    ] ||
    ""
  );
}


/* =========================================================
  JSON 객체 읽기
========================================================= */

function parseJsonObject(
  value
) {
  try {
    const parsedValue =
      JSON.parse(
        normalizeText(
          value
        ) ||
        "{}"
      );


    return (
      parsedValue &&
      typeof parsedValue ===
        "object" &&
      !Array.isArray(
        parsedValue
      )
    )
      ? parsedValue
      : {};

  } catch {
    return {};
  }
}


/* =========================================================
  D1 행 → 업무일지
========================================================= */

function convertRowToLog(
  row
) {
  const storedLog =
    parseJsonObject(
      row?.log_json
    );


  return {
    ...storedLog,

    id:
      normalizeText(
        row?.id
      ),

    date:
      normalizeText(
        row?.work_date
      ),

    shift:
      normalizeShift(
        row?.shift
      ),

    role:
      normalizeLogRole(
        row?.role
      ),

    team:
      normalizeText(
        row?.team
      ),

    author:
      normalizeText(
        row?.author
      ),

    authorId:
      normalizeText(
        row?.author_id
      ),

    status:
      normalizeStatus(
        row?.status
      ),

    serverRevision:
      Number(
        row?.revision
      ) ||
      1,

    createdAt:
      normalizeText(
        row?.created_at
      ),

    updatedAt:
      normalizeText(
        row?.updated_at
      )
  };
}


/* =========================================================
  Bearer 비밀키
========================================================= */

function getBearerToken(
  request
) {
  const authorization =
    normalizeText(
      request.headers.get(
        "Authorization"
      )
    );


  const matchedToken =
    authorization.match(
      /^Bearer\s+(.+)$/i
    );


  return normalizeText(
    matchedToken?.[1]
  );
}


/* =========================================================
  일정 시간 비교

  일반 문자열 비교보다
  비밀키 비교 시간 차이를 줄인다.
========================================================= */

function constantTimeEquals(
  firstValue,
  secondValue
) {
  const encoder =
    new TextEncoder();


  const firstBytes =
    encoder.encode(
      String(
        firstValue ||
        ""
      )
    );


  const secondBytes =
    encoder.encode(
      String(
        secondValue ||
        ""
      )
    );


  const maximumLength =
    Math.max(
      firstBytes.length,
      secondBytes.length
    );


  let difference =
    firstBytes.length ^
    secondBytes.length;


  for (
    let index = 0;
    index <
      maximumLength;
    index +=
      1
  ) {
    difference |=
      (
        firstBytes[
          index
        ] ||
        0
      ) ^
      (
        secondBytes[
          index
        ] ||
        0
      );
  }


  return (
    difference ===
    0
  );
}


/* =========================================================
  요청 인증
========================================================= */

function authenticateNavigatorRequest(
  context
) {
  const configuredSecret =
    normalizeText(
      context?.env
        ?.FACILITY_NAVIGATOR_SYNC_SECRET
    );


  if (
    !configuredSecret
  ) {
    return {
      ok:
        false,

      response:
        jsonResponse(
          {
            ok:
              false,

            message:
              "FACILITY_NAVIGATOR_SYNC_SECRET 환경변수가 등록되지 않았습니다."
          },
          500
        )
    };
  }


  if (
    configuredSecret.length <
      32
  ) {
    return {
      ok:
        false,

      response:
        jsonResponse(
          {
            ok:
              false,

            message:
              "Facility Navigator 연동 비밀키는 32자 이상이어야 합니다."
          },
          500
        )
    };
  }


  const receivedSecret =
    getBearerToken(
      context.request
    );


  if (
    !receivedSecret ||
    !constantTimeEquals(
      receivedSecret,
      configuredSecret
    )
  ) {
    return {
      ok:
        false,

      response:
        jsonResponse(
          {
            ok:
              false,

            message:
              "Facility Navigator 연동 인증에 실패했습니다."
          },
          401
        )
    };
  }


  return {
    ok:
      true
  };
}


/* =========================================================
  점검 구분 정리
========================================================= */

function normalizeInspectionCategory(
  value
) {
  const compactCategory =
    normalizeText(
      value
    )
      .toUpperCase()
      .replace(
        /\s+/g,
        ""
      );


  const categoryMap = [
    [
      "TM발행",
      "TM 발행"
    ],

    [
      "TM작업",
      "TM 작업"
    ],

    [
      "BM발행",
      "BM 발행"
    ],

    [
      "BM작업",
      "BM 작업"
    ],

    [
      "CM발행",
      "CM 발행"
    ],

    [
      "CM작업",
      "CM 작업"
    ]
  ];


  const matchedCategory =
    categoryMap.find(
      (
        [
          prefix
        ]
      ) => {
        return compactCategory.startsWith(
          prefix
        );
      }
    );


  return (
    matchedCategory?.[1] ||
    ""
  );
}


/* =========================================================
  항목 번호 정리
========================================================= */

function normalizeEntryIndex(
  value
) {
  if (
    value === "" ||
    value === null ||
    value === undefined
  ) {
    return null;
  }


  const numericValue =
    Number(
      value
    );


  return (
    Number.isInteger(
      numericValue
    ) &&
    numericValue >=
      0
  )
    ? numericValue
    : null;
}


/* =========================================================
  항목 고정 ID
========================================================= */

function createSourceEntryId(
  log,
  entry,
  entryIndex
) {
  const existingId =
    normalizeText(
      entry?.id
    );


  if (
    existingId
  ) {
    return existingId;
  }


  const sourceLogId =
    normalizeText(
      entry?.importedFromLogId ||
      log?.id
    );


  const sourceEntryIndex =
    normalizeEntryIndex(
      entry?.importedFromEntryIndex
    ) ??
    normalizeEntryIndex(
      entryIndex
    );


  if (
    !sourceLogId ||
    sourceEntryIndex ===
      null
  ) {
    return "";
  }


  return [
    "entry-legacy",
    sourceLogId,
    sourceEntryIndex
  ].join(
    "-"
  );
}


/* =========================================================
  저장 구조별 업무 항목 수집
========================================================= */

function collectSourceEntries(
  log
) {
  const sourceEntries = [];


  const appendEntries = (
    entries,
    collection,
    fallbackCategory = ""
  ) => {
    if (
      !Array.isArray(
        entries
      )
    ) {
      return;
    }


    entries.forEach(
      (
        entry,
        entryIndex
      ) => {
        if (
          !entry ||
          typeof entry !==
            "object" ||
          Array.isArray(
            entry
          )
        ) {
          return;
        }


        sourceEntries.push({
          entry,
          entryIndex,
          collection,
          fallbackCategory
        });
      }
    );
  };


  appendEntries(
    log?.entries,
    "entries"
  );


  appendEntries(
    log?.tmEntries,
    "tmEntries",
    "TM 발행"
  );


  appendEntries(
    log?.handoverEntries,
    "handoverEntries"
  );


  appendEntries(
    log?.remarkEntries,
    "remarkEntries",
    "비고"
  );


  return sourceEntries;
}


/* =========================================================
  점검이력 공개 가능 상태

  파트장·일반 보직 모두
  결재완료 상태에서만 공개한다.
========================================================= */

function isPublishableLog(
  log
) {
  const role =
    normalizeLogRole(
      log?.role
    );


  const status =
    normalizeStatus(
      log?.status
    );


  return (
    VALID_LOG_ROLES.has(
      role
    ) &&
    status ===
      "결재완료"
  );
}


/* =========================================================
  점검이력 항목 생성
========================================================= */

function createInspectionItems(
  log
) {
  const containerLogId =
    normalizeText(
      log?.id
    );


  const containerRole =
    normalizeLogRole(
      log?.role
    );


  const uniqueItems =
    new Map();


  const storedEntryIds =
    new Set();


  collectSourceEntries(
    log
  ).forEach(
    source => {
      const {
        entry,
        entryIndex,
        fallbackCategory
      } = source;


      const category =
        normalizeInspectionCategory(
          entry?.category ||
          fallbackCategory
        );


      const tagNo =
        normalizeText(
          entry?.tag
        )
          .toUpperCase();


      const content =
        normalizeText(
          entry?.content
        );


      if (
        !INSPECTION_CATEGORIES.has(
          category
        ) ||
        !tagNo ||
        !content
      ) {
        return;
      }


      const sourceLogId =
        normalizeText(
          entry?.importedFromLogId ||
          containerLogId
        );


      const sourceEntryId =
        createSourceEntryId(
          log,
          entry,
          entryIndex
        );


      if (
        !sourceLogId ||
        !sourceEntryId
      ) {
        return;
      }


      const storedEntryId =
        normalizeText(
          entry?.id
        );


      if (
        storedEntryId &&
        storedEntryIds.has(
          storedEntryId
        )
      ) {
        return;
      }


      const sourceKey = [
        sourceLogId,
        sourceEntryId
      ].join(
        "||"
      );


      if (
        uniqueItems.has(
          sourceKey
        )
      ) {
        return;
      }


      uniqueItems.set(
        sourceKey,
        {
          sourceKey,

          sourceLogId,

          sourceEntryId,

          sourceEntryIndex:
            normalizeEntryIndex(
              entry?.importedFromEntryIndex
            ) ??
            normalizeEntryIndex(
              entryIndex
            ),

          sourceRole:
            normalizeLogRole(
              entry?.importedFromRole
            ) ||
            containerRole,

          sourceAuthor:
            normalizeText(
              entry?.importedFromAuthor ||
              log?.author
            ),

          tagNo,

          inspectionDate:
            normalizeText(
              log?.date
            ),

          shift:
            normalizeShift(
              log?.shift
            ),

          category,

          time:
            normalizeText(
              entry?.time
            ),

          content,

          attachmentName:
            normalizeText(
              entry?.attachmentName
            )
        }
      );


      if (
        storedEntryId
      ) {
        storedEntryIds.add(
          storedEntryId
        );
      }
    }
  );


  return [
    ...uniqueItems.values()
  ];
}


/* =========================================================
  업무일지 컨테이너 스냅샷
========================================================= */

function createContainerSnapshot(
  log
) {
  const publishable =
    isPublishableLog(
      log
    );


  const items =
    publishable
      ? createInspectionItems(
          log
        )
      : [];


  const disposition =
    publishable &&
    items.length >
      0
      ? "publish"
      : "purge";


  return {
    schemaVersion:
      1,

    eventType:
      "inspection-history.container-snapshot",

    sourceSystem:
      "gs-shift-log",

    operation:
      "replace-container-snapshot",

    disposition,

    container: {
      logId:
        normalizeText(
          log?.id
        ),

      revision:
        Number(
          log?.serverRevision
        ) ||
        1,

      role:
        normalizeLogRole(
          log?.role
        ),

      status:
        normalizeStatus(
          log?.status
        ),

      deleted:
        false,

      updatedAt:
        normalizeText(
          log?.updatedAt ||
          log?.createdAt
        )
    },

    items:
      disposition ===
        "publish"
        ? items
        : []
  };
}


/* =========================================================
  페이지 크기
========================================================= */

function normalizePageLimit(
  value
) {
  const numericValue =
    Number(
      value
    );


  if (
    !Number.isInteger(
      numericValue
    )
  ) {
    return DEFAULT_PAGE_LIMIT;
  }


  return Math.min(
    MAXIMUM_PAGE_LIMIT,

    Math.max(
      1,
      numericValue
    )
  );
}


/* =========================================================
  Base64 URL 변환
========================================================= */

function encodeBase64Url(
  value
) {
  return btoa(
    unescape(
      encodeURIComponent(
        String(
          value ||
          ""
        )
      )
    )
  )
    .replaceAll(
      "+",
      "-"
    )
    .replaceAll(
      "/",
      "_"
    )
    .replace(
      /=+$/g,
      ""
    );
}


function decodeBase64Url(
  value
) {
  const normalizedValue =
    String(
      value ||
      ""
    )
      .replaceAll(
        "-",
        "+"
      )
      .replaceAll(
        "_",
        "/"
      );


  const paddedValue =
    normalizedValue.padEnd(
      Math.ceil(
        normalizedValue.length /
        4
      ) *
      4,
      "="
    );


  return decodeURIComponent(
    escape(
      atob(
        paddedValue
      )
    )
  );
}


/* =========================================================
  cursor 생성
========================================================= */

function createCursor(
  updatedAt,
  id
) {
  const cursorData = {
    updatedAt:
      normalizeText(
        updatedAt
      ),

    id:
      normalizeText(
        id
      )
  };


  return encodeBase64Url(
    JSON.stringify(
      cursorData
    )
  );
}


/* =========================================================
  cursor 분석
========================================================= */

function parseCursor(
  cursorValue
) {
  if (
    !cursorValue
  ) {
    return {
      updatedAt:
        "",

      id:
        ""
    };
  }


  try {
    const parsedCursor =
      JSON.parse(
        decodeBase64Url(
          cursorValue
        )
      );


    return {
      updatedAt:
        normalizeText(
          parsedCursor?.updatedAt
        ),

      id:
        normalizeText(
          parsedCursor?.id
        )
    };

  } catch {
    return null;
  }
}


/* =========================================================
  GET /api/navigator-inspection-export
========================================================= */

export async function onRequestGet(
  context
) {
  try {
    if (
      !context.env.DB
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "D1 바인딩 DB가 등록되지 않았습니다."
        },
        500
      );
    }


    const authentication =
      authenticateNavigatorRequest(
        context
      );


    if (
      !authentication.ok
    ) {
      return authentication.response;
    }


    const requestUrl =
      new URL(
        context.request.url
      );


    const limit =
      normalizePageLimit(
        requestUrl.searchParams.get(
          "limit"
        )
      );


    const cursor =
      parseCursor(
        requestUrl.searchParams.get(
          "cursor"
        )
      );


    if (
      !cursor
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "cursor 값이 올바르지 않습니다."
        },
        400
      );
    }


    /*
      cursor 이후의 업무일지를
      수정시간과 ID 기준으로 안정적으로 조회한다.
    */
    const queryResult =
      await context.env.DB
        .prepare(`
          SELECT
            *

          FROM shift_logs

          WHERE
            (
              COALESCE(
                updated_at,
                ''
              ) > ?1

              OR
              (
                COALESCE(
                  updated_at,
                  ''
                ) = ?1

                AND id > ?2
              )
            )

          ORDER BY
            COALESCE(
              updated_at,
              ''
            ) ASC,

            id ASC

          LIMIT ?3
        `)
        .bind(
          cursor.updatedAt,
          cursor.id,
          limit
        )
        .all();


    const rows =
      Array.isArray(
        queryResult.results
      )
        ? queryResult.results
        : [];


    const logs =
      rows.map(
        convertRowToLog
      );


    const containers =
      logs.map(
        createContainerSnapshot
      );


    const lastRow =
      rows[
        rows.length -
        1
      ] ||
      null;


    /*
      조회 건수가 limit와 같으면
      다음 페이지가 있을 가능성이 있다.

      마지막 페이지 다음 요청에서 0건이 반환되는 것도
      정상 종료로 처리할 수 있다.
    */
    const nextCursor =
      rows.length ===
        limit &&
      lastRow
        ? createCursor(
            lastRow.updated_at,
            lastRow.id
          )
        : "";


    const publishCount =
      containers.filter(
        container => {
          return (
            container.disposition ===
            "publish"
          );
        }
      ).length;


    const purgeCount =
      containers.length -
      publishCount;


    const itemCount =
      containers.reduce(
        (
          total,
          container
        ) => {
          return (
            total +
            (
              Array.isArray(
                container.items
              )
                ? container.items.length
                : 0
            )
          );
        },
        0
      );


    return jsonResponse({
      ok:
        true,

      sourceSystem:
        "gs-shift-log",

      exportType:
        "complete-current-snapshot",

      generatedAt:
        new Date()
          .toISOString(),

      page: {
        limit,

        count:
          containers.length,

        hasMore:
          Boolean(
            nextCursor
          ),

        nextCursor
      },

      summary: {
        containerCount:
          containers.length,

        publishCount,

        purgeCount,

        itemCount
      },

      containers
    });

  } catch (
    error
  ) {
    console.error(
      "Navigator 업무일지 내보내기 오류:",
      error
    );


    return jsonResponse(
      {
        ok:
          false,

        message:
          error instanceof
            Error
            ? error.message
            : "업무일지 점검이력 자료를 내보내지 못했습니다."
      },
      500
    );
  }
}