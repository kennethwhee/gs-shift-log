(function installCofiringMaxAdjustWarningBarCleanupV1() {
  "use strict";

  if (window.__cofiringMaxAdjustWarningBarCleanupV1Installed === true) return;
  window.__cofiringMaxAdjustWarningBarCleanupV1Installed = true;

  const MARKER = "COFIRING_MAX_ADJUST_WARNING_BAR_CLEANUP_V1";
  const STEM_ACTION = "최대 혼소 조정 시";
  const STEM_REVIEW = "1,2호기 석탄 사용량 검토 필요";

  const normalize = value => String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const isTargetText = value => {
    const text = normalize(value);
    return text.includes(STEM_ACTION) && text.includes(STEM_REVIEW);
  };

  const closeLikeButton = element => {
    if (!element || element.nodeType !== 1) return null;
    const buttons = element.matches?.("button,[role='button']")
      ? [element]
      : Array.from(element.querySelectorAll?.("button,[role='button']") || []);
    return buttons.find(button => {
      const text = normalize(button.textContent).toLowerCase();
      const label = normalize(
        button.getAttribute?.("aria-label") ||
        button.getAttribute?.("title") ||
        ""
      ).toLowerCase();
      return ["×", "✕", "x", "닫기"].includes(text) || label.includes("닫기");
    }) || null;
  };

  const findBarRoot = element => {
    if (!element || element.nodeType !== 1) return null;
    let node = element;
    let fallback = null;

    for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
      const text = normalize(node.textContent);
      if (!isTargetText(text)) break;

      // The inline yellow bar has only the warning text (+ a small close button).
      // Keep large modal/section ancestors out of the candidate set.
      if (text.length <= STEM_ACTION.length + STEM_REVIEW.length + 24) {
        fallback = node;
      }

      if (closeLikeButton(node)) return node;
    }

    return fallback;
  };

  const removeFromRoot = root => {
    if (!root) return 0;
    const elements = [];

    if (root.nodeType === 1) elements.push(root);
    if (root.querySelectorAll) elements.push(...root.querySelectorAll("*"));

    let removed = 0;
    const seen = new Set();

    for (const element of elements) {
      if (!isTargetText(element.textContent)) continue;
      const bar = findBarRoot(element);
      if (!bar || seen.has(bar) || !bar.isConnected) continue;
      seen.add(bar);
      bar.remove();
      removed += 1;
    }

    return removed;
  };

  const clean = root => removeFromRoot(root || document.body || document.documentElement);

  const start = () => {
    clean(document.body || document.documentElement);

    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) {
          if (node.nodeType === 1) clean(node);
        }
      }
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });

    window.__cofiringMaxAdjustWarningBarCleanupV1Observer = observer;
  };

  window.__cofiringMaxAdjustWarningBarCleanupV1 = Object.freeze({
    marker: MARKER,
    clean,
    isTargetText
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
