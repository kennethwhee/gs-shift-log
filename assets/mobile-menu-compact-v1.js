/* GS_MOBILE_MENU_COMPACT_V1 / 20261021
 * Keep application-owned elements and listeners as direct children of the menu.
 */
(() => {
  'use strict';
  function initialize() {
    const menu = document.getElementById('headerMoreDropdown');
    if (!menu || menu.dataset.mobileMenuCompact === 'v1') return;
    const workIds = ['operationInfoHeaderLink', 'tmIssueHeaderLink', 'boisoHeaderLink', 'vacationReplacementHeaderButton'];
    const settingsIds = ['accountPasswordMenuLink', 'adminButton'];
    function direct(id) {
      const item = document.getElementById(id);
      return item && item.parentElement === menu ? item : null;
    }
    const nav = direct('facilityNavigatorHeaderButton');
    const operation = direct(workIds[0]);
    const planned = direct('plannedMaintenanceHeaderButton');
    const panel = direct('plannedMaintenanceHeaderSubmenuPanel');
    if (!nav || !operation || !planned || !panel) return;

    function createToggle(id, label, ids) {
      const button = document.createElement('button');
      button.id = id;
      button.type = 'button';
      button.className = 'header-more-item mobile-menu-group-toggle';
      button.setAttribute('role', 'menuitem');
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-controls', ids.join(' '));
      const text = document.createElement('span');
      text.className = 'header-more-item__label';
      text.textContent = label;
      const meta = document.createElement('span');
      meta.className = 'header-more-item__meta';
      const arrow = document.createElement('span');
      arrow.className = 'header-more-item__chevron';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '⌄';
      meta.appendChild(arrow);
      button.appendChild(text);
      button.appendChild(meta);
      return button;
    }
    const workToggle = createToggle('mobileCompactWorkToggle', '업무지원', workIds);
    const settingsToggle = createToggle('mobileCompactSettingsToggle', '설정', settingsIds);
    const heading = document.createElement('div');
    heading.className = 'mobile-menu-section-title';
    heading.setAttribute('role', 'presentation');
    heading.textContent = '설비·운전';

    function fold(work, settings) {
      menu.dataset.compactWorkOpen = String(work);
      menu.dataset.compactSettingsOpen = String(settings);
      workToggle.setAttribute('aria-expanded', String(work));
      settingsToggle.setAttribute('aria-expanded', String(settings));
    }
    function closePlanned() {
      panel.hidden = true;
      planned.setAttribute('aria-expanded', 'false');
    }
    workToggle.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const next = menu.dataset.compactWorkOpen !== 'true';
      closePlanned();
      fold(next, false);
    });
    settingsToggle.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const next = menu.dataset.compactSettingsOpen !== 'true';
      closePlanned();
      fold(false, next);
    });
    // Original listeners still own the planned-maintenance panel and navigation.
    planned.addEventListener('click', () => fold(false, false));

    function renameLabel(id, previous, next) {
      const item = direct(id);
      const label = item && item.querySelector('.header-more-item__label');
      if (!label) return;
      // Leave Blower status and notification elements attached to the original row.
      for (const node of Array.from(label.childNodes)) {
        if (node.nodeType === 3 && node.textContent.trim() === previous) {
          node.textContent = node.textContent.replace(previous, next);
          break;
        }
      }
    }
    const observer = new MutationObserver(records => {
      if (menu.hidden) fold(false, false);
      if (records.some(record => record.type === 'childList')) decorate();
    });
    function decorate() {
      observer.disconnect();
      try {
        if (heading.nextElementSibling !== nav) menu.insertBefore(heading, nav);
        if (workToggle.nextElementSibling !== operation) menu.insertBefore(workToggle, operation);
        const inspection = direct('mobileHeaderInspectionItem');
        if (inspection && inspection.nextElementSibling !== workToggle) menu.insertBefore(inspection, workToggle);
        const firstSetting = direct(settingsIds[0]) || direct(settingsIds[1]);
        if (firstSetting && settingsToggle.nextElementSibling !== firstSetting) menu.insertBefore(settingsToggle, firstSetting);
        // Do not alter hidden, style or any application authorisation attributes.
        for (const id of workIds) { const item = direct(id); if (item) item.dataset.compactGroup = 'work'; }
        for (const id of settingsIds) { const item = direct(id); if (item) item.dataset.compactGroup = 'settings'; }
        renameLabel('solidFuelTroubleHeaderLink', '고형연료 Trouble', '고형연료 관리');
        renameLabel('blowerHistoryHeaderButton', 'Blower 교체이력', 'Blower 이력');
      } finally {
        observer.observe(menu, { childList: true, attributes: true, attributeFilter: ['hidden'] });
      }
    }
    fold(false, false);
    menu.dataset.mobileMenuCompact = 'v1';
    decorate();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
