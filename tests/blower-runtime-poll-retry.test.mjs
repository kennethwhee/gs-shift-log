import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = path.resolve(process.argv[2] || process.cwd());
const source = fs.readFileSync(path.join(root, "maintenance/blower-history.js"), "utf8");
const pollStart = source.indexOf("  async function waitForDataparcRuntimeProbe(requestId) {");
const syncStart = source.indexOf("  async function syncDataParcBlowerRuntime(", pollStart);
const nextStart = source.indexOf("  function openDataParcRuntimeDialog(", syncStart);
assert.ok(pollStart >= 0 && syncStart > pollStart && nextStart > syncStart);
const functions = source.slice(pollStart, nextStart);
const requestId = "probe/42 +alpha";
const deadlineMs = 2 * 60 * 60 * 1000;
const httpError = (status, extra = {}) => Object.assign(new Error(`HTTP ${status}`), { status, ...extra });

function fixture(steps) {
  let clock = 1000;
  const calls = [], waits = [], statuses = [], toasts = [];
  class FakeDate extends Date { static now() { return clock; } }
  const context = vm.createContext({
    Date: FakeDate, encodeURIComponent, Error,
    DATAPARC_RUNTIME_PILOT_TAG: "104ETH03AN602",
    OIS_REQUEST_API_URL: "/api/ois-data-requests",
    state: { dataparcRuntimeBusy: false },
    stopMobileMutation: () => false,
    setDataparcRuntimeStatus: (_tag, value) => statuses.push(value),
    waitForMilliseconds: async ms => { waits.push(ms); clock += ms; },
    apiRequest: async options => {
      calls.push(JSON.parse(JSON.stringify(options)));
      if (options.method === "POST") {
        assert.ok(["create_blower_runtime_probe", "dataparc_runtime_sync"].includes(options.body.action));
        return options.body.action === "create_blower_runtime_probe"
          ? { item: { id: requestId } } : { message: "saved" };
      }
      assert.equal(options.method, "GET");
      assert.equal(options.body, undefined);
      assert.ok(options.timeoutMs > 0 && options.timeoutMs <= 20000);
      assert.equal(new URL(options.url, "https://fixture.test").searchParams.get("ids"), requestId);
      assert.ok(steps.length, "unexpected extra status request");
      const step = steps.shift();
      if (typeof step === "function") return step(ms => { clock += ms; });
      if (step instanceof Error) throw step;
      return { items: [{ id: requestId, status: step }] };
    },
    loadData: async () => {}, renderAssets: () => {},
    showToast: (...args) => toasts.push(args), console: { error: () => {} }
  });
  vm.runInContext(functions, context);
  return { context, calls, waits, statuses, toasts, elapsed: () => clock - 1000,
    poll: () => context.waitForDataparcRuntimeProbe(requestId) };
}

test("503 recovers on the same request ID using GET only", async () => {
  const f = fixture([httpError(503), "complete"]);
  assert.equal((await f.poll()).status, "complete");
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(call => call.method === "GET" && !call.body));
  assert.deepEqual(f.waits, [1000]);
  assert.deepEqual(f.statuses, ["재연결 중"]);
});

test("five consecutive failures stop after four retries", async () => {
  const f = fixture(Array.from({ length: 5 }, () => httpError(503)));
  await assert.rejects(f.poll(), /HTTP 503/);
  assert.equal(f.calls.length, 5);
  assert.deepEqual(f.waits, [1000, 2000, 4000, 8000]);
});

for (const status of [0, 429, 502, 504]) {
  test(`transient status ${status} can recover`, async () => {
    const f = fixture([httpError(status), "complete"]);
    assert.equal((await f.poll()).status, "complete");
    assert.equal(f.calls.length, 2);
  });
}

for (const status of [400, 401, 403, 404, 500]) {
  test(`status ${status} is terminal even with a retryable hint`, async () => {
    const f = fixture([httpError(status, { retryable: true })]);
    await assert.rejects(f.poll(), new RegExp(`HTTP ${status}`));
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.waits, []);
  });
}

test("validation error, failed job and missing item are terminal", async () => {
  const steps = [new Error("Invalid result"), () => ({ items: [{ id: requestId, status: "failed", errorMessage: "Excel failed" }] }), () => ({ items: [] })];
  for (const step of steps) {
    const f = fixture([step]);
    await assert.rejects(f.poll());
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.waits, []);
  }
});

test("successful processing response resets the consecutive retry count", async () => {
  const failures = () => Array.from({ length: 4 }, () => httpError(503));
  const f = fixture([...failures(), "processing", ...failures(), "complete"]);
  assert.equal((await f.poll()).status, "complete");
  assert.equal(f.calls.length, 10);
  assert.deepEqual(f.waits, [1000, 2000, 4000, 8000, 3000, 1000, 2000, 4000, 8000]);
});

test("Retry-After is used with a thirty-second wait cap", async () => {
  const f = fixture([httpError(429, { retryAfterMs: 12000 }), httpError(503, { retryAfterMs: 120000 }), "complete"]);
  await f.poll();
  assert.deepEqual(f.waits, [12000, 30000]);
});

test("retry cannot extend the original two-hour deadline", async () => {
  const f = fixture([advance => { advance(deadlineMs - 1500); throw httpError(503, { retryAfterMs: 12000 }); }]);
  await assert.rejects(f.poll(), /대기시간이 초과/);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.waits, [1500]);
  assert.equal(f.elapsed(), deadlineMs);
});

test("normal processing polling also stops at the original deadline", async () => {
  const f = fixture([advance => { advance(deadlineMs - 500); return { items: [{ id: requestId, status: "processing" }] }; }]);
  await assert.rejects(f.poll(), /대기시간이 초과/);
  assert.deepEqual(f.waits, [500]);
  assert.equal(f.elapsed(), deadlineMs);
  assert.equal(f.calls.length, 1);
});

test("full sync still creates once and applies once after polling recovers", async () => {
  const f = fixture([httpError(503), "complete"]);
  await f.context.syncDataParcBlowerRuntime("104ETH03AN602", "2026-05-10T00:00:00+09:00");
  const posts = f.calls.filter(call => call.method === "POST");
  assert.deepEqual(posts.map(call => call.body.action), ["create_blower_runtime_probe", "dataparc_runtime_sync"]);
  assert.deepEqual(posts[1].body, { action: "dataparc_runtime_sync", requestId });
  assert.equal(f.calls.filter(call => call.method === "GET").length, 2);
  assert.deepEqual(f.toasts, [["saved"]]);
});
