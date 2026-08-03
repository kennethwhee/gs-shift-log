"use strict";

/* =========================================================
  점검일지 허브

  역할:
  - 일일·주간·월간 점검일지 분류
  - 선택한 분류의 카드만 표시
  - 선택한 점검일지를 iframe으로 실행
========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {
    initializeInspectionLogHub();
  }
);


function initializeInspectionLogHub() {
  const tabButtons =
    Array.from(
      document.querySelectorAll(
        "[data-inspection-category]"
      )
    );

  const logList =
    document.getElementById(
      "inspectionLogList"
    );

  const logCards =
    Array.from(
      document.querySelectorAll(
        "[data-inspection-category-item]"
      )
    );

  const emptyMessage =
    document.getElementById(
      "inspectionLogEmpty"
    );

  const viewer =
    document.getElementById(
      "inspectionLogViewer"
    );

  const viewerFrame =
    document.getElementById(
      "inspectionLogFrame"
    );

  const viewerTitle =
    document.getElementById(
      "inspectionLogViewerTitle"
    );

  const backButton =
    document.getElementById(
      "inspectionLogBackButton"
    );

  if (
    !logList ||
    !viewer ||
    !viewerFrame
  ) {
    console.error(
      "점검일지 허브 필수 요소가 없습니다.",
      {
        logList:
          Boolean(logList),
        viewer:
          Boolean(viewer),
        viewerFrame:
          Boolean(viewerFrame)
      }
    );

    return;
  }

  let activeCategory =
    "daily";


  /* =====================================================
    목록 화면 표시
  ====================================================== */

  function showListView() {
    viewer.hidden =
      true;

    logList.hidden =
      false;

    viewerFrame.src =
      "about:blank";
  }


  /* =====================================================
    분류 선택
  ====================================================== */

  function selectCategory(
    category
  ) {
    const normalizedCategory =
      String(
        category ||
        "daily"
      ).trim();

    activeCategory =
      normalizedCategory;

    let visibleCount =
      0;

    tabButtons.forEach(
      button => {
        const isActive =
          button.dataset
            .inspectionCategory ===
          normalizedCategory;

        button.classList.toggle(
          "is-active",
          isActive
        );

        button.setAttribute(
          "aria-selected",
          isActive
            ? "true"
            : "false"
        );
      }
    );

    logCards.forEach(
      card => {
        const isVisible =
          card.dataset
            .inspectionCategoryItem ===
          normalizedCategory;

        card.hidden =
          !isVisible;

        if (
          isVisible
        ) {
          visibleCount +=
            1;
        }
      }
    );

    if (
      emptyMessage
    ) {
      emptyMessage.hidden =
        visibleCount !==
        0;
    }

    showListView();
  }


  /* =====================================================
    점검일지 열기
  ====================================================== */

  function openInspectionLog(
    card
  ) {
    const pagePath =
      String(
        card?.dataset
          ?.inspectionPath ||
        ""
      ).trim();

    if (
      !pagePath
    ) {
      window.alert(
        "점검일지 연결 경로가 없습니다."
      );

      return;
    }

    const title =
      String(
        card.querySelector(
          ".inspection-log-card__text strong"
        )?.textContent ||
        "점검일지"
      ).trim();

    if (
      viewerTitle
    ) {
      viewerTitle.textContent =
        title;
    }

    viewerFrame.src =
      pagePath;

    logList.hidden =
      true;

    viewer.hidden =
      false;
  }


  /* =====================================================
    이벤트 연결
  ====================================================== */

  tabButtons.forEach(
    button => {
      button.addEventListener(
        "click",
        () => {
          selectCategory(
            button.dataset
              .inspectionCategory
          );
        }
      );
    }
  );


  logList.addEventListener(
    "click",
    event => {
      const target =
        event.target instanceof
        Element
          ? event.target
          : null;

      const card =
        target?.closest(
          "[data-inspection-category-item]"
        );

      if (
        !card ||
        card.hidden
      ) {
        return;
      }

      openInspectionLog(
        card
      );
    }
  );


  backButton?.addEventListener(
    "click",
    () => {
      selectCategory(
        activeCategory
      );
    }
  );


  /* =====================================================
    최초 화면
  ====================================================== */

  selectCategory(
    "daily"
  );
}
