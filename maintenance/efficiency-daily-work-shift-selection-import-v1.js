/* =========================================================
   EFFICIENCY_DAILY_WORK_SHIFT_SELECTION_IMPORT_V1

   업무일지에서 사용자가 선택한 교대 업무를
   일일업무현황 Day / Night 주요 업무로 가져온다.

   D/S -> operation-day
   N/S -> operation-night

   Source:
   window.efficiencyMorningMeetingUploadState.shiftPart

   - 선택된 항목만 가져옴
   - 저장된 일일업무현황 내용 자동 덮어쓰기 금지
   - 기존 내용이 있으면 사용자 확인 후 교체
   - DB / API / schema 변경 없음
   - MutationObserver 사용 안 함
========================================================= */

(() => {
  'use strict';


  const VERSION =
    'EFFICIENCY_DAILY_WORK_SHIFT_SELECTION_IMPORT_V1';


  const BUTTON_ID =
    'importEfficiencyDailyWorkShiftSelectionButtonV1';


  if (
    window.__gsEfficiencyDailyWorkShiftSelectionImportV1
  ) {
    return;
  }


  window.__gsEfficiencyDailyWorkShiftSelectionImportV1 =
    true;


  const isStandaloneWindow = () => {

    try {

      return (
        new URL(
          window.location.href
        )
          .searchParams
          .get(
            'efficiencyDailyWorkWindow'
          ) ===
        '1'
      );

    } catch {

      return false;
    }
  };


  const getSourceWindow = () => {

    /*
     * 별도 일일업무현황 창이면
     * 메인 GS Shift Log 창의 선택 상태를 읽는다.
     */
    try {

      if (
        window.opener &&
        !window.opener.closed &&
        window.opener.location.origin ===
          window.location.origin
      ) {

        return window.opener;
      }

    } catch (
      error
    ) {

      console.warn(
        `[${VERSION}] opener access failed`,
        error
      );
    }


    /*
     * 메인 모달로 열었을 때도 사용할 수 있도록
     * 현재 window를 fallback으로 둔다.
     */
    return window;
  };


  const getSourceShiftPart = () => {

    const sourceWindow =
      getSourceWindow();


    try {

      const shiftPart =
        sourceWindow
          ?.efficiencyMorningMeetingUploadState
          ?.shiftPart;


      if (
        !shiftPart ||
        typeof shiftPart !==
          'object'
      ) {
        return null;
      }


      return shiftPart;

    } catch (
      error
    ) {

      console.error(
        `[${VERSION}] source shift state read failed`,
        error
      );


      return null;
    }
  };


  const isSelectedId = (
    selectedIds,
    itemId
  ) => {

    if (
      !selectedIds ||
      !itemId
    ) {
      return false;
    }


    /*
     * window.opener의 Set은 서로 다른 realm이므로
     * instanceof Set 대신 .has() 존재 여부로 판정한다.
     */
    if (
      typeof selectedIds.has ===
        'function'
    ) {

      try {

        return Boolean(
          selectedIds.has(
            itemId
          )
        );

      } catch {
        return false;
      }
    }


    if (
      Array.isArray(
        selectedIds
      )
    ) {

      return selectedIds.includes(
        itemId
      );
    }


    return false;
  };


  const normalizeShift = value => {

    const shift =
      String(
        value ||
        ''
      )
        .trim()
        .toUpperCase()
        .replace(
          /[^A-Z]/g,
          ''
        );


    if (
      shift ===
        'D' ||
      shift ===
        'DS'
    ) {
      return 'DS';
    }


    if (
      shift ===
        'N' ||
      shift ===
        'NS'
    ) {
      return 'NS';
    }


    return '';
  };


  const getSelectedItems = shift => {

    const shiftPart =
      getSourceShiftPart();


    if (!shiftPart) {
      return [];
    }


    const items =
      Array.isArray(
        shiftPart.items
      )
        ? shiftPart.items
        : [];


    const selectedIds =
      shiftPart.selectedIds;


    return items.filter(
      item => {

        return (
          normalizeShift(
            item?.shift
          ) ===
            shift &&
          isSelectedId(
            selectedIds,
            item?.id
          )
        );
      }
    );
  };


  const formatItems = items => {

    return items
      .map(
        (
          item,
          index
        ) => {

          const time =
            String(
              item?.time ||
              ''
            ).trim();


          const content =
            String(
              item?.content ||
              ''
            ).trim();


          if (!content) {
            return '';
          }


          return (
            `${index + 1}) ` +
            (
              time
                ? `${time} `
                : ''
            ) +
            content
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


  const getTaskControl = rowKey => {

    const row =
      document.querySelector(
        (
          '[data-efficiency-daily-work-row-key="' +
          rowKey +
          '"]'
        )
      );


    return (
      row?.querySelector(
        '[data-efficiency-daily-work-field="tasks"]'
      ) ||
      null
    );
  };


  const setTaskValue = (
    control,
    value
  ) => {

    if (!control) {
      return false;
    }


    control.value =
      value;


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


    return true;
  };


  const showMessage = message => {

    try {

      const sourceWindow =
        getSourceWindow();


      if (
        typeof sourceWindow?.showToast ===
          'function'
      ) {

        sourceWindow.showToast(
          message
        );


        return;
      }

    } catch {
      // fall through
    }


    console.info(
      `[${VERSION}] ${message}`
    );
  };


  const importSelections = () => {

    const shiftPart =
      getSourceShiftPart();


    if (!shiftPart) {

      window.alert(
        '업무일지의 선택 내용을 찾을 수 없습니다.\n\n' +
        'GS Shift Log 메인 화면에서 업무일지 항목을 선택한 뒤 다시 실행해주세요.'
      );


      return false;
    }


    const dayItems =
      getSelectedItems(
        'DS'
      );


    const nightItems =
      getSelectedItems(
        'NS'
      );


    if (
      dayItems.length ===
        0 &&
      nightItems.length ===
        0
    ) {

      window.alert(
        '선택된 업무일지 내용이 없습니다.\n\n' +
        'D/S 또는 N/S 업무 항목을 먼저 선택해주세요.'
      );


      return false;
    }


    const dayText =
      formatItems(
        dayItems
      );


    const nightText =
      formatItems(
        nightItems
      );


    const dayControl =
      getTaskControl(
        'operation-day'
      );


    const nightControl =
      getTaskControl(
        'operation-night'
      );


    if (
      !dayControl ||
      !nightControl
    ) {

      window.alert(
        'Day / Night 주요 업무 입력칸을 찾지 못했습니다.'
      );


      return false;
    }


    const currentDayText =
      String(
        dayControl.value ||
        ''
      ).trim();


    const currentNightText =
      String(
        nightControl.value ||
        ''
      ).trim();


    const dayWillChange =
      Boolean(
        dayText &&
        dayText !==
          currentDayText
      );


    const nightWillChange =
      Boolean(
        nightText &&
        nightText !==
          currentNightText
      );


    if (
      !dayWillChange &&
      !nightWillChange
    ) {

      showMessage(
        '현재 선택된 업무일지 내용이 이미 반영되어 있습니다.'
      );


      return true;
    }


    const replacingExisting =
      (
        dayWillChange &&
        currentDayText
      ) ||
      (
        nightWillChange &&
        currentNightText
      );


    if (
      replacingExisting
    ) {

      const confirmed =
        window.confirm(
          'Day / Night 주요 업무에 이미 작성된 내용이 있습니다.\n\n' +
          '현재 업무일지에서 선택한 내용으로 교체하시겠습니까?'
        );


      if (!confirmed) {
        return false;
      }
    }


    let changedCount =
      0;


    if (
      dayWillChange
    ) {

      if (
        setTaskValue(
          dayControl,
          dayText
        )
      ) {
        changedCount +=
          1;
      }
    }


    if (
      nightWillChange
    ) {

      if (
        setTaskValue(
          nightControl,
          nightText
        )
      ) {
        changedCount +=
          1;
      }
    }


    if (
      changedCount >
      0
    ) {

      showMessage(
        `업무일지 선택내용을 Day/Night ${changedCount}개 항목에 반영했습니다.`
      );
    }


    return (
      changedCount >
      0
    );
  };


  const installStyle = () => {

    if (
      document.getElementById(
        'efficiencyDailyWorkShiftImportStyleV1'
      )
    ) {
      return;
    }


    const style =
      document.createElement(
        'style'
      );


    style.id =
      'efficiencyDailyWorkShiftImportStyleV1';


    style.textContent = `
      #${BUTTON_ID} {
        min-height: 34px;
        padding: 0 13px;
        border: 1px solid #aac2dc;
        border-radius: 9px;
        background: #f6fbff;
        color: #285d8c;
        font-size: 12px;
        font-weight: 800;
        white-space: nowrap;
        cursor: pointer;
      }

      #${BUTTON_ID}:hover {
        background: #eaf5ff;
        border-color: #7fa9d0;
      }

      #${BUTTON_ID}:active {
        transform: translateY(1px);
      }

      @media print {
        #${BUTTON_ID} {
          display: none !important;
        }
      }
    `;


    document.head.append(
      style
    );
  };


  const installButton = () => {

    if (
      document.getElementById(
        BUTTON_ID
      )
    ) {
      return true;
    }


    const dateInput =
      document.getElementById(
        'efficiencyDailyWorkDate'
      );


    const toolbar =
      dateInput?.closest(
        '.efficiency-daily-work-date-toolbar'
      );


    if (!toolbar) {

      console.warn(
        `[${VERSION}] date toolbar not found`
      );


      return false;
    }


    const button =
      document.createElement(
        'button'
      );


    button.type =
      'button';


    button.id =
      BUTTON_ID;


    button.textContent =
      '업무일지 선택 반영';


    button.title =
      '업무일지에서 선택한 D/S·N/S 주요 업무를 Day/Night 칸으로 가져옵니다.';


    button.addEventListener(
      'click',
      event => {

        event.preventDefault();
        event.stopPropagation();


        importSelections();
      }
    );


    toolbar.append(
      button
    );


    return true;
  };


  const initialize = () => {

    /*
     * 별도 창과 기존 메인 모달 양쪽에서 동작 가능.
     * 현재 사용 방식은 별도 창.
     */
    installStyle();


    if (
      !installButton()
    ) {

      window.setTimeout(
        installButton,
        500
      );
    }


    console.info(
      `[${VERSION}] ready`,
      {
        standalone:
          isStandaloneWindow()
      }
    );
  };


  window.importEfficiencyDailyWorkShiftSelections =
    importSelections;


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