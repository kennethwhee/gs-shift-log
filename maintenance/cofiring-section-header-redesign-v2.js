(() => {
  "use strict";

  /* CFV6 SECTION HEADER V2 R2 LOGIN SAFE */
  const ROOT = '[data-cofiring-draft-root]';
  const CONFIGS = [
    {
      marker: '.cfv5-basis-wrap',
      detailClass: 'cfv6panel-basis',
      title: '발열량 · 보정계수 설정',
      meta: '연료별 계산 기준 관리'
    },
    {
      marker: '.cfv52-detail',
      detailClass: 'cfv6panel-detail',
      title: '상세 계산표 보기',
      meta: '계측량 · 보정계수 · 실사용량 · 열량'
    }
  ];

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function applyOne(details, config) {
    if (!details) return;
    const summary = details.querySelector(':scope > summary');
    if (!summary) return;

    details.classList.add('cfv6panel', config.detailClass);
    summary.classList.add('cfv6panel-summary');

    let main = summary.querySelector(':scope > .cfv6panel-summary-main');
    let meta = summary.querySelector(':scope > .cfv6panel-summary-meta');

    if (!main || !meta) {
      main = make('span', 'cfv6panel-summary-main', config.title);
      meta = make('span', 'cfv6panel-summary-meta', config.meta);
      summary.replaceChildren(main, meta);
      return;
    }

    // Idempotent: do not write identical text back into the DOM.
    if (main.textContent !== config.title) main.textContent = config.title;
    if (meta.textContent !== config.meta) meta.textContent = config.meta;
  }

  function enhance() {
    // Critical login-safety rule: never scan or mutate the whole document
    // before the co-firing UI root actually exists.
    const root = document.querySelector(ROOT);
    if (!root) return false;

    for (const config of CONFIGS) {
      const marker = root.querySelector(config.marker);
      if (!marker) continue;
      const details = marker.closest('details');
      if (!details) continue;
      applyOne(details, config);
    }
    return true;
  }

  function scheduleEnhance() {
    window.setTimeout(enhance, 0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhance, { once: true });
  } else {
    enhance();
  }

  // No MutationObserver. It previously reacted to its own DOM writes and
  // could create a self-sustaining mutation loop during app/login startup.
  document.addEventListener('click', scheduleEnhance, true);

  // Bounded retries cover late UI mounting without a permanent observer.
  for (const delay of [150, 500, 1200, 2500, 5000, 9000]) {
    window.setTimeout(enhance, delay);
  }
})();
