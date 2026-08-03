"use strict";


document.addEventListener(
  "DOMContentLoaded",
  () => {
    initializeInspectionLogHub();
  }
);


/* =========================================================
  점검일지 메인 화면 초기화
========================================================= */

function initializeInspectionLogHub() {
  const tabButtons =
    Array.from(
      document.querySelectorAll(
        "[data-inspection-category]"
      )
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


  const logList =
    document.getElementById(
      "inspectionLogList"
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
    return;
  }


  /* =======================================================
    분류 탭 선택
  ======================================================= */

  function selectCategory(
    category
  ) {
    let visibleCount =
      0;


    tabButtons.forEach(
      button => {
        button.classList.toggle(
          "is-active",
          button.dataset
            .inspectionCategory ===
            category
        );
      }
    );


    logCards.forEach(
      card => {
        const isVisible =
          card.dataset
            .inspectionCategoryItem ===
          category;


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
        visibleCount >
        0;
    }
  }


  /* =======================================================
    점검일지 열기
  ======================================================= */

  function openInspectionLog(
    card
  ) {
    const pagePath =
      String(
        card.dataset
          .inspectionPath ||
        ""
      ).trim();


    const titleElement =
      card.querySelector(
        ".inspection-log-card__text strong"
      );


    const title =
      String(
        titleElement
          ?.textContent ||
        "점검일지"
      ).trim();


    if (
      !pagePath
    ) {
      return;
    }


    viewerFrame.src =
      pagePath;


    if (
      viewerTitle
    ) {
      viewerTitle.textContent =
        title;
    }


    logList.hidden =
      true;


    viewer.hidden =
      false;
  }


  /* =======================================================
    점검일지 목록으로 돌아가기
  ======================================================= */

  function closeInspectionLog() {
    viewer.hidden =
      true;


    logList.hidden =
      false;


    viewerFrame.src =
      "about:blank";
  }


  /* =======================================================
    이벤트 연결
  ======================================================= */

  tabButtons.forEach(
    button => {
      button.addEventListener(
        "click",
        () => {
          const category =
            button.dataset
              .inspectionCategory;


          closeInspectionLog();


          selectCategory(
            category
          );
        }
      );
    }
  );


  logCards.forEach(
    card => {
      card.addEventListener(
        "click",
        () => {
          openInspectionLog(
            card
          );
        }
      );
    }
  );


  backButton?.addEventListener(
    "click",
    () => {
      closeInspectionLog();
    }
  );


  /* =======================================================
    최초 화면
  ======================================================= */

  selectCategory(
    "daily"
  );
}