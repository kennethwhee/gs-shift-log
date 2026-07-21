/* ==================================================
   설비 네비게이터 로그인 API

   POST /api/login

   기능
   - 사번 및 비밀번호 확인
   - PBKDF2 비밀번호 검증
   - 비활성 계정 차단
   - 마지막 로그인 시각 저장
   - 사용자 이름 및 권한 반환
================================================== */


/* =========================
   공통 설정
========================= */

const MAX_PASSWORD_LENGTH = 100;


/* =========================
   공통 JSON 응답
========================= */

function jsonResponse(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}


/* =========================
   사번 정리
========================= */

function normalizeEmployeeNo(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "");
}


/* =========================
   Base64 → Uint8Array
========================= */

function base64ToBytes(base64) {
  try {
    const binary = atob(base64);

    const bytes = new Uint8Array(
      binary.length
    );

    for (
      let index = 0;
      index < binary.length;
      index += 1
    ) {
      bytes[index] =
        binary.charCodeAt(index);
    }

    return bytes;

  } catch (error) {
    console.error(
      "Base64 변환 오류:",
      error
    );

    return null;
  }
}


/* =========================
   안전한 바이트 비교

   중간에 다른 값이 발견되어도
   즉시 종료하지 않고 끝까지 비교
========================= */

function timingSafeEqual(first, second) {
  if (
    !(first instanceof Uint8Array) ||
    !(second instanceof Uint8Array)
  ) {
    return false;
  }

  if (first.length !== second.length) {
    return false;
  }

  let difference = 0;

  for (
    let index = 0;
    index < first.length;
    index += 1
  ) {
    difference |=
      first[index] ^ second[index];
  }

  return difference === 0;
}


/* =========================
   PBKDF2 비밀번호 검증

   저장 형식:
   pbkdf2$반복횟수$salt$passwordHash
========================= */

async function verifyPassword(
  password,
  storedPasswordHash
) {
  try {
    const hashParts =
      String(storedPasswordHash || "")
        .split("$");

    if (hashParts.length !== 4) {
      console.error(
        "저장된 비밀번호 형식이 올바르지 않습니다."
      );

      return false;
    }

    const [
      algorithm,
      iterationsText,
      saltBase64,
      passwordHashBase64
    ] = hashParts;

    if (algorithm !== "pbkdf2") {
      console.error(
        "지원하지 않는 비밀번호 알고리즘입니다."
      );

      return false;
    }

    const iterations =
      Number(iterationsText);

    if (
      !Number.isInteger(iterations) ||
      iterations < 100000 ||
      iterations > 1000000
    ) {
      console.error(
        "PBKDF2 반복 횟수가 올바르지 않습니다."
      );

      return false;
    }

    const salt =
      base64ToBytes(saltBase64);

    const storedHash =
      base64ToBytes(
        passwordHashBase64
      );

    if (
      !salt ||
      !storedHash ||
      salt.length === 0 ||
      storedHash.length === 0
    ) {
      return false;
    }

    const encoder =
      new TextEncoder();

    const passwordKey =
      await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        {
          name: "PBKDF2"
        },
        false,
        ["deriveBits"]
      );

    const derivedBits =
      await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          salt,
          iterations,
          hash: "SHA-256"
        },
        passwordKey,
        storedHash.length * 8
      );

    const calculatedHash =
      new Uint8Array(derivedBits);

    return timingSafeEqual(
      calculatedHash,
      storedHash
    );

  } catch (error) {
    console.error(
      "비밀번호 검증 오류:",
      error
    );

    return false;
  }
}


/* =========================
   권한 정보 정리
========================= */

function normalizeRole(value) {
  const role =
    String(value || "")
      .trim()
      .toLowerCase();

  if (
    role === "super_admin" ||
    role === "super-admin" ||
    role === "superadmin"
  ) {
    return "super_admin";
  }

  if (role === "admin") {
    return "admin";
  }

  return "user";
}


/* =========================
   프런트 관리자 단계 변환
========================= */

function getAdminLevel(role) {
  if (role === "super_admin") {
    return 2;
  }

  if (role === "admin") {
    return 1;
  }

  return 0;
}


/* ==================================================
   POST /api/login
================================================== */

export async function onRequestPost(context) {
  try {
    let body;

    try {
      body =
        await context.request.json();

    } catch (error) {
      return jsonResponse(
        {
          ok: false,
          message:
            "로그인 요청 형식이 올바르지 않습니다."
        },
        400
      );
    }


    const employeeNo =
      normalizeEmployeeNo(
        body.employeeNo
      );

    const password =
      String(body.password || "");


    /* =========================
       입력값 확인
    ========================= */

    if (!employeeNo || !password) {
      return jsonResponse(
        {
          ok: false,
          message:
            "사번과 비밀번호를 입력해주세요."
        },
        400
      );
    }

    if (!/^\d{6,10}$/.test(employeeNo)) {
      return jsonResponse(
        {
          ok: false,
          message:
            "사번 또는 비밀번호가 올바르지 않습니다."
        },
        401
      );
    }

    if (
      password.length < 4 ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            "사번 또는 비밀번호가 올바르지 않습니다."
        },
        401
      );
    }


    /* =========================
       사용자 조회
    ========================= */

    const user =
      await context.env.DB
        .prepare(`
          SELECT
            id,
            employee_no,
            name,
            password_hash,
            role,
            is_active,
            approved_at,
            approved_by,
            last_login_at,
            created_at
          FROM users
          WHERE employee_no = ?
          LIMIT 1
        `)
        .bind(employeeNo)
        .first();


    /*
      계정 존재 여부를 구체적으로 알려주지 않아
      사번 목록 추측을 어렵게 함
    */

    if (!user) {
      return jsonResponse(
        {
          ok: false,
          message:
            "사번 또는 비밀번호가 올바르지 않습니다."
        },
        401
      );
    }


    /* =========================
       비활성 계정 차단
    ========================= */

    if (Number(user.is_active) !== 1) {
      return jsonResponse(
        {
          ok: false,
          message:
            "현재 사용이 중지된 계정입니다. 관리자에게 문의해주세요."
        },
        403
      );
    }


    /* =========================
       비밀번호 검증
    ========================= */

    const passwordMatched =
      await verifyPassword(
        password,
        user.password_hash
      );

    if (!passwordMatched) {
      return jsonResponse(
        {
          ok: false,
          message:
            "사번 또는 비밀번호가 올바르지 않습니다."
        },
        401
      );
    }


    /* =========================
       권한 정리
    ========================= */

    const role =
      normalizeRole(user.role);

    const adminLevel =
      getAdminLevel(role);

    const lastLoginAt =
      new Date().toISOString();


    /* =========================
       마지막 로그인 시각 저장
    ========================= */

    await context.env.DB
      .prepare(`
        UPDATE users
        SET last_login_at = ?
        WHERE id = ?
      `)
      .bind(
        lastLoginAt,
        user.id
      )
      .run();


    /* =========================
       로그인 성공 응답
    ========================= */

    return jsonResponse({
      ok: true,

      message:
        `${user.name}님, 로그인되었습니다.`,

      user: {
        id: Number(user.id),
        employeeNo:
          user.employee_no,
        name:
          user.name,
        role,
        adminLevel,
        isAdmin:
          adminLevel >= 1,
        isSuperAdmin:
          adminLevel === 2,
        lastLoginAt
      }
    });

  } catch (error) {
    console.error(
      "로그인 처리 오류:",
      error
    );

    return jsonResponse(
      {
        ok: false,
        message:
          "로그인 처리 중 오류가 발생했습니다.",
        error: String(error)
      },
      500
    );
  }
}


/* =========================
   지원하지 않는 요청
========================= */

export function onRequestGet() {
  return jsonResponse(
    {
      ok: false,
      message:
        "로그인은 POST 요청으로 진행해주세요."
    },
    405
  );
}