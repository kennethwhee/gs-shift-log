"use strict";


/* =========================================================
  야간순찰 접근 권한 최종본

  허용:
  - PC 화면
  - 최고관리자
  - TO
  - BO1
  - BO2

  직접 URL 접근도 같은 기준으로 확인한다.
========================================================= */

const NIGHT_PATROL_AUTH_STORAGE_KEY =
  "gsShiftLog.currentUser";


const NIGHT_PATROL_FORCED_SUPER_ADMIN_EMPLOYEE_NO =
  "2014081";


const NIGHT_PATROL_ALLOWED_POSITIONS =
  new Set([
    "TO",
    "BO1",
    "BO2"
  ]);


function normalizeNightPatrolUserPosition(
  value
) {
  const normalizedValue =
    String(
      value ||
      ""
    )
      .trim()
      .toUpperCase()
      .replace(
        /[\s_-]+/g,
        ""
      );

  return NIGHT_PATROL_ALLOWED_POSITIONS.has(
    normalizedValue
  )
    ? normalizedValue
    : "";
}


function loadNightPatrolCurrentUser() {
  try {
    const savedUser =
      window.localStorage.getItem(
        NIGHT_PATROL_AUTH_STORAGE_KEY
      );

    return savedUser
      ? JSON.parse(savedUser)
      : null;

  } catch (error) {
    console.warn(
      "야간순찰 로그인 정보 읽기 실패:",
      error
    );

    return null;
  }
}


function isNightPatrolCurrentUserSuperAdmin() {
  const currentUser =
    loadNightPatrolCurrentUser();

  if (
    !currentUser
  ) {
    return false;
  }

  const employeeNo =
    String(
      currentUser.employeeNo ||
      currentUser.employee_no ||
      currentUser.employeeId ||
      currentUser.employee_id ||
      ""
    ).trim();

  if (
    employeeNo ===
    NIGHT_PATROL_FORCED_SUPER_ADMIN_EMPLOYEE_NO
  ) {
    return true;
  }

  if (
    Number(
      currentUser.adminLevel ??
      currentUser.admin_level ??
      0
    ) >= 2
  ) {
    return true;
  }

  const superAdminFlag =
    currentUser.isSuperAdmin ??
    currentUser.is_super_admin ??
    false;

  if (
    superAdminFlag === true ||
    Number(superAdminFlag) === 1 ||
    String(superAdminFlag)
      .trim()
      .toLowerCase() === "true"
  ) {
    return true;
  }

  const roleCandidates = [
    currentUser.role,
    currentUser.userRole,
    currentUser.user_role,
    currentUser.defaultRole,
    currentUser.default_role,
    currentUser.permission,
    currentUser.authority,
    currentUser.accessRole,
    currentUser.access_role
  ];

  return roleCandidates.some(
    value => {
      const role =
        String(
          value ||
          ""
        )
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, "_");

      return [
        "super_admin",
        "superadmin",
        "최고관리자"
      ].includes(role);
    }
  );
}


function getNightPatrolCurrentUserPosition() {
  const currentUser =
    loadNightPatrolCurrentUser();

  if (
    !currentUser
  ) {
    return "";
  }

  const positionCandidates = [
    currentUser.position,
    currentUser.jobPosition,
    currentUser.job_position,
    currentUser.jobRole,
    currentUser.job_role,
    currentUser.duty,
    currentUser.dutyName,
    currentUser.duty_name,
    currentUser.workPosition,
    currentUser.work_position,
    currentUser.workRole,
    currentUser.work_role,
    currentUser.shiftPosition,
    currentUser.shift_position,
    currentUser.shiftRole,
    currentUser.shift_role,
    currentUser.logRole,
    currentUser.log_role,
    currentUser.defaultPosition,
    currentUser.default_position,
    currentUser.assignedPosition,
    currentUser.assigned_position,
    currentUser.memberPosition,
    currentUser.member_position,
    currentUser.memberRole,
    currentUser.member_role,
    currentUser.role
  ];

  for (
    const candidate of
    positionCandidates
  ) {
    const normalizedPosition =
      normalizeNightPatrolUserPosition(
        candidate
      );

    if (
      normalizedPosition
    ) {
      return normalizedPosition;
    }
  }

  return "";
}


/* =========================================================
  야간순찰 점검일지 최종 접근 권한

  허용:
  - GS Shift Log에 로그인한 모든 직원
  - 모든 보직
  - PC 및 모바일

  차단:
  - 로그인 정보가 없는 직접 접근
========================================================= */

function canCurrentUserAccessNightPatrolPage() {
  const currentUser =
    loadNightPatrolCurrentUser();


  /*
    GS Shift Log에 로그인한 사용자라면
    보직과 접속 기기에 관계없이 사용할 수 있다.
  */
  return Boolean(
    currentUser &&
    typeof currentUser ===
      "object"
  );
}


/* =========================================================
  로그인하지 않은 직접 접근 안내
========================================================= */

function renderNightPatrolAccessDenied() {
  document.body.innerHTML = `
    <main
      style="
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background: #eef4f9;
        font-family: Arial, 'Noto Sans KR', sans-serif;
      "
    >
      <section
        style="
          width: min(520px, 100%);
          padding: 28px;
          border: 1px solid #c9d8e6;
          border-radius: 16px;
          background: #ffffff;
          text-align: center;
          box-shadow:
            0 14px 40px
            rgba(27, 58, 86, 0.12);
        "
      >
        <strong
          style="
            display: block;
            color: #17324d;
            font-size: 20px;
          "
        >
          로그인 정보를 확인할 수 없습니다.
        </strong>

        <p
          style="
            margin: 12px 0 0;
            color: #61778c;
            font-size: 14px;
            line-height: 1.65;
          "
        >
          GS Shift Log에 로그인한 뒤<br>
          점검일지 메뉴에서 다시 열어 주세요.
        </p>
      </section>
    </main>
  `;
}

/* =========================================================
  GS Shift Log - 야간 순찰 점검일지

  현재 단계 저장 방식:
  - 브라우저 localStorage
  - 날짜 + 순찰목록 번호별로 독립 저장

  다음 단계에서 D1 공용 저장 API를 연결할 수 있도록
  화면 로직과 저장 로직을 분리해 두었다.
========================================================= */

const NIGHT_PATROL_POINTS = [
  "CVP 점검",
  "Deaerator 점검(6F)",
  "Cyclone Area 점검(6F)",
  "Coal Daily Silo Air Canon 및 Silo 온도 점검(5F)",
  "HP Bypass Valve 점검(6F)",
  "Bag Filter Room 점검(1F)",
  "CCWP 점검",
  "Cooling Tower Vaccum Pump Room 점검",
  "Limestone Blower/Bed Ash System 점검(1F)",
  "Cooling Water Pump Room 점검",
  "Fly Ash Silo Room 점검",
  "#6 Heater 점검(3F)",
  "Cyclone 상부 점검(7F)",
  "Cooling Water Pump 전기실 점검",
  "제어실 및 전기실 점검",
  "Steam Drum 점검(7F)",
  "Bio Screw Feeder, Hopper Bin 점검(4.5F)",
  "배관망 Trap 응축수 상태 점검",
  "정압실 점검",
  "Drain To CCFT 및 Flash Tank Area 점검",
  "Demi WTR Pump 점검",
  "Condensate Make-Up Pump 점검",
  "Feed WTR LCV 및 Seal Pot 하부 점검(3.5F)",
  "CCFT Drain Pump 점검",
  "CCWP 점검",
  "Bed Ash Cooler/Conveyor 점검(1F)",
  "Start-Up Burner 점검(3F)",
  "Wall Screw Feeder Chute 열화 점검(2.5F)",
  "ACWP, MCWP 점검",
  "FBHE 하부 Hopper 점검(2.5F)",
  "Coal/Bio Daily Silo 상부 점검(7F)",
  "Bed Vibrating Screen 점검(2.5F)",
  "지하 HVAC Room 공조기 및 Sump Pump 점검",
  "Coal Feeder Room 점검(4F)",
  "SCR Ammonia Feeding System 점검",
  "공조기 상태 점검",
  "Bio Feeding System 점검(Dosing, Slewing ..)(5F)",
  "EDG Room 점검",
  "Cooling Water Make Up Pump 점검",
  "Cooling Tower Showering 상태 점검",
  "PA/SA/ID Fan 점검(1F)",
  "Steam Coil Air Heater 점검(3F)",
  "TBN Vacuum Seal Water 상태 점검",
  "ECO Air Lock Feeder 점검(4F)",
  "Atomizer Room 점검(7F)",
  "BlowDown Tank 및 Sump 점검(1F)",
  "Bed Material Make-up Bin 하부 점검(5F)",
  "Chemical Injection System 점검(1F)",
  "Feed WTR Tank Area 점검(5F)",
  "HP Process STM Line 점검",
  "Wall Screw Feeder / Bio Rotary Feeder 점검(3F)",
  "GIS Area 점검",
  "TBN Lube, Contol Oil Sys 점검",
  "Bed Material Make-up Bin 상부 점검(7F)",
  "FBHE Blower/Seal Pot Blower 점검(1F)",
  "TBN CV 상태 점검",
  "COP 점검",
  "SDA Lime Feeding Sys 점검(1F)",
  "Air Comp Room 점검(Comp동 1,2F)",
  "SCR Vaporizer 점검(6F)",
  "Spiess Valve(L,R) 점검(4F)",
  "BFP 및 CO2 Room 점검(1F)",
  "1층 전기실 점검",
  "Heater Emer LCV to Condenser Area 점검",
  "T.A.H Air Lock Feeder 점검(1F)",
  "#1, #2 #3 Heater, LP Header 점검",
  "HRH to LP HDR PCV Air Tank 압력 및 Leak 여부 점검",
  "Main Steam MOV Area 점검(4.5F)",
  "Bag Filter 상부 Room 점검",
  "West, East Sump Pit 및 Pump 점검",
  "#5 HTR 점검(2.5F)",
  "Cooling Tower 옥상 Fan Motor 점검",
  "SUT/GST/UAT 점검",
  "FBHE 격벽 온도 점검(3F)",
  "Bed Ash System 점검(3F)",
  "Service Water Tank Area 점검",
  "TBN AVR Room 점검"
];

const NIGHT_PATROL_POINT_CATALOG_STORAGE_KEY =
  "gsShiftLog.nightPatrol.pointCatalog.v1";


let nightPatrolPointCatalog = [];


const NIGHT_PATROL_TIMES = [
  "0:00",
  "2:00",
  "4:00",
  "6:00"
];

const NIGHT_PATROL_STORAGE_PREFIX =
  "gsShiftLog.nightPatrol";

const NIGHT_PATROL_MEMBER_STORAGE_PREFIX =
  "gsShiftLog.nightPatrol.members";

const nightPatrolState = {
  date:
    "",

  listNumber:
    1,

  documentStatus:
    "작성중",

  members: [
    "",
    "",
    ""
  ],

  entries:
    [],

  generalNote:
    "",

  updatedAt:
    "",

  completedAt:
    ""
};

let nightPatrolSavedSnapshot =
  "";

let nightPatrolSaveTimer =
  null;


/* =========================================================
  오늘 날짜 YYYY-MM-DD
========================================================= */

function getTodayInputValue() {
  const now =
    new Date();


  return [
    now.getFullYear(),

    String(
      now.getMonth() + 1
    ).padStart(
      2,
      "0"
    ),

    String(
      now.getDate()
    ).padStart(
      2,
      "0"
    )
  ].join(
    "-"
  );
}


/* =========================================================
  안정적인 문자열 해시
========================================================= */

function createPatrolSeed(
  value
) {
  let hash =
    2166136261;


  const source =
    String(
      value ||
      ""
    );


  for (
    let index = 0;
    index <
      source.length;
    index +=
      1
  ) {
    hash ^=
      source.charCodeAt(
        index
      );


    hash =
      Math.imul(
        hash,
        16777619
      );
  }


  return (
    hash >>>
    0
  );
}


/* =========================================================
  시드 난수 생성기
========================================================= */

function createPatrolRandom(
  seed
) {
  let value =
    Number(
      seed
    ) >>>
    0;


  return function nextRandom() {
    value +=
      0x6D2B79F5;


    let result =
      value;


    result =
      Math.imul(
        result ^
        (
          result >>>
          15
        ),

        result |
        1
      );


    result ^=
      result +
      Math.imul(
        result ^
        (
          result >>>
          7
        ),

        result |
        61
      );


    return (
      (
        result ^
        (
          result >>>
          14
        )
      ) >>>
      0
    ) /
    4294967296;
  };
}


/* =========================================================
  기본 순찰 포인트 목록
========================================================= */

function createDefaultNightPatrolPointCatalog() {
  return NIGHT_PATROL_POINTS.map(
    (
      pointName,
      pointIndex
    ) => {
      return {
        id:
          `point-${pointIndex + 1}`,

        name:
          String(
            pointName ||
            ""
          ).trim()
      };
    }
  );
}


/* =========================================================
  순찰 포인트 목록 정규화
========================================================= */

function normalizeNightPatrolPointCatalog(
  catalogValue
) {
  const sourceCatalog =
    Array.isArray(
      catalogValue
    )
      ? catalogValue
      : [];


  const usedIds =
    new Set();


  const normalizedCatalog = [];


  sourceCatalog.forEach(
    (
      point,
      pointIndex
    ) => {
      const name =
        String(
          point?.name ||
          ""
        ).trim();


      if (
        !name
      ) {
        return;
      }


      let id =
        String(
          point?.id ||
          ""
        ).trim();


      if (
        !id ||
        usedIds.has(
          id
        )
      ) {
        id = [
          "custom",
          Date.now(),
          pointIndex,
          Math.random()
            .toString(
              36
            )
            .slice(
              2,
              9
            )
        ].join(
          "-"
        );
      }


      usedIds.add(
        id
      );


      normalizedCatalog.push({
        id,
        name
      });
    }
  );


  return normalizedCatalog;
}


/* =========================================================
  순찰 포인트 원본 목록 불러오기
========================================================= */

function loadNightPatrolPointCatalog() {
  try {
    const savedText =
      window.localStorage.getItem(
        NIGHT_PATROL_POINT_CATALOG_STORAGE_KEY
      );


    if (
      savedText
    ) {
      const parsedCatalog =
        normalizeNightPatrolPointCatalog(
          JSON.parse(
            savedText
          )
        );


      if (
        parsedCatalog.length >=
          20
      ) {
        return parsedCatalog;
      }
    }

  } catch (
    error
  ) {
    console.warn(
      "순찰 포인트 원본 목록을 불러오지 못했습니다.",
      error
    );
  }


  return createDefaultNightPatrolPointCatalog();
}


/* =========================================================
  순찰 포인트 원본 목록 저장
========================================================= */

function saveNightPatrolPointCatalog() {
  try {
    window.localStorage.setItem(
      NIGHT_PATROL_POINT_CATALOG_STORAGE_KEY,
      JSON.stringify(
        nightPatrolPointCatalog
      )
    );


    return true;

  } catch (
    error
  ) {
    console.error(
      "순찰 포인트 원본 목록 저장 실패:",
      error
    );


    window.alert(
      "순찰 포인트 원본 목록을 저장하지 못했습니다."
    );


    return false;
  }
}


/* =========================================================
  새 순찰 포인트 ID
========================================================= */

function createNightPatrolPointId() {
  if (
    typeof globalThis.crypto?.randomUUID ===
      "function"
  ) {
    return (
      "custom-" +
      globalThis.crypto.randomUUID()
    );
  }


  return [
    "custom",
    Date.now(),
    Math.random()
      .toString(
        36
      )
      .slice(
        2,
        12
      )
  ].join(
    "-"
  );
}


/* =========================================================
  날짜별 기본 무작위 순서

  같은 날짜:
  - 항상 같은 기본 순서

  다른 날짜:
  - 새로운 순서
========================================================= */

function createDailyPatrolOrder(
  dateValue
) {
  const sourcePoints =
    nightPatrolPointCatalog.map(
      (
        point,
        pointIndex
      ) => {
        return {
          id:
            String(
              point?.id ||
              `point-${pointIndex + 1}`
            ).trim(),

          name:
            String(
              point?.name ||
              ""
            ).trim(),

          sourceIndex:
            pointIndex
        };
      }
    );


  const random =
    createPatrolRandom(
      createPatrolSeed(
        [
          "GS-NIGHT-PATROL",
          "v1",
          dateValue
        ].join(
          "|"
        )
      )
    );


  for (
    let index =
      sourcePoints.length - 1;

    index >
      0;

    index -=
      1
  ) {
    const randomIndex =
      Math.floor(
        random() *
        (
          index + 1
        )
      );


    [
      sourcePoints[
        index
      ],

      sourcePoints[
        randomIndex
      ]
    ] = [
      sourcePoints[
        randomIndex
      ],

      sourcePoints[
        index
      ]
    ];
  }


  return sourcePoints;
}


/* =========================================================
  목록 1~4의 20개 순찰 포인트

  77개 전체를 날짜별로 한 번 섞은 뒤
  20개씩 순서대로 배정한다.

  4번 목록은 77개 이후 첫 3개를 순환 사용한다.
========================================================= */

function createPatrolPoints(
  dateValue,
  listNumber
) {
  const dailyOrder =
    createDailyPatrolOrder(
      dateValue
    );


  const safeListNumber =
    Math.min(
      4,

      Math.max(
        1,
        Number(
          listNumber
        ) ||
        1
      )
    );


  const startIndex =
    (
      safeListNumber -
      1
    ) *
    20;


  return Array.from(
    {
      length:
        20
    },

    (
      unused,
      entryIndex
    ) => {
      const sourcePoint =
        dailyOrder[
          (
            startIndex +
            entryIndex
          ) %
          dailyOrder.length
        ];


      return {
        entryId:
          [
            dateValue,
            safeListNumber,
            sourcePoint.id,
            entryIndex
          ].join(
            "|"
          ),

        pointId:
          sourcePoint.id,

        pointName:
          sourcePoint.name,

        time:
          NIGHT_PATROL_TIMES[
            Math.floor(
              entryIndex /
              5
            )
          ],

        status:
          "양호",

        note:
          ""
      };
    }
  );
}


/* =========================================================
  저장 키
========================================================= */

function getPatrolStorageKey(
  dateValue,
  listNumber
) {
  return [
    NIGHT_PATROL_STORAGE_PREFIX,
    String(
      dateValue ||
      ""
    ),
    String(
      listNumber ||
      1
    )
  ].join(
    "."
  );
}


function getPatrolMemberStorageKey(
  listNumber
) {
  return [
    NIGHT_PATROL_MEMBER_STORAGE_PREFIX,
    String(
      listNumber ||
      1
    )
  ].join(
    "."
  );
}


/* =========================================================
  순찰자 기본값 불러오기
========================================================= */

function loadSavedPatrolMembers(
  listNumber
) {
  try {
    const savedText =
      window.localStorage.getItem(
        getPatrolMemberStorageKey(
          listNumber
        )
      );


    if (
      !savedText
    ) {
      return [
        "",
        "",
        ""
      ];
    }


    const savedMembers =
      JSON.parse(
        savedText
      );


    if (
      !Array.isArray(
        savedMembers
      )
    ) {
      return [
        "",
        "",
        ""
      ];
    }


    return [
      String(
        savedMembers[0] ||
        ""
      ).trim(),

      String(
        savedMembers[1] ||
        ""
      ).trim(),

      String(
        savedMembers[2] ||
        ""
      ).trim()
    ];

  } catch (
    error
  ) {
    console.warn(
      "순찰자 기본값을 불러오지 못했습니다.",
      error
    );


    return [
      "",
      "",
      ""
    ];
  }
}


/* =========================================================
  순찰자 기본값 저장
========================================================= */

function savePatrolMembers() {
  try {
    window.localStorage.setItem(
      getPatrolMemberStorageKey(
        nightPatrolState
          .listNumber
      ),

      JSON.stringify(
        nightPatrolState
          .members
      )
    );

  } catch (
    error
  ) {
    console.warn(
      "순찰자 기본값 저장 실패:",
      error
    );
  }
}


/* =========================================================
  현재 상태 객체
========================================================= */

function createPatrolRecord() {
  return {
    version:
      2,

    date:
      nightPatrolState.date,

    listNumber:
      nightPatrolState
        .listNumber,

    documentStatus:
      nightPatrolState
        .documentStatus,

    members:
      [
        ...nightPatrolState
          .members
      ],

    entries:
      nightPatrolState
        .entries
        .map(
          entry => {
            return {
              ...entry
            };
          }
        ),

    generalNote:
      nightPatrolState
        .generalNote,

    updatedAt:
      nightPatrolState
        .updatedAt,

    completedAt:
      nightPatrolState
        .completedAt
  };
}


/* =========================================================
  비교용 스냅샷
========================================================= */

function createPatrolSnapshot() {
  return JSON.stringify(
    createPatrolRecord()
  );
}


/* =========================================================
  저장 표시
========================================================= */

function setPatrolSaveState(
  message,
  state
) {
  const element =
    document.getElementById(
      "patrolSaveState"
    );


  if (
    !element
  ) {
    return;
  }


  element.textContent =
    String(
      message ||
      ""
    );


  element.dataset.state =
    state ||
    "idle";
}


/* =========================================================
  수정 상태 표시
========================================================= */

function markPatrolDirty() {
  if (
    createPatrolSnapshot() ===
    nightPatrolSavedSnapshot
  ) {
    return;
  }


  setPatrolSaveState(
    "저장 필요",
    "dirty"
  );


  window.clearTimeout(
    nightPatrolSaveTimer
  );


  nightPatrolSaveTimer =
    window.setTimeout(
      () => {
        saveNightPatrolRecord(
          {
            silent:
              true
          }
        );
      },
      700
    );
}


/* =========================================================
  저장 자료 정규화
========================================================= */

function normalizeSavedPatrolRecord(
  savedRecord,
  dateValue,
  listNumber
) {
  const defaultEntries =
    createPatrolPoints(
      dateValue,
      listNumber
    );


  const rawSavedEntries =
    Array.isArray(
      savedRecord?.entries
    )
      ? savedRecord.entries
      : [];


  const entries =
    Array.from(
      {
        length:
          20
      },

      (
        unused,
        entryIndex
      ) => {
        const defaultEntry =
          defaultEntries[
            entryIndex
          ];


        const savedEntry =
          rawSavedEntries[
            entryIndex
          ] ||
          null;


        const normalizedStatus =
          [
            "양호",
            "이상",
            "미점검",
            "해당없음"
          ].includes(
            String(
              savedEntry?.status ||
              ""
            ).trim()
          )
            ? String(
                savedEntry.status
              ).trim()
            : "양호";


        return {
          entryId:
            String(
              savedEntry?.entryId ||
              defaultEntry?.entryId ||
              ""
            ).trim(),

          pointId:
            String(
              savedEntry?.pointId ||
              defaultEntry?.pointId ||
              ""
            ).trim(),

          pointName:
            String(
              savedEntry?.pointName ||
              defaultEntry?.pointName ||
              ""
            ).trim(),

          time:
            NIGHT_PATROL_TIMES[
              Math.floor(
                entryIndex /
                5
              )
            ],

          status:
            normalizedStatus,

          note:
            String(
              savedEntry?.note ||
              ""
            ).trim()
        };
      }
    );


  const savedMembers =
    Array.isArray(
      savedRecord?.members
    )
      ? savedRecord.members
      : loadSavedPatrolMembers(
          listNumber
        );


  return {
    date:
      dateValue,

    listNumber,

    documentStatus:
      String(
        savedRecord?.documentStatus ||
        "작성중"
      ) ===
        "점검완료"
        ? "점검완료"
        : "작성중",

    members: [
      String(
        savedMembers[0] ||
        ""
      ).trim(),

      String(
        savedMembers[1] ||
        ""
      ).trim(),

      String(
        savedMembers[2] ||
        ""
      ).trim()
    ],

    entries,

    generalNote:
      String(
        savedRecord?.generalNote ||
        ""
      ),

    updatedAt:
      String(
        savedRecord?.updatedAt ||
        ""
      ),

    completedAt:
      String(
        savedRecord?.completedAt ||
        ""
      )
  };
}

/* =========================================================
  저장 자료 불러오기
========================================================= */

function loadNightPatrolRecord(
  dateValue,
  listNumber
) {
  let savedRecord =
    null;


  try {
    const savedText =
      window.localStorage.getItem(
        getPatrolStorageKey(
          dateValue,
          listNumber
        )
      );


    if (
      savedText
    ) {
      savedRecord =
        JSON.parse(
          savedText
        );
    }

  } catch (
    error
  ) {
    console.warn(
      "야간 순찰 점검일지를 불러오지 못했습니다.",
      error
    );
  }


  const normalizedRecord =
    normalizeSavedPatrolRecord(
      savedRecord,
      dateValue,
      listNumber
    );


  Object.assign(
    nightPatrolState,
    normalizedRecord
  );


  renderNightPatrolScreen();


  nightPatrolSavedSnapshot =
    createPatrolSnapshot();


  if (
    nightPatrolState.updatedAt
  ) {
    setPatrolSaveState(
      nightPatrolState
        .documentStatus ===
        "점검완료"
          ? "점검완료"
          : "저장됨",

      "saved"
    );

  } else {
    setPatrolSaveState(
      "저장 전",
      "idle"
    );
  }
}


/* =========================================================
  입력값을 상태에 반영
========================================================= */

function collectPatrolScreenValues() {
  nightPatrolState.date =
    String(
      document
        .getElementById(
          "patrolDate"
        )
        ?.value ||
      nightPatrolState.date
    ).trim();


  nightPatrolState.documentStatus =
    String(
      document
        .getElementById(
          "patrolDocumentStatus"
        )
        ?.value ||
      "작성중"
    ) ===
      "점검완료"
      ? "점검완료"
      : "작성중";


  nightPatrolState.members = [
    document.getElementById(
      "patrolMember1"
    )?.value,

    document.getElementById(
      "patrolMember2"
    )?.value,

    document.getElementById(
      "patrolMember3"
    )?.value
  ].map(
    value => {
      return String(
        value ||
        ""
      ).trim();
    }
  );


  nightPatrolState.generalNote =
    String(
      document
        .getElementById(
          "patrolGeneralNote"
        )
        ?.value ||
      ""
    );


  document
    .querySelectorAll(
      "[data-patrol-entry-index]"
    )
    .forEach(
      row => {
        const entryIndex =
          Number(
            row.dataset
              .patrolEntryIndex
          );


        const targetEntry =
          nightPatrolState
            .entries[
              entryIndex
            ];


        if (
          !targetEntry
        ) {
          return;
        }


        targetEntry.pointName =
          String(
            row.querySelector(
              "[data-patrol-point-name]"
            )?.value ||
            targetEntry.pointName ||
            ""
          ).trim();


        targetEntry.status =
          String(
            row.querySelector(
              "[data-patrol-status]"
            )?.value ||
            "양호"
          );


        targetEntry.note =
          String(
            row.querySelector(
              "[data-patrol-note]"
            )?.value ||
            ""
          ).trim();
      }
    );
}


/* =========================================================
  저장 검증
========================================================= */

function validatePatrolForCompletion() {
  const missingMember =
    nightPatrolState
      .members
      .some(
        memberName => {
          return !String(
            memberName ||
            ""
          ).trim();
        }
      );


  if (
    missingMember
  ) {
    window.alert(
      "순찰자 3명의 이름을 모두 입력해 주세요."
    );


    return false;
  }


  const pendingEntry =
    nightPatrolState
      .entries
      .find(
        entry => {
          return (
            entry.status ===
            "미점검"
          );
        }
      );


  if (
    pendingEntry
  ) {
    window.alert(
      `미점검 항목이 남아 있습니다.\n\n${pendingEntry.pointName}`
    );


    return false;
  }


  const badEntryWithoutNote =
    nightPatrolState
      .entries
      .find(
        entry => {
          return (
            entry.status ===
              "이상" &&
            !String(
              entry.note ||
              ""
            ).trim()
          );
        }
      );


  if (
    badEntryWithoutNote
  ) {
    window.alert(
      `이상 항목의 특이사항을 입력해 주세요.\n\n${badEntryWithoutNote.pointName}`
    );


    return false;
  }


  return true;
}


/* =========================================================
  저장
========================================================= */

function saveNightPatrolRecord(
  options = {}
) {
  const {
    silent =
      false
  } = options;


  collectPatrolScreenValues();


  if (
    nightPatrolState
      .documentStatus ===
      "점검완료" &&
    !validatePatrolForCompletion()
  ) {
    document
      .getElementById(
        "patrolDocumentStatus"
      )
      .value =
      "작성중";


    nightPatrolState
      .documentStatus =
      "작성중";


    return false;
  }


  const now =
    new Date()
      .toISOString();


  nightPatrolState.updatedAt =
    now;


  if (
    nightPatrolState
      .documentStatus ===
      "점검완료"
  ) {
    nightPatrolState.completedAt =
      nightPatrolState
        .completedAt ||
      now;

  } else {
    nightPatrolState.completedAt =
      "";
  }


  savePatrolMembers();


  try {
    window.localStorage.setItem(
      getPatrolStorageKey(
        nightPatrolState.date,
        nightPatrolState.listNumber
      ),

      JSON.stringify(
        createPatrolRecord()
      )
    );

  } catch (
    error
  ) {
    console.error(
      "야간 순찰 점검일지 저장 실패:",
      error
    );


    window.alert(
      "야간 순찰 점검일지를 저장하지 못했습니다."
    );


    return false;
  }


  nightPatrolSavedSnapshot =
    createPatrolSnapshot();


  setPatrolSaveState(
    nightPatrolState
      .documentStatus ===
      "점검완료"
        ? "점검완료"
        : "저장됨",

    "saved"
  );


  if (
    !silent
  ) {
    window.alert(
      nightPatrolState
        .documentStatus ===
        "점검완료"
          ? "야간 순찰 점검일지를 완료 저장했습니다."
          : "야간 순찰 점검일지를 저장했습니다."
    );
  }


  renderPatrolSummary();


  return true;
}


/* =========================================================
  HTML 특수문자
========================================================= */

function escapePatrolHtml(
  value
) {
  return String(
    value ??
    ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}


/* =========================================================
  목록 선택 버튼
========================================================= */

function renderPatrolListButtons() {
  document
    .querySelectorAll(
      "[data-list-number]"
    )
    .forEach(
      button => {
        const buttonNumber =
          Number(
            button.dataset
              .listNumber
          );


        const isActive =
          buttonNumber ===
          nightPatrolState
            .listNumber;


        button.classList.toggle(
          "is-active",
          isActive
        );


        button.setAttribute(
          "aria-pressed",
          String(
            isActive
          )
        );
      }
    );
}


/* =========================================================
  점검 테이블
========================================================= */

function renderPatrolTable() {
  const tableBody =
    document.getElementById(
      "patrolTableBody"
    );


  if (
    !tableBody
  ) {
    return;
  }


  tableBody.innerHTML =
    nightPatrolState
      .entries
      .map(
        (
          entry,
          entryIndex
        ) => {
          const rowClass =
            entry.status ===
              "이상"
              ? "is-bad"
              : (
                  entry.status ===
                    "미점검"
                    ? "is-pending"
                    : ""
                );


          return `
            <tr
              class="${rowClass}"
              data-patrol-entry-index="${entryIndex}"
            >
              <td class="patrol-row-number">
                ${entryIndex + 1}
              </td>

              <td class="patrol-row-time">
                ${escapePatrolHtml(
                  entry.time
                )}
              </td>

              <td class="patrol-row-point">
                <input
                  type="text"
                  class="patrol-point-name-input"
                  data-patrol-point-name
                  value="${escapePatrolHtml(
                    entry.pointName
                  )}"
                  maxlength="160"
                  aria-label="${entryIndex + 1}번 순찰 구역"
                />

                <small>
                  현재 일지에서 직접 수정 가능 · 순찰 목록 ${nightPatrolState.listNumber}
                </small>
              </td>

              <td>
                <select
                  data-patrol-status
                  aria-label="${entryIndex + 1}번 점검 상태"
                >
                  <option
                    value="양호"
                    ${entry.status === "양호" ? "selected" : ""}
                  >
                    양호
                  </option>

                  <option
                    value="이상"
                    ${entry.status === "이상" ? "selected" : ""}
                  >
                    이상
                  </option>

                  <option
                    value="미점검"
                    ${entry.status === "미점검" ? "selected" : ""}
                  >
                    미점검
                  </option>

                  <option
                    value="해당없음"
                    ${entry.status === "해당없음" ? "selected" : ""}
                  >
                    해당 없음
                  </option>
                </select>
              </td>

              <td>
                <input
                  type="text"
                  data-patrol-note
                  value="${escapePatrolHtml(
                    entry.note
                  )}"
                  maxlength="300"
                  placeholder="${entry.status === "이상" ? "이상 내용 및 조치사항 입력" : "특이사항 입력"}"
                  aria-label="${entryIndex + 1}번 특이사항"
                />
              </td>
            </tr>
          `;
        }
      )
      .join(
        ""
      );
}


/* =========================================================
  요약
========================================================= */

function renderPatrolSummary() {
  const statusCounts = {
    양호:
      0,

    이상:
      0,

    미점검:
      0,

    해당없음:
      0
  };


  nightPatrolState
    .entries
    .forEach(
      entry => {
        if (
          Object.prototype
            .hasOwnProperty
            .call(
              statusCounts,
              entry.status
            )
        ) {
          statusCounts[
            entry.status
          ] +=
            1;
        }
      }
    );


  const setText = (
    elementId,
    value
  ) => {
    const element =
      document.getElementById(
        elementId
      );


    if (
      element
    ) {
      element.textContent =
        String(
          value
        );
    }
  };


  setText(
    "summaryTotal",
    nightPatrolState
      .entries
      .length
  );


  setText(
    "summaryGood",
    statusCounts.양호
  );


  setText(
    "summaryBad",
    statusCounts.이상
  );


  setText(
    "summaryPending",
    statusCounts.미점검
  );
}


/* =========================================================
  전체 화면
========================================================= */

function renderNightPatrolScreen() {
  const dateInput =
    document.getElementById(
      "patrolDate"
    );


  const statusSelect =
    document.getElementById(
      "patrolDocumentStatus"
    );


  if (
    dateInput
  ) {
    dateInput.value =
      nightPatrolState.date;
  }


  if (
    statusSelect
  ) {
    statusSelect.value =
      nightPatrolState
        .documentStatus;
  }


  [
    "patrolMember1",
    "patrolMember2",
    "patrolMember3"
  ].forEach(
    (
      elementId,
      memberIndex
    ) => {
      const input =
        document.getElementById(
          elementId
        );


      if (
        input
      ) {
        input.value =
          nightPatrolState
            .members[
              memberIndex
            ] ||
          "";
      }
    }
  );


  const noteInput =
    document.getElementById(
      "patrolGeneralNote"
    );


  if (
    noteInput
  ) {
    noteInput.value =
      nightPatrolState
        .generalNote ||
      "";
  }


  renderPatrolListButtons();

  renderPatrolTable();

  renderPatrolSummary();
}


/* =========================================================
  현재 목록 초기화
========================================================= */

function resetCurrentPatrolRecord() {
  const confirmed =
    window.confirm(
      [
        "현재 날짜와 순찰 목록의 입력 내용을 초기화할까요?",
        "",
        `${nightPatrolState.date} · 목록 ${nightPatrolState.listNumber}`
      ].join(
        "\n"
      )
    );


  if (
    !confirmed
  ) {
    return;
  }


  window.localStorage.removeItem(
    getPatrolStorageKey(
      nightPatrolState.date,
      nightPatrolState.listNumber
    )
  );


  loadNightPatrolRecord(
    nightPatrolState.date,
    nightPatrolState.listNumber
  );
}


/* =========================================================
  전체 양호
========================================================= */

function setAllPatrolEntriesGood() {
  nightPatrolState.entries =
    nightPatrolState
      .entries
      .map(
        entry => {
          return {
            ...entry,

            status:
              "양호"
          };
        }
      );


  renderPatrolTable();

  renderPatrolSummary();

  markPatrolDirty();
}


/* =========================================================
  날짜 변경
========================================================= */

function handlePatrolDateChange(
  event
) {
  const previousDate =
    nightPatrolState.date;


  const nextDate =
    String(
      event.target.value ||
      ""
    ).trim();


  if (
    !nextDate ||
    nextDate ===
      previousDate
  ) {
    return;
  }


  /*
    날짜 input이 먼저 변경된 상태이므로
    기존 날짜로 잠시 복원한 뒤 현재 입력값을 수집한다.
  */
  event.target.value =
    previousDate;


  collectPatrolScreenValues();


  if (
    createPatrolSnapshot() !==
      nightPatrolSavedSnapshot
  ) {
    const shouldChange =
      window.confirm(
        "저장되지 않은 내용이 있습니다. 날짜를 변경할까요?"
      );


    if (
      !shouldChange
    ) {
      event.target.value =
        previousDate;


      return;
    }
  }


  event.target.value =
    nextDate;


  loadNightPatrolRecord(
    nextDate,
    nightPatrolState.listNumber
  );
}


/* =========================================================
  순찰 목록 변경
========================================================= */

function handlePatrolListChange(
  listNumber
) {
  const nextListNumber =
    Math.min(
      4,

      Math.max(
        1,
        Number(
          listNumber
        ) ||
        1
      )
    );


  if (
    nextListNumber ===
    nightPatrolState
      .listNumber
  ) {
    return;
  }


  collectPatrolScreenValues();


  if (
    createPatrolSnapshot() !==
      nightPatrolSavedSnapshot
  ) {
    const shouldChange =
      window.confirm(
        "저장되지 않은 내용이 있습니다. 순찰 목록을 변경할까요?"
      );


    if (
      !shouldChange
    ) {
      return;
    }
  }


  loadNightPatrolRecord(
    nightPatrolState.date,
    nextListNumber
  );
}


/* =========================================================
  순찰 포인트 관리 목록 렌더링
========================================================= */

function renderPatrolPointManager() {
  const countElement =
    document.getElementById(
      "patrolPointCatalogCount"
    );


  const listElement =
    document.getElementById(
      "patrolPointCatalogList"
    );


  if (
    countElement
  ) {
    countElement.textContent =
      String(
        nightPatrolPointCatalog.length
      );
  }


  if (
    !listElement
  ) {
    return;
  }


  listElement.innerHTML =
    nightPatrolPointCatalog
      .map(
        (
          point,
          pointIndex
        ) => {
          return `
            <div
              class="patrol-point-catalog-item"
              data-patrol-catalog-id="${escapePatrolHtml(
                point.id
              )}"
            >
              <span class="patrol-point-catalog-number">
                ${pointIndex + 1}
              </span>

              <input
                type="text"
                data-patrol-catalog-name
                value="${escapePatrolHtml(
                  point.name
                )}"
                maxlength="160"
                aria-label="${pointIndex + 1}번 순찰 포인트명"
              />

              <button
                type="button"
                class="patrol-point-delete-button"
                data-delete-patrol-catalog-point
                aria-label="${pointIndex + 1}번 순찰 포인트 삭제"
              >
                삭제
              </button>
            </div>
          `;
        }
      )
      .join(
        ""
      );
}


/* =========================================================
  순찰 포인트 관리창 열기
========================================================= */

function openPatrolPointManager() {
  const modal =
    document.getElementById(
      "patrolPointManagerModal"
    );


  if (
    !modal
  ) {
    return;
  }


  renderPatrolPointManager();


  modal.classList.add(
    "is-open"
  );


  modal.setAttribute(
    "aria-hidden",
    "false"
  );


  document.body.classList.add(
    "patrol-point-manager-open"
  );


  window.setTimeout(
    () => {
      document
        .getElementById(
          "newPatrolPointName"
        )
        ?.focus();
    },
    0
  );
}


/* =========================================================
  순찰 포인트 관리창 닫기
========================================================= */

function closePatrolPointManager() {
  const modal =
    document.getElementById(
      "patrolPointManagerModal"
    );


  if (
    !modal
  ) {
    return;
  }


  modal.classList.remove(
    "is-open"
  );


  modal.setAttribute(
    "aria-hidden",
    "true"
  );


  document.body.classList.remove(
    "patrol-point-manager-open"
  );
}


/* =========================================================
  순찰 포인트 추가
========================================================= */

function addNightPatrolPoint() {
  const input =
    document.getElementById(
      "newPatrolPointName"
    );


  const pointName =
    String(
      input?.value ||
      ""
    ).trim();


  if (
    !pointName
  ) {
    window.alert(
      "추가할 순찰 포인트명을 입력해 주세요."
    );


    input?.focus();


    return;
  }


  nightPatrolPointCatalog.push({
    id:
      createNightPatrolPointId(),

    name:
      pointName
  });


  if (
    !saveNightPatrolPointCatalog()
  ) {
    nightPatrolPointCatalog.pop();


    return;
  }


  if (
    input
  ) {
    input.value =
      "";
  }


  renderPatrolPointManager();


  input?.focus();
}


/* =========================================================
  순찰 포인트명 수정
========================================================= */

function updateNightPatrolPointName(
  pointId,
  pointName
) {
  const targetPoint =
    nightPatrolPointCatalog.find(
      point => {
        return (
          point.id ===
          pointId
        );
      }
    );


  if (
    !targetPoint
  ) {
    return;
  }


  const normalizedName =
    String(
      pointName ||
      ""
    ).trim();


  if (
    !normalizedName
  ) {
    renderPatrolPointManager();


    return;
  }


  targetPoint.name =
    normalizedName;


  saveNightPatrolPointCatalog();
}


/* =========================================================
  순찰 포인트 삭제
========================================================= */

function deleteNightPatrolPoint(
  pointId
) {
  if (
    nightPatrolPointCatalog.length <=
      20
  ) {
    window.alert(
      "랜덤 배정을 위해 순찰 포인트는 최소 20개가 필요합니다."
    );


    return;
  }


  const targetPoint =
    nightPatrolPointCatalog.find(
      point => {
        return (
          point.id ===
          pointId
        );
      }
    );


  if (
    !targetPoint
  ) {
    return;
  }


  const confirmed =
    window.confirm(
      `다음 순찰 포인트를 삭제할까요?\n\n${targetPoint.name}`
    );


  if (
    !confirmed
  ) {
    return;
  }


  const previousCatalog =
    nightPatrolPointCatalog.map(
      point => {
        return {
          ...point
        };
      }
    );


  nightPatrolPointCatalog =
    nightPatrolPointCatalog.filter(
      point => {
        return (
          point.id !==
          pointId
        );
      }
    );


  if (
    !saveNightPatrolPointCatalog()
  ) {
    nightPatrolPointCatalog =
      previousCatalog;
  }


  renderPatrolPointManager();
}


/* =========================================================
  기본 순찰 포인트 복원
========================================================= */

function restoreDefaultNightPatrolPoints() {
  const confirmed =
    window.confirm(
      [
        "순찰 포인트 원본 목록을 기본 77개 항목으로 복원할까요?",
        "",
        "추가하거나 수정한 원본 포인트는 삭제됩니다.",
        "이미 저장된 일지의 항목명은 유지됩니다."
      ].join(
        "\n"
      )
    );


  if (
    !confirmed
  ) {
    return;
  }


  nightPatrolPointCatalog =
    createDefaultNightPatrolPointCatalog();


  saveNightPatrolPointCatalog();


  renderPatrolPointManager();
}


/* =========================================================
  현재 날짜·목록 다시 배정
========================================================= */

function reassignCurrentNightPatrolPoints() {
  collectPatrolScreenValues();


  const confirmed =
    window.confirm(
      [
        `${nightPatrolState.date} · 순찰 목록 ${nightPatrolState.listNumber}을 다시 배정할까요?`,
        "",
        "현재 20개 항목의 상태와 특이사항은 초기화됩니다.",
        "순찰자와 공통 비고는 유지됩니다."
      ].join(
        "\n"
      )
    );


  if (
    !confirmed
  ) {
    return;
  }


  nightPatrolState.entries =
    createPatrolPoints(
      nightPatrolState.date,
      nightPatrolState.listNumber
    );


  nightPatrolState.documentStatus =
    "작성중";


  nightPatrolState.completedAt =
    "";


  renderNightPatrolScreen();


  markPatrolDirty();


  closePatrolPointManager();
}


/* =========================================================
  인쇄 날짜 표시

  입력:
  2026-08-03

  출력:
  2026-08-03
========================================================= */

function formatPatrolPrintDate(
  value
) {
  const normalizedValue =
    String(
      value ||
      ""
    ).trim();


  return normalizedValue ||
    "-";
}


/* =========================================================
  인쇄용 순찰자 표시
========================================================= */

function createPatrolPrintMembersHtml() {
  const members =
    Array.isArray(
      nightPatrolState.members
    )
      ? nightPatrolState.members
      : [];


  return [
    members[0],
    members[1],
    members[2]
  ]
    .map(
      member => {
        return escapePatrolHtml(
          String(
            member ||
            ""
          ).trim() ||
          "-"
        );
      }
    )
    .join(
      "<br />"
    );
}


/* =========================================================
  원본 엑셀 양식형 A4 인쇄 HTML 생성

  원본 PDF 기준:
  - A4 세로 1페이지
  - 제목 + 파트장/팀장 결재란
  - 설비운영팀 + 점검일자
  - 시간 / 순찰자 / 순찰 구역 / 상태 / 특이사항
  - 시간대별 5개 항목, 총 20개
  - 하단 비고
========================================================= */

function createPatrolPrintSheetHtml() {
  const entries =
    Array.isArray(
      nightPatrolState.entries
    )
      ? nightPatrolState.entries
      : [];


  const membersHtml =
    createPatrolPrintMembersHtml();


  const rowsHtml = [];


  for (
    let groupIndex = 0;
    groupIndex <
      NIGHT_PATROL_TIMES.length;
    groupIndex += 1
  ) {
    const startIndex =
      groupIndex *
      5;


    const groupEntries =
      entries.slice(
        startIndex,
        startIndex + 5
      );


    while (
      groupEntries.length <
      5
    ) {
      groupEntries.push({
        time:
          NIGHT_PATROL_TIMES[
            groupIndex
          ],

        pointName:
          "",

        status:
          "",

        note:
          ""
      });
    }


    groupEntries.forEach(
      (
        entry,
        entryIndex
      ) => {
        const timeAndMemberCells =
          entryIndex === 0
            ? `
              <td
                class="patrol-print-time"
                rowspan="5"
              >
                ${escapePatrolHtml(
                  NIGHT_PATROL_TIMES[
                    groupIndex
                  ]
                )}
              </td>

              <td
                class="patrol-print-members"
                rowspan="5"
              >
                ${membersHtml}
              </td>
            `
            : "";


        rowsHtml.push(`
          <tr class="patrol-print-inspection-row">
            ${timeAndMemberCells}

            <td class="patrol-print-point">
              ${escapePatrolHtml(
                entry?.pointName ||
                ""
              )}
            </td>

            <td class="patrol-print-status">
              ${escapePatrolHtml(
                entry?.status ||
                ""
              )}
            </td>

            <td class="patrol-print-note">
              ${escapePatrolHtml(
                entry?.note ||
                ""
              )}
            </td>
          </tr>
        `);
      }
    );
  }


  const generalNote =
    String(
      nightPatrolState.generalNote ||
      ""
    )
      .replace(
        /\r\n/g,
        "\n"
      )
      .replace(
        /\r/g,
        "\n"
      )
      .trim();


  return `
    <article class="patrol-print-sheet">

      <table class="patrol-print-document">

        <colgroup>
          <col class="patrol-print-col-time" />
          <col class="patrol-print-col-member" />
          <col class="patrol-print-col-point" />
          <col class="patrol-print-col-status" />
          <col class="patrol-print-col-note" />
        </colgroup>

        <tbody>

          <tr class="patrol-print-title-row">
            <th
              class="patrol-print-title"
              colspan="3"
              rowspan="2"
            >
              야간 순찰 점검일지
            </th>

            <th class="patrol-print-approval-title">
              파 트 장
            </th>

            <th class="patrol-print-approval-title">
              팀 장
            </th>
          </tr>

          <tr class="patrol-print-approval-row">
            <td class="patrol-print-approval-box"></td>
            <td class="patrol-print-approval-box"></td>
          </tr>

          <tr class="patrol-print-meta-row">
            <th
              class="patrol-print-department"
              colspan="3"
            >
              설비운영팀
            </th>

            <th
              class="patrol-print-date"
              colspan="2"
            >
              점검일자 : ${escapePatrolHtml(
                formatPatrolPrintDate(
                  nightPatrolState.date
                )
              )}
            </th>
          </tr>

          <tr class="patrol-print-header-row">
            <th>시 간</th>
            <th>순찰자</th>
            <th>순찰 구역</th>
            <th>상 태</th>
            <th>특이 사항</th>
          </tr>

          ${rowsHtml.join("")}

          <tr class="patrol-print-remark-row">
            <td colspan="5">
              <strong>비고</strong>

              <div>${escapePatrolHtml(
                generalNote
              ).replaceAll(
                "\n",
                "<br />"
              )}</div>
            </td>
          </tr>

        </tbody>

      </table>

    </article>
  `;
}


/* =========================================================
  인쇄 미리보기 열기
========================================================= */

function openPatrolPrintPreview() {
  collectPatrolScreenValues();


  const modal =
    document.getElementById(
      "patrolPrintPreviewModal"
    );


  const sheetHost =
    document.getElementById(
      "patrolPrintSheetHost"
    );


  if (
    !modal ||
    !sheetHost
  ) {
    window.alert(
      "인쇄 미리보기 화면을 찾을 수 없습니다."
    );


    return;
  }


  sheetHost.innerHTML =
    createPatrolPrintSheetHtml();


  modal.classList.add(
    "is-open"
  );


  modal.setAttribute(
    "aria-hidden",
    "false"
  );


  document.body.classList.add(
    "patrol-print-preview-open"
  );


  window.setTimeout(
    () => {
      document
        .getElementById(
          "confirmPatrolPrintButton"
        )
        ?.focus();
    },
    0
  );
}


/* =========================================================
  인쇄 미리보기 닫기
========================================================= */

function closePatrolPrintPreview() {
  const modal =
    document.getElementById(
      "patrolPrintPreviewModal"
    );


  if (
    !modal
  ) {
    return;
  }


  modal.classList.remove(
    "is-open"
  );


  modal.setAttribute(
    "aria-hidden",
    "true"
  );


  document.body.classList.remove(
    "patrol-print-preview-open"
  );
}


/* =========================================================
  실제 인쇄

  미리보기 화면의 A4 양식만 인쇄한다.
========================================================= */

function printNightPatrolDocument() {
  collectPatrolScreenValues();


  const sheetHost =
    document.getElementById(
      "patrolPrintSheetHost"
    );


  if (
    sheetHost
  ) {
    sheetHost.innerHTML =
      createPatrolPrintSheetHtml();
  }


  window.requestAnimationFrame(
    () => {
      window.print();
    }
  );
}


/* =========================================================
  닫기
========================================================= */

function requestCloseNightPatrol() {
  collectPatrolScreenValues();


  if (
    createPatrolSnapshot() !==
      nightPatrolSavedSnapshot
  ) {
    const shouldClose =
      window.confirm(
        "저장되지 않은 내용이 있습니다. 창을 닫을까요?"
      );


    if (
      !shouldClose
    ) {
      return;
    }
  }


  window.parent.postMessage(
    {
      type:
        "gs-night-patrol:close"
    },

    window.location.origin
  );
}


/* =========================================================
  이벤트
========================================================= */

function bindNightPatrolEvents() {
  document
    .getElementById(
      "patrolDate"
    )
    ?.addEventListener(
      "change",
      handlePatrolDateChange
    );


  document
    .getElementById(
      "patrolListButtons"
    )
    ?.addEventListener(
      "click",
      event => {
        const button =
          event.target.closest(
            "[data-list-number]"
          );


        if (
          !button
        ) {
          return;
        }


        handlePatrolListChange(
          button.dataset
            .listNumber
        );
      }
    );


  document
    .getElementById(
      "patrolTableBody"
    )
    ?.addEventListener(
      "change",
      event => {
        const row =
          event.target.closest(
            "[data-patrol-entry-index]"
          );


        if (
          !row
        ) {
          return;
        }


        collectPatrolScreenValues();

        renderPatrolTable();

        renderPatrolSummary();

        markPatrolDirty();
      }
    );


  document
    .getElementById(
      "patrolTableBody"
    )
    ?.addEventListener(
      "input",
      () => {
        collectPatrolScreenValues();

        renderPatrolSummary();

        markPatrolDirty();
      }
    );


  [
    "patrolMember1",
    "patrolMember2",
    "patrolMember3",
    "patrolGeneralNote"
  ].forEach(
    elementId => {
      document
        .getElementById(
          elementId
        )
        ?.addEventListener(
          "input",
          () => {
            collectPatrolScreenValues();

            markPatrolDirty();
          }
        );
    }
  );


  document
    .getElementById(
      "patrolDocumentStatus"
    )
    ?.addEventListener(
      "change",
      () => {
        collectPatrolScreenValues();

        markPatrolDirty();
      }
    );


  document
    .getElementById(
      "setAllGoodButton"
    )
    ?.addEventListener(
      "click",
      setAllPatrolEntriesGood
    );


  document
    .getElementById(
      "resetPatrolButton"
    )
    ?.addEventListener(
      "click",
      resetCurrentPatrolRecord
    );


  document
    .getElementById(
      "openPatrolPointManagerButton"
    )
    ?.addEventListener(
      "click",
      openPatrolPointManager
    );


  document
    .getElementById(
      "closePatrolPointManagerButton"
    )
    ?.addEventListener(
      "click",
      closePatrolPointManager
    );


  document
    .getElementById(
      "closePatrolPointManagerFooterButton"
    )
    ?.addEventListener(
      "click",
      closePatrolPointManager
    );


  document
    .getElementById(
      "addPatrolPointButton"
    )
    ?.addEventListener(
      "click",
      addNightPatrolPoint
    );


  document
    .getElementById(
      "newPatrolPointName"
    )
    ?.addEventListener(
      "keydown",
      event => {
        if (
          event.key !==
            "Enter"
        ) {
          return;
        }


        event.preventDefault();


        addNightPatrolPoint();
      }
    );


  document
    .getElementById(
      "patrolPointCatalogList"
    )
    ?.addEventListener(
      "change",
      event => {
        const input =
          event.target.closest(
            "[data-patrol-catalog-name]"
          );


        if (
          !input
        ) {
          return;
        }


        const item =
          input.closest(
            "[data-patrol-catalog-id]"
          );


        updateNightPatrolPointName(
          String(
            item?.dataset
              ?.patrolCatalogId ||
            ""
          ),
          input.value
        );
      }
    );


  document
    .getElementById(
      "patrolPointCatalogList"
    )
    ?.addEventListener(
      "click",
      event => {
        const deleteButton =
          event.target.closest(
            "[data-delete-patrol-catalog-point]"
          );


        if (
          !deleteButton
        ) {
          return;
        }


        const item =
          deleteButton.closest(
            "[data-patrol-catalog-id]"
          );


        deleteNightPatrolPoint(
          String(
            item?.dataset
              ?.patrolCatalogId ||
            ""
          )
        );
      }
    );


  document
    .getElementById(
      "restoreDefaultPatrolPointsButton"
    )
    ?.addEventListener(
      "click",
      restoreDefaultNightPatrolPoints
    );


  document
    .getElementById(
      "reassignCurrentPatrolPointsButton"
    )
    ?.addEventListener(
      "click",
      reassignCurrentNightPatrolPoints
    );


  document
    .getElementById(
      "printPatrolButton"
    )
    ?.addEventListener(
      "click",
      openPatrolPrintPreview
    );


  document
    .getElementById(
      "closePatrolPrintPreviewButton"
    )
    ?.addEventListener(
      "click",
      closePatrolPrintPreview
    );


  document
    .getElementById(
      "closePatrolPrintPreviewFooterButton"
    )
    ?.addEventListener(
      "click",
      closePatrolPrintPreview
    );


  document
    .getElementById(
      "confirmPatrolPrintButton"
    )
    ?.addEventListener(
      "click",
      printNightPatrolDocument
    );


  document
    .getElementById(
      "closePatrolPageButton"
    )
    ?.addEventListener(
      "click",
      requestCloseNightPatrol
    );


  document
    .getElementById(
      "savePatrolButton"
    )
    ?.addEventListener(
      "click",
      () => {
        saveNightPatrolRecord();
      }
    );


  document
    .getElementById(
      "patrolPrintPreviewModal"
    )
    ?.addEventListener(
      "click",
      event => {
        if (
          event.target ===
          event.currentTarget
        ) {
          closePatrolPrintPreview();
        }
      }
    );


  document
    .getElementById(
      "patrolPointManagerModal"
    )
    ?.addEventListener(
      "click",
      event => {
        if (
          event.target ===
          event.currentTarget
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    );


  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key !==
        "Escape"
      ) {
        return;
      }


      const pointManagerModal =
        document.getElementById(
          "patrolPointManagerModal"
        );


      if (
        pointManagerModal?.classList.contains(
          "is-open"
        )
      ) {
        event.preventDefault();
        event.stopPropagation();


        closePatrolPointManager();


        return;
      }


      const previewModal =
        document.getElementById(
          "patrolPrintPreviewModal"
        );


      if (
        !previewModal?.classList.contains(
          "is-open"
        )
      ) {
        return;
      }


      event.preventDefault();
      event.stopPropagation();


      closePatrolPrintPreview();
    },
    true
  );


  window.addEventListener(
    "beforeunload",
    event => {
      collectPatrolScreenValues();


      if (
        createPatrolSnapshot() ===
          nightPatrolSavedSnapshot
      ) {
        return;
      }


      event.preventDefault();

      event.returnValue =
        "";
    }
  );
}


/* =========================================================
  초기 실행
========================================================= */

function initializeNightPatrolPage() {
  if (
    !canCurrentUserAccessNightPatrolPage()
  ) {
    renderNightPatrolAccessDenied();

    return;
  }


  nightPatrolPointCatalog =
    loadNightPatrolPointCatalog();


  bindNightPatrolEvents();


  loadNightPatrolRecord(
    getTodayInputValue(),
    1
  );
}


document.addEventListener(
  "DOMContentLoaded",
  initializeNightPatrolPage
);
