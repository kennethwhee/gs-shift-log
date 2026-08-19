param(
    [string]$Repo = 'C:\Users\GSENR\Desktop\gs-shift-log'
)

$ErrorActionPreference = 'Stop'

Set-Location $Repo

$Server = Join-Path $Repo 'functions\api\ois-data-requests.js'
$Agent  = Join-Path $Repo 'local-tools\ois-agent\ois-login.js'
$Node   = 'C:\Program Files\nodejs\node.exe'

foreach ($Path in @($Server, $Agent, $Node)) {
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "필수 파일을 찾지 못했습니다: $Path"
    }
}

Write-Host '===== Phase 2.4B Batch 2-Lane 패치 ====='
Write-Host "Server: $Server"
Write-Host "Agent : $Agent"

$ServerText = [IO.File]::ReadAllText($Server)
$AgentText  = [IO.File]::ReadAllText($Agent)

if (
    $ServerText.Contains('[PHASE2.4B-SERVER]') -or
    $AgentText.Contains('[PHASE2.4B-AGENT]')
) {
    throw 'Phase 2.4B 마커가 이미 있습니다. 중복 적용하지 않습니다.'
}

$ServerNl =
    if ($ServerText.Contains("`r`n")) {
        "`r`n"
    } else {
        "`n"
    }

$AgentNl =
    if ($AgentText.Contains("`r`n")) {
        "`r`n"
    } else {
        "`n"
    }

function Convert-NL {
    param(
        [string]$Value,
        [string]$NewLine
    )

    $converted =
        $Value.Replace(
            "`r`n",
            "`n"
        )

    $converted =
        $converted.Replace(
            "`r",
            "`n"
        )

    $converted =
        $converted.Replace(
            "`n",
            $NewLine
        )

    return $converted
}

$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

$ServerBackup =
    "$Server.before-phase24b-$Stamp.bak"

$AgentBackup =
    "$Agent.before-phase24b-$Stamp.bak"

Copy-Item `
    -LiteralPath $Server `
    -Destination $ServerBackup `
    -Force

Copy-Item `
    -LiteralPath $Agent `
    -Destination $AgentBackup `
    -Force

Write-Host "Server backup: $ServerBackup"
Write-Host "Agent backup : $AgentBackup"

try {
    # =========================================================
    # SERVER
    #
    # 명시적인 DB batch_id 컬럼을 추가하지 않는다.
    #
    # 같은 사용자가 같은 전체조회 클릭에서 만든 요청들은
    # requested_at이 매우 가깝고,
    # 수처리와 나머지 자동수치 target_date 차이는 최대 1일이다.
    #
    # 따라서:
    # - 동일 requested_by_id
    # - 최신 pending 요청 기준 ±20초
    # - target_date 차이 최대 1일
    #
    # 조건으로 하나의 논리 Batch를 묶는다.
    #
    # 반환 lane:
    # - water : 수처리 최대 1건
    # - ois   : 석회석 → Gear → Silo 중 최대 1건
    # - excel : daily_data_excel 최대 1건
    #
    # 한 번에 OIS 2건까지만 claim하므로
    # Agent는 2-Lane으로 안전하게 처리한다.
    # =========================================================

    $ServerInsertAnchor =
        'function getOisAgentLaneErrorMessage('

    $ServerInsertIndex =
        $ServerText.IndexOf(
            $ServerInsertAnchor
        )

    if ($ServerInsertIndex -lt 0) {
        throw 'SERVER 함수 삽입 위치를 찾지 못했습니다.'
    }

    $ServerFunction = Convert-NL -NewLine $ServerNl -Value @'
/*
  [PHASE2.4B-SERVER]

  오전회의 논리 Batch 2-Lane claim

  DB schema 변경 없이 현재 ois_data_requests의
  requested_by_id / requested_at / target_date를 사용한다.

  같은 사용자의 전체조회 요청은 거의 동시에 생성되며,
  수처리 기준일과 나머지 기준일은 최대 1일 차이가 난다.

  한 번에:
  - water_environment 1건
  - limestone_stock / turbine_gear_pinion / silo_level 중 1건
  - daily_data_excel 1건
  까지만 claim한다.

  따라서 OIS는 최대 2-Lane만 동시에 움직인다.
*/
async function handleAgentNextMorningTwoLaneRequests(
  context
) {
  const authentication =
    await authenticateOisAgent(
      context
    );


  if (
    authentication.error
  ) {
    return authentication.error;
  }


  await expireOldRequests(
    context.env.DB
  );


  const morningRequestTypes = [
    "water_environment",
    "limestone_stock",
    "turbine_gear_pinion",
    "silo_level",
    "daily_data_excel"
  ];


  /*
    최신 pending 오전회의 요청을
    현재 논리 Batch의 anchor로 사용한다.

    예전 실패 테스트의 오래된 pending 요청이 있어도
    새 전체조회 요청이 들어오면 최신 요청이 우선된다.
  */
  const anchorRow =
    await context.env.DB
      .prepare(`
        SELECT
          *

        FROM ois_data_requests

        WHERE
          status = 'pending'

          AND request_type IN (
            'water_environment',
            'limestone_stock',
            'turbine_gear_pinion',
            'silo_level',
            'daily_data_excel'
          )

        ORDER BY
          requested_at DESC,
          id DESC

        LIMIT 1
      `)
      .first();


  if (
    !anchorRow
  ) {
    return jsonResponse({
      ok:
        true,

      items: {
        water:
          null,

        ois:
          null,

        excel:
          null
      },

      batch:
        null
    });
  }


  const anchorRequestedAtText =
    normalizeText(
      anchorRow.requested_at
    );


  const anchorRequestedAt =
    new Date(
      anchorRequestedAtText
    );


  const anchorTargetDate =
    normalizeText(
      anchorRow.target_date
    );


  const requestedById =
    normalizeText(
      anchorRow.requested_by_id
    );


  if (
    Number.isNaN(
      anchorRequestedAt.getTime()
    ) ||
    !anchorTargetDate
  ) {
    return jsonResponse(
      {
        ok:
          false,

        message:
          "오전회의 Batch 기준 요청의 날짜 정보를 확인하지 못했습니다."
      },
      500
    );
  }


  const logicalBatchWindowMs =
    20 *
    1000;


  const batchStartText =
    new Date(
      anchorRequestedAt.getTime() -
      logicalBatchWindowMs
    )
      .toISOString();


  const batchEndText =
    new Date(
      anchorRequestedAt.getTime() +
      logicalBatchWindowMs
    )
      .toISOString();


  const groupedResult =
    await context.env.DB
      .prepare(`
        SELECT
          *

        FROM ois_data_requests

        WHERE
          status = 'pending'

          AND requested_by_id = ?

          AND requested_at >= ?
          AND requested_at <= ?

          AND request_type IN (
            'water_environment',
            'limestone_stock',
            'turbine_gear_pinion',
            'silo_level',
            'daily_data_excel'
          )

          AND ABS(
            julianday(
              target_date
            ) -
            julianday(
              ?
            )
          ) <=
            1.01

        ORDER BY
          requested_at ASC,
          id ASC
      `)
      .bind(
        requestedById,
        batchStartText,
        batchEndText,
        anchorTargetDate
      )
      .all();


  const groupedRows =
    Array.isArray(
      groupedResult?.results
    )
      ? groupedResult.results
      : [];


  const findType =
    requestType => {
      return (
        groupedRows.find(
          row => {
            return normalizeText(
              row?.request_type
            ) ===
              requestType;
          }
        ) ||
        null
      );
    };


  const waterCandidate =
    findType(
      "water_environment"
    );


  /*
    Lane B는 기존 체감 순서를 유지한다.

    석회석 → Gear → Silo

    한 poll에서 한 건만 claim하므로
    같은 OIS page를 동시에 건드리지 않는다.
  */
  const oisCandidate =
    [
      "limestone_stock",
      "turbine_gear_pinion",
      "silo_level"
    ]
      .map(
        findType
      )
      .find(
        Boolean
      ) ||
    null;


  const excelCandidate =
    findType(
      "daily_data_excel"
    );


  const laneEntries = [
    {
      laneName:
        "water",

      candidate:
        waterCandidate
    },

    {
      laneName:
        "ois",

      candidate:
        oisCandidate
    },

    {
      laneName:
        "excel",

      candidate:
        excelCandidate
    }
  ]
    .filter(
      laneEntry => {
        return Boolean(
          laneEntry.candidate
        );
      }
    );


  const items = {
    water:
      null,

    ois:
      null,

    excel:
      null
  };


  const laneErrors = {
    water:
      "",

    ois:
      "",

    excel:
      ""
  };


  const claimResults =
    await Promise.allSettled(
      laneEntries.map(
        laneEntry => {
          return claimOisAgentLaneCandidate(
            context.env.DB,
            laneEntry.candidate,
            authentication.agentId
          );
        }
      )
    );


  claimResults.forEach(
    (
      claimResult,
      claimIndex
    ) => {
      const laneEntry =
        laneEntries[
          claimIndex
        ];


      if (
        !laneEntry
      ) {
        return;
      }


      if (
        claimResult.status ===
          "rejected"
      ) {
        laneErrors[
          laneEntry.laneName
        ] =
          getOisAgentLaneErrorMessage(
            claimResult.reason,
            `${laneEntry.laneName} lane claim 실패`
          );

        return;
      }


      if (
        claimResult.value
      ) {
        items[
          laneEntry.laneName
        ] =
          claimResult.value;
      }
    }
  );


  return jsonResponse({
    ok:
      true,

    items,

    laneErrors,

    batch: {
      requestedById,

      anchorRequestId:
        normalizeText(
          anchorRow.id
        ),

      anchorTargetDate,

      anchorRequestedAt:
        anchorRequestedAtText,

      windowSeconds:
        logicalBatchWindowMs /
        1000,

      groupedPendingCount:
        groupedRows.length,

      groupedRequestTypes:
        groupedRows.map(
          row => {
            return normalizeText(
              row?.request_type
            );
          }
        )
    }
  });
}


'@

    $ServerText =
        $ServerText.Insert(
            $ServerInsertIndex,
            $ServerFunction
        )


    # GET action 분기 추가
    $NextLanesPattern =
        '(?m)^    if \(\r?\n      action ===\r?\n        "next_lanes"\r?\n    \) \{'

    $NextLanesMatch =
        [regex]::Match(
            $ServerText,
            $NextLanesPattern
        )

    if (
        -not $NextLanesMatch.Success
    ) {
        throw 'SERVER next_lanes GET 분기 위치를 찾지 못했습니다.'
    }

    $NewServerAction = Convert-NL -NewLine $ServerNl -Value @'
    /*
      Phase 2.4B 오전회의 논리 Batch 2-Lane
    */
    if (
      action ===
        "next_morning_2lane"
    ) {
      return await handleAgentNextMorningTwoLaneRequests(
        context
      );
    }


'@

    $ServerText =
        $ServerText.Insert(
            $NextLanesMatch.Index,
            $NewServerAction
        )


    # =========================================================
    # AGENT
    #
    # getNextOisAgentLaneRequests 전체 교체
    #
    # morning:
    # - water 1
    # - normal OIS 1
    # - Excel 1
    #
    # other:
    # - auxiliary_materials / logsheet_approval
    # - steam_status / logsheet_pdf
    # =========================================================

    $AgentFunctionStart =
        $AgentText.IndexOf(
            'async function getNextOisAgentLaneRequests('
        )

    if (
        $AgentFunctionStart -lt 0
    ) {
        throw 'AGENT getNextOisAgentLaneRequests 시작점을 찾지 못했습니다.'
    }

    $AgentFunctionEnd =
        $AgentText.IndexOf(
            '/* =========================================================',
            $AgentFunctionStart + 10
        )

    if (
        $AgentFunctionEnd -lt 0
    ) {
        throw 'AGENT getNextOisAgentLaneRequests 끝 경계를 찾지 못했습니다.'
    }

    $AgentFunction = Convert-NL -NewLine $AgentNl -Value @'
async function getNextOisAgentLaneRequests(
  config
) {
  if (
    config.agentMode ===
      "excel"
  ) {
    const excelItem =
      await getNextOisAgentRequest(
        config
      );


    return excelItem
      ? [
          excelItem
        ]
      : [];
  }


  /*
    [PHASE2.4B-AGENT]

    오전회의는 서버에서 같은 논리 Batch로 묶은 뒤
    OIS 최대 2건 + Excel 최대 1건만 가져온다.

    water:
      독립 Water Browser에서 처리

    ois:
      기존 Main Browser에서 처리

    excel:
      Browser 없이 기존 Excel 처리
  */
  const morningPromise =
    requestOisAgentApi(
      config,

      getOisAgentApiUrl(
        config,
        {
          action:
            "next_morning_2lane",

          _:
            Date.now()
        }
      )
    );


  /*
    오전회의 이외의 요청은 기존 lane 구조를 유지한다.

    morning handler와 요청유형이 겹치지 않으므로
    중복 claim하지 않는다.
  */
  const otherLanePromise =
    requestOisAgentApi(
      config,

      getOisAgentApiUrl(
        config,
        {
          action:
            "next_lanes",

          oisRequestTypes:
            [
              "auxiliary_materials",
              "logsheet_approval"
            ].join(
              ","
            ),

          excelRequestTypes:
            [
              "steam_status",
              "logsheet_pdf"
            ].join(
              ","
            ),

          _:
            Date.now()
        }
      )
    );


  const [
    morningResult,
    otherLaneResult
  ] =
    await Promise.all([
      morningPromise,
      otherLanePromise
    ]);


  Object.entries(
    morningResult?.laneErrors ||
    {}
  )
    .filter(
      (
        [
          laneName,
          laneError
        ]
      ) => {
        return Boolean(
          normalizeOisAgentText(
            laneError
          )
        );
      }
    )
    .forEach(
      (
        [
          laneName,
          laneError
        ]
      ) => {
        console.warn(
          `[PHASE2.4B] ${laneName} lane claim 오류: ${normalizeOisAgentText(
            laneError
          )}`
        );
      }
    );


  Object.entries(
    otherLaneResult?.laneErrors ||
    {}
  )
    .filter(
      (
        [
          laneName,
          laneError
        ]
      ) => {
        return Boolean(
          normalizeOisAgentText(
            laneError
          )
        );
      }
    )
    .forEach(
      (
        [
          laneName,
          laneError
        ]
      ) => {
        console.warn(
          `${laneName} lane 요청 확인 실패: ${normalizeOisAgentText(
            laneError
          )}`
        );
      }
    );


  const morningWater =
    morningResult?.items?.water ||
    null;


  const morningOis =
    morningResult?.items?.ois ||
    null;


  const morningExcel =
    morningResult?.items?.excel ||
    null;


  const otherOis =
    otherLaneResult?.items?.ois ||
    null;


  const otherExcel =
    otherLaneResult?.items?.excel ||
    null;


  if (
    morningWater
  ) {
    morningWater
      .__phase24bWaterLane =
      Boolean(
        morningOis
      );
  }


  if (
    morningOis
  ) {
    morningOis
      .__phase24bMainLane =
      true;
  }


  if (
    morningExcel
  ) {
    morningExcel
      .__phase24bExcelLane =
      true;
  }


  const requestItems = [
    morningWater,
    morningOis,
    morningExcel,
    otherOis,
    otherExcel
  ]
    .filter(
      Boolean
    );


  const allowedTypes =
    new Set([
      "water_environment",
      "limestone_stock",
      "turbine_gear_pinion",
      "silo_level",
      "daily_data_excel",
      "auxiliary_materials",
      "logsheet_approval",
      "steam_status",
      "logsheet_pdf"
    ]);


  const seenIds =
    new Set();


  const filteredItems =
    requestItems.filter(
      requestItem => {
        const requestType =
          getOisAgentRequestType(
            requestItem
          );


        if (
          !allowedTypes.has(
            requestType
          )
        ) {
          throw new Error(
            `Phase 2.4B에서 허용하지 않는 요청 유형입니다: ${requestType}`
          );
        }


        const requestId =
          normalizeOisAgentText(
            requestItem?.id
          );


        if (
          requestId &&
          seenIds.has(
            requestId
          )
        ) {
          console.warn(
            `[PHASE2.4B] 중복 요청 제외: ${requestId}`
          );

          return false;
        }


        if (
          requestId
        ) {
          seenIds.add(
            requestId
          );
        }


        return true;
      }
    );


  if (
    filteredItems.length >
      0
  ) {
    const batch =
      morningResult?.batch ||
      null;


    console.log(
      [
        "[PHASE2.4B] Batch claim",
        `water=${morningWater ? getOisAgentRequestType(morningWater) : "-"}`,
        `ois=${morningOis ? getOisAgentRequestType(morningOis) : "-"}`,
        `excel=${morningExcel ? getOisAgentRequestType(morningExcel) : "-"}`,
        batch?.anchorTargetDate
          ? `anchorDate=${batch.anchorTargetDate}`
          : "",
        batch?.groupedPendingCount
          ? `grouped=${batch.groupedPendingCount}`
          : ""
      ]
        .filter(
          Boolean
        )
        .join(
          " · "
        )
    );
  }


  return filteredItems;
}

'@

    $AgentText =
        $AgentText.Substring(
            0,
            $AgentFunctionStart
        ) +
        $AgentFunction +
        $AgentText.Substring(
            $AgentFunctionEnd
        )


    # =========================================================
    # Water 전용 독립 Browser Session helper
    #
    # 이전 실패한 newPage() 방식과 다르게
    # 완전히 별도 Edge Browser를 사용한다.
    #
    # Main OIS session이 먼저 준비된 뒤
    # Main context의 storageState를 복사해서 시작한다.
    # =========================================================

    $CloseAgentAnchor =
        '  const closeAgent ='

    $CloseAgentIndex =
        $AgentText.IndexOf(
            $CloseAgentAnchor,
            $AgentFunctionStart
        )

    if (
        $CloseAgentIndex -lt 0
    ) {
        throw 'AGENT closeAgent helper 삽입 위치를 찾지 못했습니다.'
    }

    $WaterHelper = Convert-NL -NewLine $AgentNl -Value @'
  /*
    =========================================================
    [PHASE2.4B-AGENT]
    Water 전용 독립 Edge Browser

    이전 Phase 2.4의 같은 BrowserContext newPage 방식은
    OIS navigation waitForURL 충돌이 발생했다.

    이번에는:
    - Main OIS Browser 1개
    - Water 전용 Edge Browser 1개
    로 완전히 분리한다.

    Water Browser 생성 시 Main context의 로그인 storageState를
    복사하므로 불필요한 재로그인을 줄인다.
    =========================================================
  */
  let phase24bWaterBrowserSession =
    null;


  let phase24bWaterBrowserSessionPromise =
    null;


  let phase24bMainBrowserSessionPromise =
    null;


  async function ensurePhase24bMainBrowserSession(
    reason =
      ""
  ) {
    if (
      isBrowserSessionUsable(
        browserSession
      )
    ) {
      return browserSession;
    }


    if (
      !phase24bMainBrowserSessionPromise
    ) {
      phase24bMainBrowserSessionPromise =
        ensureBrowserSession(
          reason
        )
          .finally(
            () => {
              phase24bMainBrowserSessionPromise =
                null;
            }
          );
    }


    return await phase24bMainBrowserSessionPromise;
  }


  async function closePhase24bWaterBrowserSession() {
    if (
      !phase24bWaterBrowserSession
    ) {
      return;
    }


    const closingSession =
      phase24bWaterBrowserSession;


    phase24bWaterBrowserSession =
      null;


    await closeBrowserSession(
      closingSession,
      false
    )
      .catch(
        () => null
      );
  }


  async function createPhase24bWaterBrowserSession() {
    const mainSession =
      await ensurePhase24bMainBrowserSession(
        "Phase 2.4B Water lane 시작 전 Main OIS 세션 준비"
      );


    if (
      !mainSession?.context
    ) {
      throw new Error(
        "Phase 2.4B Main OIS BrowserContext가 없습니다."
      );
    }


    const storageState =
      await mainSession.context
        .storageState();


    console.log(
      "[PHASE2.4B] Water 전용 Edge Browser를 시작합니다."
    );


    const browser =
      await chromium.launch({
        channel:
          "msedge",

        headless:
          true,

        slowMo:
          60
      });


    let context;


    try {
      context =
        await browser.newContext({
          storageState
        });

    } catch (
      error
    ) {
      await browser
        .close()
        .catch(
          () => null
        );


      throw error;
    }


    const page =
      context.pages()[0] ||
      await context.newPage();


    const session = {
      browser,
      context,
      page
    };


    browser.on(
      "disconnected",
      () => {
        console.warn(
          "[PHASE2.4B] Water 전용 Edge Browser 연결이 종료되었습니다."
        );
      }
    );


    try {
      const mainPageUrl =
        normalizeOisAgentText(
          mainSession?.page?.url?.()
        );


      if (
        mainPageUrl &&
        mainPageUrl !==
          "about:blank"
      ) {
        await page
          .goto(
            mainPageUrl,
            {
              waitUntil:
                "domcontentloaded",

              timeout:
                15000
            }
          )
          .catch(
            () => null
          );
      }


      await ensureOisAgentLoggedIn(
        page,
        config
      );


      await waitOisAgent(
        300
      );


      const livePage =
        getLivePage(
          session
        );


      if (
        !livePage
      ) {
        throw new Error(
          "Phase 2.4B Water 전용 OIS 페이지가 닫혔습니다."
        );
      }


      session.page =
        livePage;


      console.log(
        "[PHASE2.4B] Water 전용 Edge Browser가 준비되었습니다."
      );


      return session;

    } catch (
      error
    ) {
      await closeBrowserSession(
        session,
        false
      )
        .catch(
          () => null
        );


      throw error;
    }
  }


  async function ensurePhase24bWaterBrowserSession() {
    const livePage =
      getLivePage(
        phase24bWaterBrowserSession
      );


    if (
      livePage
    ) {
      phase24bWaterBrowserSession.page =
        livePage;


      try {
        await ensureOisAgentLoggedIn(
          livePage,
          config
        );


        return phase24bWaterBrowserSession;

      } catch (
        error
      ) {
        if (
          !isBrowserClosedError(
            error
          ) &&
          isBrowserSessionUsable(
            phase24bWaterBrowserSession
          )
        ) {
          throw error;
        }
      }
    }


    if (
      !phase24bWaterBrowserSessionPromise
    ) {
      phase24bWaterBrowserSessionPromise =
        (
          async () => {
            await closePhase24bWaterBrowserSession();


            phase24bWaterBrowserSession =
              await createPhase24bWaterBrowserSession();


            return phase24bWaterBrowserSession;
          }
        )()
          .finally(
            () => {
              phase24bWaterBrowserSessionPromise =
                null;
            }
          );
    }


    return await phase24bWaterBrowserSessionPromise;
  }


'@

    $AgentText =
        $AgentText.Insert(
            $CloseAgentIndex,
            $WaterHelper
        )


    # =========================================================
    # processing loop:
    # requestUsesPhase24bWaterLane 계산
    # =========================================================

    $ProcessingIndex =
        $AgentText.IndexOf(
            'const processingResults ='
        )

    if (
        $ProcessingIndex -lt 0
    ) {
        throw 'AGENT processingResults 위치를 찾지 못했습니다.'
    }

    $RequestBrowserMarker =
        '      const requestSourceLabel ='

    $RequestSourceIndex =
        $AgentText.IndexOf(
            $RequestBrowserMarker,
            $ProcessingIndex
        )

    if (
        $RequestSourceIndex -lt 0
    ) {
        throw 'AGENT requestSourceLabel 위치를 찾지 못했습니다.'
    }

    $WaterFlagCode = Convert-NL -NewLine $AgentNl -Value @'
      const requestUsesPhase24bWaterLane =
        requestItem
          ?.__phase24bWaterLane ===
          true;


'@

    $AgentText =
        $AgentText.Insert(
            $RequestSourceIndex,
            $WaterFlagCode
        )


    # =========================================================
    # Excel / OIS 분기에서 Water 전용 branch 삽입
    # =========================================================

    $ProcessingIndex =
        $AgentText.IndexOf(
            'const processingResults ='
        )

    $NoBrowserIndex =
        $AgentText.IndexOf(
            '!requestNeedsOisBrowser',
            $ProcessingIndex
        )

    if (
        $NoBrowserIndex -lt 0
    ) {
        throw 'AGENT Excel/OIS 분기 시작점을 찾지 못했습니다.'
    }

    $ElseIndex =
        $AgentText.IndexOf(
            '        } else {',
            $NoBrowserIndex
        )

    if (
        $ElseIndex -lt 0
    ) {
        throw 'AGENT 기존 OIS else 분기를 찾지 못했습니다.'
    }

    $OldElse =
        '        } else {'

    $NewElse = Convert-NL -NewLine $AgentNl -Value @'
        } else if (
          requestUsesPhase24bWaterLane
        ) {
          /*
            Phase 2.4B Water Lane:
            Main OIS Browser와 완전히 분리된 Edge Browser에서 처리한다.

            여기서 실패하면 Main page에 동시에 fallback하지 않는다.
            Main OIS 작업과 화면 충돌을 만들지 않기 위해
            해당 Water 요청만 실패 처리하고 개별 재조회가 가능하게 둔다.
          */
          const waterSession =
            await ensurePhase24bWaterBrowserSession();


          console.log(
            "[PHASE2.4B] 수처리 독립 2-Lane 조회 시작"
          );


          try {
            result =
              await collectOisAgentRequestResult(
                waterSession.page,
                config,
                requestItem
              );

          } catch (
            firstError
          ) {
            if (
              !isBrowserClosedError(
                firstError
              ) &&
              isBrowserSessionUsable(
                phase24bWaterBrowserSession
              )
            ) {
              throw firstError;
            }


            console.warn(
              "[PHASE2.4B] Water Browser 종료 감지. Water Lane만 1회 재생성합니다."
            );


            await closePhase24bWaterBrowserSession();


            const retryWaterSession =
              await ensurePhase24bWaterBrowserSession();


            result =
              await collectOisAgentRequestResult(
                retryWaterSession.page,
                config,
                requestItem
              );
          }

        } else {
'@

    $AgentText =
        $AgentText.Remove(
            $ElseIndex,
            $OldElse.Length
        )

    $AgentText =
        $AgentText.Insert(
            $ElseIndex,
            $NewElse
        )


    # =========================================================
    # Main OIS ensureBrowserSession을 동시 초기화 lock wrapper로 변경
    # processing block 안에서만 교체
    # =========================================================

    $ProcessingIndex =
        $AgentText.IndexOf(
            'const processingResults ='
        )

    $ProcessingEnd =
        $AgentText.IndexOf(
            '      processingResults',
            $ProcessingIndex + 30
        )

    if (
        $ProcessingEnd -lt 0
    ) {
        throw 'AGENT processing block 끝을 찾지 못했습니다.'
    }

    $ProcessingBlock =
        $AgentText.Substring(
            $ProcessingIndex,
            $ProcessingEnd -
            $ProcessingIndex
        )

    $ProcessingBlock =
        $ProcessingBlock.Replace(
            'await ensureBrowserSession(',
            'await ensurePhase24bMainBrowserSession('
        )

    $AgentText =
        $AgentText.Substring(
            0,
            $ProcessingIndex
        ) +
        $ProcessingBlock +
        $AgentText.Substring(
            $ProcessingEnd
        )


    # =========================================================
    # Water 독립 lane 완료 시 Main storageState 저장 / Main recovery /
    # Main screenshot을 건드리지 않도록 조건 보강
    # processing 영역 안에서만
    # =========================================================

    $ProcessingIndex =
        $AgentText.IndexOf(
            'const processingResults ='
        )

    $ProcessingEnd =
        $AgentText.IndexOf(
            '      processingResults',
            $ProcessingIndex + 30
        )

    $ProcessingBlock =
        $AgentText.Substring(
            $ProcessingIndex,
            $ProcessingEnd -
            $ProcessingIndex
        )

    $ProcessingBlock =
        $ProcessingBlock.Replace(
            'requestNeedsOisBrowser &&' + $AgentNl +
            '          isBrowserSessionUsable(',
            'requestNeedsOisBrowser &&' + $AgentNl +
            '          !requestUsesPhase24bWaterLane &&' + $AgentNl +
            '          isBrowserSessionUsable('
        )

    $ProcessingBlock =
        $ProcessingBlock.Replace(
            'requestNeedsOisBrowser &&' + $AgentNl +
            '          browserSession &&',
            'requestNeedsOisBrowser &&' + $AgentNl +
            '          !requestUsesPhase24bWaterLane &&' + $AgentNl +
            '          browserSession &&'
        )

    $AgentText =
        $AgentText.Substring(
            0,
            $ProcessingIndex
        ) +
        $ProcessingBlock +
        $AgentText.Substring(
            $ProcessingEnd
        )


    # =========================================================
    # 시간 측정 로그
    # =========================================================

    $ProcessingIndex =
        $AgentText.IndexOf(
            'const processingResults ='
        )

    $BatchTimer = Convert-NL -NewLine $AgentNl -Value @'
      const phase24bBatchStartedAt =
        Date.now();


'@

    $AgentText =
        $AgentText.Insert(
            $ProcessingIndex,
            $BatchTimer
        )


    $MapAnchor =
        'async requestItem => {'

    $MapIndex =
        $AgentText.IndexOf(
            $MapAnchor,
            $ProcessingIndex
        )

    if (
        $MapIndex -lt 0
    ) {
        throw 'AGENT request map callback을 찾지 못했습니다.'
    }

    $RequestTimer = Convert-NL -NewLine $AgentNl -Value @'

      const phase24bRequestStartedAt =
        Date.now();
'@

    $AgentText =
        $AgentText.Insert(
            $MapIndex +
            $MapAnchor.Length,
            $RequestTimer
        )


    $PrintIndex =
        $AgentText.IndexOf(
            '        printOisAgentRequestResult(',
            $ProcessingIndex
        )

    if (
        $PrintIndex -lt 0
    ) {
        throw 'AGENT 결과 출력 위치를 찾지 못했습니다.'
    }

    $PrintEnd =
        $AgentText.IndexOf(
            '        );',
            $PrintIndex
        )

    if (
        $PrintEnd -lt 0
    ) {
        throw 'AGENT 결과 출력 끝을 찾지 못했습니다.'
    }

    $PrintEnd +=
        '        );'.Length

    $RequestTiming = Convert-NL -NewLine $AgentNl -Value @'


        console.log(
          `[PHASE2.4B] ${requestLabel} 완료 ${(
            (
              Date.now() -
              phase24bRequestStartedAt
            ) /
            1000
          ).toFixed(1)}초`
        );
'@

    $AgentText =
        $AgentText.Insert(
            $PrintEnd,
            $RequestTiming
        )


    $ProcessingEnd =
        $AgentText.IndexOf(
            '      processingResults',
            $ProcessingIndex + 30
        )

    $WaitAfterProcessing =
        $AgentText.IndexOf(
            '      await waitOisAgent(',
            $ProcessingEnd
        )

    if (
        $WaitAfterProcessing -lt 0
    ) {
        throw 'AGENT batch 종료 wait 위치를 찾지 못했습니다.'
    }

    $BatchTiming = Convert-NL -NewLine $AgentNl -Value @'
      console.log(
        `[PHASE2.4B] 현재 Agent batch ${(
          (
            Date.now() -
            phase24bBatchStartedAt
          ) /
          1000
        ).toFixed(1)}초`
      );


'@

    $AgentText =
        $AgentText.Insert(
            $WaitAfterProcessing,
            $BatchTiming
        )


    # =========================================================
    # Agent 종료 시 Water Browser 정리
    # =========================================================

    $CloseAgentIndex =
        $AgentText.IndexOf(
            '  const closeAgent ='
        )

    if (
        $CloseAgentIndex -lt 0
    ) {
        throw 'AGENT closeAgent 위치 재확인 실패'
    }

    $MainCloseInShutdown =
        $AgentText.IndexOf(
            '      await closeBrowserSession(',
            $CloseAgentIndex
        )

    if (
        $MainCloseInShutdown -lt 0
    ) {
        throw 'AGENT 종료 시 main browser close 위치를 찾지 못했습니다.'
    }

    $CloseWaterCode = Convert-NL -NewLine $AgentNl -Value @'
      await closePhase24bWaterBrowserSession();


'@

    $AgentText =
        $AgentText.Insert(
            $MainCloseInShutdown,
            $CloseWaterCode
        )


    # =========================================================
    # 저장
    # =========================================================

    [IO.File]::WriteAllText(
        $Server,
        $ServerText,
        (New-Object Text.UTF8Encoding($false))
    )

    [IO.File]::WriteAllText(
        $Agent,
        $AgentText,
        (New-Object Text.UTF8Encoding($false))
    )


    Write-Host ''
    Write-Host '===== Node 문법 검사 ====='

    & $Node --check $Server

    if (
        $LASTEXITCODE -ne 0
    ) {
        throw 'SERVER Node 문법 검사 실패'
    }

    & $Node --check $Agent

    if (
        $LASTEXITCODE -ne 0
    ) {
        throw 'AGENT Node 문법 검사 실패'
    }


    Write-Host ''
    Write-Host '===== Git whitespace 검사 ====='

    git diff --check -- `
      functions/api/ois-data-requests.js `
      local-tools/ois-agent/ois-login.js

    if (
        $LASTEXITCODE -ne 0
    ) {
        throw 'git diff --check 실패'
    }


    Write-Host ''
    Write-Host '===== Phase 2.4B 마커 ====='

    Select-String `
        -LiteralPath $Server `
        -Pattern `
            'PHASE2.4B-SERVER',
            'next_morning_2lane',
            'handleAgentNextMorningTwoLaneRequests' |
    Select-Object LineNumber, Line |
    Format-Table -AutoSize

    Select-String `
        -LiteralPath $Agent `
        -Pattern `
            'PHASE2.4B-AGENT',
            'next_morning_2lane',
            'Water 전용 Edge Browser',
            '\[PHASE2\.4B\]' |
    Select-Object LineNumber, Line |
    Format-Table -AutoSize


    Write-Host ''
    Write-Host '===== 변경 파일 ====='

    git status --short -- `
      functions/api/ois-data-requests.js `
      local-tools/ois-agent/ois-login.js


    Write-Host ''
    Write-Host '===== diff 요약 ====='

    git diff --stat -- `
      functions/api/ois-data-requests.js `
      local-tools/ois-agent/ois-login.js


    Write-Host ''
    Write-Host '===== ois-login.js 기존 5초 Poll 유지 확인 ====='

    Select-String `
        -LiteralPath $Agent `
        -SimpleMatch `
        -Pattern 'const OIS_AGENT_POLL_INTERVAL' `
        -Context 0,3


    Write-Host ''
    Write-Host '===== Phase 2.4B 패치 적용 완료 ====='
    Write-Host '아직 git add / commit / Agent 재시작은 하지 않았습니다.'
    Write-Host '현재 실행 중 Agent는 기존 안정 버전 그대로입니다.'

} catch {
    Write-Host ''
    Write-Host '===== Phase 2.4B 패치 실패 - 자동 복원 ====='

    Copy-Item `
        -LiteralPath $ServerBackup `
        -Destination $Server `
        -Force

    Copy-Item `
        -LiteralPath $AgentBackup `
        -Destination $Agent `
        -Force

    Write-Host 'Server / Agent 모두 패치 전 상태로 복원했습니다.'

    throw
}
