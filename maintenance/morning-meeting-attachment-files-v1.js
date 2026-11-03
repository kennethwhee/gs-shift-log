/* Compact references to the files currently selected for the morning meeting. */
(function installMorningMeetingAttachmentFilesV1() {
  "use strict";

  if (window.__morningMeetingAttachmentFilesV1Installed) return;
  window.__morningMeetingAttachmentFilesV1Installed = true;

  function initialize() {
    const view = document.getElementById("efficiencyMorningMeetingView");
    if (!view) return;

    const coalCard = document.getElementById("efficiencyMorningMeetingCoalLogCard");
    const mobile = window.matchMedia("(max-width: 768px)");
    const fileIds = new WeakMap();
    const removeTargets = new WeakMap();
    const references = [
      ["template", "efficiencyMorningMeetingTemplateStatus"],
      ["safety", "efficiencyMorningMeetingSafetyStatus"],
      ["environment", "efficiencyMorningMeetingEnvironmentStatus"],
      ["mechanical", "efficiencyMorningMeetingMechanicalStatus"],
      ["electrical", "efficiencyMorningMeetingElectricalStatus"]
    ];
    let nextFileId = 1;
    let signature = "";
    let referenceSignature = "";
    let queued = false;
    let busy = false;
    let panel = null;
    let list = null;
    let announcement = null;

    function make(tag, className, text) {
      const element = document.createElement(tag);
      element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    }

    function fileKey(file) {
      if (!file || typeof file !== "object") return null;
      if (!fileIds.has(file)) fileIds.set(file, nextFileId++);
      return [fileIds.get(file), String(file.name || ""), file.size, file.lastModified];
    }

    function isReadOnly() {
      return mobile.matches || view.classList.contains("is-mobile-monitor-only");
    }

    function isExporting() {
      return window.efficiencyMorningMeetingUploadState?.coalAttachmentExporting === true;
    }

    function getFiles() {
      if (typeof window.getEfficiencyMorningMeetingCoalLogFiles !== "function") return [];
      const files = window.getEfficiencyMorningMeetingCoalLogFiles();
      return Array.isArray(files)
        ? files.filter(file => file && typeof file === "object" && typeof file.name === "string")
        : [];
    }

    function currentReferences() {
      const state = window.efficiencyMorningMeetingUploadState || {};
      return references.map(([key, statusId]) => {
        const candidate = key === "template" ? state.templateFile : state.files?.[key];
        const file = candidate && typeof candidate.name === "string" ? candidate : null;
        const status = document.getElementById(statusId);
        return {key, file, status, text: status?.textContent.trim() || ""};
      });
    }

    function renderReference({file, status, text}) {
      if (!status) return;
      const content = status.closest(".efficiency-morning-meeting-upload-card__content");
      if (!content) return;
      const isFileName = Boolean(file && text === file.name);
      status.classList.toggle("morning-meeting-current-file-name", isFileName);
      let reference = content.querySelector("[data-morning-meeting-current-file]");
      if (!file || isFileName) {
        reference?.remove();
        if (isFileName && status.title !== file.name) status.title = file.name;
        return;
      }
      // A processing/result message can replace the template status. Keep that
      // message and show the actual currently selected filename underneath it.
      if (!reference) {
        reference = make("span", "morning-meeting-current-file-name");
        reference.dataset.morningMeetingCurrentFile = "true";
        content.appendChild(reference);
      }
      if (reference.textContent !== file.name) reference.textContent = file.name;
      if (reference.title !== file.name) reference.title = file.name;
    }

    function ensurePanel(shell) {
      if (panel && panel.parentElement === shell) return;
      panel?.remove();
      panel = make("div", "morning-meeting-coal-file-reference");
      panel.setAttribute("role", "group");
      panel.setAttribute("aria-label", "운탄일지 첨부파일");
      list = make("ul", "morning-meeting-coal-file-list");
      if (!announcement) {
        announcement = make("span", "morning-meeting-file-announcement");
        announcement.setAttribute("role", "status");
        announcement.setAttribute("aria-live", "polite");
        // Remain available after the final file hides the reference panel.
        view.appendChild(announcement);
      }
      panel.append(list);
      // The card is a file-input label. Interactive controls must be siblings,
      // never descendants of that label, so excluding a file cannot open it.
      shell.insertBefore(panel, coalCard.nextSibling);
      panel.addEventListener("click", handlePanelClick);
      panel.addEventListener("keydown", event => {
        if ((event.key === "Enter" || event.key === " ") && event.target.closest("button")) {
          event.stopPropagation();
        }
      });
    }

    function render() {
      queued = false;
      const files = getFiles();
      const refs = currentReferences();
      const shell = coalCard?.closest(".efficiency-morning-meeting-upload-shell");
      const readOnly = isReadOnly();
      const exporting = isExporting();
      const canRemove = typeof window.removeEfficiencyMorningMeetingCoalLogFile === "function";
      const nextReferenceSignature = JSON.stringify(refs.map(ref => [ref.key, fileKey(ref.file), ref.text]));
      if (referenceSignature !== nextReferenceSignature) {
        referenceSignature = nextReferenceSignature;
        refs.forEach(renderReference);
      }
      const nextSignature = JSON.stringify([
        files.map(fileKey), readOnly, exporting, busy, canRemove,
        Boolean(shell), Boolean(panel?.isConnected)
      ]);
      if (signature === nextSignature) return;
      signature = nextSignature;
      if (!shell) return;
      ensurePanel(shell);
      const hasReference = files.length > 0;
      panel.hidden = !hasReference;
      shell.classList.toggle("morning-meeting-has-coal-file-reference", hasReference);
      list.replaceChildren();
      for (const file of files) {
        const row = make("li", "morning-meeting-coal-file-row");
        const name = make("span", "morning-meeting-coal-file-name", file.name);
        name.title = file.name;
        const remove = make("button", "morning-meeting-coal-file-remove", "×");
        remove.type = "button";
        remove.dataset.morningMeetingCoalRemove = "true";
        remove.title = file.name + " 첨부에서 제외";
        remove.setAttribute("aria-label", file.name + " 첨부에서 제외");
        remove.disabled = readOnly || exporting || busy || !canRemove;
        removeTargets.set(remove, file);
        row.append(name, remove);
        list.append(row);
      }
    }

    function scheduleRender() {
      if (queued) return;
      queued = true;
      Promise.resolve().then(render);
    }

    async function handlePanelClick(event) {
      const button = event.target.closest("button");
      if (!button || !panel.contains(button)) return;
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled || busy || isReadOnly() || isExporting()) return;
      const file = removeTargets.get(button);
      const action = window.removeEfficiencyMorningMeetingCoalLogFile;
      if (typeof action !== "function" || !file) return;
      const buttonIndex = Array.from(list.querySelectorAll("button")).indexOf(button);
      busy = true;
      render();
      let success = false;
      try {
        success = (await action.call(window, file)) === true;
      } catch (_) {
        success = false;
      } finally {
        busy = false;
        render();
      }
      announcement.textContent = success
        ? file.name + " 첨부에서 제외했습니다. 원본 파일은 유지됩니다."
        : "첨부 목록을 변경하지 못했습니다. 다시 확인해 주세요.";
      const remainingButtons = Array.from(list.querySelectorAll("button:not(:disabled)"));
      const focusTarget = remainingButtons[Math.min(Math.max(0, buttonIndex), remainingButtons.length - 1)];
      if (focusTarget) {
        focusTarget.focus({preventScroll: true});
      } else if (coalCard) {
        if (!coalCard.hasAttribute("tabindex")) coalCard.setAttribute("tabindex", "-1");
        coalCard.focus({preventScroll: true});
      }
    }

    window.refreshEfficiencyMorningMeetingAttachmentFiles = scheduleRender;
    const observer = new MutationObserver(scheduleRender);
    const uploadGrid = view.querySelector(".efficiency-morning-meeting-upload-grid");
    if (uploadGrid) {
      observer.observe(uploadGrid, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ["class", "hidden"]
      });
    }
    observer.observe(view, {attributes: true, attributeFilter: ["class"]});
    document.addEventListener("efficiencyMorningMeetingCoalFilesChanged", scheduleRender);
    view.addEventListener("change", scheduleRender);
    mobile.addEventListener("change", scheduleRender);
    window.addEventListener("load", scheduleRender, {once: true});
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, {once: true});
  } else {
    initialize();
  }
})();
