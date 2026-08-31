import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiUrl = new URL("../functions/api/blower-history.js", import.meta.url);
const apiSource = await readFile(apiUrl, "utf8");

assert.match(apiSource, /\[FBHE-VIBRATION-SHADOW-V1\]/);

const instrumentedSource = `${apiSource}
export const __fbheVibrationShadowInstrumentation = {
  findFbheVibrationCluster,
  absoluteFbheVibrationClass,
  absoluteFbheVibrationClass,
  buildFbheVibrationTransitions,
  matchFbheVibrationTransitionsToEvents,
  manualFbheVibrationStateAt,
  buildFbheVibrationAssetShadow,
  buildFbheVibrationRangeChunks
};
`;
const api = await import(
  `data:text/javascript;base64,${Buffer.from(instrumentedSource).toString("base64")}`
);
const {
  absoluteFbheVibrationClass,
  buildFbheVibrationTransitions,
  matchFbheVibrationTransitionsToEvents,
  manualFbheVibrationStateAt,
  buildFbheVibrationAssetShadow,
  buildFbheVibrationRangeChunks
} = api.__fbheVibrationShadowInstrumentation;

const asset = {
  tagNumber: "104HHL60AP611",
  displayName: "#1 FBHE Blower #A",
  unitNo: "1",
  positionLabel: "#A",
  isRunning: false
};

function rawAsset(valuesByRole) {
  return {
    assetTag: asset.tagNumber,
    displayName: asset.displayName,
    unitNo: 1,
    positionLabel: "#A",
    sensors: Object.entries(valuesByRole).map(([role, values], sensorIndex) => ({
      role,
      label: role,
      tag: `TAG-${sensorIndex}`,
      unit: "mm/s",
      samples: values.map((value, index) => ({
        sampledAt: `2026-08-30T${String(index + 1).padStart(2, "0")}:00:00+09:00`,
        value
      }))
    }))
  };
}

const highThenLow = {
  blower_de: [4.2, 4.1, 4.3, 4.0, 4.2, 4.1, 0.18, 0.15, 0.16, 0.14, 0.15, 0.13],
  blower_nde: [3.8, 3.9, 3.7, 3.8, 3.9, 3.8, 0.16, 0.14, 0.13, 0.15, 0.14, 0.12],
  motor_de: [4.5, 4.6, 4.4, 4.5, 4.6, 4.5, 0.20, 0.18, 0.17, 0.18, 0.16, 0.15],
  motor_nde: [4.0, 4.1, 4.0, 4.2, 4.1, 4.0, 0.19, 0.17, 0.16, 0.17, 0.15, 0.14]
};

const lowThenHigh = Object.fromEntries(
  Object.entries(highThenLow).map(([role, values]) => [role, [...values.slice(6), ...values.slice(0, 6)]])
);



test("classifies the observed FBHE run/stop levels even without a two-cluster day", () => {
  const observed = [
    [4.873, 2.692, "high"],
    [8.101, 4.8215, "high"],
    [0.154, 0.1335, "low"],
    [8.9105, 6.0815, "high"],
    [0.158, 0.152, "low"],
    [6.4, 5.68, "high"]
  ];
  for (const [blowerIndex, motorIndex, expected] of observed) {
    assert.equal(absoluteFbheVibrationClass({ blowerIndex, motorIndex }), expected);
  }
});

test("uses a single fresh absolute-band sample for current-state shadow", () => {
  const running = rawAsset({
    blower_de: [4.8], blower_nde: [4.9], motor_de: [2.7], motor_nde: [2.6]
  });
  const stopped = rawAsset({
    blower_de: [0.15], blower_nde: [0.16], motor_de: [0.13], motor_nde: [0.14]
  });
  assert.equal(buildFbheVibrationAssetShadow(asset, running, []).shadowState, "running");
  assert.equal(buildFbheVibrationAssetShadow(asset, stopped, []).shadowState, "stopped");
});
test("detects a conservative stop shadow without changing actual state", () => {
  const report = buildFbheVibrationAssetShadow(asset, rawAsset(highThenLow), []);
  assert.equal(report.shadowState, "stopped");
  assert.ok(report.transitions.some(item => item.type === "stop"));
  assert.equal(report.currentCardState, "stopped");
});

test("detects a conservative start shadow", () => {
  const report = buildFbheVibrationAssetShadow({ ...asset, isRunning: true }, rawAsset(lowThenHigh), []);
  assert.equal(report.shadowState, "running");
  assert.ok(report.transitions.some(item => item.type === "start"));
});

test("separates motor-running blower-drop as drive anomaly", () => {
  const anomaly = {
    blower_de: [4.1, 4.0, 4.2, 0.15, 0.14, 0.13, 0.12, 0.13],
    blower_nde: [3.9, 4.0, 3.8, 0.14, 0.13, 0.12, 0.11, 0.12],
    motor_de: [4.4, 4.5, 4.4, 4.3, 4.4, 4.2, 4.3, 4.4],
    motor_nde: [4.0, 4.1, 4.0, 4.0, 4.1, 4.0, 4.1, 4.0]
  };
  const report = buildFbheVibrationAssetShadow(asset, rawAsset(anomaly), []);
  assert.ok(report.transitions.some(item => item.type === "drive_anomaly"));
  assert.ok(report.anomalyCount >= 1);
});


test("ignores null samples instead of treating them as zero vibration", () => {
  const data = rawAsset({
    blower_de: [4, null, 4.1, 4.2, 4.1, 4.0, 0.15, 0.14, 0.13, 0.12],
    blower_nde: [3.9, null, 4.0, 4.1, 4.0, 3.9, 0.14, 0.13, 0.12, 0.11],
    motor_de: [4.4, null, 4.5, 4.4, 4.5, 4.4, 0.18, 0.17, 0.16, 0.15],
    motor_nde: [4.0, null, 4.1, 4.0, 4.1, 4.0, 0.17, 0.16, 0.15, 0.14]
  });
  const report = buildFbheVibrationAssetShadow(asset, data, []);
  assert.equal(report.shadowState, "stopped");
});

test("counts a missing sensor role as a failed TAG", () => {
  const data = rawAsset(highThenLow);
  data.sensors = data.sensors.filter(sensor => sensor.role !== "motor_nde");
  const report = buildFbheVibrationAssetShadow(asset, data, []);
  assert.equal(report.successfulSensorCount, 3);
  assert.equal(report.failedSensorCount, 1);
  assert.equal(report.failedSensors[0].role, "motor_nde");
});

test("keeps a single abrupt tail as a relative-change candidate only", () => {
  const tailSpike = {
    blower_de: [4.2, 4.1, 4.3, 4.0, 4.2, 4.1, 4.2, 0.15],
    blower_nde: [3.8, 3.9, 3.7, 3.8, 3.9, 3.8, 3.9, 0.14],
    motor_de: [4.5, 4.6, 4.4, 4.5, 4.6, 4.5, 4.4, 0.18],
    motor_nde: [4.0, 4.1, 4.0, 4.2, 4.1, 4.0, 4.1, 0.17]
  };
  const report = buildFbheVibrationAssetShadow(asset, rawAsset(tailSpike), []);
  assert.equal(report.transitions.some(item => item.method === "two_cluster" && item.type === "stop"), false);
  assert.equal(report.transitions.some(item => item.method === "relative_change" && item.type === "stop"), true);
});

test("does not infer a transition across a multi-hour OIS data gap", () => {
  const points = [
    ["2026-08-30T01:00:00+09:00", 4.0],
    ["2026-08-30T02:00:00+09:00", 4.1],
    ["2026-08-30T07:00:00+09:00", 0.15],
    ["2026-08-30T08:00:00+09:00", 0.14]
  ].map(([sampledAt, value]) => ({
    sampledAt,
    blowerIndex: value,
    motorIndex: value,
    combinedIndex: value
  }));
  const cluster = {
    threshold: 1,
    lowerMedian: 0.145,
    upperMedian: 4.05,
    lowerCount: 2,
    upperCount: 2
  };

  assert.deepEqual(buildFbheVibrationTransitions(points, cluster), []);
});

test("same-time replacement followed by startup leaves the manual state running", () => {
  const eventDate = "2026-08-30T10:00:00+09:00";
  const state = manualFbheVibrationStateAt([
    {
      id: "replacement-event",
      event_type: "replacement",
      event_date: eventDate,
      created_at: "2026-08-30T10:00:01+09:00"
    },
    {
      id: "startup-event",
      event_type: "startup",
      event_date: eventDate,
      created_at: "2026-08-30T10:00:02+09:00"
    }
  ], "2026-08-30T11:00:00+09:00");

  assert.equal(state, "running");
});

test("equal-distance manual matches prefer the event with the same target state", () => {
  const matched = matchFbheVibrationTransitionsToEvents([
    {
      type: "start",
      estimatedAt: "2026-08-30T10:00:00+09:00",
      confidence: "high"
    }
  ], [
    {
      id: "stop-event",
      event_type: "operation_stop",
      event_date: "2026-08-30T10:00:00+09:00",
      created_at: "2026-08-30T10:00:02+09:00"
    },
    {
      id: "start-event",
      event_type: "operation_start",
      event_date: "2026-08-30T10:00:00+09:00",
      created_at: "2026-08-30T10:00:01+09:00"
    }
  ]);

  assert.equal(matched[0].manualMatch, "matched");
  assert.equal(matched[0].manualEvent.eventType, "operation_start");
});


test("splits a one-year query into at most twelve 31-day OIS chunks", () => {
  const chunks = buildFbheVibrationRangeChunks("2025-09-01", "2026-08-31");
  assert.equal(chunks.length, 12);
  assert.equal(chunks[0].dayCount, 31);
  assert.ok(chunks.every(chunk => chunk.dayCount >= 1 && chunk.dayCount <= 31));
  assert.equal(chunks.at(-1).endDate, "2026-08-31");
});

test("calculates OIS running hours and replacement-cycle running hours without applying them", () => {
  const report = buildFbheVibrationAssetShadow({
    ...asset,
    isRunning: false,
    lastReplacementAt: "2026-08-30T03:00:00+09:00",
    cycleElapsedHours: 4
  }, rawAsset(highThenLow), [], {
    startAt: new Date("2026-08-30T00:00:00+09:00"),
    endAt: new Date("2026-08-30T13:00:00+09:00")
  });

  assert.equal(report.runtime.oisState, "stopped");
  assert.equal(report.runtime.rangeRunningHours, 6.5);
  assert.equal(report.runtime.rangeStoppedHours, 6.5);
  assert.equal(report.runtime.cycleRuntimeHours, 3.5);
  assert.equal(report.runtime.runtimeDifferenceHours, -0.5);
  assert.equal(report.currentCardState, "stopped");
});
