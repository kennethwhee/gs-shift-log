(() => {
  "use strict";

  const ROOT_SELECTOR = "#efficiencyCofiringDraftView";
  const CLASS_NAME = "cf-bio-target-label-emphasis-v1";
  const PHRASE = "마감까지 Bio 필요 투입량";

  const normalize = (value) =>
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();

  function markBioTargetLabels() {
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) return;

    const candidates = Array.from(
      root.querySelectorAll("span,small,strong,p,label,div")
    ).filter((element) => {
      const text = normalize(element.textContent);
      if (!text.includes(PHRASE) || !text.includes("목표")) return false;
      if (text.length > 80) return false;

      return !Array.from(element.children).some((child) => {
        const childText = normalize(child.textContent);
        return childText.includes(PHRASE) && childText.includes("목표");
      });
    });

    candidates.forEach((element) => {
      element.classList.add(CLASS_NAME);
    });
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;

    requestAnimationFrame(() => {
      scheduled = false;
      markBioTargetLabels();
    });
  }

  function start() {
    markBioTargetLabels();

    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) {
      setTimeout(start, 150);
      return;
    }

    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.addedNodes.length || mutation.removedNodes.length)) {
        schedule();
      }
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
