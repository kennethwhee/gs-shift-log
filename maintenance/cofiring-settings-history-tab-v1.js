(function(root){
  'use strict';

  const API='/api/cofiring-calculation-settings';
  const FUELS=[
    ['coal','Coal'],
    ['bio','Bio'],
    ['organic','유기성'],
    ['manure','축분']
  ];

  function authHeaders(){
    try{
      return typeof root.getShiftLogAuthHeaders==='function'
        ? root.getShiftLogAuthHeaders()
        : {};
    }catch(_){
      return {};
    }
  }

  function escapeHtml(value){
    return String(value??'').replace(/[&<>"']/g,ch=>({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#39;'
    }[ch]));
  }

  function formatNumber(value){
    const n=Number(value);
    if(!Number.isFinite(n))return '—';
    return n.toLocaleString('ko-KR',{maximumFractionDigits:6});
  }

  function formatTime(value){
    if(!value)return '—';
    const d=new Date(value);
    if(!Number.isFinite(d.getTime()))return '—';
    return d.toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});
  }

  async function api(path=''){
    const response=await root.fetch(API+path,{
      credentials:'same-origin',
      cache:'no-store',
      headers:{
        ...authHeaders(),
        Accept:'application/json'
      }
    });

    let payload=null;
    try{payload=await response.json();}catch(_){}
    if(!response.ok||payload?.ok!==true){
      throw new Error(payload?.message||'발열량 저장 이력을 불러오지 못했습니다.');
    }
    return payload;
  }

  function calorific(settings,key){
    return formatNumber(settings?.unit1?.[key]?.calorific);
  }

  function listMarkup(items){
    if(!Array.isArray(items)||items.length===0){
      return `
        <div class="cfv12-empty">
          <strong>저장된 발열량 이력이 없습니다.</strong>
          <span>혼소율 계산 화면에서 [발열량/보정계수 저장]을 누르면 적용일별 발열량이 여기에 기록됩니다.</span>
        </div>
      `;
    }

    return `
      <div class="cfv12-history-table-wrap">
        <table class="cfv12-history-table cfv14-history-table">
          <thead>
            <tr>
              <th>적용일</th>
              ${FUELS.map(([,label])=>`<th>${label}<small>kcal/kg</small></th>`).join('')}
              <th>저장 시각</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(item=>`
              <tr>
                <td><strong>${escapeHtml(item.effectiveDate||'—')}</strong></td>
                ${FUELS.map(([key])=>`<td class="cfv14-calorific">${calorific(item.settings,key)}</td>`).join('')}
                <td class="cfv15-saved-time">${escapeHtml(formatTime(item.updatedAt))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function mount(){
    const container=root.document?.querySelector?.('[data-cofiring-draft-root]');
    const sheet=container?.querySelector?.('.cfv5-sheet');
    const tabs=sheet?.querySelector?.('.cfv12-tabs');
    const toolbar=sheet?.querySelector?.('.cfv12-toolbar');

    if(!container||!sheet||!tabs||!toolbar)return false;
    if(sheet.dataset.cfv14SettingsHistory==='1')return true;

    const existingTabs=Array.from(tabs.querySelectorAll('.cfv12-tab'));
    const calc=existingTabs.find(button=>button.textContent.trim()==='혼소율 계산');
    const history=existingTabs.find(button=>button.textContent.trim()==='마감 데이터');
    const oldPanel=sheet.querySelector('.cfv12-history-panel');
    const closeButton=toolbar.querySelector('.cfv12-close-save');

    if(!calc||!history||!oldPanel)return false;

    const settingsTab=root.document.createElement('button');
    settingsTab.type='button';
    settingsTab.className='cfv12-tab cfv13-settings-tab';
    settingsTab.textContent='발열량/보정계수';
    settingsTab.setAttribute('aria-selected','false');
    tabs.append(settingsTab);

    const panel=root.document.createElement('section');
    panel.className='cfv12-history-panel cfv13-settings-panel';
    panel.hidden=true;
    panel.innerHTML=`
      <div class="cfv12-history-head">
        <div>
          <strong>발열량 저장 이력</strong>
          <span>1·2호기에 동일 적용되는 연료별 발열량만 표시합니다. 같은 적용일은 가장 최근 저장값을 표시합니다.</span>
        </div>
        <button type="button" data-cfv14-refresh>새로고침</button>
      </div>
      <div class="cfv12-history-body" data-cfv14-body>
        <div class="cfv12-loading">저장 이력 확인 중...</div>
      </div>
    `;
    oldPanel.after(panel);

    const body=panel.querySelector('[data-cfv14-body]');
    const refresh=panel.querySelector('[data-cfv14-refresh]');

    async function loadList(){
      body.innerHTML='<div class="cfv12-loading">저장 이력 확인 중...</div>';
      try{
        const payload=await api('?history=1&limit=180');
        const items=Array.isArray(payload.items)?payload.items:[];
        body.innerHTML=listMarkup(items);
      }catch(error){
        body.innerHTML=`<div class="cfv12-error">${escapeHtml(error.message)}</div>`;
      }
    }

    function leaveSettingsTab(){
      panel.hidden=true;
      settingsTab.setAttribute('aria-selected','false');
    }

    function selectSettingsTab(){
      sheet.classList.add('cfv12-history-mode');
      oldPanel.hidden=true;
      panel.hidden=false;
      if(closeButton)closeButton.hidden=true;
      calc.setAttribute('aria-selected','false');
      history.setAttribute('aria-selected','false');
      settingsTab.setAttribute('aria-selected','true');
      void loadList();
    }

    settingsTab.addEventListener('click',selectSettingsTab);
    calc.addEventListener('click',leaveSettingsTab);
    history.addEventListener('click',leaveSettingsTab);
    refresh?.addEventListener('click',()=>void loadList());

    sheet.dataset.cfv14SettingsHistory='1';
    return true;
  }

  function boot(){
    if(mount())return;
    if(!root.MutationObserver||!root.document?.body)return;
    const observer=new root.MutationObserver(()=>{
      if(mount())observer.disconnect();
    });
    observer.observe(root.document.body,{childList:true,subtree:true});
  }

  const exported={listMarkup};
  root.CofiringSettingsHistoryTabV1=exported;

  if(typeof module==='object'&&module.exports){
    module.exports=exported;
  }

  if(root.document){
    if(root.document.readyState==='loading'){
      root.document.addEventListener('DOMContentLoaded',boot,{once:true});
    }else{
      boot();
    }
  }
})(typeof globalThis==='object'?globalThis:this);

/* ===== COFIRING_SETTINGS_HISTORY_NO_SAVED_TIME_V4 ===== */
(function () {
  'use strict';

  const HEADER_TEXT = '저장 시각';

  function normalizedText(node) {
    return String(node?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function removeSavedTimeColumn(table) {
    if (!(table instanceof HTMLTableElement)) {
      return;
    }

    const headers =
      Array.from(
        table.querySelectorAll('thead th')
      );

    const header =
      headers.find(function (th) {
        return normalizedText(th) === HEADER_TEXT;
      });

    if (!header) {
      return;
    }

    const headerRow = header.parentElement;

    if (!(headerRow instanceof HTMLTableRowElement)) {
      return;
    }

    const columnIndex =
      Array.from(headerRow.cells)
        .indexOf(header);

    if (columnIndex < 0) {
      return;
    }

    /*
      Header + every body row:
      remove only the column whose header is exactly "저장 시각".
    */
    Array.from(table.rows)
      .forEach(function (row) {
        const cell =
          row.cells[columnIndex];

        if (cell) {
          cell.remove();
        }
      });

    table.setAttribute(
      'data-cf-settings-history-no-saved-time',
      'true'
    );
  }

  function apply() {
    document
      .querySelectorAll('table')
      .forEach(removeSavedTimeColumn);
  }

  let queued = false;

  function schedule() {
    if (queued) {
      return;
    }

    queued = true;

    const run = function () {
      queued = false;
      apply();
    };

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(run);
    }
    else {
      setTimeout(run, 0);
    }
  }

  function start() {
    apply();

    if (
      typeof MutationObserver !==
      'function'
    ) {
      return;
    }

    new MutationObserver(schedule)
      .observe(
        document.body,
        {
          childList: true,
          subtree: true
        }
      );
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      start,
      { once: true }
    );
  }
  else {
    start();
  }
})();
/* ===== /COFIRING_SETTINGS_HISTORY_NO_SAVED_TIME_V4 ===== */

/* ===== COFIRING_SETTINGS_HISTORY_TWOUP_V10 ===== */
(function () {
  "use strict";

  const PANEL_TITLE = "발열량 저장 이력";
  const MARKER_ATTR = "data-cf-history-twoup-v10";

  function norm(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizeDateText(text) {
    const raw = norm(text);

    if (!raw) {
      return "-";
    }

    let match = raw.match(/(?:\d{2,4}-)?(\d{2})-(\d{2})\s*\(?([월화수목금토일])\)?/);
    if (match) {
      return match[1] + "-" + match[2] + " (" + match[3] + ")";
    }

    match = raw.match(/(\d{2})-(\d{2})/);
    if (match) {
      return match[1] + "-" + match[2];
    }

    return raw;
  }

  function findPanelRoots() {
    return Array.from(document.querySelectorAll("div, section, article"))
      .filter(function (el) {
        const text = norm(el.textContent);
        if (!text.includes(PANEL_TITLE)) {
          return false;
        }
        return el.querySelector("table");
      });
  }

  function findBestHeaderRow(table) {
    const rows = Array.from(table.querySelectorAll("thead tr"));
    return rows.find(function (row) {
      const headers = Array.from(row.cells).map(function (cell) {
        return norm(cell.textContent);
      });

      return headers.includes("적용일")
        && headers.includes("Coal")
        && headers.includes("Bio")
        && headers.includes("유기성")
        && headers.includes("축분");
    }) || null;
  }

  function extractTableData(table) {
    if (!(table instanceof HTMLTableElement)) {
      return null;
    }

    const headerRow = findBestHeaderRow(table);
    if (!(headerRow instanceof HTMLTableRowElement)) {
      return null;
    }

    const headers = Array.from(headerRow.cells).map(function (cell) {
      return norm(cell.textContent);
    });

    const indexMap = {
      date: headers.indexOf("적용일"),
      coal: headers.indexOf("Coal"),
      bio: headers.indexOf("Bio"),
      organic: headers.indexOf("유기성"),
      manure: headers.indexOf("축분")
    };

    if (Object.values(indexMap).some(function (value) { return value < 0; })) {
      return null;
    }

    const bodyRows = Array.from(table.querySelectorAll("tbody tr"))
      .filter(function (row) {
        return row.cells.length >= headers.length;
      });

    if (!bodyRows.length) {
      return null;
    }

    const items = bodyRows.map(function (row) {
      const cells = Array.from(row.cells);

      return {
        date: normalizeDateText(cells[indexMap.date] ? cells[indexMap.date].textContent : ""),
        coal: norm(cells[indexMap.coal] ? cells[indexMap.coal].textContent : "-"),
        bio: norm(cells[indexMap.bio] ? cells[indexMap.bio].textContent : "-"),
        organic: norm(cells[indexMap.organic] ? cells[indexMap.organic].textContent : "-"),
        manure: norm(cells[indexMap.manure] ? cells[indexMap.manure].textContent : "-")
      };
    });

    return items;
  }

  function pickDataSet(panel) {
    const tables = Array.from(panel.querySelectorAll("table"));
    const candidates = tables
      .map(function (table) {
        return {
          table: table,
          items: extractTableData(table)
        };
      })
      .filter(function (entry) {
        return Array.isArray(entry.items) && entry.items.length > 0;
      });

    if (!candidates.length) {
      return null;
    }

    candidates.sort(function (a, b) {
      return a.items.length - b.items.length;
    });

    return {
      sourceTables: tables,
      items: candidates[candidates.length - 1].items
    };
  }

  function buildCard(item) {
    return [
      '<article class="cf-history-twoup-card">',
        '<div class="cf-history-twoup-card__date">', escapeHtml(item.date), " 데이터</div>",
        '<div class="cf-history-twoup-card__grid">',
          '<div class="cf-history-twoup-cell"><span class="cf-history-twoup-cell__label">Coal</span><strong class="cf-history-twoup-cell__value">', escapeHtml(item.coal), '</strong><span class="cf-history-twoup-cell__unit">kcal/kg</span></div>',
          '<div class="cf-history-twoup-cell"><span class="cf-history-twoup-cell__label">Bio</span><strong class="cf-history-twoup-cell__value">', escapeHtml(item.bio), '</strong><span class="cf-history-twoup-cell__unit">kcal/kg</span></div>',
          '<div class="cf-history-twoup-cell"><span class="cf-history-twoup-cell__label">유기성</span><strong class="cf-history-twoup-cell__value">', escapeHtml(item.organic), '</strong><span class="cf-history-twoup-cell__unit">kcal/kg</span></div>',
          '<div class="cf-history-twoup-cell"><span class="cf-history-twoup-cell__label">축분</span><strong class="cf-history-twoup-cell__value">', escapeHtml(item.manure), '</strong><span class="cf-history-twoup-cell__unit">kcal/kg</span></div>',
        '</div>',
      '</article>'
    ].join("");
  }

  function renderPanel(panel, items, tables) {
    let mount = panel.querySelector("[" + MARKER_ATTR + "]");

    if (!(mount instanceof HTMLElement)) {
      mount = document.createElement("div");
      mount.setAttribute(MARKER_ATTR, "true");

      const firstTable = tables[0];
      if (firstTable && firstTable.parentNode) {
        firstTable.parentNode.insertBefore(mount, firstTable);
      } else {
        panel.appendChild(mount);
      }
    }

    mount.className = "cf-history-twoup-list";
    mount.innerHTML = items.map(buildCard).join("");

    tables.forEach(function (table) {
      table.style.display = "none";
      table.setAttribute("aria-hidden", "true");
      table.hidden = true;
    });
  }

  function apply() {
    findPanelRoots().forEach(function (panel) {
      const picked = pickDataSet(panel);
      if (!picked || !picked.items.length) {
        return;
      }

      renderPanel(panel, picked.items, picked.sourceTables);
    });
  }

  let queued = false;

  function schedule() {
    if (queued) {
      return;
    }

    queued = true;

    const run = function () {
      queued = false;
      apply();
    };

    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(run);
    } else {
      setTimeout(run, 0);
    }
  }

  function boot() {
    apply();

    setTimeout(apply, 50);
    setTimeout(apply, 200);
    setTimeout(apply, 600);

    if (typeof MutationObserver === "function") {
      new MutationObserver(function () {
        schedule();
      }).observe(document.body, {
        childList: true,
        subtree: true
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
/* ===== /COFIRING_SETTINGS_HISTORY_TWOUP_V10 ===== */
