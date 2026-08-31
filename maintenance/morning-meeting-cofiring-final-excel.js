(() => {
  "use strict";

  if (window.__morningMeetingCofiringFinalExcelV1Installed === true) {
    return;
  }

  window.__morningMeetingCofiringFinalExcelV1Installed = true;

  const VALUE_IDS = {
    unitOneCoal: "efficiencyMorningMeetingCofiringUnit1CoalUsage",
    unitOneBio: "efficiencyMorningMeetingCofiringUnit1BioUsage",
    unitOneBioRatio: "efficiencyMorningMeetingCofiringUnit1BioRatio",
    unitTwoCoal: "efficiencyMorningMeetingCofiringUnit2CoalUsage",
    unitTwoBio: "efficiencyMorningMeetingCofiringUnit2BioUsage",
    unitTwoBioRatio: "efficiencyMorningMeetingCofiringUnit2BioRatio",
    unitOneOrganic: "efficiencyMorningMeetingCofiringUnit1OrganicInput",
    unitOneOrganicRatio: "efficiencyMorningMeetingCofiringUnit1OrganicRatio",
    unitTwoOrganic: "efficiencyMorningMeetingCofiringUnit2OrganicInput",
    unitTwoOrganicRatio: "efficiencyMorningMeetingCofiringUnit2OrganicRatio"
  };

  const DIRECT_CELL_MAPPINGS = [
    ["I7", "unitOneCoal"],
    ["I8", "unitTwoCoal"],
    ["N7", "unitOneBio"],
    ["N8", "unitTwoBio"],
    ["X7", "unitOneBioRatio"],
    ["X8", "unitTwoBioRatio"],
    ["Z7", "unitOneOrganic"],
    ["Z8", "unitTwoOrganic"],
    ["AE7", "unitOneOrganicRatio"],
    ["AE8", "unitTwoOrganicRatio"],
    ["X9", "bioAverageRatio"],
    ["AE9", "organicAverageRatio"]
  ];

  const FORMULA_CELLS_PRESERVED = [
    "L7", "L8",
    "U7", "U8", "U9",
    "AC7", "AC8", "AC9",
    "N9", "Z9", "X10", "I11", "L11"
  ];

  function normalizeNumber(value) {
    if (value === null || value === undefined) {
      return null;
    }

    const normalized = String(value)
      .replaceAll(",", "")
      .trim();

    if (!normalized || normalized === "-") {
      return null;
    }

    const match = normalized.match(/-?\d+(?:\.\d+)?/);
    if (!match) {
      return null;
    }

    const numericValue = Number(match[0]);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  function round(value, digits = 8) {
    if (!Number.isFinite(value)) {
      return null;
    }

    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function readElementNumber(id) {
    const element = document.getElementById(id);
    return normalizeNumber(element?.textContent);
  }

  function readDate(id) {
    const element = document.getElementById(id);
    const text = String(element?.textContent || element?.value || "").trim();
    const match = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    return match ? match[1] : "";
  }

  function getReferenceDate() {
    const ids = [
      "efficiencyMorningMeetingAutoDailyPowerDate",
      "efficiencyMorningMeetingAutoSteamDate",
      "efficiencyMorningMeetingWaterDate"
    ];

    for (const id of ids) {
      const value = readDate(id);
      if (value) {
        return value;
      }
    }

    return "";
  }

  function normalizeSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
      return null;
    }

    const unitOne = snapshot.unitOne || {};
    const unitTwo = snapshot.unitTwo || {};

    return {
      targetDate: String(snapshot.targetDate || "").trim(),
      unitOneCoal: normalizeNumber(unitOne.coal),
      unitTwoCoal: normalizeNumber(unitTwo.coal),
      unitOneBio: normalizeNumber(unitOne.bio),
      unitTwoBio: normalizeNumber(unitTwo.bio),
      unitOneBioRatio: normalizeNumber(unitOne.bioRatio),
      unitTwoBioRatio: normalizeNumber(unitTwo.bioRatio),
      unitOneOrganic: normalizeNumber(unitOne.organic),
      unitTwoOrganic: normalizeNumber(unitTwo.organic),
      unitOneOrganicRatio: normalizeNumber(unitOne.organicRatio),
      unitTwoOrganicRatio: normalizeNumber(unitTwo.organicRatio),
      adjustmentApplied: snapshot.adjustmentApplied === true,
      source: "effective-snapshot"
    };
  }

  function getDisplayedValues() {
    const cardDate = readDate("efficiencyMorningMeetingCofiringDate");
    const referenceDate = getReferenceDate();

    const snapshotGetter = window.getMorningMeetingCofiringEffectiveValues;
    if (typeof snapshotGetter === "function") {
      try {
        const snapshot = normalizeSnapshot(snapshotGetter());
        if (
          snapshot &&
          (!referenceDate || !snapshot.targetDate || snapshot.targetDate === referenceDate)
        ) {
          return snapshot;
        }
      } catch (error) {
        console.warn("혼소율 최종 Excel effective snapshot 확인 실패; 화면값으로 대체합니다.", error);
      }
    }

    const values = {
      targetDate: cardDate,
      referenceDate,
      unitOneCoal: readElementNumber(VALUE_IDS.unitOneCoal),
      unitTwoCoal: readElementNumber(VALUE_IDS.unitTwoCoal),
      unitOneBio: readElementNumber(VALUE_IDS.unitOneBio),
      unitTwoBio: readElementNumber(VALUE_IDS.unitTwoBio),
      unitOneBioRatio: readElementNumber(VALUE_IDS.unitOneBioRatio),
      unitTwoBioRatio: readElementNumber(VALUE_IDS.unitTwoBioRatio),
      unitOneOrganic: readElementNumber(VALUE_IDS.unitOneOrganic),
      unitTwoOrganic: readElementNumber(VALUE_IDS.unitTwoOrganic),
      unitOneOrganicRatio: readElementNumber(VALUE_IDS.unitOneOrganicRatio),
      unitTwoOrganicRatio: readElementNumber(VALUE_IDS.unitTwoOrganicRatio),
      adjustmentApplied: document.getElementById("morningMeetingCofiringAdjustmentButton")?.classList?.contains("is-active") === true,
      source: "card-display"
    };

    if (cardDate && referenceDate && cardDate !== referenceDate) {
      return {
        ...values,
        dateMismatch: true
      };
    }

    return values;
  }

  function withDerivedAverages(values) {
    const unitOneBioRatio = normalizeNumber(values?.unitOneBioRatio);
    const unitTwoBioRatio = normalizeNumber(values?.unitTwoBioRatio);
    const unitOneOrganicRatio = normalizeNumber(values?.unitOneOrganicRatio);
    const unitTwoOrganicRatio = normalizeNumber(values?.unitTwoOrganicRatio);

    return {
      ...values,
      bioAverageRatio:
        unitOneBioRatio !== null && unitTwoBioRatio !== null
          ? round((unitOneBioRatio + unitTwoBioRatio) / 2)
          : null,
      organicAverageRatio:
        unitOneOrganicRatio !== null && unitTwoOrganicRatio !== null
          ? round((unitOneOrganicRatio + unitTwoOrganicRatio) / 2)
          : null
    };
  }

  function getExcelValues() {
    const displayed = getDisplayedValues();

    if (displayed?.dateMismatch) {
      console.warn(
        "혼소율 카드 날짜와 일일DATA 날짜가 달라 최종 Excel 혼소 입력셀은 빈칸 처리합니다.",
        {
          cardDate: displayed.targetDate,
          referenceDate: displayed.referenceDate
        }
      );

      return withDerivedAverages({
        targetDate: displayed.targetDate,
        referenceDate: displayed.referenceDate,
        source: displayed.source,
        dateMismatch: true
      });
    }

    return withDerivedAverages(displayed || {});
  }

  function applyValuesToWorksheet(worksheetDocument) {
    const writer = window.setMorningMeetingNumericCellValue;

    if (typeof writer !== "function") {
      throw new Error("최종 Excel 숫자 셀 기록 함수를 찾지 못했습니다.");
    }

    const values = getExcelValues();
    const results = [];
    const missingAddresses = [];

    for (const [address, key] of DIRECT_CELL_MAPPINGS) {
      const value = normalizeNumber(values?.[key]);
      const result = writer(worksheetDocument, address, value);

      if (!result?.found) {
        missingAddresses.push(address);
      }

      results.push({
        address,
        key,
        value,
        written: result?.written === true,
        cleared: result?.cleared === true,
        found: result?.found === true
      });
    }

    if (missingAddresses.length > 0) {
      throw new Error(
        `최종 Excel 혼소 입력셀을 찾지 못했습니다: ${missingAddresses.join(", ")}`
      );
    }

    return {
      source: values?.source || "card-display",
      targetDate: values?.targetDate || "",
      referenceDate: values?.referenceDate || "",
      dateMismatch: values?.dateMismatch === true,
      adjustmentApplied: values?.adjustmentApplied === true,
      appliedCount: results.filter((item) => item.written).length,
      clearedCount: results.filter((item) => item.cleared).length,
      totalCount: results.length,
      mappings: results,
      formulaCellsPreserved: [...FORMULA_CELLS_PRESERVED]
    };
  }

  function installWrapper() {
    const current = window.applyMorningMeetingDailyDataValues;

    if (typeof current !== "function") {
      return false;
    }

    if (current.__morningMeetingCofiringFinalExcelV1Wrapped === true) {
      return true;
    }

    const wrapped = function (...args) {
      const baseResult = current.apply(this, args);

      const appendCofiringResult = (resolvedBaseResult) => {
        const cofiringResult = applyValuesToWorksheet(args[0]);

        console.log("최종 Excel 혼소율·연료 사용량 반영 완료:", cofiringResult);

        if (
          resolvedBaseResult &&
          typeof resolvedBaseResult === "object" &&
          !Array.isArray(resolvedBaseResult)
        ) {
          return {
            ...resolvedBaseResult,
            cofiringFuelResult: cofiringResult
          };
        }

        return {
          baseResult: resolvedBaseResult,
          cofiringFuelResult: cofiringResult
        };
      };

      if (baseResult && typeof baseResult.then === "function") {
        return baseResult.then(appendCofiringResult);
      }

      return appendCofiringResult(baseResult);
    };

    wrapped.__morningMeetingCofiringFinalExcelV1Wrapped = true;
    wrapped.__morningMeetingCofiringFinalExcelV1Original = current;

    window.applyMorningMeetingDailyDataValues = wrapped;
    return true;
  }

  window.getMorningMeetingCofiringExcelValues = getExcelValues;
  window.applyMorningMeetingCofiringExcelValues = applyValuesToWorksheet;

  if (installWrapper()) {
    return;
  }

  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;

    if (installWrapper() || attempts >= 40) {
      window.clearInterval(timer);
    }
  }, 250);
})();
