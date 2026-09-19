(() => {
  "use strict";

  function widen() {
    const wrap = document.querySelector(".cfv5-basis-wrap");
    const host = document.querySelector(".cfv6shared-v2-host");
    const grid = document.querySelector(".cfv6shared-v2-grid");
    if (!wrap || !host || !grid) return;

    wrap.classList.add("cfv6shared-v3-wrap");
    host.classList.add("cfv6shared-v3-host");
    grid.classList.add("cfv6shared-v3-grid");

    let colgroup = grid.querySelector(":scope > colgroup.cfv6shared-v3-colgroup");
    if (!colgroup) {
      colgroup = document.createElement("colgroup");
      colgroup.className = "cfv6shared-v3-colgroup";
      for (let i = 0; i < 8; i += 1) {
        const col = document.createElement("col");
        col.style.width = "12.5%";
        colgroup.append(col);
      }
      grid.insertBefore(colgroup, grid.firstChild);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", widen, { once: true });
  } else {
    widen();
  }

  const observer = new MutationObserver(() => widen());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  for (const delay of [100, 300, 700, 1500, 3000]) {
    setTimeout(widen, delay);
  }
})();
