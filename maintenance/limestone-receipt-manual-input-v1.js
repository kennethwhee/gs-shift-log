(function (global, factory) {
  "use strict";

  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (global) {
    global.LimestoneReceiptManualInputV1 = api;
    if (global.document) {
      api.start(global.document);
    }
  }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const TIME_ID = "limestoneReceiptTime";
  const QUANTITY_ID = "limestoneReceiptQuantity";
  const FORM_ID = "limestoneReceiptEditorForm";
  const PANEL_ID = "limestoneReceiptEditorPanel";

  const MANUAL_MODAL_ID = "limestoneManualEntryModal";
  const MANUAL_WEIGHT_ID = "limestoneManualEntryWeightInput";
  const MANUAL_ERROR_ID = "limestoneManualEntryError";
  const MANUAL_UNIT_ONE_BUTTON_ID = "submitLimestoneManualEntryUnit1Button";
  const MANUAL_UNIT_TWO_BUTTON_ID = "submitLimestoneManualEntryUnit2Button";

  function normalizeTime(rawValue) {
    const raw = String(rawValue == null ? "" : rawValue)
      .trim()
      .replace(/\s+/g, "");

    if (!raw) return null;

    let hour;
    let minute;
    if (/^\d{1,2}:\d{2}$/.test(raw)) {
      const parts = raw.split(":");
      hour = Number(parts[0]);
      minute = Number(parts[1]);
    } else if (/^\d{3,4}$/.test(raw)) {
      const compact = raw.padStart(4, "0");
      hour = Number(compact.slice(0, 2));
      minute = Number(compact.slice(2, 4));
    } else {
      return null;
    }

    if (
      !Number.isInteger(hour) ||
      !Number.isInteger(minute) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59
    ) {
      return null;
    }

    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  function normalizeQuantity(rawValue) {
    const raw = String(rawValue == null ? "" : rawValue)
      .trim()
      .replace(/\s+/g, "")
      .replace(/,/g, ".");

    if (!raw) return null;

    let value;
    if (/^\d{1,2}(?:\.\d{1,2})?$/.test(raw)) {
      value = Number(raw);
    } else if (/^\d{1,4}$/.test(raw)) {
      if (raw.length <= 2) {
        value = Number(raw);
      } else {
        value = Number(raw) / 100;
      }
    } else {
      return null;
    }

    if (!Number.isFinite(value) || value < 0.01 || value > 99.99) {
      return null;
    }

    return value.toFixed(2);
  }

  function setValidity(input, message) {
    if (!input || typeof input.setCustomValidity !== "function") return;
    input.setCustomValidity(message || "");
  }

  function normalizeField(input, normalizer, invalidMessage, report) {
    if (!input) return true;

    const raw = String(input.value || "").trim();
    if (!raw) {
      setValidity(input, "");
      return !input.required;
    }

    const normalized = normalizer(raw);
    if (!normalized) {
      setValidity(input, invalidMessage);
      if (report && typeof input.reportValidity === "function") {
        input.reportValidity();
      }
      return false;
    }

    input.value = normalized;
    setValidity(input, "");
    return true;
  }

  function configureInputs(timeInput, quantityInput) {
    if (timeInput) {
      timeInput.type = "text";
      timeInput.inputMode = "numeric";
      timeInput.maxLength = 5;
      timeInput.placeholder = "예: 1200 또는 12:00";
      timeInput.autocomplete = "off";
      timeInput.setAttribute("data-limestone-fast-time", "1");
    }

    if (quantityInput) {
      quantityInput.type = "text";
      quantityInput.inputMode = "decimal";
      quantityInput.maxLength = 5;
      quantityInput.placeholder = "예: 30.10 또는 3010";
      quantityInput.autocomplete = "off";
      quantityInput.removeAttribute("min");
      quantityInput.removeAttribute("max");
      quantityInput.removeAttribute("step");
      quantityInput.setAttribute("data-limestone-fast-quantity", "1");
    }
  }

  function bindReceiptEditor(doc) {
    const form = doc.getElementById(FORM_ID);
    const panel = doc.getElementById(PANEL_ID);
    const timeInput = doc.getElementById(TIME_ID);
    const quantityInput = doc.getElementById(QUANTITY_ID);

    if (!form || !timeInput || !quantityInput) return false;
    if (form.getAttribute("data-limestone-fast-input-bound") === "1") return true;

    form.setAttribute("data-limestone-fast-input-bound", "1");
    configureInputs(timeInput, quantityInput);

    const timeMessage = "입고시간은 1200 또는 12:00 형식으로 입력해 주세요.";
    const quantityMessage = "입고량은 0.01~99.99 ton 범위로 입력해 주세요. 예: 30.10 또는 3010";

    timeInput.addEventListener("input", function () {
      setValidity(timeInput, "");
    });

    quantityInput.addEventListener("input", function () {
      setValidity(quantityInput, "");
      if (/^\d{4}$/.test(String(quantityInput.value || "").trim())) {
        const normalized = normalizeQuantity(quantityInput.value);
        if (normalized) quantityInput.value = normalized;
      }
    });

    timeInput.addEventListener("blur", function () {
      normalizeField(timeInput, normalizeTime, timeMessage, false);
    });

    quantityInput.addEventListener("blur", function () {
      normalizeField(quantityInput, normalizeQuantity, quantityMessage, false);
    });

    form.addEventListener(
      "submit",
      function (event) {
        const timeOk = normalizeField(timeInput, normalizeTime, timeMessage, false);
        const quantityOk = normalizeField(
          quantityInput,
          normalizeQuantity,
          quantityMessage,
          false
        );

        if (timeOk && quantityOk) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        const invalidInput = !timeOk ? timeInput : quantityInput;
        if (typeof invalidInput.reportValidity === "function") {
          invalidInput.reportValidity();
        }
      },
      true
    );

    function refreshVisibleValues() {
      configureInputs(timeInput, quantityInput);
      if (timeInput.value) {
        normalizeField(timeInput, normalizeTime, timeMessage, false);
      }
      if (quantityInput.value) {
        normalizeField(quantityInput, normalizeQuantity, quantityMessage, false);
      }
    }

    if (panel && typeof MutationObserver !== "undefined") {
      const observer = new MutationObserver(function () {
        if (!panel.hidden) {
          setTimeout(refreshVisibleValues, 0);
          setTimeout(refreshVisibleValues, 60);
        }
      });
      observer.observe(panel, { attributes: true, attributeFilter: ["hidden"] });
    }

    refreshVisibleValues();
    return true;
  }

  function bindManualDirectEntry(doc) {
    const modal = doc.getElementById(MANUAL_MODAL_ID);
    const weightInput = doc.getElementById(MANUAL_WEIGHT_ID);
    const errorNode = doc.getElementById(MANUAL_ERROR_ID);
    const unitOneButton = doc.getElementById(MANUAL_UNIT_ONE_BUTTON_ID);
    const unitTwoButton = doc.getElementById(MANUAL_UNIT_TWO_BUTTON_ID);

    if (!modal || !weightInput || !unitOneButton || !unitTwoButton) return false;
    if (modal.getAttribute("data-limestone-fast-manual-bound") === "1") return true;

    modal.setAttribute("data-limestone-fast-manual-bound", "1");

    const invalidMessage = "실중량은 0.01 ~ 99.99 ton 범위로 입력해 주세요. 예: 30.10 또는 3010";

    function setManualError(message) {
      if (errorNode) errorNode.textContent = message || "";
    }

    function configureManualInput() {
      weightInput.type = "text";
      weightInput.inputMode = "decimal";
      weightInput.maxLength = 5;
      weightInput.placeholder = "예: 30.10 또는 3010";
      weightInput.autocomplete = "off";
      weightInput.removeAttribute("min");
      weightInput.removeAttribute("max");
      weightInput.removeAttribute("step");
      weightInput.setAttribute("data-limestone-fast-manual-weight", "1");

      const helper = modal.querySelector(".limestone-manual-entry-modal__helper");
      if (helper) {
        helper.textContent = "0.01 ~ 99.99 ton · 3010 → 30.10";
      }
    }

    function normalizeManualWeight(report) {
      configureManualInput();
      const raw = String(weightInput.value || "").trim();
      const normalized = normalizeQuantity(raw);

      if (!normalized) {
        setValidity(weightInput, invalidMessage);
        setManualError(invalidMessage);
        if (report && typeof weightInput.reportValidity === "function") {
          weightInput.reportValidity();
        }
        return false;
      }

      weightInput.value = normalized;
      setValidity(weightInput, "");
      setManualError("");
      return true;
    }

    weightInput.addEventListener("input", function () {
      configureManualInput();
      setValidity(weightInput, "");
      setManualError("");

      const raw = String(weightInput.value || "").trim();
      if (/^\d{4}$/.test(raw)) {
        const normalized = normalizeQuantity(raw);
        if (normalized) {
          weightInput.value = normalized;
        }
      }
    });

    weightInput.addEventListener("blur", function () {
      if (String(weightInput.value || "").trim()) {
        normalizeManualWeight(false);
      }
    });

    function guardRegistration(event) {
      if (normalizeManualWeight(true)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      weightInput.focus();
    }

    unitOneButton.addEventListener("click", guardRegistration, true);
    unitTwoButton.addEventListener("click", guardRegistration, true);

    function refreshManualModal() {
      configureManualInput();
      setValidity(weightInput, "");
      setManualError("");
      if (String(weightInput.value || "").trim()) {
        const normalized = normalizeQuantity(weightInput.value);
        if (normalized) weightInput.value = normalized;
      }
    }

    if (typeof MutationObserver !== "undefined") {
      const observer = new MutationObserver(function () {
        if (!modal.hidden && modal.getAttribute("aria-hidden") !== "true") {
          setTimeout(refreshManualModal, 0);
          setTimeout(refreshManualModal, 60);
        }
      });
      observer.observe(modal, {
        attributes: true,
        attributeFilter: ["hidden", "aria-hidden"],
      });
    }

    refreshManualModal();
    return true;
  }

  function start(doc) {
    if (!doc || typeof doc.getElementById !== "function") return false;
    const receiptBound = bindReceiptEditor(doc);
    const manualBound = bindManualDirectEntry(doc);
    return receiptBound || manualBound;
  }

  return {
    normalizeTime,
    normalizeQuantity,
    start,
  };
});
