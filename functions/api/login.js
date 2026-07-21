/* =========================================================
  GS Shift Log 로그인 API

  POST /api/login

  요청값:
  {
    employeeId: "2014081",
    password: "2014081"
  }
========================================================= */

export async function onRequestPost(context) {
  const {
    request,
    env
  } =
    context;

  try {
    const body =
      await request.json();

    const employeeId =
      String(
        body?.employeeId ||
        ""
      ).trim();

    const password =
      String(
        body?.password ||
        ""
      );

    if (!employeeId) {
      return createJsonResponse(
        {
          success: false,
          message:
            "사번을 입력해 주세요."
        },
        400
      );
    }

    if (!password) {
      return createJsonResponse(
        {
          success: false,
          message:
            "비밀번호를 입력해 주세요."
        },
        400
      );
    }

    /*
      직원 DB 연결 확인
    */
    if (!env.DB) {
      return createJsonResponse(
        {
          success: false,
          message:
            "DB 연결이 설정되지 않았습니다."
        },
        500
      );
    }

    /*
      사번으로 회원 조회

      우선 users 테이블을 기준으로 한다.
      현재 네비게이터와 동일한 구조를 적용할 예정이다.
    */
    const user =
      await env.DB
        .prepare(
          `
          SELECT
            employee_id,
            name,
            password,
            role,
            is_active
          FROM users
          WHERE employee_id = ?
          LIMIT 1
          `
        )
        .bind(
          employeeId
        )
        .first();

    if (!user) {
      return createJsonResponse(
        {
          success: false,
          message:
            "등록되지 않은 사번입니다."
        },
        401
      );
    }

    if (
      Number(
        user.is_active
      ) === 0
    ) {
      return createJsonResponse(
        {
          success: false,
          message:
            "사용이 중지된 계정입니다."
        },
        403
      );
    }

    /*
      현재 1차 적용:
      초기 비밀번호는 사번과 동일

      추후 네비게이터의 PBKDF2 해시 방식으로
      그대로 교체한다.
    */
    const savedPassword =
      String(
        user.password ||
        user.employee_id ||
        ""
      );

    if (
      savedPassword !==
      password
    ) {
      return createJsonResponse(
        {
          success: false,
          message:
            "사번 또는 비밀번호가 올바르지 않습니다."
        },
        401
      );
    }

    return createJsonResponse(
      {
        success: true,

        user: {
          employeeId:
            String(
              user.employee_id ||
              ""
            ),

          name:
            String(
              user.name ||
              ""
            ),

          role:
            String(
              user.role ||
              "user"
            )
        }
      },
      200
    );

  } catch (error) {
    console.error(
      "로그인 API 오류:",
      error
    );

    return createJsonResponse(
      {
        success: false,
        message:
          "로그인 처리 중 오류가 발생했습니다."
      },
      500
    );
  }
}


function createJsonResponse(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(
      data
    ),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "no-store"
      }
    }
  );
}