/* GS_HEADER_MENU_DESIGN_V1 / 20261020
 * Presentation only: retain existing elements, links, listeners and permissions.
 */
(() => {
  'use strict';
  function initialize() {
    const menu = document.getElementById('headerMoreDropdown');
    if (!menu || menu.dataset.headerMenuDesign === 'v1') return;

    function directItem(id) {
      const item = document.getElementById(id);
      return item && item.parentElement === menu ? item : null;
    }
    function section(key, title, anchor) {
      let heading = menu.querySelector('[data-menu-design-section="' + key + '"]');
      if (!anchor) { if (heading) heading.remove(); return; }
      if (!heading) {
        heading = document.createElement('div');
        heading.className = 'header-menu-section-title';
        heading.dataset.menuDesignSection = key;
        heading.setAttribute('role', 'presentation');
        heading.textContent = title;
      }
      if (heading.nextElementSibling !== anchor) menu.insertBefore(heading, anchor);
    }
    const observer = new MutationObserver(decorate);
    function decorate() {
      observer.disconnect();
      try {
        section('operations', '설비·운전', directItem('facilityNavigatorHeaderButton'));
        section('work', '업무지원', directItem('operationInfoHeaderLink'));
        section('settings', '설정', directItem('accountPasswordMenuLink') || directItem('adminButton'));
      } finally {
        // The password link is mounted by login-preferences.js after page startup.
        // Only direct-child additions/reordering matter; badge text updates do not.
        observer.observe(menu, { childList: true });
      }
    }
    menu.dataset.headerMenuDesign = 'v1';
    decorate();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
