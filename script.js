"use strict";

/* =========================================================
  GS Shift Log
  - 현황 / 조회 탭
  - 날짜 이동
  - 업무일지 작성 모달
  - 작업 항목 추가 / 삭제
  - 첨부파일 표시
  - 임시저장 / 저장 / 결재요청
  - 상세보기
  - TAG → Facility Navigator 이동
========================================================= */

const FACILITY_NAVIGATOR_URL =
  "https://gs-facility-navigator-2mg.pages.dev/";

const STORAGE_KEYS = {
  logs: "gsShiftLog.logs",
  draft: "gsShiftLog.draft"
};

const appState = {
  selectedDate: new Date(2026, 6, 20),
  selectedShift: "NS",
  currentDetailLogId: null,
  logs: [],

  editorEntries: [],
  editingEntryIndex: -1
};


/* =========================================================
  초기 실행
========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  loadOperationStatus();
  bindEvents();
  bindShiftMemberCards();
  loadLogs();

  renderSelectedDate();
  renderOperationStatusCard();
  renderLogTable();
  updateShiftMemberCardStates();

  setEditorDateFromSelectedDate();

  resetLogEntryInput();
  updateTagFieldVisibility();
  renderLogEntryTable();
});

let elements = {};

function cacheElements() {
  elements = {
    topTabs: [...document.querySelectorAll(".top-tab")],
    pageViews: [...document.querySelectorAll(".page-view")],

    currentShiftLabel: document.getElementById("currentShiftLabel"),
    selectedDateText: document.getElementById("selectedDateText"),
    selectedShiftBadge: document.getElementById("selectedShiftBadge"),

    previousDateButton: document.getElementById("previousDateButton"),
    nextDateButton: document.getElementById("nextDateButton"),
    todayButton: document.getElementById("todayButton"),

    openLogEditorButton: document.getElementById("openLogEditorButton"),
    closeLogEditorButton: document.getElementById("closeLogEditorButton"),
    cancelLogButton: document.getElementById("cancelLogButton"),

    logEditorModal: document.getElementById("logEditorModal"),
    logEditorForm: document.getElementById("logEditorForm"),
    logEditorTitle: document.getElementById("logEditorTitle"),

    logDate: document.getElementById("logDate"),
    logShift: document.getElementById("logShift"),
    logTeam: document.getElementById("logTeam"),
    logRole: document.getElementById("logRole"),
    logAuthor: document.getElementById("logAuthor"),
    operationStatus: document.getElementById("operationStatus"),
    logNote: document.getElementById("logNote"),

    logEntryTime: document.getElementById("logEntryTime"),
    useCurrentTimeCheckbox: document.getElementById(
  "useCurrentTimeCheckbox"
),
    logEntryCategory: document.getElementById("logEntryCategory"),
    logEntryTag: document.getElementById("logEntryTag"),
    logEntryContent: document.getElementById("logEntryContent"),

    addLogEntryButton: document.getElementById("addLogEntryButton"),
    cancelLogEntryEditButton: document.getElementById(
      "cancelLogEntryEditButton"
    ),
    logEntryNavigatorButton: document.getElementById(
      "logEntryNavigatorButton"
    ),

    logEntryTagField: document.getElementById("logEntryTagField"),

    logEntryInputPanel: document.querySelector(".log-entry-input-panel"),
    logEntryTableBody: document.getElementById("logEntryTableBody"),
    logEntryCount: document.getElementById("logEntryCount"),
    logEntriesJson: document.getElementById("logEntriesJson"),

    logAttachments: document.getElementById("logAttachments"),
    fileDropzone: document.getElementById("fileDropzone"),
    attachmentList: document.getElementById("attachmentList"),

    saveDraftButton: document.getElementById("saveDraftButton"),
    printLogButton: document.getElementById("printLogButton"),
    requestApprovalButton: document.getElementById(
      "requestApprovalButton"
    ),

    logTableBody: document.getElementById("logTableBody"),
    logEmptyState: document.getElementById("logEmptyState"),

    logDetailModal: document.getElementById("logDetailModal"),
    closeLogDetailButton: document.getElementById(
      "closeLogDetailButton"
    ),
    closeLogDetailFooterButton: document.getElementById(
      "closeLogDetailFooterButton"
    ),
    logDetailContent: document.getElementById("logDetailContent"),
    editFromDetailButton: document.getElementById(
      "editFromDetailButton"
    ),

    searchForm: document.getElementById("searchForm"),
    searchResultBody: document.getElementById("searchResultBody"),
    searchResultCount: document.getElementById("searchResultCount"),
    searchEmptyState: document.getElementById("searchEmptyState"),

    appToast: document.getElementById("appToast")
  };
}


function bindEvents() {
  elements.topTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      switchView(tab.dataset.view);
    });
  });

  elements.previousDateButton.addEventListener("click", () => {
    moveSelectedDate(-1);
  });

  elements.nextDateButton.addEventListener("click", () => {
    moveSelectedDate(1);
  });

  elements.todayButton.addEventListener("click", () => {
    appState.selectedDate = new Date();
    renderSelectedDate();
    renderLogTable();
  });

  elements.openLogEditorButton.addEventListener("click", () => {
    openLogEditor();
  });

  elements.closeLogEditorButton.addEventListener(
    "click",
    closeLogEditor
  );

  elements.cancelLogButton.addEventListener(
    "click",
    closeLogEditor
  );

  elements.logEditorModal.addEventListener("click", (event) => {
    if (event.target === elements.logEditorModal) {
      closeLogEditor();
    }
  });


  /* 구분 변경 */

  elements.logEntryCategory.addEventListener("change", () => {
    updateTagFieldVisibility();
  });


  /* 현재시간 체크 */

  elements.useCurrentTimeCheckbox.addEventListener(
    "change",
    () => {
      if (!elements.useCurrentTimeCheckbox.checked) {
        return;
      }

      elements.logEntryTime.value = getCurrentTimeValue();

      elements.logEntryTime.classList.add(
        "is-current-time-applied"
      );

      window.setTimeout(() => {
        elements.logEntryTime.classList.remove(
          "is-current-time-applied"
        );
      }, 500);

      elements.logEntryContent.focus();
    }
  );


  /* 시간 직접 입력 */

  elements.logEntryTime.addEventListener("input", () => {
    /*
      사용자가 시간을 직접 수정하면
      현재시간 체크 상태를 자동 해제한다.
    */
    if (elements.useCurrentTimeCheckbox.checked) {
      elements.useCurrentTimeCheckbox.checked = false;
    }
  });

  elements.logEntryTime.addEventListener("blur", () => {
    if (!elements.logEntryTime.value.trim()) {
      return;
    }

    normalizeLogEntryTime();
  });

  elements.logEntryTime.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();

    const normalizedTime = normalizeLogEntryTime();

    if (!normalizedTime) {
      return;
    }

    elements.logEntryCategory.focus();
  });


  /* 작업 내역 추가 및 수정 */

  elements.addLogEntryButton.addEventListener("click", () => {
    addOrUpdateLogEntry();
  });

  elements.cancelLogEntryEditButton.addEventListener(
    "click",
    () => {
      cancelLogEntryEdit();
    }
  );

  elements.logEntryNavigatorButton.addEventListener(
    "click",
    () => {
      openFacilityNavigator(elements.logEntryTag.value);
    }
  );

  elements.logEntryTableBody.addEventListener(
    "click",
    handleLogEntryTableClick
  );

  elements.logEntryContent.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Enter" &&
        (event.ctrlKey || event.metaKey)
      ) {
        event.preventDefault();
        addOrUpdateLogEntry();
      }
    }
  );


  /* 첨부파일 */

  elements.logAttachments.addEventListener(
    "change",
    renderAttachmentList
  );

  elements.fileDropzone.addEventListener(
    "dragover",
    (event) => {
      event.preventDefault();
      elements.fileDropzone.classList.add("is-dragging");
    }
  );

  elements.fileDropzone.addEventListener(
    "dragleave",
    () => {
      elements.fileDropzone.classList.remove("is-dragging");
    }
  );

  elements.fileDropzone.addEventListener("drop", (event) => {
    event.preventDefault();

    elements.fileDropzone.classList.remove("is-dragging");

    if (!event.dataTransfer.files.length) {
      return;
    }

    elements.logAttachments.files =
      event.dataTransfer.files;

    renderAttachmentList();
  });


  /* 업무일지 저장 */

  elements.logEditorForm.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      saveCurrentLog("저장완료");
    }
  );

  elements.saveDraftButton.addEventListener(
    "click",
    saveDraft
  );

  elements.printLogButton.addEventListener(
    "click",
    () => {
      window.print();
    }
  );

  elements.requestApprovalButton.addEventListener(
    "click",
    () => {
      saveCurrentLog("결재요청");
    }
  );


  /* 업무일지 목록 */

  elements.logTableBody.addEventListener(
    "click",
    handleLogTableClick
  );

  elements.closeLogDetailButton.addEventListener(
    "click",
    closeLogDetail
  );

  elements.closeLogDetailFooterButton.addEventListener(
    "click",
    closeLogDetail
  );

  elements.logDetailModal.addEventListener(
    "click",
    (event) => {
      if (event.target === elements.logDetailModal) {
        closeLogDetail();
      }
    }
  );

  elements.editFromDetailButton.addEventListener(
    "click",
    () => {
      const log = appState.logs.find(
        (item) =>
          item.id === appState.currentDetailLogId
      );

      if (!log) {
        return;
      }

      closeLogDetail();
      openLogEditor(log);
    }
  );


  /* 조회 */

  elements.searchForm.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      runSearch();
    }
  );

  elements.searchForm.addEventListener("reset", () => {
    window.setTimeout(() => {
      elements.searchResultBody.innerHTML = "";
      elements.searchResultCount.textContent = "0";
      elements.searchEmptyState.hidden = false;

      elements.searchEmptyState.querySelector(
        "strong"
      ).textContent = "조회 조건을 선택해 주세요.";

      elements.searchEmptyState.querySelector(
        "p"
      ).textContent =
        "기간, TAG 또는 업무 내용을 기준으로 검색할 수 있습니다.";
    }, 0);
  });


  /* ESC 키 */

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    if (appState.editingEntryIndex >= 0) {
      cancelLogEntryEdit();
      return;
    }

    if (
      elements.logEditorModal.classList.contains(
        "is-open"
      )
    ) {
      closeLogEditor();
      return;
    }

    if (
      elements.logDetailModal.classList.contains(
        "is-open"
      )
    ) {
      closeLogDetail();
    }
  });
}

/* =========================================================
  화면 탭
========================================================= */
function switchView(viewName) {
  elements.topTabs.forEach((tab) => {
    const isActive = tab.dataset.view === viewName;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  elements.pageViews.forEach((view) => {
    const isActive = view.dataset.pageView === viewName;
    view.classList.toggle("is-active", isActive);
    view.hidden = !isActive;
  });
}


/* =========================================================
  날짜
========================================================= */
function moveSelectedDate(dayOffset) {
  const nextDate = new Date(appState.selectedDate);
  nextDate.setDate(nextDate.getDate() + dayOffset);

  appState.selectedDate = nextDate;
  renderSelectedDate();
  renderLogTable();
}


function renderSelectedDate() {
  const dateText = formatKoreanDate(appState.selectedDate);

  elements.selectedDateText.textContent = dateText;
  elements.selectedShiftBadge.textContent = appState.selectedShift;
  elements.currentShiftLabel.textContent =
    `${dateText} ${appState.selectedShift}`;

  setEditorDateFromSelectedDate();
}


function setEditorDateFromSelectedDate() {
  if (!elements.logDate) {
    return;
  }

  elements.logDate.value = formatInputDate(appState.selectedDate);
  elements.logShift.value = appState.selectedShift;
}


function formatKoreanDate(date) {
  const weekdays = [
    "일요일",
    "월요일",
    "화요일",
    "수요일",
    "목요일",
    "금요일",
    "토요일"
  ];

  return [
    date.getFullYear(),
    "년 ",
    String(date.getMonth() + 1).padStart(2, "0"),
    "월 ",
    String(date.getDate()).padStart(2, "0"),
    "일 ",
    weekdays[date.getDay()]
  ].join("");
}


function formatInputDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}


/* =========================================================
  업무일지 모달
========================================================= */
function openLogEditor(log = null, preset = null) {
  resetLogEditor();

  if (log) {
    fillLogEditor(log);

    elements.logEditorTitle.textContent =
      `${log.role || ""} 업무일지 수정`;

    openModal(elements.logEditorModal);
    return;
  }

  if (preset) {
    if (preset.role) {
      elements.logRole.value = preset.role;
    }

    if (preset.author) {
      elements.logAuthor.value = preset.author;
    }

    if (preset.team) {
      elements.logTeam.value = preset.team;
    }

    elements.logEditorTitle.textContent =
      `${preset.role || ""} 업무일지 작성`;
  } else {
    elements.logEditorTitle.textContent =
      "업무일지 작성";

    restoreDraftIfAvailable();
  }

  openModal(elements.logEditorModal);
}

/* =========================================================
  근무자 카드 → 업무일지 작성·수정
========================================================= */

function bindShiftMemberCards() {
  const shiftMemberCards = [
    ...document.querySelectorAll(".shift-member-card")
  ];

  shiftMemberCards.forEach((card) => {
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");

    const role =
      card.dataset.role || "해당 보직";

    card.setAttribute(
      "aria-label",
      `${role} 업무일지 작성 또는 수정`
    );

    card.addEventListener("click", () => {
      openShiftMemberLogFromCard(card);
    });

    card.addEventListener("keydown", (event) => {
      if (
        event.key !== "Enter" &&
        event.key !== " "
      ) {
        return;
      }

      event.preventDefault();
      openShiftMemberLogFromCard(card);
    });
  });
}


function openShiftMemberLogFromCard(card) {
  const role =
    String(card.dataset.role || "").trim();

  const author =
    String(
      card.querySelector(
        ".shift-member-card__name"
      )?.textContent || ""
    ).trim();

  const team =
    String(
      card.querySelector(
        ".shift-member-card__team"
      )?.textContent || ""
    ).trim();

  if (!role) {
    showToast(
      "선택한 근무자의 보직을 확인할 수 없습니다."
    );

    return;
  }

  const selectedDate =
    formatInputDate(appState.selectedDate);

  const existingLog =
    appState.logs.find((log) => {
      return (
        log.date === selectedDate &&
        log.shift === appState.selectedShift &&
        log.role === role
      );
    });

  if (existingLog) {
    openLogEditor(existingLog);
    return;
  }

  openLogEditor(null, {
    role,
    author,
    team
  });
}


function updateShiftMemberCardStates() {
  const selectedDate =
    formatInputDate(appState.selectedDate);

  const shiftMemberCards = [
    ...document.querySelectorAll(".shift-member-card")
  ];

  shiftMemberCards.forEach((card) => {
    const role =
      String(card.dataset.role || "").trim();

    const statusElement =
      card.querySelector(
        ".shift-member-card__status"
      );

    const existingLog =
      appState.logs.find((log) => {
        return (
          log.date === selectedDate &&
          log.shift === appState.selectedShift &&
          log.role === role
        );
      });

    if (!existingLog) {
      card.dataset.logState = "empty";

      if (statusElement) {
        statusElement.textContent = "미작성";

        statusElement.className =
          "shift-member-card__status is-empty";
      }

      return;
    }

    card.dataset.logState = "existing";

    if (!statusElement) {
      return;
    }

    if (
      existingLog.status === "결재완료" ||
      existingLog.status === "결재요청"
    ) {
      statusElement.textContent =
        existingLog.status === "결재완료"
          ? "작성완료"
          : "결재요청";

      statusElement.className =
        "shift-member-card__status is-complete";

      return;
    }

    if (
      existingLog.status === "임시저장" ||
      existingLog.status === "작성중"
    ) {
      statusElement.textContent = "작성중";

      statusElement.className =
        "shift-member-card__status is-writing";

      return;
    }

    statusElement.textContent = "작성완료";

    statusElement.className =
      "shift-member-card__status is-complete";
  });
}


function closeLogEditor() {
  closeModal(elements.logEditorModal);
}


function resetLogEditor() {
  elements.logEditorForm.reset();

  setEditorDateFromSelectedDate();

  elements.logAuthor.value = "이휘근";
  elements.logTeam.value = "3조";
  elements.logShift.value = appState.selectedShift;
  elements.operationStatus.value = "";
  elements.logNote.value = "";

  elements.logEditorForm.dataset.editingId = "";

  appState.editorEntries = [];
  appState.editingEntryIndex = -1;

  resetLogEntryInput({
    keepCategory: false,
    keepTag: false
  });

  renderLogEntryTable();

  elements.logAttachments.value = "";
  elements.attachmentList.innerHTML = "";
}


function fillLogEditor(log) {
  elements.logEditorForm.dataset.editingId = log.id;

  elements.logDate.value = log.date;
  elements.logShift.value = log.shift;
  elements.logTeam.value = log.team;
  elements.logRole.value = log.role;
  elements.logAuthor.value = log.author;
  elements.operationStatus.value =
    log.operationStatus || "";

  elements.logNote.value = log.note || "";

  appState.editorEntries = Array.isArray(log.entries)
    ? log.entries.map((entry) => {
        return {
          time: entry.time || "",
          category: entry.category || "TM 작업",
          tag: String(entry.tag || "").toUpperCase(),
          content: entry.content || ""
        };
      })
    : [];

  appState.editingEntryIndex = -1;

  resetLogEntryInput();
  renderLogEntryTable();

  renderSavedAttachments(log.attachments || []);

}


/* =========================================================
  작업 · 정비 · 인계 내역
  단일 입력창 + 누적 테이블
========================================================= */

function resetLogEntryInput(options = {}) {
  const {
    keepCategory = false,
    keepTag = false
  } = options;

  const previousCategory =
    elements.logEntryCategory?.value || "인계사항";

  const previousTag =
    elements.logEntryTag?.value || "";

  /*
    시간은 기본적으로 비워둔다.
    현재시간 체크박스를 누르면 현재 시간이 입력된다.
  */
  elements.logEntryTime.value = "";

  if (elements.useCurrentTimeCheckbox) {
    elements.useCurrentTimeCheckbox.checked = false;
  }

  /*
    새 입력을 시작할 때는 인계사항이 기본이다.
    수정 취소 등 일부 상황에서만 기존 구분을 유지한다.
  */
  elements.logEntryCategory.value = keepCategory
    ? previousCategory
    : "인계사항";

  elements.logEntryTag.value = keepTag
    ? previousTag
    : "";

  elements.logEntryContent.value = "";

  appState.editingEntryIndex = -1;

  elements.addLogEntryButton.textContent = "＋ 추가";
  elements.cancelLogEntryEditButton.hidden = true;

  elements.logEntryInputPanel.classList.remove(
    "is-editing"
  );

  elements.logEntryTableBody
    .querySelectorAll("tr.is-editing")
    .forEach((row) => {
      row.classList.remove("is-editing");
    });

  updateTagFieldVisibility();
}


function addOrUpdateLogEntry() {
  const normalizedTime = normalizeLogEntryTime();

  if (!normalizedTime) {
    showToast(
      "시간을 직접 입력하거나 현재시간을 체크해 주세요."
    );

    elements.logEntryTime.focus();
    return;
  }

  const category =
    elements.logEntryCategory.value || "인계사항";

  const needsTag =
    category.startsWith("TM") ||
    category.startsWith("BM") ||
    category.startsWith("CM");

  const tag = needsTag
    ? elements.logEntryTag.value
        .trim()
        .toUpperCase()
    : "";

  const content =
    elements.logEntryContent.value.trim();

  if (!category) {
    showToast("구분을 선택해 주세요.");
    elements.logEntryCategory.focus();
    return;
  }

  if (needsTag && !tag) {
    showToast(
      `${category} 내역은 TAG를 입력해 주세요.`
    );

    elements.logEntryTag.focus();
    return;
  }

  if (!content) {
    showToast("작업 내용을 입력해 주세요.");
    elements.logEntryContent.focus();
    return;
  }

  const entry = {
    time: normalizedTime,
    category,
    tag,
    content
  };

  if (appState.editingEntryIndex >= 0) {
    appState.editorEntries.splice(
      appState.editingEntryIndex,
      1,
      entry
    );

    showToast("작업 내역을 수정했습니다.");
  } else {
    appState.editorEntries.push(entry);
    showToast("작업 내역을 추가했습니다.");
  }

  renderLogEntryTable();

  /*
    추가 또는 수정 완료 후:
    시간 비움
    현재시간 체크 해제
    구분 인계사항
    TAG 비움 및 숨김
    내용 비움
  */
  resetLogEntryInput({
    keepCategory: false,
    keepTag: false
  });

  elements.logEntryContent.focus();
}


function renderLogEntryTable() {
  const entries = appState.editorEntries;

  elements.logEntryCount.textContent =
    `총 ${entries.length}건`;

  elements.logEntriesJson.value =
    JSON.stringify(entries);

  if (!entries.length) {
    elements.logEntryTableBody.innerHTML = `
      <tr class="log-entry-empty-row">
        <td colspan="4">
          등록된 작업 내역이 없습니다.
        </td>
      </tr>
    `;

    return;
  }

  elements.logEntryTableBody.innerHTML = entries
    .map((entry, index) => {
      const isEditing =
        index === appState.editingEntryIndex;

      const tagHtml = entry.tag
        ? `
          <button
            type="button"
            class="log-entry-content__tag"
            data-entry-action="navigator"
            data-entry-index="${index}"
            title="Facility Navigator에서 설비 보기"
          >
            [${escapeHtml(entry.tag)}]
          </button>
        `
        : "";

      return `
        <tr
          data-entry-index="${index}"
          class="${isEditing ? "is-editing" : ""}"
        >
          <td>
            ${escapeHtml(entry.time || "-")}
          </td>

          <td>
            ${escapeHtml(entry.category || "-")}
          </td>

          <td>
            <div class="log-entry-content">
              ${tagHtml}

              <span class="log-entry-content__text">
                ${escapeHtml(entry.content || "-")}
              </span>
            </div>
          </td>

          <td>
            <div class="log-entry-row-actions">
              <button
                type="button"
                class="log-entry-edit-button"
                data-entry-action="edit"
                data-entry-index="${index}"
              >
                수정
              </button>

              <button
                type="button"
                class="log-entry-delete-button"
                data-entry-action="delete"
                data-entry-index="${index}"
              >
                삭제
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function handleLogEntryTableClick(event) {
  const actionButton = event.target.closest(
    "[data-entry-action]"
  );

  if (!actionButton) {
    return;
  }

  const entryIndex = Number(
    actionButton.dataset.entryIndex
  );

  if (
    !Number.isInteger(entryIndex) ||
    !appState.editorEntries[entryIndex]
  ) {
    showToast("작업 내역을 찾을 수 없습니다.");
    return;
  }

  const action = actionButton.dataset.entryAction;

  if (action === "edit") {
    startLogEntryEdit(entryIndex);
    return;
  }

  if (action === "delete") {
    deleteLogEntry(entryIndex);
    return;
  }

  if (action === "navigator") {
    openFacilityNavigator(
      appState.editorEntries[entryIndex].tag
    );
  }
}


function startLogEntryEdit(entryIndex) {
  const entry = appState.editorEntries[entryIndex];

  if (!entry) {
    return;
  }

  appState.editingEntryIndex = entryIndex;

  elements.logEntryTime.value =
    entry.time || "";

  if (elements.useCurrentTimeCheckbox) {
    elements.useCurrentTimeCheckbox.checked = false;
  }

  elements.logEntryCategory.value =
    entry.category || "인계사항";

  elements.logEntryTag.value =
    entry.tag || "";

  elements.logEntryContent.value =
    entry.content || "";

  elements.addLogEntryButton.textContent =
    "수정 완료";

  elements.cancelLogEntryEditButton.hidden = false;

  elements.logEntryInputPanel.classList.add(
    "is-editing"
  );

  updateTagFieldVisibility();
  renderLogEntryTable();

  elements.logEntryInputPanel.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

  elements.logEntryContent.focus();
}


function cancelLogEntryEdit() {
  resetLogEntryInput({
    keepCategory: false,
    keepTag: false
  });

  renderLogEntryTable();
}


function deleteLogEntry(entryIndex) {
  const entry = appState.editorEntries[entryIndex];

  if (!entry) {
    return;
  }

  const shouldDelete = window.confirm(
    [
      "이 작업 내역을 삭제하시겠습니까?",
      "",
      `${entry.time || "-"} / ${entry.category || "-"}`,
      entry.tag || "",
      entry.content || ""
    ]
      .filter(Boolean)
      .join("\n")
  );

  if (!shouldDelete) {
    return;
  }

  appState.editorEntries.splice(entryIndex, 1);

  if (appState.editingEntryIndex === entryIndex) {
    resetLogEntryInput({
      keepCategory: true,
      keepTag: true
    });
  } else if (appState.editingEntryIndex > entryIndex) {
    appState.editingEntryIndex -= 1;
  }

  renderLogEntryTable();
  showToast("작업 내역을 삭제했습니다.");
}

function normalizeLogEntryTime() {
  const rawValue = String(elements.logEntryTime.value || "").trim();

  if (!rawValue) {
    return "";
  }

  const normalizedValue = rawValue
    .replace(/[.\s]/g, ":")
    .replace(/[^0-9:]/g, "");

  let hour = "";
  let minute = "";

  if (normalizedValue.includes(":")) {
    const parts = normalizedValue.split(":");

    hour = parts[0] || "";
    minute = parts[1] || "";
  } else {
    const digits = normalizedValue.replace(/\D/g, "");

    if (digits.length <= 2) {
      hour = digits;
      minute = "00";
    } else if (digits.length === 3) {
      hour = digits.slice(0, 1);
      minute = digits.slice(1);
    } else {
      hour = digits.slice(0, 2);
      minute = digits.slice(2, 4);
    }
  }

  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);

  if (
    !Number.isInteger(hourNumber) ||
    !Number.isInteger(minuteNumber) ||
    hourNumber < 0 ||
    hourNumber > 23 ||
    minuteNumber < 0 ||
    minuteNumber > 59
  ) {
    showToast("시간을 00:00부터 23:59 사이로 입력해 주세요.");
    elements.logEntryTime.focus();
    elements.logEntryTime.select();
    return "";
  }

  const formattedTime = [
    String(hourNumber).padStart(2, "0"),
    String(minuteNumber).padStart(2, "0")
  ].join(":");

  elements.logEntryTime.value = formattedTime;

  return formattedTime;
}

function updateTagFieldVisibility() {

    const value =
        elements.logEntryCategory.value;

    const needTag =
        value.startsWith("TM") ||
        value.startsWith("BM") ||
        value.startsWith("CM");

    elements.logEntryTagField.hidden =
        !needTag;

    if (!needTag) {
        elements.logEntryTag.value = "";
    }

}

function getCurrentTimeValue() {
  const now = new Date();

  return [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0")
  ].join(":");
}


/* =========================================================
  TAG / Facility Navigator
========================================================= */
function openFacilityNavigator(rawTag) {
  const tag = String(rawTag || "").trim().toUpperCase();

  if (!tag) {
    showToast("먼저 TAG를 입력해 주세요.");
    return;
  }

  const targetUrl =
    `${FACILITY_NAVIGATOR_URL}?tag=${encodeURIComponent(tag)}`;

  window.open(targetUrl, "_blank", "noopener,noreferrer");
}


/* =========================================================
  첨부파일
========================================================= */
function renderAttachmentList() {
  const files = [...elements.logAttachments.files];

  if (!files.length) {
    elements.attachmentList.innerHTML = "";
    return;
  }

  elements.attachmentList.innerHTML = files
    .map((file) => {
      return `
        <span class="attachment-chip">
          ${escapeHtml(file.name)}
        </span>
      `;
    })
    .join("");
}


function renderSavedAttachments(attachments) {
  if (!attachments.length) {
    elements.attachmentList.innerHTML = "";
    return;
  }

  elements.attachmentList.innerHTML = attachments
    .map((fileName) => {
      return `
        <span class="attachment-chip">
          ${escapeHtml(fileName)}
        </span>
      `;
    })
    .join("");
}


/* =========================================================
  저장
========================================================= */
function collectEditorData(status) {
  const entries = appState.editorEntries.map((entry) => {
    return {
      time: entry.time || "",
      category: entry.category || "",
      tag: String(entry.tag || "")
        .trim()
        .toUpperCase(),
      content: String(entry.content || "").trim()
    };
  });

  const newAttachmentNames = [
    ...elements.logAttachments.files
  ].map((file) => file.name);

  const savedAttachmentNames = [
    ...elements.attachmentList.querySelectorAll(
      ".attachment-chip"
    )
  ].map((chip) => chip.textContent.trim());

  const attachmentNames = [
    ...new Set([
      ...savedAttachmentNames,
      ...newAttachmentNames
    ])
  ];

  const editingId =
    elements.logEditorForm.dataset.editingId;

  return {
    id: editingId || createId(),
    date: elements.logDate.value,
    shift: elements.logShift.value,
    team: elements.logTeam.value,
    role: elements.logRole.value,
    author: elements.logAuthor.value.trim(),
    operationStatus:
      elements.operationStatus.value.trim(),
    entries,
    note: elements.logNote.value.trim(),
    attachments: attachmentNames,
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}


function saveCurrentLog(status) {
  if (!elements.logEditorForm.reportValidity()) {
    return;
  }

  const log = collectEditorData(status);

  if (
    !log.operationStatus &&
    !log.entries.some((entry) => entry.content) &&
    !log.note
  ) {
    showToast("운전 현황 또는 업무 내용을 입력해 주세요.");
    return;
  }

  const existingIndex = appState.logs.findIndex(
    (item) => item.id === log.id
  );

  if (existingIndex >= 0) {
    log.createdAt = appState.logs[existingIndex].createdAt;
    appState.logs.splice(existingIndex, 1, log);
  } else {
    appState.logs.unshift(log);
  }

  persistLogs();
  localStorage.removeItem(STORAGE_KEYS.draft);

  appState.selectedDate = new Date(`${log.date}T00:00:00`);
  appState.selectedShift = log.shift;

  renderSelectedDate();
  renderLogTable();
  closeLogEditor();

  showToast(
    status === "결재요청"
      ? "업무일지를 저장하고 결재를 요청했습니다."
      : "업무일지를 저장했습니다."
  );
}


function saveDraft() {
  const draft = collectEditorData("임시저장");

  localStorage.setItem(
    STORAGE_KEYS.draft,
    JSON.stringify(draft)
  );

  showToast("작성 중인 업무일지를 임시저장했습니다.");
}


function restoreDraftIfAvailable() {
  const rawDraft = localStorage.getItem(STORAGE_KEYS.draft);

  if (!rawDraft) {
    return;
  }

  let draft;

  try {
    draft = JSON.parse(rawDraft);
  } catch {
    localStorage.removeItem(STORAGE_KEYS.draft);
    return;
  }

  const shouldRestore = window.confirm(
    "임시저장된 업무일지가 있습니다.\n불러오시겠습니까?"
  );

  if (!shouldRestore) {
    return;
  }

  fillLogEditor(draft);
  elements.logEditorForm.dataset.editingId = "";
  elements.logEditorTitle.textContent = "업무일지 작성";
}


function persistLogs() {
  localStorage.setItem(
    STORAGE_KEYS.logs,
    JSON.stringify(appState.logs)
  );
}


function loadLogs() {
  const savedLogs = localStorage.getItem(STORAGE_KEYS.logs);

  if (savedLogs) {
    try {
      appState.logs = JSON.parse(savedLogs);
      return;
    } catch {
      localStorage.removeItem(STORAGE_KEYS.logs);
    }
  }

  appState.logs = createSampleLogs();
  persistLogs();
}


/* =========================================================
  업무일지 목록
========================================================= */
function renderLogTable() {
  const selectedDateText =
    formatInputDate(appState.selectedDate);

  const filteredLogs =
    appState.logs.filter((log) => {
      return (
        log.date === selectedDateText &&
        log.shift === appState.selectedShift
      );
    });

  elements.logTableBody.innerHTML = "";

  elements.logEmptyState.hidden =
    filteredLogs.length > 0;

  if (!filteredLogs.length) {
    updateShiftMemberCardStates();
    return;
  }

  filteredLogs.forEach((log) => {
    elements.logTableBody.insertAdjacentHTML(
      "beforeend",
      createLogRowHtml(log)
    );
  });

  updateShiftMemberCardStates();
}


function createLogRowHtml(log) {
  const previewGroups = [];

  if (log.operationStatus) {
    previewGroups.push({
      title: "운전현황",
      text: firstMeaningfulLine(log.operationStatus),
      categoryClass: "is-operation"
    });
  }

  const firstEntry = log.entries?.find(
    (entry) => entry.content
  );

  if (firstEntry) {
    const mainCategory = getMainCategory(
      firstEntry.category
    );

    const tagText = firstEntry.tag
      ? `[${firstEntry.tag}]`
      : "";

    previewGroups.push({
      title: mainCategory,
      tag: tagText,
      text: firstMeaningfulLine(firstEntry.content),
      categoryClass:
        mainCategory === "인계사항"
          ? "is-handover"
          : "is-maintenance"
    });
  }

  if (log.note && previewGroups.length < 3) {
    previewGroups.push({
      title: "비고",
      text: firstMeaningfulLine(log.note),
      categoryClass: "is-note"
    });
  }

  const attachmentCount = Array.isArray(log.attachments)
    ? log.attachments.length
    : 0;

  return `
    <tr class="log-row">
      <td class="log-row__role">
        ${escapeHtml(log.role || "-")}
      </td>

      <td class="log-row__author-cell">
        <strong class="log-row__author">
          ${escapeHtml(log.author || "-")}
        </strong>
      </td>

      <td class="log-row__status-cell">
        <span
          class="status-badge ${getStatusClass(log.status)}"
        >
          ${escapeHtml(log.status || "-")}
        </span>
      </td>

      <td class="log-row__attachment-cell">
        ${
          attachmentCount > 0
            ? `
              <span
                class="attachment-indicator"
                title="첨부파일 ${attachmentCount}개"
                aria-label="첨부파일 ${attachmentCount}개"
              >
                📎
              </span>
            `
            : `
              <span
                class="attachment-indicator is-empty"
                aria-label="첨부파일 없음"
              >
                -
              </span>
            `
        }
      </td>

      <td class="log-row__preview-cell">
        <button
          type="button"
          class="log-preview"
          data-action="view"
          data-log-id="${escapeHtml(log.id)}"
          aria-label="${escapeHtml(log.author || "")} 업무일지 상세보기"
        >
          ${
            previewGroups.length
              ? previewGroups
                  .map((group) => {
                    return `
                      <span
                        class="
                          log-preview__group
                          ${group.categoryClass}
                        "
                      >
                        <strong
                          class="log-preview__title"
                        >
                          ${escapeHtml(group.title)}
                        </strong>

                        <span
                          class="log-preview__content"
                        >
                          ${
                            group.tag
                              ? `
                                <span
                                  class="log-preview__tag"
                                >
                                  ${escapeHtml(group.tag)}
                                </span>
                              `
                              : ""
                          }

                          <span
                            class="log-preview__text"
                          >
                            ${escapeHtml(group.text || "-")}
                          </span>
                        </span>
                      </span>
                    `;
                  })
                  .join("")
              : `
                <span class="log-preview__empty">
                  등록된 업무 내용이 없습니다.
                </span>
              `
          }
        </button>
      </td>

      <td class="log-row__actions-cell">
        <div class="row-actions">
          <button
            type="button"
            class="table-action-button"
            data-action="view"
            data-log-id="${escapeHtml(log.id)}"
          >
            보기
          </button>

          <button
            type="button"
            class="table-action-button"
            data-action="edit"
            data-log-id="${escapeHtml(log.id)}"
          >
            수정
          </button>
        </div>
      </td>
    </tr>
  `;
}


function handleLogTableClick(event) {
  const actionButton = event.target.closest("[data-action]");

  if (!actionButton) {
    return;
  }

  const log = appState.logs.find(
    (item) => item.id === actionButton.dataset.logId
  );

  if (!log) {
    showToast("업무일지를 찾을 수 없습니다.");
    return;
  }

  if (actionButton.dataset.action === "edit") {
    openLogEditor(log);
    return;
  }

  openLogDetail(log);
}


function getStatusClass(status) {
  if (status === "결재완료" || status === "결재요청") {
    return "is-approved";
  }

  if (status === "작성중" || status === "임시저장") {
    return "is-writing";
  }

  return "is-saved";
}


/* =========================================================
  상세보기
========================================================= */
function openLogDetail(log) {
  appState.currentDetailLogId = log.id;

  const entriesHtml = log.entries?.length
    ? log.entries
        .map((entry) => {
          return `
            <article class="detail-entry">
              <div class="detail-entry__meta">
                <strong>${escapeHtml(entry.category)}</strong>
                <span>${escapeHtml(entry.time || "-")}</span>
                ${
                  entry.tag
                    ? `
                      <button
                        type="button"
                        class="detail-tag-button"
                        data-detail-tag="${escapeHtml(entry.tag)}"
                      >
                        ${escapeHtml(entry.tag)}
                      </button>
                    `
                    : ""
                }
              </div>

              <p>${escapeHtml(entry.content || "-")}</p>
            </article>
          `;
        })
        .join("")
    : `<p class="detail-empty">등록된 작업 내역이 없습니다.</p>`;

  elements.logDetailContent.innerHTML = `
    <section class="detail-summary-grid">
      <div>
        <span>작성일</span>
        <strong>${escapeHtml(log.date)}</strong>
      </div>

      <div>
        <span>근무</span>
        <strong>${escapeHtml(log.shift)}</strong>
      </div>

      <div>
        <span>근무조</span>
        <strong>${escapeHtml(log.team)}</strong>
      </div>

      <div>
        <span>보직</span>
        <strong>${escapeHtml(log.role)}</strong>
      </div>

      <div>
        <span>작성자</span>
        <strong>${escapeHtml(log.author)}</strong>
      </div>

      <div>
        <span>상태</span>
        <strong>${escapeHtml(log.status)}</strong>
      </div>
    </section>

    <section class="detail-section">
      <h3>운전 현황</h3>
      <p class="detail-multiline">
        ${escapeHtml(log.operationStatus || "등록된 내용이 없습니다.")}
      </p>
    </section>

    <section class="detail-section">
      <h3>작업 · 정비 · 인계 내역</h3>
      <div class="detail-entry-list">
        ${entriesHtml}
      </div>
    </section>

    <section class="detail-section">
      <h3>비고</h3>
      <p class="detail-multiline">
        ${escapeHtml(log.note || "등록된 내용이 없습니다.")}
      </p>
    </section>

    <section class="detail-section">
      <h3>첨부파일</h3>
      <div class="attachment-list">
        ${
          log.attachments.length
            ? log.attachments
                .map((fileName) => {
                  return `
                    <span class="attachment-chip">
                      ${escapeHtml(fileName)}
                    </span>
                  `;
                })
                .join("")
            : `<span class="detail-empty">첨부파일 없음</span>`
        }
      </div>
    </section>
  `;

  elements.logDetailContent
    .querySelectorAll("[data-detail-tag]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        openFacilityNavigator(button.dataset.detailTag);
      });
    });

  openModal(elements.logDetailModal);
}


function closeLogDetail() {
  appState.currentDetailLogId = null;
  closeModal(elements.logDetailModal);
}


/* =========================================================
  조회
========================================================= */
function runSearch() {
  const formData = new FormData(elements.searchForm);

  const startDate = String(formData.get("startDate") || "");
  const endDate = String(formData.get("endDate") || "");
  const shift = String(formData.get("shift") || "");
  const role = String(formData.get("role") || "");
  const category = String(formData.get("category") || "");
  const keyword = String(formData.get("keyword") || "")
    .trim()
    .toLowerCase();

  const results = [];

  appState.logs.forEach((log) => {
    if (startDate && log.date < startDate) {
      return;
    }

    if (endDate && log.date > endDate) {
      return;
    }

    if (shift && log.shift !== shift) {
      return;
    }

    if (role && log.role !== role) {
      return;
    }

    if (
      !category ||
      category === "operation" ||
      category === "note"
    ) {
      if (
        (!category || category === "operation") &&
        matchesKeyword(log.operationStatus, keyword)
      ) {
        results.push({
          log,
          category: "운전현황",
          tag: "",
          content: log.operationStatus
        });
      }

      if (
        (!category || category === "note") &&
        matchesKeyword(log.note, keyword)
      ) {
        results.push({
          log,
          category: "비고",
          tag: "",
          content: log.note
        });
      }
    }

    log.entries.forEach((entry) => {
      const mainCategory = getMainCategory(entry.category);
      const normalizedCategory = mainCategory.toLowerCase();

      if (
        category &&
        category !== normalizedCategory &&
        !(category === "handover" && mainCategory === "인계사항")
      ) {
        return;
      }

      const combinedText =
        `${entry.tag} ${entry.content} ${entry.category}`.toLowerCase();

      if (keyword && !combinedText.includes(keyword)) {
        return;
      }

      results.push({
        log,
        category: entry.category,
        tag: entry.tag,
        content: entry.content
      });
    });
  });

  renderSearchResults(results);
}


function renderSearchResults(results) {
  elements.searchResultBody.innerHTML = "";
  elements.searchResultCount.textContent = String(results.length);
  elements.searchEmptyState.hidden = results.length > 0;

  if (!results.length) {
    elements.searchEmptyState.querySelector("strong").textContent =
      "조회 결과가 없습니다.";
    elements.searchEmptyState.querySelector("p").textContent =
      "검색 조건을 변경하여 다시 조회해 주세요.";
    return;
  }

  results.forEach((result) => {
    const { log } = result;

    elements.searchResultBody.insertAdjacentHTML(
      "beforeend",
      `
        <tr>
          <td>${escapeHtml(log.date)}</td>
          <td>${escapeHtml(log.shift)}</td>
          <td>${escapeHtml(log.role)}</td>
          <td>${escapeHtml(log.author)}</td>
          <td>${escapeHtml(result.category)}</td>
          <td>
            ${
              result.tag
                ? `
                  <button
                    type="button"
                    class="detail-tag-button"
                    data-search-tag="${escapeHtml(result.tag)}"
                  >
                    ${escapeHtml(result.tag)}
                  </button>
                `
                : "-"
            }
          </td>
          <td>${escapeHtml(firstMeaningfulLine(result.content || "-"))}</td>
          <td>
            <button
              type="button"
              class="table-action-button"
              data-search-view="${escapeHtml(log.id)}"
            >
              보기
            </button>
          </td>
        </tr>
      `
    );
  });

  elements.searchResultBody
    .querySelectorAll("[data-search-tag]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        openFacilityNavigator(button.dataset.searchTag);
      });
    });

  elements.searchResultBody
    .querySelectorAll("[data-search-view]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const log = appState.logs.find(
          (item) => item.id === button.dataset.searchView
        );

        if (log) {
          openLogDetail(log);
        }
      });
    });
}


function matchesKeyword(text, keyword) {
  if (!text) {
    return false;
  }

  if (!keyword) {
    return true;
  }

  return String(text).toLowerCase().includes(keyword);
}


/* =========================================================
  모달 / 토스트
========================================================= */
function openModal(modalElement) {
  modalElement.classList.add("is-open");
  modalElement.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}


function closeModal(modalElement) {
  modalElement.classList.remove("is-open");
  modalElement.setAttribute("aria-hidden", "true");

  const anyOpenModal = document.querySelector(
    ".modal-backdrop.is-open"
  );

  if (!anyOpenModal) {
    document.body.classList.remove("modal-open");
  }
}


let toastTimer = null;

function showToast(message) {
  window.clearTimeout(toastTimer);

  elements.appToast.textContent = message;
  elements.appToast.classList.add("is-visible");

  toastTimer = window.setTimeout(() => {
    elements.appToast.classList.remove("is-visible");
  }, 2600);
}


/* =========================================================
  공통
========================================================= */
function firstMeaningfulLine(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}


function getMainCategory(category) {
  const value = String(category || "");

  if (value.startsWith("TM")) {
    return "TM";
  }

  if (value.startsWith("BM")) {
    return "BM";
  }

  if (value.startsWith("CM")) {
    return "CM";
  }

  if (value === "인계사항") {
    return "인계사항";
  }

  return "비고";
}


function createId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `log-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
}


function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


/* =========================================================
  샘플 데이터
========================================================= */
function createSampleLogs() {
  return [
    {
      id: "sample-1",
      date: "2026-07-20",
      shift: "NS",
      team: "3조",
      role: "파트장",
      author: "홍길동",
      operationStatus:
        "#1 주보일러 정상운전\n#2 주보일러 정상운전\nGT / ST 정상운전",
      entries: [
        {
          time: "09:50",
          category: "TM 작업",
          tag: "10HFB10AF001",
          content: "Bio Rotary Feeder Bearing 점검"
        },
        {
          time: "18:20",
          category: "인계사항",
          tag: "",
          content: "주간근무 시 #1 석회석 공급계통 확인"
        }
      ],
      note: "특이사항 없음",
      attachments: [
        "TM_Bio_Rotary_Feeder.pdf",
        "현장사진.jpg"
      ],
      status: "결재완료",
      createdAt: "2026-07-20T09:00:00.000Z",
      updatedAt: "2026-07-20T13:00:00.000Z"
    },
    {
      id: "sample-2",
      date: "2026-07-20",
      shift: "NS",
      team: "3조",
      role: "TGO",
      author: "김철수",
      operationStatus: "GT / ST 정상운전",
      entries: [
        {
          time: "11:20",
          category: "BM 작업",
          tag: "10LBA10AA001",
          content: "Main Steam TCV 동작 상태 확인"
        }
      ],
      note: "",
      attachments: [],
      status: "작성중",
      createdAt: "2026-07-20T10:00:00.000Z",
      updatedAt: "2026-07-20T11:30:00.000Z"
    },
    {
      id: "sample-3",
      date: "2026-07-20",
      shift: "NS",
      team: "3조",
      role: "BCO1",
      author: "이영희",
      operationStatus: "#1, #2 보일러 정상운전",
      entries: [
        {
          time: "14:10",
          category: "CM 작업",
          tag: "10HFB10AF001",
          content: "진동 상태 확인"
        }
      ],
      note: "특이사항 없음",
      attachments: ["진동측정.jpg"],
      status: "저장완료",
      createdAt: "2026-07-20T13:10:00.000Z",
      updatedAt: "2026-07-20T14:20:00.000Z"
    }
  ];
}
