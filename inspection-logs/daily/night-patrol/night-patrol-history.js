(function initializeNightPatrolHistory(globalScope) {
  "use strict";

  const RECORD_KEY = /^gsShiftLog\.nightPatrol\.(\d{4}-\d{2}-\d{2})\.([1-4])$/;
  const PAGE_SIZE = 20;
  const view = { records: [], unreadable: 0, error: false, page: 1 };
  const byId = id => globalScope.document?.getElementById(id);

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(value + "T00:00:00Z");
    return Number.isFinite(date.getTime()) && date.getUTCFullYear() === year &&
      date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
  }

  function readRecord(key, text) {
    const match = RECORD_KEY.exec(String(key || ""));
    if (!match || !validDate(match[1])) return null;
    const saved = JSON.parse(text);
    if (!saved || typeof saved !== "object" || Array.isArray(saved) || !Array.isArray(saved.entries)) {
      throw new Error("Invalid saved patrol record");
    }
    const date = match[1];
    const listNumber = Number(match[2]);
    if ((saved.date && saved.date !== date) ||
        (saved.listNumber != null && Number(saved.listNumber) !== listNumber)) {
      throw new Error("Saved patrol identity does not match its storage key");
    }
    const counts = { "양호": 0, "이상": 0, "미점검": 0, "해당없음": 0 };
    for (const entry of saved.entries) {
      const status = String(entry?.status || "");
      if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
    }
    return {
      key, date, listNumber,
      documentStatus: saved.documentStatus === "점검완료" ? "점검완료" : "작성중",
      members: Array.isArray(saved.members) ? saved.members.slice(0, 3).map(value => String(value || "").trim()).filter(Boolean) : [],
      updatedAt: String(saved.updatedAt || ""),
      counts
    };
  }

  function readRecords(storage) {
    const records = [];
    let unreadable = 0;
    try {
      const keys = [];
      for (let index = 0; index < storage.length; index += 1) keys.push(storage.key(index));
      for (const key of keys) {
        if (!RECORD_KEY.test(String(key || ""))) continue;
        try {
          const text = storage.getItem(key);
          if (text === null) continue;
          const record = readRecord(key, text);
          if (record) records.push(record);
          else unreadable += 1;
        } catch (_) {
          unreadable += 1;
        }
      }
    } catch (_) {
      return { records: [], unreadable, error: true };
    }
    records.sort((left, right) => right.date.localeCompare(left.date) || left.listNumber - right.listNumber);
    return { records, unreadable, error: false };
  }

  function filteredRecords(records, month = "", status = "all") {
    return records.filter(record => (!month || record.date.startsWith(month + "-")) &&
      (status === "all" || record.documentStatus === status));
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }

  function savedTime(value) {
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime())) return "기록 없음";
    const parts = new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(date);
    const get = type => parts.find(part => part.type === type)?.value || "";
    return `${get("year")}.${get("month")}.${get("day")} ${get("hour")}:${get("minute")}`;
  }

  function currentRecord() {
    return typeof nightPatrolState === "object" ? nightPatrolState : null;
  }

  function rowHtml(record) {
    const current = currentRecord();
    const isCurrent = current?.date === record.date && current?.listNumber === record.listNumber;
    const result = Object.entries(record.counts).filter(([, count]) => count > 0)
      .map(([status, count]) => `${status} ${count}`).join(" · ") || "기록 없음";
    const status = record.documentStatus === "점검완료" ? "completed" : "draft";
    return `<tr class="patrol-history-row${isCurrent ? " is-current" : ""}">
      <td data-label="점검일자"><strong>${record.date}</strong>${isCurrent ? '<small class="patrol-history-current">현재 열린 일지</small>' : ""}</td>
      <td data-label="순찰 목록">목록 ${record.listNumber}</td>
      <td data-label="순찰자">${escapeHtml(record.members.join(" · ") || "미입력")}</td>
      <td data-label="점검 상태"><span class="patrol-history-status" data-status="${status}">${record.documentStatus}</span></td>
      <td data-label="점검 결과"><span class="patrol-history-result" data-warning="${record.counts["이상"] > 0}">${result}</span></td>
      <td data-label="저장 시각"><time datetime="${escapeHtml(record.updatedAt)}">${savedTime(record.updatedAt)}</time></td>
      <td data-label="열기"><button type="button" class="patrol-history-open-button" data-patrol-history-open="${record.key}" aria-label="${record.date} 목록 ${record.listNumber} 열기">열기</button></td>
    </tr>`;
  }

  function render() {
    const body = byId("patrolHistoryBody");
    if (!body) return;
    const month = byId("patrolHistoryMonth")?.value || "";
    const status = byId("patrolHistoryStatus")?.value || "all";
    const records = filteredRecords(view.records, month, status);
    const pages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
    view.page = Math.max(1, Math.min(view.page, pages));
    const visible = records.slice((view.page - 1) * PAGE_SIZE, view.page * PAGE_SIZE);
    const message = byId("patrolHistoryMessage");
    if (message) {
      message.textContent = view.error ? "저장된 일지 목록을 읽을 수 없습니다. 브라우저의 저장소 설정을 확인한 뒤 새로고침해 주세요." :
        `전체 ${view.records.length}건 · ${month ? month + "월" : "전체 기간"} ${records.length}건` +
        (view.unreadable ? ` · 읽을 수 없는 기록 ${view.unreadable}건은 제외했습니다.` : "");
      message.dataset.state = view.error || view.unreadable ? "warning" : "ready";
    }
    const empty = view.error ? "저장 목록을 불러오지 못했습니다." : view.records.length ?
      "선택한 기간과 상태에 해당하는 일지가 없습니다." : "저장된 야간 순찰일지가 없습니다. 일지를 작성한 뒤 저장해 주세요.";
    body.innerHTML = visible.length ? visible.map(rowHtml).join("") :
      `<tr><td colspan="7" class="patrol-history-empty">${empty}</td></tr>`;
    if (byId("patrolHistoryPageInfo")) byId("patrolHistoryPageInfo").textContent = `${view.page} / ${pages} 페이지`;
    if (byId("prevPatrolHistoryPageButton")) byId("prevPatrolHistoryPageButton").disabled = view.error || view.page <= 1;
    if (byId("nextPatrolHistoryPageButton")) byId("nextPatrolHistoryPageButton").disabled = view.error || view.page >= pages;
    byId("patrolHistoryAllDatesButton")?.setAttribute("aria-pressed", String(!month));
  }

  function refresh() {
    let loaded;
    try { loaded = readRecords(globalScope.localStorage); }
    catch (_) { loaded = { records: [], unreadable: 0, error: true }; }
    Object.assign(view, loaded);
    globalScope.document?.querySelectorAll("[data-patrol-history-count]").forEach(element => {
      element.textContent = loaded.error ? "–" : String(loaded.records.length);
    });
    if (byId("patrolHistoryDialog")?.open) render();
    return loaded;
  }

  function open() {
    const dialog = byId("patrolHistoryDialog");
    if (!dialog || dialog.open) return;
    view.page = 1;
    refresh();
    render();
    dialog.showModal();
    byId("patrolHistoryMonth")?.focus();
  }

  function close() {
    const dialog = byId("patrolHistoryDialog");
    if (dialog?.open) dialog.close();
  }

  function openRecord(key) {
    let record;
    try {
      const text = globalScope.localStorage.getItem(key);
      if (text !== null) record = readRecord(key, text);
    } catch (_) { /* Refresh the list without replacing the current form. */ }
    if (!record) {
      refresh();
      globalScope.alert("선택한 저장 기록을 불러올 수 없습니다. 저장 목록을 다시 확인해 주세요.");
      return false;
    }
    if (typeof collectPatrolScreenValues !== "function" || typeof loadNightPatrolRecord !== "function") return false;
    collectPatrolScreenValues();
    if (createPatrolSnapshot() !== nightPatrolSavedSnapshot &&
        !globalScope.confirm("저장되지 않은 내용이 있습니다. 저장된 일지를 열까요?")) return false;
    loadNightPatrolRecord(record.date, record.listNumber);
    close();
    byId("patrolDate")?.focus({ preventScroll: true });
    globalScope.scrollTo?.({ top: 0, behavior: "auto" });
    return true;
  }

  function initialize() {
    if (typeof canCurrentUserAccessNightPatrolPage !== "function" || !canCurrentUserAccessNightPatrolPage()) return;
    for (const id of ["openPatrolHistoryButton", "openPatrolHistoryFooterButton"]) byId(id)?.addEventListener("click", open);
    for (const id of ["closePatrolHistoryButton", "closePatrolHistoryFooterButton"]) byId(id)?.addEventListener("click", close);
    for (const id of ["patrolHistoryMonth", "patrolHistoryStatus"]) byId(id)?.addEventListener("change", () => { view.page = 1; render(); });
    byId("patrolHistoryAllDatesButton")?.addEventListener("click", () => {
      byId("patrolHistoryMonth").value = "";
      view.page = 1;
      render();
    });
    byId("refreshPatrolHistoryButton")?.addEventListener("click", refresh);
    byId("prevPatrolHistoryPageButton")?.addEventListener("click", () => { view.page -= 1; render(); });
    byId("nextPatrolHistoryPageButton")?.addEventListener("click", () => { view.page += 1; render(); });
    byId("patrolHistoryBody")?.addEventListener("click", event => {
      const button = event.target.closest?.("[data-patrol-history-open]");
      if (button) openRecord(button.dataset.patrolHistoryOpen);
    });
    globalScope.addEventListener("storage", event => {
      if (event.key === null || RECORD_KEY.test(String(event.key || ""))) refresh();
    });
    refresh();
  }

  globalScope.GSNightPatrolHistory = Object.freeze({ refresh, open, close, openRecord });
  globalScope.document?.addEventListener("DOMContentLoaded", initialize);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { validDate, readRecord, readRecords, filteredRecords, escapeHtml, savedTime };
  }
})(typeof window !== "undefined" ? window : globalThis);
