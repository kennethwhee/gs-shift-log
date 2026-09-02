import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(path, "utf8");

const desktopHtml = read("index.html");
const mobileHtml = read("mobile-app/index.html");
const style = read("style.css");
const script = read("script.js");

const CACHE_KEY =
  "20260901-limestone-pc-entry-modal-v1";

assert.match(
  desktopHtml,
  new RegExp(`style\\.css\\?v=${CACHE_KEY}`)
);
assert.match(
  desktopHtml,
  new RegExp(`script\\.js\\?v=${CACHE_KEY}`)
);

const editorMarkup = desktopHtml.slice(
  desktopHtml.indexOf('id="limestoneReceiptEditorPanel"'),
  desktopHtml.indexOf("<!-- =================================================\n  부재료 월별 관리")
);

assert.ok(
  editorMarkup.length > 0,
  "desktop limestone editor markup must exist"
);
assert.match(editorMarkup, /aria-hidden="true"/);
assert.match(
  editorMarkup,
  /class="limestone-editor-dialog"[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"/
);
assert.match(
  editorMarkup,
  /aria-labelledby="limestoneReceiptEditorTitle"/
);
assert.equal(
  (
    editorMarkup.match(
      /data-limestone-editor-unit="[12]"/g
    ) || []
  ).length,
  2,
  "desktop editor must expose exactly two direct unit buttons"
);
assert.match(editorMarkup, /id="limestoneReceiptQuantity"/);
assert.match(editorMarkup, /id="limestoneReceiptDate"/);
assert.match(editorMarkup, /id="limestoneReceiptTime"/);
assert.match(editorMarkup, /id="limestoneReceiptNote"/);
assert.match(editorMarkup, />\s*입고 등록\s*</);

const modalStyle = style.slice(
  style.indexOf("LIMESTONE_RECEIPT_PC_ENTRY_MODAL_V1_START")
);

assert.ok(
  modalStyle.length > 0,
  "PC limestone entry modal style marker must exist"
);
assert.match(
  modalStyle,
  /@media screen and \(min-width: 769px\)/
);
assert.match(
  modalStyle,
  /#limestoneReceiptEditorPanel\[hidden\][\s\S]{0,100}?display:\s*none\s*!important/
);
assert.match(
  modalStyle,
  /#limestoneReceiptEditorPanel\s*\{[\s\S]{0,600}?position:\s*fixed\s*!important/
);
assert.match(
  modalStyle,
  /\.limestone-editor-unit-options[\s\S]{0,240}?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/
);
assert.match(
  modalStyle,
  /\.limestone-editor-unit-select\s*\{\s*display:\s*none\s*!important/
);
assert.match(
  modalStyle,
  /#limestoneReceiptQuantity[\s\S]{0,260}?font-size:\s*26px\s*!important/
);

const openStart = script.indexOf(
  "function openLimestoneReceiptEditor("
);
const openEnd = script.indexOf(
  "function closeLimestoneReceiptEditor()",
  openStart
);
const openSource = script.slice(openStart, openEnd);

assert.ok(openStart >= 0 && openEnd > openStart);
assert.doesNotMatch(
  openSource,
  /scrollIntoView/,
  "opening the PC dialog must not move the background dashboard"
);
assert.match(openSource, /aria-hidden"\s*,\s*"false/);
assert.match(
  openSource,
  /receiptUnitButtons\[0\]\?\.focus\(\)/
);

const resetStart = script.indexOf(
  "function resetLimestoneReceiptEditor()"
);
const resetEnd = script.indexOf(
  "function openLimestoneReceiptEditor(",
  resetStart
);
const resetSource = script.slice(resetStart, resetEnd);

assert.match(
  resetSource,
  /limestoneReceiptState[\s\S]*?selectedDay/
);

const closeStart = openEnd;
const closeEnd = script.indexOf(
  "function collectLimestoneReceiptFormData()",
  closeStart
);
const closeSource = script.slice(closeStart, closeEnd);

assert.match(closeSource, /aria-hidden"\s*,\s*"true/);
assert.match(
  closeSource,
  /limestoneReceiptEditorReturnFocus[\s\S]*?\.focus\(\)/
);

const saveStart = script.indexOf(
  "async function saveLimestoneReceipt("
);
const saveEnd = script.indexOf(
  "async function saveLimestoneManualEntry(",
  saveStart
);
const saveSource = script.slice(saveStart, saveEnd);

assert.match(saveSource, /isEditing\s*\?\s*"PUT"\s*:\s*"POST"/);
assert.match(saveSource, /revision/);
assert.match(saveSource, /editorPanel\.dataset\.saving/);
assert.match(saveSource, /savingToken/);
assert.match(
  saveSource,
  /savingToken\s*!==\s*saveRequestToken/
);
assert.match(saveSource, /"입고 등록"/);
assert.match(saveSource, /"수정 저장"/);
assert.ok(
  saveSource.indexOf("showLimestoneToast(") <
    saveSource.indexOf("await loadLimestoneReceipts();"),
  "successful persistence must be acknowledged before list refresh"
);
assert.match(
  saveSource,
  /입고기록은 저장됐지만 목록을 새로 불러오지 못했습니다/
);

const bindStart = script.indexOf(
  "function bindLimestoneReceiptEvents()"
);
const bindEnd = script.indexOf(
  "window.loadLimestoneReceipts",
  bindStart
);
const bindSource = script.slice(bindStart, bindEnd);

assert.match(
  bindSource,
  /data[\s\S]*?limestoneEditorUnit/
);
assert.match(bindSource, /event\.key ===\s*"Escape"/);
assert.match(bindSource, /event\.stopImmediatePropagation\(\)/);
assert.match(bindSource, /event\.key !==\s*"Tab"/);
assert.match(
  bindSource,
  /!editorDialog\.contains\(\s*document\.activeElement\s*\)/
);
assert.match(
  bindSource,
  /event\.target !==\s*editorPanel/
);

assert.match(mobileHtml, /id="limestoneManualEntryModal"/);
assert.match(script, /function openLimestoneManualEntryModal\(\)/);
assert.match(script, /async function saveLimestoneManualEntry\(/);

console.log(
  "Limestone PC entry modal integration verification passed."
);
