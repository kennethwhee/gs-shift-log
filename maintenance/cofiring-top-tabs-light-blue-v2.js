(() => {
  "use strict";

  /* COFIRING TOP TABS LIGHT BLUE V2 EXACT */
  const ROOT_ID = "efficiencyCofiringDraftView";
  const LABELS = new Set([
    "혼소율 계산",
    "고형연료 관리",
    "마감 데이터",
    "발열량/보정계수"
  ]);

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function markTopTabs() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return false;

    let found = 0;

    for (const button of root.querySelectorAll("button")) {
      const label = normalize(button.textContent);

      if (!LABELS.has(label)) continue;

      button.classList.add("cf-top-tab-light-v2");
      found += 1;
    }

    return found >= 1;
  }

  function scheduleMark() {
    for (const delay of [0, 80, 200, 500]) {
      window.setTimeout(markTopTabs, delay);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleMark, { once: true });
  } else {
    scheduleMark();
  }

  document.addEventListener("click", scheduleMark, true);
  window.addEventListener("focus", scheduleMark);

  // Bounded retries only. No MutationObserver.
  for (const delay of [1000, 2500, 5000, 9000]) {
    window.setTimeout(markTopTabs, delay);
  }
})();
