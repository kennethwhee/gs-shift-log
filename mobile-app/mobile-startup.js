/* MOBILE-APP-STARTUP-V12
   Preserves V11 selected-date and legacy rules while fixing
   authentication routing and startup timing. */

"use strict";

(() => {
  if (
    window.__mobilePostCutoverLegacySkipV11Installed ===
      true
  ) {
    return;
  }

  window.__mobilePostCutoverLegacySkipV11Installed =
    true;

  if (
    typeof loadLogs !==
      "function" ||
    typeof loadLegacyLogsForSelectedDate !==
      "function" ||
    typeof loadSharedShiftLogsFromServer !==
      "function"
  ) {
    console.error(
      "[Mobile V11] required startup functions are unavailable."
    );

    return;
  }

  const LEGACY_READONLY_CUTOFF =
    "2026-07-21";

  const originalLoadLogs =
    loadLogs;

  const originalLoadSharedShiftLogsFromServer =
    loadSharedShiftLogsFromServer;

  const rawLegacyLoader =
    typeof loadLegacyLogsForSelectedDateBeforeEditableMigration ===
      "function"
      ? loadLegacyLogsForSelectedDateBeforeEditableMigration
      : loadLegacyLogsForSelectedDate;

  let initialLoadIntercepted =
    false;

  let initialLegacyIntercepted =
    false;

  let backgroundStarted =
    false;

  let statusTimerId =
    0;

  const state = {
    stage:
      "installed",

    selectedDate:
      "",

    sharedCount:
      0,

    legacySkipped:
      false,

    legacyCount:
      0,

    sharedError:
      "",

    legacyError:
      "",

    startedAt:
      Date.now(),

    completedAt:
      0
  };

  window.__mobilePostCutoverLegacySkipV11State =
    state;


  function getSelectedDateIso() {
    try {
      if (
        typeof formatInputDate ===
          "function" &&
        appState &&
        appState.selectedDate
      ) {
        const value =
          String(
            formatInputDate(
              appState.selectedDate
            ) ||
            ""
          ).trim();

        if (
          /^\d{4}-\d{2}-\d{2}$/.test(
            value
          )
        ) {
          return value;
        }
      }

    } catch {
      // Continue to local-date fallback.
    }

    const now =
      new Date();

    return [
      now.getFullYear(),

      String(
        now.getMonth() +
        1
      ).padStart(
        2,
        "0"
      ),

      String(
        now.getDate()
      ).padStart(
        2,
        "0"
      )
    ].join(
      "-"
    );
  }


  function createSelectedDateQuery() {
    const date =
      getSelectedDateIso();

    state.selectedDate =
      date;

    return (
      "?" +
      new URLSearchParams({
        from:
          date,

        to:
          date
      }).toString()
    );
  }


  function normalizeSharedQuery(
    query
  ) {
    const value =
      String(
        query ||
        ""
      ).trim();

    return value ||
      createSelectedDateQuery();
  }


  function isPostCutoverDate(
    dateValue =
      getSelectedDateIso()
  ) {
    return (
      String(
        dateValue ||
        ""
      ).trim() >
      LEGACY_READONLY_CUTOFF
    );
  }


  function withTimeout(
    promise,
    timeoutMs,
    label
  ) {
    return new Promise(
      (
        resolve,
        reject
      ) => {
        let settled =
          false;

        const timer =
          window.setTimeout(
            () => {
              if (settled) {
                return;
              }

              settled =
                true;

              reject(
                new Error(
                  label +
                  " timeout"
                )
              );
            },
            timeoutMs
          );

        Promise.resolve(
          promise
        ).then(
          value => {
            if (settled) {
              return;
            }

            settled =
              true;

            window.clearTimeout(
              timer
            );

            resolve(
              value
            );
          },
          error => {
            if (settled) {
              return;
            }

            settled =
              true;

            window.clearTimeout(
              timer
            );

            reject(
              error
            );
          }
        );
      }
    );
  }


  function getStatusElement() {
    let element =
      document.getElementById(
        "mobileDataStartupStatusV11"
      );

    if (
      element ||
      !document.body
    ) {
      return element;
    }

    element =
      document.createElement(
        "div"
      );

    element.id =
      "mobileDataStartupStatusV11";

    element.style.cssText = [
      "position:fixed",
      "left:50%",
      "bottom:max(18px,env(safe-area-inset-bottom))",
      "z-index:2147483600",
      "transform:translateX(-50%)",
      "max-width:calc(100vw - 28px)",
      "padding:8px 12px",
      "border:1px solid rgba(255,255,255,.22)",
      "border-radius:999px",
      "background:rgba(18,56,95,.92)",
      "box-shadow:0 8px 24px rgba(0,0,0,.2)",
      "color:#fff",
      "font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif",
      "font-size:11px",
      "font-weight:800",
      "line-height:1.35",
      "text-align:center",
      "white-space:normal",
      "pointer-events:none"
    ].join(
      ";"
    );

    document.body.appendChild(
      element
    );

    return element;
  }


  function setStatus(
    message,
    options = {}
  ) {
    const element =
      getStatusElement();

    if (!element) {
      return;
    }

    if (statusTimerId) {
      window.clearTimeout(
        statusTimerId
      );

      statusTimerId =
        0;
    }

    element.textContent =
      String(
        message ||
        ""
      );

    element.hidden =
      false;

    element.style.background =
      options.warning ===
        true
        ? "rgba(132,87,12,.94)"
        : "rgba(18,56,95,.92)";

    const hideAfterMs =
      Number(
        options.hideAfterMs ||
        0
      );

    if (
      Number.isFinite(
        hideAfterMs
      ) &&
      hideAfterMs >
        0
    ) {
      statusTimerId =
        window.setTimeout(
          () => {
            element.hidden =
              true;
          },
          hideAfterMs
        );
    }
  }


  function safeRenderCurrentState() {
    const operations = [
      () => {
        if (
          typeof renderSelectedDate ===
            "function"
        ) {
          renderSelectedDate();
        }
      },

      () => {
        if (
          typeof renderLogTable ===
            "function"
        ) {
          renderLogTable();
        }
      },

      () => {
        if (
          typeof updateShiftMemberCardStates ===
            "function"
        ) {
          updateShiftMemberCardStates();
        }
      },

      () => {
        if (
          typeof setEditorDateFromSelectedDate ===
            "function"
        ) {
          setEditorDateFromSelectedDate();
        }
      },

      () => {
        if (
          typeof renderLogEntryTable ===
            "function"
        ) {
          renderLogEntryTable();
        }
      }
    ];

    operations.forEach(
      operation => {
        try {
          operation();

        } catch (
          error
        ) {
          console.warn(
            "[Mobile V11] render refresh failed:",
            error
          );
        }
      }
    );
  }


  /*
    Mobile-only shared-log bound:
    empty requests are restricted to the selected date.
    Explicit search ranges remain unchanged.
  */
  loadSharedShiftLogsFromServer =
    async function mobileBoundedSharedLoadV11(
      query = ""
    ) {
      return originalLoadSharedShiftLogsFromServer(
        normalizeSharedQuery(
          query
        )
      );
    };


  /*
    After the D1 cutover date, mobile uses the shared D1 log
    as the authoritative source and does not auto-load legacy.

    Historical dates through 2026-07-21 keep read-only legacy
    loading so old records remain viewable on mobile.

    Manual legacy sync uses its own explicit path and is not
    changed by this wrapper.
  */
  async function mobileSelectiveLegacyLoadV11(
    ...args
  ) {
    const selectedDate =
      getSelectedDateIso();

    if (
      isPostCutoverDate(
        selectedDate
      )
    ) {
      state.legacySkipped =
        true;

      return [];
    }

    state.legacySkipped =
      false;

    return rawLegacyLoader.apply(
      this,
      args
    );
  }


  loadLegacyLogsForSelectedDate =
    mobileSelectiveLegacyLoadV11;


  async function loadCurrentDateSharedLogs() {
    state.stage =
      "shared-current-date";

    setStatus(
      "\uC624\uB298 \uC5C5\uBB34\uC77C\uC9C0\uB97C \uBD88\uB7EC\uC624\uB294 \uC911..."
    );

    const serverLogs =
      await withTimeout(
        originalLoadSharedShiftLogsFromServer(
          createSelectedDateQuery()
        ),
        12000,
        "shared current-date load"
      );

    state.sharedCount =
      Array.isArray(
        serverLogs
      )
        ? serverLogs.length
        : 0;

    const preservedLegacyLogs =
      (
        typeof isReadOnlyLegacyShiftLog ===
          "function"
      )
        ? appState.logs.filter(
            isReadOnlyLegacyShiftLog
          )
        : [];

    appState.logs = [
      ...(
        Array.isArray(
          serverLogs
        )
          ? serverLogs
          : []
      ),

      ...preservedLegacyLogs
    ];

  }


  async function loadHistoricalLegacyIfNeeded() {
    const selectedDate =
      getSelectedDateIso();

    if (
      isPostCutoverDate(
        selectedDate
      )
    ) {
      state.stage =
        "legacy-skipped-post-cutover";

      state.legacySkipped =
        true;

      return;
    }

    state.stage =
      "legacy-readonly-historical";

    setStatus(
      "\uACFC\uAC70 \uC77D\uAE30\uC804\uC6A9 \uC77C\uC9C0\uB97C \uBD88\uB7EC\uC624\uB294 \uC911..."
    );

    const legacyLogs =
      await withTimeout(
        rawLegacyLoader(),
        12000,
        "historical legacy read-only load"
      );

    state.legacyCount =
      Array.isArray(
        legacyLogs
      )
        ? legacyLogs.length
        : 0;

  }


  async function runBackgroundStartup() {
    if (
      backgroundStarted
    ) {
      return;
    }

    backgroundStarted =
      true;

    try {
      await loadCurrentDateSharedLogs();

    } catch (
      error
    ) {
      state.sharedError =
        String(
          (
            error &&
            error.message
          ) ||
          error ||
          "unknown"
        );

      console.error(
        "[Mobile V11] shared load failed:",
        error
      );
    }

    try {
      await loadHistoricalLegacyIfNeeded();

    } catch (
      error
    ) {
      state.legacyError =
        String(
          (
            error &&
            error.message
          ) ||
          error ||
          "unknown"
        );

      console.error(
        "[Mobile V11] historical legacy load failed:",
        error
      );
    }

    safeRenderCurrentState();

    state.stage =
      "ready";

    state.completedAt =
      Date.now();

    const hasError =
      Boolean(
        state.sharedError ||
        state.legacyError
      );

    setStatus(
      hasError
        ? "\uBAA8\uBC14\uC77C \uD654\uBA74 \uC900\uBE44 \uC644\uB8CC \u00B7 \uC77C\uBD80 \uC870\uD68C \uC9C0\uC5F0"
        : "\uBAA8\uBC14\uC77C \uC5C5\uBB34\uC77C\uC9C0 \uC900\uBE44 \uC644\uB8CC",
      {
        warning:
          hasError,

        hideAfterMs:
          hasError
            ? 5000
            : 1600
      }
    );

    console.log(
      "[Mobile V11] startup complete",
      state
    );
  }


  function scheduleBackgroundStartup() {
    window.setTimeout(
      () => {
        void runBackgroundStartup();
      },
      0
    );
  }


  loadLogs =
    async function mobileInitialLoadLogsV11(
      ...args
    ) {
      if (
        initialLoadIntercepted
      ) {
        return originalLoadLogs.apply(
          this,
          args
        );
      }

      initialLoadIntercepted =
        true;

      state.stage =
        "initial-loadLogs-intercepted";

      scheduleBackgroundStartup();

      return [];
    };


  const selectiveLegacyWrapper =
    loadLegacyLogsForSelectedDate;


  loadLegacyLogsForSelectedDate =
    async function mobileInitialLegacyLoadV11(
      ...args
    ) {
      if (
        initialLoadIntercepted &&
        !initialLegacyIntercepted
      ) {
        initialLegacyIntercepted =
          true;

        state.stage =
          "initial-legacy-intercepted";

        loadLogs =
          originalLoadLogs;

        loadLegacyLogsForSelectedDate =
          selectiveLegacyWrapper;

        return [];
      }

      return selectiveLegacyWrapper.apply(
        this,
        args
      );
    };


  function restoreInitialWrappers() {
    loadLogs =
      originalLoadLogs;

    if (
      loadLegacyLogsForSelectedDate.name ===
        "mobileInitialLegacyLoadV11"
    ) {
      loadLegacyLogsForSelectedDate =
        selectiveLegacyWrapper;
    }
  }


  /*
    Never restore these wrappers from a wall-clock timer while the
    document is still loading. A slow parser-blocking resource could
    previously consume the three-second window before DOMContentLoaded
    and silently re-enable the original unbounded startup.

    The zero-delay task runs after DOMContentLoaded listeners and their
    promise continuations have had a chance to perform the intended
    one-time interception. It is only a safety net; the normal legacy
    interception above restores the wrappers immediately.
  */
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      window.setTimeout(
        restoreInitialWrappers,
        0
      );
    },
    {
      once:
        true
    }
  );
})();
