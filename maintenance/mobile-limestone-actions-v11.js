"use strict";

(function installMobileLimestoneActionsFixV11() {
  if (window.__mobileLimestoneActionsFixV11Installed === true) {
    return;
  }

  window.__mobileLimestoneActionsFixV11Installed = true;

  const ROOT_SELECTOR = "#efficiencyLimestoneView";
  const API_URL = "/api/limestone-receipts";

  function isMobile() {
    return window.matchMedia("(max-width: 768px)").matches;
  }

  function getHeaders(extra = {}) {
    if (typeof window.getShiftLogAuthHeaders === "function") {
      return window.getShiftLogAuthHeaders(extra);
    }

    return {
      Accept: "application/json",
      ...extra
    };
  }

  function showMessage(message, isError = false) {
    const text = String(message || "").trim();
    if (!text) return;

    if (typeof window.showToast === "function") {
      window.showToast(text);
      return;
    }

    if (isError) {
      window.alert(text);
    }
  }

  async function readJson(response) {
    const text = await response.text();
    if (!text.trim()) return {};

    try {
      return JSON.parse(text);
    } catch {
      throw new Error("서버 응답 형식을 확인하지 못했습니다.");
    }
  }

  function getRowDate(button) {
    const row = button.closest("tr");
    if (!row) return "";

    const firstCell = row.querySelector("td");
    const raw = String(firstCell?.textContent || "").trim();
    const match = raw.match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : "";
  }

  async function fetchReceiptById(id, button) {
    const receiptId = String(id || "").trim();
    if (!receiptId) {
      throw new Error("입고기록 ID를 확인할 수 없습니다.");
    }

    const requestUrl = new URL(API_URL, window.location.origin);
    const rowDate = getRowDate(button);

    if (rowDate) {
      requestUrl.searchParams.set("startDate", rowDate);
      requestUrl.searchParams.set("endDate", rowDate);
    }

    requestUrl.searchParams.set("_", String(Date.now()));

    const response = await fetch(requestUrl.toString(), {
      method: "GET",
      headers: getHeaders({ Accept: "application/json" }),
      cache: "no-store"
    });

    const result = await readJson(response);

    if (!response.ok || result.ok === false || result.success === false) {
      throw new Error(
        result.message ||
          result.error ||
          `석회석 입고기록 조회 실패 (HTTP ${response.status})`
      );
    }

    const items = Array.isArray(result.items)
      ? result.items
      : Array.isArray(result.data?.items)
        ? result.data.items
        : [];

    const receipt = items.find(item => String(item?.id || "") === receiptId);

    if (!receipt) {
      throw new Error("선택한 석회석 입고기록을 찾지 못했습니다. 새로고침 후 다시 시도해 주세요.");
    }

    return receipt;
  }

  async function handleEdit(button) {
    const id = button.dataset.limestoneEdit;
    button.disabled = true;

    try {
      const receipt = await fetchReceiptById(id, button);

      if (typeof window.openLimestoneReceiptEditor !== "function") {
        throw new Error("석회석 수정창을 열 수 없습니다. 페이지를 새로고침해 주세요.");
      }

      window.openLimestoneReceiptEditor(receipt);

      window.requestAnimationFrame(() => {
        const panel = document.getElementById("limestoneReceiptEditorPanel");
        panel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    } catch (error) {
      console.error("모바일 석회석 수정창 열기 실패:", error);
      showMessage(error?.message || "석회석 입고기록을 수정할 수 없습니다.", true);
    } finally {
      button.disabled = false;
    }
  }

  async function handleDelete(button) {
    const id = button.dataset.limestoneDelete;
    button.disabled = true;

    try {
      const receipt = await fetchReceiptById(id, button);
      const quantity = Number(receipt.quantityTon ?? receipt.quantity_ton ?? 0);
      const unitNo = Number(receipt.unitNo ?? receipt.unit_no ?? 0);
      const date = String(receipt.receiptDate ?? receipt.receipt_date ?? "");
      const time = String(receipt.receiptTime ?? receipt.receipt_time ?? "");

      const shouldDelete = window.confirm(
        [
          "석회석 입고기록을 삭제하시겠습니까?",
          "",
          `${date} ${time}`.trim(),
          unitNo ? `${unitNo}호기` : "",
          Number.isFinite(quantity) ? `${quantity.toFixed(2)} ton` : ""
        ]
          .filter(Boolean)
          .join("\n")
      );

      if (!shouldDelete) {
        return;
      }

      const requestUrl = new URL(API_URL, window.location.origin);
      requestUrl.searchParams.set("id", String(receipt.id || id));

      const revision = Number(receipt.revision || 0);
      if (Number.isInteger(revision) && revision > 0) {
        requestUrl.searchParams.set("revision", String(revision));
      }

      const response = await fetch(requestUrl.toString(), {
        method: "DELETE",
        headers: getHeaders({ Accept: "application/json" }),
        cache: "no-store"
      });

      const result = await readJson(response);

      if (!response.ok || result.ok === false || result.success === false) {
        throw new Error(
          result.message ||
            result.error ||
            `석회석 입고기록 삭제 실패 (HTTP ${response.status})`
        );
      }

      if (typeof window.loadLimestoneReceipts === "function") {
        await window.loadLimestoneReceipts();
      }

      showMessage(result.message || "석회석 입고기록을 삭제했습니다.");
    } catch (error) {
      console.error("모바일 석회석 삭제 실패:", error);

      if (typeof window.loadLimestoneReceipts === "function") {
        try {
          await window.loadLimestoneReceipts();
        } catch {
          // Ignore refresh failure after delete error.
        }
      }

      showMessage(error?.message || "석회석 입고기록을 삭제하지 못했습니다.", true);
    } finally {
      button.disabled = false;
    }
  }

  /*
   * MOBILE LIMESTONE ACTIONS V12 R2
   *
   * iOS Safari fix:
   * - Edit/Delete runs directly from a genuine touch tap.
   * - Do not depend on Safari generating a compatibility click.
   * - Finger movement over 14px is treated as scrolling.
   * - A compatibility click after touch is consumed to prevent duplicates.
   */

  const LIMESTONE_ACTION_SELECTOR =
    `${ROOT_SELECTOR} [data-limestone-edit], ${ROOT_SELECTOR} [data-limestone-delete]`;

  const LIMESTONE_TOUCH_MOVE_LIMIT = 14;
  const LIMESTONE_COMPAT_CLICK_GUARD_MS = 1200;

  let limestoneTouchState = null;

  function getLimestoneActionButtonFromTarget(target) {
    const element =
      target instanceof Element
        ? target
        : null;

    if (!element) {
      return null;
    }

    const button = element.closest(
      LIMESTONE_ACTION_SELECTOR
    );

    if (
      !(button instanceof HTMLButtonElement) ||
      button.disabled
    ) {
      return null;
    }

    return button;
  }

  function getLimestoneActionButtonAtPoint(clientX, clientY) {
    const root =
      document.querySelector(ROOT_SELECTOR);

    if (!root) {
      return null;
    }

    const topElement =
      typeof document.elementFromPoint === "function"
        ? document.elementFromPoint(clientX, clientY)
        : null;

    /*
     * Do not click through an unrelated modal/overlay.
     * Coordinate fallback is used only while the touch is still
     * inside the Limestone screen.
     */
    if (
      topElement &&
      !root.contains(topElement)
    ) {
      return null;
    }

    const elements =
      typeof document.elementsFromPoint === "function"
        ? document.elementsFromPoint(clientX, clientY)
        : topElement
          ? [topElement]
          : [];

    for (const element of elements) {
      const button =
        getLimestoneActionButtonFromTarget(element);

      if (button) {
        return button;
      }
    }

    /*
     * Safari fallback:
     * resolve the actually visible action button by rectangle.
     */
    const buttons =
      document.querySelectorAll(
        LIMESTONE_ACTION_SELECTOR
      );

    for (const candidate of buttons) {
      if (
        !(candidate instanceof HTMLButtonElement) ||
        candidate.disabled
      ) {
        continue;
      }

      const style =
        window.getComputedStyle(candidate);

      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.pointerEvents === "none"
      ) {
        continue;
      }

      const rect =
        candidate.getBoundingClientRect();

      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return candidate;
      }
    }

    return null;
  }

  function stopLimestoneActionEvent(event) {
    if (event.cancelable) {
      event.preventDefault();
    }

    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function runLimestoneAction(button) {
    if (
      !(button instanceof HTMLButtonElement) ||
      button.disabled
    ) {
      return;
    }

    if (button.dataset.limestoneEdit) {
      void handleEdit(button);
      return;
    }

    if (button.dataset.limestoneDelete) {
      void handleDelete(button);
    }
  }

  function captureActionClick(event) {
    if (!isMobile()) {
      return;
    }

    const button =
      getLimestoneActionButtonFromTarget(
        event.target
      );

    if (!button) {
      return;
    }

    const touchHandledAt =
      Number(
        button.dataset
          .limestoneV12TouchHandledAt || 0
      );

    /*
     * Safari may generate click after touchend.
     * The touch action has already been executed,
     * so consume that compatibility click.
     */
    if (
      touchHandledAt > 0 &&
      Date.now() - touchHandledAt <
        LIMESTONE_COMPAT_CLICK_GUARD_MS
    ) {
      stopLimestoneActionEvent(event);
      return;
    }

    stopLimestoneActionEvent(event);
    runLimestoneAction(button);
  }

  function captureActionTouchStart(event) {
    if (
      !isMobile() ||
      event.touches.length !== 1
    ) {
      limestoneTouchState = null;
      return;
    }

    const touch =
      event.touches[0];

    const button =
      getLimestoneActionButtonFromTarget(
        event.target
      ) ||
      getLimestoneActionButtonAtPoint(
        touch.clientX,
        touch.clientY
      );

    if (!button) {
      limestoneTouchState = null;
      return;
    }

    limestoneTouchState = {
      identifier: touch.identifier,
      button,
      startX: touch.clientX,
      startY: touch.clientY,
      moved: false
    };
  }

  function captureActionTouchMove(event) {
    const state =
      limestoneTouchState;

    if (!state) {
      return;
    }

    const touch =
      Array.from(event.touches).find(
        item =>
          item.identifier ===
          state.identifier
      );

    if (!touch) {
      state.moved = true;
      return;
    }

    const distance =
      Math.hypot(
        touch.clientX - state.startX,
        touch.clientY - state.startY
      );

    if (
      distance >
      LIMESTONE_TOUCH_MOVE_LIMIT
    ) {
      state.moved = true;
    }
  }

  function captureActionTouchEnd(event) {
    const state =
      limestoneTouchState;

    limestoneTouchState = null;

    if (
      !isMobile() ||
      !state ||
      state.moved
    ) {
      return;
    }

    const touch =
      Array.from(
        event.changedTouches
      ).find(
        item =>
          item.identifier ===
          state.identifier
      );

    if (!touch) {
      return;
    }

    const distance =
      Math.hypot(
        touch.clientX - state.startX,
        touch.clientY - state.startY
      );

    if (
      distance >
      LIMESTONE_TOUCH_MOVE_LIMIT
    ) {
      return;
    }

    const endButton =
      getLimestoneActionButtonFromTarget(
        event.target
      ) ||
      getLimestoneActionButtonAtPoint(
        touch.clientX,
        touch.clientY
      );

    /*
     * Start and finish must be the same button.
     * This prevents scroll gestures from executing an action.
     */
    if (
      !endButton ||
      endButton !== state.button ||
      endButton.disabled
    ) {
      return;
    }

    stopLimestoneActionEvent(event);

    endButton.dataset
      .limestoneV12TouchHandledAt =
        String(Date.now());

    runLimestoneAction(endButton);
  }

  function captureActionTouchCancel() {
    limestoneTouchState = null;
  }

  document.addEventListener(
    "click",
    captureActionClick,
    true
  );

  document.addEventListener(
    "touchstart",
    captureActionTouchStart,
    {
      passive: true,
      capture: true
    }
  );

  document.addEventListener(
    "touchmove",
    captureActionTouchMove,
    {
      passive: true,
      capture: true
    }
  );

  document.addEventListener(
    "touchend",
    captureActionTouchEnd,
    {
      passive: false,
      capture: true
    }
  );

  document.addEventListener(
    "touchcancel",
    captureActionTouchCancel,
    {
      passive: true,
      capture: true
    }
  );
})();