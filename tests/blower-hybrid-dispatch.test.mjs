import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const agentSource = (await readFile(
  new URL("../local-tools/ois-agent/ois-login.js", import.meta.url),
  "utf8"
)).replace(/\r\n?/g, "\n");

function balancedEnd(start, open, close) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < agentSource.length; index += 1) {
    const character = agentSource[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (["\"", "'", "`"].includes(character)) { quote = character; continue; }
    if (character === open) depth += 1;
    if (character === close) depth -= 1;
    if (depth === 0) return index + 1;
  }
  assert.fail(`actual Agent source has an unbalanced ${open}${close} block`);
}

function functionSource(name) {
  const match = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(agentSource);
  assert.ok(match, `${name} must exist in the real Agent`);
  const parameterEnd = balancedEnd(agentSource.indexOf("(", match.index), "(", ")");
  const bodyStart = agentSource.indexOf("{", parameterEnd);
  return agentSource.slice(match.index, balancedEnd(bodyStart, "{", "}"));
}

function stringConstant(name) {
  const match = new RegExp(`const ${name}\\s*=\\s*["']([^"']+)["']`).exec(agentSource);
  assert.ok(match, `${name} must exist in the real Agent`);
  return match[1];
}

const requestType = stringConstant("BLOWER_RUNTIME_PROBE_REQUEST_TYPE");
const blower = { id: "blower-1", requestType, targetDate: "2026-11-06" };
const limestone = { id: "limestone-1", requestType: "limestone_stock" };
const collected = { source: "dataparc_hidden_excel", runtimeHours: 163.4 };

function harness({ response = {}, cofiringBlocked = false, bedAshBlocked = false } = {}) {
  const calls = { api: [], collector: [] };
  const context = vm.createContext({
    Date,
    URL,
    console: { warn() {} },
    OIS_REQUEST_API_PATH: stringConstant("OIS_REQUEST_API_PATH"),
    BLOWER_RUNTIME_PROBE_REQUEST_TYPE: requestType,
    DAILY_OPERATION_REQUEST_TYPE: "daily_operation_data",
    ORGANIC_SILO_REQUEST_TYPE: "organic_silo_dataparc",
    isCofiringExcelBlocked: () => cofiringBlocked,
    isBedAshExcelBlocked: () => bedAshBlocked,
    requestOisAgentApi: async (config, url) => {
      calls.api.push({ config, url: new URL(url) });
      return response;
    },
    collectBlowerRuntimeProbeValues: async (config, item) => {
      calls.collector.push({ config, item });
      return collected;
    }
  });
  vm.runInContext([
    "normalizeOisAgentText",
    "getOisAgentApiUrl",
    "getNextOisAgentRequest",
    "getNextOisAgentLaneRequests",
    "getOisAgentRequestType",
    "isDailyDataExcelRequestType",
    "isExcelComRequestType",
    "isExcelOnlyRequestType",
    "collectOisAgentRequestResult"
  ].map(functionSource).join("\n"), context);
  const config = { agentMode: "hybrid", agentId: "agent-a", shiftLogBaseUrl: "https://example.test" };
  return {
    calls,
    config,
    context,
    run: () => context.getNextOisAgentLaneRequests(config)
  };
}

test("hybrid offers the Blower probe only to Excel while preserving both lane claims and rotation", async () => {
  const h = harness();
  for (let index = 0; index < 2; index += 1) {
    assert.equal((await h.run()).length, 0);
    const { config, url } = h.calls.api[index];
    assert.equal(config, h.config);
    assert.equal(url.pathname, "/api/ois-data-requests");
    assert.equal(url.searchParams.get("action"), "next_lanes");
    const oisTypes = url.searchParams.get("oisRequestTypes").split(",");
    const excelTypes = url.searchParams.get("excelRequestTypes").split(",");
    assert.equal(oisTypes[0], "water_environment");
    assert.ok(oisTypes.includes("limestone_stock"));
    assert.ok(!oisTypes.includes(requestType));
    assert.equal(excelTypes.filter(type => type === requestType).length, 1);
    for (const type of ["cofiring_daily", "cofiring_period", "daily_data_excel", "daily_operation_data", "logsheet_pdf", "open_final_excel_folder"]) {
      assert.ok(excelTypes.includes(type), `existing Excel work ${type} stays available`);
    }
  }
  assert.notEqual(
    h.calls.api[0].url.searchParams.get("excelRequestTypes"),
    h.calls.api[1].url.searchParams.get("excelRequestTypes")
  );
  assert.equal(h.calls.collector.length, 0, "claiming cannot start Excel collection itself");
});

for (const item of [blower, { id: "blower-snake", request_type: requestType, target_date: "2026-11-06" }]) {
  test(`a returned ${item.id} reaches the existing Excel collector without a browser`, async () => {
    const h = harness({ response: { items: { ois: limestone, excel: item } } });
    const items = await h.run();
    assert.equal(items.length, 2);
    assert.equal(items[0], limestone);
    assert.equal(items[1], item);
    assert.equal(h.context.isExcelComRequestType(requestType), true);
    assert.equal(h.context.isExcelOnlyRequestType(requestType), true);
    assert.equal(h.context.isDailyDataExcelRequestType(requestType), false);
    const page = new Proxy({}, { get() { assert.fail("the Blower collector must not use the OIS browser"); } });
    assert.equal(await h.context.collectOisAgentRequestResult(page, h.config, items[1]), collected);
    assert.equal(h.calls.collector.length, 1);
    assert.equal(h.calls.collector[0].config, h.config);
    assert.equal(h.calls.collector[0].item, item);
    assert.equal(h.calls.api.length, 1);
  });
}

test("a Blower returned on the OIS lane is rejected before dispatch", async () => {
  const h = harness({ response: { items: { ois: blower } } });
  await assert.rejects(h.run(), /OIS 레인에 잘못된 요청 유형/);
  assert.equal(h.calls.collector.length, 0);
});

test("Excel-only mode offers and accepts Blower through the existing single-request route", async () => {
  for (const item of [blower, null]) {
    const h = harness({ response: { item } });
    h.config.agentMode = "excel";
    const items = await h.run();
    assert.equal(items.length, item ? 1 : 0);
    if (item) assert.equal(items[0], item);
    assert.equal(h.calls.api.length, 1);
    const { config, url } = h.calls.api[0];
    assert.equal(config, h.config);
    assert.equal(url.searchParams.get("action"), "next");
    const types = url.searchParams.get("requestTypes").split(",");
    assert.equal(types.filter(type => type === requestType).length, 1);
    assert.ok(!types.includes("water_environment"));
    assert.ok(!types.includes("limestone_stock"));
    assert.equal(url.searchParams.has("oisRequestTypes"), false);
    assert.equal(url.searchParams.has("excelRequestTypes"), false);
    assert.equal(h.calls.collector.length, 0);
    if (item) {
      assert.equal(await h.context.collectOisAgentRequestResult(null, h.config, items[0]), collected);
      assert.equal(h.calls.collector.length, 1);
    }
  }
});

test("the non-Excel single-request list remains separate from the Blower Excel lane", async () => {
  const h = harness();
  assert.equal(await h.context.getNextOisAgentRequest(h.config), null);
  const types = h.calls.api[0].url.searchParams.get("requestTypes").split(",");
  assert.ok(!types.includes(requestType));
  assert.ok(types.includes("water_environment"));
  assert.ok(types.includes("limestone_stock"));
});

for (const guard of [{ cofiringBlocked: true }, { bedAshBlocked: true }, { cofiringBlocked: true, bedAshBlocked: true }]) {
  test(`cleanup guards still block Excel work: ${JSON.stringify(guard)}`, async () => {
    const hybrid = harness({ ...guard, response: { item: limestone } });
    const items = await hybrid.run();
    assert.equal(items.length, 1);
    assert.equal(items[0], limestone);
    assert.equal(hybrid.calls.api.length, 1);
    const url = hybrid.calls.api[0].url;
    assert.equal(url.searchParams.get("action"), "next");
    assert.equal(url.searchParams.get("requestTypes"), "limestone_stock");
    assert.equal(url.searchParams.has("excelRequestTypes"), false);
    assert.equal(hybrid.calls.collector.length, 0);

    const excel = harness({ ...guard, response: { item: blower } });
    excel.config.agentMode = "excel";
    await assert.rejects(excel.run(), /Excel 종료 확인/);
    assert.equal(excel.calls.api.length, 0);
    assert.equal(excel.calls.collector.length, 0);
  });
}

test("cleanup isolation rejects a Blower returned through the limestone-only route", async () => {
  const h = harness({ cofiringBlocked: true, response: { item: blower } });
  await assert.rejects(h.run(), /석회석 이외 요청/);
  assert.equal(h.calls.collector.length, 0);
});
