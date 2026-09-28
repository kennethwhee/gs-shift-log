"use strict";

/*
 * =========================================================
 * MOBILE LIMESTONE EDIT V6 R2 UNIFORM CONTROLS
 *
 * Mobile only.
 *
 * Date     = YYYY-MM-DD plain text
 * Time     = HH:mm plain text
 * Unit     = normalized select
 * Quantity = normalized text + ton affix
 *
 * Existing note is preserved on PUT.
 * Delete and desktop behavior are untouched.
 * =========================================================
 */

(function installMobileLimestoneEditV6R2() {

  if (window.__mobileLimestoneEditV6R2Installed === true) {
    return;
  }

  window.__mobileLimestoneEditV6R2Installed = true;

  const API = "/api/limestone-receipts";

  let activeReceipt = null;
  let savePending = false;


  function isMobile() {
    return window.matchMedia("(max-width: 768px)").matches;
  }


  function elements() {
    return {
      modal: document.getElementById("mobileLimestoneEditModal"),
      form: document.getElementById("mobileLimestoneEditForm"),
      close: document.getElementById("closeMobileLimestoneEditModal"),
      cancel: document.getElementById("cancelMobileLimestoneEditModal"),
      save: document.getElementById("saveMobileLimestoneEditModal"),
      date: document.getElementById("mobileLimestoneEditDate"),
      time: document.getElementById("mobileLimestoneEditTime"),
      unit: document.getElementById("mobileLimestoneEditUnit"),
      quantity: document.getElementById("mobileLimestoneEditQuantity"),
      status: document.getElementById("mobileLimestoneEditStatus")
    };
  }


  function headers(extra = {}) {
    if (typeof window.getShiftLogAuthHeaders === "function") {
      return window.getShiftLogAuthHeaders(extra);
    }

    return {
      Accept: "application/json",
      ...extra
    };
  }


  async function readJson(response) {
    const text = await response.text();

    if (!text.trim()) {
      return {};
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(
        "서버 응답 형식을 확인하지 못했습니다."
      );
    }
  }


  function setStatus(message) {
    const node = elements().status;

    if (!node) {
      return;
    }

    const value = String(message || "").trim();

    node.textContent = value;
    node.hidden = !value;
  }


  function normalizeDate(value) {
    const raw = String(value || "").trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return raw;
    }

    const digits = raw.replace(/\D/g, "");

    if (digits.length !== 8) {
      return raw;
    }

    return (
      digits.slice(0, 4) +
      "-" +
      digits.slice(4, 6) +
      "-" +
      digits.slice(6, 8)
    );
  }


  function normalizeTime(value) {
    const raw = String(value || "").trim();

    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
      return raw;
    }

    const digits = raw.replace(/\D/g, "");

    if (digits.length === 3) {
      return (
        "0" +
        digits.slice(0, 1) +
        ":" +
        digits.slice(1)
      );
    }

    if (digits.length === 4) {
      return (
        digits.slice(0, 2) +
        ":" +
        digits.slice(2)
      );
    }

    return raw;
  }


  function normalizeQuantity(value) {
    return String(value || "")
      .replace(",", ".")
      .replace(/[^0-9.]/g, "");
  }


  function normalizeReceipt(receipt) {
    if (!receipt) {
      return null;
    }

    return {
      ...receipt,

      id: receipt.id,

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


  function getRowDate(button) {
    const row = button.closest("tr");

    const firstCell = row?.querySelector("td");

    const match = String(
      firstCell?.textContent ||
      ""
    ).match(
      /\d{4}-\d{2}-\d{2}/
    );

    return match ? match[0] : "";
  }


  async function fetchReceipt(id, button) {
    const receiptId = String(id || "").trim();

    if (!receiptId) {
      throw new Error(
        "입고기록 ID를 확인할 수 없습니다."
      );
    }

    const url = new URL(
      API,
      window.location.origin
    );

    const rowDate = getRowDate(button);

    if (rowDate) {
      url.searchParams.set(
        "startDate",
        rowDate
      );

      url.searchParams.set(
        "endDate",
        rowDate
      );
    }

    url.searchParams.set(
      "_",
      String(Date.now())
    );

    const response = await fetch(
      url.toString(),
      {
        method: "GET",
        headers: headers(),
        cache: "no-store"
      }
    );

    const result = await readJson(response);

    if (
      !response.ok ||
      result.ok === false
    ) {
      throw new Error(
        result.message ||
        result.error ||
        (
          "입고기록 조회 실패 (HTTP " +
          response.status +
          ")"
        )
      );
    }

    const items =
      Array.isArray(result.items)
        ? result.items
        : Array.isArray(result.data?.items)
          ? result.data.items
          : [];

    const found = items.find(
      item =>
        String(item?.id || "") ===
        receiptId
    );

    if (!found) {
      throw new Error(
        "선택한 입고기록을 찾지 못했습니다."
      );
    }

    return normalizeReceipt(found);
  }


  function closeModal() {
    const {
      modal,
      save
    } = elements();

    if (modal) {
      modal.hidden = true;
      modal.setAttribute("hidden", "");
      modal.setAttribute("aria-hidden", "true");
    }

    if (save) {
      save.disabled = false;
      save.textContent = "저장";
    }

    document.body.classList.remove(
      "is-mobile-limestone-edit-open"
    );

    activeReceipt = null;
    savePending = false;

    setStatus("");
  }


  function openModal(receipt) {
    const value = normalizeReceipt(receipt);

    if (!value) {
      return;
    }

    const {
      modal,
      date,
      time,
      unit,
      quantity
    } = elements();

    if (
      !modal ||
      !date ||
      !time ||
      !unit ||
      !quantity
    ) {
      window.alert(
        "모바일 수정창을 찾을 수 없습니다."
      );

      return;
    }

    activeReceipt = value;

    date.value = normalizeDate(
      value.receiptDate
    );

    time.value = normalizeTime(
      value.receiptTime
    );

    unit.value = String(
      value.unitNo
    );

    quantity.value =
      Number.isFinite(value.quantityTon)
        ? String(value.quantityTon)
        : "";

    setStatus("");

    modal.hidden = false;
    modal.removeAttribute("hidden");
    modal.setAttribute("aria-hidden", "false");

    document.body.classList.add(
      "is-mobile-limestone-edit-open"
    );
  }


  async function saveReceipt(event) {
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
    } = elements();

    const receiptDate =
      normalizeDate(
        date?.value
      );

    const receiptTime =
      normalizeTime(
        time?.value
      );

    const unitNo =
      Number(
        unit?.value
      );

    const quantityText =
      normalizeQuantity(
        quantity?.value
      );

    const quantityTon =
      Number(quantityText);


    if (date) {
      date.value = receiptDate;
    }

    if (time) {
      time.value = receiptTime;
    }

    if (quantity) {
      quantity.value = quantityText;
    }


    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(
        receiptDate
      )
    ) {
      setStatus(
        "입고일자를 YYYY-MM-DD 형식으로 입력해 주세요."
      );

      date?.focus();

      return;
    }


    if (
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(
        receiptTime
      )
    ) {
      setStatus(
        "입고시간을 HH:mm 형식으로 입력해 주세요."
      );

      time?.focus();

      return;
    }


    if (
      ![1, 2].includes(
        unitNo
      )
    ) {
      setStatus(
        "호기를 선택해 주세요."
      );

      unit?.focus();

      return;
    }


    if (
      !Number.isFinite(quantityTon) ||
      quantityTon < 0.01 ||
      quantityTon > 999.99
    ) {
      setStatus(
        "입고량은 0.01~999.99 ton 범위로 입력해 주세요."
      );

      quantity?.focus();

      return;
    }


    savePending = true;

    setStatus("");

    if (save) {
      save.disabled = true;
      save.textContent = "저장 중...";
    }


    try {

      const response = await fetch(
        API,
        {
          method: "PUT",

          headers:
            headers({
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
          (
            "석회석 입고기록 수정 실패 (HTTP " +
            response.status +
            ")"
          )
        );
      }


      closeModal();


      if (
        typeof window.loadLimestoneReceipts ===
        "function"
      ) {
        await window.loadLimestoneReceipts();
      }


      if (
        typeof window.showToast ===
        "function"
      ) {
        window.showToast(
          result.message ||
          "석회석 입고기록을 수정했습니다."
        );
      }

    } catch (error) {

      console.error(
        "모바일 석회석 수정 실패:",
        error
      );

      setStatus(
        error?.message ||
        "석회석 입고기록을 수정하지 못했습니다."
      );

    } finally {

      savePending = false;

      if (save) {
        save.disabled = false;
        save.textContent = "저장";
      }
    }
  }


  document.addEventListener(
    "click",
    async event => {

      if (!isMobile()) {
        return;
      }

      const target =
        event.target instanceof Element
          ? event.target
          : null;

      if (!target) {
        return;
      }

      const edit = target.closest(
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

      edit.disabled = true;

      try {

        const receipt =
          await fetchReceipt(
            edit.dataset.limestoneEdit,
            edit
          );

        openModal(receipt);

      } catch (error) {

        console.error(
          "모바일 석회석 수정창 열기 실패:",
          error
        );

        window.alert(
          error?.message ||
          "입고기록을 불러오지 못했습니다."
        );

      } finally {

        edit.disabled = false;
      }
    },
    true
  );


  function bind() {
    const {
      modal,
      form,
      close,
      cancel,
      date,
      time,
      quantity
    } = elements();

    if (
      !modal ||
      !form
    ) {
      return;
    }

    if (
      modal.dataset.mobileLimestoneV6R2Bound ===
      "1"
    ) {
      return;
    }

    modal.dataset.mobileLimestoneV6R2Bound =
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
      saveReceipt
    );


    date?.addEventListener(
      "blur",
      () => {
        date.value =
          normalizeDate(
            date.value
          );
      }
    );


    time?.addEventListener(
      "blur",
      () => {
        time.value =
          normalizeTime(
            time.value
          );
      }
    );


    quantity?.addEventListener(
      "input",
      () => {
        quantity.value =
          normalizeQuantity(
            quantity.value
          );
      }
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
          event.key === "Escape" &&
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
      bind,
      {
        once: true
      }
    );
  }
  else {
    bind();
  }

})();