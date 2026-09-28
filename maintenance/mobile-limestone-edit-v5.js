"use strict";

/*
 * =========================================================
 * MOBILE LIMESTONE EDIT MODAL V5 R2
 *
 * Mobile only.
 *
 * - Intercepts Limestone Edit button.
 * - Does NOT use legacy nested Limestone editor.
 * - Opens an independent body-level modal.
 * - PUT /api/limestone-receipts
 * - Existing note is preserved.
 * - Delete is untouched.
 * =========================================================
 */

(function installMobileLimestoneEditV5() {
  if (window.__mobileLimestoneEditV5Installed === true) {
    return;
  }

  window.__mobileLimestoneEditV5Installed = true;

  const API =
    "/api/limestone-receipts";

  const MOBILE_QUERY =
    "(max-width: 768px)";

  let activeReceipt =
    null;

  let savePending =
    false;


  function isMobile() {
    return window
      .matchMedia(
        MOBILE_QUERY
      )
      .matches;
  }


  function elements() {
    return {
      modal:
        document.getElementById(
          "mobileLimestoneEditModal"
        ),

      form:
        document.getElementById(
          "mobileLimestoneEditForm"
        ),

      close:
        document.getElementById(
          "closeMobileLimestoneEditModal"
        ),

      cancel:
        document.getElementById(
          "cancelMobileLimestoneEditModal"
        ),

      save:
        document.getElementById(
          "saveMobileLimestoneEditModal"
        ),

      date:
        document.getElementById(
          "mobileLimestoneEditDate"
        ),

      time:
        document.getElementById(
          "mobileLimestoneEditTime"
        ),

      unit:
        document.getElementById(
          "mobileLimestoneEditUnit"
        ),

      quantity:
        document.getElementById(
          "mobileLimestoneEditQuantity"
        ),

      status:
        document.getElementById(
          "mobileLimestoneEditStatus"
        )
    };
  }


  function headers(
    extra = {}
  ) {
    if (
      typeof window
        .getShiftLogAuthHeaders ===
      "function"
    ) {
      return window
        .getShiftLogAuthHeaders(
          extra
        );
    }

    return {
      Accept:
        "application/json",

      ...extra
    };
  }


  async function readJson(
    response
  ) {
    const text =
      await response.text();

    if (!text.trim()) {
      return {};
    }

    try {
      return JSON.parse(
        text
      );

    } catch {
      throw new Error(
        "서버 응답 형식을 확인하지 못했습니다."
      );
    }
  }


  function status(
    message
  ) {
    const {
      status: node
    } =
      elements();

    if (!node) {
      return;
    }

    const text =
      String(
        message ||
        ""
      ).trim();

    node.textContent =
      text;

    node.hidden =
      !text;
  }


  function normalizeReceipt(
    receipt
  ) {
    if (!receipt) {
      return null;
    }

    return {
      ...receipt,

      id:
        receipt.id,

      revision:
        Number(
          receipt.revision ||
          1
        ),

      receiptDate:
        String(
          receipt.receiptDate ??
          receipt.receipt_date ??
          ""
        ),

      receiptTime:
        String(
          receipt.receiptTime ??
          receipt.receipt_time ??
          ""
        ),

      unitNo:
        Number(
          receipt.unitNo ??
          receipt.unit_no ??
          0
        ),

      quantityTon:
        Number(
          receipt.quantityTon ??
          receipt.quantity_ton ??
          0
        ),

      note:
        String(
          receipt.note ||
          ""
        )
    };
  }


  function rowDate(
    button
  ) {
    const row =
      button.closest(
        "tr"
      );

    if (!row) {
      return "";
    }

    const firstCell =
      row.querySelector(
        "td"
      );

    const raw =
      String(
        firstCell?.textContent ||
        ""
      ).trim();

    const match =
      raw.match(
        /\d{4}-\d{2}-\d{2}/
      );

    return match
      ? match[0]
      : "";
  }


  async function fetchReceipt(
    id,
    button
  ) {
    const receiptId =
      String(
        id ||
        ""
      ).trim();

    if (!receiptId) {
      throw new Error(
        "입고기록 ID를 확인할 수 없습니다."
      );
    }

    const url =
      new URL(
        API,
        window.location.origin
      );

    const date =
      rowDate(
        button
      );

    if (date) {
      url.searchParams.set(
        "startDate",
        date
      );

      url.searchParams.set(
        "endDate",
        date
      );
    }

    url.searchParams.set(
      "_",
      String(
        Date.now()
      )
    );

    const response =
      await fetch(
        url.toString(),
        {
          method:
            "GET",

          headers:
            headers({
              Accept:
                "application/json"
            }),

          cache:
            "no-store"
        }
      );

    const result =
      await readJson(
        response
      );

    if (
      !response.ok ||
      result.ok === false
    ) {
      throw new Error(
        result.message ||
        result.error ||
        `입고기록 조회 실패 (HTTP ${response.status})`
      );
    }

    const items =
      Array.isArray(
        result.items
      )
        ? result.items
        : Array.isArray(
            result.data?.items
          )
          ? result.data.items
          : [];

    const found =
      items.find(
        item =>
          String(
            item?.id ||
            ""
          ) ===
          receiptId
      );

    if (!found) {
      throw new Error(
        "선택한 입고기록을 찾지 못했습니다. 새로고침 후 다시 시도해 주세요."
      );
    }

    return normalizeReceipt(
      found
    );
  }


  function closeModal() {
    const {
      modal,
      save
    } =
      elements();

    if (modal) {
      modal.hidden =
        true;

      modal.setAttribute(
        "hidden",
        ""
      );

      modal.setAttribute(
        "aria-hidden",
        "true"
      );
    }

    if (save) {
      save.disabled =
        false;

      save.textContent =
        "저장";
    }

    document.body
      .classList
      .remove(
        "is-mobile-limestone-edit-open"
      );

    activeReceipt =
      null;

    savePending =
      false;

    status(
      ""
    );
  }


  function openModal(
    receipt
  ) {
    const normalized =
      normalizeReceipt(
        receipt
      );

    if (!normalized) {
      return;
    }

    const {
      modal,
      date,
      time,
      unit,
      quantity
    } =
      elements();

    if (
      !modal ||
      !date ||
      !time ||
      !unit ||
      !quantity
    ) {
      window.alert(
        "모바일 석회석 수정창을 찾을 수 없습니다."
      );

      return;
    }

    /*
     * Legacy panel is PC-only now.
     * Make sure it never stays visible on mobile.
     */
    const legacy =
      document.getElementById(
        "limestoneReceiptEditorPanel"
      );

    if (legacy) {
      legacy.hidden =
        true;

      legacy.setAttribute(
        "hidden",
        ""
      );
    }

    activeReceipt =
      normalized;

    date.value =
      normalized.receiptDate;

    time.value =
      normalized.receiptTime;

    unit.value =
      String(
        normalized.unitNo
      );

    quantity.value =
      Number.isFinite(
        normalized.quantityTon
      )
        ? String(
            normalized.quantityTon
          )
        : "";

    status(
      ""
    );

    modal.hidden =
      false;

    modal.removeAttribute(
      "hidden"
    );

    modal.setAttribute(
      "aria-hidden",
      "false"
    );

    document.body
      .classList
      .add(
        "is-mobile-limestone-edit-open"
      );
  }


  async function save(
    event
  ) {
    event.preventDefault();

    if (
      savePending ||
      !activeReceipt
    ) {
      return;
    }

    const {
      date,
      time,
      unit,
      quantity,
      save
    } =
      elements();

    const receiptDate =
      String(
        date?.value ||
        ""
      ).trim();

    const receiptTime =
      String(
        time?.value ||
        ""
      ).trim();

    const unitNo =
      Number(
        unit?.value
      );

    const quantityTon =
      Number(
        quantity?.value
      );


    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(
        receiptDate
      )
    ) {
      status(
        "입고일자를 확인해 주세요."
      );

      date?.focus();

      return;
    }


    if (
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(
        receiptTime
      )
    ) {
      status(
        "입고시간을 확인해 주세요."
      );

      time?.focus();

      return;
    }


    if (
      ![
        1,
        2
      ].includes(
        unitNo
      )
    ) {
      status(
        "호기를 선택해 주세요."
      );

      unit?.focus();

      return;
    }


    if (
      !Number.isFinite(
        quantityTon
      ) ||
      quantityTon < 0.01 ||
      quantityTon > 999.99
    ) {
      status(
        "입고량은 0.01~999.99 ton 범위로 입력해 주세요."
      );

      quantity?.focus();

      return;
    }


    savePending =
      true;

    status(
      ""
    );

    if (save) {
      save.disabled =
        true;

      save.textContent =
        "저장 중...";
    }


    try {
      const response =
        await fetch(
          API,
          {
            method:
              "PUT",

            headers:
              headers({
                Accept:
                  "application/json",

                "Content-Type":
                  "application/json"
              }),

            body:
              JSON.stringify({
                id:
                  activeReceipt.id,

                revision:
                  activeReceipt.revision,

                receiptDate,

                receiptTime,

                unitNo,

                quantityTon,

                /*
                 * Hidden on mobile,
                 * but existing value is preserved.
                 */
                note:
                  activeReceipt.note
              }),

            cache:
              "no-store"
          }
        );

      const result =
        await readJson(
          response
        );

      if (
        !response.ok ||
        result.ok === false
      ) {
        throw new Error(
          result.message ||
          result.error ||
          `석회석 입고기록 수정 실패 (HTTP ${response.status})`
        );
      }

      closeModal();

      if (
        typeof window
          .loadLimestoneReceipts ===
        "function"
      ) {
        await window
          .loadLimestoneReceipts();
      }

      if (
        typeof window
          .showToast ===
        "function"
      ) {
        window.showToast(
          result.message ||
          "석회석 입고기록을 수정했습니다."
        );
      }

    } catch (
      error
    ) {
      console.error(
        "모바일 석회석 수정 실패:",
        error
      );

      status(
        error?.message ||
        "석회석 입고기록을 수정하지 못했습니다."
      );

    } finally {
      savePending =
        false;

      if (save) {
        save.disabled =
          false;

        save.textContent =
          "저장";
      }
    }
  }


  /*
   * Capture phase:
   * mobile Edit is handled here before
   * legacy tbody click handler sees it.
   */
  document.addEventListener(
    "click",
    async event => {
      if (!isMobile()) {
        return;
      }

      const target =
        event.target instanceof
          Element
          ? event.target
          : null;

      if (!target) {
        return;
      }

      const edit =
        target.closest(
          "#efficiencyLimestoneView [data-limestone-edit]"
        );

      if (!edit) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (edit.disabled) {
        return;
      }

      edit.disabled =
        true;

      try {
        const receipt =
          await fetchReceipt(
            edit.dataset
              .limestoneEdit,
            edit
          );

        openModal(
          receipt
        );

      } catch (
        error
      ) {
        console.error(
          "모바일 석회석 수정창 열기 실패:",
          error
        );

        window.alert(
          error?.message ||
          "석회석 입고기록을 불러오지 못했습니다."
        );

      } finally {
        edit.disabled =
          false;
      }
    },
    true
  );


  function bindModal() {
    const {
      modal,
      form,
      close,
      cancel
    } =
      elements();

    if (
      !modal ||
      !form
    ) {
      return;
    }

    if (
      modal.dataset
        .mobileLimestoneEditBound ===
      "1"
    ) {
      return;
    }

    modal.dataset
      .mobileLimestoneEditBound =
      "1";


    close?.addEventListener(
      "click",
      event => {
        event.preventDefault();
        closeModal();
      }
    );


    cancel?.addEventListener(
      "click",
      event => {
        event.preventDefault();
        closeModal();
      }
    );


    form.addEventListener(
      "submit",
      save
    );


    modal.addEventListener(
      "click",
      event => {
        if (
          event.target ===
          modal
        ) {
          closeModal();
        }
      }
    );


    document.addEventListener(
      "keydown",
      event => {
        if (
          event.key ===
          "Escape" &&
          !modal.hidden
        ) {
          event.preventDefault();
          closeModal();
        }
      }
    );
  }


  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      bindModal,
      {
        once:
          true
      }
    );

  } else {
    bindModal();
  }
})();