(() => {
  "use strict";

  const INSTALL_FLAG =
    "__mainFloatingNotificationDockV1Installed";

  if (
    window[INSTALL_FLAG] ===
    true
  ) {
    return;
  }

  /*
    This flag is intentionally set before DOMContentLoaded.
    The legacy mobile BOX presenter can finish its own setup,
    while this controller remains the final visual mount point.
  */
  window[INSTALL_FLAG] =
    true;

  const RAIL_ID =
    "mainNotificationRail";

  const LIST_ID =
    "mainNotificationRailList";

  const LAUNCHER_ID =
    "mainNotificationRailLauncher";

  const SOURCE_SELECTOR =
    "#blowerHistoryMainAlert, #armRollBoxMainAlert";

  const IS_MOBILE_CLIENT =
    /^\/mobile-app(?:\/|$)/.test(
      window.location.pathname
    );

  const MOBILE_SOURCE_ID =
    "blowerHistoryMainAlert";

  const SOURCE_DEFINITIONS = [
    {
      id:
        "blowerHistoryMainAlert",
      countSelector:
        "#blowerHistoryMainAlertCount",
      identitySelector:
        "#blowerHistoryMainAlertText",
      summaryLabel:
        "Blower"
    },
    {
      id:
        "armRollBoxMainAlert",
      countSelector:
        "#armRollBoxMainAlertCount",
      identitySelector:
        "#armRollBoxMainAlertText",
      summaryLabel:
        "BOX"
    }
  ];

  let observer =
    null;

  let syncFrame =
    0;

  let currentSignature =
    "";

  let dismissedSignature =
    "";

  let mobileExpanded =
    false;

  let previousLiveSignature =
    "";

  let liveTimer =
    0;

  const mobileSourceInteractionStates =
    new WeakMap();


  function isMobileDockMode() {
    return IS_MOBILE_CLIENT;
  }


  function getActiveSourceDefinitions() {
    if (
      !isMobileDockMode()
    ) {
      return SOURCE_DEFINITIONS;
    }

    return SOURCE_DEFINITIONS.filter(
      definition => {
        return definition.id ===
          MOBILE_SOURCE_ID;
      }
    );
  }


  function setNodeText(
    node,
    value
  ) {
    if (
      !node
    ) {
      return;
    }

    const nextValue =
      String(
        value == null
          ? ""
          : value
      );

    if (
      node.textContent !==
        nextValue
    ) {
      node.textContent =
        nextValue;
    }
  }


  function setAttributeValue(
    node,
    name,
    value
  ) {
    if (
      !node
    ) {
      return;
    }

    const nextValue =
      String(
        value
      );

    if (
      node.getAttribute(
        name
      ) !== nextValue
    ) {
      node.setAttribute(
        name,
        nextValue
      );
    }
  }


  function setHidden(
    node,
    hidden
  ) {
    if (
      node &&
      node.hidden !== hidden
    ) {
      node.hidden =
        hidden;
    }
  }


  function setDataValue(
    node,
    key,
    value
  ) {
    if (
      !node
    ) {
      return;
    }

    const nextValue =
      String(
        value
      );

    if (
      node.dataset[key] !==
        nextValue
    ) {
      node.dataset[key] =
        nextValue;
    }
  }


  function setClassState(
    node,
    className,
    enabled
  ) {
    if (
      !node ||
      node.classList.contains(
        className
      ) === enabled
    ) {
      return;
    }

    node.classList.toggle(
      className,
      enabled
    );
  }


  function normalizeIdentityText(
    value
  ) {
    return String(
      value == null
        ? ""
        : value
    )
      .replace(
        /\d+\s*일\s*\d+\s*시간\s*(초과|남음)/g,
        "$1"
      )
      .replace(
        /\d+\s*시간\s*(초과|남음)/g,
        "$1"
      )
      .replace(
        /\d+(?:\.\d+)?\s*%/g,
        "%"
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();
  }


  function isRelevantMutationNode(
    node,
    includeDescendants =
      false
  ) {
    if (
      !node
    ) {
      return false;
    }

    const element =
      node.nodeType === 1
        ? node
        : node.parentElement;

    if (
      !element
    ) {
      return false;
    }

    if (
      element.id ===
        RAIL_ID ||
      element.id ===
        LAUNCHER_ID ||
      element.matches?.(
        SOURCE_SELECTOR
      ) ||
      element.closest?.(
        `#${RAIL_ID}, #${LAUNCHER_ID}, ${SOURCE_SELECTOR}`
      )
    ) {
      return true;
    }

    return includeDescendants &&
      Boolean(
        element.querySelector?.(
          SOURCE_SELECTOR
        )
      );
  }


  function shouldSyncFromMutations(
    records
  ) {
    return records.some(
      record => {
        if (
          isRelevantMutationNode(
            record.target,
            false
          )
        ) {
          return true;
        }

        return [
          ...record.addedNodes,
          ...record.removedNodes
        ].some(
          node => {
            return isRelevantMutationNode(
              node,
              true
            );
          }
        );
      }
    );
  }


  function parseCount(
    value
  ) {
    const match =
      String(
        value == null
          ? ""
          : value
      ).match(
        /\d+/
      );

    const count =
      match
        ? Number(
            match[0]
          )
        : 0;

    return Number.isFinite(
      count
    ) &&
      count > 0
      ? count
      : 0;
  }


  function getSeverity(
    source
  ) {
    if (
      source.classList.contains(
        "is-overdue"
      )
    ) {
      return "overdue";
    }

    if (
      source.classList.contains(
        "is-critical"
      )
    ) {
      return "critical";
    }

    if (
      source.classList.contains(
        "is-warning"
      )
    ) {
      return "warning";
    }

    if (
      source.classList.contains(
        "is-recommend"
      )
    ) {
      return "recommend";
    }

    return "notice";
  }


  function getSourceState(
    definition
  ) {
    const source =
      document.getElementById(
        definition.id
      );

    if (
      !source ||
      source.hidden ||
      source.getAttribute(
        "aria-hidden"
      ) ===
        "true"
    ) {
      return null;
    }

    const countNode =
      source.querySelector(
        definition.countSelector
      ) ||
      document.querySelector(
        definition.countSelector
      );

    const count =
      parseCount(
        countNode?.textContent
      );

    if (
      count < 1
    ) {
      return null;
    }

    const severity =
      getSeverity(
        source
      );

    const identityNode =
      source.querySelector(
        definition.identitySelector
      ) ||
      document.querySelector(
        definition.identitySelector
      );

    const identity =
      normalizeIdentityText(
        source.dataset
          .mainFloatingIdentity ||
          identityNode?.textContent
      );

    return {
      count,
      definition,
      identity,
      severity,
      source
    };
  }


  function createDockHeader() {
    const header =
      document.createElement(
        "header"
      );

    header.className =
      "main-floating-notification-dock__header";

    header.innerHTML = `
      <div class="main-floating-notification-dock__heading">
        <span
          class="main-floating-notification-dock__heading-dot"
          aria-hidden="true"
        ></span>
        <strong>운영 알림</strong>
        <span
          class="main-floating-notification-dock__total"
          id="mainNotificationRailTotal"
        >0</span>
      </div>

      <button
        type="button"
        class="main-floating-notification-dock__close"
        id="mainNotificationRailClose"
        aria-label="운영 알림 닫기"
        title="운영 알림 닫기"
      >×</button>
    `;

    return header;
  }


  function createDockSummary() {
    const summary =
      document.createElement(
        "button"
      );

    summary.type =
      "button";

    summary.className =
      "main-floating-notification-dock__summary";

    summary.id =
      "mainNotificationRailSummary";

    summary.setAttribute(
      "aria-controls",
      LIST_ID
    );

    summary.setAttribute(
      "aria-expanded",
      "false"
    );

    summary.innerHTML = `
      <span id="mainNotificationRailSummaryText">
        확인이 필요한 알림이 있습니다.
      </span>
      <strong id="mainNotificationRailSummaryAction">
        보기
      </strong>
    `;

    return summary;
  }


  function createDockList() {
    const list =
      document.createElement(
        "div"
      );

    list.className =
      "main-floating-notification-dock__list";

    list.id =
      LIST_ID;

    return list;
  }


  function createLiveRegion() {
    const live =
      document.createElement(
        "span"
      );

    live.className =
      "main-floating-notification-dock__live";

    live.id =
      "mainNotificationRailLive";

    live.setAttribute(
      "aria-live",
      "polite"
    );

    live.setAttribute(
      "aria-atomic",
      "true"
    );

    return live;
  }


  function createLauncher() {
    const launcher =
      document.createElement(
        "button"
      );

    launcher.type =
      "button";

    launcher.className =
      "main-floating-notification-launcher";

    launcher.id =
      LAUNCHER_ID;

    setAttributeValue(
      launcher,
      "aria-controls",
      RAIL_ID
    );

    setAttributeValue(
      launcher,
      "aria-expanded",
      "false"
    );

    setHidden(
      launcher,
      true
    );

    launcher.innerHTML = `
      <span
        class="main-floating-notification-launcher__mark"
        aria-hidden="true"
      >!</span>
      <span
        class="main-floating-notification-launcher__count"
        id="mainNotificationRailLauncherCount"
      >0</span>
    `;

    document.body.appendChild(
      launcher
    );

    return launcher;
  }


  function announceLive(
    live,
    message,
    signature
  ) {
    if (
      !live
    ) {
      return;
    }

    if (
      liveTimer
    ) {
      window.clearTimeout(
        liveTimer
      );

      liveTimer =
        0;
    }

    setNodeText(
      live,
      ""
    );

    liveTimer =
      window.setTimeout(
        () => {
          liveTimer =
            0;

          if (
            currentSignature !==
              signature
          ) {
            return;
          }

          setNodeText(
            live,
            message
          );
        },
        30
      );
  }


  function syncMobileDetailAction(
    source,
    definition,
    list
  ) {
    if (
      !source
    ) {
      return;
    }

    if (
      definition.id !==
        MOBILE_SOURCE_ID
    ) {
      return;
    }

    let action =
      document.querySelector(
        ".main-floating-notification-dock__detail-action"
      );

    const shouldShow =
      isMobileDockMode();

    if (
      !shouldShow
    ) {
      action?.remove();

      const previousState =
        mobileSourceInteractionStates
          .get(
            source
          );

      if (
        previousState
      ) {
        if (
          !previousState.inert
        ) {
          source.removeAttribute(
            "inert"
          );
        }

        if (
          previousState.tabindex ==
            null
        ) {
          source.removeAttribute(
            "tabindex"
          );
        } else {
          setAttributeValue(
            source,
            "tabindex",
            previousState.tabindex
          );
        }

        mobileSourceInteractionStates
          .delete(
            source
          );
      }

      return;
    }

    if (
      !mobileSourceInteractionStates
        .has(
          source
        )
    ) {
      mobileSourceInteractionStates
        .set(
          source,
          {
            inert:
              source.hasAttribute(
                "inert"
              ),
            tabindex:
              source.getAttribute(
                "tabindex"
              )
          }
        );
    }

    if (
      !source.hasAttribute(
        "inert"
      )
    ) {
      source.setAttribute(
        "inert",
        ""
      );
    }

    setAttributeValue(
      source,
      "tabindex",
      "-1"
    );

    if (
      !action
    ) {
      action =
        document.createElement(
          "button"
        );

      action.type =
        "button";

      action.className =
        "main-floating-notification-dock__detail-action";

      action.setAttribute(
        "aria-label",
        "Blower 교체이력 상세보기"
      );

      action.addEventListener(
        "click",
        event => {
          event.preventDefault();
          event.stopPropagation();

          if (
            typeof window
              .closeHeaderMoreMenu ===
              "function"
          ) {
            window.closeHeaderMoreMenu();
          }

          const blowerUrl =
            "/maintenance/blower-history";

          if (
            window.GSShiftLogNavigation &&
            typeof window
              .GSShiftLogNavigation
              .navigate ===
              "function" &&
            window.GSShiftLogNavigation
              .navigate(
                blowerUrl
              )
          ) {
            return;
          }

          window.location.assign(
            blowerUrl
          );
        }
      );
    }

    if (
      action.parentElement !==
        list ||
      action.previousElementSibling !==
        source
    ) {
      source.insertAdjacentElement(
        "afterend",
        action
      );
    }

    setNodeText(
      action,
      "상세보기"
    );
  }


  function moveSourcesIntoList(
    rail,
    list
  ) {
    SOURCE_DEFINITIONS.forEach(
      definition => {
        const source =
          document.getElementById(
            definition.id
          );

        if (
          !source
        ) {
          return;
        }

        setClassState(
          source,
          "is-mobile-top-alert",
          false
        );

        setDataValue(
          source,
          "mainFloatingNotificationSource",
          definition.summaryLabel
        );

        setAttributeValue(
          source,
          "aria-live",
          "off"
        );

        if (
          source.parentElement !==
            list
        ) {
          list.appendChild(
            source
          );
        }

        syncMobileDetailAction(
          source,
          definition,
          list
        );
      }
    );

    Array.from(
      rail.children
    )
      .filter(
        child => {
          return child instanceof
            HTMLButtonElement &&
            child.id !==
              "mainNotificationRailClose" &&
            child.id !==
              "mainNotificationRailSummary" &&
            child.id !==
              "bedAshDischargeMainAlert";
        }
      )
      .forEach(
        source => {
          list.appendChild(
            source
          );
        }
      );

    document
      .getElementById(
        "armRollBoxMainAlertMobilePlaceholder"
      )
      ?.remove();
  }


  function updateExpandedState(
    rail
  ) {
    setDataValue(
      rail,
      "mobileExpanded",
      mobileExpanded
    );

    const summary =
      document.getElementById(
        "mainNotificationRailSummary"
      );

    const action =
      document.getElementById(
        "mainNotificationRailSummaryAction"
      );

    const heading =
      document.querySelector(
        ".main-floating-notification-dock__heading strong"
      );

    const close =
      document.getElementById(
        "mainNotificationRailClose"
      );

    const isMobile =
      isMobileDockMode();

    setAttributeValue(
      summary,
      "aria-expanded",
      mobileExpanded
    );

    if (
      action
    ) {
      setNodeText(
        action,
        mobileExpanded
          ? "접기"
          : (
              isMobile
                ? "미리보기"
                : "보기"
            )
      );
    }

    setNodeText(
      heading,
      isMobile
        ? "Blower 알림"
        : "운영 알림"
    );

    const closeLabel =
      isMobile
        ? "Blower 알림 닫기"
        : "운영 알림 닫기";

    setAttributeValue(
      close,
      "aria-label",
      closeLabel
    );

    if (
      close &&
      close.title !==
        closeLabel
    ) {
      close.title =
        closeLabel;
    }
  }


  function ensureDock() {
    const rail =
      document.getElementById(
        RAIL_ID
      );

    if (
      !rail
    ) {
      return null;
    }

    setClassState(
      rail,
      "main-floating-notification-dock",
      true
    );

    if (
      !rail.dataset.active
    ) {
      rail.dataset.active =
        "false";
    }

    setAttributeValue(
      rail,
      "role",
      "region"
    );

    setAttributeValue(
      rail,
      "aria-label",
      isMobileDockMode()
        ? "Blower 알림"
        : "운영 알림"
    );

    setDataValue(
      rail,
      "mobileBlowerOnly",
      isMobileDockMode()
    );

    let header =
      rail.querySelector(
        ":scope > .main-floating-notification-dock__header"
      );

    if (
      !header
    ) {
      header =
        createDockHeader();

      rail.prepend(
        header
      );
    }

    let summary =
      rail.querySelector(
        ":scope > .main-floating-notification-dock__summary"
      );

    if (
      !summary
    ) {
      summary =
        createDockSummary();

      header.insertAdjacentElement(
        "afterend",
        summary
      );
    }

    let list =
      document.getElementById(
        LIST_ID
      );

    if (
      !list
    ) {
      list =
        createDockList();

      summary.insertAdjacentElement(
        "afterend",
        list
      );
    }

    let live =
      document.getElementById(
        "mainNotificationRailLive"
      );

    if (
      !live
    ) {
      live =
        createLiveRegion();

      rail.appendChild(
        live
      );
    }

    let launcher =
      document.getElementById(
        LAUNCHER_ID
      );

    if (
      !launcher
    ) {
      launcher =
        createLauncher();
    }

    moveSourcesIntoList(
      rail,
      list
    );

    if (
      rail.dataset
        .mainFloatingNotificationBound !==
        "true"
    ) {
      rail.dataset
        .mainFloatingNotificationBound =
        "true";

      document
        .getElementById(
          "mainNotificationRailClose"
        )
        ?.addEventListener(
          "click",
          event => {
            event.preventDefault();
            event.stopPropagation();

            mobileExpanded =
              false;

            updateExpandedState(
              rail
            );

            dismissedSignature =
              currentSignature;

            setHidden(
              launcher,
              false
            );

            launcher.focus({
              preventScroll:
                true
            });

            syncDock();
          }
        );

      summary.addEventListener(
        "click",
        event => {
          event.preventDefault();
          event.stopPropagation();

          mobileExpanded =
            !mobileExpanded;

          updateExpandedState(
            rail
          );

          if (
            isMobileDockMode() &&
            mobileExpanded
          ) {
            window.setTimeout(
              () => {
                document
                  .querySelector(
                    ".main-floating-notification-dock__detail-action"
                  )
                  ?.focus({
                    preventScroll:
                      true
                  });
              },
              0
            );
          }
        }
      );

      rail.addEventListener(
        "click",
        event => {
          if (
            !isMobileDockMode() ||
            mobileExpanded
          ) {
            return;
          }

          const target =
            event.target instanceof
              Element
              ? event.target
              : null;

          if (
            !target ||
            target.closest(
              [
                ".main-floating-notification-dock__close",
                ".main-floating-notification-dock__list",
                ".main-floating-notification-dock__summary"
              ].join(
                ","
              )
            )
          ) {
            return;
          }

          mobileExpanded =
            true;

          updateExpandedState(
            rail
          );
        }
      );

      launcher.addEventListener(
        "click",
        event => {
          event.preventDefault();
          event.stopPropagation();

          dismissedSignature =
            "";

          syncDock();

          window.setTimeout(
            () => {
              document
                .getElementById(
                  "mainNotificationRailClose"
                )
                ?.focus({
                  preventScroll:
                    true
                });
            },
            0
          );
        }
      );

      document.addEventListener(
        "click",
        event => {
          if (
            !isMobileDockMode() ||
            !mobileExpanded
          ) {
            return;
          }

          const target =
            event.target instanceof
              Node
              ? event.target
              : null;

          if (
            target &&
            rail.contains(
              target
            )
          ) {
            return;
          }

          mobileExpanded =
            false;

          updateExpandedState(
            rail
          );
        }
      );

      document.addEventListener(
        "keydown",
        event => {
          if (
            !isMobileDockMode() ||
            !mobileExpanded ||
            event.key !==
              "Escape"
          ) {
            return;
          }

          event.preventDefault();

          mobileExpanded =
            false;

          updateExpandedState(
            rail
          );

          summary.focus({
            preventScroll:
              true
          });
        }
      );
    }

    updateExpandedState(
      rail
    );

    return {
      launcher,
      list,
      rail
    };
  }


  function syncDock() {
    syncFrame =
      0;

    const dock =
      ensureDock();

    if (
      !dock
    ) {
      return;
    }

    const states =
      getActiveSourceDefinitions()
        .map(
          getSourceState
        )
        .filter(
          Boolean
        );

    const total =
      states.reduce(
        (
          sum,
          state
        ) => {
          return sum +
            state.count;
        },
        0
      );

    const signature =
      states
        .map(
          state => {
            return [
              state.definition.id,
              state.count,
              state.severity,
              state.identity
            ].join(
              ":"
            );
          }
        )
        .join(
          "|"
        );

    states.forEach(
      state => {
        setDataValue(
          state.source,
          "mainFloatingSeverity",
          state.severity
        );
      }
    );

    setDataValue(
      dock.rail,
      "active",
      total > 0
    );

    if (
      total < 1
    ) {
      if (
        dock.rail.contains(
          document.activeElement
        )
      ) {
        document
          .querySelector(
            ".top-tab.is-active"
          )
          ?.focus({
            preventScroll:
              true
          });
      }

      currentSignature =
        "";

      dismissedSignature =
        "";

      previousLiveSignature =
        "";

      if (
        liveTimer
      ) {
        window.clearTimeout(
          liveTimer
        );

        liveTimer =
          0;
      }

      setNodeText(
        document.getElementById(
          "mainNotificationRailLive"
        ),
        ""
      );

      mobileExpanded =
        false;

      setClassState(
        dock.rail,
        "is-floating-open",
        false
      );

      setClassState(
        dock.rail,
        "is-floating-closed",
        true
      );

      setAttributeValue(
        dock.rail,
        "aria-hidden",
        "true"
      );

      setAttributeValue(
        dock.launcher,
        "aria-expanded",
        "false"
      );

      setHidden(
        dock.launcher,
        true
      );

      updateExpandedState(
        dock.rail
      );

      return;
    }

    if (
      dismissedSignature &&
      dismissedSignature !==
        signature
    ) {
      dismissedSignature =
        "";

      mobileExpanded =
        false;
    }

    currentSignature =
      signature;

    const isDismissed =
      dismissedSignature ===
      signature;

    const launcherHadFocus =
      document.activeElement ===
      dock.launcher;

    setClassState(
      dock.rail,
      "is-floating-closed",
      isDismissed
    );

    setClassState(
      dock.rail,
      "is-floating-open",
      !isDismissed
    );

    setClassState(
      dock.rail,
      "has-critical-alert",
      states.some(
        state => {
          return [
            "critical",
            "overdue"
          ].includes(
            state.severity
          );
        }
      )
    );

    setAttributeValue(
      dock.rail,
      "aria-hidden",
      isDismissed
    );

    setAttributeValue(
      dock.launcher,
      "aria-expanded",
      !isDismissed
    );

    setHidden(
      dock.launcher,
      !isDismissed
    );

    if (
      !isDismissed &&
      launcherHadFocus
    ) {
      window.setTimeout(
        () => {
          document
            .getElementById(
              "mainNotificationRailClose"
            )
            ?.focus({
              preventScroll:
                true
            });
        },
        0
      );
    }

    const totalNode =
      document.getElementById(
        "mainNotificationRailTotal"
      );

    const launcherCount =
      document.getElementById(
        "mainNotificationRailLauncherCount"
      );

    const summaryText =
      document.getElementById(
        "mainNotificationRailSummaryText"
      );

    const detailAction =
      document.querySelector(
        ".main-floating-notification-dock__detail-action"
      );

    setNodeText(
      totalNode,
      total
    );

    setNodeText(
      launcherCount,
      total
    );

    setNodeText(
      summaryText,
      isMobileDockMode()
        ? `Blower ${total}`
        : states
            .map(
              state => {
                return `${state.definition.summaryLabel} ${state.count}`;
              }
            )
            .join(
              " · "
            )
    );

    if (
      isMobileDockMode() &&
      detailAction &&
      states[0]
    ) {
      const sourceDescription =
        String(
          states[0].source
            .getAttribute(
              "aria-label"
            ) ||
          "Blower 교체 알림"
        ).trim();

      setAttributeValue(
        detailAction,
        "aria-label",
        `${sourceDescription}. 상세보기`
      );
    }

    setAttributeValue(
      dock.launcher,
      "aria-label",
      isMobileDockMode()
        ? `Blower 알림 ${total}건 열기`
        : `운영 알림 ${total}건 열기`
    );

    const launcherTitle =
      isMobileDockMode()
        ? `Blower 알림 ${total}건 열기`
        : `운영 알림 ${total}건 열기`;

    if (
      dock.launcher.title !==
        launcherTitle
    ) {
      dock.launcher.title =
        launcherTitle;
    }

    const live =
      document.getElementById(
        "mainNotificationRailLive"
      );

    if (
      live &&
      signature !==
        previousLiveSignature
    ) {
      announceLive(
        live,
        isMobileDockMode()
          ? `Blower 알림이 ${total}건 있습니다.`
          : `운영 알림이 ${total}건 있습니다.`,
        signature
      );

      previousLiveSignature =
        signature;
    }

    updateExpandedState(
      dock.rail
    );
  }


  function scheduleSync() {
    if (
      syncFrame
    ) {
      return;
    }

    syncFrame =
      window.requestAnimationFrame(
        syncDock
      );
  }


  function start() {
    document.documentElement
      .classList.toggle(
        "main-floating-notification-mobile-client",
        IS_MOBILE_CLIENT
      );

    syncDock();

    if (
      observer
    ) {
      observer.disconnect();
    }

    observer =
      new MutationObserver(
        records => {
          if (
            shouldSyncFromMutations(
              records
            )
          ) {
            scheduleSync();
          }
        }
      );

    observer.observe(
      document.body,
      {
        attributes:
          true,
        attributeFilter: [
          "aria-hidden",
          "class",
          "data-main-floating-identity",
          "hidden",
          "style"
        ],
        characterData:
          true,
        childList:
          true,
        subtree:
          true
      }
    );

    window.addEventListener(
      "resize",
      scheduleSync,
      {
        passive:
          true
      }
    );

    window.addEventListener(
      "focus",
      scheduleSync,
      {
        passive:
          true
      }
    );

    document.addEventListener(
      "visibilitychange",
      scheduleSync,
      {
        passive:
          true
      }
    );
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
