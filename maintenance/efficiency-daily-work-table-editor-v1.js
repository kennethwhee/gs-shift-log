(() => {
  'use strict';

  const VERSION =
    'EFFICIENCY_DAILY_WORK_TABLE_EDITOR_V1';

  const WINDOW_PARAM =
    'efficiencyDailyWorkWindow';

  const STORAGE_PREFIX =
    'gs-efficiency-daily-work-table-layout-v1:';

  if (window.__gsEfficiencyDailyWorkTableEditorV1) {
    return;
  }

  window.__gsEfficiencyDailyWorkTableEditorV1 = true;

  const createEmptyLayout = () => ({
    version: 1,
    rowHeights: {},
    hiddenRows: [],
    columnWidths: [],
    hiddenColumns: []
  });

  let currentLayout =
    createEmptyLayout();

  let editMode = false;
  let selectedCell = null;
  let selectedRowKey = '';
  let selectedColumn = -1;

  const isChildWindow = () => {
    try {
      return (
        new URL(window.location.href)
          .searchParams
          .get(WINDOW_PARAM) === '1'
      );
    } catch {
      return false;
    }
  };

  const parseObject = (value) => {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      return value;
    }

    if (
      typeof value !== 'string' ||
      !value.trim()
    ) {
      return null;
    }

    try {
      const parsed = JSON.parse(value);

      return (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
      )
        ? parsed
        : null;
    } catch {
      return null;
    }
  };

  const normalizeLayout = (value) => {
    const source =
      parseObject(value) || {};

    const rowHeights = {};

    if (
      source.rowHeights &&
      typeof source.rowHeights === 'object' &&
      !Array.isArray(source.rowHeights)
    ) {
      Object.entries(source.rowHeights)
        .forEach(([key, rawValue]) => {
          const height = Number(rawValue);

          if (
            /^[a-z0-9-]+$/i.test(key) &&
            Number.isFinite(height)
          ) {
            rowHeights[key] =
              Math.max(
                28,
                Math.min(
                  320,
                  Math.round(height)
                )
              );
          }
        });
    }

    const hiddenRows =
      Array.isArray(source.hiddenRows)
        ? [
            ...new Set(
              source.hiddenRows
                .map(value => String(value || '').trim())
                .filter(value =>
                  /^[a-z0-9-]+$/i.test(value)
                )
            )
          ]
        : [];

    const columnWidths =
      Array.isArray(source.columnWidths)
        ? source.columnWidths
            .map(Number)
            .filter(value =>
              Number.isFinite(value) &&
              value > 0
            )
        : [];

    const hiddenColumns =
      Array.isArray(source.hiddenColumns)
        ? [
            ...new Set(
              source.hiddenColumns
                .map(Number)
                .filter(value =>
                  Number.isInteger(value) &&
                  value >= 0 &&
                  value <= 20
                )
            )
          ]
        : [];

    return {
      version: 1,
      rowHeights,
      hiddenRows,
      columnWidths,
      hiddenColumns
    };
  };

  const cloneLayout = () =>
    normalizeLayout(
      JSON.parse(
        JSON.stringify(currentLayout)
      )
    );

  const getDateValue = () =>
    String(
      document.getElementById(
        'efficiencyDailyWorkDate'
      )?.value || ''
    ).trim();

  const getStorageKey = (dateValue) =>
    `${STORAGE_PREFIX}${dateValue || 'unknown'}`;

  const saveLocalLayout = () => {
    const dateValue =
      getDateValue();

    if (!dateValue) {
      return;
    }

    try {
      localStorage.setItem(
        getStorageKey(dateValue),
        JSON.stringify(currentLayout)
      );
    } catch (_) {
      // Local backup failure must not block editing.
    }
  };

  const loadLocalLayout = (dateValue) => {
    if (!dateValue) {
      return null;
    }

    try {
      const value =
        localStorage.getItem(
          getStorageKey(dateValue)
        );

      return value
        ? normalizeLayout(value)
        : null;
    } catch {
      return null;
    }
  };

  const extractLayoutFromRecord = (record) => {
    const source =
      parseObject(record);

    if (!source) {
      return null;
    }

    const candidates = [
      source,
      parseObject(source.content),
      parseObject(source.contentJson),
      parseObject(source.content_json),
      parseObject(source.payload),
      parseObject(source.payloadJson),
      parseObject(source.payload_json),
      parseObject(source.formData),
      parseObject(source.form_data),
      parseObject(source.data)
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (candidate.tableLayout) {
        return normalizeLayout(
          candidate.tableLayout
        );
      }
    }

    return null;
  };

  const getPaper = () =>
    document.getElementById(
      'efficiencyDailyWorkPaper'
    );

  const getTable = () =>
    getPaper()?.querySelector(
      '.efficiency-daily-work-table'
    ) || null;

  const getColumnCount = (table) => {
    if (!table) {
      return 0;
    }

    let maximum = 0;

    table.querySelectorAll('tr')
      .forEach(row => {
        const count = [
          ...row.children
        ]
          .filter(cell =>
            cell.matches?.('th, td')
          )
          .reduce(
            (sum, cell) =>
              sum +
              Math.max(
                1,
                Number(cell.colSpan) || 1
              ),
            0
          );

        maximum =
          Math.max(maximum, count);
      });

    return maximum;
  };

  const ensureColGroup = (
    table,
    columnCount
  ) => {
    if (
      !table ||
      columnCount < 1
    ) {
      return null;
    }

    let group =
      table.querySelector(
        'colgroup[data-efficiency-table-layout-cols="1"]'
      );

    if (!group) {
      const existing =
        table.querySelector('colgroup');

      group =
        existing ||
        document.createElement('colgroup');

      group.setAttribute(
        'data-efficiency-table-layout-cols',
        '1'
      );

      if (!existing) {
        table.insertBefore(
          group,
          table.firstChild
        );
      }
    }

    while (
      group.children.length <
      columnCount
    ) {
      group.append(
        document.createElement('col')
      );
    }

    return group;
  };

  const measureColumnWidths = (
    table,
    columnCount
  ) => {
    if (
      !table ||
      columnCount < 1
    ) {
      return [];
    }

    const rows = [
      ...table.querySelectorAll('tr')
    ];

    let preferredRow = null;

    for (const row of rows) {
      const cells = [
        ...row.children
      ].filter(cell =>
        cell.matches?.('th, td')
      );

      const logicalCount =
        cells.reduce(
          (sum, cell) =>
            sum +
            Math.max(
              1,
              Number(cell.colSpan) || 1
            ),
          0
        );

      if (
        logicalCount === columnCount &&
        cells.every(
          cell =>
            (Number(cell.colSpan) || 1) === 1
        )
      ) {
        preferredRow = row;
        break;
      }
    }

    if (!preferredRow) {
      return Array.from(
        { length: columnCount },
        () => 100 / columnCount
      );
    }

    const cells = [
      ...preferredRow.children
    ].filter(cell =>
      cell.matches?.('th, td')
    );

    const widths =
      cells.map(
        cell =>
          cell.getBoundingClientRect().width
      );

    const total =
      widths.reduce(
        (sum, width) =>
          sum + width,
        0
      );

    if (total <= 0) {
      return Array.from(
        { length: columnCount },
        () => 100 / columnCount
      );
    }

    return widths.map(
      width =>
        (width / total) * 100
    );
  };

  const getEffectiveColumnWidths = (
    table,
    columnCount
  ) => {
    if (
      currentLayout.columnWidths.length ===
      columnCount
    ) {
      return [
        ...currentLayout.columnWidths
      ];
    }

    return measureColumnWidths(
      table,
      columnCount
    );
  };

  const getColumnIndexFromCell = (
    table,
    cell
  ) => {
    const columnCount =
      getColumnCount(table);

    if (
      columnCount < 1 ||
      !cell
    ) {
      return -1;
    }

    const targetRect =
      cell.getBoundingClientRect();

    const x =
      targetRect.left +
      targetRect.width / 2;

    const candidateRows = [
      ...table.querySelectorAll('tr')
    ];

    for (const row of candidateRows) {
      const cells = [
        ...row.children
      ].filter(item =>
        item.matches?.('th, td')
      );

      const logicalCount =
        cells.reduce(
          (sum, item) =>
            sum +
            Math.max(
              1,
              Number(item.colSpan) || 1
            ),
          0
        );

      if (
        logicalCount !== columnCount
      ) {
        continue;
      }

      let logicalIndex = 0;

      for (const item of cells) {
        const span =
          Math.max(
            1,
            Number(item.colSpan) || 1
          );

        const rect =
          item.getBoundingClientRect();

        if (
          x >= rect.left - 1 &&
          x <= rect.right + 1
        ) {
          if (
            span === 1 ||
            rect.width <= 0
          ) {
            return logicalIndex;
          }

          const relative =
            Math.max(
              0,
              Math.min(
                0.9999,
                (x - rect.left) /
                  rect.width
              )
            );

          return Math.min(
            columnCount - 1,
            logicalIndex +
              Math.floor(
                relative * span
              )
          );
        }

        logicalIndex += span;
      }
    }

    const tableRect =
      table.getBoundingClientRect();

    if (tableRect.width <= 0) {
      return -1;
    }

    return Math.max(
      0,
      Math.min(
        columnCount - 1,
        Math.floor(
          (
            (x - tableRect.left) /
            tableRect.width
          ) * columnCount
        )
      )
    );
  };

  const ensureLayoutStyle = () => {
    let style =
      document.getElementById(
        'efficiencyDailyWorkTableLayoutStyleV1'
      );

    if (!style) {
      style =
        document.createElement('style');

      style.id =
        'efficiencyDailyWorkTableLayoutStyleV1';

      document.head.append(style);
    }

    return style;
  };

  const buildLayoutCss = (
    columnCount
  ) => {
    const rules = [];

    rules.push(`
      #efficiencyDailyWorkPaper
      .efficiency-daily-work-table
      [data-efficiency-layout-selected="1"] {
        outline: 3px solid #2877d4 !important;
        outline-offset: -3px !important;
        background-color: rgba(40,119,212,.10) !important;
      }
    `);

    if (
      currentLayout.columnWidths.length ===
      columnCount
    ) {
      rules.push(`
        #efficiencyDailyWorkPaper
        .efficiency-daily-work-table {
          table-layout: fixed !important;
          width: 100% !important;
        }
      `);

      currentLayout.columnWidths
        .forEach((width, index) => {
          rules.push(`
            #efficiencyDailyWorkPaper
            .efficiency-daily-work-table
            colgroup[data-efficiency-table-layout-cols="1"]
            col:nth-child(${index + 1}) {
              width: ${width}% !important;
            }
          `);
        });
    }

    currentLayout.hiddenColumns
      .forEach(index => {
        rules.push(`
          #efficiencyDailyWorkPaper
          .efficiency-daily-work-table
          colgroup[data-efficiency-table-layout-cols="1"]
          col:nth-child(${index + 1}) {
            visibility: collapse !important;
            width: 0 !important;
          }
        `);
      });

    currentLayout.hiddenRows
      .forEach(rowKey => {
        rules.push(`
          #efficiencyDailyWorkPaper
          .efficiency-daily-work-table
          [data-efficiency-daily-work-row-key="${rowKey}"] {
            display: none !important;
          }
        `);
      });

    Object.entries(
      currentLayout.rowHeights
    ).forEach(([rowKey, height]) => {
      const controlHeight =
        Math.max(
          22,
          Number(height) - 6
        );

      rules.push(`
        #efficiencyDailyWorkPaper
        .efficiency-daily-work-table
        [data-efficiency-daily-work-row-key="${rowKey}"] {
          height: ${height}px !important;
          min-height: ${height}px !important;
        }

        #efficiencyDailyWorkPaper
        .efficiency-daily-work-table
        [data-efficiency-daily-work-row-key="${rowKey}"] > td {
          height: ${height}px !important;
        }

        #efficiencyDailyWorkPaper
        .efficiency-daily-work-table
        [data-efficiency-daily-work-row-key="${rowKey}"]
        textarea,
        #efficiencyDailyWorkPaper
        .efficiency-daily-work-table
        [data-efficiency-daily-work-row-key="${rowKey}"]
        .efficiency-daily-work-static-control {
          height: ${controlHeight}px !important;
          min-height: 0 !important;
          max-height: none !important;
        }
      `);
    });

    return rules.join('\n');
  };

  const clearSelection = () => {
    if (selectedCell) {
      selectedCell.removeAttribute(
        'data-efficiency-layout-selected'
      );
    }

    selectedCell = null;
    selectedRowKey = '';
    selectedColumn = -1;

    updatePanel();
  };

  const applyLayout = () => {
    const table =
      getTable();

    if (!table) {
      return false;
    }

    const columnCount =
      getColumnCount(table);

    ensureColGroup(
      table,
      columnCount
    );

    const style =
      ensureLayoutStyle();

    style.textContent =
      buildLayoutCss(
        columnCount
      );

    table.setAttribute(
      'data-efficiency-table-layout-editable',
      '1'
    );

    if (
      selectedRowKey &&
      currentLayout.hiddenRows.includes(
        selectedRowKey
      )
    ) {
      clearSelection();
    }

    return true;
  };

  const markLayoutChanged = () => {
    currentLayout =
      normalizeLayout(currentLayout);

    applyLayout();
    saveLocalLayout();

    try {
      if (
        typeof window
          .refreshEfficiencyDailyWorkDirtyState ===
        'function'
      ) {
        window
          .refreshEfficiencyDailyWorkDirtyState();
      }
    } catch (_) {
      // Dirty-state failure must not break layout editing.
    }

    updatePanel();
  };

  const setCurrentLayout = (
    layout,
    dateValue
  ) => {
    currentLayout =
      normalizeLayout(
        layout ||
        loadLocalLayout(dateValue) ||
        createEmptyLayout()
      );

    clearSelection();

    window.setTimeout(
      applyLayout,
      0
    );
  };

  const wrapFunction = (
    name,
    factory
  ) => {
    const original =
      window[name];

    if (
      typeof original !== 'function' ||
      original.__efficiencyTableEditorV1
    ) {
      return false;
    }

    const wrapped =
      factory(original);

    wrapped.__efficiencyTableEditorV1 =
      true;

    wrapped.__efficiencyTableEditorOriginal =
      original;

    window[name] =
      wrapped;

    return true;
  };

  const installPersistenceHooks = () => {
    const required = [
      'normalizeEfficiencyDailyWorkRecord',
      'collectEfficiencyDailyWorkEditorData',
      'buildEfficiencyDailyWorkSavePayload',
      'getEfficiencyDailyWorkComparableContent',
      'populateEfficiencyDailyWorkEditorFromRecord',
      'initializeEfficiencyDailyWorkNewRecord'
    ];

    if (
      required.some(
        name =>
          typeof window[name] !==
          'function'
      )
    ) {
      return false;
    }

    wrapFunction(
      'normalizeEfficiencyDailyWorkRecord',
      original =>
        function(record) {
          const normalized =
            original.apply(
              this,
              arguments
            );

          if (
            normalized &&
            typeof normalized === 'object'
          ) {
            const dateValue =
              String(
                normalized.workDate || ''
              ).trim();

            normalized.tableLayout =
              extractLayoutFromRecord(
                record
              ) ||
              loadLocalLayout(
                dateValue
              ) ||
              createEmptyLayout();
          }

          return normalized;
        }
    );

    wrapFunction(
      'collectEfficiencyDailyWorkEditorData',
      original =>
        function() {
          const data =
            original.apply(
              this,
              arguments
            );

          if (
            !data ||
            typeof data !== 'object'
          ) {
            return data;
          }

          return {
            ...data,
            tableLayout:
              cloneLayout()
          };
        }
    );

    wrapFunction(
      'buildEfficiencyDailyWorkSavePayload',
      original =>
        function(sourceData) {
          const payload =
            original.apply(
              this,
              arguments
            );

          if (
            payload &&
            typeof payload === 'object'
          ) {
            if (
              !payload.content ||
              typeof payload.content !==
                'object' ||
              Array.isArray(
                payload.content
              )
            ) {
              payload.content = {};
            }

            payload.content.tableLayout =
              normalizeLayout(
                sourceData?.tableLayout ||
                currentLayout
              );
          }

          saveLocalLayout();

          return payload;
        }
    );

    wrapFunction(
      'getEfficiencyDailyWorkComparableContent',
      original =>
        function(sourceData) {
          const comparable =
            original.apply(
              this,
              arguments
            );

          if (
            !comparable ||
            typeof comparable !==
              'object'
          ) {
            return comparable;
          }

          return {
            ...comparable,
            tableLayout:
              normalizeLayout(
                sourceData?.tableLayout ||
                extractLayoutFromRecord(
                  sourceData
                ) ||
                currentLayout
              )
          };
        }
    );

    wrapFunction(
      'populateEfficiencyDailyWorkEditorFromRecord',
      original =>
        function(record) {
          const recordLayout =
            extractLayoutFromRecord(
              record
            );

          const result =
            original.apply(
              this,
              arguments
            );

          const dateValue =
            String(
              result?.workDate ||
              record?.workDate ||
              record?.work_date ||
              getDateValue() ||
              ''
            ).slice(0, 10);

          setCurrentLayout(
            recordLayout ||
            result?.tableLayout ||
            loadLocalLayout(
              dateValue
            ),
            dateValue
          );

          return result;
        }
    );

    wrapFunction(
      'initializeEfficiencyDailyWorkNewRecord',
      original =>
        function(dateValue) {
          const result =
            original.apply(
              this,
              arguments
            );

          const resolvedDate =
            String(
              result ||
              dateValue ||
              getDateValue() ||
              ''
            ).slice(0, 10);

          setCurrentLayout(
            loadLocalLayout(
              resolvedDate
            ) ||
            createEmptyLayout(),
            resolvedDate
          );

          return result;
        }
    );

    return true;
  };

  const createButton = (
    label,
    handler
  ) => {
    const button =
      document.createElement('button');

    button.type = 'button';
    button.textContent = label;

    button.className =
      'efficiency-table-editor-button';

    button.addEventListener(
      'click',
      handler
    );

    return button;
  };

  let editorButton = null;
  let panel = null;
  let selectedLabel = null;

  let hideRowButton = null;
  let rowMinusButton = null;
  let rowPlusButton = null;
  let hideColumnButton = null;
  let columnMinusButton = null;
  let columnPlusButton = null;

  const updatePanel = () => {
    if (!panel) {
      return;
    }

    panel.hidden =
      !editMode;

    if (editorButton) {
      editorButton.textContent =
        editMode
          ? '표 편집 종료'
          : '표 편집';

      editorButton.classList.toggle(
        'is-active',
        editMode
      );
    }

    if (selectedLabel) {
      const rowText =
        selectedRowKey
          ? selectedRowKey
          : '행 선택 없음';

      const columnText =
        selectedColumn >= 0
          ? `${selectedColumn + 1}열`
          : '열 선택 없음';

      selectedLabel.textContent =
        `선택: ${rowText} / ${columnText}`;
    }

    const hasRow =
      Boolean(selectedRowKey);

    const hasColumn =
      selectedColumn >= 0;

    [
      hideRowButton,
      rowMinusButton,
      rowPlusButton
    ].forEach(button => {
      if (button) {
        button.disabled =
          !hasRow;
      }
    });

    [
      hideColumnButton,
      columnMinusButton,
      columnPlusButton
    ].forEach(button => {
      if (button) {
        button.disabled =
          !hasColumn;
      }
    });
  };

  const selectCell = (
    table,
    cell
  ) => {
    clearSelection();

    selectedCell = cell;

    selectedCell.setAttribute(
      'data-efficiency-layout-selected',
      '1'
    );

    const row =
      cell.closest(
        '[data-efficiency-daily-work-row-key]'
      );

    selectedRowKey =
      String(
        row?.dataset
          ?.efficiencyDailyWorkRowKey ||
        ''
      ).trim();

    selectedColumn =
      getColumnIndexFromCell(
        table,
        cell
      );

    updatePanel();
  };

  const changeSelectedRowHeight = (
    delta
  ) => {
    if (!selectedRowKey) {
      return;
    }

    const row =
      getTable()?.querySelector(
        `[data-efficiency-daily-work-row-key="${selectedRowKey}"]`
      );

    const existing =
      Number(
        currentLayout
          .rowHeights[
            selectedRowKey
          ]
      );

    const base =
      Number.isFinite(existing) &&
      existing > 0
        ? existing
        : Math.round(
            row
              ?.getBoundingClientRect()
              .height ||
            52
          );

    currentLayout
      .rowHeights[
        selectedRowKey
      ] =
      Math.max(
        28,
        Math.min(
          320,
          base + delta
        )
      );

    markLayoutChanged();
  };

  const adjustSelectedColumn = (
    delta
  ) => {
    const table =
      getTable();

    if (
      !table ||
      selectedColumn < 0
    ) {
      return;
    }

    const columnCount =
      getColumnCount(table);

    if (
      selectedColumn >=
      columnCount
    ) {
      return;
    }

    const widths =
      getEffectiveColumnWidths(
        table,
        columnCount
      );

    if (
      widths.length !==
      columnCount
    ) {
      return;
    }

    let partner =
      selectedColumn <
      columnCount - 1
        ? selectedColumn + 1
        : selectedColumn - 1;

    if (partner < 0) {
      return;
    }

    const minimum = 3;

    const actualDelta =
      delta > 0
        ? Math.min(
            delta,
            Math.max(
              0,
              widths[partner] -
              minimum
            )
          )
        : -Math.min(
            Math.abs(delta),
            Math.max(
              0,
              widths[selectedColumn] -
              minimum
            )
          );

    widths[selectedColumn] +=
      actualDelta;

    widths[partner] -=
      actualDelta;

    currentLayout.columnWidths =
      widths.map(value =>
        Math.round(value * 100) /
        100
      );

    markLayoutChanged();
  };

  const installToolbar = () => {
    if (
      document.getElementById(
        'efficiencyDailyWorkTableEditorButtonV1'
      )
    ) {
      return true;
    }

    const actions =
      document.querySelector(
        '#efficiencyDailyWorkView .efficiency-daily-work-heading-actions'
      ) ||
      document.querySelector(
        '.efficiency-daily-work-heading-actions'
      );

    const table =
      getTable();

    if (
      !actions ||
      !table
    ) {
      return false;
    }

    const style =
      document.createElement('style');

    style.id =
      'efficiencyDailyWorkTableEditorUiStyleV1';

    style.textContent = `
      #efficiencyDailyWorkTableEditorButtonV1 {
        border-color: #7ba9dd !important;
      }

      #efficiencyDailyWorkTableEditorButtonV1.is-active {
        border-color: #175fae !important;
        background: #175fae !important;
        color: #fff !important;
      }

      #efficiencyDailyWorkTableEditorPanelV1 {
        position: fixed;
        top: 82px;
        right: 24px;
        z-index: 2147483646;
        width: 360px;
        padding: 10px;
        border: 1px solid #b9c9da;
        border-radius: 10px;
        background: rgba(255,255,255,.98);
        box-shadow: 0 10px 30px rgba(21,40,65,.18);
      }

      #efficiencyDailyWorkTableEditorPanelV1[hidden] {
        display: none !important;
      }

      #efficiencyDailyWorkTableEditorPanelV1
      .efficiency-table-editor-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
        font-size: 12px;
        font-weight: 900;
        color: #1e3855;
      }

      #efficiencyDailyWorkTableEditorPanelV1
      .efficiency-table-editor-selected {
        margin-bottom: 8px;
        padding: 6px 8px;
        border-radius: 6px;
        background: #eef5fd;
        color: #31506f;
        font-size: 10px;
        font-weight: 800;
      }

      #efficiencyDailyWorkTableEditorPanelV1
      .efficiency-table-editor-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 6px;
      }

      #efficiencyDailyWorkTableEditorPanelV1
      .efficiency-table-editor-button {
        min-height: 32px;
        padding: 5px 7px;
        border: 1px solid #c5d2df;
        border-radius: 7px;
        background: #fff;
        color: #29435f;
        font-size: 10px;
        font-weight: 800;
        cursor: pointer;
      }

      #efficiencyDailyWorkTableEditorPanelV1
      .efficiency-table-editor-button:hover:not(:disabled) {
        border-color: #6194ce;
        background: #f1f7fe;
      }

      #efficiencyDailyWorkTableEditorPanelV1
      .efficiency-table-editor-button:disabled {
        cursor: not-allowed;
        opacity: .42;
      }

      #efficiencyDailyWorkTableEditorPanelV1
      .is-danger {
        border-color: #e2b2b2;
        color: #a84343;
      }

      #efficiencyDailyWorkTableEditorPanelV1
      .is-wide {
        grid-column: span 3;
      }

      html[data-efficiency-daily-work-window="1"]
      #efficiencyDailyWorkPaper
      .efficiency-daily-work-table
      [data-efficiency-daily-work-row-key] {
        transition: background-color .12s ease;
      }
    `;

    document.head.append(style);

    editorButton =
      createButton(
        '표 편집',
        () => {
          editMode =
            !editMode;

          if (!editMode) {
            clearSelection();
          }

          updatePanel();
        }
      );

    editorButton.id =
      'efficiencyDailyWorkTableEditorButtonV1';

    actions.prepend(
      editorButton
    );

    panel =
      document.createElement('div');

    panel.id =
      'efficiencyDailyWorkTableEditorPanelV1';

    panel.hidden = true;

    const title =
      document.createElement('div');

    title.className =
      'efficiency-table-editor-title';

    title.textContent =
      '표 배치 편집';

    selectedLabel =
      document.createElement('div');

    selectedLabel.className =
      'efficiency-table-editor-selected';

    const grid =
      document.createElement('div');

    grid.className =
      'efficiency-table-editor-grid';

    hideRowButton =
      createButton(
        '행 숨김',
        () => {
          if (!selectedRowKey) {
            return;
          }

          currentLayout.hiddenRows = [
            ...new Set([
              ...currentLayout.hiddenRows,
              selectedRowKey
            ])
          ];

          clearSelection();
          markLayoutChanged();
        }
      );

    rowMinusButton =
      createButton(
        '행 높이 −',
        () =>
          changeSelectedRowHeight(-12)
      );

    rowPlusButton =
      createButton(
        '행 높이 +',
        () =>
          changeSelectedRowHeight(12)
      );

    hideColumnButton =
      createButton(
        '열 숨김',
        () => {
          if (
            selectedColumn < 0
          ) {
            return;
          }

          currentLayout.hiddenColumns = [
            ...new Set([
              ...currentLayout.hiddenColumns,
              selectedColumn
            ])
          ];

          clearSelection();
          markLayoutChanged();
        }
      );

    columnMinusButton =
      createButton(
        '열 좁게',
        () =>
          adjustSelectedColumn(-3)
      );

    columnPlusButton =
      createButton(
        '열 넓게',
        () =>
          adjustSelectedColumn(3)
      );

    const restoreHiddenButton =
      createButton(
        '숨김 모두 복원',
        () => {
          currentLayout.hiddenRows = [];
          currentLayout.hiddenColumns = [];

          markLayoutChanged();
        }
      );

    restoreHiddenButton.classList.add(
      'is-wide'
    );

    const resetButton =
      createButton(
        '기본 표 배치로 복원',
        () => {
          const confirmed =
            window.confirm(
              '표 배치만 기본값으로 복원합니다.\n입력한 업무 내용은 삭제되지 않습니다.'
            );

          if (!confirmed) {
            return;
          }

          currentLayout =
            createEmptyLayout();

          clearSelection();
          markLayoutChanged();
        }
      );

    resetButton.classList.add(
      'is-wide',
      'is-danger'
    );

    grid.append(
      hideRowButton,
      rowMinusButton,
      rowPlusButton,
      hideColumnButton,
      columnMinusButton,
      columnPlusButton,
      restoreHiddenButton,
      resetButton
    );

    panel.append(
      title,
      selectedLabel,
      grid
    );

    document.body.append(
      panel
    );

    table.addEventListener(
      'click',
      event => {
        if (!editMode) {
          return;
        }

        const cell =
          event.target instanceof Element
            ? event.target.closest(
                'td, th'
              )
            : null;

        if (
          !cell ||
          !table.contains(cell)
        ) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        selectCell(
          table,
          cell
        );
      },
      true
    );

    updatePanel();

    const initialDate =
      getDateValue();

    currentLayout =
      loadLocalLayout(
        initialDate
      ) ||
      currentLayout;

    applyLayout();

    return true;
  };

  const initialize = () => {
    if (!isChildWindow()) {
      return;
    }

    let hookAttempts = 0;

    const hookTimer =
      window.setInterval(
        () => {
          hookAttempts += 1;

          if (
            installPersistenceHooks() ||
            hookAttempts >= 120
          ) {
            window.clearInterval(
              hookTimer
            );
          }
        },
        100
      );

    let uiAttempts = 0;

    const uiTimer =
      window.setInterval(
        () => {
          uiAttempts += 1;

          if (
            installToolbar() ||
            uiAttempts >= 180
          ) {
            window.clearInterval(
              uiTimer
            );
          }
        },
        100
      );

    const observer =
      new MutationObserver(
        () => {
          if (
            !document.getElementById(
              'efficiencyDailyWorkTableEditorButtonV1'
            )
          ) {
            installToolbar();
          }

          applyLayout();
        }
      );

    observer.observe(
      document.documentElement,
      {
        childList: true,
        subtree: true
      }
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
      { once: true }
    );
  } else {
    initialize();
  }
})();