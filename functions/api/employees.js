/* ==================================================
   GS Shift Log 직원 명단 관리 API

   GET    /api/employees
   POST   /api/employees
   DELETE /api/employees

   POST 지원 형식

   1명 저장:
   {
     employeeNo,
     name,
     defaultRole,
     isAllowed
   }

   여러 명 저장:
   {
     employees: [
       {
         employeeNo,
         name,
         defaultRole,
         isAllowed
       }
     ]
   }
================================================== */


/* =========================
   공통 JSON 응답
========================= */

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


/* =========================
   공통 문자열 정리
========================= */

function normalizeText(value) {
  return String(
    value ?? ""
  ).trim();
}


/* =========================
   권한값 정리
========================= */

function normalizeRole(value) {
  const role =
    normalizeText(value)
      .toLowerCase()
      .replace(/\s+/g, "_");

  if (
    role === "admin" ||
    role === "leader" ||
    role === "super_admin"
  ) {
    return role === "admin"
      ? "leader"
      : role;
  }

  return "user";
}


/* =========================
   가입 허용값 정리
========================= */

function normalizeAllowed(value) {
  if (
    value === true ||
    value === 1 ||
    value === "1"
  ) {
    return 1;
  }

  const text =
    normalizeText(value)
      .toUpperCase();

  if (
    text === "Y" ||
    text === "YES" ||
    text === "TRUE" ||
    text === "허용"
  ) {
    return 1;
  }

  return 0;
}


/* =========================
   직원 데이터 정리
========================= */

function normalizeEmployee(
  employee
) {
  const source =
    employee &&
    typeof employee === "object"
      ? employee
      : {};

  return {
    employeeNo:
      normalizeText(
        source.employeeNo
      ).replace(
        /[^0-9]/g,
        ""
      ),

    name:
      normalizeText(
        source.name
      ),

    defaultRole:
      normalizeRole(
        source.defaultRole
      ),

    isAllowed:
      normalizeAllowed(
        source.isAllowed
      )
  };
}


/* =========================
   직원 데이터 검사
========================= */

function validateEmployee(
  employee,
  rowNumber = null
) {
  const rowText =
    rowNumber
      ? `${rowNumber}행: `
      : "";

  if (!employee.employeeNo) {
    return (
      rowText +
      "사번이 없습니다."
    );
  }

  if (
    !/^\d{6,10}$/.test(
      employee.employeeNo
    )
  ) {
    return (
      rowText +
      "사번은 숫자 6~10자리여야 합니다."
    );
  }

  if (!employee.name) {
    return (
      rowText +
      "직원 이름이 없습니다."
    );
  }

  return "";
}


/* ==================================================
   GET /api/employees
================================================== */

export async function onRequestGet(
  context
) {
  try {
    const employees =
      await context.env.DB
        .prepare(`
          SELECT
            employee_no,
            name,
            default_role,
            is_allowed
          FROM employees
          ORDER BY
            name COLLATE NOCASE ASC,
            employee_no ASC
        `)
        .all();


    const results =
      Array.isArray(
        employees.results
      )
        ? employees.results
        : [];


    return jsonResponse({
      ok: true,

      employees:
        results.map(
          employee => ({
            employeeNo:
              String(
                employee.employee_no ||
                ""
              ),

            name:
              String(
                employee.name ||
                ""
              ),

            defaultRole:
              String(
                employee.default_role ||
                "user"
              ),

            isAllowed:
              Number(
                employee.is_allowed
              ) === 1
          })
        )
    });

  } catch (error) {
    console.error(
      "직원 명단 조회 오류:",
      error
    );

    return jsonResponse(
      {
        ok: false,

        message:
          "직원 명단을 불러오는 중 오류가 발생했습니다.",

        error:
          error instanceof Error
            ? error.message
            : String(error)
      },
      500
    );
  }
}


/* ==================================================
   직원 1명 저장

   같은 사번이 없으면 INSERT
   같은 사번이 있으면 UPDATE
================================================== */

async function saveEmployee(
  database,
  employee
) {
  const existingEmployee =
    await database
      .prepare(`
        SELECT
          employee_no
        FROM employees
        WHERE employee_no = ?
        LIMIT 1
      `)
      .bind(
        employee.employeeNo
      )
      .first();


  /*
    기존 직원 수정
  */
  if (existingEmployee) {
    await database
      .prepare(`
        UPDATE employees
        SET
          name = ?,
          default_role = ?,
          is_allowed = ?
        WHERE employee_no = ?
      `)
      .bind(
        employee.name,
        employee.defaultRole,
        employee.isAllowed,
        employee.employeeNo
      )
      .run();

    return "updated";
  }


  /*
    신규 직원 등록
  */
  await database
    .prepare(`
      INSERT INTO employees (
        employee_no,
        name,
        default_role,
        is_allowed
      )
      VALUES (?, ?, ?, ?)
    `)
    .bind(
      employee.employeeNo,
      employee.name,
      employee.defaultRole,
      employee.isAllowed
    )
    .run();

  return "created";
}


/* ==================================================
   POST /api/employees
================================================== */

export async function onRequestPost(
  context
) {
  try {
    const body =
      await context.request.json();


    const isBulkRequest =
      Array.isArray(
        body.employees
      );


    const sourceEmployees =
      isBulkRequest
        ? body.employees
        : [body];


    if (
      sourceEmployees.length === 0
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "저장할 직원 정보가 없습니다."
        },
        400
      );
    }


    if (
      sourceEmployees.length > 1000
    ) {
      return jsonResponse(
        {
          ok: false,

          message:
            "한 번에 최대 1,000명까지 등록할 수 있습니다."
        },
        400
      );
    }


    const employees = [];
    const errors = [];

    const employeeNoSet =
      new Set();


    sourceEmployees.forEach(
      (
        sourceEmployee,
        index
      ) => {
        const employee =
          normalizeEmployee(
            sourceEmployee
          );

        const rowNumber =
          isBulkRequest
            ? index + 2
            : null;

        const validationError =
          validateEmployee(
            employee,
            rowNumber
          );


        if (validationError) {
          errors.push(
            validationError
          );

          return;
        }


        if (
          employeeNoSet.has(
            employee.employeeNo
          )
        ) {
          errors.push(
            `${
              rowNumber ||
              "입력값"
            }: 중복된 사번입니다. ` +
            `(${employee.employeeNo})`
          );

          return;
        }


        employeeNoSet.add(
          employee.employeeNo
        );

        employees.push(
          employee
        );
      }
    );


    if (errors.length > 0) {
      return jsonResponse(
        {
          ok: false,

          message:
            "직원 정보에 오류가 있습니다.",

          errors
        },
        400
      );
    }


    let createdCount = 0;
    let updatedCount = 0;


    for (
      const employee of employees
    ) {
      const result =
        await saveEmployee(
          context.env.DB,
          employee
        );


      if (
        result === "created"
      ) {
        createdCount += 1;
      }


      if (
        result === "updated"
      ) {
        updatedCount += 1;
      }
    }


    return jsonResponse(
      {
        ok: true,

        success: true,

        message:
          isBulkRequest
            ? (
                `직원 명단 저장이 완료되었습니다. ` +
                `신규 ${createdCount}명 / ` +
                `수정 ${updatedCount}명`
              )
            : (
                createdCount > 0
                  ? "직원이 등록되었습니다."
                  : "직원 정보가 수정되었습니다."
              ),

        createdCount,

        updatedCount,

        totalCount:
          employees.length
      },
      isBulkRequest
        ? 200
        : createdCount > 0
          ? 201
          : 200
    );

  } catch (error) {
    console.error(
      "직원 저장 오류:",
      error
    );


    if (
      error instanceof SyntaxError
    ) {
      return jsonResponse(
        {
          ok: false,

          success: false,

          message:
            "요청 데이터 형식이 올바르지 않습니다."
        },
        400
      );
    }


    return jsonResponse(
      {
        ok: false,

        success: false,

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


/* ==================================================
   DELETE /api/employees

   직원 명단에서 직원 삭제
================================================== */

export async function onRequestDelete(
  context
) {
  try {
    const url =
      new URL(
        context.request.url
      );

    const employeeNo =
      normalizeText(
        url.searchParams.get(
          "employeeNo"
        )
      ).replace(
        /[^0-9]/g,
        ""
      );


    if (!employeeNo) {
      return jsonResponse(
        {
          ok: false,

          message:
            "삭제할 직원의 사번이 없습니다."
        },
        400
      );
    }


    const existingEmployee =
      await context.env.DB
        .prepare(`
          SELECT
            employee_no,
            name
          FROM employees
          WHERE employee_no = ?
          LIMIT 1
        `)
        .bind(
          employeeNo
        )
        .first();


    if (!existingEmployee) {
      return jsonResponse(
        {
          ok: false,

          message:
            "삭제할 직원을 찾을 수 없습니다."
        },
        404
      );
    }


    await context.env.DB
      .prepare(`
        DELETE FROM employees
        WHERE employee_no = ?
      `)
      .bind(
        employeeNo
      )
      .run();


    return jsonResponse({
      ok: true,

      success: true,

      message:
        `${existingEmployee.name} 직원이 명단에서 삭제되었습니다.`,

      employee: {
        employeeNo:
          String(
            existingEmployee.employee_no ||
            ""
          ),

        name:
          String(
            existingEmployee.name ||
            ""
          )
      }
    });

  } catch (error) {
    console.error(
      "직원 명단 삭제 오류:",
      error
    );


    return jsonResponse(
      {
        ok: false,

        success: false,

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