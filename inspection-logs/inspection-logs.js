"use strict";

/* =========================================================
  설비점검 일정 기준표

  기준:
  설비운영팀 설비점검 및
  회전기기 교체운전 List 및 주기

  구분:
  - daily
  - weekly
  - monthly
  - quarterly
  - other
========================================================= */

const INSPECTION_SCHEDULE_MASTER = [

  /* =====================================================
    일간
  ====================================================== */

  {
    id:
      "daily-shift-log",

    category:
      "daily",

    title:
      "교대근무 업무일지",

    scheduleLabel:
      "매일",

    shifts: [
      "D/S",
      "N/S"
    ],

    position:
      "CCR/Local",

    approval:
      "파트장",

    share:
      "앱 공유",

    note:
      "모바일 일지",

    rule: {
      type:
        "daily"
    }
  },


  {
    id:
      "daily-night-patrol",

    category:
      "daily",

    title:
      "야간 순찰 점검 일지",

    scheduleLabel:
      "매일",

    shifts: [
      "N/S"
    ],

    position:
      "Local",

    approval:
      "팀장",

    share:
      "-",

    note:
      "",

    logKey:
      "night-patrol",

    rule: {
      type:
        "daily"
    }
  },


  {
    id:
      "daily-freeze-prevention",

    category:
      "daily",

    title:
      "동파방지 점검일지(동결, 동파 취약개소)",

    scheduleLabel:
      "매일 · 조건부",

    shifts: [
      "N/S"
    ],

    position:
      "Local",

    approval:
      "팀장",

    share:
      "-",

    note:
      "최저온도 -3도 이하 시",

    conditional:
      true,

    rule: {
      type:
        "daily"
    }
  },


  {
    id:
      "daily-fbhe-vbelt",

    category:
      "daily",

    title:
      "FBHE, Seal Pot Blower V-Belt 상태 점검",

    scheduleLabel:
      "매일",

    shifts: [
      "N/S"
    ],

    position:
      "Local",

    approval:
      "-",

    share:
      "-",

    note:
      "현장 V-Belt 교체 현황판 관리",

    rule: {
      type:
        "daily"
    }
  },


  {
    id:
      "daily-suction-filter",

    category:
      "daily",

    title:
      "회전기기 Suction Filter 상태 점검",

    scheduleLabel:
      "매일",

    shifts: [
      "N/S"
    ],

    position:
      "Local",

    approval:
      "-",

    share:
      "-",

    note:
      "",

    rule: {
      type:
        "daily"
    }
  },


  {
    id:
      "daily-pump-strainer-dp",

    category:
      "daily",

    title:
      "6.9kV Pump Suction Strainer DP 점검",

    scheduleLabel:
      "매일",

    shifts: [
      "N/S"
    ],

    position:
      "CCR/Local",

    approval:
      "-",

    share:
      "-",

    note:
      "BFP, MCWP, ACWP, COP, CCWP",

    rule: {
      type:
        "daily"
    }
  },


  {
    id:
      "daily-silo-co",

    category:
      "daily",

    title:
      "Day Silo(Bio, Coal) CO 수치 점검 (CO₂ Tank Level 점검)",

    scheduleLabel:
      "매일",

    shifts: [
      "N/S"
    ],

    position:
      "Local",

    approval:
      "-",

    share:
      "-",

    note:
      "",

    rule: {
      type:
        "daily"
    }
  },


  {
    id:
      "daily-air-pollution-dp",

    category:
      "daily",

    title:
      "대기오염방지시설 DP 점검 및 운전정보시스템 입력",

    scheduleLabel:
      "매일",

    shifts: [
      "N/S"
    ],

    position:
      "Local",

    approval:
      "-",

    share:
      "-",

    note:
      "",

    rule: {
      type:
        "daily"
    }
  },


  {
    id:
      "daily-bio-hopper",

    category:
      "daily",

    title:
      "Bio Hopper Bin 내부 점검 및 청소",

    scheduleLabel:
      "매일",

    shifts: [
      "N/S"
    ],

    position:
      "Local",

    approval:
      "-",

    share:
      "-",

    note:
      "",

    rule: {
      type:
        "daily"
    }
  },


  {
    id:
      "daily-bed-ash-discharge",

    category:
      "daily",

    title:
      "주보일러 연소실 Bed Ash 배출(4회/일)",

    scheduleLabel:
      "매일",

    shifts: [
      "D/S",
      "N/S"
    ],

    position:
      "Local",

    approval:
      "-",

    share:
      "-",

    note:
      "배출량 2톤/회·호기, 필요 시 추가",

    rule: {
      type:
        "daily"
    }
  },


  {
    id:
      "daily-boiler-air-comp",

    category:
      "daily",

    title:
      "Boiler Air Comp. #B&C 무부하 30분 운전",

    scheduleLabel:
      "매일",

    shifts: [
      "N/S"
    ],

    position:
      "Local",

    approval:
      "-",

    share:
      "-",

    note:
      "",

    rule: {
      type:
        "daily"
    }
  },


  {
    id:
      "daily-high-pressure-safety",

    category:
      "daily",

    title:
      "고압가스(CO2) 일일 안전점검",

    scheduleLabel:
      "매일(주중)",

    shifts:
      [],

    position:
      "안전팀/최부식",

    approval:
      "안전팀장",

    share:
      "-",

    note:
      "관리원: 안전팀 소방담당자",

    referenceOnly:
      true,

    rule: {
      type:
        "weekdays",

      days: [
        1,
        2,
        3,
        4,
        5
      ]
    }
  },


  /* =====================================================
    주간
  ====================================================== */

  {
    id:
      "weekly-lng-system",

    category:
      "weekly",

    title:
      "LNG System 점검",

    scheduleLabel:
      "매주 일요일",

    shifts: [
      "D/S"
    ],

    position:
      "Local",

    approval:
      "팀장",

    share:
      "TM회의",

    note:
      "검침기 이용",

    logKey:
      "lng-weekly",

    titleKeyword:
      "LNG",

    rule: {
      type:
        "weekly",

      days: [
        0
      ]
    }
  },

  /* =====================================================
    고압가스 저장시설 주간점검
  ====================================================== */

  {
    id:
      "weekly-high-pressure-gas",

    category:
      "weekly",

    title:
      "고압가스 저장시설 주간점검",

    scheduleLabel:
      "매주 일요일",

    shifts: [
      "D/S"
    ],

    position:
      "Local",

    approval:
      "안전관리 책임자 · 안전관리 총괄자",

    share:
      "-",

    note:
      "CO2 고압가스 저장시설 점검",

    /*
      점검일지 허브 카드와 연결되는 값
    */
    logKey:
      "high-pressure-gas",

    titleKeyword:
      "고압가스",

    rule: {
      type:
        "weekly",

      days: [
        0
      ]
    }
  },

  {
    id:
      "weekly-soot-blower",

    category:
      "weekly",

    title:
      "보일러 Soot Blower 점검",

    scheduleLabel:
      "매주 일요일",

    shifts: [
      "N/S"
    ],

    position:
      "Local",

    approval:
      "파트장",

    share:
      "TM회의",

    /*
      업로드한 일정표는 일요일 N/S로 되어 있지만
      현재 전용 Soot Blower 양식에는
      월요일 N/S로 표시되어 있으므로 추후 통일한다.
    */
    note:
      "PDF 일정표: 일요일 N/S · 전용 양식 일정과 확인 필요",

    logKey:
      "soot-blower-weekly",

    titleKeyword:
      "Soot Blower",

    rule: {
      type:
        "weekly",

      days: [
        0
      ]
    }
  },


  {
    id:
      "weekly-aux-air-comp",

    category:
      "weekly",

    title:
      "Aux BLR Air-Comp 기동 Test 및 회전기기 Hand Turning",

    scheduleLabel:
      "매주 토요일",

    shifts: [
      "D/S"
    ],

    position:
      "Local",

    approval:
      "-",

    share:
      "-",

    note:
      "",

    rule: {
      type:
        "weekly",

      days: [
        6
      ]
    }
  },


  {
    id:
      "weekly-bed-ash-screen",

    category:
      "weekly",

    title:
      "Bed Ash Vibrating Screen 청소",

    scheduleLabel:
      "매주 화·금요일",

    shifts: [
      "N/S"
    ],

    position:
      "Local",

    approval:
      "-",

    share:
      "-",

    note:
      "막힘 상태에 따라 수시 실시",

    rule: {
      type:
        "weekly",

      days: [
        2,
        5
      ]
    }
  },


  {
    id:
      "weekly-lime-slurry-flushing",

    category:
      "weekly",

    title:
      "Lime Slurry Density Meter Flushing 및 Lime Slurry Feed Tank 상부 Screen 이물질 청소",

    scheduleLabel:
      "매주 목요일",

    shifts: [
      "D/S"
    ],

    position:
      "Local",

    approval:
      "-",

    share:
      "-",

    note:
      "",

    rule: {
      type:
        "weekly",

      days: [
        4
      ]
    }
  },


  {
    id:
      "weekly-bed-ash-be",

    category:
      "weekly",

    title:
      "Bed Ash Bucket Elevator 하부 점검(청소)",

    scheduleLabel:
      "매주 월요일",

    shifts: [
      "N/S"
    ],

    position:
      "Local",

    approval:
      "-",

    share:
      "-",

    note:
      "BE601: 설비상태에 따라 매일",

    rule: {
      type:
        "weekly",

      days: [
        1
      ]
    }
  },


  {
    id:
      "weekly-bag-filter-offline",

    category:
      "weekly",

    title:
      "Bag Filter Off-Line Mode 진행",

    scheduleLabel:
      "매주 화요일",

    shifts: [
      "D/S"
    ],

    position:
      "CCR",

    approval:
      "-",

    share:
      "-",

    note:
      "",

    rule: {
      type:
        "weekly",

      days: [
        2
      ]
    }
  },


  {
    id:
      "weekly-fly-ash-sampling",

    category:
      "weekly",

    title:
      "Fly Ash Sampling",

    scheduleLabel:
      "매주 월요일 N/S",

    shifts: [
      "N/S"
    ],

    position:
      "Local",

    approval:
      "-",

    share:
      "-",

    note:
      "화요일 02시경 Sampling 실시",

    rule: {
      type:
        "weekly",

      days: [
        1
      ]
    }
  },


  {
    id:
      "weekly-sda-hopper-ash",

    category:
      "weekly",

    title:
      "SDA Hopper Ash 배출(톤백 2개/회·호기)",

    scheduleLabel:
      "매주 화·금요일",

    shifts: [
      "D/S"
    ],

    position:
      "Local",

    approval:
      "-",

    share:
      "-",

    note:
      "2026년부터 2·8·11월 4주차 화·수, 5월 OH 시 수시",

    rule: {
      type:
        "weekly",

      days: [
        2,
        5
      ]
    }
  },


  {
    id:
      "weekly-sda-return-line",

    category:
      "weekly",

    title:
      "SDA Lime Slurry Return Line 점검",

    scheduleLabel:
      "매주 월·목요일",

    shifts: [
      "D/S"
    ],

    position:
      "Local",

    approval:
      "-",

    share:
      "팀 카톡방",

    note:
      "",

    rule: {
      type:
        "weekly",

      days: [
        1,
        4
      ]
    }
  },


  {
    id:
      "weekly-silo-vent-velocity",

    category:
      "weekly",

    title:
      "1,2호기 유기성고형연료 Silo Vent Line Duct 유속 측정",

    scheduleLabel:
      "매주 일요일",

    shifts: [
      "D/S"
    ],

    position:
      "Local",

    approval:
      "-",

    share:
      "TM회의",

    note:
      "",

    rule: {
      type:
        "weekly",

      days: [
        0
      ]
    }
  },


  {
    id:
      "weekly-cooling-tower-damper",

    category:
      "weekly",

    title:
      "냉각탑 Damper 작동 Test",

    scheduleLabel:
      "매주 일요일",

    shifts: [
      "D/S"
    ],

    position:
      "CCR/Local",

    approval:
      "-",

    share:
      "-",

    note:
      "동절기는 상황에 따라 시행",

    rule: {
      type:
        "weekly",

      days: [
        0
      ]
    }
  },


  /* =====================================================
    월간
  ====================================================== */

  {
    id:
      "monthly-extinguisher",

    category:
      "monthly",

    title:
      "소화기 점검",

    scheduleLabel:
      "매월 4일",

    shifts: [
      "N/S"
    ],

    position:
      "Local 전원",

    approval:
      "팀장",

    share:
      "TM회의",

    note:
      "",

    rule: {
      type:
        "monthlyDate",

      day:
        4
    }
  },


  {
    id:
      "monthly-emergency-generator",

    category:
      "monthly",

    title:
      "비상발전기 기동 점검",

    scheduleLabel:
      "셋째 주 일요일",

    shifts: [
      "D/S"
    ],

    position:
      "Local",

    approval:
      "팀장",

    share:
      "TM회의",

    note:
      "",

    rule: {
      type:
        "monthlyWeek",

      weeks: [
        3
      ],

      days: [
        0
      ]
    }
  },


  {
    id:
      "monthly-main-boiler-rotation",

    category:
      "monthly",

    title:
      "주보일러 회전기기 교체 점검",

    scheduleLabel:
      "셋째 주 일요일",

    shifts: [
      "D/S"
    ],

    position:
      "CCR/Local",

    approval:
      "팀장",

    share:
      "TM회의",

    note:
      "",

    rule: {
      type:
        "monthlyWeek",

      weeks: [
        3
      ],

      days: [
        0
      ]
    }
  },


  {
    id:
      "monthly-turbine-oil-gsc",

    category:
      "monthly",

    title:
      "터빈/발전기 Oil&GSC계통 회전기기 교체운전 점검",

    scheduleLabel:
      "짝수월 넷째 주 일요일",

    shifts: [
      "D/S"
    ],

    position:
      "CCR/Local",

    approval:
      "팀장",

    share:
      "TM회의",

    note:
      "",

    rule: {
      type:
        "monthlyWeek",

      months: [
        2,
        4,
        6,
        8,
        10,
        12
      ],

      weeks: [
        4
      ],

      days: [
        0
      ]
    }
  },


  {
    id:
      "monthly-turbine-bop",

    category:
      "monthly",

    title:
      "터빈/발전기 BOP계통, 보조보일러, HVAC 및 급탕 Sys. 회전기기 교체운전 점검",

    scheduleLabel:
      "넷째 주 일요일",

    shifts: [
      "D/S"
    ],

    position:
      "CCR/Local",

    approval:
      "팀장",

    share:
      "TM회의",

    note:
      "",

    rule: {
      type:
        "monthlyWeek",

      weeks: [
        4
      ],

      days: [
        0
      ]
    }
  },


  {
    id:
      "monthly-sda-atomizer-hours",

    category:
      "monthly",

    title:
      "SDA Atomizer 가동 시간(Wheel 교체주기) 점검",

    scheduleLabel:
      "매월 둘째·넷째 주 금요일",

    shifts: [
      "N/S"
    ],

    position:
      "CCR",

    approval:
      "-",

    share:
      "-",

    note:
      "",

    rule: {
      type:
        "monthlyWeek",

      weeks: [
        2,
        4
      ],

      days: [
        5
      ]
    }
  },


  {
    id:
      "monthly-atomizer-wheel",

    category:
      "monthly",

    title:
      "Atomizer Wheel 점검 및 Support Cone 부위 Cleaning TM발행",

    scheduleLabel:
      "둘째 주 월요일",

    shifts: [
      "D/S"
    ],

    position:
      "CCR",

    approval:
      "-",

    share:
      "-",

    note:
      "매월 Local 운전원은 TM 작업 전후 사진 촬영 공유 및 기록관리",

    rule: {
      type:
        "monthlyWeek",

      weeks: [
        2
      ],

      days: [
        1
      ]
    }
  },


  {
    id:
      "monthly-silo-vent-filter",

    category:
      "monthly",

    title:
      "Fly Ash Silo, Lime Silo 상부 Vent Filter/Fan 점검",

    scheduleLabel:
      "매월 둘째·넷째 주 금요일",

    shifts: [
      "D/S"
    ],

    position:
      "Local",

    approval:
      "-",

    share:
      "-",

    note:
      "",

    rule: {
      type:
        "monthlyWeek",

      weeks: [
        2,
        4
      ],

      days: [
        5
      ]
    }
  },


  {
    id:
      "monthly-steam-unit-heater",

    category:
      "monthly",

    title:
      "Steam Unit Heater(보일러, 터빈 etc) 점검",

    scheduleLabel:
      "넷째 주 일요일 · 동절기",

    shifts: [
      "N/S"
    ],

    position:
      "Local",

    approval:
      "-",

    share:
      "-",

    note:
      "동절기 Unit Heater 운전 시",

    conditional:
      true,

    rule: {
      type:
        "monthlyWeek",

      months: [
        12,
        1,
        2,
        3
      ],

      weeks: [
        4
      ],

      days: [
        0
      ]
    }
  },


  {
    id:
      "monthly-service-air-drain",

    category:
      "monthly",

    title:
      "동절기 Service Air Line 응축수 Drain",

    scheduleLabel:
      "매월 첫째·셋째 주 토요일 · 12~3월",

    shifts: [
      "D/S"
    ],

    position:
      "Local",

    approval:
      "-",

    share:
      "-",

    note:
      "동절기(12~3월)",

    rule: {
      type:
        "monthlyWeek",

      months: [
        12,
        1,
        2,
        3
      ],

      weeks: [
        1,
        3
      ],

      days: [
        6
      ]
    }
  },


  /* =====================================================
    분기
  ====================================================== */

  {
    id:
      "quarterly-co2-release",

    category:
      "quarterly",

    title:
      "CO2 구역별 방출 Test",

    scheduleLabel:
      "3·6·9·12월 셋째 주 수요일",

    shifts: [
      "D/S"
    ],

    position:
      "Local",

    approval:
      "팀장",

    share:
      "-",

    note:
      "안전관리자 입회",

    rule: {
      type:
        "monthlyWeek",

      months: [
        3,
        6,
        9,
        12
      ],

      weeks: [
        3
      ],

      days: [
        3
      ]
    }
  },


  /* =====================================================
    기타
  ====================================================== */

  {
    id:
      "other-job-training",

    category:
      "other",

    title:
      "직무교육",

    scheduleLabel:
      "매월",

    shifts: [
      "N/S"
    ],

    position:
      "CCR/Local",

    approval:
      "팀장",

    share:
      "-",

    note:
      "정확한 시행일은 별도 지정",

    rule: {
      type:
        "monthlyFloating"
    }
  },


  {
    id:
      "other-emergency-drill",

    category:
      "other",

    title:
      "비상모의훈련",

    scheduleLabel:
      "매월",

    shifts: [
      "N/S"
    ],

    position:
      "CCR/Local",

    approval:
      "팀장",

    share:
      "-",

    note:
      "분기별 통합모의훈련",

    rule: {
      type:
        "monthlyFloating"
    }
  },


  {
    id:
      "other-bio-storage-silo",

    category:
      "other",

    title:
      "Bio Storage silo 내부 육안 점검",

    scheduleLabel:
      "매월 셋째 주 금요일",

    shifts: [
      "D/S"
    ],

    position:
      "효율파트",

    approval:
      "-",

    share:
      "-",

    note:
      "상부 Manhole Open 점검",

    rule: {
      type:
        "monthlyWeek",

      weeks: [
        3
      ],

      days: [
        5
      ]
    }
  },


  {
    id:
      "other-field-equipment",

    category:
      "other",

    title:
      "현장 설비 점검",

    scheduleLabel:
      "수시",

    shifts:
      [],

    position:
      "효율파트",

    approval:
      "-",

    share:
      "-",

    note:
      "",

    rule: {
      type:
        "adHoc"
    }
  }
];

/* =========================================================
  점검 일정 관리자 변경사항 D1 연동

  기본 일정:
  - INSPECTION_SCHEDULE_MASTER

  관리자 변경:
  - GET /api/inspection-schedules

  병합 규칙:
  - 같은 ID의 활성 변경사항 → 기본 일정 교체
  - 같은 ID의 사용 중지 → 일정 목록에서 제거
  - 사용자 추가 일정 → 목록 마지막에 추가
  - API 오류 → 기본 일정으로 계속 실행
========================================================= */

const INSPECTION_SCHEDULE_API_URL =
  "/api/inspection-schedules";


/*
  관리자 변경사항을 적용하기 전
  최초 기본 일정표를 별도로 보관한다.

  INSPECTION_SCHEDULE_MASTER 배열은
  이후 병합 결과로 직접 갱신한다.
*/
const DEFAULT_INSPECTION_SCHEDULE_MASTER =
  INSPECTION_SCHEDULE_MASTER.map(
    scheduleItem => {
      return JSON.parse(
        JSON.stringify(
          scheduleItem
        )
      );
    }
  );


const inspectionScheduleOverrideState = {
  loaded:
    false,

  loading:
    false,

  canManage:
    false,

  overrides:
    [],

  errorMessage:
    ""
};


/* =========================================================
  점검 일정 로그인 세션
========================================================= */

function getInspectionScheduleSessionToken() {
  try {
    const savedUser =
      window.localStorage.getItem(
        "gsShiftLog.currentUser"
      );


    if (
      !savedUser
    ) {
      return "";
    }


    const parsedUser =
      JSON.parse(
        savedUser
      );


    return String(
      parsedUser?.sessionToken ||
      parsedUser?.session_token ||
      ""
    ).trim();

  } catch (
    error
  ) {
    console.warn(
      "점검 일정 로그인 정보를 읽지 못했습니다.",
      error
    );


    return "";
  }
}


/* =========================================================
  점검 일정 API 인증 헤더
========================================================= */

function getInspectionScheduleAuthHeaders(
  extraHeaders = {}
) {
  const sessionToken =
    getInspectionScheduleSessionToken();


  return {
    Accept:
      "application/json",

    ...extraHeaders,

    ...(
      sessionToken
        ? {
            Authorization:
              `Bearer ${sessionToken}`
          }
        : {}
    )
  };
}


/* =========================================================
  점검 일정 API 응답 읽기
========================================================= */

async function readInspectionScheduleApiResponse(
  response
) {
  const responseText =
    await response.text();


  let result = {};


  if (
    responseText.trim()
  ) {
    try {
      result =
        JSON.parse(
          responseText
        );

    } catch {
      throw new Error(
        "점검 일정 서버 응답 형식이 올바르지 않습니다."
      );
    }
  }


  if (
    !response.ok ||
    result.ok ===
      false
  ) {
    throw new Error(
      result.message ||
      result.error ||
      `점검 일정 요청에 실패했습니다. (HTTP ${response.status})`
    );
  }


  return result;
}


/* =========================================================
  일정 객체 복사
========================================================= */

function cloneInspectionScheduleItem(
  scheduleItem
) {
  if (
    !scheduleItem ||
    typeof scheduleItem !==
      "object" ||
    Array.isArray(
      scheduleItem
    )
  ) {
    return null;
  }


  try {
    return JSON.parse(
      JSON.stringify(
        scheduleItem
      )
    );

  } catch (
    error
  ) {
    console.warn(
      "점검 일정 데이터를 복사하지 못했습니다.",
      error
    );


    return null;
  }
}


/* =========================================================
  API 일정에서 서버 전용 정보 분리

  일정 계산에 필요한 값은 그대로 유지하고,
  revision과 관리자 정보는 management에 보관한다.
========================================================= */

function normalizeInspectionScheduleOverride(
  rawItem
) {
  if (
    !rawItem ||
    typeof rawItem !==
      "object" ||
    Array.isArray(
      rawItem
    )
  ) {
    return null;
  }


  const id =
    String(
      rawItem.id ||
      ""
    ).trim();


  if (
    !id
  ) {
    return null;
  }


  const {
    isActive,
    isCustom,

    createdById,
    createdByName,
    updatedById,
    updatedByName,

    createdAt,
    updatedAt,
    revision,

    ...scheduleFields
  } =
    rawItem;


  const scheduleItem =
    cloneInspectionScheduleItem({
      ...scheduleFields,

      id
    });


  if (
    !scheduleItem
  ) {
    return null;
  }


  return {
    scheduleItem,

    isActive:
      isActive !==
      false,

    isCustom:
      isCustom ===
      true,

    management: {
      isCustom:
        isCustom ===
        true,

      createdById:
        String(
          createdById ||
          ""
        ).trim(),

      createdByName:
        String(
          createdByName ||
          ""
        ).trim(),

      updatedById:
        String(
          updatedById ||
          ""
        ).trim(),

      updatedByName:
        String(
          updatedByName ||
          ""
        ).trim(),

      createdAt:
        String(
          createdAt ||
          ""
        ).trim(),

      updatedAt:
        String(
          updatedAt ||
          ""
        ).trim(),

      revision:
        Number(
          revision
        ) ||
        1
    }
  };
}


/* =========================================================
  기본 일정 + 관리자 변경사항 병합

  중요:
  INSPECTION_SCHEDULE_MASTER를 새 배열로 바꾸지 않고
  splice로 갱신한다.

  기존 함수들이 같은 배열을 계속 참조하므로
  오늘 점검·지연·전체 일정·전용 일지 연결에
  관리자 변경사항이 모두 적용된다.
========================================================= */

function applyInspectionScheduleOverrides(
  overrideItems
) {
  const effectiveScheduleMap =
    new Map();


  DEFAULT_INSPECTION_SCHEDULE_MASTER
    .forEach(
      defaultItem => {
        const clonedItem =
          cloneInspectionScheduleItem(
            defaultItem
          );


        if (
          !clonedItem?.id
        ) {
          return;
        }


        effectiveScheduleMap.set(
          clonedItem.id,
          clonedItem
        );
      }
    );


  const normalizedOverrides =
    (
      Array.isArray(
        overrideItems
      )
        ? overrideItems
        : []
    )
      .map(
        normalizeInspectionScheduleOverride
      )
      .filter(
        Boolean
      );


  normalizedOverrides.forEach(
    override => {
      const scheduleId =
        override
          .scheduleItem
          .id;


      /*
        사용 중지된 기본 일정 또는
        사용자 추가 일정을 목록에서 제거한다.
      */
      if (
        !override.isActive
      ) {
        effectiveScheduleMap.delete(
          scheduleId
        );


        return;
      }


      /*
        활성 변경사항은 같은 ID의 기본 일정을 교체한다.

        기본 일정에 없는 ID이면
        사용자 추가 일정으로 마지막에 추가된다.
      */
      effectiveScheduleMap.set(
        scheduleId,

        {
          ...override.scheduleItem,

          management: {
            ...override.management,

            isActive:
              true,

            isCustom:
              override.isCustom
          }
        }
      );
    }
  );


  const effectiveItems = [
    ...effectiveScheduleMap.values()
  ];


  INSPECTION_SCHEDULE_MASTER.splice(
    0,
    INSPECTION_SCHEDULE_MASTER.length,
    ...effectiveItems
  );


  inspectionScheduleOverrideState
    .overrides =
    normalizedOverrides;


  return effectiveItems;
}


/* =========================================================
  관리자 점검 일정 변경사항 조회

  API 조회 실패 시:
  - 기본 일정으로 복원
  - 점검일지 허브는 계속 실행
========================================================= */

async function loadInspectionScheduleOverrides() {
  if (
    inspectionScheduleOverrideState
      .loading
  ) {
    return INSPECTION_SCHEDULE_MASTER;
  }


  inspectionScheduleOverrideState
    .loading =
    true;


  try {
    const sessionToken =
      getInspectionScheduleSessionToken();


    if (
      !sessionToken
    ) {
      throw new Error(
        "로그인 세션을 확인할 수 없습니다."
      );
    }


    const requestUrl =
      new URL(
        INSPECTION_SCHEDULE_API_URL,
        window.location.origin
      );


    requestUrl.searchParams.set(
      "_",
      String(
        Date.now()
      )
    );


    const response =
      await fetch(
        requestUrl.toString(),

        {
          method:
            "GET",

          headers:
            getInspectionScheduleAuthHeaders(),

          cache:
            "no-store"
        }
      );


    const result =
      await readInspectionScheduleApiResponse(
        response
      );


    const overrideItems =
      Array.isArray(
        result.items
      )
        ? result.items
        : [];


    const effectiveItems =
      applyInspectionScheduleOverrides(
        overrideItems
      );


    inspectionScheduleOverrideState
      .canManage =
      result.canManage ===
        true;


    inspectionScheduleOverrideState
      .loaded =
      true;


    inspectionScheduleOverrideState
      .errorMessage =
      "";


    console.log(
      "점검 일정 관리자 변경사항 적용 완료:",
      {
        기본일정:
          DEFAULT_INSPECTION_SCHEDULE_MASTER
            .length,

        변경사항:
          overrideItems.length,

        최종일정:
          effectiveItems.length,

        관리가능:
          inspectionScheduleOverrideState
            .canManage
      }
    );


    return effectiveItems;

  } catch (
    error
  ) {
    console.error(
      "점검 일정 관리자 변경사항 조회 실패:",
      error
    );


    /*
      조회 실패 시 기본 일정표로 복원한다.
    */
    applyInspectionScheduleOverrides(
      []
    );


    inspectionScheduleOverrideState
      .loaded =
      true;


    inspectionScheduleOverrideState
      .canManage =
      false;


    inspectionScheduleOverrideState
      .errorMessage =
      error instanceof Error
        ? error.message
        : "점검 일정 설정을 불러오지 못했습니다.";


    return INSPECTION_SCHEDULE_MASTER;

  } finally {
    inspectionScheduleOverrideState
      .loading =
      false;
  }
}

/* =========================================================
  날짜값 정리

  지원:
  - Date 객체
  - YYYY-MM-DD
========================================================= */

function createInspectionScheduleDate(
  value
) {
  if (
    value instanceof Date &&
    !Number.isNaN(
      value.getTime()
    )
  ) {
    return new Date(
      value.getFullYear(),
      value.getMonth(),
      value.getDate()
    );
  }


  const text =
    String(
      value ||
      ""
    ).trim();


  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      text
    )
  ) {
    return null;
  }


  const [
    year,
    month,
    day
  ] =
    text
      .split(
        "-"
      )
      .map(
        Number
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
  )
    ? date
    : null;
}


/* =========================================================
  월의 주차 계산

  PDF 하단 기준:
  첫 주는 해당 월의 1일이
  금요일까지 포함된 주이면 첫째 주로 적용한다.

  따라서:
  - 1일이 일~금이면 해당 주 = 첫째 주
  - 1일이 토요일이면 다음 일요일부터 첫째 주
========================================================= */

function getInspectionWeekOfMonth(
  dateValue
) {
  const date =
    createInspectionScheduleDate(
      dateValue
    );


  if (
    !date
  ) {
    return 0;
  }


  const year =
    date.getFullYear();


  const monthIndex =
    date.getMonth();


  const firstDay =
    new Date(
      year,
      monthIndex,
      1
    );


  let firstWeekStart;


  /*
    1일이 토요일이면
    다음 날인 일요일부터 첫째 주
  */
  if (
    firstDay.getDay() ===
      6
  ) {
    firstWeekStart =
      new Date(
        year,
        monthIndex,
        2
      );

  } else {
    /*
      1일이 일~금이면
      1일이 포함된 일요일부터 첫째 주
    */
    firstWeekStart =
      new Date(
        year,
        monthIndex,
        1 -
        firstDay.getDay()
      );
  }


  const currentWeekStart =
    new Date(
      year,
      monthIndex,
      date.getDate() -
      date.getDay()
    );


  return (
    Math.floor(
      (
        currentWeekStart.getTime() -
        firstWeekStart.getTime()
      ) /
      604800000
    ) +
    1
  );
}


/* =========================================================
  특정 월에 활성화되는 일정인지 확인

  예:
  - 동절기: 12·1·2·3월
  - 분기: 3·6·9·12월
  - 짝수월: 2·4·6·8·10·12월
========================================================= */

function isInspectionScheduleActiveInMonth(
  scheduleItem,
  monthNumber
) {
  const activeMonths =
    Array.isArray(
      scheduleItem
        ?.rule
        ?.months
    )
      ? scheduleItem.rule.months
      : [];


  return (
    activeMonths.length ===
      0 ||

    activeMonths.includes(
      Number(
        monthNumber
      )
    )
  );
}


/* =========================================================
  해당 날짜에 수행할 점검인지 확인
========================================================= */

function isInspectionScheduleDueOnDate(
  scheduleItem,
  dateValue
) {
  const date =
    createInspectionScheduleDate(
      dateValue
    );


  if (
    !date ||
    !scheduleItem?.rule
  ) {
    return false;
  }


  const rule =
    scheduleItem.rule;


  const monthNumber =
    date.getMonth() +
    1;


  const weekday =
    date.getDay();


  if (
    !isInspectionScheduleActiveInMonth(
      scheduleItem,
      monthNumber
    )
  ) {
    return false;
  }


  /* 매일 */
  if (
    rule.type ===
      "daily"
  ) {
    return true;
  }


  /* 주중 또는 지정 요일 */
  if (
    rule.type ===
      "weekdays" ||

    rule.type ===
      "weekly"
  ) {
    return (
      Array.isArray(
        rule.days
      ) &&

      rule.days.includes(
        weekday
      )
    );
  }


  /* 매월 지정 날짜 */
  if (
    rule.type ===
      "monthlyDate"
  ) {
    return (
      date.getDate() ===
      Number(
        rule.day
      )
    );
  }


  /* 매월 지정 주차·요일 */
  if (
    rule.type ===
      "monthlyWeek"
  ) {
    const weekNumber =
      getInspectionWeekOfMonth(
        date
      );


    return (
      Array.isArray(
        rule.weeks
      ) &&

      rule.weeks.includes(
        weekNumber
      ) &&

      Array.isArray(
        rule.days
      ) &&

      rule.days.includes(
        weekday
      )
    );
  }


  /*
    날짜가 따로 정해지지 않은
    매월·수시 일정은 오늘 알림에서 제외한다.
  */
  return false;
}


/* =========================================================
  특정 날짜의 오늘 점검 목록

  dueItems:
  날짜가 확정된 점검

  conditionalItems:
  온도·운전조건 확인이 필요한 점검
========================================================= */

function getInspectionSchedulesForDate(
  dateValue
) {
  const dueItems =
    [];


  const conditionalItems =
    [];


  INSPECTION_SCHEDULE_MASTER.forEach(
    scheduleItem => {
      if (
        !isInspectionScheduleDueOnDate(
          scheduleItem,
          dateValue
        )
      ) {
        return;
      }


      if (
        scheduleItem.conditional ===
          true
      ) {
        conditionalItems.push(
          scheduleItem
        );


        return;
      }


      dueItems.push(
        scheduleItem
      );
    }
  );


  return {
    dueItems,

    conditionalItems,

    allItems: [
      ...dueItems,
      ...conditionalItems
    ]
  };
}


/* =========================================================
  선택한 월의 전체 일정

  날짜가 지정되지 않은:
  - 매월
  - 수시

  항목도 전체 일정 화면에는 표시한다.
========================================================= */

function getInspectionSchedulesForMonth(
  year,
  monthNumber,
  category = ""
) {
  const normalizedYear =
    Number(
      year
    );


  const normalizedMonth =
    Number(
      monthNumber
    );


  const normalizedCategory =
    String(
      category ||
      ""
    ).trim();


  if (
    !Number.isInteger(
      normalizedYear
    ) ||

    !Number.isInteger(
      normalizedMonth
    ) ||

    normalizedMonth <
      1 ||

    normalizedMonth >
      12
  ) {
    return [];
  }


  return INSPECTION_SCHEDULE_MASTER.filter(
    scheduleItem => {
      if (
        normalizedCategory &&

        scheduleItem.category !==
          normalizedCategory
      ) {
        return false;
      }


      return isInspectionScheduleActiveInMonth(
        scheduleItem,
        normalizedMonth
      );
    }
  );
}

/* =========================================================
  최고관리자 점검 일정 관리

  기능:
  - 기본 일정 목록 표시
  - 관리자 수정 일정 표시
  - 사용 중지 일정 표시
  - 사용자 추가 일정 표시
  - 일정 추가·수정·사용 중지
  - 기본값 복원
  - 사용자 일정 삭제
========================================================= */

const inspectionScheduleManagerState = {
  items:
    [],

  selectedId:
    "",

  mode:
    "idle",

  busy:
    false
};


/* =========================================================
  관리창 HTML 특수문자 처리
========================================================= */

function escapeInspectionScheduleManagerHtml(
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
  일정 구분 표시명
========================================================= */

function getInspectionScheduleCategoryLabel(
  value
) {
  const categoryLabels = {
    daily:
      "일일",

    weekly:
      "주간",

    monthly:
      "월간",

    quarterly:
      "분기",

    other:
      "기타"
  };


  return categoryLabels[
    String(
      value ||
      ""
    ).trim()
  ] ||
    "기타";
}


/* =========================================================
  일정 ID에 해당하는 관리자 변경사항 찾기
========================================================= */

function getInspectionScheduleManagerOverrideById(
  scheduleId
) {
  const normalizedId =
    String(
      scheduleId ||
      ""
    ).trim();


  return inspectionScheduleOverrideState
    .overrides
    .find(
      override => {
        return (
          String(
            override
              ?.scheduleItem
              ?.id ||
            ""
          ).trim() ===
          normalizedId
        );
      }
    ) ||
    null;
}


/* =========================================================
  관리창에 표시할 전체 일정 생성

  포함:
  - 기본 일정
  - 수정된 기본 일정
  - 사용 중지된 기본 일정
  - 사용자 추가 일정
========================================================= */

function buildInspectionScheduleManagerItems() {
  const defaultIds =
    new Set();


  const managerItems = [];


  DEFAULT_INSPECTION_SCHEDULE_MASTER
    .forEach(
      (
        defaultItem,
        defaultIndex
      ) => {
        const id =
          String(
            defaultItem?.id ||
            ""
          ).trim();


        if (
          !id
        ) {
          return;
        }


        defaultIds.add(
          id
        );


        const override =
          getInspectionScheduleManagerOverrideById(
            id
          );


        const scheduleItem =
          cloneInspectionScheduleItem(
            override?.scheduleItem ||
            defaultItem
          );


        if (
          !scheduleItem
        ) {
          return;
        }


        managerItems.push({
          ...scheduleItem,

          isActive:
            override
              ? override.isActive !==
                  false
              : true,

          isCustom:
            false,

          hasOverride:
            Boolean(
              override
            ),

          revision:
            Number(
              override
                ?.management
                ?.revision
            ) ||
            0,

          updatedByName:
            String(
              override
                ?.management
                ?.updatedByName ||
              ""
            ).trim(),

          updatedAt:
            String(
              override
                ?.management
                ?.updatedAt ||
              ""
            ).trim(),

          sortIndex:
            defaultIndex
        });
      }
    );


  inspectionScheduleOverrideState
    .overrides
    .forEach(
      override => {
        const id =
          String(
            override
              ?.scheduleItem
              ?.id ||
            ""
          ).trim();


        if (
          !id ||
          defaultIds.has(
            id
          )
        ) {
          return;
        }


        const scheduleItem =
          cloneInspectionScheduleItem(
            override.scheduleItem
          );


        if (
          !scheduleItem
        ) {
          return;
        }


        managerItems.push({
          ...scheduleItem,

          isActive:
            override.isActive !==
            false,

          isCustom:
            true,

          hasOverride:
            true,

          revision:
            Number(
              override
                ?.management
                ?.revision
            ) ||
            1,

          updatedByName:
            String(
              override
                ?.management
                ?.updatedByName ||
              ""
            ).trim(),

          updatedAt:
            String(
              override
                ?.management
                ?.updatedAt ||
              ""
            ).trim(),

          sortIndex:
            100000 +
            managerItems.length
        });
      }
    );


  return managerItems.sort(
    (
      firstItem,
      secondItem
    ) => {
      return (
        Number(
          firstItem.sortIndex ||
          0
        ) -
        Number(
          secondItem.sortIndex ||
          0
        )
      );
    }
  );
}


/* =========================================================
  편집창 안내 메시지
========================================================= */

function setInspectionScheduleEditorMessage(
  message = "",
  state = "info"
) {
  const element =
    document.getElementById(
      "inspectionScheduleEditorMessage"
    );


  if (
    !element
  ) {
    return;
  }


  const normalizedMessage =
    String(
      message ||
      ""
    ).trim();


  element.hidden =
    !normalizedMessage;


  element.textContent =
    normalizedMessage;


  element.dataset.state =
    state;
}


/* =========================================================
  관리 일정 목록 출력
========================================================= */

function renderInspectionScheduleManagerList() {
  const listElement =
    document.getElementById(
      "inspectionScheduleManagerList"
    );


  const countElement =
    document.getElementById(
      "inspectionScheduleManagerCount"
    );


  const emptyElement =
    document.getElementById(
      "inspectionScheduleManagerEmpty"
    );


  if (
    !listElement ||
    !countElement ||
    !emptyElement
  ) {
    return;
  }


  const items =
    inspectionScheduleManagerState
      .items;


  countElement.textContent =
    String(
      items.length
    );


  emptyElement.hidden =
    items.length >
    0;


  if (
    !items.length
  ) {
    listElement.innerHTML =
      "";


    return;
  }


  listElement.innerHTML =
    items
      .map(
        item => {
          const id =
            String(
              item.id ||
              ""
            );


          const isSelected =
            inspectionScheduleManagerState
              .selectedId ===
            id;


          const badges = [];


          if (
            !item.isActive
          ) {
            badges.push(`
              <span class="is-disabled">
                사용 중지
              </span>
            `);

          } else if (
            item.isCustom
          ) {
            badges.push(`
              <span class="is-custom">
                추가 일정
              </span>
            `);

          } else if (
            item.hasOverride
          ) {
            badges.push(`
              <span class="is-edited">
                수정됨
              </span>
            `);

          } else {
            badges.push(`
              <span>
                기본 일정
              </span>
            `);
          }


          return `
            <button
              type="button"
              class="
                inspection-schedule-manager-item
                ${isSelected ? "is-selected" : ""}
                ${!item.isActive ? "is-inactive" : ""}
              "
              data-inspection-schedule-manager-item-id="${escapeInspectionScheduleManagerHtml(
                id
              )}"
            >

              <span class="inspection-schedule-manager-item__top">

                <b>
                  ${escapeInspectionScheduleManagerHtml(
                    getInspectionScheduleCategoryLabel(
                      item.category
                    )
                  )}
                </b>

                <span class="inspection-schedule-manager-item__badges">
                  ${badges.join("")}
                </span>

              </span>


              <strong>
                ${escapeInspectionScheduleManagerHtml(
                  item.title ||
                  "이름 없는 일정"
                )}
              </strong>


              <small>
                ${escapeInspectionScheduleManagerHtml(
                  item.scheduleLabel ||
                  "주기 미설정"
                )}
              </small>


              <em>
                ${escapeInspectionScheduleManagerHtml(
                  id
                )}
              </em>

            </button>
          `;
        }
      )
      .join(
        ""
      );
}


/* =========================================================
  편집 폼 활성화·비활성화
========================================================= */

function setInspectionScheduleEditorEnabled(
  enabled,
  options = {}
) {
  const form =
    document.getElementById(
      "inspectionScheduleEditorForm"
    );


  if (
    !form
  ) {
    return;
  }


  const isNew =
    options.isNew ===
    true;


  form
    .querySelectorAll(
      `
        input:not([type="hidden"]),
        select,
        textarea,
        fieldset
      `
    )
    .forEach(
      element => {
        element.disabled =
          !enabled;
      }
    );


  const idInput =
    document.getElementById(
      "inspectionScheduleEditorId"
    );


  if (
    idInput
  ) {
    idInput.disabled =
      !enabled ||
      !isNew;
  }


  const resetButton =
    document.getElementById(
      "inspectionScheduleEditorResetButton"
    );


  const saveButton =
    document.getElementById(
      "inspectionScheduleSaveButton"
    );


  if (
    resetButton
  ) {
    resetButton.disabled =
      !enabled;
  }


  if (
    saveButton
  ) {
    saveButton.disabled =
      !enabled;
  }
}


/* =========================================================
  체크박스 초기화
========================================================= */

function clearInspectionScheduleEditorChecks(
  selector
) {
  document
    .querySelectorAll(
      selector
    )
    .forEach(
      input => {
        input.checked =
          false;
      }
    );
}


/* =========================================================
  체크박스 값 적용
========================================================= */

function setInspectionScheduleEditorCheckedValues(
  selector,
  values
) {
  const normalizedValues =
    new Set(
      (
        Array.isArray(
          values
        )
          ? values
          : []
      ).map(
        value => {
          return String(
            value
          );
        }
      )
    );


  document
    .querySelectorAll(
      selector
    )
    .forEach(
      input => {
        input.checked =
          normalizedValues.has(
            String(
              input.value
            )
          );
      }
    );
}


/* =========================================================
  일정 계산 유형별 입력칸 활성화
========================================================= */

function updateInspectionScheduleRuleEditorState() {
  const editorEnabled =
    [
      "new",
      "edit"
    ].includes(
      inspectionScheduleManagerState
        .mode
    ) &&
    !inspectionScheduleManagerState
      .busy;


  const ruleType =
    String(
      document
        .getElementById(
          "inspectionScheduleRuleType"
        )
        ?.value ||
      "daily"
    );


  const dayInput =
    document.getElementById(
      "inspectionScheduleRuleDay"
    );


  const daysField =
    document.getElementById(
      "inspectionScheduleRuleDaysField"
    );


  const weeksField =
    document.getElementById(
      "inspectionScheduleRuleWeeksField"
    );


  const monthsField =
    document.getElementById(
      "inspectionScheduleRuleMonthsField"
    );


  if (
    dayInput
  ) {
    dayInput.disabled =
      !editorEnabled ||
      ruleType !==
        "monthlyDate";
  }


  if (
    daysField
  ) {
    daysField.disabled =
      !editorEnabled ||
      ![
        "weekdays",
        "weekly",
        "monthlyWeek"
      ].includes(
        ruleType
      );
  }


  if (
    weeksField
  ) {
    weeksField.disabled =
      !editorEnabled ||
      ruleType !==
        "monthlyWeek";
  }


  if (
    monthsField
  ) {
    monthsField.disabled =
      !editorEnabled;
  }
}


/* =========================================================
  일정 데이터를 편집창에 적용
========================================================= */

function fillInspectionScheduleEditor(
  item,
  options = {}
) {
  const isNew =
    options.isNew ===
    true;


  const normalizedItem =
    item ||
    {};


  const rule =
    (
      normalizedItem.rule &&
      typeof normalizedItem.rule ===
        "object"
    )
      ? normalizedItem.rule
      : {};


  inspectionScheduleManagerState
    .mode =
    isNew
      ? "new"
      : "edit";


  inspectionScheduleManagerState
    .selectedId =
    isNew
      ? ""
      : String(
          normalizedItem.id ||
          ""
        );


  document
    .getElementById(
      "inspectionScheduleEditorOriginalId"
    )
    .value =
    isNew
      ? ""
      : String(
          normalizedItem.id ||
          ""
        );


  document
    .getElementById(
      "inspectionScheduleEditorRevision"
    )
    .value =
    String(
      isNew
        ? 0
        : Number(
            normalizedItem.revision
          ) ||
          0
    );


  document
    .getElementById(
      "inspectionScheduleEditorIsCustom"
    )
    .value =
    String(
      isNew
        ? true
        : normalizedItem.isCustom ===
          true
    );


  document
    .getElementById(
      "inspectionScheduleEditorId"
    )
    .value =
    isNew
      ? ""
      : String(
          normalizedItem.id ||
          ""
        );


  document
    .getElementById(
      "inspectionScheduleEditorCategory"
    )
    .value =
    String(
      normalizedItem.category ||
      "weekly"
    );


  document
    .getElementById(
      "inspectionScheduleEditorName"
    )
    .value =
    String(
      normalizedItem.title ||
      ""
    );


  document
    .getElementById(
      "inspectionScheduleEditorLabel"
    )
    .value =
    String(
      normalizedItem.scheduleLabel ||
      ""
    );


  document
    .getElementById(
      "inspectionScheduleEditorPosition"
    )
    .value =
    String(
      normalizedItem.position ||
      ""
    );


  document
    .getElementById(
      "inspectionScheduleEditorApproval"
    )
    .value =
    String(
      normalizedItem.approval ||
      ""
    );


  document
    .getElementById(
      "inspectionScheduleEditorShare"
    )
    .value =
    String(
      normalizedItem.share ||
      ""
    );


  document
    .getElementById(
      "inspectionScheduleEditorLogKey"
    )
    .value =
    String(
      normalizedItem.logKey ||
      ""
    );


  document
    .getElementById(
      "inspectionScheduleEditorTitleKeyword"
    )
    .value =
    String(
      normalizedItem.titleKeyword ||
      ""
    );


  document
    .getElementById(
      "inspectionScheduleEditorNote"
    )
    .value =
    String(
      normalizedItem.note ||
      ""
    );


  document
    .getElementById(
      "inspectionScheduleRuleType"
    )
    .value =
    String(
      rule.type ||
      "weekly"
    );


  document
    .getElementById(
      "inspectionScheduleRuleDay"
    )
    .value =
    Number.isInteger(
      Number(
        rule.day
      )
    )
      ? String(
          Number(
            rule.day
          )
        )
      : "";


  document
    .getElementById(
      "inspectionScheduleEditorActive"
    )
    .checked =
    isNew
      ? true
      : normalizedItem.isActive !==
        false;


  document
    .getElementById(
      "inspectionScheduleEditorConditional"
    )
    .checked =
    normalizedItem.conditional ===
    true;


  document
    .getElementById(
      "inspectionScheduleEditorReferenceOnly"
    )
    .checked =
    normalizedItem.referenceOnly ===
    true;


  document
    .getElementById(
      "inspectionScheduleShiftDs"
    )
    .checked =
    Array.isArray(
      normalizedItem.shifts
    ) &&
    normalizedItem.shifts.includes(
      "D/S"
    );


  document
    .getElementById(
      "inspectionScheduleShiftNs"
    )
    .checked =
    Array.isArray(
      normalizedItem.shifts
    ) &&
    normalizedItem.shifts.includes(
      "N/S"
    );


  clearInspectionScheduleEditorChecks(
    "[data-inspection-schedule-day]"
  );


  clearInspectionScheduleEditorChecks(
    "[data-inspection-schedule-week]"
  );


  clearInspectionScheduleEditorChecks(
    "[data-inspection-schedule-month]"
  );


  setInspectionScheduleEditorCheckedValues(
    "[data-inspection-schedule-day]",
    rule.days
  );


  setInspectionScheduleEditorCheckedValues(
    "[data-inspection-schedule-week]",
    rule.weeks
  );


  setInspectionScheduleEditorCheckedValues(
    "[data-inspection-schedule-month]",
    rule.months
  );


  const modeElement =
    document.getElementById(
      "inspectionScheduleEditorMode"
    );


  const titleElement =
    document.getElementById(
      "inspectionScheduleEditorTitle"
    );


  const badgeElement =
    document.getElementById(
      "inspectionScheduleEditorBadge"
    );


  const restoreButton =
    document.getElementById(
      "inspectionScheduleRestoreButton"
    );


  if (
    modeElement
  ) {
    modeElement.textContent =
      isNew
        ? "새 일정 등록"
        : "일정 수정";
  }


  if (
    titleElement
  ) {
    titleElement.textContent =
      isNew
        ? "새 점검 일정을 입력해 주세요."
        : String(
            normalizedItem.title ||
            "점검 일정 수정"
          );
  }


  if (
    badgeElement
  ) {
    badgeElement.textContent =
      isNew
        ? "추가 일정"
        : (
            !normalizedItem.isActive
              ? "사용 중지"
              : (
                  normalizedItem.isCustom
                    ? "추가 일정"
                    : (
                        normalizedItem.hasOverride
                          ? "기본 일정 수정"
                          : "기본 일정"
                      )
                )
          );
  }


  if (
    restoreButton
  ) {
    const canDeleteOrRestore =
      !isNew &&
      Number(
        normalizedItem.revision
      ) >
        0;


    restoreButton.hidden =
      !canDeleteOrRestore;


    restoreButton.disabled =
      !canDeleteOrRestore;


    restoreButton.textContent =
      normalizedItem.isCustom
        ? "일정 삭제"
        : "기본값 복원";
  }


  setInspectionScheduleEditorEnabled(
    true,
    {
      isNew
    }
  );


  setInspectionScheduleEditorMessage(
    ""
  );


  updateInspectionScheduleRuleEditorState();


  renderInspectionScheduleManagerList();


  window.setTimeout(
    () => {
      document
        .getElementById(
          isNew
            ? "inspectionScheduleEditorId"
            : "inspectionScheduleEditorName"
        )
        ?.focus();
    },
    0
  );
}


/* =========================================================
  편집창 선택 해제
========================================================= */

function resetInspectionScheduleEditorToIdle() {
  inspectionScheduleManagerState
    .mode =
    "idle";


  inspectionScheduleManagerState
    .selectedId =
    "";


  const form =
    document.getElementById(
      "inspectionScheduleEditorForm"
    );


  form?.reset();


  setInspectionScheduleEditorEnabled(
    false
  );


  const modeElement =
    document.getElementById(
      "inspectionScheduleEditorMode"
    );


  const titleElement =
    document.getElementById(
      "inspectionScheduleEditorTitle"
    );


  const badgeElement =
    document.getElementById(
      "inspectionScheduleEditorBadge"
    );


  const restoreButton =
    document.getElementById(
      "inspectionScheduleRestoreButton"
    );


  if (
    modeElement
  ) {
    modeElement.textContent =
      "일정 선택";
  }


  if (
    titleElement
  ) {
    titleElement.textContent =
      "수정할 일정을 선택해 주세요.";
  }


  if (
    badgeElement
  ) {
    badgeElement.textContent =
      "기본 일정";
  }


  if (
    restoreButton
  ) {
    restoreButton.hidden =
      true;


    restoreButton.disabled =
      true;
  }


  setInspectionScheduleEditorMessage(
    ""
  );


  renderInspectionScheduleManagerList();
}


/* =========================================================
  선택된 숫자 체크박스 값
========================================================= */

function getInspectionScheduleEditorCheckedNumbers(
  selector
) {
  return [
    ...document.querySelectorAll(
      selector
    )
  ]
    .filter(
      input => {
        return input.checked;
      }
    )
    .map(
      input => {
        return Number(
          input.value
        );
      }
    )
    .filter(
      value => {
        return Number.isInteger(
          value
        );
      }
    );
}


/* =========================================================
  편집창 데이터 수집
========================================================= */

function collectInspectionScheduleEditorItem() {
  const ruleType =
    String(
      document
        .getElementById(
          "inspectionScheduleRuleType"
        )
        ?.value ||
      "daily"
    );


  const rawDay =
    String(
      document
        .getElementById(
          "inspectionScheduleRuleDay"
        )
        ?.value ||
      ""
    ).trim();


  const rule = {
    type:
      ruleType
  };


  const days =
    getInspectionScheduleEditorCheckedNumbers(
      "[data-inspection-schedule-day]"
    );


  const weeks =
    getInspectionScheduleEditorCheckedNumbers(
      "[data-inspection-schedule-week]"
    );


  const months =
    getInspectionScheduleEditorCheckedNumbers(
      "[data-inspection-schedule-month]"
    );


  if (
    days.length
  ) {
    rule.days =
      days;
  }


  if (
    weeks.length
  ) {
    rule.weeks =
      weeks;
  }


  if (
    months.length
  ) {
    rule.months =
      months;
  }


  if (
    rawDay
  ) {
    rule.day =
      Number(
        rawDay
      );
  }


  const shifts = [];


  if (
    document
      .getElementById(
        "inspectionScheduleShiftDs"
      )
      ?.checked
  ) {
    shifts.push(
      "D/S"
    );
  }


  if (
    document
      .getElementById(
        "inspectionScheduleShiftNs"
      )
      ?.checked
  ) {
    shifts.push(
      "N/S"
    );
  }


  return {
    id:
      String(
        document
          .getElementById(
            "inspectionScheduleEditorId"
          )
          ?.value ||
        ""
      )
        .trim()
        .toLowerCase(),

    category:
      String(
        document
          .getElementById(
            "inspectionScheduleEditorCategory"
          )
          ?.value ||
        "weekly"
      ),

    title:
      String(
        document
          .getElementById(
            "inspectionScheduleEditorName"
          )
          ?.value ||
        ""
      ).trim(),

    scheduleLabel:
      String(
        document
          .getElementById(
            "inspectionScheduleEditorLabel"
          )
          ?.value ||
        ""
      ).trim(),

    shifts,

    position:
      String(
        document
          .getElementById(
            "inspectionScheduleEditorPosition"
          )
          ?.value ||
        ""
      ).trim(),

    approval:
      String(
        document
          .getElementById(
            "inspectionScheduleEditorApproval"
          )
          ?.value ||
        ""
      ).trim(),

    share:
      String(
        document
          .getElementById(
            "inspectionScheduleEditorShare"
          )
          ?.value ||
        ""
      ).trim(),

    note:
      String(
        document
          .getElementById(
            "inspectionScheduleEditorNote"
          )
          ?.value ||
        ""
      ).trim(),

    conditional:
      document
        .getElementById(
          "inspectionScheduleEditorConditional"
        )
        ?.checked ===
      true,

    referenceOnly:
      document
        .getElementById(
          "inspectionScheduleEditorReferenceOnly"
        )
        ?.checked ===
      true,

    logKey:
      String(
        document
          .getElementById(
            "inspectionScheduleEditorLogKey"
          )
          ?.value ||
        ""
      ).trim(),

    titleKeyword:
      String(
        document
          .getElementById(
            "inspectionScheduleEditorTitleKeyword"
          )
          ?.value ||
        ""
      ).trim(),

    rule
  };
}


/* =========================================================
  편집 데이터 검증
========================================================= */

function validateInspectionScheduleEditorItem(
  item
) {
  if (
    !/^[a-z0-9][a-z0-9_-]{2,119}$/.test(
      item.id
    )
  ) {
    return "일정 ID는 영문 소문자·숫자·하이픈·밑줄로 3자 이상 입력해 주세요.";
  }


  if (
    !item.title
  ) {
    return "점검명을 입력해 주세요.";
  }


  if (
    !item.scheduleLabel
  ) {
    return "주기 표시를 입력해 주세요.";
  }


  if (
    inspectionScheduleManagerState
      .mode ===
      "new" &&
    inspectionScheduleManagerState
      .items
      .some(
        existingItem => {
          return (
            existingItem.id ===
            item.id
          );
        }
      )
  ) {
    return "이미 사용 중인 일정 ID입니다. 다른 ID를 입력해 주세요.";
  }


  if (
    [
      "weekdays",
      "weekly"
    ].includes(
      item.rule.type
    ) &&
    (
      !Array.isArray(
        item.rule.days
      ) ||
      !item.rule.days.length
    )
  ) {
    return "적용 요일을 한 개 이상 선택해 주세요.";
  }


  if (
    item.rule.type ===
      "monthlyWeek" &&
    (
      !Array.isArray(
        item.rule.days
      ) ||
      !item.rule.days.length ||
      !Array.isArray(
        item.rule.weeks
      ) ||
      !item.rule.weeks.length
    )
  ) {
    return "월간 주차 일정은 적용 주차와 요일을 모두 선택해 주세요.";
  }


  if (
    item.rule.type ===
      "monthlyDate" &&
    (
      !Number.isInteger(
        item.rule.day
      ) ||
      item.rule.day <
        1 ||
      item.rule.day >
        31
    )
  ) {
    return "매월 지정일은 1~31 범위로 입력해 주세요.";
  }


  return "";
}

/* =========================================================
  점검 일정 저장 최종본

  저장 성공 후:
  - 페이지 새로고침하지 않음
  - 현재 편집 일정 유지
  - 최신 revision 반영
  - 담당 보직 체크 유지
  - 일정 목록과 달력 즉시 갱신
========================================================= */

async function saveInspectionScheduleManagerItem() {
  if (
    inspectionScheduleManagerState
      .busy
  ) {
    return;
  }


  /*
    편집창에서 입력한 일정 데이터

    item 변수는 이 함수 안에서
    단 한 번만 선언한다.
  */
  const item =
    collectInspectionScheduleEditorItem();


  const validationMessage =
    validateInspectionScheduleEditorItem(
      item
    );


  if (
    validationMessage
  ) {
    setInspectionScheduleEditorMessage(
      validationMessage,
      "error"
    );


    return;
  }


  const revision =
    Number(
      document
        .getElementById(
          "inspectionScheduleEditorRevision"
        )
        ?.value ||
      0
    );


  const isCustom =
    document
      .getElementById(
        "inspectionScheduleEditorIsCustom"
      )
      ?.value ===
    "true";


  const isActive =
    document
      .getElementById(
        "inspectionScheduleEditorActive"
      )
      ?.checked ===
    true;


  const wasNewSchedule =
    inspectionScheduleManagerState
      .mode ===
    "new";


  inspectionScheduleManagerState
    .busy =
    true;


  setInspectionScheduleEditorMessage(
    "점검 일정을 저장하는 중입니다.",
    "saving"
  );


  setInspectionScheduleEditorEnabled(
    false
  );


  try {
    const response =
      await fetch(
        INSPECTION_SCHEDULE_API_URL,

        {
          method:
            "POST",

          headers:
            getInspectionScheduleAuthHeaders({
              "Content-Type":
                "application/json"
            }),

          cache:
            "no-store",

          body:
            JSON.stringify({
              item,

              expectedRevision:
                revision >
                  0
                  ? revision
                  : null,

              isActive,

              isCustom
            })
        }
      );


    const result =
      await readInspectionScheduleApiResponse(
        response
      );


    const savedId =
      String(
        result?.item?.id ||
        item.id ||
        ""
      ).trim();


    /*
      서버 저장 후 최신 변경사항을 다시 조회한다.
    */
    await loadInspectionScheduleOverrides();


    inspectionScheduleManagerState
      .items =
      buildInspectionScheduleManagerItems();


    inspectionScheduleManagerState
      .selectedId =
      savedId;


    inspectionScheduleManagerState
      .busy =
      false;


    /*
      저장 결과로 다시 찾은 일정은
      savedItem이라는 별도 이름을 사용한다.

      item을 다시 선언하지 않는다.
    */
    const savedItem =
      inspectionScheduleManagerState
        .items
        .find(
          scheduleItem => {
            return (
              String(
                scheduleItem?.id ||
                ""
              ).trim() ===
              savedId
            );
          }
        ) ||
      null;


    if (
      savedItem
    ) {
      fillInspectionScheduleEditor(
        savedItem
      );

    } else {
      fillInspectionScheduleEditor({
        ...item,

        isActive,

        isCustom:
          wasNewSchedule
            ? true
            : isCustom,

        hasOverride:
          true,

        revision:
          Number(
            result?.item?.revision
          ) ||
          Math.max(
            1,
            revision +
              1
          )
      });
    }


    renderInspectionScheduleManagerList();


    setInspectionScheduleEditorMessage(
      result.message ||
      (
        wasNewSchedule
          ? "점검 일정을 등록했습니다."
          : "점검 일정을 수정했습니다."
      ),

      "success"
    );


    /*
      달력·점검주기표 갱신
    */
    const refreshMessage = {
      type:
        "gs-shift-log:refresh-inspection-schedule",

      scheduleId:
        savedId
    };


    window.dispatchEvent(
      new MessageEvent(
        "message",

        {
          data:
            refreshMessage,

          origin:
            window.location.origin
        }
      )
    );


    /*
      상위 업무일지 화면에도 변경사항 전달
    */
    try {
      if (
        window.parent &&
        window.parent !==
          window
      ) {
        window.parent.postMessage(
          refreshMessage,
          window.location.origin
        );
      }

    } catch (
      error
    ) {
      console.warn(
        "점검 일정 갱신 정보를 상위 화면에 전달하지 못했습니다.",
        error
      );
    }

  } catch (
    error
  ) {
    console.error(
      "점검 일정 저장 실패:",
      error
    );


    inspectionScheduleManagerState
      .busy =
      false;


    setInspectionScheduleEditorMessage(
      error instanceof Error
        ? error.message
        : "점검 일정을 저장하지 못했습니다.",

      "error"
    );


    setInspectionScheduleEditorEnabled(
      true,
      {
        isNew:
          wasNewSchedule
      }
    );


    updateInspectionScheduleRuleEditorState();
  }
}

/* =========================================================
  기본값 복원 또는 사용자 일정 삭제
========================================================= */

async function deleteOrRestoreInspectionScheduleManagerItem() {
  if (
    inspectionScheduleManagerState
      .busy
  ) {
    return;
  }


  const selectedItem =
    inspectionScheduleManagerState
      .items
      .find(
        item => {
          return (
            item.id ===
            inspectionScheduleManagerState
              .selectedId
          );
        }
      );


  if (
    !selectedItem ||
    Number(
      selectedItem.revision
    ) <
      1
  ) {
    return;
  }


  const confirmed =
    window.confirm(
      selectedItem.isCustom
        ? `“${selectedItem.title}” 일정을 완전히 삭제할까요?`
        : `“${selectedItem.title}”의 관리자 변경사항을 삭제하고 기본값으로 복원할까요?`
    );


  if (
    !confirmed
  ) {
    return;
  }


  inspectionScheduleManagerState
    .busy =
    true;


  setInspectionScheduleEditorMessage(
    selectedItem.isCustom
      ? "일정을 삭제하는 중입니다."
      : "기본 일정으로 복원하는 중입니다.",

    "saving"
  );


  setInspectionScheduleEditorEnabled(
    false
  );


  try {
    const requestUrl =
      new URL(
        INSPECTION_SCHEDULE_API_URL,
        window.location.origin
      );


    requestUrl.searchParams.set(
      "id",
      selectedItem.id
    );


    requestUrl.searchParams.set(
      "revision",
      String(
        selectedItem.revision
      )
    );


    const response =
      await fetch(
        requestUrl.toString(),

        {
          method:
            "DELETE",

          headers:
            getInspectionScheduleAuthHeaders(),

          cache:
            "no-store"
        }
      );


    const result =
      await readInspectionScheduleApiResponse(
        response
      );


    window.alert(
      result.message ||
      (
        selectedItem.isCustom
          ? "일정을 삭제했습니다."
          : "기본 일정으로 복원했습니다."
      )
    );


    window.location.reload();

  } catch (
    error
  ) {
    console.error(
      "점검 일정 삭제·복원 실패:",
      error
    );


    setInspectionScheduleEditorMessage(
      error instanceof Error
        ? error.message
        : "점검 일정을 삭제하거나 복원하지 못했습니다.",

      "error"
    );


    inspectionScheduleManagerState
      .busy =
      false;


    setInspectionScheduleEditorEnabled(
      true,
      {
        isNew:
          false
      }
    );


    updateInspectionScheduleRuleEditorState();
  }
}


/* =========================================================
  관리 목록 새로고침
========================================================= */

async function refreshInspectionScheduleManagerItems() {
  if (
    inspectionScheduleManagerState
      .busy
  ) {
    return;
  }


  inspectionScheduleManagerState
    .busy =
    true;


  const refreshButton =
    document.getElementById(
      "inspectionScheduleManagerRefreshButton"
    );


  if (
    refreshButton
  ) {
    refreshButton.disabled =
      true;


    refreshButton.textContent =
      "불러오는 중";
  }


  try {
    await loadInspectionScheduleOverrides();


    inspectionScheduleManagerState
      .items =
      buildInspectionScheduleManagerItems();


    const selectedItem =
      inspectionScheduleManagerState
        .items
        .find(
          item => {
            return (
              item.id ===
              inspectionScheduleManagerState
                .selectedId
            );
          }
        );


    if (
      selectedItem
    ) {
      fillInspectionScheduleEditor(
        selectedItem
      );

    } else {
      resetInspectionScheduleEditorToIdle();
    }

  } catch (
    error
  ) {
    console.error(
      "점검 일정 관리 목록 새로고침 실패:",
      error
    );


    setInspectionScheduleEditorMessage(
      error instanceof Error
        ? error.message
        : "점검 일정 목록을 새로고침하지 못했습니다.",

      "error"
    );

  } finally {
    inspectionScheduleManagerState
      .busy =
      false;


    if (
      refreshButton
    ) {
      refreshButton.disabled =
        false;


      refreshButton.textContent =
        "새로고침";
    }


    updateInspectionScheduleRuleEditorState();
  }
}


/* =========================================================
  최고관리자 점검 일정 관리창 초기화
========================================================= */

function initializeInspectionScheduleManagerShell() {
  const manageButton =
    document.getElementById(
      "inspectionScheduleManageButton"
    );


  const modal =
    document.getElementById(
      "inspectionScheduleManagerModal"
    );


  if (
    !manageButton ||
    !modal
  ) {
    return;
  }


  const canManage =
    inspectionScheduleOverrideState
      .canManage ===
    true;


  manageButton.hidden =
    !canManage;


  if (
    !canManage
  ) {
    return;
  }


  const refreshButton =
    document.getElementById(
      "inspectionScheduleManagerRefreshButton"
    );


  const newButton =
    document.getElementById(
      "inspectionScheduleNewButton"
    );


  const listElement =
    document.getElementById(
      "inspectionScheduleManagerList"
    );


  const form =
    document.getElementById(
      "inspectionScheduleEditorForm"
    );


  const resetButton =
    document.getElementById(
      "inspectionScheduleEditorResetButton"
    );


  const restoreButton =
    document.getElementById(
      "inspectionScheduleRestoreButton"
    );


  const ruleTypeSelect =
    document.getElementById(
      "inspectionScheduleRuleType"
    );


  function openManager() {
    inspectionScheduleManagerState
      .items =
      buildInspectionScheduleManagerItems();


    inspectionScheduleManagerState
      .busy =
      false;


    resetInspectionScheduleEditorToIdle();


    renderInspectionScheduleManagerList();


    if (
      refreshButton
    ) {
      refreshButton.disabled =
        false;
    }


    if (
      newButton
    ) {
      newButton.disabled =
        false;
    }


    modal.hidden =
      false;


    modal.setAttribute(
      "aria-hidden",
      "false"
    );


    document.body.classList.add(
      "inspection-schedule-manager-open"
    );


    window.setTimeout(
      () => {
        document
          .getElementById(
            "inspectionScheduleManagerCloseButton"
          )
          ?.focus();
      },
      0
    );
  }


  function closeManager() {
    if (
      inspectionScheduleManagerState
        .busy
    ) {
      return;
    }


    modal.hidden =
      true;


    modal.setAttribute(
      "aria-hidden",
      "true"
    );


    document.body.classList.remove(
      "inspection-schedule-manager-open"
    );


    manageButton.focus();
  }


  manageButton.addEventListener(
    "click",
    openManager
  );


  modal
    .querySelectorAll(
      "[data-close-inspection-schedule-manager]"
    )
    .forEach(
      closeButton => {
        closeButton.addEventListener(
          "click",
          closeManager
        );
      }
    );


  listElement?.addEventListener(
    "click",
    event => {
      const button =
        event.target.closest(
          "[data-inspection-schedule-manager-item-id]"
        );


      if (
        !button ||
        inspectionScheduleManagerState
          .busy
      ) {
        return;
      }


      const selectedId =
        String(
          button.dataset
            .inspectionScheduleManagerItemId ||
          ""
        );


      const selectedItem =
        inspectionScheduleManagerState
          .items
          .find(
            item => {
              return (
                item.id ===
                selectedId
              );
            }
          );


      if (
        selectedItem
      ) {
        fillInspectionScheduleEditor(
          selectedItem
        );
      }
    }
  );


  newButton?.addEventListener(
    "click",
    () => {
      if (
        inspectionScheduleManagerState
          .busy
      ) {
        return;
      }


      fillInspectionScheduleEditor(
        {
          category:
            "weekly",

          scheduleLabel:
            "",

          shifts: [
            "D/S"
          ],

          rule: {
            type:
              "weekly",

            days: [
              0
            ]
          },

          isActive:
            true,

          isCustom:
            true
        },

        {
          isNew:
            true
        }
      );
    }
  );


  refreshButton?.addEventListener(
    "click",
    refreshInspectionScheduleManagerItems
  );


  ruleTypeSelect?.addEventListener(
    "change",
    updateInspectionScheduleRuleEditorState
  );


  resetButton?.addEventListener(
    "click",
    () => {
      if (
        inspectionScheduleManagerState
          .mode ===
        "new"
      ) {
        fillInspectionScheduleEditor(
          {
            category:
              "weekly",

            shifts: [
              "D/S"
            ],

            rule: {
              type:
                "weekly",

              days: [
                0
              ]
            },

            isActive:
              true,

            isCustom:
              true
          },

          {
            isNew:
              true
          }
        );


        return;
      }


      const selectedItem =
        inspectionScheduleManagerState
          .items
          .find(
            item => {
              return (
                item.id ===
                inspectionScheduleManagerState
                  .selectedId
              );
            }
          );


      if (
        selectedItem
      ) {
        fillInspectionScheduleEditor(
          selectedItem
        );
      }
    }
  );


  restoreButton?.addEventListener(
    "click",
    deleteOrRestoreInspectionScheduleManagerItem
  );


  form?.addEventListener(
    "submit",
    event => {
      event.preventDefault();


      saveInspectionScheduleManagerItem();
    }
  );


  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key !==
          "Escape" ||
        modal.hidden
      ) {
        return;
      }


      event.preventDefault();


      closeManager();
    }
  );
}


/* =========================================================
  점검일지 허브 최초 실행

  중요:
  - 점검일지 카드와 iframe 기능은 즉시 실행한다.
  - D1 일정 변경사항 조회는 백그라운드에서 처리한다.
  - 일정 API가 늦거나 실패해도 점검일지를 열 수 있다.
========================================================= */

document.addEventListener(
  "DOMContentLoaded",

  () => {
    /*
      기본 일정표는 파일 상단에 이미 준비되어 있다.

      따라서 API 응답을 기다리지 않고
      점검일지 카드·탭·iframe 이벤트를 먼저 연결한다.
    */
    initializeInspectionLogHub();


    /*
      관리자 변경 일정은 백그라운드에서 불러온다.

      일정 조회가 느려도:
      - 야간 순찰
      - 고압가스
      - LNG
      - Soot Blower

      전용 점검일지는 즉시 열 수 있다.
    */
    void (
      async () => {
        try {
          await loadInspectionScheduleOverrides();

        } catch (
          error
        ) {
          console.error(
            "점검 일정 초기 조회 실패:",
            error
          );
        }


        /*
          관리자 권한이 확인된 다음
          일정 관리 기능을 초기화한다.
        */
        initializeInspectionScheduleManagerShell();


        /*
          관리자 변경사항을 반영하도록
          달력과 일정 화면에 새로고침 메시지를 보낸다.
        */
        const refreshMessage = {
          type:
            "gs-shift-log:refresh-inspection-schedule"
        };


        window.dispatchEvent(
          new MessageEvent(
            "message",

            {
              data:
                refreshMessage,

              origin:
                window.location.origin
            }
          )
        );


        try {
          if (
            window.parent &&
            window.parent !==
              window
          ) {
            window.parent.postMessage(
              refreshMessage,
              window.location.origin
            );
          }

        } catch (
          error
        ) {
          console.warn(
            "점검 일정 갱신 메시지 전달 실패:",
            error
          );
        }
      }
    )();
  },

  {
    once:
      true
  }
);

function initializeInspectionLogHub() {
  const STATUS_API =
    "/api/inspection-schedule-status";

  /*
    이 날짜보다 이전 일정은
    완료 기록이 없으므로 지연으로 계산하지 않는다.
  */
  const TRACKING_START_DATE =
    "2026-08-04";

  /*
    지연 점검은 최근 35일까지만 계산한다.
  */
  const OVERDUE_LOOKBACK_DAYS =
    35;

  /*
    화면에 펼쳐 표시할 지연 점검 최대 건수
  */
  const OVERDUE_DISPLAY_LIMIT =
    12;


  const byId =
    id => {
      return document.getElementById(
        id
      );
    };


  const scheduleDashboard =
    byId(
      "inspectionScheduleDashboard"
    );

  const todayHeaderDate =
    byId(
      "inspectionTodayHeaderDate"
    );

  const todayTotalCount =
    byId(
      "inspectionTodayTotalCount"
    );

  const todayPendingCount =
    byId(
      "inspectionTodayPendingCount"
    );

  const todayCompletedCount =
    byId(
      "inspectionTodayCompletedCount"
    );

  const todayOverdueCount =
    byId(
      "inspectionTodayOverdueCount"
    );

  const todayAlert =
    byId(
      "inspectionTodayAlert"
    );

  const todayAlertText =
    byId(
      "inspectionTodayAlertText"
    );

  const todayList =
    byId(
      "inspectionTodayList"
    );

  const todaySummary =
    scheduleDashboard
      ?.querySelector(
        ".inspection-today-summary"
      ) ||
    null;

  const todaySection =
    scheduleDashboard
      ?.querySelector(
        ".inspection-today-section"
      ) ||
    null;


  const openScheduleButton =
    byId(
      "openInspectionScheduleButton"
    );

  const closeScheduleButton =
    byId(
      "closeInspectionScheduleButton"
    );

  const schedulePanel =
    byId(
      "inspectionSchedulePanel"
    );

  const scheduleMonthInput =
    byId(
      "inspectionScheduleMonth"
    );

  const scheduleCategorySelect =
    byId(
      "inspectionScheduleCategory"
    );

  const scheduleList =
    byId(
      "inspectionScheduleList"
    );


  const tabNavigation =
    document.querySelector(
      ".inspection-log-tabs"
    );

  const tabButtons = [
    ...document.querySelectorAll(
      "[data-inspection-category]"
    )
  ];

  const logList =
    byId(
      "inspectionLogList"
    );

  const logCards = [
    ...document.querySelectorAll(
      "[data-inspection-category-item]"
    )
  ];

  const emptyMessage =
    byId(
      "inspectionLogEmpty"
    );

  const viewer =
    byId(
      "inspectionLogViewer"
    );

  const viewerFrame =
    byId(
      "inspectionLogFrame"
    );

  const viewerTitle =
    byId(
      "inspectionLogViewerTitle"
    );

  const backButton =
    byId(
      "inspectionLogBackButton"
    );


  if (
    !logList ||
    !viewer ||
    !viewerFrame
  ) {
    console.error(
      "점검일지 허브 필수 요소가 없습니다."
    );

    return;
  }


  let activeCategory =
    "daily";

  let statusLoading =
    false;

  let statusErrorMessage =
    "";

  let statusItems =
    [];

  let statusMap =
    new Map();


  const categoryLabelMap = {
    daily:
      "일간",

    weekly:
      "주간",

    monthly:
      "월간",

    quarterly:
      "분기",

    other:
      "기타"
  };


  const categoryOrderMap = {
    daily:
      1,

    weekly:
      2,

    monthly:
      3,

    quarterly:
      4,

    other:
      5
  };


  /* =====================================================
    HTML 특수문자 처리
  ====================================================== */

  function escapeHtml(
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


  /* =====================================================
    날짜 표시
  ====================================================== */

  function formatDateValue(
    date
  ) {
    return [
      date.getFullYear(),

      String(
        date.getMonth() +
        1
      ).padStart(
        2,
        "0"
      ),

      String(
        date.getDate()
      ).padStart(
        2,
        "0"
      )
    ].join(
      "-"
    );
  }


  function formatMonthValue(
    date
  ) {
    return [
      date.getFullYear(),

      String(
        date.getMonth() +
        1
      ).padStart(
        2,
        "0"
      )
    ].join(
      "-"
    );
  }


  function formatLongDate(
    date
  ) {
    return new Intl.DateTimeFormat(
      "ko-KR",
      {
        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",

        weekday:
          "long"
      }
    ).format(
      date
    );
  }


  function formatShortDate(
    dateValue
  ) {
    const date =
      createInspectionScheduleDate(
        dateValue
      );


    if (
      !date
    ) {
      return String(
        dateValue ||
        ""
      );
    }


    return new Intl.DateTimeFormat(
      "ko-KR",
      {
        month:
          "2-digit",

        day:
          "2-digit",

        weekday:
          "short"
      }
    ).format(
      date
    );
  }


  function formatCompletedAt(
    value
  ) {
    const date =
      new Date(
        value ||
        0
      );


    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return "";
    }


    return new Intl.DateTimeFormat(
      "ko-KR",
      {
        month:
          "2-digit",

        day:
          "2-digit",

        hour:
          "2-digit",

        minute:
          "2-digit",

        hour12:
          false
      }
    ).format(
      date
    );
  }


  function addDays(
    dateValue,
    dayCount
  ) {
    const date =
      createInspectionScheduleDate(
        dateValue
      );


    if (
      !date
    ) {
      return "";
    }


    date.setDate(
      date.getDate() +
      Number(
        dayCount ||
        0
      )
    );


    return formatDateValue(
      date
    );
  }


  /* =====================================================
    근무값 통일
  ====================================================== */

  function normalizeShift(
    value
  ) {
    const shift =
      String(
        value ||
        ""
      )
        .trim()
        .toUpperCase()
        .replaceAll(
          "/",
          ""
        )
        .replace(
          /\s+/g,
          ""
        );


    if (
      [
        "D",
        "DS"
      ].includes(
        shift
      )
    ) {
      return "DS";
    }


    if (
      [
        "N",
        "NS"
      ].includes(
        shift
      )
    ) {
      return "NS";
    }


    return "";
  }


  function getShiftLabel(
    value
  ) {
    const shift =
      normalizeShift(
        value
      );


    if (
      shift ===
      "DS"
    ) {
      return "D/S";
    }


    if (
      shift ===
      "NS"
    ) {
      return "N/S";
    }


    return "별도 지정";
  }


  /* =====================================================
    로그인 세션
  ====================================================== */

  function getSessionToken() {
    const savedUser =
      localStorage.getItem(
        "gsShiftLog.currentUser"
      );


    if (
      !savedUser
    ) {
      return "";
    }


    try {
      const parsedUser =
        JSON.parse(
          savedUser
        );


      return String(
        parsedUser?.sessionToken ||
        parsedUser?.session_token ||
        ""
      ).trim();

    } catch (
      error
    ) {
      console.warn(
        "점검 일정 로그인 정보를 읽지 못했습니다.",
        error
      );


      return "";
    }
  }


  function getAuthHeaders(
    extraHeaders = {}
  ) {
    const token =
      getSessionToken();


    return {
      Accept:
        "application/json",

      ...extraHeaders,

      ...(
        token
          ? {
              Authorization:
                `Bearer ${token}`
            }
          : {}
      )
    };
  }


  async function readApiResponse(
    response
  ) {
    const responseText =
      await response.text();


    let result = {};


    if (
      responseText.trim()
    ) {
      try {
        result =
          JSON.parse(
            responseText
          );

      } catch {
        throw new Error(
          "점검 일정 서버 응답 형식이 올바르지 않습니다."
        );
      }
    }


    if (
      !response.ok ||
      result.ok ===
        false
    ) {
      throw new Error(
        result.message ||
        result.error ||
        `점검 일정 요청에 실패했습니다. (HTTP ${response.status})`
      );
    }


    return result;
  }


  /* =====================================================
    완료 기록 식별키
  ====================================================== */

  function createStatusKey(
    scheduleId,
    dueDate,
    shift
  ) {
    return [
      String(
        scheduleId ||
        ""
      ).trim(),

      String(
        dueDate ||
        ""
      ).trim(),

      normalizeShift(
        shift
      )
    ].join(
      "||"
    );
  }


  function rebuildStatusMap() {
    statusMap =
      new Map();


    statusItems.forEach(
      item => {
        const key =
          createStatusKey(
            item.scheduleId,
            item.dueDate,
            item.shift
          );


        if (
          item.scheduleId &&
          item.dueDate
        ) {
          statusMap.set(
            key,
            item
          );
        }
      }
    );
  }


  function getCompletion(
    occurrence
  ) {
    return (
      statusMap.get(
        createStatusKey(
          occurrence
            .scheduleItem
            .id,

          occurrence
            .dueDate,

          occurrence
            .shift
        )
      ) ||
      null
    );
  }


  /* =====================================================
    일정 항목을 근무별로 분리

    D/S·N/S가 모두 지정된 일정은
    완료 상태를 각각 관리한다.
  ====================================================== */

  function expandOccurrences(
    scheduleItem,
    dueDate
  ) {
    const shifts =
      Array.isArray(
        scheduleItem?.shifts
      )
        ? [
            ...new Set(
              scheduleItem.shifts
                .map(
                  normalizeShift
                )
                .filter(
                  Boolean
                )
            )
          ]
        : [];


    const effectiveShifts =
      shifts.length
        ? shifts
        : [
            ""
          ];


    return effectiveShifts.map(
      shift => {
        return {
          scheduleItem,
          dueDate,
          shift
        };
      }
    );
  }


  function getOccurrencesForDate(
    dateValue
  ) {
    const result =
      getInspectionSchedulesForDate(
        dateValue
      );


    const required =
      result.dueItems
        .filter(
          item => {
            return (
              item.referenceOnly !==
              true
            );
          }
        )
        .flatMap(
          item => {
            return expandOccurrences(
              item,
              dateValue
            );
          }
        );


    const reference =
      result.dueItems
        .filter(
          item => {
            return (
              item.referenceOnly ===
              true
            );
          }
        )
        .flatMap(
          item => {
            return expandOccurrences(
              item,
              dateValue
            );
          }
        );


    const conditional =
      result.conditionalItems
        .flatMap(
          item => {
            return expandOccurrences(
              item,
              dateValue
            );
          }
        );


    return {
      required,
      reference,
      conditional
    };
  }


  /* =====================================================
    D1 조회 시작일
  ====================================================== */

  function getStatusQueryStartDate(
    todayValue
  ) {
    const lookbackStart =
      addDays(
        todayValue,
        -OVERDUE_LOOKBACK_DAYS
      );


    if (
      !lookbackStart
    ) {
      return TRACKING_START_DATE;
    }


    return (
      lookbackStart >
        TRACKING_START_DATE
        ? lookbackStart
        : TRACKING_START_DATE
    );
  }


  /* =====================================================
    D1 완료 기록 조회
  ====================================================== */

  async function loadStatusRecords(
    options = {}
  ) {
    const signal =
      options?.signal ||
      undefined;


    const monthStart =
      formatDateValue(
        new Date(
          monthCursor.getFullYear(),
          monthCursor.getMonth(),
          1
        )
      );


    const monthEnd =
      formatDateValue(
        new Date(
          monthCursor.getFullYear(),
          monthCursor.getMonth() +
            1,
          0
        )
      );


    const startDate =
      monthStart <
        TRACKING_START_DATE
        ? TRACKING_START_DATE
        : monthStart;


    if (
      startDate >
        monthEnd
    ) {
      statusMap =
        new Map();


      statusErrorMessage =
        "";


      return;
    }


    const url =
      new URL(
        STATUS_API,
        window.location.origin
      );


    url.searchParams.set(
      "startDate",
      startDate
    );


    url.searchParams.set(
      "endDate",
      monthEnd
    );


    url.searchParams.set(
      "_",
      String(
        Date.now()
      )
    );


    const response =
      await fetch(
        url.toString(),

        {
          method:
            "GET",

          headers:
            getAuthHeaders(),

          cache:
            "no-store",

          ...(
            signal
              ? {
                  signal
                }
              : {}
          )
        }
      );


    const result =
      await readApiResponse(
        response
      );


    const items =
      Array.isArray(
        result.items
      )
        ? result.items
        : [];


    statusMap =
      new Map();


    items.forEach(
      item => {
        statusMap.set(
          createStatusKey(
            item.scheduleId,
            item.dueDate,
            item.shift
          ),

          item
        );
      }
    );


    statusErrorMessage =
      "";
  }

  /* =====================================================
    지연 점검 계산

    제외:
    - 조건부 점검
    - 타부서 참고 점검
  ====================================================== */

  function getOverdueOccurrences(
    todayValue
  ) {
    const startDate =
      getStatusQueryStartDate(
        todayValue
      );


    const yesterday =
      addDays(
        todayValue,
        -1
      );


    const overdue = [];


    if (
      !yesterday ||
      startDate >
        yesterday
    ) {
      return overdue;
    }


    let currentDate =
      startDate;


    let safetyCount =
      0;


    while (
      currentDate <=
        yesterday &&
      safetyCount <
        400
    ) {
      const {
        required
      } =
        getOccurrencesForDate(
          currentDate
        );


      required.forEach(
        occurrence => {
          if (
            !getCompletion(
              occurrence
            )
          ) {
            overdue.push(
              occurrence
            );
          }
        }
      );


      currentDate =
        addDays(
          currentDate,
          1
        );


      safetyCount +=
        1;
    }


    return overdue.sort(
      (
        firstOccurrence,
        secondOccurrence
      ) => {
        const dateCompare =
          secondOccurrence
            .dueDate
            .localeCompare(
              firstOccurrence
                .dueDate
            );


        if (
          dateCompare !==
          0
        ) {
          return dateCompare;
        }


        return String(
          firstOccurrence
            .scheduleItem
            .title ||
          ""
        ).localeCompare(
          String(
            secondOccurrence
              .scheduleItem
              .title ||
            ""
          ),
          "ko"
        );
      }
    );
  }


  /* =====================================================
    연결된 점검일지 카드 찾기
  ====================================================== */

  function getLinkedCard(
    scheduleItem
  ) {
    if (
      !scheduleItem
    ) {
      return null;
    }


    const logKey =
      String(
        scheduleItem.logKey ||
        ""
      ).trim();


    if (
      logKey
    ) {
      const exactCard =
        logCards.find(
          card => {
            return (
              String(
                card.dataset
                  .inspectionLog ||
                ""
              ).trim() ===
              logKey
            );
          }
        );


      if (
        exactCard
      ) {
        return exactCard;
      }
    }


    const keyword =
      String(
        scheduleItem.titleKeyword ||
        ""
      )
        .trim()
        .toLowerCase();


    if (
      !keyword
    ) {
      return null;
    }


    return (
      logCards.find(
        card => {
          const title =
            String(
              card.querySelector(
                ".inspection-log-card__text strong"
              )?.textContent ||
              ""
            )
              .trim()
              .toLowerCase();


          return title.includes(
            keyword
          );
        }
      ) ||
      null
    );
  }


  /* =====================================================
    일정 카드 상세 정보
  ====================================================== */

  function createMetaHtml(
    scheduleItem,
    occurrence = null
  ) {
    const shiftLabel =
      occurrence
        ? getShiftLabel(
            occurrence.shift
          )
        : Array.isArray(
            scheduleItem.shifts
          ) &&
          scheduleItem.shifts.length
            ? scheduleItem.shifts.join(
                " · "
              )
            : "별도 지정";


    const items = [
      [
        "주기",
        scheduleItem.scheduleLabel ||
        "-"
      ],

      [
        "근무",
        shiftLabel
      ],

      [
        "위치",
        scheduleItem.position ||
        "-"
      ]
    ];


    if (
      occurrence?.dueDate
    ) {
      items.unshift([
        "예정일",
        formatShortDate(
          occurrence.dueDate
        )
      ]);
    }


    if (
      scheduleItem.approval &&
      scheduleItem.approval !==
        "-"
    ) {
      items.push([
        "결재",
        scheduleItem.approval
      ]);
    }


    if (
      scheduleItem.share &&
      scheduleItem.share !==
        "-"
    ) {
      items.push([
        "공유",
        scheduleItem.share
      ]);
    }


    return items
      .map(
        ([
          label,
          value
        ]) => {
          return `
            <span class="inspection-schedule-meta-item">

              <b>
                ${escapeHtml(
                  label
                )}
              </b>

              ${escapeHtml(
                value
              )}

            </span>
          `;
        }
      )
      .join(
        ""
      );
  }


  /* =====================================================
    연결 점검일지 열기 버튼
  ====================================================== */

  function createLogButtonHtml(
    scheduleItem
  ) {
    if (
      !getLinkedCard(
        scheduleItem
      )
    ) {
      return "";
    }


    return `
      <button
        type="button"
        class="inspection-schedule-log-button"
        data-open-inspection-log="${escapeHtml(
          scheduleItem.id
        )}"
      >
        점검일지 열기
      </button>
    `;
  }


  /* =====================================================
    완료·완료취소 버튼
  ====================================================== */

  function createStatusActionHtml(
    occurrence,
    completion,
    options = {}
  ) {
    const scheduleItem =
      occurrence.scheduleItem;


    if (
      scheduleItem.referenceOnly ===
      true
    ) {
      return `
        <span class="inspection-schedule-no-log is-reference">
          타부서 참고
        </span>
      `;
    }


    if (
      completion
    ) {
      const completedBy =
        String(
          completion.completedByName ||
          "완료자 확인 불가"
        ).trim();


      const completedAt =
        formatCompletedAt(
          completion.completedAt
        );


      return `
        <span class="inspection-schedule-completion-info">

          ${escapeHtml(
            completedBy
          )}

          ${
            completedAt
              ? ` · ${escapeHtml(
                  completedAt
                )}`
              : ""
          }

        </span>


        <button
          type="button"
          class="inspection-schedule-cancel-completion-button"
          data-cancel-inspection-completion="${escapeHtml(
            scheduleItem.id
          )}"
          data-due-date="${escapeHtml(
            occurrence.dueDate
          )}"
          data-shift="${escapeHtml(
            occurrence.shift
          )}"
        >
          완료 취소
        </button>
      `;
    }


    const label =
      options.conditional
        ? "해당 시 완료"
        : options.overdue
          ? "지연 점검 완료"
          : "완료 처리";


    return `
      <button
        type="button"
        class="inspection-schedule-complete-button"
        data-complete-inspection="${escapeHtml(
          scheduleItem.id
        )}"
        data-due-date="${escapeHtml(
          occurrence.dueDate
        )}"
        data-shift="${escapeHtml(
          occurrence.shift
        )}"
      >
        ${escapeHtml(
          label
        )}
      </button>
    `;
  }


  /* =====================================================
    오늘·지연 점검 카드
  ====================================================== */

  function createOccurrenceHtml(
    occurrence,
    options = {}
  ) {
    const scheduleItem =
      occurrence.scheduleItem;


    const completion =
      getCompletion(
        occurrence
      );


    const state =
      completion
        ? "completed"
        : options.overdue
          ? "overdue"
          : options.conditional
            ? "conditional"
            : options.reference
              ? "reference"
              : "today";


    const stateLabels = {
      today:
        "오늘 예정",

      overdue:
        "지연",

      completed:
        "완료",

      conditional:
        "조건 확인",

      reference:
        "참고"
    };


    const noteHtml =
      scheduleItem.note
        ? `
            <p class="inspection-schedule-item__note">

              ${escapeHtml(
                scheduleItem.note
              )}

            </p>
          `
        : "";


    return `
      <article
        class="inspection-schedule-item is-${escapeHtml(
          state
        )}"
        data-inspection-schedule-id="${escapeHtml(
          scheduleItem.id
        )}"
        data-inspection-due-date="${escapeHtml(
          occurrence.dueDate
        )}"
        data-inspection-shift="${escapeHtml(
          occurrence.shift
        )}"
      >

        <header class="inspection-schedule-item__header">

          <div class="inspection-schedule-item__badges">

            <span
              class="
                inspection-schedule-category-badge
                is-${escapeHtml(
                  scheduleItem.category
                )}
              "
            >
              ${escapeHtml(
                categoryLabelMap[
                  scheduleItem.category
                ] ||
                "기타"
              )}
            </span>


            <span
              class="
                inspection-schedule-state-badge
                is-${escapeHtml(
                  state
                )}
              "
            >
              ${escapeHtml(
                stateLabels[
                  state
                ] ||
                "예정"
              )}
            </span>

          </div>


          <h3>
            ${escapeHtml(
              scheduleItem.title
            )}
          </h3>

        </header>


        <div class="inspection-schedule-item__meta">

          ${createMetaHtml(
            scheduleItem,
            occurrence
          )}

        </div>


        ${noteHtml}


        <footer class="inspection-schedule-item__footer">

          ${createLogButtonHtml(
            scheduleItem
          )}

          ${createStatusActionHtml(
            occurrence,
            completion,
            options
          )}

        </footer>

      </article>
    `;
  }


  /* =====================================================
    전체 점검 일정 카드

    전체 일정 화면에서는
    완료 버튼을 표시하지 않는다.
  ====================================================== */

  function createMasterHtml(
    scheduleItem
  ) {
    const noteHtml =
      scheduleItem.note
        ? `
            <p class="inspection-schedule-item__note">

              ${escapeHtml(
                scheduleItem.note
              )}

            </p>
          `
        : "";


    const footerHtml =
      createLogButtonHtml(
        scheduleItem
      ) ||
      (
        scheduleItem.referenceOnly
          ? `
              <span class="inspection-schedule-no-log is-reference">
                타부서 참고
              </span>
            `
          : `
              <span class="inspection-schedule-no-log">
                전용 점검일지 없음
              </span>
            `
      );


    return `
      <article class="inspection-schedule-item is-scheduled">

        <header class="inspection-schedule-item__header">

          <div class="inspection-schedule-item__badges">

            <span
              class="
                inspection-schedule-category-badge
                is-${escapeHtml(
                  scheduleItem.category
                )}
              "
            >
              ${escapeHtml(
                categoryLabelMap[
                  scheduleItem.category
                ] ||
                "기타"
              )}
            </span>


            <span class="inspection-schedule-state-badge is-scheduled">
              예정
            </span>

          </div>


          <h3>
            ${escapeHtml(
              scheduleItem.title
            )}
          </h3>

        </header>


        <div class="inspection-schedule-item__meta">

          ${createMetaHtml(
            scheduleItem
          )}

        </div>


        ${noteHtml}


        <footer class="inspection-schedule-item__footer">

          ${footerHtml}

        </footer>

      </article>
    `;
  }


  /* =====================================================
    부모 화면에 미완료·지연 건수 전달

    다음 단계에서 점검일지 메뉴 배지와 연결한다.
  ====================================================== */

  function publishCounts(
    pendingCount,
    overdueCount
  ) {
    try {
      if (
        window.parent &&
        window.parent !==
          window
      ) {
        window.parent.postMessage(
          {
            type:
              "gs-shift-log:inspection-schedule-counts",

            pendingCount:
              Number(
                pendingCount
              ) ||
              0,

            overdueCount:
              Number(
                overdueCount
              ) ||
              0
          },

          window.location.origin
        );
      }

    } catch (
      error
    ) {
      console.warn(
        "점검 일정 건수를 부모 화면으로 전달하지 못했습니다.",
        error
      );
    }
  }


  /* =====================================================
    오늘 점검 목록
  ====================================================== */

  function renderTodaySchedules() {
    if (
      !scheduleDashboard ||
      !todayList
    ) {
      return;
    }


    const today =
      new Date();


    const todayValue =
      formatDateValue(
        today
      );


    const {
      required,
      reference,
      conditional
    } =
      getOccurrencesForDate(
        todayValue
      );


    const completed =
      required.filter(
        getCompletion
      );


    const pending =
      required.filter(
        occurrence => {
          return !getCompletion(
            occurrence
          );
        }
      );


    const overdue =
      getOverdueOccurrences(
        todayValue
      );


    if (
      todayHeaderDate
    ) {
      todayHeaderDate.textContent =
        formatLongDate(
          today
        );
    }


    if (
      todayTotalCount
    ) {
      todayTotalCount.textContent =
        String(
          required.length
        );
    }


    if (
      todayPendingCount
    ) {
      todayPendingCount.textContent =
        String(
          pending.length
        );
    }


    if (
      todayCompletedCount
    ) {
      todayCompletedCount.textContent =
        String(
          completed.length
        );
    }


    if (
      todayOverdueCount
    ) {
      todayOverdueCount.textContent =
        String(
          overdue.length
        );
    }


    const alertParts = [];


    if (
      pending.length
    ) {
      alertParts.push(
        `오늘 미완료 점검 ${pending.length}건`
      );
    }


    if (
      overdue.length
    ) {
      alertParts.push(
        `지연 점검 ${overdue.length}건`
      );
    }


    if (
      conditional.length
    ) {
      alertParts.push(
        `조건 확인 ${conditional.length}건`
      );
    }


    if (
      statusErrorMessage
    ) {
      alertParts.push(
        statusErrorMessage
      );
    }


    if (
      todayAlert &&
      todayAlertText
    ) {
      todayAlertText.textContent =
        alertParts.length
          ? alertParts.join(
              " · "
            )
          : "오늘 예정된 점검이 모두 완료되었습니다.";


      todayAlert.hidden =
        false;


      todayAlert.classList.toggle(
        "is-complete",
        alertParts.length ===
          0
      );
    }


    const visibleOverdue =
      overdue.slice(
        0,
        OVERDUE_DISPLAY_LIMIT
      );


    const items = [
      ...visibleOverdue.map(
        occurrence => {
          return {
            occurrence,
            overdue:
              true
          };
        }
      ),

      ...required.map(
        occurrence => {
          return {
            occurrence
          };
        }
      ),

      ...conditional.map(
        occurrence => {
          return {
            occurrence,
            conditional:
              true
          };
        }
      ),

      ...reference.map(
        occurrence => {
          return {
            occurrence,
            reference:
              true
          };
        }
      )
    ];


    if (
      !items.length
    ) {
      todayList.innerHTML = `
        <div class="inspection-schedule-empty">

          오늘 예정된 점검이 없습니다.

        </div>
      `;


      publishCounts(
        0,
        0
      );


      return;
    }


    const hiddenOverdueCount =
      Math.max(
        0,

        overdue.length -
        visibleOverdue.length
      );


    const moreHtml =
      hiddenOverdueCount
        ? `
            <div class="inspection-schedule-overdue-more">

              지연 점검 ${hiddenOverdueCount}건이 더 있습니다.

            </div>
          `
        : "";


    todayList.innerHTML =
      items
        .map(
          item => {
            return createOccurrenceHtml(
              item.occurrence,
              item
            );
          }
        )
        .join(
          ""
        ) +
      moreHtml;


    publishCounts(
      pending.length,
      overdue.length
    );
  }


  /* =====================================================
    전체 점검 일정
  ====================================================== */

  function renderMonthlySchedules() {
    if (
      !scheduleList ||
      !scheduleMonthInput
    ) {
      return;
    }


    const match =
      String(
        scheduleMonthInput.value ||
        ""
      )
        .trim()
        .match(
          /^(\d{4})-(\d{2})$/
        );


    if (
      !match
    ) {
      scheduleList.innerHTML = `
        <div class="inspection-schedule-empty">

          기준 월을 선택해 주세요.

        </div>
      `;


      return;
    }


    const category =
      String(
        scheduleCategorySelect?.value ||
        ""
      ).trim();


    const items =
      getInspectionSchedulesForMonth(
        Number(
          match[1]
        ),

        Number(
          match[2]
        ),

        category
      )
        .slice()
        .sort(
          (
            firstItem,
            secondItem
          ) => {
            const orderDifference =
              (
                categoryOrderMap[
                  firstItem.category
                ] ||
                99
              ) -
              (
                categoryOrderMap[
                  secondItem.category
                ] ||
                99
              );


            return (
              orderDifference ||

              String(
                firstItem.title ||
                ""
              ).localeCompare(
                String(
                  secondItem.title ||
                  ""
                ),
                "ko"
              )
            );
          }
        );


    scheduleList.innerHTML =
      items.length
        ? items
            .map(
              createMasterHtml
            )
            .join(
              ""
            )
        : `
            <div class="inspection-schedule-empty">

              선택한 조건에 해당하는 점검 일정이 없습니다.

            </div>
          `;
  }


  /* =====================================================
    완료 기록 새로고침
  ====================================================== */

  async function refreshStatus() {
    if (
      statusLoading
    ) {
      return;
    }


    statusLoading =
      true;


    calendarGrid.setAttribute(
      "aria-busy",
      "true"
    );


    selectedList.setAttribute(
      "aria-busy",
      "true"
    );


    /*
      D1 완료 기록을 기다리지 않고
      기본 점검 일정부터 즉시 표시한다.

      이 코드로 인해 API가 느려도
      달력과 선택 날짜 목록은 바로 나타난다.
    */
    try {
      renderAll();

    } catch (
      error
    ) {
      console.error(
        "점검 달력 기본 일정 출력 실패:",
        error
      );
    }


    const abortController =
      typeof AbortController ===
        "function"
        ? new AbortController()
        : null;


    let timeoutId =
      0;


    /*
      완료 기록 API가 8초 이상 응답하지 않으면
      요청을 중단하고 기본 일정으로 계속 사용한다.
    */
    if (
      abortController
    ) {
      timeoutId =
        window.setTimeout(
          () => {
            abortController.abort();
          },

          8000
        );
    }


    try {
      await loadStatusRecords({
        signal:
          abortController?.signal
      });

    } catch (
      error
    ) {
      console.error(
        "달력 점검 완료 기록 조회 실패:",
        error
      );


      /*
        완료 기록을 못 가져와도
        기본 점검 일정은 유지한다.
      */
      statusMap =
        new Map();


      statusErrorMessage =
        error?.name ===
          "AbortError"
          ? "완료 기록 조회가 지연되어 기본 일정으로 표시합니다."
          : (
              error instanceof Error
                ? error.message
                : "점검 완료 기록을 불러오지 못했습니다."
            );

    } finally {
      if (
        timeoutId
      ) {
        window.clearTimeout(
          timeoutId
        );
      }


      statusLoading =
        false;


      calendarGrid.removeAttribute(
        "aria-busy"
      );


      selectedList.removeAttribute(
        "aria-busy"
      );


      /*
        완료 기록을 반영하여 다시 출력한다.
      */
      try {
        renderAll();

      } catch (
        error
      ) {
        console.error(
          "점검 달력 최종 출력 실패:",
          error
        );
      }


      /*
        상위 업무일지의 보직별 현황 조회는
        달력 출력을 막지 않도록 별도로 실행한다.
      */
      void publishRoleTodaySummary();
    }
  }

  /* =====================================================
    완료 처리
  ====================================================== */

  async function completeSchedule(
    button
  ) {
    const scheduleId =
      String(
        button.dataset
          .completeInspection ||
        ""
      ).trim();


    const dueDate =
      String(
        button.dataset
          .dueDate ||
        ""
      ).trim();


    const shift =
      normalizeShift(
        button.dataset
          .shift
      );


    const scheduleItem =
      INSPECTION_SCHEDULE_MASTER.find(
        item => {
          return (
            item.id ===
            scheduleId
          );
        }
      );


    if (
      !scheduleItem ||
      !dueDate
    ) {
      window.alert(
        "완료 처리할 점검 정보를 확인할 수 없습니다."
      );


      return;
    }


    const confirmed =
      window.confirm(
        [
          "점검을 완료 처리하시겠습니까?",
          "",
          scheduleItem.title,
          `예정일: ${dueDate}`,
          `근무: ${getShiftLabel(
            shift
          )}`
        ].join(
          "\n"
        )
      );


    if (
      !confirmed
    ) {
      return;
    }


    const originalText =
      button.textContent;


    button.disabled =
      true;


    button.textContent =
      "처리 중...";


    try {
      const response =
        await fetch(
          STATUS_API,
          {
            method:
              "POST",

            headers:
              getAuthHeaders({
                "Content-Type":
                  "application/json"
              }),

            cache:
              "no-store",

            body:
              JSON.stringify({
                scheduleId,
                dueDate,
                shift,

                scheduleTitle:
                  scheduleItem.title,

                note:
                  ""
              })
          }
        );


      const result =
        await readApiResponse(
          response
        );


      window.alert(
        result.message ||
        "점검을 완료 처리했습니다."
      );


      await refreshStatus();

    } catch (
      error
    ) {
      console.error(
        "점검 완료 처리 실패:",
        error
      );


      window.alert(
        error instanceof Error
          ? error.message
          : "점검을 완료 처리하지 못했습니다."
      );


      button.disabled =
        false;


      button.textContent =
        originalText;
    }
  }


  /* =====================================================
    완료 취소
  ====================================================== */

  async function cancelCompletion(
    button
  ) {
    const scheduleId =
      String(
        button.dataset
          .cancelInspectionCompletion ||
        ""
      ).trim();


    const dueDate =
      String(
        button.dataset
          .dueDate ||
        ""
      ).trim();


    const shift =
      normalizeShift(
        button.dataset
          .shift
      );


    const scheduleItem =
      INSPECTION_SCHEDULE_MASTER.find(
        item => {
          return (
            item.id ===
            scheduleId
          );
        }
      );


    if (
      !scheduleItem ||
      !dueDate
    ) {
      window.alert(
        "완료 취소할 점검 정보를 확인할 수 없습니다."
      );


      return;
    }


    const confirmed =
      window.confirm(
        [
          "점검 완료를 취소하시겠습니까?",
          "",
          scheduleItem.title,
          `예정일: ${dueDate}`,
          `근무: ${getShiftLabel(
            shift
          )}`
        ].join(
          "\n"
        )
      );


    if (
      !confirmed
    ) {
      return;
    }


    const originalText =
      button.textContent;


    button.disabled =
      true;


    button.textContent =
      "취소 중...";


    try {
      const url =
        new URL(
          STATUS_API,
          window.location.origin
        );


      url.searchParams.set(
        "scheduleId",
        scheduleId
      );


      url.searchParams.set(
        "dueDate",
        dueDate
      );


      url.searchParams.set(
        "shift",
        shift
      );


      const response =
        await fetch(
          url.toString(),
          {
            method:
              "DELETE",

            headers:
              getAuthHeaders(),

            cache:
              "no-store"
          }
        );


      const result =
        await readApiResponse(
          response
        );


      window.alert(
        result.message ||
        "점검 완료를 취소했습니다."
      );


      await refreshStatus();

    } catch (
      error
    ) {
      console.error(
        "점검 완료 취소 실패:",
        error
      );


      window.alert(
        error instanceof Error
          ? error.message
          : "점검 완료를 취소하지 못했습니다."
      );


      button.disabled =
        false;


      button.textContent =
        originalText;
    }
  }


  /* =====================================================
    오늘 점검 화면
  ====================================================== */

  function showHubView() {
    viewer.hidden =
      true;


    viewerFrame.src =
      "about:blank";


    if (
      scheduleDashboard
    ) {
      scheduleDashboard.hidden =
        false;
    }


    if (
      todaySummary
    ) {
      todaySummary.hidden =
        false;
    }


    if (
      todaySection
    ) {
      todaySection.hidden =
        false;
    }


    if (
      schedulePanel
    ) {
      schedulePanel.hidden =
        true;
    }


    if (
      tabNavigation
    ) {
      tabNavigation.hidden =
        false;
    }


    logList.hidden =
      false;


    renderTodaySchedules();
  }


  /* =====================================================
    전체 일정 화면
  ====================================================== */

  function showScheduleView() {
    viewer.hidden =
      true;


    viewerFrame.src =
      "about:blank";


    if (
      scheduleDashboard
    ) {
      scheduleDashboard.hidden =
        false;
    }


    if (
      todaySummary
    ) {
      todaySummary.hidden =
        true;
    }


    if (
      todaySection
    ) {
      todaySection.hidden =
        true;
    }


    if (
      todayAlert
    ) {
      todayAlert.hidden =
        true;
    }


    if (
      schedulePanel
    ) {
      schedulePanel.hidden =
        false;
    }


    if (
      tabNavigation
    ) {
      tabNavigation.hidden =
        true;
    }


    logList.hidden =
      true;


    renderMonthlySchedules();
  }


  /* =====================================================
    점검일지 분류 선택
  ====================================================== */

  function selectCategory(
    category
  ) {
    const normalizedCategory =
      String(
        category ||
        "daily"
      ).trim();


    activeCategory =
      normalizedCategory;


    let visibleCount =
      0;


    tabButtons.forEach(
      button => {
        const active =
          button.dataset
            .inspectionCategory ===
          normalizedCategory;


        button.classList.toggle(
          "is-active",
          active
        );


        button.setAttribute(
          "aria-selected",
          active
            ? "true"
            : "false"
        );
      }
    );


    logCards.forEach(
      card => {
        const visible =
          card.dataset
            .inspectionCategoryItem ===
          normalizedCategory;


        card.hidden =
          !visible;


        if (
          visible
        ) {
          visibleCount +=
            1;
        }
      }
    );


    if (
      emptyMessage
    ) {
      emptyMessage.hidden =
        visibleCount !==
        0;
    }


    showHubView();
  }


  /* =====================================================
    점검일지 iframe 열기
  ====================================================== */

  function openInspectionLog(
    card
  ) {
    const pagePath =
      String(
        card?.dataset
          ?.inspectionPath ||
        ""
      ).trim();


    if (
      !pagePath
    ) {
      window.alert(
        "점검일지 연결 경로가 없습니다."
      );


      return;
    }


    const title =
      String(
        card.querySelector(
          ".inspection-log-card__text strong"
        )?.textContent ||
        "점검일지"
      ).trim();


    if (
      viewerTitle
    ) {
      viewerTitle.textContent =
        title;
    }


    viewerFrame.src =
      pagePath;


    if (
      scheduleDashboard
    ) {
      scheduleDashboard.hidden =
        true;
    }


    if (
      tabNavigation
    ) {
      tabNavigation.hidden =
        true;
    }


    logList.hidden =
      true;


    viewer.hidden =
      false;
  }


  function openLogFromSchedule(
    scheduleId
  ) {
    const scheduleItem =
      INSPECTION_SCHEDULE_MASTER.find(
        item => {
          return (
            item.id ===
            scheduleId
          );
        }
      );


    const linkedCard =
      getLinkedCard(
        scheduleItem
      );


    if (
      !linkedCard
    ) {
      window.alert(
        "연결된 전용 점검일지가 없습니다."
      );


      return;
    }


    openInspectionLog(
      linkedCard
    );
  }


  /* =====================================================
    일정 버튼 처리
  ====================================================== */

  function handleScheduleClick(
    event
  ) {
    const target =
      event.target instanceof
        Element
        ? event.target
        : null;


    const openButton =
      target?.closest(
        "[data-open-inspection-log]"
      );


    if (
      openButton
    ) {
      openLogFromSchedule(
        String(
          openButton.dataset
            .openInspectionLog ||
          ""
        ).trim()
      );


      return;
    }


    const completeButton =
      target?.closest(
        "[data-complete-inspection]"
      );


    if (
      completeButton
    ) {
      completeSchedule(
        completeButton
      );


      return;
    }


    const cancelButton =
      target?.closest(
        "[data-cancel-inspection-completion]"
      );


    if (
      cancelButton
    ) {
      cancelCompletion(
        cancelButton
      );
    }
  }


  /* =====================================================
    이벤트 연결
  ====================================================== */

  tabButtons.forEach(
    button => {
      button.addEventListener(
        "click",
        () => {
          selectCategory(
            button.dataset
              .inspectionCategory
          );
        }
      );
    }
  );


  logList.addEventListener(
    "click",
    event => {
      const target =
        event.target instanceof
          Element
          ? event.target
          : null;


      const card =
        target?.closest(
          "[data-inspection-category-item]"
        );


      if (
        card &&
        !card.hidden
      ) {
        openInspectionLog(
          card
        );
      }
    }
  );


  todayList?.addEventListener(
    "click",
    handleScheduleClick
  );


  scheduleList?.addEventListener(
    "click",
    handleScheduleClick
  );


  openScheduleButton
    ?.addEventListener(
      "click",
      showScheduleView
    );


  closeScheduleButton
    ?.addEventListener(
      "click",
      () => {
        selectCategory(
          activeCategory
        );
      }
    );


  scheduleMonthInput
    ?.addEventListener(
      "change",
      renderMonthlySchedules
    );


  scheduleCategorySelect
    ?.addEventListener(
      "change",
      renderMonthlySchedules
    );


  backButton
    ?.addEventListener(
      "click",
      () => {
        selectCategory(
          activeCategory
        );
      }
    );


  /*
    전용 점검일지에서 저장 후
    완료 상태를 다시 불러올 때 사용한다.
  */
  window.addEventListener(
    "message",
    event => {
      if (
        event.origin ===
          window.location.origin &&
        event.data?.type ===
          "gs-shift-log:refresh-inspection-schedule"
      ) {
        refreshStatus();
      }
    }
  );


  /* =====================================================
    최초 실행
  ====================================================== */

  const today =
    new Date();


  if (
    scheduleMonthInput &&
    !scheduleMonthInput.value
  ) {
    scheduleMonthInput.value =
      formatMonthValue(
        today
      );
  }


  renderMonthlySchedules();


  selectCategory(
    "daily"
  );


  refreshStatus();
}
