const PBKDF2_ITERATIONS = 100000;
const HASH_ALGORITHM = "SHA-256";
const KEY_LENGTH_BITS = 256;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function bytesToBase64(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

async function createPasswordHash(password) {
  const encoder = new TextEncoder();

  const salt = crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: HASH_ALGORITHM
    },
    keyMaterial,
    KEY_LENGTH_BITS
  );

  const hash = new Uint8Array(derivedBits);

  return [
    "pbkdf2",
    PBKDF2_ITERATIONS,
    bytesToBase64(salt),
    bytesToBase64(hash)
  ].join("$");
}

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;

    if (!db) {
      return jsonResponse(
        {
          ok: false,
          message: "D1 데이터베이스가 연결되지 않았습니다."
        },
        500
      );
    }

    const existingAdmin = await db
      .prepare(`
        SELECT id
        FROM users
        WHERE role = 'superadmin'
           OR approved_by = 'initial-system'
        LIMIT 1
      `)
      .first();

    if (existingAdmin) {
      return jsonResponse(
        {
          ok: false,
          message: "최초 최고관리자는 이미 생성되었습니다."
        },
        409
      );
    }

    const body = await context.request.json();

    const employeeNo = String(body.employeeNo || "").trim();
    const name = String(body.name || "").trim();
    const password = String(body.password || "");

    if (!employeeNo || !name || !password) {
      return jsonResponse(
        {
          ok: false,
          message: "사번, 이름, 비밀번호를 모두 입력해주세요."
        },
        400
      );
    }

    if (password.length < 4) {
      return jsonResponse(
        {
          ok: false,
          message: "비밀번호는 4자리 이상 입력해주세요."
        },
        400
      );
    }

    const duplicateUser = await db
      .prepare(`
        SELECT id
        FROM users
        WHERE employee_no = ?
        LIMIT 1
      `)
      .bind(employeeNo)
      .first();

    if (duplicateUser) {
      return jsonResponse(
        {
          ok: false,
          message: "이미 등록된 사번입니다."
        },
        409
      );
    }

    const passwordHash = await createPasswordHash(password);

    const result = await db
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
        VALUES (?, ?, ?, 'superadmin', 1, datetime('now'), NULL, datetime('now'))
      `)
      .bind(employeeNo, name, passwordHash)
      .run();

    return jsonResponse({
      ok: true,
      message: "최초 최고관리자 계정이 생성되었습니다.",
      user: {
        id: result.meta.last_row_id,
        employeeNo,
        name,
        role: "superadmin"
      }
    });
  } catch (error) {
    console.error("초기 최고관리자 생성 오류:", error);

    return jsonResponse(
      {
        ok: false,
        message: "최초 최고관리자 생성 중 오류가 발생했습니다.",
        error: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}