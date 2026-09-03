import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";


const root = path.resolve(process.argv[2] || process.cwd());
const clientSource = fs.readFileSync(
  path.join(root, "maintenance/blower-history.js"),
  "utf8"
);
const SYNC_FUNCTION_NAME = "syncDataParcBlowerRuntime";


function extractFunction(source, name) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(declaration, `${name} function is missing`);

  const start = declaration.index;
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }

    if (["\"", "'", "`"].includes(character)) {
      quote = character;
      continue;
    }

    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;

    if (depth === 0) return source.slice(start, index + 1);
  }

  assert.fail(`${name} function body is not balanced`);
}


function plain(value) {
  return JSON.parse(JSON.stringify(value));
}


test("frontend performs create, poll, then one request-id-only atomic sync", async () => {
  const apiCalls = [];
  const pollCalls = [];
  const statusCalls = [];
  const toasts = [];
  let loadCount = 0;
  let renderCount = 0;

  const context = vm.createContext({
    DATAPARC_RUNTIME_PILOT_TAG: "104ETH03AN602",
    OIS_REQUEST_API_URL: "/api/ois-data-requests",
    state: {
      dataparcRuntimeBusy: false,
      dataparcRuntimeTag: "",
      dataparcRuntimeStatus: "",
      operationSyncCompleted: false
    },
    stopMobileMutation: () => false,
    setDataparcRuntimeStatus: (tag, status) => statusCalls.push([tag, status]),
    waitForDataparcRuntimeProbe: async requestId => pollCalls.push(requestId),
    apiRequest: async options => {
      apiCalls.push(plain(options));
      return apiCalls.length === 1
        ? { item: { id: "probe-request-1" } }
        : { message: "synced" };
    },
    loadData: async () => {
      loadCount += 1;
    },
    showToast: (...args) => toasts.push(args),
    renderAssets: () => {
      renderCount += 1;
    },
    console
  });

  vm.runInContext(
    `${extractFunction(clientSource, SYNC_FUNCTION_NAME)}\n` +
      `this.${SYNC_FUNCTION_NAME} = ${SYNC_FUNCTION_NAME};`,
    context
  );

  await context[SYNC_FUNCTION_NAME]("104ETH03AN602");

  assert.equal(apiCalls.length, 2);
  assert.deepEqual(apiCalls[0], {
    method: "POST",
    url: "/api/ois-data-requests",
    body: {
      action: "create_blower_runtime_probe"
    }
  });
  assert.deepEqual(pollCalls, ["probe-request-1"]);
  assert.deepEqual(apiCalls[1], {
    method: "POST",
    body: {
      action: "dataparc_runtime_sync",
      requestId: "probe-request-1"
    }
  });
  assert.equal("runtimeHours" in apiCalls[1].body, false);
  assert.equal("isRunning" in apiCalls[1].body, false);
  assert.equal(loadCount, 1);
  assert.equal(context.state.operationSyncCompleted, true);
  assert.equal(context.state.dataparcRuntimeBusy, false);
  assert.equal(context.state.dataparcRuntimeTag, "");
  assert.equal(context.state.dataparcRuntimeStatus, "");
  assert.ok(statusCalls.some(([, status]) => status === "저장 중"));
  assert.deepEqual(toasts, [["synced"]]);
  assert.equal(renderCount, 1);
});


test("frontend blocks unsupported assets and concurrent duplicate clicks", async () => {
  let apiCount = 0;
  const toasts = [];
  const context = vm.createContext({
    DATAPARC_RUNTIME_PILOT_TAG: "104ETH03AN602",
    OIS_REQUEST_API_URL: "/api/ois-data-requests",
    state: {
      dataparcRuntimeBusy: false
    },
    stopMobileMutation: () => false,
    setDataparcRuntimeStatus: () => {},
    waitForDataparcRuntimeProbe: async () => {},
    apiRequest: async () => {
      apiCount += 1;
      return { item: { id: "unexpected" } };
    },
    loadData: async () => {},
    showToast: (...args) => toasts.push(args),
    renderAssets: () => {},
    console
  });

  vm.runInContext(
    `${extractFunction(clientSource, SYNC_FUNCTION_NAME)}\n` +
      `this.${SYNC_FUNCTION_NAME} = ${SYNC_FUNCTION_NAME};`,
    context
  );

  await context[SYNC_FUNCTION_NAME]("104ETH03AN601");
  assert.equal(apiCount, 0);
  assert.equal(toasts.length, 1);

  context.state.dataparcRuntimeBusy = true;
  await context[SYNC_FUNCTION_NAME]("104ETH03AN602");
  assert.equal(apiCount, 0);
});


test("DataPARC action is desktop-only and requires a confirmed started cycle", () => {
  assert.match(
    clientSource,
    /isDataparcRuntimePilot\s*&&\s*actualStarted\s*&&[\s\S]*?!isMobileMonitoringView\(\)/
  );
});


test("poller follows pending and processing until complete", async () => {
  const statuses = ["pending", "processing", "complete"];
  const waits = [];
  const renderedStatuses = [];
  const urls = [];

  const context = vm.createContext({
    DATAPARC_RUNTIME_PILOT_TAG: "104ETH03AN602",
    OIS_REQUEST_API_URL: "/api/ois-data-requests",
    apiRequest: async options => {
      urls.push(options.url);
      const status = statuses.shift();
      return {
        items: [{
          id: "probe-request-2",
          status
        }]
      };
    },
    setDataparcRuntimeStatus: (tag, status) => {
      renderedStatuses.push([tag, status]);
    },
    waitForMilliseconds: async milliseconds => waits.push(milliseconds),
    encodeURIComponent,
    Date,
    Error
  });

  vm.runInContext(
    `${extractFunction(clientSource, "waitForDataparcRuntimeProbe")}\n` +
      "this.waitForDataparcRuntimeProbe = waitForDataparcRuntimeProbe;",
    context
  );

  const item = await context.waitForDataparcRuntimeProbe("probe-request-2");

  assert.equal(item.status, "complete");
  assert.equal(urls.length, 3);
  assert.ok(urls.every(url =>
    url.includes("action=status_batch") &&
    url.includes("ids=probe-request-2")
  ));
  assert.deepEqual(waits, [3000, 3000]);
  assert.deepEqual(renderedStatuses, [
    ["104ETH03AN602", "대기 중"],
    ["104ETH03AN602", "계산 중"]
  ]);
});


test("poller treats failed as terminal and does not keep polling", async () => {
  let callCount = 0;
  const context = vm.createContext({
    DATAPARC_RUNTIME_PILOT_TAG: "104ETH03AN602",
    OIS_REQUEST_API_URL: "/api/ois-data-requests",
    apiRequest: async () => {
      callCount += 1;
      return {
        items: [{
          id: "probe-request-3",
          status: "failed",
          errorMessage: "Excel bridge failed"
        }]
      };
    },
    setDataparcRuntimeStatus: () => {},
    waitForMilliseconds: async () => {
      assert.fail("failed requests must not sleep or poll again");
    },
    encodeURIComponent,
    Date,
    Error
  });

  vm.runInContext(
    `${extractFunction(clientSource, "waitForDataparcRuntimeProbe")}\n` +
      "this.waitForDataparcRuntimeProbe = waitForDataparcRuntimeProbe;",
    context
  );

  await assert.rejects(
    context.waitForDataparcRuntimeProbe("probe-request-3"),
    /Excel bridge failed/
  );
  assert.equal(callCount, 1);
});
