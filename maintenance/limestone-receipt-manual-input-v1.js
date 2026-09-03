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

  function start(doc) {
    if (!doc || typeof doc.getElementById !== "function") return false;

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

  return {
    normalizeTime,
    normalizeQuantity,
    start,
  };
});
