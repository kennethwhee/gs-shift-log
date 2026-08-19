param(
    [string]$Repo = 'C:\Users\GSENR\Desktop\gs-shift-log'
)

$ErrorActionPreference = 'Stop'

Set-Location $Repo

$Agent = Join-Path $Repo 'local-tools\ois-agent\ois-login.js'
$Node  = 'C:\Program Files\nodejs\node.exe'

if (-not (Test-Path -LiteralPath $Agent)) {
    throw "ois-login.js를 찾지 못했습니다: $Agent"
}

if (-not (Test-Path -LiteralPath $Node)) {
    throw "Node.exe를 찾지 못했습니다: $Node"
}

Write-Host '===== Phase 2.4 OIS 병렬조회 패치 ====='
Write-Host "Agent: $Agent"

$text = [IO.File]::ReadAllText($Agent)

if ($text.Contains('[PHASE2.4]')) {
    throw '이미 Phase 2.4 마커가 있습니다. 중복 적용하지 않습니다.'
}

$nl =
    if ($text.Contains("`r`n")) {
        "`r`n"
    } else {
        "`n"
    }

function Convert-NewLine {
    param([string]$Value)

    $converted = $Value.Replace("`r`n", "`n")
    $converted = $converted.Replace("`r", "`n")
    $converted = $converted.Replace("`n", $nl)

    return $converted
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Backup = "$Agent.before-phase24-$stamp.bak"

Copy-Item -LiteralPath $Agent -Destination $Backup -Force

Write-Host "백업: $Backup"

try {
    # =========================================================
    # 1. getNextOisAgentLaneRequests 전체 교체
    #
    # - 오전회의 OIS 4종은 action=next를 타입별로 동시에 호출
    # - auxiliary_materials / logsheet_approval + Excel은 기존 next_lanes 유지
    # - 서버의 기존 atomic claim(WHERE status='pending')을 그대로 사용
    # =========================================================

    $functionStart =
        $text.IndexOf(
            'async function getNextOisAgentLaneRequests('
        )

    if ($functionStart -lt 0) {
        throw 'getNextOisAgentLaneRequests 시작점을 찾지 못했습니다.'
    }

    $functionEnd =
        $text.IndexOf(
            '/* =========================================================',
            $functionStart + 10
        )

    if ($functionEnd -lt 0) {
        throw 'getNextOisAgentLaneRequests 끝 경계를 찾지 못했습니다.'
    }

    $newFunction = Convert-NewLine @'
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
    Phase 2.4:
    오전회의에서 함께 생성되는 OIS 4종 요청을
    타입별 action=next로 동시에 claim한다.

    서버의 action=next는
    UPDATE ... WHERE id = ? AND status = 'pending'
    조건으로 claim하므로, 동시에 호출해도 동일 요청의
    중복 처리를 막는 기존 보호장치를 그대로 사용한다.
  */
  const parallelOisRequestTypes = [
    "water_environment",
    "limestone_stock",
    "turbine_gear_pinion",
    "silo_level"
  ];


  /*
    오전회의 4종 이외 OIS 작업은 기존 단일 OIS lane으로 유지한다.
    Log Sheet 승인/부재료 작업까지 무리하게 병렬화하지 않는다.
  */
  const serialOisRequestTypes = [
    "auxiliary_materials",
    "logsheet_approval"
  ];


  const excelRequestTypes = [
    "daily_data_excel",
    "steam_status",
    "logsheet_pdf"
  ];


  const claimSingleRequestType =
    async requestType => {
      const result =
        await requestOisAgentApi(
          config,

          getOisAgentApiUrl(
            config,
            {
              action:
                "next",

              requestType,

              _:
                `${Date.now()}-${Math.random()}`
            }
          )
        );


      const item =
        result?.item ||
        null;


      if (
        !item
      ) {
        return null;
      }


      const claimedRequestType =
        getOisAgentRequestType(
          item
        );


      if (
        claimedRequestType !==
          requestType
      ) {
        throw new Error(
          `Phase 2.4 요청 유형 불일치: 요청 ${requestType} / 반환 ${claimedRequestType}`
        );
      }


      return item;
    };


  const parallelClaimPromise =
    Promise.allSettled(
      parallelOisRequestTypes.map(
        requestType => {
          return claimSingleRequestType(
            requestType
          );
        }
      )
    );


  /*
    Excel 1건과 기존 직렬 OIS 1건은
    기존 next_lanes API를 그대로 사용한다.
  */
  const lanePromise =
    requestOisAgentApi(
      config,

      getOisAgentApiUrl(
        config,
        {
          action:
            "next_lanes",

          oisRequestTypes:
            serialOisRequestTypes.join(
              ","
            ),

          excelRequestTypes:
            excelRequestTypes.join(
              ","
            ),

          _:
            `${Date.now()}-${Math.random()}`
        }
      )
    );


  const [
    parallelClaimResults,
    laneResult
  ] =
    await Promise.all([
      parallelClaimPromise,
      lanePromise
    ]);


  const requestItems = [];


  parallelClaimResults.forEach(
    (
      claimResult,
      claimIndex
    ) => {
      const requestType =
        parallelOisRequestTypes[
          claimIndex
        ];


      if (
        claimResult.status ===
          "rejected"
      ) {
        console.warn(
          `[PHASE2.4] ${requestType} claim 실패:`,
          claimResult.reason
        );

        return;
      }


      if (
        claimResult.value
      ) {
        requestItems.push(
          claimResult.value
        );
      }
    }
  );


  Object.entries(
    laneResult?.laneErrors ||
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


  const serialOisItem =
    laneResult?.items?.ois ||
    null;


  const excelItem =
    laneResult?.items?.excel ||
    null;


  if (
    serialOisItem
  ) {
    requestItems.push(
      serialOisItem
    );
  }


  if (
    excelItem
  ) {
    requestItems.push(
      excelItem
    );
  }


  const allowedRequestTypes =
    new Set([
      ...parallelOisRequestTypes,
      ...serialOisRequestTypes,
      ...excelRequestTypes
    ]);


  const seenRequestIds =
    new Set();


  return requestItems
    .filter(
      requestItem => {
        const requestType =
          getOisAgentRequestType(
            requestItem
          );


        if (
          !allowedRequestTypes.has(
            requestType
          )
        ) {
          throw new Error(
            `Phase 2.4에서 지원하지 않는 요청 유형이 반환되었습니다: ${requestType}`
          );
        }


        const requestId =
          normalizeOisAgentText(
            requestItem?.id
          );


        if (
          requestId &&
          seenRequestIds.has(
            requestId
          )
        ) {
          console.warn(
            `[PHASE2.4] 중복 claim 요청 제외: ${requestId}`
          );

          return false;
        }


        if (
          requestId
        ) {
          seenRequestIds.add(
            requestId
          );
        }


        return true;
      }
    );
}

'@

    $text =
        $text.Substring(
            0,
            $functionStart
        ) +
        $newFunction +
        $text.Substring(
            $functionEnd
        )


    # =========================================================
    # 2. BrowserContext 공유 + OIS 요청별 독립 Page helper 삽입
    #
    # - 로그인 cookie/context는 공유
    # - 수처리/석회석/Gear/Silo는 각자 독립 page
    # - 독립 page 실패 시 기존 main page에서 직렬 fallback
    # =========================================================

    $closeAgentAnchor =
        '  const closeAgent ='

    $closeAgentIndex =
        $text.IndexOf(
            $closeAgentAnchor,
            $functionStart
        )

    if ($closeAgentIndex -lt 0) {
        throw 'closeAgent 삽입 위치를 찾지 못했습니다.'
    }

    $parallelHelper = Convert-NewLine @'
  /*
    =========================================================
    Phase 2.4 - 오전회의 OIS 독립 Page 병렬 처리

    같은 BrowserContext의 로그인 상태는 공유하되,
    수처리 / 석회석 / Gear / Silo는 서로 다른 Page를 사용한다.

    독립 Page 조회가 실패하면 기존 main page에서
    직렬 fallback 1회를 수행한다.
    =========================================================
  */
  const PHASE24_PARALLEL_OIS_REQUEST_TYPES =
    new Set([
      "water_environment",
      "limestone_stock",
      "turbine_gear_pinion",
      "silo_level"
    ]);


  let phase24SessionReadyPromise =
    null;


  let phase24FallbackChain =
    Promise.resolve();


  async function ensurePhase24BrowserSession(
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
      !phase24SessionReadyPromise
    ) {
      phase24SessionReadyPromise =
        ensureBrowserSession(
          reason
        )
          .finally(
            () => {
              phase24SessionReadyPromise =
                null;
            }
          );
    }


    return await phase24SessionReadyPromise;
  }


  function runPhase24SerializedFallback(
    task
  ) {
    const fallbackPromise =
      phase24FallbackChain.then(
        task,
        task
      );


    phase24FallbackChain =
      fallbackPromise.catch(
        () => null
      );


    return fallbackPromise;
  }


  async function collectOisAgentRequestResultOnDedicatedPage(
    requestItem,
    requestLabel
  ) {
    const requestType =
      getOisAgentRequestType(
        requestItem
      );


    const session =
      await ensurePhase24BrowserSession(
        `${requestLabel} Phase 2.4 병렬 조회 준비`
      );


    if (
      !session?.context
    ) {
      throw new Error(
        `${requestLabel} 병렬 조회용 OIS BrowserContext가 없습니다.`
      );
    }


    const dedicatedPage =
      await session.context
        .newPage();


    let firstError =
      null;


    try {
      const mainPageUrl =
        normalizeOisAgentText(
          session?.page?.url?.()
        );


      if (
        mainPageUrl &&
        mainPageUrl !==
          "about:blank"
      ) {
        await dedicatedPage
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
        dedicatedPage,
        config
      );


      console.log(
        `[PHASE2.4] ${requestLabel} 독립 Page 병렬 조회 시작`
      );


      return await collectOisAgentRequestResult(
        dedicatedPage,
        config,
        requestItem
      );

    } catch (
      error
    ) {
      firstError =
        error;

    } finally {
      await dedicatedPage
        .close()
        .catch(
          () => null
        );
    }


    console.warn(
      `[PHASE2.4] ${requestLabel} 독립 Page 조회 실패. 기존 main Page에서 직렬 fallback 1회 실행:`,
      firstError instanceof
        Error
        ? firstError.message
        : firstError
    );


    return await runPhase24SerializedFallback(
      async () => {
        const fallbackSession =
          await ensurePhase24BrowserSession(
            `${requestLabel} Phase 2.4 fallback`
          );


        return await collectOisAgentRequestResult(
          fallbackSession.page,
          config,
          requestItem
        );
      }
    );
  }


'@

    $text =
        $text.Insert(
            $closeAgentIndex,
            $parallelHelper
        )


    # =========================================================
    # 3. 처리 루프에서 오전회의 4종만 독립 Page helper 사용
    # =========================================================

    $processingIndex =
        $text.IndexOf(
            'const processingResults ='
        )

    if ($processingIndex -lt 0) {
        throw 'processingResults 시작점을 찾지 못했습니다.'
    }

    $browserConditionIndex =
        $text.IndexOf(
            '!requestNeedsOisBrowser',
            $processingIndex
        )

    if ($browserConditionIndex -lt 0) {
        throw 'requestNeedsOisBrowser 분기점을 찾지 못했습니다.'
    }

    $elseIndex =
        $text.IndexOf(
            '        } else {',
            $browserConditionIndex
        )

    if ($elseIndex -lt 0) {
        throw 'Excel/OIS else 분기점을 찾지 못했습니다.'
    }

    $oldElse =
        '        } else {'

    $newElse = Convert-NewLine @'
        } else if (
          PHASE24_PARALLEL_OIS_REQUEST_TYPES.has(
            requestType
          )
        ) {
          result =
            await collectOisAgentRequestResultOnDedicatedPage(
              requestItem,
              requestLabel
            );

        } else {
'@

    $text =
        $text.Remove(
            $elseIndex,
            $oldElse.Length
        )

    $text =
        $text.Insert(
            $elseIndex,
            $newElse
        )


    # =========================================================
    # 4. Phase 2.4 시간 측정 로그 추가
    # =========================================================

    $processingIndex =
        $text.IndexOf(
            'const processingResults ='
        )

    $batchTimer = Convert-NewLine @'
      const phase24BatchStartedAt =
        Date.now();


'@

    $text =
        $text.Insert(
            $processingIndex,
            $batchTimer
        )


    $mapAnchor =
        'async requestItem => {'

    $mapIndex =
        $text.IndexOf(
            $mapAnchor,
            $processingIndex
        )

    if ($mapIndex -lt 0) {
        throw 'requestItems.map callback을 찾지 못했습니다.'
    }

    $mapInsertIndex =
        $mapIndex +
        $mapAnchor.Length

    $requestTimer = Convert-NewLine @'

      const phase24RequestStartedAt =
        Date.now();
'@

    $text =
        $text.Insert(
            $mapInsertIndex,
            $requestTimer
        )


    $printIndex =
        $text.IndexOf(
            '        printOisAgentRequestResult(',
            $processingIndex
        )

    if ($printIndex -lt 0) {
        throw 'printOisAgentRequestResult 호출을 찾지 못했습니다.'
    }

    $printEnd =
        $text.IndexOf(
            '        );',
            $printIndex
        )

    if ($printEnd -lt 0) {
        throw 'printOisAgentRequestResult 끝을 찾지 못했습니다.'
    }

    $printEnd +=
        '        );'.Length

    $requestTimingLog = Convert-NewLine @'


        console.log(
          `[PHASE2.4] ${requestLabel} 완료 ${(
            (
              Date.now() -
              phase24RequestStartedAt
            ) /
            1000
          ).toFixed(1)}초`
        );
'@

    $text =
        $text.Insert(
            $printEnd,
            $requestTimingLog
        )


    $settledFilterIndex =
        $text.IndexOf(
            'processingResults' + $nl + '        .filter',
            $processingIndex
        )

    if ($settledFilterIndex -lt 0) {
        throw 'processingResults 후처리 구간을 찾지 못했습니다.'
    }

    $waitIndex =
        $text.IndexOf(
            '      await waitOisAgent(',
            $settledFilterIndex
        )

    if ($waitIndex -lt 0) {
        throw '배치 종료 waitOisAgent 위치를 찾지 못했습니다.'
    }

    $batchTimingLog = Convert-NewLine @'
      console.log(
        `[PHASE2.4] 현재 배치 전체 ${(
          (
            Date.now() -
            phase24BatchStartedAt
          ) /
          1000
        ).toFixed(1)}초`
      );


'@

    $text =
        $text.Insert(
            $waitIndex,
            $batchTimingLog
        )


    # =========================================================
    # 저장
    # =========================================================

    [IO.File]::WriteAllText(
        $Agent,
        $text,
        (New-Object Text.UTF8Encoding($false))
    )


    Write-Host ''
    Write-Host '===== Node 문법 검사 ====='

    & $Node --check $Agent

    if ($LASTEXITCODE -ne 0) {
        throw 'Node 문법 검사에 실패했습니다.'
    }


    Write-Host ''
    Write-Host '===== Git whitespace 검사 ====='

    git diff --check -- local-tools/ois-agent/ois-login.js

    if ($LASTEXITCODE -ne 0) {
        throw 'git diff --check에 실패했습니다.'
    }


    Write-Host ''
    Write-Host '===== Phase 2.4 마커 ====='

    Select-String `
        -LiteralPath $Agent `
        -Pattern `
            'Phase 2.4',
            'PHASE24_PARALLEL_OIS_REQUEST_TYPES',
            'collectOisAgentRequestResultOnDedicatedPage',
            '\[PHASE2\.4\]' |
    Select-Object LineNumber, Line |
    Format-Table -AutoSize


    Write-Host ''
    Write-Host '===== 변경 파일 ====='

    git status --short -- local-tools/ois-agent/ois-login.js


    Write-Host ''
    Write-Host '===== diff 요약 ====='

    git diff --stat -- local-tools/ois-agent/ois-login.js


    Write-Host ''
    Write-Host '===== Phase 2.4 패치 적용 완료 ====='
    Write-Host '아직 git add / commit은 하지 않았습니다.'
    Write-Host '기존 5000ms 로컬 변경도 그대로 유지됩니다.'

} catch {
    Write-Host ''
    Write-Host '===== 패치 실패 - 자동 복원 ====='

    Copy-Item `
        -LiteralPath $Backup `
        -Destination $Agent `
        -Force

    Write-Host 'ois-login.js를 패치 전 상태로 복원했습니다.'

    throw
}
