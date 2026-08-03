"use strict";


document.addEventListener(
  "DOMContentLoaded",
  () => {
    initializeHighPressureGasCheck();
  }
);


/* =========================================================
  고압가스 저장시설 주간점검표 초기화
========================================================= */

function initializeHighPressureGasCheck() {
  const sheet =
    document.getElementById(
      "gasCheckSheet"
    );


  const inspectionDate =
    document.getElementById(
      "gasInspectionDate"
    );


  const saveButton =
    document.getElementById(
      "gasCheckSaveButton"
    );


  const previewButton =
    document.getElementById(
      "gasCheckPreviewButton"
    );


  const previewModal =
    document.getElementById(
      "gasPrintPreview"
    );


  const previewBody =
    document.getElementById(
      "gasPrintPreviewBody"
    );


  const previewCloseButton =
    document.getElementById(
      "gasPreviewCloseButton"
    );


  const previewCancelButton =
    document.getElementById(
      "gasPreviewCancelButton"
    );


  const printButton =
    document.getElementById(
      "gasPrintButton"
    );


  if (
    !sheet ||
    !inspectionDate
  ) {
    return;
  }


  /* =======================================================
    저장 대상 입력칸
  ======================================================= */

  const inputIds = [
    "gasSafetyManager",
    "gasSafetyGeneralManager",
    "gasInspectionDate",
    "gasInspectorName",
    "gasOverallResult",
    "gasResult1",
    "gasResult2",
    "gasResult3",
    "gasResult4",
    "gasResult5",
    "gasResult6",
    "gasResult7",
    "gasResult8",
    "gasResult9",
    "gasResult10",
    "gasResult11",
    "gasResult12",
    "gasWorkplaceConfirmation",
    "gasFinalInspector"
  ];


  /* =======================================================
    오늘 날짜
  ======================================================= */

  function getTodayDateValue() {
    const now =
      new Date();


    const year =
      now.getFullYear();


    const month =
      String(
        now.getMonth() +
        1
      ).padStart(
        2,
        "0"
      );


    const date =
      String(
        now.getDate()
      ).padStart(
        2,
        "0"
      );


    return `${year}-${month}-${date}`;
  }


  /* =======================================================
    사용자 이름 가져오기
  ======================================================= */

  function getCurrentUserName() {
    try {
      const savedUser =
        localStorage.getItem(
          "gsShiftLog.currentUser"
        );


      if (
        !savedUser
      ) {
        return "";
      }


      const user =
        JSON.parse(
          savedUser
        );


      return String(
        user?.name ||
        user?.userName ||
        user?.user_name ||
        user?.memberName ||
        ""
      ).trim();

    } catch (
      error
    ) {
      return "";
    }
  }


  /* =======================================================
    저장 키

    점검일자별로 따로 저장
  ======================================================= */

  function getStorageKey() {
    const dateValue =
      String(
        inspectionDate.value ||
        getTodayDateValue()
      ).trim();


    return (
      "inspectionLogs.weekly.highPressureGas." +
      dateValue
    );
  }


  /* =======================================================
    현재 입력값 수집
  ======================================================= */

  function collectFormData() {
    const result = {};


    inputIds.forEach(
      id => {
        const element =
          document.getElementById(
            id
          );


        if (
          element
        ) {
          result[id] =
            String(
              element.value ||
              ""
            );
        }
      }
    );


    result.savedAt =
      new Date().toISOString();


    return result;
  }


  /* =======================================================
    임시저장
  ======================================================= */

  function saveFormData(
    showMessage = true
  ) {
    const storageKey =
      getStorageKey();


    const formData =
      collectFormData();


    localStorage.setItem(
      storageKey,
      JSON.stringify(
        formData
      )
    );


    if (
      showMessage
    ) {
      window.alert(
        "고압가스 주간점검표가 임시저장되었습니다."
      );
    }
  }


  /* =======================================================
    저장된 내용 불러오기
  ======================================================= */

  function loadFormData() {
    const storageKey =
      getStorageKey();


    const savedValue =
      localStorage.getItem(
        storageKey
      );


    if (
      !savedValue
    ) {
      return;
    }


    try {
      const formData =
        JSON.parse(
          savedValue
        );


      inputIds.forEach(
        id => {
          if (
            id ===
            "gasInspectionDate"
          ) {
            return;
          }


          const element =
            document.getElementById(
              id
            );


          if (
            element &&
            Object.prototype
              .hasOwnProperty
              .call(
                formData,
                id
              )
          ) {
            element.value =
              String(
                formData[id] ||
                ""
              );
          }
        }
      );

    } catch (
      error
    ) {
      console.error(
        "고압가스 점검표 불러오기 실패:",
        error
      );
    }
  }


  /* =======================================================
    미리보기용 복제본 생성

    입력칸을 인쇄용 텍스트로 변환
  ======================================================= */

  function createPreviewSheet() {
    const clonedSheet =
      sheet.cloneNode(
        true
      );


    clonedSheet.removeAttribute(
      "id"
    );


    const originalInputs =
      Array.from(
        sheet.querySelectorAll(
          "input"
        )
      );


    const clonedInputs =
      Array.from(
        clonedSheet.querySelectorAll(
          "input"
        )
      );


    clonedInputs.forEach(
      (
        clonedInput,
        index
      ) => {
        const originalInput =
          originalInputs[index];


        const value =
          String(
            originalInput?.value ||
            ""
          ).trim();


        const printValue =
          document.createElement(
            "span"
          );


        printValue.className =
          "gas-check-print-value";


        if (
          originalInput?.type ===
          "date" &&
          value
        ) {
          printValue.textContent =
            formatDateForPrint(
              value
            );

        } else {
          printValue.textContent =
            value;
        }


        clonedInput.replaceWith(
          printValue
        );
      }
    );


    return clonedSheet;
  }


  /* =======================================================
    날짜 인쇄 형식
  ======================================================= */

  function formatDateForPrint(
    dateValue
  ) {
    const parts =
      String(
        dateValue ||
        ""
      ).split(
        "-"
      );


    if (
      parts.length !==
      3
    ) {
      return dateValue;
    }


    return (
      `${parts[0]} 년 ` +
      `${Number(parts[1])} 월 ` +
      `${Number(parts[2])} 일`
    );
  }


  /* =======================================================
    인쇄 미리보기 열기
  ======================================================= */

  function openPrintPreview() {
    if (
      !previewModal ||
      !previewBody
    ) {
      return;
    }


    saveFormData(
      false
    );


    previewBody.innerHTML =
      "";


    previewBody.appendChild(
      createPreviewSheet()
    );


    previewModal.hidden =
      false;


    document.body.style.overflow =
      "hidden";
  }


  /* =======================================================
    인쇄 미리보기 닫기
  ======================================================= */

  function closePrintPreview() {
    if (
      !previewModal
    ) {
      return;
    }


    previewModal.hidden =
      true;


    document.body.style.overflow =
      "";
  }


  /* =======================================================
    실제 인쇄

    메인 점검표 입력값을 그대로 출력
  ======================================================= */

  function printInspectionSheet() {
    saveFormData(
      false
    );


    closePrintPreview();


    window.setTimeout(
      () => {
        window.print();
      },
      100
    );
  }


  /* =======================================================
    최초 기본값
  ======================================================= */

  if (
    !inspectionDate.value
  ) {
    inspectionDate.value =
      getTodayDateValue();
  }


  const currentUserName =
    getCurrentUserName();


  const inspectorNameInput =
    document.getElementById(
      "gasInspectorName"
    );


  const finalInspectorInput =
    document.getElementById(
      "gasFinalInspector"
    );


  if (
    inspectorNameInput &&
    !inspectorNameInput.value &&
    currentUserName
  ) {
    inspectorNameInput.value =
      currentUserName;
  }


  if (
    finalInspectorInput &&
    !finalInspectorInput.value &&
    currentUserName
  ) {
    finalInspectorInput.value =
      currentUserName;
  }


  loadFormData();


  /* =======================================================
    날짜 변경 시 해당 날짜 자료 불러오기
  ======================================================= */

  inspectionDate.addEventListener(
    "change",
    () => {
      inputIds.forEach(
        id => {
          if (
            id ===
            "gasInspectionDate"
          ) {
            return;
          }


          const element =
            document.getElementById(
              id
            );


          if (
            element
          ) {
            element.value =
              "";
          }
        }
      );


      if (
        inspectorNameInput &&
        currentUserName
      ) {
        inspectorNameInput.value =
          currentUserName;
      }


      if (
        finalInspectorInput &&
        currentUserName
      ) {
        finalInspectorInput.value =
          currentUserName;
      }


      loadFormData();
    }
  );


  /* =======================================================
    버튼 이벤트
  ======================================================= */

  saveButton?.addEventListener(
    "click",
    () => {
      saveFormData(
        true
      );
    }
  );


  previewButton?.addEventListener(
    "click",
    () => {
      openPrintPreview();
    }
  );


  previewCloseButton?.addEventListener(
    "click",
    () => {
      closePrintPreview();
    }
  );


  previewCancelButton?.addEventListener(
    "click",
    () => {
      closePrintPreview();
    }
  );


  printButton?.addEventListener(
    "click",
    () => {
      printInspectionSheet();
    }
  );


  previewModal?.addEventListener(
    "click",
    event => {
      if (
        event.target ===
        previewModal
      ) {
        closePrintPreview();
      }
    }
  );


  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key ===
          "Escape" &&
        previewModal &&
        !previewModal.hidden
      ) {
        closePrintPreview();
      }
    }
  );
}