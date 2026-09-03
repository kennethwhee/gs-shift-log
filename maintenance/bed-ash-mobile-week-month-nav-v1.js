"use strict";

/* Bed Ash mobile weekly month navigation V1
 * Adds a visible month navigator for weekly view and proxies the existing
 * hidden previous/next/today period controls. Core Bed Ash calculation and
 * range logic remain authoritative in efficiency/bed-ash-discharge.js.
 */
(function installBedAshMobileWeeklyMonthNavV1() {
  if (window.__bedAshMobileWeeklyMonthNavV1Installed === true) return;
  window.__bedAshMobileWeeklyMonthNavV1Installed = true;

  const VIEW_ID = "efficiencyBedAshDischargeView";
  const WEEK_SELECTOR_ID = "bedAshDischargeWeekSelector";
  const ANCHOR_DATE_ID = "bedAshDischargeAnchorDate";
  const CORE_PREVIOUS_ID = "bedAshDischargePreviousPeriodButton";
  const CORE_TODAY_ID = "bedAshDischargeTodayButton";
  const CORE_NEXT_ID = "bedAshDischargeNextPeriodButton";
  const RANGE_LABEL_ID = "bedAshDischargeRangeLabel";

  function parseAnchorMonth(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return {
      year: Number(match[1]),
      month: Number(match[2])
    };
  }

  function formatMonthLabel(value) {
    const parsed = parseAnchorMonth(value);
    return parsed ? `${parsed.year}년 ${parsed.month}월` : "조회 월";
  }

  function createButton(id, className, label, ariaLabel) {
    const button = document.createElement("button");
    button.type = "button";
    button.id = id;
    button.className = className;
    button.textContent = label;
    if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
    return button;
  }

  function install() {
    const view = document.getElementById(VIEW_ID);
    const weekSelector = document.getElementById(WEEK_SELECTOR_ID);
    const anchorDate = document.getElementById(ANCHOR_DATE_ID);
    const corePrevious = document.getElementById(CORE_PREVIOUS_ID);
    const coreToday = document.getElementById(CORE_TODAY_ID);
    const coreNext = document.getElementById(CORE_NEXT_ID);
    const rangeLabel = document.getElementById(RANGE_LABEL_ID);

    if (
      !view ||
      !weekSelector ||
      !anchorDate ||
      !corePrevious ||
      !coreToday ||
      !coreNext
    ) {
      return false;
    }

    let nav = document.getElementById("bedAshDischargeWeeklyMonthNav");
    if (!nav) {
      nav = document.createElement("div");
      nav.id = "bedAshDischargeWeeklyMonthNav";
      nav.className = "bed-ash-mobile-week-month-nav";
      nav.setAttribute("role", "group");
      nav.setAttribute("aria-label", "주별 조회 월 이동");
      nav.hidden = true;

      const previous = createButton(
        "bedAshDischargeWeeklyPreviousMonthButton",
        "bed-ash-mobile-week-month-nav__arrow is-previous",
        "‹",
        "이전 달"
      );

      const monthLabel = document.createElement("strong");
      monthLabel.id = "bedAshDischargeWeeklyMonthLabel";
      monthLabel.className = "bed-ash-mobile-week-month-nav__label";
      monthLabel.setAttribute("aria-live", "polite");
      monthLabel.textContent = formatMonthLabel(anchorDate.value);

      const current = createButton(
        "bedAshDischargeWeeklyCurrentMonthButton",
        "bed-ash-mobile-week-month-nav__current",
        "이번 달",
        "이번 달로 이동"
      );

      const next = createButton(
        "bedAshDischargeWeeklyNextMonthButton",
        "bed-ash-mobile-week-month-nav__arrow is-next",
        "›",
        "다음 달"
      );

      nav.append(previous, monthLabel, current, next);
      weekSelector.parentNode.insertBefore(nav, weekSelector);

      previous.addEventListener("click", () => {
        if (!previous.disabled && !corePrevious.disabled) {
          corePrevious.click();
          window.setTimeout(sync, 0);
        }
      });

      next.addEventListener("click", () => {
        if (!next.disabled && !coreNext.disabled) {
          coreNext.click();
          window.setTimeout(sync, 0);
        }
      });

      current.addEventListener("click", () => {
        if (!current.disabled && !coreToday.disabled) {
          coreToday.click();
          window.setTimeout(sync, 0);
        }
      });
    }

    const previous = document.getElementById("bedAshDischargeWeeklyPreviousMonthButton");
    const monthLabel = document.getElementById("bedAshDischargeWeeklyMonthLabel");
    const current = document.getElementById("bedAshDischargeWeeklyCurrentMonthButton");
    const next = document.getElementById("bedAshDischargeWeeklyNextMonthButton");

    function sync() {
      const isWeekly = view.dataset.bedAshPeriod === "weekly";
      nav.hidden = !isWeekly;
      monthLabel.textContent = formatMonthLabel(anchorDate.value);
      previous.disabled = Boolean(corePrevious.disabled);
      next.disabled = Boolean(coreNext.disabled);
      current.disabled = Boolean(coreToday.disabled);

      const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const currentYear = now.getUTCFullYear();
      const currentMonth = now.getUTCMonth() + 1;
      const selected = parseAnchorMonth(anchorDate.value);
      current.classList.toggle(
        "is-current",
        Boolean(selected && selected.year === currentYear && selected.month === currentMonth)
      );
    }

    [
      document.getElementById("bedAshDischargePeriodWeekly"),
      document.getElementById("bedAshDischargePeriodDaily"),
      document.getElementById("bedAshDischargePeriodMonthly"),
      ...document.querySelectorAll("[data-bed-ash-week]")
    ].filter(Boolean).forEach(control => {
      control.addEventListener("click", () => window.setTimeout(sync, 0));
    });

    const observer = new MutationObserver(sync);
    observer.observe(view, {
      attributes: true,
      attributeFilter: ["data-bed-ash-period"]
    });
    observer.observe(corePrevious, { attributes: true, attributeFilter: ["disabled"] });
    observer.observe(coreNext, { attributes: true, attributeFilter: ["disabled"] });
    if (rangeLabel) {
      observer.observe(rangeLabel, { childList: true, characterData: true, subtree: true });
    }

    sync();
    return true;
  }

  if (!install()) {
    const observer = new MutationObserver(() => {
      if (install()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
