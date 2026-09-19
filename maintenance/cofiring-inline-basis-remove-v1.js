(() => {
  "use strict";

  /* COFIRING INLINE BASIS REMOVE V1
     Hide the inline calorific/correction settings fold from the calculation view.
     The backing inputs remain in the DOM so existing calculation/settings reads are not broken.
  */

  const ROOT_SELECTOR = "[data-cofiring-draft-root]";
  const BASIS_SELECTOR = ".cfv5-basis-wrap";
  const REMOVED_CLASS = "cfv-inline-basis-removed-v1";

  function apply() {
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) return false;

    const basis = root.querySelector(BASIS_SELECTOR);
    if (!basis) return false;

    const details = basis.closest("details");
    if (!details) return false;

    details.classList.add(REMOVED_CLASS);
    details.setAttribute("aria-hidden", "true");
    details.removeAttribute("open");
    return true;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply, { once: true });
  } else {
    apply();
  }

  // Bounded retries only; no MutationObserver to avoid login/startup feedback loops.
  for (const delay of [120, 350, 800, 1500, 3000, 6000]) {
    window.setTimeout(apply, delay);
  }
})();
