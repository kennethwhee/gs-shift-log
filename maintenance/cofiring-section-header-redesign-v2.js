(() => {
  "use strict";

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
    if (!details || !config) return;
    const summary = details.querySelector(':scope > summary');
    if (!summary) return;

    details.classList.add('cfv6panel', config.detailClass);
    summary.classList.add('cfv6panel-summary');

    const currentTitle = summary.querySelector('.cfv6panel-summary-main');
    const currentMeta = summary.querySelector('.cfv6panel-summary-meta');
    if (currentTitle && currentMeta) {
      currentTitle.textContent = config.title;
      currentMeta.textContent = config.meta;
      return;
    }

    summary.replaceChildren();
    summary.append(
      make('span', 'cfv6panel-summary-main', config.title),
      make('span', 'cfv6panel-summary-meta', config.meta)
    );
  }

  function enhance() {
    const root = document.querySelector(ROOT) || document;
    for (const config of CONFIGS) {
      const marker = root.querySelector(config.marker);
      if (!marker) continue;
      const details = marker.closest('details');
      if (!details) continue;
      applyOne(details, config);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhance, { once: true });
  } else {
    enhance();
  }

  const observer = new MutationObserver(() => enhance());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  for (const delay of [100, 300, 700, 1500, 3000]) {
    setTimeout(enhance, delay);
  }
})();
