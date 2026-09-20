/* =========================================================
   EFFICIENCY_DAILY_WORK_WORKLOG_PICKER_V1

   일일업무현황 운전파트 주요 업무 셀에서:

   Right Click
     -> 업무내역 불러오기
     -> 선택 날짜 + 해당 근무조 업무일지 조회
     -> 팝업에서 업무 선택
     -> 선택한 업무내용 반영하기

   operation-day   = D/S
   operation-night = N/S

   조회:
   /api/shift-logs?date=YYYY-MM-DD&shift=DS|NS

   제외:
   - 비고
   - TM/BM/CM 발행
   - TM/BM/CM 작업
   - previous-shift 자동 승계
   - inheritedFromDate 항목

   Core script.js untouched.
   DB / API / schema unchanged.
   MutationObserver 없음.
========================================================= */

(() => {
  'use strict';


  const VERSION =
    'EFFICIENCY_DAILY_WORK_WORKLOG_PICKER_V1';


  const MENU_ID =
    'efficiencyDailyWorkWorklogContextMenuV1';


  const OVERLAY_ID =
    'efficiencyDailyWorkWorklogPickerOverlayV1';


  const STYLE_ID =
    'efficiencyDailyWorkWorklogPickerStyleV1';


  const ROLE_ORDER = {
    '파트장':
      1,

    'TGO':
      2,

    'BCO1':
      3,

    'BCO2':
      4,

    'TO':
      5,

    'BO1':
      6,

    'BO2':
      7
  };


  const ALLOWED_ROLES =
    Object.keys(
      ROLE_ORDER
    );


  if (
    window.__gsEfficiencyDailyWorkWorklogPickerV1
  ) {
    return;
  }


  window.__gsEfficiencyDailyWorkWorklogPickerV1 =
    true;


  let contextTarget =
    null;


  let loadedItems =
    [];


  const normalizeText = value => {

    return String(
      value ||
      ''
    )
      .replace(
        /\r\n?/g,
        '\n'
      )
      .trim();
  };


  const normalizeRole = value => {

    const role =
      normalizeText(
        value
      )
        .toUpperCase()
        .replace(
          /\s+/g,
          ''
        );


    if (
      role ===
        'PARTLEADER' ||
      role ===
        '파트장'
    ) {
      return '파트장';
    }


    if (
      role ===
        'TGO'
    ) {
      return 'TGO';
    }


    if (
      role ===
        'BCO1'
    ) {
      return 'BCO1';
    }


    if (
      role ===
        'BCO2'
    ) {
      return 'BCO2';
    }


    if (
      role ===
        'TO'
    ) {
      return 'TO';
    }


    if (
      role ===
        'BO1'
    ) {
      return 'BO1';
    }


    if (
      role ===
        'BO2'
    ) {
      return 'BO2';
    }


    return '';
  };


  const getWorkDate = () => {

    const input =
      document.getElementById(
        'efficiencyDailyWorkDate'
      );


    return normalizeText(
      input?.value
    ).slice(
      0,
      10
    );
  };


  const getRowContextFromEvent = event => {

    const target =
      event.target instanceof
        Element
        ? event.target
        : null;


    if (!target) {
      return null;
    }


    const row =
      target.closest(
        '[data-efficiency-daily-work-row-key]'
      );


    if (!row) {
      return null;
    }


    const rowKey =
      normalizeText(
        row.dataset
          .efficiencyDailyWorkRowKey
      );


    if (
      rowKey !==
        'operation-day' &&
      rowKey !==
        'operation-night'
    ) {
      return null;
    }


    const taskControl =
      row.querySelector(
        '[data-efficiency-daily-work-field="tasks"]'
      );


    if (!taskControl) {
      return null;
    }


    const taskCell =
      taskControl.closest(
        'td'
      );


    const isTaskArea =
      target ===
        taskControl ||
      taskControl.contains(
        target
      ) ||
      (
        taskCell &&
        (
          target ===
            taskCell ||
          taskCell.contains(
            target
          )
        )
      );


    if (!isTaskArea) {
      return null;
    }


    return {
      row,
      rowKey,

      taskControl,

      shift:
        rowKey ===
          'operation-day'
          ? 'DS'
          : 'NS',

      shiftLabel:
        rowKey ===
          'operation-day'
          ? 'D/S'
          : 'N/S',

      rowLabel:
        rowKey ===
          'operation-day'
          ? 'Day 근무조'
          : 'Night 근무조'
    };
  };


  const installStyle = () => {

    if (
      document.getElementById(
        STYLE_ID
      )
    ) {
      return;
    }


    const style =
      document.createElement(
        'style'
      );


    style.id =
      STYLE_ID;


    style.textContent = `
      #${MENU_ID} {
        position: fixed;
        z-index: 2147483600;
        min-width: 185px;
        padding: 7px;
        border: 1px solid #cad7e5;
        border-radius: 10px;
        background: #ffffff;
        box-shadow:
          0 10px 30px rgba(26, 53, 82, 0.18);
      }

      #${MENU_ID}[hidden] {
        display: none !important;
      }

      #${MENU_ID}
      .daily-work-worklog-menu-title-v1 {
        padding: 6px 8px 7px;
        color: #526b85;
        font-size: 11px;
        font-weight: 800;
        border-bottom: 1px solid #e5edf5;
      }

      #${MENU_ID}
      button {
        display: block;
        width: 100%;
        margin-top: 5px;
        padding: 9px 10px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: #203f60;
        text-align: left;
        font-size: 12px;
        font-weight: 800;
        cursor: pointer;
      }

      #${MENU_ID}
      button:hover {
        background: #edf6ff;
      }


      #${OVERLAY_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483640;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 26px;
        background: rgba(28, 43, 59, 0.36);
        box-sizing: border-box;
      }

      #${OVERLAY_ID}[hidden] {
        display: none !important;
      }

      #${OVERLAY_ID}
      .daily-work-worklog-dialog-v1 {
        display: flex;
        flex-direction: column;
        width: min(760px, calc(100vw - 52px));
        max-height: min(720px, calc(100vh - 52px));
        overflow: hidden;
        border: 1px solid #bdcede;
        border-radius: 15px;
        background: #ffffff;
        box-shadow:
          0 20px 60px rgba(25, 46, 68, 0.25);
      }

      #${OVERLAY_ID}
      .daily-work-worklog-header-v1 {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 14px;
        padding: 17px 19px 14px;
        border-bottom: 1px solid #dce6f0;
      }

      #${OVERLAY_ID}
      .daily-work-worklog-header-v1 h3 {
        margin: 0;
        color: #173a5c;
        font-size: 17px;
        font-weight: 900;
      }

      #${OVERLAY_ID}
      .daily-work-worklog-header-v1 p {
        margin: 5px 0 0;
        color: #71849a;
        font-size: 12px;
        font-weight: 600;
      }

      #${OVERLAY_ID}
      .daily-work-worklog-close-v1 {
        flex: 0 0 auto;
        width: 31px;
        height: 31px;
        border: 1px solid #cad7e3;
        border-radius: 8px;
        background: #ffffff;
        color: #536b84;
        font-size: 17px;
        font-weight: 800;
        cursor: pointer;
      }

      #${OVERLAY_ID}
      .daily-work-worklog-toolbar-v1 {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 18px;
        border-bottom: 1px solid #e5edf4;
        background: #f8fbfe;
      }

      #${OVERLAY_ID}
      .daily-work-worklog-toolbar-v1 span {
        color: #5d738a;
        font-size: 11px;
        font-weight: 800;
      }

      #${OVERLAY_ID}
      .daily-work-worklog-toolbar-actions-v1 {
        display: flex;
        gap: 7px;
      }

      #${OVERLAY_ID}
      .daily-work-worklog-toolbar-v1 button {
        min-height: 30px;
        padding: 4px 10px;
        border: 1px solid #cad7e4;
        border-radius: 7px;
        background: #ffffff;
        color: #48617a;
        font-size: 11px;
        font-weight: 800;
        cursor: pointer;
      }

      #${OVERLAY_ID}
      .daily-work-worklog-list-v1 {
        flex: 1 1 auto;
        min-height: 160px;
        overflow: auto;
        padding: 12px 17px 17px;
      }

      #${OVERLAY_ID}
      .daily-work-worklog-role-v1 {
        margin-bottom: 13px;
        border: 1px solid #dde7f0;
        border-radius: 10px;
        overflow: hidden;
      }

      #${OVERLAY_ID}
      .daily-work-worklog-role-title-v1 {
        padding: 8px 11px;
        background: #f4f8fc;
        color: #34536f;
        font-size: 12px;
        font-weight: 900;
      }

      #${OVERLAY_ID}
      .daily-work-worklog-item-v1 {
        display: grid;
        grid-template-columns: 22px 1fr;
        gap: 8px;
        align-items: start;
        padding: 10px 11px;
        border-top: 1px solid #edf2f7;
        cursor: pointer;
      }

      #${OVERLAY_ID}
      .daily-work-worklog-item-v1:hover {
        background: #f8fbff;
      }

      #${OVERLAY_ID}
      .daily-work-worklog-item-v1 input {
        margin-top: 2px;
      }

      #${OVERLAY_ID}
      .daily-work-worklog-item-meta-v1 {
        display: flex;
        flex-wrap: wrap;
        gap: 5px 8px;
        margin-bottom: 4px;
        color: #8091a3;
        font-size: 10px;
        font-weight: 700;
      }

      #${OVERLAY_ID}
      .daily-work-worklog-item-content-v1 {
        color: #243d55;
        font-size: 12px;
        font-weight: 600;
        line-height: 1.5;
        white-space: pre-wrap;
      }

      #${OVERLAY_ID}
      .daily-work-worklog-empty-v1 {
        padding: 40px 18px;
        color: #7c8fa3;
        text-align: center;
        font-size: 12px;
        font-weight: 700;
      }

      #${OVERLAY_ID}
      .daily-work-worklog-footer-v1 {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 17px 15px;
        border-top: 1px solid #dce6f0;
        background: #fbfdff;
      }

      #${OVERLAY_ID}
      .daily-work-worklog-footer-v1 button {
        min-height: 36px;
        padding: 6px 14px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 900;
        cursor: pointer;
      }

      #${OVERLAY_ID}
      .daily-work-worklog-cancel-v1 {
        border: 1px solid #cad7e4;
        background: #ffffff;
        color: #526b84;
      }

      #${OVERLAY_ID}
      .daily-work-worklog-apply-v1 {
        border: 1px solid #2d74b7;
        background: #2d74b7;
        color: #ffffff;
      }

      #${OVERLAY_ID}
      .daily-work-worklog-apply-v1:disabled {
        opacity: 0.45;
        cursor: default;
      }
    `;


    document.head.append(
      style
    );
  };


  const ensureContextMenu = () => {

    let menu =
      document.getElementById(
        MENU_ID
      );


    if (menu) {
      return menu;
    }


    menu =
      document.createElement(
        'div'
      );


    menu.id =
      MENU_ID;


    menu.hidden =
      true;


    menu.innerHTML = `
      <div class="daily-work-worklog-menu-title-v1">
        주요 업무
      </div>

      <button
        type="button"
        data-daily-work-worklog-load-v1
      >
        업무내역 불러오기
      </button>
    `;


    document.body.append(
      menu
    );


    menu
      .querySelector(
        '[data-daily-work-worklog-load-v1]'
      )
      ?.addEventListener(
        'click',
        event => {

          event.preventDefault();
          event.stopPropagation();


          menu.hidden =
            true;


          if (
            contextTarget
          ) {
            void openPicker(
              contextTarget
            );
          }
        }
      );


    return menu;
  };


  const hideContextMenu = () => {

    const menu =
      document.getElementById(
        MENU_ID
      );


    if (menu) {
      menu.hidden =
        true;
    }
  };


  const showContextMenu = (
    event,
    targetContext
  ) => {

    const menu =
      ensureContextMenu();


    contextTarget =
      targetContext;


    const title =
      menu.querySelector(
        '.daily-work-worklog-menu-title-v1'
      );


    if (title) {
      title.textContent =
        `${targetContext.rowLabel} · 주요 업무`;
    }


    menu.hidden =
      false;


    menu.style.left =
      '0px';

    menu.style.top =
      '0px';


    const rect =
      menu.getBoundingClientRect();


    const margin =
      8;


    const left =
      Math.min(
        event.clientX,
        window.innerWidth -
          rect.width -
          margin
      );


    const top =
      Math.min(
        event.clientY,
        window.innerHeight -
          rect.height -
          margin
      );


    menu.style.left =
      `${Math.max(margin, left)}px`;


    menu.style.top =
      `${Math.max(margin, top)}px`;
  };


  const requestShiftLogs = async (
    date,
    shift
  ) => {

    const requestUrl =
      new URL(
        '/api/shift-logs',
        window.location.origin
      );


    requestUrl.searchParams.set(
      'date',
      date
    );


    requestUrl.searchParams.set(
      'shift',
      shift
    );


    requestUrl.searchParams.set(
      '_',
      String(
        Date.now()
      )
    );


    const headers =
      typeof getShiftLogAuthHeaders ===
        'function'
        ? getShiftLogAuthHeaders()
        : {
            Accept:
              'application/json'
          };


    const response =
      await fetch(
        requestUrl.toString(),
        {
          method:
            'GET',

          headers,

          cache:
            'no-store'
        }
      );


    let payload =
      {};


    try {

      payload =
        await response.json();

    } catch {

      throw new Error(
        `${shift} 업무일지 응답을 읽을 수 없습니다.`
      );
    }


    if (
      !response.ok ||
      payload.ok !==
        true
    ) {

      throw new Error(
        payload.message ||
        `${shift} 업무일지를 불러오지 못했습니다.`
      );
    }


    return Array.isArray(
      payload.logs
    )
      ? payload.logs
      : [];
  };


  const collectEntries = (
    logs,
    shift
  ) => {

    const unique =
      new Map();


    (
      Array.isArray(
        logs
      )
        ? logs
        : []
    ).forEach(
      log => {

        const logRole =
          normalizeRole(
            log?.role
          );


        const sources = [
          {
            name:
              'handoverEntries',

            items:
              log?.handoverEntries
          },

          {
            name:
              'entries',

            items:
              log?.entries
          }
        ];


        sources.forEach(
          source => {

            (
              Array.isArray(
                source.items
              )
                ? source.items
                : []
            ).forEach(
              (
                rawEntry,
                entryIndex
              ) => {

                const entry =
                  rawEntry &&
                  typeof rawEntry ===
                    'object' &&
                  !Array.isArray(
                    rawEntry
                  )
                    ? rawEntry
                    : {
                        content:
                          String(
                            rawEntry ||
                            ''
                          )
                      };


                const content =
                  normalizeText(
                    entry.content ||
                    entry.text
                  );


                if (!content) {
                  return;
                }


                const role =
                  normalizeRole(
                    entry.importedFromRole ||
                    entry.role ||
                    logRole
                  );


                if (
                  !ALLOWED_ROLES.includes(
                    role
                  )
                ) {
                  return;
                }


                const rawCategory =
                  normalizeText(
                    entry.category
                  );


                const compactCategory =
                  rawCategory
                    .toUpperCase()
                    .replace(
                      /\s+/g,
                      ''
                    );


                if (
                  compactCategory.includes(
                    '비고'
                  )
                ) {
                  return;
                }


                if (
                  /^(TM|BM|CM)(발행|작업)/.test(
                    compactCategory
                  )
                ) {
                  return;
                }


                const sourceType =
                  normalizeText(
                    entry.source
                  )
                    .toLowerCase();


                if (
                  sourceType.includes(
                    'previous-shift'
                  ) ||
                  normalizeText(
                    entry.inheritedFromDate
                  )
                ) {
                  return;
                }


                const time =
                  normalizeText(
                    entry.time
                  );


                const tag =
                  normalizeText(
                    entry.tag
                  )
                    .toUpperCase();


                const category =
                  (
                    !rawCategory ||
                    /인계사항/.test(
                      rawCategory
                    )
                  )
                    ? '업무'
                    : rawCategory;


                const author =
                  normalizeText(
                    entry.importedFromAuthor ||
                    log?.author
                  );


                const key = [
                  role,
                  time,
                  tag,
                  content
                    .replace(
                      /\s+/g,
                      ' '
                    )
                    .toLowerCase()
                ].join(
                  '||'
                );


                if (
                  unique.has(
                    key
                  )
                ) {
                  return;
                }


                unique.set(
                  key,
                  {
                    id:
                      (
                        normalizeText(
                          entry.id
                        ) ||
                        `${normalizeText(log?.id)}-${source.name}-${entryIndex}`
                      ),

                    shift,
                    role,
                    author,
                    time,
                    tag,
                    category,
                    content,

                    sourceLogId:
                      normalizeText(
                        log?.id
                      )
                  }
                );
              }
            );
          }
        );
      }
    );


    return [
      ...unique.values()
    ].sort(
      (
        first,
        second
      ) => {

        const roleDifference =
          (
            ROLE_ORDER[
              first.role
            ] ||
            99
          ) -
          (
            ROLE_ORDER[
              second.role
            ] ||
            99
          );


        if (
          roleDifference !==
            0
        ) {
          return roleDifference;
        }


        return String(
          first.time ||
          ''
        ).localeCompare(
          String(
            second.time ||
            ''
          )
        );
      }
    );
  };


  const ensureOverlay = () => {

    let overlay =
      document.getElementById(
        OVERLAY_ID
      );


    if (overlay) {
      return overlay;
    }


    overlay =
      document.createElement(
        'div'
      );


    overlay.id =
      OVERLAY_ID;


    overlay.hidden =
      true;


    overlay.innerHTML = `
      <section
        class="daily-work-worklog-dialog-v1"
        role="dialog"
        aria-modal="true"
        aria-label="업무내역 불러오기"
      >

        <header
          class="daily-work-worklog-header-v1"
        >
          <div>
            <h3
              data-daily-work-worklog-title-v1
            >
              업무내역 불러오기
            </h3>

            <p
              data-daily-work-worklog-subtitle-v1
            >
            </p>
          </div>

          <button
            type="button"
            class="daily-work-worklog-close-v1"
            data-daily-work-worklog-close-v1
            aria-label="닫기"
          >
            ×
          </button>
        </header>


        <div
          class="daily-work-worklog-toolbar-v1"
        >
          <span
            data-daily-work-worklog-count-v1
          >
            0개 선택
          </span>

          <div
            class="daily-work-worklog-toolbar-actions-v1"
          >
            <button
              type="button"
              data-daily-work-worklog-select-all-v1
            >
              전체 선택
            </button>

            <button
              type="button"
              data-daily-work-worklog-clear-v1
            >
              선택 해제
            </button>
          </div>
        </div>


        <div
          class="daily-work-worklog-list-v1"
          data-daily-work-worklog-list-v1
        >
        </div>


        <footer
          class="daily-work-worklog-footer-v1"
        >
          <button
            type="button"
            class="daily-work-worklog-cancel-v1"
            data-daily-work-worklog-cancel-v1
          >
            취소
          </button>

          <button
            type="button"
            class="daily-work-worklog-apply-v1"
            data-daily-work-worklog-apply-v1
            disabled
          >
            선택한 업무내용 반영하기
          </button>
        </footer>

      </section>
    `;


    document.body.append(
      overlay
    );


    const close = () => {

      overlay.hidden =
        true;


      loadedItems =
        [];
    };


    overlay
      .querySelector(
        '[data-daily-work-worklog-close-v1]'
      )
      ?.addEventListener(
        'click',
        close
      );


    overlay
      .querySelector(
        '[data-daily-work-worklog-cancel-v1]'
      )
      ?.addEventListener(
        'click',
        close
      );


    overlay
      .querySelector(
        '[data-daily-work-worklog-select-all-v1]'
      )
      ?.addEventListener(
        'click',
        () => {

          overlay
            .querySelectorAll(
              '[data-daily-work-worklog-check-v1]'
            )
            .forEach(
              checkbox => {

                checkbox.checked =
                  true;
              }
            );


          updatePickerSelectionState(
            overlay
          );
        }
      );


    overlay
      .querySelector(
        '[data-daily-work-worklog-clear-v1]'
      )
      ?.addEventListener(
        'click',
        () => {

          overlay
            .querySelectorAll(
              '[data-daily-work-worklog-check-v1]'
            )
            .forEach(
              checkbox => {

                checkbox.checked =
                  false;
              }
            );


          updatePickerSelectionState(
            overlay
          );
        }
      );


    overlay.addEventListener(
      'change',
      event => {

        const target =
          event.target instanceof
            Element
            ? event.target
            : null;


        if (
          !target?.matches(
            '[data-daily-work-worklog-check-v1]'
          )
        ) {
          return;
        }


        updatePickerSelectionState(
          overlay
        );
      }
    );


    overlay
      .querySelector(
        '[data-daily-work-worklog-apply-v1]'
      )
      ?.addEventListener(
        'click',
        () => {

          applySelectedItems(
            overlay
          );
        }
      );


    return overlay;
  };


  const escapeHtml = value => {

    return String(
      value ||
      ''
    )
      .replaceAll(
        '&',
        '&amp;'
      )
      .replaceAll(
        '<',
        '&lt;'
      )
      .replaceAll(
        '>',
        '&gt;'
      )
      .replaceAll(
        '"',
        '&quot;'
      )
      .replaceAll(
        "'",
        '&#039;'
      );
  };


  const renderItems = (
    overlay,
    items
  ) => {

    const list =
      overlay.querySelector(
        '[data-daily-work-worklog-list-v1]'
      );


    if (!list) {
      return;
    }


    if (
      !Array.isArray(
        items
      ) ||
      items.length ===
        0
    ) {

      list.innerHTML = `
        <div
          class="daily-work-worklog-empty-v1"
        >
          해당 날짜/근무조의 불러올 업무내역이 없습니다.
        </div>
      `;


      updatePickerSelectionState(
        overlay
      );


      return;
    }


    const roleGroups =
      ALLOWED_ROLES
        .map(
          role => {

            return {
              role,

              items:
                items.filter(
                  item =>
                    item.role ===
                    role
                )
            };
          }
        )
        .filter(
          group =>
            group.items.length >
            0
        );


    list.innerHTML =
      roleGroups
        .map(
          group => {

            return `
              <section
                class="daily-work-worklog-role-v1"
              >

                <div
                  class="daily-work-worklog-role-title-v1"
                >
                  ${escapeHtml(group.role)}
                  ·
                  ${group.items.length}건
                </div>

                ${group.items
                  .map(
                    item => {

                      const index =
                        items.indexOf(
                          item
                        );


                      return `
                        <label
                          class="daily-work-worklog-item-v1"
                        >

                          <input
                            type="checkbox"
                            data-daily-work-worklog-check-v1
                            value="${index}"
                          />

                          <span>

                            <span
                              class="daily-work-worklog-item-meta-v1"
                            >
                              ${
                                item.author
                                  ? `<span>${escapeHtml(item.author)}</span>`
                                  : ''
                              }

                              ${
                                item.time
                                  ? `<span>${escapeHtml(item.time)}</span>`
                                  : ''
                              }

                              ${
                                item.category
                                  ? `<span>${escapeHtml(item.category)}</span>`
                                  : ''
                              }

                              ${
                                item.tag
                                  ? `<span>${escapeHtml(item.tag)}</span>`
                                  : ''
                              }
                            </span>

                            <span
                              class="daily-work-worklog-item-content-v1"
                            >
                              ${escapeHtml(item.content)}
                            </span>

                          </span>

                        </label>
                      `;
                    }
                  )
                  .join('')}

              </section>
            `;
          }
        )
        .join(
          ''
        );


    updatePickerSelectionState(
      overlay
    );
  };


  const updatePickerSelectionState = overlay => {

    const checked =
      [
        ...overlay.querySelectorAll(
          '[data-daily-work-worklog-check-v1]:checked'
        )
      ];


    const count =
      overlay.querySelector(
        '[data-daily-work-worklog-count-v1]'
      );


    const applyButton =
      overlay.querySelector(
        '[data-daily-work-worklog-apply-v1]'
      );


    if (count) {
      count.textContent =
        `${checked.length}개 선택`;
    }


    if (applyButton) {
      applyButton.disabled =
        checked.length ===
        0;
    }
  };


  const formatSelectedItems = items => {

    return items
      .map(
        (
          item,
          index
        ) => {

          const time =
            normalizeText(
              item.time
            );


          return (
            `${index + 1}) ` +
            (
              time
                ? `${time} `
                : ''
            ) +
            normalizeText(
              item.content
            )
          );
        }
      )
      .filter(
        Boolean
      )
      .join(
        '\n'
      );
  };


  const applySelectedItems = overlay => {

    if (
      !contextTarget ||
      !contextTarget.taskControl
    ) {
      return;
    }


    const selected =
      [
        ...overlay.querySelectorAll(
          '[data-daily-work-worklog-check-v1]:checked'
        )
      ]
        .map(
          checkbox => {

            const index =
              Number(
                checkbox.value
              );


            return Number.isInteger(
              index
            )
              ? loadedItems[
                  index
                ]
              : null;
          }
        )
        .filter(
          Boolean
        );


    if (
      selected.length ===
        0
    ) {
      return;
    }


    const selectedText =
      formatSelectedItems(
        selected
      );


    if (!selectedText) {
      return;
    }


    const control =
      contextTarget.taskControl;


    const current =
      normalizeText(
        control.value
      );


    /*
     * 기존 직접 작성 내용은 삭제하지 않는다.
     * 업무일지 선택내용은 기존 내용 아래에 추가한다.
     */
    const nextValue =
      current
        ? `${current}\n${selectedText}`
        : selectedText;


    control.value =
      nextValue;


    control.dispatchEvent(
      new Event(
        'input',
        {
          bubbles:
            true
        }
      )
    );


    control.dispatchEvent(
      new Event(
        'change',
        {
          bubbles:
            true
        }
      )
    );


    overlay.hidden =
      true;


    loadedItems =
      [];


    try {

      control.focus({
        preventScroll:
          true
      });

    } catch {

      control.focus();
    }
  };


  const openPicker = async targetContext => {

    const workDate =
      getWorkDate();


    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(
        workDate
      )
    ) {

      window.alert(
        '일일업무현황 날짜를 먼저 선택해주세요.'
      );


      return;
    }


    contextTarget =
      targetContext;


    const overlay =
      ensureOverlay();


    const title =
      overlay.querySelector(
        '[data-daily-work-worklog-title-v1]'
      );


    const subtitle =
      overlay.querySelector(
        '[data-daily-work-worklog-subtitle-v1]'
      );


    const list =
      overlay.querySelector(
        '[data-daily-work-worklog-list-v1]'
      );


    if (title) {
      title.textContent =
        `${targetContext.rowLabel} 업무내역 불러오기`;
    }


    if (subtitle) {
      subtitle.textContent =
        `${workDate} · ${targetContext.shiftLabel} 업무일지`;
    }


    if (list) {

      list.innerHTML = `
        <div
          class="daily-work-worklog-empty-v1"
        >
          업무일지를 불러오고 있습니다...
        </div>
      `;
    }


    overlay.hidden =
      false;


    updatePickerSelectionState(
      overlay
    );


    try {

      const logs =
        await requestShiftLogs(
          workDate,
          targetContext.shift
        );


      loadedItems =
        collectEntries(
          logs,
          targetContext.shift
        );


      renderItems(
        overlay,
        loadedItems
      );

    } catch (
      error
    ) {

      console.error(
        `[${VERSION}] 업무일지 조회 실패`,
        error
      );


      loadedItems =
        [];


      if (list) {

        list.innerHTML = `
          <div
            class="daily-work-worklog-empty-v1"
          >
            ${escapeHtml(
              error?.message ||
              '업무일지를 불러오지 못했습니다.'
            )}
          </div>
        `;
      }


      updatePickerSelectionState(
        overlay
      );
    }
  };


  const handleContextMenu = event => {

    const targetContext =
      getRowContextFromEvent(
        event
      );


    if (!targetContext) {
      return;
    }


    /*
     * Day/Night 주요업무 셀에서는
     * 기존 일반 행 메뉴 대신 이 메뉴를 우선 사용한다.
     */
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();


    showContextMenu(
      event,
      targetContext
    );
  };


  const initialize = () => {

    installStyle();

    ensureContextMenu();
    ensureOverlay();


    /*
     * window capture에서 먼저 잡아
     * 기존 행 우클릭 메뉴와 충돌하지 않게 한다.
     */
    window.addEventListener(
      'contextmenu',
      handleContextMenu,
      true
    );


    window.addEventListener(
      'pointerdown',
      event => {

        const menu =
          document.getElementById(
            MENU_ID
          );


        if (
          !menu ||
          menu.hidden
        ) {
          return;
        }


        const target =
          event.target instanceof
            Element
            ? event.target
            : null;


        if (
          target &&
          menu.contains(
            target
          )
        ) {
          return;
        }


        hideContextMenu();
      },
      true
    );


    window.addEventListener(
      'blur',
      hideContextMenu
    );


    window.addEventListener(
      'resize',
      hideContextMenu
    );


    console.info(
      `[${VERSION}] ready`
    );
  };


  if (
    document.readyState ===
      'loading'
  ) {

    document.addEventListener(
      'DOMContentLoaded',
      initialize,
      {
        once:
          true
      }
    );

  } else {

    initialize();
  }
})();