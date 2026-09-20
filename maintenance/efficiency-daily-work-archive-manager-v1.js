/* =========================================================
   EFFICIENCY DAILY WORK ARCHIVE MANAGER V1

   Left archive management:
   - 관리 모드
   - 복수 날짜 선택
   - 전체 선택
   - 선택 삭제
   - 현재 작성 중 미저장 기록 보호
   - version 기반 DELETE 검증
   - 삭제 완료 후 서버 재조회

   Core script.js / DB schema untouched.
   No MutationObserver.
========================================================= */

(() => {
  'use strict';


  const VERSION =
    'EFFICIENCY_DAILY_WORK_ARCHIVE_MANAGER_V1';


  const PANEL_ID =
    'efficiencyDailyWorkArchivePanel';


  const TREE_ID =
    'efficiencyDailyWorkFolderTree';


  const COUNT_ID =
    'efficiencyDailyWorkArchiveCount';


  const REFRESH_ID =
    'refreshEfficiencyDailyWorkButton';


  const MANAGE_BUTTON_ID =
    'manageEfficiencyDailyWorkArchiveButtonV1';


  const TOOLBAR_ID =
    'efficiencyDailyWorkArchiveManagerToolbarV1';


  const SELECT_COUNT_ID =
    'efficiencyDailyWorkArchiveManagerSelectedCountV1';


  const SELECT_ALL_ID =
    'selectAllEfficiencyDailyWorkArchiveButtonV1';


  const DELETE_SELECTED_ID =
    'deleteSelectedEfficiencyDailyWorkArchiveButtonV1';


  const CANCEL_ID =
    'cancelEfficiencyDailyWorkArchiveManagerButtonV1';


  if (
    window.__gsEfficiencyDailyWorkArchiveManagerV1
  ) {
    return;
  }


  window.__gsEfficiencyDailyWorkArchiveManagerV1 =
    true;


  let manageMode =
    false;


  let busy =
    false;


  const selectedKeys =
    new Set();


  let originalArchiveRenderer =
    null;


  const getPanel = () =>
    document.getElementById(
      PANEL_ID
    );


  const getTree = () =>
    document.getElementById(
      TREE_ID
    );


  const getRefreshButton = () =>
    document.getElementById(
      REFRESH_ID
    );


  const getRecordKey = (
    recordId,
    workDate
  ) => {

    return (
      `${String(recordId || '').trim()}::` +
      `${String(workDate || '').trim()}`
    );
  };


  const getButtonKey = button => {

    return getRecordKey(
      button?.dataset
        ?.efficiencyDailyWorkRecordId,
      button?.dataset
        ?.efficiencyDailyWorkDate
    );
  };


  const getArchiveRecords = () => {

    if (
      typeof getEfficiencyDailyWorkArchiveRecords !==
        'function'
    ) {
      return [];
    }


    const records =
      getEfficiencyDailyWorkArchiveRecords();


    return Array.isArray(
      records
    )
      ? records
      : [];
  };


  const getSelectedRecords = () => {

    return getArchiveRecords()
      .filter(
        record =>
          selectedKeys.has(
            getRecordKey(
              record.id,
              record.workDate
            )
          )
      );
  };


  const formatDate = value => {

    const text =
      String(
        value ||
        ''
      );


    const match =
      text.match(
        /^(\d{4})-(\d{2})-(\d{2})$/
      );


    if (!match) {
      return text;
    }


    return (
      `${match[1]}.${match[2]}.${match[3]}`
    );
  };


  const installStyle = () => {

    if (
      document.getElementById(
        'efficiencyDailyWorkArchiveManagerStyleV1'
      )
    ) {
      return;
    }


    const style =
      document.createElement(
        'style'
      );


    style.id =
      'efficiencyDailyWorkArchiveManagerStyleV1';


    style.textContent = `
      #${PANEL_ID}
      .efficiency-daily-work-archive-manager-heading-v1 {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 7px;
      }

      #${MANAGE_BUTTON_ID} {
        min-height: 28px;
        padding: 4px 10px;
        border: 1px solid #c7d5e5;
        border-radius: 9px;
        background: #ffffff;
        color: #46617f;
        font-size: 11px;
        font-weight: 800;
        cursor: pointer;
      }

      #${MANAGE_BUTTON_ID}:hover {
        background: #f5f9fd;
      }

      #${MANAGE_BUTTON_ID}.is-active-v1 {
        border-color: #5c8fc2;
        background: #edf6ff;
        color: #205c96;
      }

      #${TOOLBAR_ID} {
        margin-top: 8px;
        padding: 9px;
        border: 1px solid #d9e4ef;
        border-radius: 11px;
        background: #f8fbfe;
      }

      #${TOOLBAR_ID}[hidden] {
        display: none !important;
      }

      .efficiency-daily-work-archive-manager-summary-v1 {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 7px;
        font-size: 11px;
        font-weight: 800;
        color: #536a82;
      }

      .efficiency-daily-work-archive-manager-actions-v1 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }

      .efficiency-daily-work-archive-manager-actions-v1 button {
        min-height: 31px;
        padding: 5px 6px;
        border-radius: 8px;
        border: 1px solid #cedae7;
        background: #ffffff;
        color: #425b73;
        font-size: 11px;
        font-weight: 800;
        cursor: pointer;
      }

      .efficiency-daily-work-archive-manager-actions-v1 button:hover {
        background: #f2f7fb;
      }

      #${DELETE_SELECTED_ID} {
        border-color: #e5bcbc;
        color: #b33b3b;
      }

      #${DELETE_SELECTED_ID}:not(:disabled):hover {
        background: #fff3f3;
      }

      .efficiency-daily-work-archive-manager-actions-v1
      button:disabled {
        opacity: 0.45;
        cursor: default;
      }

      #${PANEL_ID}.is-archive-manage-mode-v1
      .efficiency-daily-work-record-button {
        position: relative;
        padding-left: 35px !important;
      }

      #${PANEL_ID}.is-archive-manage-mode-v1
      .efficiency-daily-work-record-button::before {
        content: "";
        position: absolute;
        left: 9px;
        top: 50%;
        width: 15px;
        height: 15px;
        box-sizing: border-box;
        border: 1.5px solid #9eb2c7;
        border-radius: 4px;
        background: #ffffff;
        transform: translateY(-50%);
      }

      #${PANEL_ID}.is-archive-manage-mode-v1
      .efficiency-daily-work-record-button.is-archive-selected-v1::before {
        content: "✓";
        display: flex;
        align-items: center;
        justify-content: center;
        border-color: #4784bd;
        background: #4784bd;
        color: white;
        font-size: 11px;
        font-weight: 900;
      }

      #${PANEL_ID}.is-archive-manage-mode-v1
      .efficiency-daily-work-record-button.is-archive-selected-v1 {
        background: #edf6ff !important;
        box-shadow: inset 0 0 0 1px #8db7dc;
      }

      #${PANEL_ID}.is-archive-manager-busy-v1 {
        cursor: progress;
      }
    `;


    document.head.append(
      style
    );
  };


  const buildUi = () => {

    const panel =
      getPanel();


    if (!panel) {
      return false;
    }


    if (
      document.getElementById(
        MANAGE_BUTTON_ID
      )
    ) {
      return true;
    }


    const heading =
      panel.querySelector(
        '.efficiency-daily-work-archive__heading'
      );


    const count =
      document.getElementById(
        COUNT_ID
      );


    if (
      !heading ||
      !count
    ) {
      return false;
    }


    const headingActions =
      document.createElement(
        'div'
      );


    headingActions.className =
      'efficiency-daily-work-archive-manager-heading-v1';


    count.parentElement
      ?.insertBefore(
        headingActions,
        count
      );


    headingActions.append(
      count
    );


    const manageButton =
      document.createElement(
        'button'
      );


    manageButton.type =
      'button';


    manageButton.id =
      MANAGE_BUTTON_ID;


    manageButton.textContent =
      '관리';


    manageButton.setAttribute(
      'aria-pressed',
      'false'
    );


    headingActions.append(
      manageButton
    );


    const toolbar =
      document.createElement(
        'div'
      );


    toolbar.id =
      TOOLBAR_ID;


    toolbar.hidden =
      true;


    const summary =
      document.createElement(
        'div'
      );


    summary.className =
      'efficiency-daily-work-archive-manager-summary-v1';


    const summaryLabel =
      document.createElement(
        'span'
      );


    summaryLabel.textContent =
      '저장자료 관리';


    const selectedCount =
      document.createElement(
        'strong'
      );


    selectedCount.id =
      SELECT_COUNT_ID;


    selectedCount.textContent =
      '0개 선택';


    summary.append(
      summaryLabel,
      selectedCount
    );


    const actions =
      document.createElement(
        'div'
      );


    actions.className =
      'efficiency-daily-work-archive-manager-actions-v1';


    const selectAllButton =
      document.createElement(
        'button'
      );


    selectAllButton.type =
      'button';


    selectAllButton.id =
      SELECT_ALL_ID;


    selectAllButton.textContent =
      '전체 선택';


    const deleteSelectedButton =
      document.createElement(
        'button'
      );


    deleteSelectedButton.type =
      'button';


    deleteSelectedButton.id =
      DELETE_SELECTED_ID;


    deleteSelectedButton.textContent =
      '선택 삭제';


    deleteSelectedButton.disabled =
      true;


    const cancelButton =
      document.createElement(
        'button'
      );


    cancelButton.type =
      'button';


    cancelButton.id =
      CANCEL_ID;


    cancelButton.textContent =
      '선택 해제';


    actions.append(
      selectAllButton,
      deleteSelectedButton,
      cancelButton
    );


    toolbar.append(
      summary,
      actions
    );


    const refreshButton =
      getRefreshButton();


    if (refreshButton) {

      refreshButton.insertAdjacentElement(
        'afterend',
        toolbar
      );

    } else {

      heading.insertAdjacentElement(
        'afterend',
        toolbar
      );
    }


    return true;
  };


  const updateToolbar = () => {

    const panel =
      getPanel();


    const manageButton =
      document.getElementById(
        MANAGE_BUTTON_ID
      );


    const toolbar =
      document.getElementById(
        TOOLBAR_ID
      );


    const selectedCount =
      document.getElementById(
        SELECT_COUNT_ID
      );


    const selectAllButton =
      document.getElementById(
        SELECT_ALL_ID
      );


    const deleteSelectedButton =
      document.getElementById(
        DELETE_SELECTED_ID
      );


    const cancelButton =
      document.getElementById(
        CANCEL_ID
      );


    const refreshButton =
      getRefreshButton();


    const records =
      getArchiveRecords();


    const validKeys =
      new Set(
        records.map(
          record =>
            getRecordKey(
              record.id,
              record.workDate
            )
        )
      );


    [
      ...selectedKeys
    ].forEach(
      key => {

        if (
          !validKeys.has(
            key
          )
        ) {
          selectedKeys.delete(
            key
          );
        }
      }
    );


    const selectedCountValue =
      selectedKeys.size;


    panel?.classList.toggle(
      'is-archive-manage-mode-v1',
      manageMode
    );


    panel?.classList.toggle(
      'is-archive-manager-busy-v1',
      busy
    );


    if (manageButton) {

      manageButton.textContent =
        manageMode
          ? '완료'
          : '관리';


      manageButton.classList.toggle(
        'is-active-v1',
        manageMode
      );


      manageButton.setAttribute(
        'aria-pressed',
        manageMode
          ? 'true'
          : 'false'
      );


      manageButton.disabled =
        busy;
    }


    if (toolbar) {
      toolbar.hidden =
        !manageMode;
    }


    if (selectedCount) {
      selectedCount.textContent =
        `${selectedCountValue}개 선택`;
    }


    if (selectAllButton) {

      const allSelected =
        records.length >
          0 &&
        selectedCountValue ===
          records.length;


      selectAllButton.textContent =
        allSelected
          ? '전체 해제'
          : '전체 선택';


      selectAllButton.disabled =
        busy ||
        records.length ===
          0;
    }


    if (deleteSelectedButton) {

      const coreBusy =
        Boolean(
          typeof efficiencyDailyWorkState ===
            'object' &&
          (
            efficiencyDailyWorkState
              ?.isLoading ||
            efficiencyDailyWorkState
              ?.isSaving
          )
        );


      deleteSelectedButton.disabled =
        busy ||
        coreBusy ||
        selectedCountValue ===
          0;


      deleteSelectedButton.textContent =
        busy
          ? '삭제 중...'
          : coreBusy
            ? '불러오는 중...'
            : (
                selectedCountValue >
                  0
                  ? `선택 삭제 (${selectedCountValue})`
                  : '선택 삭제'
              );
    }


    if (cancelButton) {

      cancelButton.disabled =
        busy ||
        selectedCountValue ===
          0;
    }


    if (refreshButton) {

      refreshButton.disabled =
        manageMode ||
        busy ||
        Boolean(
          typeof efficiencyDailyWorkState ===
            'object' &&
          (
            efficiencyDailyWorkState
              ?.isLoading ||
            efficiencyDailyWorkState
              ?.isSaving
          )
        );
    }
  };


  const decorateArchiveButtons = () => {

    const tree =
      getTree();


    if (!tree) {
      return;
    }


    tree
      .querySelectorAll(
        '.efficiency-daily-work-record-button'
      )
      .forEach(
        button => {

          const key =
            getButtonKey(
              button
            );


          const selected =
            manageMode &&
            selectedKeys.has(
              key
            );


          button.classList.toggle(
            'is-archive-selected-v1',
            selected
          );


          if (manageMode) {

            button.setAttribute(
              'aria-pressed',
              selected
                ? 'true'
                : 'false'
            );

          } else {

            button.removeAttribute(
              'aria-pressed'
            );
          }
        }
      );


    updateToolbar();
  };


  const setManageMode = value => {

    if (busy) {
      return;
    }


    manageMode =
      value ===
      true;


    if (!manageMode) {
      selectedKeys.clear();
    }


    decorateArchiveButtons();
  };


  const toggleRecordSelection = button => {

    if (
      !manageMode ||
      busy ||
      !button
    ) {
      return;
    }


    const key =
      getButtonKey(
        button
      );


    if (
      !key ||
      key ===
        '::'
    ) {
      return;
    }


    if (
      selectedKeys.has(
        key
      )
    ) {

      selectedKeys.delete(
        key
      );

    } else {

      selectedKeys.add(
        key
      );
    }


    decorateArchiveButtons();
  };


  const toggleSelectAll = () => {

    if (
      !manageMode ||
      busy
    ) {
      return;
    }


    const records =
      getArchiveRecords();


    const allSelected =
      records.length >
        0 &&
      records.every(
        record =>
          selectedKeys.has(
            getRecordKey(
              record.id,
              record.workDate
            )
          )
      );


    selectedKeys.clear();


    if (!allSelected) {

      records.forEach(
        record => {

          selectedKeys.add(
            getRecordKey(
              record.id,
              record.workDate
            )
          );
        }
      );
    }


    decorateArchiveButtons();
  };


  const showMessage = message => {

    if (
      typeof showToast ===
      'function'
    ) {

      showToast(
        message
      );

      return;
    }


    console.info(
      `[${VERSION}]`,
      message
    );
  };


  /* =======================================================
     EFFICIENCY_DAILY_WORK_ARCHIVE_MANAGER_DELETE_FIX_V2
  ======================================================= */

  /* =======================================================
     EFFICIENCY_DAILY_WORK_ARCHIVE_MANAGER_CORE_DELETE_V3

     별도 Compact Confirm 의존성을 제거한다.
     관리창에서는 기본 브라우저 확인창을 사용해
     클릭 -> 확인 -> DELETE 흐름을 명확하게 한다.
  ======================================================= */

  const confirmBulkDelete = async (
    records,
    options = {}
  ) => {

    const dates =
      records
        .map(
          record =>
            formatDate(
              record.workDate
            )
        );


    const visibleDates =
      dates
        .slice(
          0,
          5
        )
        .join(
          ', '
        );


    const extraCount =
      Math.max(
        0,
        dates.length -
          5
      );


    const dateText =
      extraCount >
        0
        ? `${visibleDates} 외 ${extraCount}건`
        : visibleDates;


    const unsavedWarning =
      options.hasActiveUnsavedChanges ===
        true
        ? (
            '\n\n현재 열어둔 기록에 저장되지 않은 수정 내용이 있습니다.' +
            '\n삭제하면 현재 수정 내용도 함께 사라집니다.'
          )
        : '';


    const message =
      (
        `선택한 ${records.length}건의 저장 기록을 삭제하시겠습니까?\n` +
        `${dateText}\n\n` +
        `삭제 후에는 복구할 수 없습니다.` +
        unsavedWarning
      );


    return window.confirm(
      message
    );
  };

  const validateDeleteResult = (
    result,
    record
  ) => {

    return (
      result?.deleted ===
        true &&
      String(
        result.recordId ||
        ''
      ).trim() ===
        String(
          record.id ||
          ''
        ).trim() &&
      String(
        result.workDate ||
        ''
      ).trim() ===
        String(
          record.workDate ||
          ''
        ).trim() &&
      Number(
        result.deletedVersion
      ) ===
        Number(
          record.version
        )
    );
  };


  const deleteArchiveRecord = async record => {

    const payload = {
      recordId:
        String(
          record.id ||
          ''
        ).trim(),

      workDate:
        String(
          record.workDate ||
          ''
        ).trim(),

      version:
        Number(
          record.version
        )
    };


    if (
      !payload.recordId ||
      !/^\d{4}-\d{2}-\d{2}$/.test(
        payload.workDate
      ) ||
      !Number.isInteger(
        payload.version
      ) ||
      payload.version <
        1
    ) {

      throw new Error(
        `${payload.workDate || '선택 기록'}의 삭제 정보가 올바르지 않습니다.`
      );
    }


    try {

      const result =
        await requestEfficiencyDailyWorkApi(
          EFFICIENCY_DAILY_WORK_API_URL,
          {
            method:
              'DELETE',

            headers:
              getEfficiencyDailyWorkApiHeaders({
                'Content-Type':
                  'application/json'
              }),

            body:
              JSON.stringify(
                payload
              )
          }
        );


      if (
        !validateDeleteResult(
          result,
          record
        )
      ) {

        throw new Error(
          `${payload.workDate} 삭제 응답이 요청 기록과 일치하지 않습니다.`
        );
      }


      return {
        ok:
          true,

        alreadyDeleted:
          false
      };

    } catch (
      error
    ) {

      const isAlreadyDeleted =
        Number(
          error?.status
        ) ===
          404 &&
        String(
          error?.result?.code ||
          ''
        ).trim() ===
          'RECORD_NOT_FOUND';


      if (
        isAlreadyDeleted
      ) {

        return {
          ok:
            true,

          alreadyDeleted:
            true
        };
      }


      throw error;
    }
  };


  const getActiveRecord = () => {

    if (
      typeof normalizeEfficiencyDailyWorkRecord !==
        'function' ||
      typeof efficiencyDailyWorkState !==
        'object'
    ) {
      return null;
    }


    return normalizeEfficiencyDailyWorkRecord(
      efficiencyDailyWorkState
        ?.activeRecord
    );
  };


  const selectedContainsActiveRecord = records => {

    const activeRecord =
      getActiveRecord();


    if (
      !activeRecord?.id ||
      !activeRecord.workDate
    ) {
      return false;
    }


    const activeKey =
      getRecordKey(
        activeRecord.id,
        activeRecord.workDate
      );


    return records.some(
      record =>
        getRecordKey(
          record.id,
          record.workDate
        ) ===
        activeKey
    );
  };


  const deleteSelectedRecords = async () => {

    if (
      !manageMode ||
      busy
    ) {
      return false;
    }


    const records =
      getSelectedRecords();


    if (
      records.length ===
      0
    ) {

      window.alert(
        '삭제할 저장 기록을 선택해주세요.'
      );

      return false;
    }


    if (
      typeof efficiencyDailyWorkState ===
        'object' &&
      (
        efficiencyDailyWorkState
          ?.isLoading ||
        efficiencyDailyWorkState
          ?.isSaving
      )
    ) {

      window.alert(
        '현재 저장 또는 조회가 진행 중입니다. 완료된 뒤 다시 삭제해주세요.'
      );

      return false;
    }


    const activeRecord =
      getActiveRecord();


    const activeKey =
      activeRecord?.id &&
      activeRecord?.workDate
        ? getRecordKey(
            activeRecord.id,
            activeRecord.workDate
          )
        : '';


    const selectedActiveRecord =
      records.find(
        record =>
          activeKey &&
          getRecordKey(
            record.id,
            record.workDate
          ) ===
            activeKey
      ) ||
      null;


    /*
     * 가장 흔한 사용:
     * 현재 열어둔 날짜 1건 선택 -> 삭제
     *
     * 이 경우 Archive Manager가 DELETE를 새로 구현하지 않고
     * 기존 일일업무현황의 검증된 단일 삭제 경로를 그대로 사용한다.
     */
    if (
      records.length ===
        1 &&
      selectedActiveRecord &&
      typeof handleEfficiencyDailyWorkDelete ===
        'function'
    ) {

      busy =
        true;


      updateToolbar();


      let deleted =
        false;


      try {

        deleted =
          Boolean(
            await handleEfficiencyDailyWorkDelete({
              preventDefault() {}
            })
          );

      } catch (
        error
      ) {

        console.error(
          'Archive Manager core delete error:',
          error
        );


        window.alert(
          error?.message ||
          '저장 기록 삭제 중 오류가 발생했습니다.'
        );

      } finally {

        busy =
          false;
      }


      if (!deleted) {

        decorateArchiveButtons();

        return false;
      }


      selectedKeys.clear();


      manageMode =
        false;


      if (
        typeof loadEfficiencyDailyWorkRecords ===
          'function'
      ) {

        await loadEfficiencyDailyWorkRecords();
      }


      decorateArchiveButtons();


      return true;
    }


    /*
     * 여러 건 또는 현재 열지 않은 저장자료:
     * Archive Manager의 version 기반 일괄삭제 사용.
     */
    const includesActiveRecord =
      Boolean(
        selectedActiveRecord
      );


    const hasActiveUnsavedChanges =
      Boolean(
        includesActiveRecord &&
        typeof refreshEfficiencyDailyWorkDirtyState ===
          'function' &&
        refreshEfficiencyDailyWorkDirtyState()
      );


    const confirmed =
      await confirmBulkDelete(
        records,
        {
          hasActiveUnsavedChanges
        }
      );


    if (!confirmed) {
      return false;
    }


    busy =
      true;


    updateToolbar();


    let successCount =
      0;


    let alreadyDeletedCount =
      0;


    const failures =
      [];


    const deletedKeys =
      new Set();


    try {

      if (
        typeof setEfficiencyDailyWorkSaving ===
          'function'
      ) {

        setEfficiencyDailyWorkSaving(
          true
        );
      }


      for (
        const record of
        records
      ) {

        try {

          const result =
            await deleteArchiveRecord(
              record
            );


          successCount +=
            1;


          if (
            result.alreadyDeleted
          ) {
            alreadyDeletedCount +=
              1;
          }


          deletedKeys.add(
            getRecordKey(
              record.id,
              record.workDate
            )
          );

        } catch (
          error
        ) {

          console.error(
            'Archive Manager bulk delete failed:',
            {
              record,
              error
            }
          );


          failures.push({
            record,
            error
          });
        }
      }

    } finally {

      if (
        typeof setEfficiencyDailyWorkSaving ===
          'function'
      ) {

        setEfficiencyDailyWorkSaving(
          false
        );
      }
    }


    /*
     * 현재 편집 중인 기록도 이번 일괄삭제에 포함됐다면
     * 기존 core의 삭제완료 화면 초기화 함수를 사용한다.
     */
    if (
      activeRecord?.id &&
      deletedKeys.has(
        activeKey
      ) &&
      typeof applyEfficiencyDailyWorkDeletedState ===
        'function'
    ) {

      applyEfficiencyDailyWorkDeletedState(
        {
          recordId:
            String(
              activeRecord.id
            ),

          workDate:
            String(
              activeRecord.workDate
            ),

          version:
            Number(
              activeRecord.version
            )
        },

        '선택한 저장 기록을 삭제했습니다.'
      );
    }


    if (
      activeRecord?.id &&
      deletedKeys.has(
        activeKey
      ) &&
      typeof window
        .commitEfficiencyDailyWorkStructuralEdits ===
        'function'
    ) {

      window
        .commitEfficiencyDailyWorkStructuralEdits(
          activeRecord.workDate
        );
    }


    selectedKeys.clear();


    manageMode =
      false;


    if (
      typeof loadEfficiencyDailyWorkRecords ===
        'function'
    ) {

      await loadEfficiencyDailyWorkRecords();
    }


    busy =
      false;


    decorateArchiveButtons();


    if (
      failures.length ===
      0
    ) {

      const suffix =
        alreadyDeletedCount >
          0
          ? ` · 이미 삭제됨 ${alreadyDeletedCount}건`
          : '';


      window.alert(
        `${successCount}건의 저장 기록을 삭제했습니다${suffix}.`
      );


      return true;
    }


    const firstFailure =
      failures[0]
        ?.error;


    window.alert(
      (
        `${successCount}건 삭제 완료 / ` +
        `${failures.length}건 삭제 실패\n\n` +
        (
          firstFailure?.message ||
          firstFailure?.result?.message ||
          '실패한 기록은 서버 상태를 확인해주세요.'
        )
      )
    );


    return (
      successCount >
      0
    );
  };

  const bindEvents = () => {

    const tree =
      getTree();


    const manageButton =
      document.getElementById(
        MANAGE_BUTTON_ID
      );


    const selectAllButton =
      document.getElementById(
        SELECT_ALL_ID
      );


    const deleteSelectedButton =
      document.getElementById(
        DELETE_SELECTED_ID
      );


    const cancelButton =
      document.getElementById(
        CANCEL_ID
      );


    manageButton
      ?.addEventListener(
        'click',
        () => {

          setManageMode(
            !manageMode
          );
        }
      );


    selectAllButton
      ?.addEventListener(
        'click',
        toggleSelectAll
      );


    deleteSelectedButton
      ?.addEventListener(
        'click',
        event => {

          event.preventDefault();
          event.stopPropagation();


          void deleteSelectedRecords();
        },
        true
      );


    cancelButton
      ?.addEventListener(
        'click',
        () => {

          if (busy) {
            return;
          }


          selectedKeys.clear();


          decorateArchiveButtons();
        }
      );


    /*
     * 관리 모드에서는 날짜 버튼의 기존
     * "기록 열기" 동작보다 선택 토글을 우선한다.
     */
    tree
      ?.addEventListener(
        'click',
        event => {

          if (
            !manageMode ||
            busy
          ) {
            return;
          }


          const target =
            event.target instanceof
              Element
              ? event.target
              : null;


          const button =
            target?.closest(
              '.efficiency-daily-work-record-button'
            );


          if (!button) {
            return;
          }


          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();


          toggleRecordSelection(
            button
          );
        },
        true
      );
  };


  const patchArchiveRenderer = () => {

    if (
      typeof renderEfficiencyDailyWorkArchive !==
        'function'
    ) {
      return false;
    }


    if (
      originalArchiveRenderer
    ) {
      return true;
    }


    originalArchiveRenderer =
      renderEfficiencyDailyWorkArchive;


    renderEfficiencyDailyWorkArchive =
      function renderEfficiencyDailyWorkArchiveWithManagerV1() {

        const result =
          originalArchiveRenderer
            .apply(
              this,
              arguments
            );


        decorateArchiveButtons();


        return result;
      };


    return true;
  };


  const initialize = () => {

    installStyle();


    if (
      !buildUi()
    ) {

      console.warn(
        `[${VERSION}] archive UI not found`
      );

      return false;
    }


    if (
      !patchArchiveRenderer()
    ) {

      console.warn(
        `[${VERSION}] archive renderer not found`
      );

      return false;
    }


    bindEvents();


    decorateArchiveButtons();


    console.info(
      `[${VERSION}] ready`
    );


    return true;
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
  /* =======================================================
     EFFICIENCY_DAILY_WORK_ARCHIVE_DAY_FONT_V1
     왼쪽 보관함의 일자 숫자(예: 20일)만 더 크게 표시
  ======================================================= */

  const applyEfficiencyDailyWorkArchiveDayFontSize = () => {

    try {

      const candidates =
        document.querySelectorAll(
          'button, span, div'
        );


      candidates.forEach(
        element => {

          if (!element) {
            return;
          }

          if (element.children.length > 0) {
            return;
          }

          const text =
            String(
              element.textContent ||
              ''
            ).trim();

          if (!/^\d{1,2}일$/.test(text)) {
            return;
          }

          if (
            element.closest('table') ||
            element.closest('.daily-work-sheet') ||
            element.closest('.daily-work-page') ||
            element.closest('.efficiency-daily-work-document')
          ) {
            return;
          }

          element.style.fontSize   = '16px';
          element.style.fontWeight = '700';
          element.style.lineHeight = '1.2';
        }
      );

    } catch (error) {

      console.error(
        'Archive day font apply error:',
        error
      );
    }
  };


  const queueApplyEfficiencyDailyWorkArchiveDayFontSize = () => {

    window.requestAnimationFrame(
      () => {
        window.requestAnimationFrame(
          applyEfficiencyDailyWorkArchiveDayFontSize
        );
      }
    );
  };


  if (document.readyState === 'loading') {

    document.addEventListener(
      'DOMContentLoaded',
      queueApplyEfficiencyDailyWorkArchiveDayFontSize,
      { once: true }
    );

  } else {

    queueApplyEfficiencyDailyWorkArchiveDayFontSize();
  }


  window.addEventListener(
    'load',
    queueApplyEfficiencyDailyWorkArchiveDayFontSize,
    { once: true }
  );

  document.addEventListener(
    'click',
    queueApplyEfficiencyDailyWorkArchiveDayFontSize,
    true
  );

  document.addEventListener(
    'change',
    queueApplyEfficiencyDailyWorkArchiveDayFontSize,
    true
  );

})();