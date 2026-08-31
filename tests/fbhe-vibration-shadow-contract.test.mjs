import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = relative => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [queueApi, blowerApi, agent, html, frontend, css] = await Promise.all([
  read("functions/api/ois-data-requests.js"),
  read("functions/api/blower-history.js"),
  read("local-tools/ois-agent/ois-login.js"),
  read("maintenance/blower-history.html"),
  read("maintenance/blower-history.js"),
  read("maintenance/blower-history.css")
]);

test("registers FBHE vibration in both server and agent OIS lanes", () => {
  assert.match(queueApi, /const OIS_REQUEST_TYPES = \[[\s\S]*?"fbhe_vibration"/);
  assert.match(queueApi, /const OIS_AGENT_OIS_LANE_REQUEST_TYPES = \[[\s\S]*?"fbhe_vibration"/);
  assert.match(agent, /const oisRequestTypes = \[[\s\S]*?"fbhe_vibration"/);
  assert.match(agent, /requestType ===\s*"fbhe_vibration"[\s\S]*?collectOisFbheVibrationValues/);
});

test("defines six FBHE assets and four vibration positions per asset", () => {
  for (const tag of [
    "104HHL60CS211", "104HHL60CS212", "104HHL60CS213", "104HHL60CS214",
    "104HHL60CS221", "104HHL60CS222", "104HHL60CS223", "104HHL60CS224",
    "104HHL60CS231", "104HHL60CS232", "104HHL60CS233", "104HHL60CS234",
    "204HHL60CS211", "204HHL60CS212", "204HHL60CS213", "204HHL60CS214",
    "204HHL60CS221", "204HHL60CS222", "204HHL60CS223", "204HHL60CS224",
    "204HHL60CS231", "204HHL60CS232", "204HHL60CS233", "204HHL60CS234"
  ]) {
    // Tags are generated from frozen prefix/position definitions, so verify the pieces and output count contract.
    const prefix = tag.slice(0, 3);
    const sensor = tag.slice(-3);
    assert.match(agent, new RegExp(`tagPrefix: "${prefix}"`));
    assert.match(agent, new RegExp(`sensorPrefix: "${sensor.slice(0, 2)}"`));
    assert.match(agent, new RegExp(`sensorOffset: "${sensor.slice(-1)}"`));
  }
  assert.match(agent, /requestedSensorCount:\s*24/);
});

test("keeps Shadow processing read-only", () => {
  const start = blowerApi.indexOf("async function buildFbheVibrationShadowResponse");
  const end = blowerApi.indexOf("async function handleGet", start);
  assert.ok(start >= 0 && end > start);
  const body = blowerApi.slice(start, end);
  assert.doesNotMatch(body, /\b(?:INSERT|UPDATE|DELETE)\b/i);
  assert.match(body, /automaticApply:\s*false/);
  assert.match(body, /actualStateChanged:\s*false/);
  assert.match(body, /runtimeChanged:\s*false/);
  assert.match(body, /cycleChanged:\s*false/);
});

test("allows authenticated desktop users to request and read FBHE vibration", () => {
  const createStart = queueApi.indexOf("async function createUserRequest");
  const createEnd = queueApi.indexOf("async function completeAgentRequest", createStart);
  const createBody = queueApi.slice(createStart, createEnd);
  assert.match(createBody, /const user =\s*authentication\.user/);
  assert.doesNotMatch(createBody, /user\.role !==\s*"super_admin"/);
  assert.match(blowerApi, /action === "vibration_shadow"[\s\S]*?if \(!user\)/);
});

test("ships the desktop-only FBHE validation panel", () => {
  for (const id of [
    "vibrationShadowPanel", "vibrationDate", "vibrationQueryButton", "vibrationRequeryButton",
    "vibrationStatus", "vibrationMetrics", "vibrationBody"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(frontend, new RegExp(`"${id}"`));
  }
  assert.match(css, /body\.mobile-monitoring #vibrationShadowPanel/);
  assert.match(css, /body\.public-monitoring #vibrationShadowPanel/);
  assert.match(frontend, /hasAuthenticatedWriteAccess\(\)/);
});


test("ships direct runtime and history management controls for logged-in desktop users", () => {
  assert.match(html, /id="historyRuntimeStateButton"/);
  assert.match(html, /id="historyRuntimeCorrectionButton"/);
  assert.match(frontend, /data-asset-action="runtime"/);
  assert.match(frontend, /runtime_state_add/);
  assert.match(frontend, /기동 이력 추가/);
  assert.match(frontend, /정지 이력 추가/);
  assert.match(frontend, /runtime_correction/);
  assert.match(frontend, /이력 수정/);
});
