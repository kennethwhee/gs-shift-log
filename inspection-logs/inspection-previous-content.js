(function inspectionPreviousContent(globalScope) {
  "use strict";

  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + "T00:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function previousDate(value, days = 1) {
    if (!validDate(value)) return "";
    const date = new Date(value + "T00:00:00Z");
    date.setUTCDate(date.getUTCDate() - Math.max(1, Number(days) || 1));
    const result = date.toISOString().slice(0, 10);
    return validDate(result) ? result : "";
  }

  function validateSourceDate(sourceDate, targetDate) {
    if (!validDate(sourceDate)) throw new Error("불러올 점검일자를 선택해 주세요.");
    if (!validDate(targetDate)) throw new Error("작성할 일지의 점검일자를 먼저 선택해 주세요.");
    if (sourceDate >= targetDate) throw new Error("현재 작성 중인 점검일자보다 이전 날짜를 선택해 주세요.");
  }

  function identity(target) {
    return JSON.stringify({ date: target?.date, listNumber: target?.listNumber ?? null });
  }

  function create(adapter) {
    const document = globalScope.document;
    if (!document?.body || !adapter?.button) return null;
    const dialog = document.createElement("dialog");
    dialog.className = "inspection-previous-dialog";
    dialog.setAttribute("aria-labelledby", "inspectionPreviousTitle");
    dialog.setAttribute("aria-describedby", "inspectionPreviousDescription");
    dialog.innerHTML = `
      <header class="inspection-previous-header">
        <h2 id="inspectionPreviousTitle">이전 일지 불러오기</h2>
        <button type="button" class="inspection-previous-close" data-previous-close aria-label="이전 일지 불러오기 닫기">×</button>
      </header>
      <p class="inspection-previous-description" id="inspectionPreviousDescription"></p>
      <p class="inspection-previous-target" data-previous-target></p>
      <form class="inspection-previous-form" data-previous-form>
        <div class="inspection-previous-fields">
          <label class="inspection-previous-field" for="inspectionPreviousSourceDate">
            <span>불러올 점검일자</span>
            <input type="date" id="inspectionPreviousSourceDate" data-previous-date required>
          </label>
          <label class="inspection-previous-field" for="inspectionPreviousSourceList" data-previous-list-field hidden>
            <span>불러올 순찰 목록</span>
            <select id="inspectionPreviousSourceList" data-previous-list>
              <option value="1">목록 1</option><option value="2">목록 2</option>
              <option value="3">목록 3</option><option value="4">목록 4</option>
            </select>
          </label>
        </div>
        <p class="inspection-previous-note">현재 점검일자는 유지됩니다. 불러온 내용을 확인한 뒤 직접 저장해 주세요. 결재·확인란은 새로 작성합니다.</p>
        <p class="inspection-previous-status" data-previous-status data-state="ready" role="status" aria-live="polite"></p>
        <footer class="inspection-previous-footer">
          <button type="button" class="inspection-previous-cancel" data-previous-cancel>취소</button>
          <button type="submit" class="inspection-previous-apply" data-previous-apply>내용 불러오기</button>
        </footer>
      </form>`;
    document.body.appendChild(dialog);

    const find = selector => dialog.querySelector(selector);
    const dateInput = find("[data-previous-date]");
    const listInput = find("[data-previous-list]");
    const listField = find("[data-previous-list-field]");
    const message = find("[data-previous-status]");
    const applyButton = find("[data-previous-apply]");
    find("#inspectionPreviousDescription").textContent = `${adapter.title || "점검일지"}의 저장된 내용을 현재 일지에 불러옵니다.`;
    let generation = 0;
    let pending = false;
    let requestController = null;
    let openedTarget = "";

    function showMessage(text, state = "ready") {
      message.textContent = text;
      message.dataset.state = state;
    }

    function setPending(value) {
      pending = value;
      dateInput.disabled = value;
      listInput.disabled = value;
      applyButton.disabled = value;
      applyButton.textContent = value ? "불러오는 중…" : "내용 불러오기";
      dialog.setAttribute("aria-busy", String(value));
    }

    function invalidate() {
      generation += 1;
      requestController?.abort();
      requestController = null;
      setPending(false);
    }

    function close() {
      invalidate();
      if (dialog.open) dialog.close();
    }

    function open() {
      if (dialog.open) return false;
      if (adapter.isBusy?.()) {
        globalScope.alert("현재 일지를 불러오거나 저장하는 중입니다. 완료된 뒤 다시 시도해 주세요.");
        return false;
      }
      const target = adapter.getTarget();
      if (!validDate(target?.date)) {
        globalScope.alert("작성할 일지의 점검일자를 먼저 선택해 주세요.");
        return false;
      }
      invalidate();
      openedTarget = identity(target);
      dateInput.value = previousDate(target.date, adapter.defaultDays);
      dateInput.max = previousDate(target.date);
      listField.hidden = target.listNumber == null;
      listInput.value = String(target.listNumber || 1);
      find("[data-previous-target]").textContent = `작성 중인 일지: ${target.date}` +
        (target.listNumber == null ? "" : ` · 순찰 목록 ${target.listNumber}`);
      showMessage("불러올 날짜를 선택해 주세요.");
      dialog.showModal();
      dateInput.focus();
      return true;
    }

    async function load() {
      if (!dialog.open || pending) return false;
      const target = adapter.getTarget();
      let source;
      try {
        validateSourceDate(dateInput.value, target?.date);
        if (identity(target) !== openedTarget || adapter.isBusy?.()) {
          throw new Error("작성 중인 일지가 바뀌었거나 처리 중입니다. 창을 닫은 뒤 다시 불러와 주세요.");
        }
        source = { date: dateInput.value };
        if (!listField.hidden) {
          source.listNumber = Number(listInput.value);
          if (![1, 2, 3, 4].includes(source.listNumber)) throw new Error("불러올 순찰 목록을 선택해 주세요.");
        }
      } catch (error) {
        showMessage(error.message, "error");
        return false;
      }

      const targetIdentity = identity(target);
      const snapshot = adapter.getSnapshot();
      const ticket = ++generation;
      requestController = new globalScope.AbortController();
      setPending(true);
      showMessage("저장된 일지 내용을 불러오는 중입니다.", "loading");
      const stillCurrent = () => ticket === generation && dialog.open;
      const unchanged = () => identity(adapter.getTarget()) === targetIdentity &&
        adapter.getSnapshot() === snapshot && !adapter.isBusy?.();
      try {
        const content = await adapter.read(source, { signal: requestController.signal });
        if (!stillCurrent()) return false;
        if (!unchanged()) throw new Error("불러오는 동안 현재 일지가 바뀌었습니다. 내용을 확인한 뒤 다시 불러와 주세요.");
        if (adapter.isDirty?.() && !globalScope.confirm("저장하지 않은 작성 내용이 있습니다. 선택한 이전 일지 내용으로 바꿀까요?")) {
          showMessage("현재 작성 내용을 유지했습니다.");
          return false;
        }
        if (!stillCurrent() || !unchanged()) return false;
        adapter.apply(content, source);
        close();
        return true;
      } catch (error) {
        if (stillCurrent() && error?.name !== "AbortError") {
          showMessage(error?.message || "이전 일지를 불러오지 못했습니다. 현재 작성 내용은 유지됩니다.", "error");
        }
        return false;
      } finally {
        if (ticket === generation) {
          requestController = null;
          setPending(false);
        }
      }
    }

    adapter.button.addEventListener("click", open);
    find("[data-previous-close]").addEventListener("click", close);
    find("[data-previous-cancel]").addEventListener("click", close);
    find("[data-previous-form]").addEventListener("submit", event => { event.preventDefault(); load(); });
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    // A queued close event from an older session must not cancel a reopened one.
    dialog.addEventListener("close", () => { if (!dialog.open) invalidate(); });
    return Object.freeze({ open, close, load });
  }

  globalScope.GSInspectionPreviousContent = Object.freeze({ create, validDate, previousDate, validateSourceDate });
  if (typeof module !== "undefined" && module.exports) module.exports = { create, validDate, previousDate, validateSourceDate };
})(typeof window !== "undefined" ? window : globalThis);
