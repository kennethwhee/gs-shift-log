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


  /* =========================================================
     EFFICIENCY_DAILY_WORK_WORKLOG_PICKER_DIALOG_VISIBLE_V7

     V6에서 Overlay 배경은 표시되지만
     내부 Dialog가 일일업무현황 별도창의 기존 CSS에 의해
     보이지 않는 현상을 방지한다.

     Dialog 자체와 핵심 자식 UI를 inline !important로
     명시적으로 표시한다.
  ========================================================= */

  /* =========================================================
     EFFICIENCY_DAILY_WORK_WORKLOG_PICKER_CONTENT_VISIBLE_V8

     별도 일일업무현황 창의 기존 CSS가
     Picker 내부의 텍스트 / 버튼 / 체크박스를 숨겨도
     각 요소에 inline !important를 적용해 강제로 표시한다.
  ========================================================= */

  const forceWorklogPickerContentsVisibleV8 = overlay => {

    if (!overlay) {
      return false;
    }


    const dialog =
      overlay.querySelector(
        '.daily-work-worklog-dialog-v1'
      );


    if (!dialog) {
      return false;
    }


    const important = (
      element,
      property,
      value
    ) => {

      if (!element) {
        return;
      }


      element.style.setProperty(
        property,
        value,
        'important'
      );
    };


    /*
     * Dialog 전체 공통
     */
    important(
      dialog,
      'color',
      '#243d55'
    );

    important(
      dialog,
      'font-family',
      '"Malgun Gothic", "Noto Sans KR", Arial, sans-serif'
    );

    important(
      dialog,
      'font-size',
      '12px'
    );

    important(
      dialog,
      '-webkit-text-fill-color',
      'currentColor'
    );


    /*
     * 혹시 상위 CSS가 모든 자식에 visibility/opacity/color 등을
     * 강제로 주더라도 다시 복구
     */
    dialog
      .querySelectorAll(
        '*'
      )
      .forEach(
        element => {

          important(
            element,
            'visibility',
            'visible'
          );


          important(
            element,
            'opacity',
            '1'
          );


          important(
            element,
            'text-indent',
            '0'
          );


          important(
            element,
            '-webkit-text-fill-color',
            'currentColor'
          );
        }
      );


    /*
     * 제목
     */
    const title =
      dialog.querySelector(
        '[data-daily-work-worklog-title-v1]'
      );


    important(
      title,
      'display',
      'block'
    );

    important(
      title,
      'color',
      '#173a5c'
    );

    important(
      title,
      'font-size',
      '17px'
    );

    important(
      title,
      'font-weight',
      '900'
    );

    important(
      title,
      'line-height',
      '1.35'
    );


    /*
     * 날짜 / 근무조 설명
     */
    const subtitle =
      dialog.querySelector(
        '[data-daily-work-worklog-subtitle-v1]'
      );


    important(
      subtitle,
      'display',
      'block'
    );

    important(
      subtitle,
      'color',
      '#71849a'
    );

    important(
      subtitle,
      'font-size',
      '12px'
    );

    important(
      subtitle,
      'font-weight',
      '600'
    );

    important(
      subtitle,
      'line-height',
      '1.4'
    );


    /*
     * 선택 개수
     */
    const count =
      dialog.querySelector(
        '[data-daily-work-worklog-count-v1]'
      );


    important(
      count,
      'display',
      'inline-block'
    );

    important(
      count,
      'color',
      '#5d738a'
    );

    important(
      count,
      'font-size',
      '12px'
    );

    important(
      count,
      'font-weight',
      '800'
    );


    /*
     * 버튼
     */
    dialog
      .querySelectorAll(
        'button'
      )
      .forEach(
        button => {

          important(
            button,
            'display',
            'inline-flex'
          );


          important(
            button,
            'align-items',
            'center'
          );


          important(
            button,
            'justify-content',
            'center'
          );


          important(
            button,
            'visibility',
            'visible'
          );


          important(
            button,
            'font-size',
            '12px'
          );


          important(
            button,
            'font-weight',
            '800'
          );


          important(
            button,
            'line-height',
            '1.2'
          );


          important(
            button,
            'text-indent',
            '0'
          );


          important(
            button,
            '-webkit-text-fill-color',
            'currentColor'
          );
        }
      );


    const closeButton =
      dialog.querySelector(
        '[data-daily-work-worklog-close-v1]'
      );


    important(
      closeButton,
      'color',
      '#536b84'
    );

    important(
      closeButton,
      'width',
      '31px'
    );

    important(
      closeButton,
      'height',
      '31px'
    );


    const selectAllButton =
      dialog.querySelector(
        '[data-daily-work-worklog-select-all-v1]'
      );


    const clearButton =
      dialog.querySelector(
        '[data-daily-work-worklog-clear-v1]'
      );


    [
      selectAllButton,
      clearButton
    ].forEach(
      button => {

        important(
          button,
          'color',
          '#48617a'
        );


        important(
          button,
          'background',
          '#ffffff'
        );


        important(
          button,
          'border',
          '1px solid #cad7e4'
        );
      }
    );


    const cancelButton =
      dialog.querySelector(
        '[data-daily-work-worklog-cancel-v1]'
      );


    important(
      cancelButton,
      'color',
      '#526b84'
    );

    important(
      cancelButton,
      'background',
      '#ffffff'
    );

    important(
      cancelButton,
      'border',
      '1px solid #cad7e4'
    );


    const applyButton =
      dialog.querySelector(
        '[data-daily-work-worklog-apply-v1]'
      );


    important(
      applyButton,
      'color',
      '#ffffff'
    );

    important(
      applyButton,
      '-webkit-text-fill-color',
      '#ffffff'
    );

    important(
      applyButton,
      'background',
      '#2d74b7'
    );

    important(
      applyButton,
      'border',
      '1px solid #2d74b7'
    );


    /*
     * 목록 / 로딩 / 빈 상태
     */
    const list =
      dialog.querySelector(
        '[data-daily-work-worklog-list-v1]'
      );


    important(
      list,
      'display',
      'block'
    );

    important(
      list,
      'color',
      '#243d55'
    );

    important(
      list,
      'font-size',
      '12px'
    );

    important(
      list,
      'line-height',
      '1.5'
    );


    list
      ?.querySelectorAll(
        'div, span, p, label'
      )
      .forEach(
        element => {

          important(
            element,
            'visibility',
            'visible'
          );


          important(
            element,
            'opacity',
            '1'
          );


          important(
            element,
            'color',
            '#243d55'
          );


          important(
            element,
            'font-size',
            '12px'
          );


          important(
            element,
            '-webkit-text-fill-color',
            '#243d55'
          );
        }
      );


    /*
     * 체크박스
     */
    list
      ?.querySelectorAll(
        'input[type="checkbox"]'
      )
      .forEach(
        checkbox => {

          important(
            checkbox,
            'display',
            'inline-block'
          );


          important(
            checkbox,
            'visibility',
            'visible'
          );


          important(
            checkbox,
            'opacity',
            '1'
          );


          important(
            checkbox,
            'width',
            '16px'
          );


          important(
            checkbox,
            'height',
            '16px'
          );
        }
      );


    return true;
  };

  const forceWorklogPickerDialogVisibleV7 = overlay => {

    if (!overlay) {
      return false;
    }


    const dialog =
      overlay.querySelector(
        '.daily-work-worklog-dialog-v1'
      );


    if (!dialog) {

      console.error(
        '[WORKLOG PICKER V7] dialog element not found'
      );


      return false;
    }


    const setImportant = (
      element,
      property,
      value
    ) => {

      if (!element) {
        return;
      }


      element.style.setProperty(
        property,
        value,
        'important'
      );
    };


    setImportant(
      dialog,
      'display',
      'flex'
    );


    setImportant(
      dialog,
      'visibility',
      'visible'
    );


    setImportant(
      dialog,
      'opacity',
      '1'
    );


    setImportant(
      dialog,
      'position',
      'relative'
    );


    setImportant(
      dialog,
      'z-index',
      '2147483647'
    );


    setImportant(
      dialog,
      'width',
      'min(760px, calc(100vw - 52px))'
    );


    setImportant(
      dialog,
      'max-width',
      '760px'
    );


    setImportant(
      dialog,
      'min-width',
      '420px'
    );


    setImportant(
      dialog,
      'max-height',
      'min(720px, calc(100vh - 52px))'
    );


    setImportant(
      dialog,
      'overflow',
      'hidden'
    );


    setImportant(
      dialog,
      'background',
      '#ffffff'
    );


    setImportant(
      dialog,
      'border',
      '1px solid #bdcede'
    );


    setImportant(
      dialog,
      'border-radius',
      '15px'
    );


    setImportant(
      dialog,
      'box-shadow',
      '0 20px 60px rgba(25, 46, 68, 0.32)'
    );


    [
      '.daily-work-worklog-header-v1',
      '.daily-work-worklog-toolbar-v1',
      '.daily-work-worklog-list-v1',
      '.daily-work-worklog-footer-v1'
    ].forEach(
      selector => {

        const element =
          dialog.querySelector(
            selector
          );


        if (!element) {
          return;
        }


        setImportant(
          element,
          'visibility',
          'visible'
        );


        setImportant(
          element,
          'opacity',
          '1'
        );
      }
    );


    const header =
      dialog.querySelector(
        '.daily-work-worklog-header-v1'
      );


    const toolbar =
      dialog.querySelector(
        '.daily-work-worklog-toolbar-v1'
      );


    const list =
      dialog.querySelector(
        '.daily-work-worklog-list-v1'
      );


    const footer =
      dialog.querySelector(
        '.daily-work-worklog-footer-v1'
      );


    setImportant(
      header,
      'display',
      'flex'
    );


    setImportant(
      toolbar,
      'display',
      'flex'
    );


    setImportant(
      list,
      'display',
      'block'
    );


    setImportant(
      list,
      'flex',
      '1 1 auto'
    );


    setImportant(
      footer,
      'display',
      'flex'
    );


    return true;
  };

  const setWorklogPickerOverlayVisibleV6 = (
    overlay,
    visible
  ) => {

    if (!overlay) {
      return;
    }


    if (visible) {

      overlay.hidden =
        false;


      /*
       * 별도 일일업무현황 창의 CSS보다 확실히 위에 표시한다.
       */
      overlay.style.setProperty(
        'display',
        'flex',
        'important'
      );


      overlay.style.setProperty(
        'visibility',
        'visible',
        'important'
      );


      overlay.style.setProperty(
        'opacity',
        '1',
        'important'
      );


      overlay.style.setProperty(
        'z-index',
        '2147483646',
        'important'
      );


      const dialogVisible =
        forceWorklogPickerDialogVisibleV7(
          overlay
        );


      if (!dialogVisible) {

        throw new Error(
          '업무내역 선택창 내부 Dialog를 찾지 못했습니다.'
        );
      }


      const contentsVisible =
        forceWorklogPickerContentsVisibleV8(
          overlay
        );


      if (!contentsVisible) {

        throw new Error(
          '업무내역 선택창 내부 UI를 표시하지 못했습니다.'
        );
      }


      return;
    }


    overlay.style.removeProperty(
      'display'
    );


    overlay.style.removeProperty(
      'visibility'
    );


    overlay.style.removeProperty(
      'opacity'
    );


    overlay.style.removeProperty(
      'z-index'
    );


    overlay.hidden =
      true;
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

      setWorklogPickerOverlayVisibleV6(
        overlay,
        false
      );


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


    overlay.addEventListener(
      'pointerdown',
      event => {

        if (
          event.target !==
            overlay
        ) {
          return;
        }


        close();
      }
    );


    window.addEventListener(
      'keydown',
      event => {

        if (
          event.key !==
            'Escape' ||
          overlay.hidden
        ) {
          return;
        }


        event.preventDefault();
        event.stopPropagation();


        close();
      },
      true
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


    forceWorklogPickerContentsVisibleV8(
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


    setWorklogPickerOverlayVisibleV6(
      overlay,
      false
    );


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


    setWorklogPickerOverlayVisibleV6(
      overlay,
      true
    );


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


  /* =========================================================
     EFFICIENCY_DAILY_WORK_WORKLOG_PICKER_DIRECT_TARGET_V3

     별도창의 실제 입력 컨트롤 이름을 직접 기준으로 삼는다.

     dayTasks   -> D/S
     nightTasks -> N/S

     data-row-key 구조가 변경/복제돼도 동작한다.
  ========================================================= */

  const getDirectWorklogTargetContext = event => {

    const rawTarget =
      event?.target instanceof
        Element
        ? event.target
        : null;


    if (!rawTarget) {
      return null;
    }


    let taskControl =
      rawTarget.closest(
        'textarea[name="dayTasks"], textarea[name="nightTasks"]'
      );


    /*
     * textarea 자체가 아닌 TD 여백을 우클릭했을 경우도
     * 같은 주요업무 칸으로 처리한다.
     */
    if (!taskControl) {

      const cell =
        rawTarget.closest(
          'td'
        );


      taskControl =
        cell?.querySelector(
          'textarea[name="dayTasks"], textarea[name="nightTasks"]'
        ) ||
        null;
    }


    if (!taskControl) {
      return null;
    }


    const controlName =
      String(
        taskControl.getAttribute(
          'name'
        ) ||
        ''
      ).trim();


    if (
      controlName !==
        'dayTasks' &&
      controlName !==
        'nightTasks'
    ) {
      return null;
    }


    const isDay =
      controlName ===
        'dayTasks';


    return {
      row:
        taskControl.closest(
          'tr'
        ),

      rowKey:
        isDay
          ? 'operation-day'
          : 'operation-night',

      taskControl,

      shift:
        isDay
          ? 'DS'
          : 'NS',

      shiftLabel:
        isDay
          ? 'D/S'
          : 'N/S',

      rowLabel:
        isDay
          ? 'Day 근무조'
          : 'Night 근무조'
    };
  };

  /* =========================================================
     EFFICIENCY_DAILY_WORK_WORKLOG_PICKER_EXISTING_MENU_V5

     별도 우클릭 메뉴를 만들지 않는다.

     기존 일일업무현황 행 메뉴가 정상적으로 열린 뒤
     그 메뉴 안에 [업무내역 불러오기]만 추가한다.

     따라서:
     - 위에 행 추가
     - 아래에 행 추가
     - 행 숨기기
     - 행 삭제
     - 복원

     기존 기능을 모두 그대로 유지한다.
  ========================================================= */

  const isVisibleWorklogMenuElementV5 = element => {

    if (
      !element ||
      !(element instanceof Element)
    ) {
      return false;
    }


    const style =
      window.getComputedStyle(
        element
      );


    if (
      style.display ===
        'none' ||
      style.visibility ===
        'hidden' ||
      Number(
        style.opacity
      ) ===
        0
    ) {
      return false;
    }


    const rect =
      element.getBoundingClientRect();


    return (
      rect.width >
        20 &&
      rect.height >
        20
    );
  };


  const findExistingDailyWorkRowMenuV5 = targetContext => {

    const buttons =
      [
        ...document.querySelectorAll(
          'button'
        )
      ]
        .filter(
          button =>
            isVisibleWorklogMenuElementV5(
              button
            )
        );


    const insertAboveButton =
      buttons.find(
        button =>
          normalizeText(
            button.textContent
          ) ===
            '위에 행 추가'
      );


    if (!insertAboveButton) {
      return null;
    }


    let current =
      insertAboveButton.parentElement;


    while (
      current &&
      current !==
        document.body
    ) {

      if (
        !isVisibleWorklogMenuElementV5(
          current
        )
      ) {

        current =
          current.parentElement;

        continue;
      }


      const text =
        normalizeText(
          current.innerText ||
          current.textContent
        );


      const hasAbove =
        text.includes(
          '위에 행 추가'
        );


      const hasBelow =
        text.includes(
          '아래에 행 추가'
        );


      const hasDelete =
        text.includes(
          '이 행 삭제'
        );


      const hasTargetTitle =
        !targetContext?.rowLabel ||
        text.includes(
          targetContext.rowLabel
        );


      if (
        hasAbove &&
        hasBelow &&
        hasDelete &&
        hasTargetTitle
      ) {
        return current;
      }


      current =
        current.parentElement;
    }


    return null;
  };


  const injectWorklogButtonIntoExistingMenuV5 =
    targetContext => {

      const menu =
        findExistingDailyWorkRowMenuV5(
          targetContext
        );


      if (!menu) {
        return false;
      }


      let button =
        menu.querySelector(
          '[data-daily-work-existing-menu-worklog-v5]'
        );


      if (button) {

        button.dataset
          .dailyWorkRowKey =
          targetContext.rowKey;


        return true;
      }


      const referenceButton =
        [
          ...menu.querySelectorAll(
            'button'
          )
        ]
          .find(
            candidate =>
              normalizeText(
                candidate.textContent
              ) ===
                '위에 행 추가'
          );


      if (!referenceButton) {
        return false;
      }


      button =
        document.createElement(
          'button'
        );


      button.type =
        'button';


      button.textContent =
        '업무내역 불러오기';


      button.dataset
        .dailyWorkExistingMenuWorklogV5 =
        '1';


      button.dataset
        .dailyWorkRowKey =
        targetContext.rowKey;


      /*
       * 기존 메뉴 버튼과 정확히 같은 디자인 사용
       */
      button.className =
        referenceButton.className;


      if (
        referenceButton.getAttribute(
          'style'
        )
      ) {

        button.setAttribute(
          'style',
          referenceButton.getAttribute(
            'style'
          )
        );
      }


      button.style.fontWeight =
        '800';


      button.addEventListener(
        'pointerdown',
        event => {

          event.stopPropagation();
          event.stopImmediatePropagation();
        },
        true
      );


      button.addEventListener(
        'click',
        event => {

          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();


          const activeContext =
            contextTarget ||
            targetContext;


          if (!activeContext) {
            return;
          }


          /*
           * =====================================================
           * EFFICIENCY_DAILY_WORK_WORKLOG_PICKER_LAUNCH_FIX_V6
           *
           * 절대 기존 Daily Work 행 메뉴에
           * style.display = "none"을 직접 넣지 않는다.
           *
           * 기존 메뉴는 Popup runtime이 자체적으로 관리한다.
           * =====================================================
           */

          const launchPickerV6 =
            async () => {

              try {

                await openPicker(
                  activeContext
                );

              } catch (
                error
              ) {

                console.error(
                  '[WORKLOG PICKER V6] open failed',
                  error
                );


                window.alert(
                  (
                    '업무내역 불러오기 창을 열지 못했습니다.\n\n' +
                    (
                      error?.message ||
                      String(
                        error ||
                        '알 수 없는 오류'
                      )
                    )
                  )
                );
              }
            };


          void launchPickerV6();
        },
        true
      );


      referenceButton.insertAdjacentElement(
        'beforebegin',
        button
      );


      return true;
    };


  const queueExistingMenuInjectionV5 =
    targetContext => {

      /*
       * 기존 Popup의 contextmenu 처리 직후 실행한다.
       * 메뉴 렌더링 시점 차이를 위해 짧게 재확인한다.
       *
       * MutationObserver는 사용하지 않는다.
       */
      [
        0,
        25,
        70
      ].forEach(
        delay => {

          window.setTimeout(
            () => {

              injectWorklogButtonIntoExistingMenuV5(
                targetContext
              );
            },
            delay
          );
        }
      );
    };


  const handleContextMenu = event => {

    const targetContext =
      getDirectWorklogTargetContext(
        event
      ) ||
      getRowContextFromEvent(
        event
      );


    if (!targetContext) {
      return;
    }


    /*
     * 여기서는 절대 preventDefault / stopPropagation 하지 않는다.
     *
     * 기존 Daily Work 우클릭 메뉴를 먼저 정상 동작시킨 뒤
     * 업무내역 버튼만 삽입한다.
     */
    contextTarget =
      targetContext;


    queueExistingMenuInjectionV5(
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


    /*
     * =========================================================
     * EFFICIENCY_DAILY_WORK_WORKLOG_PICKER_HIDE_CONFLICT_FIX_V4
     *
     * V3에서는 오른쪽 pointerdown에서 메뉴를 먼저 표시하지만,
     * 기존 outside-click handler가 같은 이벤트에서 바로 메뉴를
     * 닫아버리는 문제가 있었다.
     *
     * 오른쪽 버튼은 context menu 처리용이므로 여기서는 무시한다.
     * 왼쪽 클릭으로 메뉴 바깥을 클릭할 때만 닫는다.
     * =========================================================
     */

    window.addEventListener(
      'pointerdown',
      event => {

        /*
         * Right mouse button:
         * Worklog Picker가 처리하므로 여기서 닫지 않는다.
         */
        if (
          Number(
            event?.button
          ) ===
            2
        ) {
          return;
        }


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


  /* =========================================================
     EFFICIENCY_DAILY_WORK_WORKLOG_PICKER_CONTEXT_PRIORITY_V2

     기존 Popup의 행/셀 우클릭 메뉴보다 먼저
     Day/Night 주요업무 contextmenu 이벤트를 선점한다.

     같은 callback을 initialize()에서 다시 등록해도
     브라우저는 동일 listener 중복 등록을 무시한다.
  ========================================================= */

  window.addEventListener(
    'contextmenu',
    handleContextMenu,
    true
  );
  /*
   * 일부 브라우저/기존 편집기가 contextmenu를 먼저 막더라도
   * 실제 오른쪽 마우스 버튼 down 시점에서 Picker 메뉴를 띄운다.
   *
   * Day/Night 주요업무에서만 동작하므로
   * 다른 셀의 기존 우클릭 메뉴에는 영향 없음.
   */
  const handleWorklogRightPointerDownV3 = () => {

    /*
     * V5:
     * 기존 일일업무현황 메뉴를 사용하므로
     * 오른쪽 버튼을 여기서 가로채지 않는다.
     */
    return;
  };


  window.addEventListener(
    'pointerdown',
    handleWorklogRightPointerDownV3,
    true
  );



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
/* =========================================================
   EFFICIENCY_DAILY_WORK_WORKLOG_PICKER_LEFT_ALIGN_V9

   업무내역 선택 팝업의 업무목록만 왼쪽 정렬한다.

   - 역할/건수
   - 작성자/시간
   - 체크박스 행
   - 실제 업무내용

   팝업 제목 / 상단 제어 / 하단 버튼 정렬은 변경하지 않는다.
========================================================= */

(() => {

  const STYLE_ID =
    'efficiency-daily-work-worklog-left-align-v9';


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
    .daily-work-worklog-dialog-v1
    .daily-work-worklog-list-v1 {
      text-align: left !important;
    }

    .daily-work-worklog-dialog-v1
    .daily-work-worklog-list-v1 * {
      text-align: left !important;
    }

    .daily-work-worklog-dialog-v1
    .daily-work-worklog-list-v1 label {
      justify-content: flex-start !important;
    }

    .daily-work-worklog-dialog-v1
    .daily-work-worklog-list-v1 div,
    .daily-work-worklog-dialog-v1
    .daily-work-worklog-list-v1 p,
    .daily-work-worklog-dialog-v1
    .daily-work-worklog-list-v1 span {
      text-align: left !important;
    }
  `;


  (
    document.head ||
    document.documentElement
  ).appendChild(
    style
  );

})();
/* =========================================================
   EFFICIENCY_DAILY_WORK_WORKLOG_PICKER_LEFT_ALIGN_V10

   V9에서 text-align은 왼쪽이 되었지만
   실제 업무내용 span 자체가 가운데 폭으로 남아있던 부분 수정.

   작성자 줄과 실제 업무내용의 시작선을 맞춘다.
========================================================= */

(() => {

  const STYLE_ID =
    'efficiency-daily-work-worklog-left-align-v10';


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
    .daily-work-worklog-dialog-v1
    .daily-work-worklog-item-v1 {
      grid-template-columns: 22px minmax(0, 1fr) !important;
      justify-items: stretch !important;
      text-align: left !important;
    }

    .daily-work-worklog-dialog-v1
    .daily-work-worklog-item-v1 > span {
      display: block !important;
      width: 100% !important;
      min-width: 0 !important;
      max-width: none !important;
      margin: 0 !important;
      padding: 0 !important;
      justify-self: stretch !important;
      text-align: left !important;
    }

    .daily-work-worklog-dialog-v1
    .daily-work-worklog-item-meta-v1 {
      display: flex !important;
      width: 100% !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
      padding-left: 0 !important;
      padding-right: 0 !important;
      justify-content: flex-start !important;
      text-align: left !important;
    }

    .daily-work-worklog-dialog-v1
    .daily-work-worklog-item-content-v1 {
      display: block !important;
      width: 100% !important;
      min-width: 0 !important;
      max-width: none !important;
      margin: 0 !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
      padding: 0 !important;
      padding-left: 0 !important;
      padding-right: 0 !important;
      justify-self: stretch !important;
      align-self: start !important;
      text-align: left !important;
      white-space: pre-wrap !important;
    }
  `;


  (
    document.head ||
    document.documentElement
  ).appendChild(
    style
  );

})();