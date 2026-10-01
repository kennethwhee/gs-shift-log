/* MORNING_MEETING_WATER_NEGATIVE_CLAMP_V1
 *
 * Business rule:
 * Morning-meeting water-treatment values are never displayed as negative.
 * Any finite negative numeric value is clamped to zero.
 *
 * This is presentation/current-value normalization only.
 * OIS source records are never written or modified here.
 */
(function installMorningMeetingWaterNegativeClamp(root) {
  "use strict";

  if (!root) return;

  const VERSION = "20261002-r7";

  const VALUE_IDS = Object.freeze([
    "efficiencyMorningMeetingRawWaterInflow",
    "efficiencyMorningMeetingDemiProduction",
    "efficiencyMorningMeetingPureWaterUsage",
    "efficiencyMorningMeetingRawWaterTankAmount",
    "efficiencyMorningMeetingRawWaterTankRate",
    "efficiencyMorningMeetingFilteredWaterTankAmount",
    "efficiencyMorningMeetingFilteredWaterTankRate",
    "efficiencyMorningMeetingDemiWaterTankAmount",
    "efficiencyMorningMeetingDemiWaterTankRate",
    "efficiencyMorningMeetingAutoWaterRawInflow",
    "efficiencyMorningMeetingAutoWaterDemiFlow",
    "efficiencyMorningMeetingAutoWaterRawTank",
    "efficiencyMorningMeetingAutoWaterFilteredTank",
    "efficiencyMorningMeetingAutoWaterDemiTank"
  ]);

  function zeroLike(numberText) {
    const raw =
      String(numberText || "")
        .replaceAll(",", "");

    const decimal =
      raw.includes(".")
        ? raw.split(".")[1] || ""
        : "";

    return decimal.length > 0
      ? "0." + "0".repeat(decimal.length)
      : "0";
  }

  function normalizeText(value) {
    const source =
      String(value ?? "");

    /*
     * Match only a minus sign directly attached to a number.
     * A placeholder "-" is therefore left unchanged.
     */
    return source.replace(
      /-(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)/g,
      match => zeroLike(match.slice(1))
    );
  }

  function finiteNumber(value) {
    if (typeof value === "number") {
      return Number.isFinite(value)
        ? value
        : null;
    }

    const raw =
      String(value ?? "")
        .trim()
        .replaceAll(",", "");

    if (
      !raw ||
      raw === "-"
    ) {
      return null;
    }

    const number =
      Number(raw);

    return Number.isFinite(number)
      ? number
      : null;
  }

  function clampScalar(value) {
    const number =
      finiteNumber(value);

    if (
      number === null ||
      number >= 0
    ) {
      return value;
    }

    return 0;
  }

  function clampElement(element) {
    if (!element) return false;

    let changed = false;

    const before =
      String(
        element.textContent ?? ""
      );

    const after =
      normalizeText(before);

    if (after !== before) {
      element.textContent = after;
      changed = true;
    }

    const rawValue =
      element.dataset &&
      Object.prototype.hasOwnProperty.call(
        element.dataset,
        "rawValue"
      )
        ? element.dataset.rawValue
        : undefined;

    const rawNumber =
      finiteNumber(rawValue);

    if (
      rawNumber !== null &&
      rawNumber < 0
    ) {
      element.dataset.rawValue = "0";
      changed = true;
    }

    if (
      "value" in element
    ) {
      const valueNumber =
        finiteNumber(element.value);

      if (
        valueNumber !== null &&
        valueNumber < 0
      ) {
        element.value = "0";
        changed = true;
      }
    }

    return changed;
  }

  function valueElements() {
    const doc =
      root.document;

    if (!doc) return [];

    const result = [];
    const seen = new Set();

    for (const id of VALUE_IDS) {
      const element =
        doc.getElementById(id);

      if (
        element &&
        !seen.has(element)
      ) {
        seen.add(element);
        result.push(element);
      }
    }

    /*
     * Future-proof the visible water cards without touching their
     * date/status labels.
     */
    for (
      const element of
      doc.querySelectorAll(
        "#efficiencyMorningMeetingWaterPanel strong, " +
        ".efficiency-morning-meeting-auto-card.is-water " +
        ".efficiency-morning-meeting-auto-card__body strong"
      )
    ) {
      if (!seen.has(element)) {
        seen.add(element);
        result.push(element);
      }
    }

    return result;
  }

  function apply() {
    let changed = 0;

    for (
      const element of
      valueElements()
    ) {
      if (clampElement(element)) {
        changed += 1;
      }
    }

    return changed;
  }

  const api =
    Object.freeze({
      version: VERSION,
      normalizeText,
      finiteNumber,
      clampScalar,
      apply
    });

  root.morningMeetingWaterNegativeClamp =
    api;

  if (!root.document) {
    return;
  }

  function installObserver() {
    apply();

    if (
      typeof root.MutationObserver !==
      "function"
    ) {
      return;
    }

    const observer =
      new root.MutationObserver(
        () => {
          apply();
        }
      );

    const targets = [
      root.document.getElementById(
        "efficiencyMorningMeetingWaterPanel"
      ),
      root.document.querySelector(
        ".efficiency-morning-meeting-auto-card.is-water"
      )
    ].filter(Boolean);

    for (const target of targets) {
      observer.observe(
        target,
        {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: [
            "data-raw-value",
            "value"
          ]
        }
      );
    }
  }

  if (
    root.document.readyState ===
    "loading"
  ) {
    root.document.addEventListener(
      "DOMContentLoaded",
      installObserver,
      { once: true }
    );
  } else {
    installObserver();
  }
})(
  typeof window === "object"
    ? window
    : globalThis
);
