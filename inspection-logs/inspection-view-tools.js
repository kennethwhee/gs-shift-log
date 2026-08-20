"use strict";

/* =========================================================
  점검일지 공통 보기 도구

  기능:
  - Ctrl + 마우스휠: 현재 화면만 확대·축소
  - 축소/확대/100% 복원 버튼
  - 오른쪽 아래 크게 보기
  - 전용 점검일지 iframe에도 동일 적용
========================================================= */

(function initializeInspectionViewTools() {
  if (
    window.__gsInspectionViewToolsInstalled ===
      true
  ) {
    return;
  }

  window.__gsInspectionViewToolsInstalled =
    true;

  const MIN_ZOOM =
    0.7;

  const MAX_ZOOM =
    1.8;

  const ZOOM_STEP =
    0.1;

  const STORAGE_KEY =
    "gsShiftLog.inspectionViewTools.v1";

  const state = {
    mainZoom:
      1,

    frameZoom:
      1,

    focusMode:
      false
  };

  let hub =
    null;

  let viewer =
    null;

  let viewerFrame =
    null;

  let calendarDashboard =
    null;

  let scheduleTablePanel =
    null;

  let controls =
    null;

  let zoomLabel =
    null;

  let fullscreenButton =
    null;

  const boundFrameDocuments =
    new WeakSet();


  function clampZoom(
    value
  ) {
    const normalizedValue =
      Math.round(
        Number(
          value
        ) *
        10
      ) /
      10;

    return Math.min(
      MAX_ZOOM,
      Math.max(
        MIN_ZOOM,
        Number.isFinite(
          normalizedValue
        )
          ? normalizedValue
          : 1
      )
    );
  }


  function loadSavedState() {
    try {
      const savedText =
        window.sessionStorage.getItem(
          STORAGE_KEY
        );

      const savedState =
        savedText
          ? JSON.parse(
              savedText
            )
          : null;

      state.mainZoom =
        clampZoom(
          savedState?.mainZoom ??
          1
        );

      state.frameZoom =
        clampZoom(
          savedState?.frameZoom ??
          1
        );

    } catch (
      error
    ) {
      console.warn(
        "점검일지 확대 상태를 불러오지 못했습니다.",
        error
      );
    }
  }


  function saveState() {
    try {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          mainZoom:
            state.mainZoom,

          frameZoom:
            state.frameZoom
        })
      );

    } catch (
      error
    ) {
      console.warn(
        "점검일지 확대 상태를 저장하지 못했습니다.",
        error
      );
    }
  }


  function isElementVisible(
    element
  ) {
    return Boolean(
      element &&
      element.hidden !==
        true &&
      window.getComputedStyle(
        element
      ).display !==
        "none"
    );
  }


  function isViewerActive() {
    if (
      !isElementVisible(
        viewer
      ) ||
      !viewerFrame
    ) {
      return false;
    }

    const source =
      String(
        viewerFrame.getAttribute(
          "src"
        ) ||
        ""
      ).trim();

    return Boolean(
      source &&
      source !==
        "about:blank"
    );
  }


  function getActiveZoom() {
    return isViewerActive()
      ? state.frameZoom
      : state.mainZoom;
  }


  function updateControlState() {
    const zoom =
      getActiveZoom();

    if (
      zoomLabel
    ) {
      zoomLabel.textContent =
        `${Math.round(
          zoom *
          100
        )}%`;

      zoomLabel.title =
        "클릭하면 100%로 복원";
    }

    if (
      fullscreenButton
    ) {
      fullscreenButton.setAttribute(
        "aria-pressed",
        String(
          state.focusMode
        )
      );

      fullscreenButton.title =
        state.focusMode
          ? "원래 크기로 보기"
          : "크게 보기";

      fullscreenButton.setAttribute(
        "aria-label",
        fullscreenButton.title
      );
    }
  }


  function clearMainZoomTargets() {
    [
      calendarDashboard,
      scheduleTablePanel
    ].forEach(
      element => {
        if (
          element
        ) {
          element.style.zoom =
            "";
        }
      }
    );
  }


  function getActiveMainTarget() {
    if (
      isElementVisible(
        scheduleTablePanel
      )
    ) {
      return scheduleTablePanel;
    }

    if (
      isElementVisible(
        calendarDashboard
      )
    ) {
      return calendarDashboard;
    }

    return document.querySelector(
      ".inspection-workspace__content"
    );
  }


  function applyMainZoom() {
    clearMainZoomTargets();

    const target =
      getActiveMainTarget();

    if (
      target &&
      !isViewerActive()
    ) {
      target.style.zoom =
        String(
          state.mainZoom
        );
    }
  }


  function getViewerDocument() {
    try {
      return viewerFrame
        ?.contentDocument ||
        null;

    } catch (
      error
    ) {
      console.warn(
        "점검일지 iframe 문서에 접근하지 못했습니다.",
        error
      );

      return null;
    }
  }


  function applyFrameZoom() {
    const frameDocument =
      getViewerDocument();

    if (
      !frameDocument
    ) {
      return;
    }

    frameDocument.documentElement.style.zoom =
      String(
        state.frameZoom
      );
  }


  function applyActiveZoom() {
    if (
      isViewerActive()
    ) {
      applyFrameZoom();

    } else {
      applyMainZoom();
    }

    updateControlState();
  }


  function setActiveZoom(
    nextZoom
  ) {
    const normalizedZoom =
      clampZoom(
        nextZoom
      );

    if (
      isViewerActive()
    ) {
      state.frameZoom =
        normalizedZoom;

      applyFrameZoom();

    } else {
      state.mainZoom =
        normalizedZoom;

      applyMainZoom();
    }

    saveState();

    updateControlState();
  }


  function adjustActiveZoom(
    direction
  ) {
    setActiveZoom(
      getActiveZoom() +
      Number(
        direction
      ) *
      ZOOM_STEP
    );
  }


  function resetActiveZoom() {
    setActiveZoom(
      1
    );
  }


  function notifyParentFocusMode(
    enabled
  ) {
    try {
      if (
        window.parent &&
        window.parent !==
          window
      ) {
        window.parent.postMessage(
          {
            type:
              "gs-shift-log:inspection-view-mode",

            expanded:
              enabled ===
              true
          },

          window.location.origin
        );
      }

    } catch (
      error
    ) {
      console.warn(
        "점검일지 크게 보기 상태를 부모 화면에 전달하지 못했습니다.",
        error
      );
    }
  }


  function applyFocusMode(
    enabled
  ) {
    state.focusMode =
      enabled ===
      true;

    document.body.classList.toggle(
      "inspection-focus-mode",
      state.focusMode
    );

    notifyParentFocusMode(
      state.focusMode
    );

    updateControlState();

    window.setTimeout(
      applyActiveZoom,
      0
    );
  }


  function toggleFocusMode() {
    /*
      [INSPECTION-MODAL-EXPAND-ONLY]

      Browser native fullscreen is intentionally not used here.

      The inspection page already sends the focus-mode state to
      the parent launcher. The parent modal then toggles
      "is-inspection-expanded" and fills the browser viewport.

      This avoids the nested-iframe native-fullscreen width bug.
    */
    applyFocusMode(
      !state.focusMode
    );
  }


  function handleZoomWheel(
    event
  ) {
    if (
      event.ctrlKey !==
        true
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    adjustActiveZoom(
      event.deltaY <
        0
        ? 1
        : -1
    );
  }


  function handleZoomKeydown(
    event
  ) {
    if (
      event.ctrlKey ===
        true &&
      event.key ===
        "0"
    ) {
      event.preventDefault();
      event.stopPropagation();

      resetActiveZoom();
    }
  }


  function bindViewerDocument() {
    const frameDocument =
      getViewerDocument();

    if (
      !frameDocument ||
      boundFrameDocuments.has(
        frameDocument
      )
    ) {
      applyFrameZoom();

      return;
    }

    boundFrameDocuments.add(
      frameDocument
    );

    frameDocument.addEventListener(
      "wheel",
      handleZoomWheel,
      {
        passive:
          false,

        capture:
          true
      }
    );

    frameDocument.addEventListener(
      "keydown",
      handleZoomKeydown,
      true
    );

    applyFrameZoom();
  }


  function createControls() {
    controls =
      document.createElement(
        "div"
      );

    controls.className =
      "inspection-view-tools";

    controls.setAttribute(
      "role",
      "group"
    );

    controls.setAttribute(
      "aria-label",
      "점검일지 보기 도구"
    );

    controls.innerHTML = `
      <button
        type="button"
        class="inspection-view-tools__button"
        data-inspection-view-zoom-out
        aria-label="축소"
        title="축소"
      >
        −
      </button>

      <button
        type="button"
        class="inspection-view-tools__zoom"
        data-inspection-view-reset
        aria-label="확대 비율 100%로 복원"
      >
        100%
      </button>

      <button
        type="button"
        class="inspection-view-tools__button"
        data-inspection-view-zoom-in
        aria-label="확대"
        title="확대"
      >
        +
      </button>

      <span class="inspection-view-tools__divider" aria-hidden="true"></span>

      <button
        type="button"
        class="inspection-view-tools__button is-fullscreen"
        data-inspection-view-fullscreen
        aria-label="크게 보기"
        aria-pressed="false"
        title="크게 보기"
      >
        ⛶
      </button>
    `;

    document.body.appendChild(
      controls
    );

    zoomLabel =
      controls.querySelector(
        "[data-inspection-view-reset]"
      );

    fullscreenButton =
      controls.querySelector(
        "[data-inspection-view-fullscreen]"
      );

    controls
      .querySelector(
        "[data-inspection-view-zoom-out]"
      )
      ?.addEventListener(
        "click",
        () => {
          adjustActiveZoom(
            -1
          );
        }
      );

    controls
      .querySelector(
        "[data-inspection-view-zoom-in]"
      )
      ?.addEventListener(
        "click",
        () => {
          adjustActiveZoom(
            1
          );
        }
      );

    zoomLabel
      ?.addEventListener(
        "click",
        resetActiveZoom
      );

    fullscreenButton
      ?.addEventListener(
        "click",
        toggleFocusMode
      );
  }


  async function waitForWorkspace() {
    for (
      let attempt =
        0;
      attempt <
        100;
      attempt +=
        1
    ) {
      hub =
        document.querySelector(
          ".inspection-log-hub"
        );

      viewer =
        document.getElementById(
          "inspectionLogViewer"
        );

      viewerFrame =
        document.getElementById(
          "inspectionLogFrame"
        );

      calendarDashboard =
        document.getElementById(
          "inspectionScheduleDashboard"
        );

      scheduleTablePanel =
        document.getElementById(
          "inspectionScheduleTablePanel"
        );

      if (
        hub &&
        viewer &&
        viewerFrame &&
        calendarDashboard &&
        scheduleTablePanel
      ) {
        return true;
      }

      await new Promise(
        resolve => {
          window.setTimeout(
            resolve,
            100
          );
        }
      );
    }

    return false;
  }


  async function start() {
    const ready =
      await waitForWorkspace();

    if (
      !ready
    ) {
      console.error(
        "점검일지 보기 도구를 연결할 화면을 찾지 못했습니다."
      );

      return;
    }

    loadSavedState();

    createControls();

    hub.addEventListener(
      "wheel",
      handleZoomWheel,
      {
        passive:
          false,

        capture:
          true
      }
    );

    document.addEventListener(
      "keydown",
      handleZoomKeydown,
      true
    );

    viewerFrame.addEventListener(
      "load",
      () => {
        bindViewerDocument();
        updateControlState();
      }
    );

    const observer =
      new MutationObserver(
        () => {
          window.requestAnimationFrame(
            () => {
              applyActiveZoom();
              bindViewerDocument();
            }
          );
        }
      );

    observer.observe(
      document.body,
      {
        subtree:
          true,

        attributes:
          true,

        attributeFilter: [
          "hidden",
          "src",
          "class"
        ]
      }
    );

    document.addEventListener(
      "fullscreenchange",
      () => {
        if (
          !document.fullscreenElement &&
          state.focusMode
        ) {
          applyFocusMode(
            false
          );
        }
      }
    );

    window.addEventListener(
      "beforeunload",
      () => {
        notifyParentFocusMode(
          false
        );
      }
    );

    applyActiveZoom();
    bindViewerDocument();
  }


  if (
    document.readyState ===
      "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      {
        once:
          true
      }
    );

  } else {
    start();
  }
})();
