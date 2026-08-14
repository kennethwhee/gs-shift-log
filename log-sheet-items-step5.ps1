$ErrorActionPreference = 'Stop'

$root = (Get-Location).Path
$jsPath = Join-Path $root 'inspection-logs\log-sheets\log-sheet.js'
$cssPath = Join-Path $root 'inspection-logs\log-sheets\log-sheet.css'
$htmlPath = Join-Path $root 'inspection-logs\log-sheets\log-sheet.html'

foreach ($path in @($jsPath, $cssPath, $htmlPath)) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "파일을 찾을 수 없습니다: $path"
  }
}

$html = [System.IO.File]::ReadAllText($htmlPath)

if (
  $html -notmatch 'id="logSheetItemList"' -or
  $html -notmatch 'id="logSheetItemCount"'
) {
  throw '이전 단계의 Logging 항목 목록 HTML이 없습니다. 4단계를 먼저 확인해 주세요.'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $env:TEMP "gs-shift-log-log-items-$stamp"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

Copy-Item -LiteralPath $jsPath -Destination (Join-Path $backupDir 'log-sheet.js')
Copy-Item -LiteralPath $cssPath -Destination (Join-Path $backupDir 'log-sheet.css')

Write-Host "백업 폴더: $backupDir"

function Normalize-Lf([string]$Text) {
  return $Text.Replace("`r`n", "`n").Replace("`r", "`n")
}

function Replace-Once(
  [string]$Text,
  [string]$Old,
  [string]$New,
  [string]$Label
) {
  $index = $Text.IndexOf($Old, [System.StringComparison]::Ordinal)

  if ($index -lt 0) {
    throw "교체 위치를 찾지 못했습니다: $Label"
  }

  return $Text.Substring(0, $index) +
    $New +
    $Text.Substring($index + $Old.Length)
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$js = Normalize-Lf ([System.IO.File]::ReadAllText($jsPath))
$css = Normalize-Lf ([System.IO.File]::ReadAllText($cssPath))

# ---------------------------------------------------------
# 1. DOM 요소 연결
# ---------------------------------------------------------
if ($js -notmatch 'itemCount:\s*byId\("logSheetItemCount"\)') {
  $oldElements = @'
    tabs:
      byId("logSheetTabs"),
    loading:
'@

  $newElements = @'
    tabs:
      byId("logSheetTabs"),
    itemCount:
      byId("logSheetItemCount"),
    itemList:
      byId("logSheetItemList"),
    loading:
'@

  $js = Replace-Once $js $oldElements $newElements 'Logging 항목 DOM 요소'
}

# ---------------------------------------------------------
# 2. Excel 항목 추출·목록 출력 함수
# ---------------------------------------------------------
if ($js -notmatch 'function renderLoggingItemList\(') {
  $loggingFunctions = @'
  /* =========================================================
    Logging 항목 목록
  ========================================================= */

  function normalizeLoggingText(
    value
  ) {
    return normalizeText(
      value
    ).replace(
      /\s+/g,
      " "
    );
  }

  function getTemplateCellText(
    sheet,
    address
  ) {
    const target =
      XLSX.utils.decode_cell(
        address
      );

    const merge =
      (sheet["!merges"] || []).find(
        item =>
          target.r >= item.s.r &&
          target.r <= item.e.r &&
          target.c >= item.s.c &&
          target.c <= item.e.c
      );

    const anchorAddress =
      merge
        ? XLSX.utils.encode_cell(
            merge.s
          )
        : address;

    const cell =
      sheet[anchorAddress];

    if (!cell) {
      return "";
    }

    return normalizeLoggingText(
      XLSX.utils.format_cell(
        cell
      ) ??
      cell.v ??
      ""
    );
  }

  function getLoggingItemSections(
    sheetConfig
  ) {
    const standardSection = {
      ranges:
        sheetConfig.editableRanges || [],
      nameColumns: [
        "B",
        "C",
        "D",
        "E",
        "F"
      ],
      tagColumn: "G",
      unitColumn: "I"
    };

    switch (
      sheetConfig.key
    ) {
      case "field-night-leader-to":
        return [
          {
            ...standardSection,
            ranges: [
              "J7:M35",
              "J37:M69",
              "J71:M105"
            ]
          },
          {
            ranges: [
              "G108:G112"
            ],
            nameColumns: [
              "D",
              "E",
              "F"
            ]
          },
          {
            ranges: [
              "K108:K112"
            ],
            nameColumns: [
              "H",
              "I",
              "J"
            ]
          },
          {
            ranges: [
              "M108:M112"
            ],
            nameColumns: [
              "L"
            ]
          }
        ];

      case "field-night-bo12":
        return [
          {
            ...standardSection,
            ranges: [
              "J7:Q34"
            ]
          },
          {
            ranges: [
              "J36:K40"
            ],
            nameColumns: [
              "D",
              "E",
              "F"
            ]
          },
          {
            ranges: [
              "P36:Q40"
            ],
            nameColumns: [
              "L",
              "M",
              "N",
              "O"
            ]
          },
          {
            ...standardSection,
            ranges: [
              "J42:Q68"
            ]
          },
          {
            ranges: [
              "H70:H77"
            ],
            nameColumns: [
              "D",
              "E",
              "F"
            ],
            tagColumn: "G"
          },
          {
            ranges: [
              "O70:O77"
            ],
            nameColumns: [
              "L",
              "M"
            ],
            tagColumn: "N"
          },
          {
            ...standardSection,
            ranges: [
              "J79:Q118"
            ]
          }
        ];

      case "electrical-main":
        return [
          {
            ranges:
              sheetConfig.editableRanges || [],
            nameColumns: [
              "B",
              "C",
              "D",
              "E",
              "F"
            ],
            unitColumn: "I"
          }
        ];

      case "electrical-patrol":
        return [
          {
            ranges: [
              "G6:H28"
            ],
            nameColumns: [
              "F"
            ]
          }
        ];

      case "aux-control-room":
        return [
          {
            ranges:
              sheetConfig.editableRanges || [],
            nameColumns: [
              "A",
              "B",
              "C"
            ],
            tagColumn: "D",
            unitColumn: "E"
          }
        ];

      case "aux-field":
        return [
          {
            ranges: [
              "G8:N46"
            ],
            nameColumns: [
              "A",
              "B"
            ],
            tagColumn: "C",
            unitColumn: "D"
          },
          {
            ranges: [
              "P9:R46"
            ],
            nameColumns: [
              "O"
            ]
          }
        ];

      default:
        return [
          standardSection
        ];
    }
  }

  function extractLoggingItems() {
    const sheet =
      state.workbook?.Sheets?.[
        state.sheetConfig.sheetName
      ];

    if (!sheet) {
      return [];
    }

    const items = [];

    getLoggingItemSections(
      state.sheetConfig
    ).forEach(
      section => {
        const rowNumbers =
          new Set();

        const sourceColumn =
          Math.min(
            ...(
              section.ranges || []
            ).map(
              rangeText =>
                parseRange(
                  rangeText
                ).s.c
            )
          );

        (
          section.ranges || []
        ).forEach(
          rangeText => {
            const range =
              parseRange(
                rangeText
              );

            for (
              let row = range.s.r;
              row <= range.e.r;
              row += 1
            ) {
              rowNumbers.add(
                row + 1
              );
            }
          }
        );

        [
          ...rowNumbers
        ].sort(
          (left, right) =>
            left - right
        ).forEach(
          rowNumber => {
            const nameParts =
              (
                section.nameColumns || []
              ).map(
                column =>
                  getTemplateCellText(
                    sheet,
                    `${column}${rowNumber}`
                  )
              ).filter(
                (value, index, array) =>
                  value &&
                  array.indexOf(value) ===
                    index
              );

            const name =
              nameParts.join(
                " · "
              );

            if (!name) {
              return;
            }

            const tag =
              section.tagColumn
                ? getTemplateCellText(
                    sheet,
                    `${section.tagColumn}${rowNumber}`
                  )
                : "";

            const unit =
              section.unitColumn
                ? getTemplateCellText(
                    sheet,
                    `${section.unitColumn}${rowNumber}`
                  )
                : "";

            items.push({
              name,
              tag,
              unit,
              sourceRow:
                rowNumber,
              sourceColumn
            });
          }
        );
      }
    );

    items.sort(
      (left, right) =>
        left.sourceRow -
          right.sourceRow ||
        left.sourceColumn -
          right.sourceColumn
    );

    return items.map(
      (item, index) => ({
        ...item,
        order:
          index + 1
      })
    );
  }

  function renderLoggingItemList() {
    if (
      !elements.itemList ||
      !elements.itemCount
    ) {
      return;
    }

    const items =
      extractLoggingItems();

    elements.itemCount.textContent =
      `${items.length}개`;

    if (!items.length) {
      const empty =
        document.createElement(
          "div"
        );

      empty.className =
        "log-sheet-item-list__empty";

      empty.textContent =
        "표시할 Logging 항목이 없습니다.";

      elements.itemList.replaceChildren(
        empty
      );

      return;
    }

    const fragment =
      document.createDocumentFragment();

    items.forEach(
      item => {
        const row =
          document.createElement(
            "div"
          );

        row.className =
          "log-sheet-item-row";

        const order =
          document.createElement(
            "span"
          );

        order.className =
          "log-sheet-item-row__order";

        order.textContent =
          String(item.order);

        const name =
          document.createElement(
            "strong"
          );

        name.className =
          "log-sheet-item-row__name";

        name.textContent =
          item.name;

        const tag =
          document.createElement(
            "span"
          );

        tag.className =
          "log-sheet-item-row__tag";

        tag.textContent =
          item.tag || "-";

        const unit =
          document.createElement(
            "span"
          );

        unit.className =
          "log-sheet-item-row__unit";

        unit.textContent =
          item.unit || "-";

        const editButton =
          document.createElement(
            "button"
          );

        editButton.type =
          "button";

        editButton.textContent =
          "수정";

        editButton.disabled =
          true;

        editButton.title =
          "다음 단계에서 수정 기능을 연결합니다.";

        row.append(
          order,
          name,
          tag,
          unit,
          editButton
        );

        fragment.appendChild(
          row
        );
      }
    );

    elements.itemList.replaceChildren(
      fragment
    );
  }

'@

  $js = Replace-Once `
    $js `
    '  function renderGrid() {' `
    ($loggingFunctions + '  function renderGrid() {') `
    'Logging 항목 함수 삽입'
}

# ---------------------------------------------------------
# 3. 최초 로드와 시트 전환 때 목록 갱신
# ---------------------------------------------------------
if ($js -notmatch 'renderAuxiliaryControls\(\);\s*renderLoggingItemList\(\);\s*renderGrid\(\);') {
  $oldSwitch = @'
    renderTabs();
    renderAuxiliaryControls();
    renderGrid();
'@

  $newSwitch = @'
    renderTabs();
    renderAuxiliaryControls();
    renderLoggingItemList();
    renderGrid();
'@

  $js = Replace-Once $js $oldSwitch $newSwitch '시트 전환 목록 갱신'
}

if ($js -notmatch 'ensureMetadataValues\(\);[\s\S]*?renderLoggingItemList\(\);\s*renderGrid\(\);\s*renderAuxiliaryControls\(\);') {
  $oldStart = @'
      renderGrid();
      renderAuxiliaryControls();
'@

  $newStart = @'
      renderLoggingItemList();
      renderGrid();
      renderAuxiliaryControls();
'@

  $js = Replace-Once $js $oldStart $newStart '최초 로드 목록 출력'
}

# ---------------------------------------------------------
# 4. 목록 행 디자인
# ---------------------------------------------------------
if ($css -notmatch 'Logging 항목 목록 행') {
  $itemRowCss = @'

/* =========================================================
  Logging 항목 목록 행
========================================================= */

.log-sheet-item-row {
  display: grid;

  grid-template-columns:
    54px
    minmax(180px, 1fr)
    minmax(135px, 0.65fr)
    80px
    66px;

  min-height: 39px;

  align-items: center;

  padding:
    0
    10px;

  border-bottom:
    1px solid
    #e3eaf1;

  color: #334f69;

  font-size: 10px;
}


.log-sheet-item-row:last-child {
  border-bottom: 0;
}


.log-sheet-item-row:hover {
  background: #f8fbfe;
}


.log-sheet-item-row > * {
  min-width: 0;
}


.log-sheet-item-row__order,
.log-sheet-item-row__unit {
  color: #73869a;

  font-size: 9px;
  font-weight: 850;

  text-align: center;
}


.log-sheet-item-row__name {
  overflow: hidden;

  padding-right: 12px;

  color: #203e5c;

  font-size: 10px;
  font-weight: 850;
  line-height: 1.35;

  text-overflow: ellipsis;
  white-space: nowrap;
}


.log-sheet-item-row__tag {
  overflow: hidden;

  padding-right: 10px;

  color: #53708b;

  font-size: 9px;
  font-weight: 750;

  text-overflow: ellipsis;
  white-space: nowrap;
}


.log-sheet-item-row > button {
  min-height: 27px;

  padding:
    0
    9px;

  border:
    1px solid
    #b8cbdd;

  border-radius: 7px;

  background: #f4f8fc;

  color: #53718e;

  font-size: 9px;
  font-weight: 850;
}


.log-sheet-item-row > button:disabled {
  cursor: not-allowed;

  opacity: 0.55;
}


.log-sheet-item-list {
  max-height:
    min(
      620px,
      calc(100vh - 270px)
    );

  overflow-y: auto;
}
'@

  $css += $itemRowCss
}

[System.IO.File]::WriteAllText($jsPath, $js, $utf8NoBom)
[System.IO.File]::WriteAllText($cssPath, $css, $utf8NoBom)

# ---------------------------------------------------------
# 5. 문법 검사
# ---------------------------------------------------------
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue

if ($nodeCommand) {
  & $nodeCommand.Source --check $jsPath

  if ($LASTEXITCODE -ne 0) {
    Copy-Item -LiteralPath (Join-Path $backupDir 'log-sheet.js') -Destination $jsPath -Force
    Copy-Item -LiteralPath (Join-Path $backupDir 'log-sheet.css') -Destination $cssPath -Force

    throw 'JavaScript 문법 오류가 발생해 원본 파일로 복원했습니다.'
  }
} else {
  Write-Warning 'node 명령을 찾지 못해 JavaScript 문법 검사를 생략했습니다.'
}

Write-Host ''
Write-Host '--- 적용 확인 ---'
Select-String -Path $jsPath -Pattern `
  'renderLoggingItemList', `
  'logSheetItemCount', `
  'field-night-bo12' |
  Select-Object -First 12

Select-String -Path $cssPath -Pattern `
  'Logging 항목 목록 행', `
  'log-sheet-item-row' |
  Select-Object -First 12

Write-Host ''
Write-Host '--- 변경 파일 ---'
git status --short -- `
  'inspection-logs/log-sheets/log-sheet.js' `
  'inspection-logs/log-sheets/log-sheet.css'

Write-Host ''
Write-Host '완료: 캐시 버전은 변경하지 않았습니다.'
