(function initializeLogSheetConfig(globalScope) {
  "use strict";

  /*
    Log Sheet template manifest

    Rules used by the common editor:
    - `type` is the value used by `log-sheet.html?type=...`.
    - `sheet.key` is the persistent D1 sheet key.
    - Only cells covered by `editableRanges` or `editableCells` may be saved.
    - When a range contains merged cells, only the merge anchor (top-left cell)
      is editable. Merged slave cells must never be sent to the API.
    - The original XLSX is immutable. Downloads patch only approved cells into
      a fresh copy of the corresponding template.
  */

  const TEMPLATE_ROOT =
    "templates/";

  const A4_PAPER_SIZE_CODE =
    9;

  const MERGE_POLICY =
    "anchor-only";

  function makePrintSettings(
    area,
    orientation,
    scale,
    fitToHeight = null
  ) {
    return {
      area,
      orientation,
      paperSize: "A4",
      paperSizeCode:
        A4_PAPER_SIZE_CODE,
      scale,
      fitToHeight
    };
  }

  const documents = {
    "integrated-tgo": {
      type: "integrated-tgo",
      title: "TGO",
      groupTitle:
        "통합 제어실 Log Sheet",
      navigationPath: [
        "Log Sheet",
        "통합 제어실 Log Sheet",
        "TGO"
      ],
      templateFile:
        TEMPLATE_ROOT +
        "integrated-control-log-sheet.xlsx",
      templateSha256:
        "811c6d7cf35f304a0982b7ed759c280f594df7706daf7656aa0a571c7efb1d4e",
      sheets: [
        {
          key: "integrated-tgo",
          title: "TGO",
          sheetName: "TGO",
          renderRange: "A1:V120",
          print: makePrintSettings(
            "A1:V120",
            "landscape",
            48,
            0
          ),
          mergePolicy: MERGE_POLICY,
          loggingSchedule: {
            startHour: 8,
            defaultIntervalHours: 2,
            supportedIntervals: [
              2,
              3,
              4,
              6
            ],
            startColumn: "J",
            endColumn: "U",
            headerRows: [
              6,
              57
            ],
            dataRanges: [
              "J7:U54",
              "J58:U103"
            ]
          },
          editableRanges: [
            "J7:U54",
            "J58:U103",
            "J108:J119",
            "P108:P119"
          ],
          editableCells: [
            "R3",
            "T3",
            "R4",
            "T4",
            "S5"
          ],
          headerCells: {
            dayShiftChief: {
              address: "R3"
            },
            nightShiftChief: {
              address: "T3"
            },
            dayOperator: {
              address: "R4"
            },
            nightOperator: {
              address: "T4"
            },
            date: {
              address: "S5",
              valueTemplate:
                "{yyyy}. {MM}. {dd} ({weekday})"
            }
          }
        }
      ]
    },

    "integrated-bco1": {
      type: "integrated-bco1",
      title: "BCO1",
      groupTitle:
        "통합 제어실 Log Sheet",
      navigationPath: [
        "Log Sheet",
        "통합 제어실 Log Sheet",
        "BCO1"
      ],
      templateFile:
        TEMPLATE_ROOT +
        "integrated-control-log-sheet.xlsx",
      templateSha256:
        "811c6d7cf35f304a0982b7ed759c280f594df7706daf7656aa0a571c7efb1d4e",
      sheets: [
        {
          key: "integrated-bco1",
          title: "BCO1",
          sheetName: "BCO1",
          renderRange: "A1:U85",
          print: makePrintSettings(
            "A1:U85",
            "landscape",
            50,
            4
          ),
          mergePolicy: MERGE_POLICY,
          loggingSchedule: {
            startHour: 8,
            defaultIntervalHours: 2,
            supportedIntervals: [
              2,
              3,
              4,
              6
            ],
            startColumn: "J",
            endColumn: "U",
            headerRows: [
              6,
              40
            ],
            dataRanges: [
              "J7:U37",
              "J41:U85"
            ]
          },
          editableRanges: [
            "J7:U37",
            "J41:U85"
          ],
          editableCells: [
            "R3",
            "T3",
            "R4",
            "T4",
            "R5"
          ],
          headerCells: {
            dayShiftChief: {
              address: "R3"
            },
            nightShiftChief: {
              address: "T3"
            },
            dayOperator: {
              address: "R4"
            },
            nightOperator: {
              address: "T4"
            },
            date: {
              address: "R5",
              valueTemplate:
                "{yyyy}. {MM}. {dd} ({weekday})"
            }
          }
        }
      ]
    },

    "integrated-bco2": {
      type: "integrated-bco2",
      title: "BCO2",
      groupTitle:
        "통합 제어실 Log Sheet",
      navigationPath: [
        "Log Sheet",
        "통합 제어실 Log Sheet",
        "BCO2"
      ],
      templateFile:
        TEMPLATE_ROOT +
        "integrated-control-log-sheet.xlsx",
      templateSha256:
        "811c6d7cf35f304a0982b7ed759c280f594df7706daf7656aa0a571c7efb1d4e",
      sheets: [
        {
          key: "integrated-bco2",
          title: "BCO2",
          sheetName: "BCO2",
          renderRange: "A1:U86",
          print: makePrintSettings(
            "A1:U86",
            "landscape",
            54,
            4
          ),
          mergePolicy: MERGE_POLICY,
          loggingSchedule: {
            startHour: 8,
            defaultIntervalHours: 2,
            supportedIntervals: [
              2,
              3,
              4,
              6
            ],
            startColumn: "J",
            endColumn: "U",
            headerRows: [
              6,
              49
            ],
            dataRanges: [
              "J7:U46",
              "J50:U85"
            ]
          },
          editableRanges: [
            "J7:U46",
            "J50:U85"
          ],
          editableCells: [
            "R3",
            "T3",
            "R4",
            "T4",
            "R5"
          ],
          headerCells: {
            dayShiftChief: {
              address: "R3"
            },
            nightShiftChief: {
              address: "T3"
            },
            dayOperator: {
              address: "R4"
            },
            nightOperator: {
              address: "T4"
            },
            date: {
              address: "R5",
              valueTemplate:
                "{yyyy}. {MM}. {dd} ({weekday})"
            }
          }
        }
      ]
    },

    "field-night-leader-to": {
      type: "field-night-leader-to",
      title: "파트장·TO 야간",
      groupTitle:
        "현장 Log Sheet · 야간",
      navigationPath: [
        "Log Sheet",
        "현장 Log Sheet",
        "야간",
        "파트장·TO"
      ],
      templateFile:
        TEMPLATE_ROOT +
        "field-log-sheet.xlsx",
      templateSha256:
        "548f04366e86bb44c057271f42c7975a33c781160a0a8f6c167a49bf0543f68c",
      sheets: [
        {
          key: "field-night-leader-to",
          title: "파트장·TO 야간",
          sheetName: "파트장&TO (야간)",
          renderRange: "B1:M112",
          print: makePrintSettings(
            "B1:M112",
            "landscape",
            66,
            0
          ),
          mergePolicy: MERGE_POLICY,
          editableRanges: [
            "J7:M35",
            "J37:M69",
            "J71:M105",
            "G108:G112",
            "K108:K112",
            "M108:M112"
          ],
          editableCells: [
            "B4",
            "M2",
            "M3"
          ],
          headerCells: {
            date: {
              address: "B4",
              valueTemplate:
                "{yyyy}. {MM}. {dd} ({weekday})"
            },
            shiftChief: {
              address: "M2"
            },
            operator: {
              address: "M3"
            }
          },
          choiceRanges: [
            {
              ranges: [
                "G108:G112",
                "K108:K112",
                "M108:M112"
              ],
              options: [
                "양호",
                "불량"
              ]
            }
          ]
        }
      ]
    },

    "field-night-bo12": {
      type: "field-night-bo12",
      title: "BO1·2 야간",
      groupTitle:
        "현장 Log Sheet · 야간",
      navigationPath: [
        "Log Sheet",
        "현장 Log Sheet",
        "야간",
        "BO1·2"
      ],
      templateFile:
        TEMPLATE_ROOT +
        "field-log-sheet.xlsx",
      templateSha256:
        "548f04366e86bb44c057271f42c7975a33c781160a0a8f6c167a49bf0543f68c",
      sheets: [
        {
          key: "field-night-bo12",
          title: "BO1·2 야간",
          sheetName: "BO1&2 Night",
          renderRange: "A1:Q118",
          print: makePrintSettings(
            "A1:Q118",
            "landscape",
            55,
            null
          ),
          mergePolicy: MERGE_POLICY,
          editableRanges: [
            "J7:Q34",
            "J36:K40",
            "P36:Q40",
            "J42:Q68",
            "H70:H77",
            "O70:O77",
            "J79:Q118"
          ],
          editableCells: [
            "B4",
            "N2",
            "P2",
            "N3",
            "P3"
          ],
          headerCells: {
            date: {
              address: "B4",
              valueTemplate:
                "{yyyy}. {MM}. {dd} ({weekday})"
            },
            unitOneShiftChief: {
              address: "N2"
            },
            unitTwoShiftChief: {
              address: "P2"
            },
            unitOneOperator: {
              address: "N3"
            },
            unitTwoOperator: {
              address: "P3"
            }
          },
          choiceRanges: [
            {
              ranges: [
                "J36:J40",
                "P36:P40"
              ],
              options: [
                "양호",
                "불량"
              ]
            }
          ]
        }
      ]
    },

    "field-day-to": {
      type: "field-day-to",
      title: "TO 주간",
      groupTitle:
        "현장 Log Sheet · 주간",
      navigationPath: [
        "Log Sheet",
        "현장 Log Sheet",
        "주간",
        "TO"
      ],
      templateFile:
        TEMPLATE_ROOT +
        "field-log-sheet.xlsx",
      templateSha256:
        "548f04366e86bb44c057271f42c7975a33c781160a0a8f6c167a49bf0543f68c",
      sheets: [
        {
          key: "field-day-to",
          title: "TO 주간",
          sheetName: "TO (주간)",
          renderRange: "B1:M105",
          print: makePrintSettings(
            "B1:M105",
            "landscape",
            66,
            0
          ),
          mergePolicy: MERGE_POLICY,
          editableRanges: [
            "J7:M35",
            "J37:M69",
            "J71:M105"
          ],
          editableCells: [
            "B4",
            "M2",
            "M3"
          ],
          headerCells: {
            date: {
              address: "B4",
              valueTemplate:
                "{yyyy}. {MM}. {dd} ({weekday})"
            },
            shiftChief: {
              address: "M2"
            },
            operator: {
              address: "M3"
            }
          }
        }
      ]
    },

    "field-day-bo1": {
      type: "field-day-bo1",
      title: "BO1 주간",
      groupTitle:
        "현장 Log Sheet · 주간",
      navigationPath: [
        "Log Sheet",
        "현장 Log Sheet",
        "주간",
        "BO1"
      ],
      templateFile:
        TEMPLATE_ROOT +
        "field-log-sheet.xlsx",
      templateSha256:
        "548f04366e86bb44c057271f42c7975a33c781160a0a8f6c167a49bf0543f68c",
      sheets: [
        {
          key: "field-day-bo1",
          title: "BO1 주간",
          sheetName: "BO1",
          renderRange: "A1:M88",
          print: makePrintSettings(
            "A1:M88",
            "landscape",
            65,
            0
          ),
          mergePolicy: MERGE_POLICY,
          editableRanges: [
            "J7:M34",
            "J36:M73",
            "J75:M88"
          ],
          editableCells: [
            "B4",
            "M2",
            "M3"
          ],
          headerCells: {
            date: {
              address: "B4",
              valueTemplate:
                "{yyyy}. {MM}. {dd} ({weekday})"
            },
            shiftChief: {
              address: "M2"
            },
            operator: {
              address: "M3"
            }
          }
        }
      ]
    },

    "field-day-bo2": {
      type: "field-day-bo2",
      title: "BO2 주간",
      groupTitle:
        "현장 Log Sheet · 주간",
      navigationPath: [
        "Log Sheet",
        "현장 Log Sheet",
        "주간",
        "BO2"
      ],
      templateFile:
        TEMPLATE_ROOT +
        "field-log-sheet.xlsx",
      templateSha256:
        "548f04366e86bb44c057271f42c7975a33c781160a0a8f6c167a49bf0543f68c",
      sheets: [
        {
          key: "field-day-bo2",
          title: "BO2 주간",
          sheetName: "BO2",
          renderRange: "A1:M83",
          print: makePrintSettings(
            "A1:M83",
            "landscape",
            65,
            0
          ),
          mergePolicy: MERGE_POLICY,
          editableRanges: [
            "J7:M32",
            "J34:M69",
            "J71:M83"
          ],
          editableCells: [
            "B4",
            "M2",
            "M3"
          ],
          headerCells: {
            date: {
              address: "B4",
              valueTemplate:
                "{yyyy}. {MM}. {dd} ({weekday})"
            },
            shiftChief: {
              address: "M2"
            },
            operator: {
              address: "M3"
            }
          }
        }
      ]
    },

    electrical: {
      type: "electrical",
      title: "Elec. Log Sheet",
      groupTitle: "Log Sheet",
      navigationPath: [
        "Log Sheet",
        "Elec. Log Sheet"
      ],
      templateFile:
        TEMPLATE_ROOT +
        "electrical-log-sheet.xlsx",
      templateSha256:
        "9f9a5f359680bf376aba1c5ff79128750494569e94875555b6d62d7d321a3135",
      sheets: [
        {
          key: "electrical-main",
          title: "Elec. Log Sheet",
          sheetName: "전기 Sheet",
          renderRange: "A1:V48",
          print: makePrintSettings(
            "A1:V48",
            "portrait",
            61,
            null
          ),
          mergePolicy: MERGE_POLICY,
          editableRanges: [
            "J10:J47",
            "M10:M47",
            "P10:P47",
            "S10:S47"
          ],
          editableCells: [
            "R2",
            "R3",
            "O5",
            "S5"
          ],
          headerCells: {
            date: {
              address: "R2",
              valueTemplate:
                "{yyyy}. {MM}. {dd}"
            },
            shiftTeam: {
              address: "R3"
            },
            operator: {
              address: "O5"
            },
            shiftChief: {
              address: "S5"
            }
          }
        },
        {
          key: "electrical-patrol",
          title:
            "야간 순찰 점검일지",
          sheetName:
            "야간 순찰 점검일지 양식",
          renderRange: "A1:I34",
          print: makePrintSettings(
            "A1:I34",
            "portrait",
            73,
            null
          ),
          mergePolicy: MERGE_POLICY,
          editableRanges: [
            "G6:H28"
          ],
          editableCells: [
            "P2",
            "G3",
            "H3",
            "G4",
            "B30"
          ],
          auxiliaryControlCells: [
            "P2"
          ],
          headerCells: {
            patrolPart: {
              address: "P2",
              options: [
                1,
                2,
                3,
                4
              ]
            },
            shiftChief: {
              address: "G3"
            },
            teamLeader: {
              address: "H3"
            },
            date: {
              address: "G4",
              valueTemplate:
                "점검 일자 : {yyyy}. {MM}. {dd}"
            },
            remarks: {
              address: "B30"
            }
          },
          choiceRanges: [
            {
              ranges: [
                "G6:G28"
              ],
              options: [
                "양호",
                "불량"
              ]
            }
          ],
          formulaPolicy: {
            preserveTemplateFormulas: true,
            preserveHiddenSheets: true,
            freezeVisibleValuesOnRecordCreate: true,
            generatedSnapshotRanges: [
              "D6",
              "D12",
              "D18",
              "D24",
              "F6:F28"
            ],
            freezeFormulaRanges: [
              "D6",
              "D12",
              "D18",
              "D24",
              "F6:F28"
            ]
          }
        }
      ]
    },

    "aux-control-room": {
      type: "aux-control-room",
      title:
        "고압 Aux BLR 제어실",
      groupTitle: "Log Sheet",
      navigationPath: [
        "Log Sheet",
        "고압 Aux BLR 제어실"
      ],
      templateFile:
        TEMPLATE_ROOT +
        "aux-boiler-control-room-log-sheet.xlsx",
      templateSha256:
        "feda2b1272902d4a317d25c391f1c1b9dd3bdbbee2e5a490dc65b1e899f8421a",
      sheets: [
        {
          key: "aux-control-room",
          title:
            "고압 Aux BLR 제어실",
          sheetName:
            "고압보조보일러 제어실",
          renderRange: "A1:S85",
          print: makePrintSettings(
            "A1:S85",
            "landscape",
            44,
            0
          ),
          mergePolicy: MERGE_POLICY,
          editableRanges: [
            "H10:S41",
            "H45:S85"
          ],
          editableCells: [
            "A6",
            "P4",
            "R4",
            "P5",
            "R5"
          ],
          headerCells: {
            date: {
              address: "A6",
              valueTemplate:
                "{yyyy}년 {MM}월 {dd}일"
            },
            dayShiftChief: {
              address: "P4"
            },
            nightShiftChief: {
              address: "R4"
            },
            dayOperator: {
              address: "P5"
            },
            nightOperator: {
              address: "R5"
            }
          }
        }
      ]
    },

    "aux-field": {
      type: "aux-field",
      title:
        "고압 Aux BLR 현장",
      groupTitle: "Log Sheet",
      navigationPath: [
        "Log Sheet",
        "고압 Aux BLR 현장"
      ],
      templateFile:
        TEMPLATE_ROOT +
        "aux-boiler-field-log-sheet.xlsx",
      templateSha256:
        "0ba5d71b4e27dd1be53e3a715841378c2f799f1e41f3321d73a9d0dcfe052874",
      sheets: [
        {
          key: "aux-field",
          title:
            "고압 Aux BLR 현장",
          sheetName: "Aux Local",
          renderRange: "A1:R46",
          print: makePrintSettings(
            "A1:R46",
            "landscape",
            43,
            0
          ),
          mergePolicy: MERGE_POLICY,
          editableRanges: [
            "G8:N46",
            "P9:R46"
          ],
          editableCells: [
            "A4",
            "N2",
            "P2",
            "N3",
            "P3"
          ],
          headerCells: {
            date: {
              address: "A4",
              valueTemplate:
                "{yyyy}년 {MM}월 {dd}일"
            },
            dayShiftChief: {
              address: "N2"
            },
            nightShiftChief: {
              address: "P2"
            },
            dayOperator: {
              address: "N3"
            },
            nightOperator: {
              address: "P3"
            }
          }
        }
      ]
    }
  };

  const sheetIndex = {};

  Object.values(
    documents
  ).forEach(
    documentConfig => {
      documentConfig.sheets.forEach(
        sheetConfig => {
          sheetIndex[
            sheetConfig.key
          ] = {
            ...sheetConfig,
            type:
              documentConfig.type,
            documentTitle:
              documentConfig.title,
            groupTitle:
              documentConfig.groupTitle,
            navigationPath:
              documentConfig.navigationPath,
            templateFile:
              documentConfig.templateFile,
            templateSha256:
              documentConfig.templateSha256
          };
        }
      );
    }
  );

  function deepFreeze(value) {
    if (
      !value ||
      typeof value !== "object" ||
      Object.isFrozen(value)
    ) {
      return value;
    }

    Object.freeze(value);

    Object.values(value).forEach(
      nestedValue => {
        deepFreeze(nestedValue);
      }
    );

    return value;
  }

  const config =
    deepFreeze({
      version:
        "2026-08-19-log-sheet-logging-interval-1",
      defaultType:
        "integrated-tgo",
      apiPath:
        "/api/inspection-log-sheets",
      recordIdentityFields: [
        "type",
        "sheetKey",
        "logDate",
        "shift",
        "team"
      ],
      saveMode:
        "manual-single-request",
      automaticPolling: false,
      documents,
      sheetIndex,
      routeAliases: {
        "electrical-main": {
          type: "electrical",
          sheetKey:
            "electrical-main"
        },
        "electrical-patrol": {
          type: "electrical",
          sheetKey:
            "electrical-patrol"
        }
      }
    });

  globalScope.LOG_SHEET_CONFIG =
    config;

  if (
    typeof module !== "undefined" &&
    module.exports
  ) {
    module.exports =
      config;
  }
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : window
);