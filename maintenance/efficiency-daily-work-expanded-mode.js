"use strict";

// Loaded before the desktop runtime. Installation stays at its original call site.
window.GSEfficiencyDailyWorkExpandedMode = Object.freeze({
  install: function initializeEfficiencyDailyWorkExpandedModeFinal() {
  if (
    window
      .__efficiencyDailyWorkExpandedModeFinalInstalled ===
    true
  ) {
    return;
  }


  window
    .__efficiencyDailyWorkExpandedModeFinalInstalled =
    true;


  let archiveWasVisible =
    true;


  /* =====================================================
    확대 상태 적용
  ====================================================== */

  function setEfficiencyDailyWorkExpandedMode(
    shouldExpand
  ) {
    const teamModal =
      document.getElementById(
        "efficiencyTeamModal"
      );


    const expandButton =
      document.getElementById(
        "toggleEfficiencyDailyWorkExpandedButton"
      );


    const view =
      document.getElementById(
        "efficiencyDailyWorkView"
      );


    const dashboard =
      document.getElementById(
        "efficiencyDailyWorkDashboard"
      );


    const archivePanel =
      document.getElementById(
        "efficiencyDailyWorkArchivePanel"
      );


    const archiveButton =
      document.getElementById(
        "toggleEfficiencyDailyWorkArchiveButton"
      );


    const paperScroll =
      view?.querySelector(
        ".efficiency-daily-work-paper-scroll"
      ) ||
      null;


    if (
      !teamModal ||
      !expandButton
    ) {
      return;
    }


    const isExpanded =
      Boolean(
        shouldExpand
      );


    /* 확대 전 보관함 상태 기억 */

    if (
      isExpanded &&
      archivePanel
    ) {
      archiveWasVisible =
        !archivePanel.hidden;
    }


    /* 확대 클래스 */

    teamModal.classList.toggle(
      "is-daily-work-expanded",
      isExpanded
    );


    view?.classList.toggle(
      "is-expanded",
      isExpanded
    );


    dashboard?.classList.toggle(
      "is-expanded",
      isExpanded
    );


    document.body.classList.toggle(
      "is-efficiency-daily-work-expanded",
      isExpanded
    );


    /* 버튼 상태 */

    expandButton.setAttribute(
      "aria-pressed",
      String(
        isExpanded
      )
    );


    expandButton.textContent =
      isExpanded
        ? "원래 크기"
        : "크게 보기";


    expandButton.setAttribute(
      "aria-label",
      isExpanded
        ? "일일업무현황 원래 크기로 보기"
        : "일일업무현황 크게 보기"
    );


    /* 날짜별 보관함 */

    if (
      archivePanel
    ) {
      archivePanel.hidden =
        isExpanded
          ? true
          : !archiveWasVisible;


      archivePanel.setAttribute(
        "aria-hidden",
        String(
          archivePanel.hidden
        )
      );
    }


    /* 보관함 버튼 */

    if (
      archiveButton
    ) {
      archiveButton.hidden =
        isExpanded;


      archiveButton.setAttribute(
        "aria-expanded",
        String(
          !isExpanded &&
          archiveWasVisible
        )
      );
    }


    /* 기존 대시보드 보관함 클래스 동기화 */

    dashboard?.classList.toggle(
      "is-archive-hidden",
      isExpanded ||
      !archiveWasVisible
    );


    if (
      isExpanded
    ) {
      window.requestAnimationFrame(
        () => {
          paperScroll?.scrollTo({
            top:
              0,

            left:
              0,

            behavior:
              "smooth"
          });
        }
      );
    }
  }


  /* =====================================================
    클릭 이벤트

    HTML이 나중에 표시되더라도 작동하도록
    document에 이벤트를 연결한다.
  ====================================================== */

  document.addEventListener(
    "click",
    event => {
      const target =
        event.target instanceof
          Element
          ? event.target
          : null;


      const expandButton =
        target?.closest(
          "#toggleEfficiencyDailyWorkExpandedButton"
        );


      if (
        expandButton
      ) {
        event.preventDefault();
        event.stopPropagation();


        const isCurrentlyExpanded =
          expandButton.getAttribute(
            "aria-pressed"
          ) ===
          "true";


        setEfficiencyDailyWorkExpandedMode(
          !isCurrentlyExpanded
        );


        return;
      }


      /*
        효율팀 팝업 닫기 버튼을 누르면
        확대 상태도 함께 해제한다.
      */

      const closeButton =
        target?.closest(
          `
            #closeEfficiencyTeamModalButton,
            #closeEfficiencyTeamModalFooterButton
          `
        );


      if (
        closeButton
      ) {
        setEfficiencyDailyWorkExpandedMode(
          false
        );
      }
    },
    true
  );


  /* 외부에서도 확대 해제 가능 */

  window
    .setEfficiencyDailyWorkExpandedMode =
    setEfficiencyDailyWorkExpandedMode;
}
});
