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

test("restricts queue creation and Shadow report to super admin", () => {
  const createStart = queueApi.indexOf("async function createUserRequest");
  const createEnd = queueApi.indexOf("async function completeAgentRequest", createStart);
  const createBody = queueApi.slice(createStart, createEnd);
  assert.match(createBody, /requestType ===\s*"fbhe_vibration"[\s\S]*?user\.role !==\s*"super_admin"/);
  assert.match(blowerApi, /action === "vibration_shadow"[\s\S]*?!user\?\.isSuperAdmin/);
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
  assert.match(frontend, /state\.data\?\.permissions\?\.canAdmin/);
});
