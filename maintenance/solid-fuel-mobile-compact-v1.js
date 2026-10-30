/* GS_SOLID_FUEL_MOBILE_COMPACT_V1: move existing nodes; preserve all data and listeners. */
(() => {
  'use strict';
  function init() {
    const page = document.querySelector('main.page');
    const query = page?.querySelector('.query-card');
    const summary = page?.querySelector('.summary-strip');
    const analytics = page?.querySelector('.analytics');
    if (!page || !query || !summary || !analytics) return;
    const media = window.matchMedia('(max-width: 760px)');
    const moved = [query, summary, analytics].map(node => {
      const anchor = document.createComment('solid-fuel-mobile-original-position');
      node.before(anchor);
      return {node, anchor};
    });
    function disclosure(id, label) {
      const details = document.createElement('details');
      details.id = id; details.className = 'sfmc-disclosure';
      const title = document.createElement('summary');
      title.textContent = label; details.append(title);
      return details;
    }
    const filters = disclosure('sfMobileFilters', '검색 조건 · 월 / 기간 / 업체');
    const statistics = disclosure('sfMobileStatistics', '하역 통계 · 업체 / Silo');
    let compact = false;
    function update() {
      if (compact === media.matches) return;
      compact = media.matches;
      document.body.classList.toggle('sf-mobile-compact', compact);
      if (compact) {
        filters.append(query); statistics.append(summary, analytics);
        page.append(filters, statistics);
      } else {
        moved.forEach(({node, anchor}) => anchor.after(node));
        filters.remove(); statistics.remove();
      }
    }
    media.addEventListener('change', update);
    update();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
