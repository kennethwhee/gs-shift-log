/* ==================================================
   GS Shift Log 사용자 생성 API

   POST /api/create-user

   기능
   - 사번과 이름으로 사용자 생성
   - 초기 비밀번호는 사번과 동일
   - PBKDF2 비밀번호 암호화
   - 일반 / 최고관리자 권한 지원
   - 중복 사번 차단
   - 관리자 생성 비밀키 확인

   요청 헤더:
   X-Setup-Key: Cloudflare에 등록한 비밀키

   요청 예시:
   {
     "employeeNo": "123456",
     "name": "이휘근",
     "role": "super_admin"
   }
================================================== */


/* ==================================================
   공통 설정
================================================== */

const PBKDF2_ITERATIONS =
  210000;

const PBKDF2_HASH_LENGTH =
  32;

const SALT_LENGTH =
  16;

const VALID_ROLES = [
  "user",
  "super_admin"
];


/* ==================================================
   JSON 응답
================================================== */

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
          "no-store"
      }
    }
  );
}


/* ==================================================
   사번 정리
================================================== */

function normalizeEmployeeNo(
  value
) {
  return String(
    value || ""
  )
    .trim()
    .replace(
      /\s+/g,
      ""
    );
}


/* ==================================================
   이름 정리
================================================== */

function normalizeName(
  value
) {
  return String(
    value || ""
  )
    .trim()
    .replace(
      /\s+/g,
      " "
    );
}


/* ==================================================
   권한 정리

   허용:
   - user
   - super_admin
================================================== */

function normalizeRole(
  value
) {
  const role =
    String(
      value || "user"
    )
      .trim()
      .toLowerCase();


  if (
    VALID_ROLES.includes(
      role
    )
  ) {
    return role;
  }


  return "";
}


/* ==================================================
   Uint8Array → Base64
================================================== */

function bytesToBase64(
  bytes
) {
  let binary = "";


  for (
    let index = 0;
    index < bytes.length;
    index += 1
  ) {
    binary +=
      String.fromCharCode(
        bytes[index]
      );
  }


  return btoa(
    binary
  );
}


/* ==================================================
   PBKDF2 비밀번호 생성

   저장 형식:
   pbkdf2$반복횟수$salt$passwordHash

   login.js의 verifyPassword()와 호환
================================================== */

async function createPasswordHash(
  password
) {
  const encoder =
    new TextEncoder();


  const salt =
    crypto.getRandomValues(
      new Uint8Array(
        SALT_LENGTH
      )
    );


  const passwordKey =
    await crypto.subtle.importKey(
      "raw",

      encoder.encode(
        password
      ),

      {
        name:
          "PBKDF2"
      },

      false,

      [
        "deriveBits"
      ]
    );


  const derivedBits =
    await crypto.subtle.deriveBits(
      {
        name:
          "PBKDF2",

        salt,

        iterations:
          PBKDF2_ITERATIONS,

        hash:
          "SHA-256"
      },

      passwordKey,

      PBKDF2_HASH_LENGTH *
      8
    );


  const passwordHash =
    new Uint8Array(
      derivedBits
    );


  return [
    "pbkdf2",

    String(
      PBKDF2_ITERATIONS
    ),

    bytesToBase64(
      salt
    ),

    bytesToBase64(
      passwordHash
    )
  ].join("$");
}


/* ==================================================
   생성 비밀키 확인

   Cloudflare 환경변수:
   USER_SETUP_KEY

   요청 헤더:
   X-Setup-Key
================================================== */

function verifySetupKey(
  context
) {
  const savedSetupKey =
    String(
      context.env
        .USER_SETUP_KEY ||
      ""
    );


  const requestedSetupKey =
    String(
      context.request.headers.get(
        "X-Setup-Key"
      ) ||
      ""
    );


  if (
    !savedSetupKey ||
    !requestedSetupKey
  ) {
    return false;
  }


  /*
    단순 문자열 비교이지만,
    서버 환경변수 값은 응답에 노출하지 않는다.
  */
  return (
    savedSetupKey ===
    requestedSetupKey
  );
}


/* ==================================================
   POST /api/create-user
================================================== */

export async function onRequestPost(
  context
) {
  try {
    /* ==================================================
       D1 연결 확인
    ================================================== */

    if (
      !context.env.DB
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "D1 데이터베이스가 연결되지 않았습니다."
        },

        500
      );
    }


    /* ==================================================
       생성 비밀키 확인
    ================================================== */

    if (
      !verifySetupKey(
        context
      )
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "사용자를 생성할 권한이 없습니다."
        },

        403
      );
    }


    /* ==================================================
       요청 본문 읽기
    ================================================== */

    let body;


    try {
      body =
        await context
          .request
          .json();

    } catch (error) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "요청 형식이 올바르지 않습니다."
        },

        400
      );
    }


    const employeeNo =
      normalizeEmployeeNo(
        body.employeeNo
      );


    const name =
      normalizeName(
        body.name
      );


    const role =
      normalizeRole(
        body.role
      );


    /* ==================================================
       입력값 검증
    ================================================== */

    if (
      !employeeNo ||
      !name
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "사번과 이름을 모두 입력해 주세요."
        },

        400
      );
    }


    if (
      !/^\d{6,10}$/.test(
        employeeNo
      )
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "사번은 숫자 6~10자리로 입력해 주세요."
        },

        400
      );
    }


    if (
      name.length < 2 ||
      name.length > 30
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "이름은 2~30자로 입력해 주세요."
        },

        400
      );
    }


    if (
      !role
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "권한은 user 또는 super_admin만 사용할 수 있습니다."
        },

        400
      );
    }


    /* ==================================================
       중복 사번 확인
    ================================================== */

    const existingUser =
      await context.env.DB
        .prepare(`
          SELECT
            id,
            employee_no,
            name
          FROM users
          WHERE employee_no = ?
          LIMIT 1
        `)
        .bind(
          employeeNo
        )
        .first();


    if (
      existingUser
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "이미 등록된 사번입니다."
        },

        409
      );
    }


    /* ==================================================
       초기 비밀번호 생성

       초기 비밀번호:
       사번과 동일
    ================================================== */

    const initialPassword =
      employeeNo;


    const passwordHash =
      await createPasswordHash(
        initialPassword
      );


    const now =
      new Date()
        .toISOString();


    /* ==================================================
       사용자 저장
    ================================================== */

    const insertResult =
      await context.env.DB
        .prepare(`
          INSERT INTO users (
            employee_no,
            name,
            password_hash,
            role,
            is_active,
            approved_at,
            approved_by,
            created_at
          )
          VALUES (?, ?, ?, ?, 1, ?, ?, ?)
        `)
        .bind(
          employeeNo,
          name,
          passwordHash,
          role,
          now,
          "system",
          now
        )
        .run();


    if (
      !insertResult.success
    ) {
      throw new Error(
        "사용자 저장에 실패했습니다."
      );
    }


    /* ==================================================
       생성 결과

       비밀번호 해시와 설정 비밀키는 반환하지 않는다.
    ================================================== */

    return jsonResponse(
      {
        ok:
          true,

        message:
          `${name} 계정을 생성했습니다.`,

        user: {
          id:
            Number(
              insertResult.meta
                ?.last_row_id ||
              0
            ),

          employeeNo,

          name,

          role,

          isActive:
            true,

          initialPassword:
            employeeNo
        }
      },

      201
    );

  } catch (error) {
    console.error(
      "사용자 생성 오류:",
      error
    );


    const errorMessage =
      String(
        error?.message ||
        error ||
        ""
      );


    /*
      동시 요청 등으로 UNIQUE 제약에 걸린 경우
    */
    if (
      errorMessage.includes(
        "UNIQUE constraint failed"
      )
    ) {
      return jsonResponse(
        {
          ok:
            false,

          message:
            "이미 등록된 사번입니다."
        },

        409
      );
    }


    return jsonResponse(
      {
        ok:
          false,

        message:
          "사용자 생성 중 오류가 발생했습니다."
      },

      500
    );
  }
}


/* ==================================================
   지원하지 않는 요청
================================================== */

export function onRequestGet() {
  return jsonResponse(
    {
      ok:
        false,

      message:
        "사용자 생성은 POST 요청으로 진행해 주세요."
    },

    405
  );
}