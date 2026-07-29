/* =========================================================
  GS Shift Log 브랜드 설정 API

  경로:
  functions/api/brand-settings.js

  API:
  GET  /api/brand-settings
  POST /api/brand-settings

  저장:
  - 텍스트 및 표시 설정: D1 DB
  - 회사 로고 및 로그인 배경: R2 ATTACHMENTS

  권한:
  - GET: 로그인 전에도 조회 가능
  - POST: 최고관리자만 가능

  R2 저장 키:
  - brand/company-logo
  - brand/login-background
========================================================= */


/* =========================================================
  기본 설정
========================================================= */

const FORCED_SUPER_ADMIN_EMPLOYEE_NO =
  "2014081";


const BRAND_LOGO_R2_KEY =
  "brand/company-logo";


const BRAND_BACKGROUND_R2_KEY =
  "brand/login-background";


const MAX_LOGO_FILE_SIZE =
  5 *
  1024 *
  1024;


const MAX_BACKGROUND_FILE_SIZE =
  15 *
  1024 *
  1024;


const DEFAULT_BRAND_SETTINGS = {
  companyName:
    "GS 포천그린에너지",

  programName:
    "GS Shift Log",

  programSubtitle:
    "교대근무 업무일지 시스템",

  logoContentType:
    "",

  logoVersion:
    "",

  backgroundContentType:
    "",

  backgroundVersion:
    "",

  backgroundPositionX:
    50,

  backgroundPositionY:
    50,

  backgroundOverlay:
    30,

  updatedAt:
    ""
};


const ALLOWED_IMAGE_TYPES =
  new Set([
    "image/png",
    "image/jpeg",
    "image/webp"
  ]);


/* =========================================================
  공통 JSON 응답
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
          "no-store",

        "X-Content-Type-Options":
          "nosniff"
      }
    }
  );
}


/* =========================================================
  기본 정리
========================================================= */

function normalizeText(
  value
) {
  return String(
    value ??
    ""
  ).trim();
}


function normalizeEmployeeNo(
  value
) {
  return normalizeText(
    value
  ).replace(
    /\s+/g,
    ""
  );
}


function normalizeRole(
  value,
  employeeNo = ""
) {
  if (
    normalizeEmployeeNo(
      employeeNo
    ) ===
      FORCED_SUPER_ADMIN_EMPLOYEE_NO
  ) {
    return "super_admin";
  }


  const normalizedRole =
    normalizeText(
      value
    )
      .toLowerCase()
      .replace(
        /-/g,
        "_"
      );


  if (
    normalizedRole ===
      "superadmin" ||
    normalizedRole ===
      "super_admin"
  ) {
    return "super_admin";
  }


  if (
    normalizedRole ===
      "admin"
  ) {
    return "admin";
  }


  return "user";
}


/* =========================================================
  문자열 길이 제한
========================================================= */

function normalizeLimitedText(
  value,
  fallback,
  maximumLength
) {
  const normalizedValue =
    normalizeText(
      value
    );


  if (
    !normalizedValue
  ) {
    return fallback;
  }


  return normalizedValue.slice(
    0,
    maximumLength
  );
}


/* =========================================================
  숫자 범위 제한
========================================================= */

function clampNumber(
  value,
  minimum,
  maximum,
  fallback
) {
  const numericValue =
    Number(
      value
    );


  if (
    !Number.isFinite(
      numericValue
    )
  ) {
    return fallback;
  }


  return Math.min(
    maximum,
    Math.max(
      minimum,
      Math.round(
        numericValue
      )
    )
  );
}


/* =========================================================
  Authorization Bearer 토큰 읽기
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


  const matched =
    authorization.match(
      /^Bearer\s+(.+)$/i
    );


  return normalizeText(
    matched?.[1]
  );
}


/* =========================================================
  바이트를 16진수 문자열로 변환
========================================================= */

function bytesToHex(
  bytes
) {
  return [
    ...bytes
  ]
    .map(
      byte =>
        byte
          .toString(
            16
          )
          .padStart(
            2,
            "0"
          )
    )
    .join(
      ""
    );
}


/* =========================================================
  로그인 세션 토큰 해시
========================================================= */

async function hashSessionToken(
  token
) {
  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder()
        .encode(
          normalizeText(
            token
          )
        )
    );


  return bytesToHex(
    new Uint8Array(
      digest
    )
  );
}


/* =========================================================
  로그인 사용자 확인

  현재 login.js의 구조와 동일하게:
  - shift_log_sessions
  - users
  를 조회한다.
========================================================= */

async function getAuthenticatedUser(
  context
) {
  if (
    !context.env.DB
  ) {
    return {
      error:
        jsonResponse(
          {
            ok: false,

            message:
              "D1 바인딩 DB가 등록되지 않았습니다."
          },
          500
        )
    };
  }


  const sessionToken =
    getBearerToken(
      context.request
    );


  if (
    !sessionToken
  ) {
    return {
      error:
        jsonResponse(
          {
            ok: false,

            message:
              "로그인이 필요합니다."
          },
          401
        )
    };
  }


  const tokenHash =
    await hashSessionToken(
      sessionToken
    );


  const session =
    await context.env.DB
      .prepare(`
        SELECT
          session.employee_no,
          session.expires_at,

          user.name,
          user.role,
          user.is_active

        FROM shift_log_sessions AS session

        INNER JOIN users AS user
          ON user.employee_no =
             session.employee_no

        WHERE session.token_hash = ?

        LIMIT 1
      `)
      .bind(
        tokenHash
      )
      .first();


  const currentTime =
    new Date();


  const expiresAt =
    new Date(
      session?.expires_at ||
      0
    );


  const isExpired =
    Number.isNaN(
      expiresAt.getTime()
    ) ||
    expiresAt <=
      currentTime;


  if (
    !session ||
    Number(
      session.is_active
    ) !==
      1 ||
    isExpired
  ) {
    await context.env.DB
      .prepare(`
        DELETE FROM shift_log_sessions
        WHERE token_hash = ?
      `)
      .bind(
        tokenHash
      )
      .run();


    return {
      error:
        jsonResponse(
          {
            ok: false,

            message:
              "로그인 세션이 만료되었습니다. 다시 로그인해 주세요."
          },
          401
        )
    };
  }


  await context.env.DB
    .prepare(`
      UPDATE shift_log_sessions
      SET last_used_at = ?
      WHERE token_hash = ?
    `)
    .bind(
      currentTime.toISOString(),
      tokenHash
    )
    .run();


  const employeeNo =
    normalizeEmployeeNo(
      session.employee_no
    );


  const role =
    normalizeRole(
      session.role,
      employeeNo
    );


  return {
    user: {
      employeeNo,

      name:
        normalizeText(
          session.name
        ),

      role,

      isSuperAdmin:
        role ===
        "super_admin"
    }
  };
}


/* =========================================================
  최고관리자 권한 확인
========================================================= */

async function requireSuperAdmin(
  context
) {
  const authentication =
    await getAuthenticatedUser(
      context
    );


  if (
    authentication.error
  ) {
    return authentication;
  }


  if (
    !authentication.user
      .isSuperAdmin
  ) {
    return {
      error:
        jsonResponse(
          {
            ok: false,

            message:
              "최고관리자만 브랜드 설정을 변경할 수 있습니다."
          },
          403
        )
    };
  }


  return authentication;
}


/* =========================================================
  브랜드 테이블 초기 행 보장
========================================================= */

async function ensureBrandSettingsRow(
  database
) {
  await database
    .prepare(`
      INSERT OR IGNORE INTO brand_settings (
        id,
        company_name,
        program_name,
        program_subtitle,
        logo_content_type,
        logo_version,
        background_content_type,
        background_version,
        background_position_x,
        background_position_y,
        background_overlay,
        updated_at
      )
      VALUES (
        1,
        ?,
        ?,
        ?,
        '',
        '',
        '',
        '',
        50,
        50,
        30,
        CURRENT_TIMESTAMP
      )
    `)
    .bind(
      DEFAULT_BRAND_SETTINGS
        .companyName,

      DEFAULT_BRAND_SETTINGS
        .programName,

      DEFAULT_BRAND_SETTINGS
        .programSubtitle
    )
    .run();
}


/* =========================================================
  브랜드 설정 조회
========================================================= */

async function readBrandSettings(
  database
) {
  await ensureBrandSettingsRow(
    database
  );


  const row =
    await database
      .prepare(`
        SELECT
          id,
          company_name,
          program_name,
          program_subtitle,
          logo_content_type,
          logo_version,
          background_content_type,
          background_version,
          background_position_x,
          background_position_y,
          background_overlay,
          updated_at

        FROM brand_settings

        WHERE id = 1

        LIMIT 1
      `)
      .first();


  if (
    !row
  ) {
    return {
      ...DEFAULT_BRAND_SETTINGS
    };
  }


  return {
    companyName:
      normalizeLimitedText(
        row.company_name,
        DEFAULT_BRAND_SETTINGS
          .companyName,
        80
      ),

    programName:
      normalizeLimitedText(
        row.program_name,
        DEFAULT_BRAND_SETTINGS
          .programName,
        80
      ),

    programSubtitle:
      normalizeLimitedText(
        row.program_subtitle,
        DEFAULT_BRAND_SETTINGS
          .programSubtitle,
        160
      ),

    logoContentType:
      normalizeText(
        row.logo_content_type
      ),

    logoVersion:
      normalizeText(
        row.logo_version
      ),

    backgroundContentType:
      normalizeText(
        row.background_content_type
      ),

    backgroundVersion:
      normalizeText(
        row.background_version
      ),

    backgroundPositionX:
      clampNumber(
        row.background_position_x,
        0,
        100,
        DEFAULT_BRAND_SETTINGS
          .backgroundPositionX
      ),

    backgroundPositionY:
      clampNumber(
        row.background_position_y,
        0,
        100,
        DEFAULT_BRAND_SETTINGS
          .backgroundPositionY
      ),

    backgroundOverlay:
      clampNumber(
        row.background_overlay,
        0,
        80,
        DEFAULT_BRAND_SETTINGS
          .backgroundOverlay
      ),

    updatedAt:
      normalizeText(
        row.updated_at
      )
  };
}


/* =========================================================
  브라우저에 전달할 브랜드 응답 생성
========================================================= */

function buildBrandResponse(
  settings
) {
  const logoVersion =
    normalizeText(
      settings.logoVersion
    );


  const backgroundVersion =
    normalizeText(
      settings.backgroundVersion
    );


  return {
    companyName:
      settings.companyName,

    programName:
      settings.programName,

    programSubtitle:
      settings.programSubtitle,

    logoUrl:
      logoVersion
        ? `/api/brand-assets?type=logo&v=${encodeURIComponent(
            logoVersion
          )}`
        : "",

    backgroundUrl:
      backgroundVersion
        ? `/api/brand-assets?type=background&v=${encodeURIComponent(
            backgroundVersion
          )}`
        : "",

    backgroundPositionX:
      settings
        .backgroundPositionX,

    backgroundPositionY:
      settings
        .backgroundPositionY,

    backgroundOverlay:
      settings
        .backgroundOverlay,

    updatedAt:
      settings.updatedAt
  };
}


/* =========================================================
  업로드 이미지 검사
========================================================= */

function validateImageFile(
  file,
  options
) {
  const {
    label,
    maximumSize
  } = options;


  if (
    !(
      file instanceof
        File
    ) ||
    file.size <=
      0
  ) {
    return {
      valid:
        false,

      message:
        `${label} 파일이 올바르지 않습니다.`
    };
  }


  const contentType =
    normalizeText(
      file.type
    )
      .toLowerCase();


  if (
    !ALLOWED_IMAGE_TYPES.has(
      contentType
    )
  ) {
    return {
      valid:
        false,

      message:
        `${label}는 PNG, JPG, WEBP 이미지만 사용할 수 있습니다.`
    };
  }


  if (
    file.size >
      maximumSize
  ) {
    return {
      valid:
        false,

      message:
        `${label} 파일 용량이 너무 큽니다.`
    };
  }


  return {
    valid:
      true,

    contentType,

    message:
      ""
  };
}


/* =========================================================
  FormData boolean 처리
========================================================= */

function parseBoolean(
  value
) {
  const normalizedValue =
    normalizeText(
      value
    ).toLowerCase();


  return (
    normalizedValue ===
      "true" ||
    normalizedValue ===
      "1" ||
    normalizedValue ===
      "yes"
  );
}


/* =========================================================
  GET /api/brand-settings

  로그인 화면에서도 필요하므로 공개 조회
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
          ok: false,

          message:
            "D1 바인딩 DB가 등록되지 않았습니다."
        },
        500
      );
    }


    const settings =
      await readBrandSettings(
        context.env.DB
      );


    return jsonResponse({
      ok: true,

      brand:
        buildBrandResponse(
          settings
        )
    });

  } catch (
    error
  ) {
    console.error(
      "브랜드 설정 조회 오류:",
      error
    );


    return jsonResponse(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "브랜드 설정을 불러오지 못했습니다."
      },
      500
    );
  }
}


/* =========================================================
  POST /api/brand-settings

  최고관리자만 저장 가능
========================================================= */

export async function onRequestPost(
  context
) {
  try {
    const authentication =
      await requireSuperAdmin(
        context
      );


    if (
      authentication.error
    ) {
      return authentication.error;
    }


    if (
      !context.env.ATTACHMENTS
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "R2 바인딩 ATTACHMENTS가 등록되지 않았습니다."
        },
        500
      );
    }


    let formData;


    try {
      formData =
        await context.request
          .formData();

    } catch {
      return jsonResponse(
        {
          ok: false,

          message:
            "브랜드 설정 요청 형식이 올바르지 않습니다."
        },
        400
      );
    }


    const previousSettings =
      await readBrandSettings(
        context.env.DB
      );


    const companyName =
      normalizeLimitedText(
        formData.get(
          "companyName"
        ),
        DEFAULT_BRAND_SETTINGS
          .companyName,
        80
      );


    const programName =
      normalizeLimitedText(
        formData.get(
          "programName"
        ),
        DEFAULT_BRAND_SETTINGS
          .programName,
        80
      );


    const programSubtitle =
      normalizeLimitedText(
        formData.get(
          "programSubtitle"
        ),
        DEFAULT_BRAND_SETTINGS
          .programSubtitle,
        160
      );


    const backgroundPositionX =
      clampNumber(
        formData.get(
          "backgroundPositionX"
        ),
        0,
        100,
        previousSettings
          .backgroundPositionX
      );


    const backgroundPositionY =
      clampNumber(
        formData.get(
          "backgroundPositionY"
        ),
        0,
        100,
        previousSettings
          .backgroundPositionY
      );


    const backgroundOverlay =
      clampNumber(
        formData.get(
          "backgroundOverlay"
        ),
        0,
        80,
        previousSettings
          .backgroundOverlay
      );


    const logoFile =
      formData.get(
        "logo"
      );


    const backgroundFile =
      formData.get(
        "background"
      );


    const removeLogo =
      parseBoolean(
        formData.get(
          "removeLogo"
        )
      );


    const removeBackground =
      parseBoolean(
        formData.get(
          "removeBackground"
        )
      );


    let logoContentType =
      previousSettings
        .logoContentType;


    let logoVersion =
      previousSettings
        .logoVersion;


    let backgroundContentType =
      previousSettings
        .backgroundContentType;


    let backgroundVersion =
      previousSettings
        .backgroundVersion;


    const currentVersion =
      `${Date.now()}-${crypto.randomUUID()}`;


    /* =====================================================
      회사 로고 처리
    ====================================================== */

    if (
      removeLogo
    ) {
      await context.env.ATTACHMENTS
        .delete(
          BRAND_LOGO_R2_KEY
        );


      logoContentType =
        "";


      logoVersion =
        "";

    } else if (
      logoFile instanceof
        File &&
      logoFile.size >
        0
    ) {
      const validation =
        validateImageFile(
          logoFile,
          {
            label:
              "회사 로고",

            maximumSize:
              MAX_LOGO_FILE_SIZE
          }
        );


      if (
        !validation.valid
      ) {
        return jsonResponse(
          {
            ok: false,

            message:
              validation.message
          },
          400
        );
      }


      await context.env.ATTACHMENTS
        .put(
          BRAND_LOGO_R2_KEY,
          logoFile.stream(),
          {
            httpMetadata: {
              contentType:
                validation
                  .contentType,

              cacheControl:
                "public, max-age=31536000, immutable"
            },

            customMetadata: {
              category:
                "brand",

              assetType:
                "company-logo",

              uploadedBy:
                authentication
                  .user
                  .employeeNo,

              originalName:
                normalizeText(
                  logoFile.name
                ),

              version:
                currentVersion
            }
          }
        );


      logoContentType =
        validation
          .contentType;


      logoVersion =
        currentVersion;
    }


    /* =====================================================
      로그인 배경 처리
    ====================================================== */

    if (
      removeBackground
    ) {
      await context.env.ATTACHMENTS
        .delete(
          BRAND_BACKGROUND_R2_KEY
        );


      backgroundContentType =
        "";


      backgroundVersion =
        "";

    } else if (
      backgroundFile instanceof
        File &&
      backgroundFile.size >
        0
    ) {
      const validation =
        validateImageFile(
          backgroundFile,
          {
            label:
              "로그인 배경",

            maximumSize:
              MAX_BACKGROUND_FILE_SIZE
          }
        );


      if (
        !validation.valid
      ) {
        return jsonResponse(
          {
            ok: false,

            message:
              validation.message
          },
          400
        );
      }


      await context.env.ATTACHMENTS
        .put(
          BRAND_BACKGROUND_R2_KEY,
          backgroundFile.stream(),
          {
            httpMetadata: {
              contentType:
                validation
                  .contentType,

              cacheControl:
                "public, max-age=31536000, immutable"
            },

            customMetadata: {
              category:
                "brand",

              assetType:
                "login-background",

              uploadedBy:
                authentication
                  .user
                  .employeeNo,

              originalName:
                normalizeText(
                  backgroundFile.name
                ),

              version:
                currentVersion
            }
          }
        );


      backgroundContentType =
        validation
          .contentType;


      backgroundVersion =
        currentVersion;
    }


    const updatedAt =
      new Date()
        .toISOString();


    await context.env.DB
      .prepare(`
        INSERT INTO brand_settings (
          id,
          company_name,
          program_name,
          program_subtitle,
          logo_content_type,
          logo_version,
          background_content_type,
          background_version,
          background_position_x,
          background_position_y,
          background_overlay,
          updated_at
        )
        VALUES (
          1,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?
        )

        ON CONFLICT(id)
        DO UPDATE SET
          company_name =
            excluded.company_name,

          program_name =
            excluded.program_name,

          program_subtitle =
            excluded.program_subtitle,

          logo_content_type =
            excluded.logo_content_type,

          logo_version =
            excluded.logo_version,

          background_content_type =
            excluded.background_content_type,

          background_version =
            excluded.background_version,

          background_position_x =
            excluded.background_position_x,

          background_position_y =
            excluded.background_position_y,

          background_overlay =
            excluded.background_overlay,

          updated_at =
            excluded.updated_at
      `)
      .bind(
        companyName,
        programName,
        programSubtitle,
        logoContentType,
        logoVersion,
        backgroundContentType,
        backgroundVersion,
        backgroundPositionX,
        backgroundPositionY,
        backgroundOverlay,
        updatedAt
      )
      .run();


    const savedSettings =
      await readBrandSettings(
        context.env.DB
      );


    return jsonResponse({
      ok: true,

      message:
        "브랜드 설정을 저장했습니다.",

      brand:
        buildBrandResponse(
          savedSettings
        )
    });

  } catch (
    error
  ) {
    console.error(
      "브랜드 설정 저장 오류:",
      error
    );


    return jsonResponse(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "브랜드 설정 저장 중 오류가 발생했습니다."
      },
      500
    );
  }
}


/* =========================================================
  그 외 메서드 차단
========================================================= */

export async function onRequest(
  context
) {
  if (
    context.request.method ===
      "GET"
  ) {
    return onRequestGet(
      context
    );
  }


  if (
    context.request.method ===
      "POST"
  ) {
    return onRequestPost(
      context
    );
  }


  return jsonResponse(
    {
      ok: false,

      message:
        "허용되지 않은 요청 방식입니다."
    },
    405
  );
}