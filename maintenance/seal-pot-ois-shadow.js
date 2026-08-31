"use strict";
/* [SEAL-POT-OIS-APPLY-V2] */

(() => {
  const API_URL = "/api/blower-history";
  const OIS_URL = "/api/ois-data-requests";
  const AUTH_STORAGE_KEY = "gsShiftLog.currentUser";
  const CACHE_KEY = "gsShiftLog.blowerHistory.sealPotOisAnalysis.v2";
  const LAST_RANGE_KEY = "gsShiftLog.blowerHistory.sealPotOisLastRange.v1";
  const MAX_DAYS = 366;
  const CHUNK_DAYS = 31;
  const GAP_MS = 90 * 60 * 1000;
  const APPLY_COVERAGE_PCT = 95;
  const STATE_FRESH_HOURS = 3;
  const MOBILE_QUERY = "(max-width: 700px), (max-width: 1024px) and (hover: none) and (pointer: coarse)";

  let button = null;
  let dialog = null;
  let currentReport = null;
  let blowerData = null;
  let polling = false;
  let applying = false;
  let restoringSaved = false;

  function currentUser() {
    try {
      return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null");
    } catch {
      return null;
    }
  }

  function isMobileMonitoring() {
    return Boolean(window.matchMedia?.(MOBILE_QUERY).matches);
  }

  function authHeaders(json = false) {
    const token = String(
      currentUser()?.sessionToken ||
      currentUser()?.session_token ||
      ""
    ).trim();

    return {
      Accept: "application/json",
      "X-GS-Client-Mode": isMobileMonitoring() ? "mobile-monitoring" : "desktop",
      ...(json ? {"Content-Type": "application/json; charset=utf-8"} : {}),
      ...(token ? {Authorization: `Bearer ${token}`} : {})
    };
  }

  async function readJson(response) {
    const text = await response.text();
    let payload = {};

    try {
      payload = text.trim() ? JSON.parse(text) : {};
    } catch {
      throw new Error("서버 응답 형식을 확인할 수 없습니다.");
    }

    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.message || `요청 실패 (${response.status})`);
      error.status = response.status;
      error.code = String(payload.code || "");
      throw error;
    }

    return payload;
  }

  async function postBlower(body) {
    if (isMobileMonitoring()) {
      throw new Error("모바일에서는 Blower 현황과 이력만 조회할 수 있습니다.");
    }

    const response = await fetch(API_URL, {
      method: "POST",
      headers: authHeaders(true),
      cache: "no-store",
      body: JSON.stringify(body)
    });

    return await readJson(response);
  }

  function isoToday() {
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return now.toISOString().slice(0, 10);
  }

  function addDays(value, days) {
    const parsed = new Date(`${value}T00:00:00+09:00`);
    if (Number.isNaN(parsed.getTime())) return "";
    parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
    const kst = new Date(parsed.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
  }

  function countDays(startDate, endDate) {
    const start = new Date(`${startDate}T00:00:00+09:00`);
    const end = new Date(`${endDate}T00:00:00+09:00`);

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end < start
    ) {
      return 0;
    }

    return Math.floor((end - start) / 86400000) + 1;
  }

  function rangeKey(startDate, endDate) {
    return `${startDate}~${endDate}`;
  }

  function buildRangeChunks(startDate, endDate) {
    const days = countDays(startDate, endDate);
    if (days < 1 || days > MAX_DAYS) return [];

    const chunks = [];
    let cursor = startDate;

    while (cursor <= endDate) {
      const candidateEnd = addDays(cursor, CHUNK_DAYS - 1);
      const chunkEnd = candidateEnd && candidateEnd < endDate
        ? candidateEnd
        : endDate;

      chunks.push({
        startDate: cursor,
        endDate: chunkEnd,
        targetDate: `${cursor}~${chunkEnd}`,
        dayCount: countDays(cursor, chunkEnd)
      });

      cursor = addDays(chunkEnd, 1);
    }

    return chunks;
  }

  function rangeBounds(startDate, endDate) {
    const startAt = new Date(`${startDate}T00:00:00+09:00`);
    const nextDate = addDays(endDate, 1);
    const endExclusive = new Date(`${nextDate}T00:00:00+09:00`);
    const now = new Date();
    const endAt = endExclusive > now ? now : endExclusive;

    return {startAt, endAt};
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || String(value).trim() === "") {
      return null;
    }

    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  function quantile(values, q) {
    const sorted = values
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

    if (!sorted.length) return null;

    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;

    return sorted[base + 1] !== undefined
      ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
      : sorted[base];
  }

  function median(values) {
    return quantile(values, 0.5);
  }

  function profileSensor(sensor) {
    const values = (sensor?.samples || [])
      .map(sample => Number(sample?.value))
      .filter(Number.isFinite);

    if (values.length < 8) {
      return {
        ...sensor,
        low: null,
        high: null,
        spread: 0,
        reliable: false
      };
    }

    const low = quantile(values, 0.2);
    const high = quantile(values, 0.8);
    const spread = Number.isFinite(low) && Number.isFinite(high)
      ? high - low
      : 0;
    const role = String(sensor?.role || "");
    const isPressure = role === "discharge_pressure";
    let reliable = false;

    if (isPressure) {
      const scale = Math.max(
        Math.abs(Number(low) || 0),
        Math.abs(Number(high) || 0),
        1
      );

      reliable = spread > 0 && (
        spread >= scale * 0.12 ||
        (
          Math.abs(Number(low) || 0) <= scale * 0.08 &&
          spread >= scale * 0.04
        )
      );
    } else {
      reliable = spread >= 4;
    }

    return {...sensor, low, high, spread, reliable};
  }

  function normalizeByProfile(value, profile) {
    if (
      !profile?.reliable ||
      !Number.isFinite(Number(value)) ||
      !Number.isFinite(Number(profile.low)) ||
      !Number.isFinite(Number(profile.high)) ||
      Number(profile.high) <= Number(profile.low)
    ) {
      return null;
    }

    return Math.max(
      0,
      Math.min(
        1,
        (Number(value) - Number(profile.low)) /
          (Number(profile.high) - Number(profile.low))
      )
    );
  }

  function buildAssetPoints(rawAsset) {
    const profiles = (rawAsset?.sensors || []).map(profileSensor);
    const byRole = new Map(
      profiles.map(sensor => [
        sensor.role,
        {
          profile: sensor,
          samples: new Map(
            (sensor.samples || []).map(sample => [
              sample.sampledAt || sample.sampled_at,
              Number(sample.value)
            ])
          )
        }
      ])
    );

    const timestamps = new Set();

    for (const sensor of profiles) {
      for (const sample of sensor.samples || []) {
        const sampledAt = String(sample.sampledAt || sample.sampled_at || "");
        if (sampledAt) timestamps.add(sampledAt);
      }
    }

    const tempRoles = [
      "blower_de_temp",
      "blower_nde_temp",
      "motor_de_temp",
      "motor_nde_temp"
    ];

    const points = [...timestamps]
      .sort()
      .map(sampledAt => {
        const pressureEntry = byRole.get("discharge_pressure");
        const pressureValue = pressureEntry?.samples.get(sampledAt);
        const pressureIndex = normalizeByProfile(
          pressureValue,
          pressureEntry?.profile
        );

        const tempIndexes = tempRoles
          .map(role => {
            const entry = byRole.get(role);
            return normalizeByProfile(
              entry?.samples.get(sampledAt),
              entry?.profile
            );
          })
          .filter(value => value !== null);

        const tempIndex = tempIndexes.length >= 2
          ? median(tempIndexes)
          : null;

        let index = null;
        let source = "unknown";

        if (pressureIndex !== null) {
          index = pressureIndex;
          source = "pressure";
        } else if (tempIndex !== null) {
          index = tempIndex;
          source = "temperature";
        }

        let state = "unknown";

        if (index !== null) {
          if (index >= 0.65) state = "running";
          else if (index <= 0.35) state = "stopped";
        }

        return {
          sampledAt,
          index,
          source,
          state,
          inferred: false
        };
      });

    // V2: hysteresis. A middle-band value keeps the previous definite state
    // only while hourly data is continuous. Missing signals or >90 min gaps
    // break the carry-forward so the missing period stays unknown.
    let heldState = "";
    let previousAt = null;

    for (const point of points) {
      const pointAt = new Date(point.sampledAt);
      const pointMs = pointAt.getTime();

      if (Number.isNaN(pointMs)) {
        heldState = "";
        previousAt = null;
        continue;
      }

      if (
        previousAt !== null &&
        pointMs - previousAt > GAP_MS
      ) {
        heldState = "";
      }

      if (["running", "stopped"].includes(point.state)) {
        heldState = point.state;
      } else if (point.index !== null && heldState) {
        point.state = heldState;
        point.inferred = true;
      } else if (point.index === null) {
        heldState = "";
      }

      previousAt = pointMs;
    }

    const pressureProfile = profiles.find(
      sensor => sensor.role === "discharge_pressure"
    );
    const reliableTemperatureCount = profiles.filter(
      sensor => tempRoles.includes(sensor.role) && sensor.reliable
    ).length;

    return {
      profiles,
      points,
      pressureReliable: Boolean(pressureProfile?.reliable),
      reliableTemperatureCount
    };
  }

  function addRuntimeSpan(summary, state, startMs, endMs, source = "unknown") {
    if (!(endMs > startMs)) return;

    const duration = endMs - startMs;

    if (state === "running") {
      summary.runningMs += duration;
    } else if (state === "stopped") {
      summary.stoppedMs += duration;
    } else {
      summary.unknownMs += duration;
      return;
    }

    const startAt = new Date(startMs).toISOString();
    const endAt = new Date(endMs).toISOString();
    const previous = summary.segments[summary.segments.length - 1];

    if (
      previous &&
      previous.state === state &&
      previous.endAt === startAt
    ) {
      previous.endAt = endAt;
      if (previous.source !== source) previous.source = "mixed";
    } else {
      summary.segments.push({state, startAt, endAt, source});
    }
  }

  function summarizeRuntime(points, bounds, startAtOverride = null) {
    const rawStart = startAtOverride instanceof Date
      ? startAtOverride
      : bounds.startAt;
    const startMs = Math.max(bounds.startAt.getTime(), rawStart.getTime());
    const endMs = bounds.endAt.getTime();

    const summary = {
      runningMs: 0,
      stoppedMs: 0,
      unknownMs: 0,
      segments: [],
      latestState: "unknown",
      latestSource: "unknown",
      latestAt: "",
      transitions: 0
    };

    if (!(endMs > startMs)) {
      return {
        runningHours: 0,
        stoppedHours: 0,
        unknownHours: 0,
        coveragePct: 0,
        currentState: "unknown",
        currentSource: "unknown",
        latestAt: "",
        transitions: 0,
        segments: []
      };
    }

    const normalized = (points || [])
      .map(point => ({
        ...point,
        timeMs: new Date(point.sampledAt).getTime()
      }))
      .filter(point => Number.isFinite(point.timeMs))
      .sort((a, b) => a.timeMs - b.timeMs);

    if (!normalized.length) {
      summary.unknownMs = endMs - startMs;
    } else {
      let firstRelevantIndex = normalized.findIndex(point => point.timeMs >= startMs);
      if (firstRelevantIndex < 0) firstRelevantIndex = normalized.length;

      let previousIndex = firstRelevantIndex - 1;
      let cursor = startMs;

      if (previousIndex >= 0) {
        const previous = normalized[previousIndex];
        const nextMs = firstRelevantIndex < normalized.length
          ? Math.min(normalized[firstRelevantIndex].timeMs, endMs)
          : endMs;

        if (nextMs > cursor) {
          const trustedUntil = Math.min(
            nextMs,
            previous.timeMs + GAP_MS
          );

          if (trustedUntil > cursor) {
            addRuntimeSpan(
              summary,
              previous.state,
              cursor,
              trustedUntil,
              previous.source
            );
          }

          if (nextMs > trustedUntil) {
            addRuntimeSpan(summary, "unknown", trustedUntil, nextMs);
          }

          cursor = nextMs;
        }
      }

      if (previousIndex < 0 && firstRelevantIndex < normalized.length) {
        const firstMs = Math.min(normalized[firstRelevantIndex].timeMs, endMs);
        if (firstMs > cursor) {
          addRuntimeSpan(summary, "unknown", cursor, firstMs);
          cursor = firstMs;
        }
      }

      for (let index = firstRelevantIndex; index < normalized.length; index += 1) {
        const point = normalized[index];
        if (point.timeMs >= endMs) break;

        const intervalStart = Math.max(point.timeMs, startMs, cursor);
        const nextPoint = normalized[index + 1];
        const intervalEnd = Math.min(
          nextPoint ? nextPoint.timeMs : endMs,
          endMs
        );

        if (!(intervalEnd > intervalStart)) continue;

        const trustedUntil = Math.min(
          intervalEnd,
          point.timeMs + GAP_MS
        );

        if (trustedUntil > intervalStart) {
          addRuntimeSpan(
            summary,
            point.state,
            intervalStart,
            trustedUntil,
            point.source
          );
        }

        if (intervalEnd > trustedUntil) {
          addRuntimeSpan(summary, "unknown", trustedUntil, intervalEnd);
        }

        cursor = Math.max(cursor, intervalEnd);
      }

      if (cursor < endMs) {
        addRuntimeSpan(summary, "unknown", cursor, endMs);
      }
    }

    const latest = [...normalized]
      .reverse()
      .find(point =>
        point.timeMs <= endMs &&
        ["running", "stopped"].includes(point.state)
      );

    if (latest) {
      summary.latestState = latest.state;
      summary.latestSource = latest.source || "unknown";
      summary.latestAt = latest.sampledAt;
    }

    let previousState = "";
    let previousEndMs = null;

    for (const segment of summary.segments) {
      const segmentStart = new Date(segment.startAt).getTime();
      const segmentEnd = new Date(segment.endAt).getTime();

      if (
        previousState &&
        previousState !== segment.state &&
        previousEndMs !== null &&
        Math.abs(segmentStart - previousEndMs) <= 1000
      ) {
        summary.transitions += 1;
      }

      previousState = segment.state;
      previousEndMs = segmentEnd;
    }

    const decidedMs = summary.runningMs + summary.stoppedMs;
    const totalMs = decidedMs + summary.unknownMs;

    return {
      runningHours: summary.runningMs / 3600000,
      stoppedHours: summary.stoppedMs / 3600000,
      unknownHours: summary.unknownMs / 3600000,
      coveragePct: totalMs > 0 ? decidedMs / totalMs * 100 : 0,
      currentState: summary.latestState,
      currentSource: summary.latestSource,
      latestAt: summary.latestAt,
      transitions: summary.transitions,
      segments: summary.segments
    };
  }

  function mergeSegments(segments) {
    const sorted = (segments || [])
      .filter(segment =>
        ["running", "stopped"].includes(String(segment?.state || "")) &&
        segment?.startAt &&
        segment?.endAt
      )
      .sort((left, right) =>
        String(left.startAt).localeCompare(String(right.startAt))
      );

    const merged = [];

    for (const segment of sorted) {
      const previous = merged[merged.length - 1];

      if (
        previous &&
        previous.state === segment.state &&
        previous.endAt === segment.startAt
      ) {
        previous.endAt = segment.endAt;
        if (previous.source !== segment.source) previous.source = "mixed";
      } else {
        merged.push({...segment});
      }
    }

    return merged;
  }

  function formatHours(value) {
    const hours = Number(value);
    if (!Number.isFinite(hours)) return "-";

    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remain = Math.round(hours - days * 24);
      return `${days}일 ${remain}시간`;
    }

    return `${hours.toFixed(1)}시간`;
  }

  function stateLabel(value) {
    return {
      running: "운전",
      stopped: "정지",
      unknown: "판정보류"
    }[value] || "판정보류";
  }

  function profileSummary(built) {
    if (built.pressureReliable) return "압력 우선";
    if (built.reliableTemperatureCount >= 2) {
      return `온도 ${built.reliableTemperatureCount}/4`;
    }
    return "판정자료 부족";
  }

  function analyseRawChunk(raw, assets, startDate, endDate) {
    const rawByTag = new Map(
      (raw?.assets || []).map(asset => [
        String(asset.assetTag || asset.tagNumber || "").trim().toUpperCase(),
        asset
      ])
    );
    const bounds = rangeBounds(startDate, endDate);

    return assets.map(asset => {
      const tag = String(asset.tagNumber || "").trim().toUpperCase();
      const rawAsset = rawByTag.get(tag) || {assetTag: tag, sensors: []};
      const built = buildAssetPoints(rawAsset);
      const rangeRuntime = summarizeRuntime(built.points, bounds);
      const replacementAt = asset.lastReplacementAt
        ? new Date(asset.lastReplacementAt)
        : null;
      const validReplacement = replacementAt && !Number.isNaN(replacementAt.getTime());
      const cycleRuntime = validReplacement
        ? summarizeRuntime(built.points, bounds, replacementAt)
        : null;
      const latest = rangeRuntime.latestAt
        ? new Date(rangeRuntime.latestAt)
        : null;
      const latestAgeHours = latest && !Number.isNaN(latest.getTime())
        ? (Date.now() - latest.getTime()) / 3600000
        : Infinity;
      const currentState = latestAgeHours >= -0.1 && latestAgeHours <= STATE_FRESH_HOURS
        ? rangeRuntime.currentState
        : "unknown";
      const successfulSensorCount = (rawAsset.sensors || []).filter(
        sensor => (sensor.samples || []).length > 0
      ).length;

      return {
        tagNumber: tag,
        displayName: asset.displayName || tag,
        unitNo: asset.unitNo,
        positionLabel: asset.positionLabel,
        lastReplacementAt: asset.lastReplacementAt || "",
        successfulSensorCount,
        pressureReliable: built.pressureReliable,
        reliableTemperatureCount: built.reliableTemperatureCount,
        runtimeSignalReady:
          successfulSensorCount >= 4 &&
          (built.pressureReliable || built.reliableTemperatureCount >= 2),
        classifier: profileSummary(built),
        runtime: {
          rangeRunningHours: rangeRuntime.runningHours,
          rangeStoppedHours: rangeRuntime.stoppedHours,
          rangeUnknownHours: rangeRuntime.unknownHours,
          rangeCoveragePct: rangeRuntime.coveragePct,
          cycleRuntimeHours: cycleRuntime?.runningHours ?? null,
          cycleStoppedHours: cycleRuntime?.stoppedHours ?? null,
          cycleUnknownHours: cycleRuntime?.unknownHours ?? null,
          cycleCoveragePct: cycleRuntime?.coveragePct ?? null,
          oisState: currentState,
          latestSampleAt: rangeRuntime.latestAt,
          latestSource: rangeRuntime.currentSource,
          transitionCount: rangeRuntime.transitions,
          cycleSegments: cycleRuntime?.segments || []
        }
      };
    });
  }

  function aggregateReports(reports, startDate, endDate, assets, queue) {
    const byTag = new Map(
      assets.map(asset => [
        String(asset.tagNumber || "").toUpperCase(),
        []
      ])
    );

    for (const report of reports) {
      for (const asset of report.assets || []) {
        byTag.get(asset.tagNumber)?.push(asset);
      }
    }

    const analysisBounds = rangeBounds(startDate, endDate);

    const mergedAssets = assets.map(asset => {
      const tag = String(asset.tagNumber || "").toUpperCase();
      const chunks = byTag.get(tag) || [];
      const sum = field => chunks
        .map(chunk => finiteNumber(chunk.runtime?.[field]))
        .filter(value => value !== null)
        .reduce((total, value) => total + value, 0);

      const rangeRunningHours = sum("rangeRunningHours");
      const rangeStoppedHours = sum("rangeStoppedHours");
      const rangeUnknownHours = sum("rangeUnknownHours");
      const rangeTotal = rangeRunningHours + rangeStoppedHours + rangeUnknownHours;
      const cycleRunningHours = sum("cycleRuntimeHours");
      const cycleStoppedHours = sum("cycleStoppedHours");
      const cycleUnknownHours = sum("cycleUnknownHours");
      const cycleTotal = cycleRunningHours + cycleStoppedHours + cycleUnknownHours;
      const latestChunk = [...chunks]
        .filter(chunk => chunk.runtime?.latestSampleAt)
        .sort((left, right) =>
          String(right.runtime.latestSampleAt).localeCompare(
            String(left.runtime.latestSampleAt)
          )
        )[0];
      const cycleSegments = mergeSegments(
        chunks.flatMap(chunk => chunk.runtime?.cycleSegments || [])
      );
      const replacementAt = asset.lastReplacementAt
        ? new Date(asset.lastReplacementAt)
        : null;
      const replacementValid = replacementAt && !Number.isNaN(replacementAt.getTime());
      const cycleRangeComplete = Boolean(
        replacementValid &&
        replacementAt >= analysisBounds.startAt &&
        endDate === isoToday()
      );
      const runtimeSignalReady = chunks.length > 0 && chunks.every(
        chunk => chunk.runtimeSignalReady === true
      );
      const pressureReliable = Boolean(latestChunk?.pressureReliable);
      const reliableTemperatureCount = Number(
        latestChunk?.reliableTemperatureCount || 0
      );

      return {
        tagNumber: asset.tagNumber,
        displayName: asset.displayName,
        lastReplacementAt: asset.lastReplacementAt || "",
        successfulSensorCount: Math.max(
          0,
          ...chunks.map(chunk => Number(chunk.successfulSensorCount || 0))
        ),
        pressureReliable,
        reliableTemperatureCount,
        runtimeSignalReady,
        classifier: latestChunk?.classifier || chunks[0]?.classifier || "-",
        runtime: {
          rangeRunningHours,
          rangeStoppedHours,
          rangeUnknownHours,
          rangeCoveragePct: rangeTotal > 0
            ? (rangeRunningHours + rangeStoppedHours) / rangeTotal * 100
            : 0,
          cycleRuntimeHours: replacementValid ? cycleRunningHours : null,
          cycleStoppedHours: replacementValid ? cycleStoppedHours : null,
          cycleUnknownHours: replacementValid ? cycleUnknownHours : null,
          cycleCoveragePct: replacementValid && cycleTotal > 0
            ? (cycleRunningHours + cycleStoppedHours) / cycleTotal * 100
            : 0,
          cycleRangeComplete,
          oisState: latestChunk?.runtime?.oisState || "unknown",
          latestSampleAt: latestChunk?.runtime?.latestSampleAt || "",
          latestSource: latestChunk?.runtime?.latestSource || "unknown",
          transitionCount: chunks.reduce(
            (total, chunk) => total + Number(chunk.runtime?.transitionCount || 0),
            0
          ),
          segments: cycleSegments
        }
      };
    });

    return {
      version: 2,
      startDate,
      endDate,
      dayCount: countDays(startDate, endDate),
      queue,
      assets: mergedAssets,
      completedAt: new Date().toISOString()
    };
  }

  function queueSummary(items = []) {
    const count = status => items.filter(item => item.status === status).length;
    const failedCount = count("failed") + count("expired");

    return {
      chunkCount: items.length,
      completeCount: count("complete"),
      pendingCount: count("pending"),
      processingCount: count("processing"),
      failedCount,
      missingCount: count("missing"),
      items: items.map(item => ({
        id: item.id || "",
        targetDate: item.targetDate || item.target_date || "",
        status: item.status || "missing"
      }))
    };
  }

  function readCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveCache(report) {
    if (!report?.startDate || !report?.endDate || report.version !== 2) return;

    const cache = readCache();
    cache[rangeKey(report.startDate, report.endDate)] = report;

    const keys = Object.keys(cache).sort((left, right) =>
      String(cache[right]?.completedAt || "").localeCompare(
        String(cache[left]?.completedAt || "")
      )
    );

    for (const key of keys.slice(4)) delete cache[key];

    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      localStorage.setItem(
        LAST_RANGE_KEY,
        JSON.stringify({
          startDate: report.startDate,
          endDate: report.endDate
        })
      );
    } catch (error) {
      console.warn("Seal Pot OIS V2 cache save failed:", error);
    }
  }

  function restoreCache(startDate, endDate) {
    const report = readCache()[rangeKey(startDate, endDate)];

    if (report?.version === 2 && report?.assets?.length) {
      currentReport = report;
      return true;
    }

    return false;
  }

  function getRange() {
    const startDate = dialog?.querySelector("#sealPotOisStart")?.value || "";
    const endDate = dialog?.querySelector("#sealPotOisEnd")?.value || "";

    return {
      startDate,
      endDate,
      dayCount: countDays(startDate, endDate),
      key: rangeKey(startDate, endDate)
    };
  }

  function setRange(startDate, endDate) {
    dialog.querySelector("#sealPotOisStart").value = startDate;
    dialog.querySelector("#sealPotOisEnd").value = endDate;
  }

  async function refreshBlowerData() {
    const response = await fetch(`${API_URL}?_=${Date.now()}`, {
      headers: authHeaders(),
      cache: "no-store"
    });

    blowerData = await readJson(response);
    return blowerData;
  }

  function sealPotAssets() {
    return (blowerData?.assets || []).filter(
      asset => asset.blowerType === "seal_pot"
    );
  }

  function findCurrentAsset(tagNumber) {
    const tag = String(tagNumber || "").trim().toUpperCase();
    return sealPotAssets().find(
      asset => String(asset.tagNumber || "").trim().toUpperCase() === tag
    ) || null;
  }

  function hasWriteAccess() {
    const explicit = blowerData?.permissions?.canWrite;
    return typeof explicit === "boolean"
      ? explicit
      : Boolean(blowerData?.user && currentUser());
  }

  async function fetchRaw(targetDate, allowMissing = false) {
    const url = new URL(API_URL, window.location.origin);
    url.searchParams.set("action", "seal_pot_raw");
    url.searchParams.set("targetDate", targetDate);
    url.searchParams.set("_", String(Date.now()));

    const response = await fetch(url, {
      headers: authHeaders(),
      cache: "no-store"
    });

    if (allowMissing && response.status === 404) {
      return null;
    }

    return await readJson(response);
  }

  async function waitRequests(items) {
    const ids = items.map(item => item.id).filter(Boolean);
    const map = new Map(items.map(item => [item.id, item]));

    if (!ids.length) return [...map.values()];

    for (let attempt = 0; attempt < 2400; attempt += 1) {
      const url = new URL(OIS_URL, window.location.origin);
      url.searchParams.set("action", "status_batch");
      url.searchParams.set("compact", "1");
      url.searchParams.set("ids", ids.join(","));
      url.searchParams.set("_", String(Date.now()));

      const response = await fetch(url, {
        headers: authHeaders(),
        cache: "no-store"
      });
      const payload = await readJson(response);

      for (const item of payload.items || []) {
        map.set(item.id, item);
      }

      const all = [...map.values()];
      renderStatus(
        `OIS 조회 중 · ${all.filter(item => item.status === "complete").length}/${all.length}`,
        "running"
      );

      if (all.every(item => !["pending", "processing"].includes(item.status))) {
        return all;
      }

      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    throw new Error("Seal Pot OIS 조회가 최대 대기시간을 초과했습니다.");
  }

  function mergeRawResults(rawResults) {
    const assetMap = new Map();

    for (const raw of rawResults || []) {
      for (const rawAsset of raw?.assets || []) {
        const tag = String(rawAsset.assetTag || rawAsset.tagNumber || "")
          .trim()
          .toUpperCase();
        if (!tag) continue;

        if (!assetMap.has(tag)) {
          assetMap.set(tag, {
            assetTag: tag,
            tagNumber: tag,
            displayName: rawAsset.displayName || tag,
            unitNo: rawAsset.unitNo,
            positionLabel: rawAsset.positionLabel,
            sensorMap: new Map()
          });
        }

        const mergedAsset = assetMap.get(tag);

        for (const rawSensor of rawAsset.sensors || []) {
          const role = String(rawSensor.role || "").trim();
          if (!role) continue;

          if (!mergedAsset.sensorMap.has(role)) {
            mergedAsset.sensorMap.set(role, {
              role,
              label: rawSensor.label || role,
              tag: rawSensor.tag || "",
              itemName: rawSensor.itemName || rawSensor.item_name || "",
              unit: rawSensor.unit || "",
              sampleMap: new Map()
            });
          }

          const mergedSensor = mergedAsset.sensorMap.get(role);

          for (const sample of rawSensor.samples || []) {
            const sampledAt = String(sample.sampledAt || sample.sampled_at || "");
            const value = Number(sample.value);
            if (!sampledAt || !Number.isFinite(value)) continue;
            mergedSensor.sampleMap.set(sampledAt, value);
          }
        }
      }
    }

    return {
      assets: [...assetMap.values()].map(asset => ({
        assetTag: asset.assetTag,
        tagNumber: asset.tagNumber,
        displayName: asset.displayName,
        unitNo: asset.unitNo,
        positionLabel: asset.positionLabel,
        sensors: [...asset.sensorMap.values()].map(sensor => ({
          role: sensor.role,
          label: sensor.label,
          tag: sensor.tag,
          itemName: sensor.itemName,
          unit: sensor.unit,
          samples: [...sensor.sampleMap.entries()]
            .sort((left, right) => left[0].localeCompare(right[0]))
            .map(([sampledAt, value]) => ({sampledAt, value}))
        }))
      }))
    };
  }

  function analyseMergedRaw(rawResults, assets, range, items) {
    const mergedRaw = mergeRawResults(rawResults);
    const rawByTag = new Map(
      (mergedRaw.assets || []).map(asset => [
        String(asset.assetTag || asset.tagNumber || "").trim().toUpperCase(),
        asset
      ])
    );
    const bounds = rangeBounds(range.startDate, range.endDate);

    const reportAssets = assets.map(asset => {
      const tag = String(asset.tagNumber || "").trim().toUpperCase();
      const rawAsset = rawByTag.get(tag) || {assetTag: tag, sensors: []};
      const built = buildAssetPoints(rawAsset);
      const rangeRuntime = summarizeRuntime(built.points, bounds);
      const replacementAt = asset.lastReplacementAt
        ? new Date(asset.lastReplacementAt)
        : null;
      const validReplacement = replacementAt && !Number.isNaN(replacementAt.getTime());
      const cycleRuntime = validReplacement
        ? summarizeRuntime(built.points, bounds, replacementAt)
        : null;
      const latest = rangeRuntime.latestAt
        ? new Date(rangeRuntime.latestAt)
        : null;
      const latestAgeHours = latest && !Number.isNaN(latest.getTime())
        ? (Date.now() - latest.getTime()) / 3600000
        : Infinity;
      const oisState = latestAgeHours >= -0.1 && latestAgeHours <= STATE_FRESH_HOURS
        ? rangeRuntime.currentState
        : "unknown";
      const successfulSensorCount = (rawAsset.sensors || []).filter(
        sensor => (sensor.samples || []).length > 0
      ).length;
      const cycleRangeComplete = Boolean(
        validReplacement &&
        replacementAt >= bounds.startAt &&
        range.endDate === isoToday()
      );

      return {
        tagNumber: tag,
        displayName: asset.displayName || tag,
        lastReplacementAt: asset.lastReplacementAt || "",
        successfulSensorCount,
        pressureReliable: built.pressureReliable,
        reliableTemperatureCount: built.reliableTemperatureCount,
        runtimeSignalReady:
          successfulSensorCount >= 4 &&
          (built.pressureReliable || built.reliableTemperatureCount >= 2),
        classifier: profileSummary(built),
        runtime: {
          rangeRunningHours: rangeRuntime.runningHours,
          rangeStoppedHours: rangeRuntime.stoppedHours,
          rangeUnknownHours: rangeRuntime.unknownHours,
          rangeCoveragePct: rangeRuntime.coveragePct,
          cycleRuntimeHours: cycleRuntime?.runningHours ?? null,
          cycleStoppedHours: cycleRuntime?.stoppedHours ?? null,
          cycleUnknownHours: cycleRuntime?.unknownHours ?? null,
          cycleCoveragePct: cycleRuntime?.coveragePct ?? 0,
          cycleRangeComplete,
          oisState,
          latestSampleAt: rangeRuntime.latestAt,
          latestSource: rangeRuntime.currentSource,
          transitionCount: rangeRuntime.transitions,
          segments: cycleRuntime?.segments || []
        }
      };
    });

    return {
      version: 2,
      startDate: range.startDate,
      endDate: range.endDate,
      dayCount: range.dayCount,
      queue: queueSummary(items),
      assets: reportAssets,
      completedAt: new Date().toISOString()
    };
  }

  async function analyseItems(items, range, assets, sourceLabel) {
    const rawResults = [];

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const targetDate = String(item.targetDate || item.target_date || "");

      renderStatus(
        `${sourceLabel} 불러오는 중 · ${index + 1}/${items.length}`,
        "running"
      );

      rawResults.push(await fetchRaw(targetDate));
    }

    renderStatus(
      `${sourceLabel} 통합 분석 중 · ${items.length}/${items.length}`,
      "running"
    );

    return analyseMergedRaw(rawResults, assets, range, items);
  }

  async function restoreSavedRawRange(range, silentMissing = true) {
    if (restoringSaved || polling || applying) return false;

    const chunks = buildRangeChunks(range.startDate, range.endDate);
    if (!chunks.length) return false;

    restoringSaved = true;
    setBusy(true);

    try {
      await refreshBlowerData();
      const assets = sealPotAssets();
      const items = [];

      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        renderStatus(
          `기존 저장 OIS RAW 확인 중 · ${index + 1}/${chunks.length}`,
          "running"
        );

        const raw = await fetchRaw(chunk.targetDate, true);
        if (!raw) {
          if (!silentMissing) {
            renderStatus(
              `저장되지 않은 OIS 구간이 있습니다 · ${chunk.targetDate}`,
              "warning"
            );
          }
          return false;
        }

        // analyseItems fetches the same raw endpoint again. Keep the request
        // list here and use the dedicated no-refetch analyzer below instead.
        items.push({
          targetDate: chunk.targetDate,
          status: "complete",
          raw
        });
      }

      renderStatus(
        `기존 저장 OIS RAW 통합 분석 중 · ${items.length}/${items.length}`,
        "running"
      );

      currentReport = analyseMergedRaw(
        items.map(item => item.raw),
        assets,
        range,
        items
      );

      saveCache(currentReport);
      renderReport();
      renderStatus(
        "기존에 조회된 OIS RAW를 V2 판정으로 다시 계산했습니다. OIS Agent 재조회는 하지 않았습니다.",
        "complete"
      );
      return true;
    } catch (error) {
      console.warn("Seal Pot saved RAW V2 restore failed:", error);
      if (!silentMissing) {
        renderStatus(
          error.message || "저장된 Seal Pot OIS 자료를 복원하지 못했습니다.",
          "error"
        );
      }
      return false;
    } finally {
      restoringSaved = false;
      setBusy(false);
      renderReport();
    }
  }

  async function query(forceRefresh = false) {
    if (polling || applying || restoringSaved) return;

    const range = getRange();

    if (range.dayCount < 1 || range.dayCount > MAX_DAYS) {
      renderStatus("조회기간은 1~366일로 선택해 주세요.", "error");
      return;
    }

    if (range.endDate > isoToday()) {
      renderStatus("미래 날짜는 조회할 수 없습니다.", "error");
      return;
    }

    if (!forceRefresh && restoreCache(range.startDate, range.endDate)) {
      await refreshBlowerData().catch(() => null);
      renderReport();
      renderStatus("저장된 Seal Pot V2 분석 결과를 표시합니다.", "complete");
      return;
    }

    if (!forceRefresh) {
      const restored = await restoreSavedRawRange(range, true);
      if (restored) return;
    }

    polling = true;
    setBusy(true);

    try {
      const response = await fetch(OIS_URL, {
        method: "POST",
        headers: authHeaders(true),
        cache: "no-store",
        body: JSON.stringify({
          action: "create_seal_pot_runtime_batch",
          startDate: range.startDate,
          endDate: range.endDate,
          forceRefresh
        })
      });

      const created = await readJson(response);
      const items = await waitRequests(created.items || []);
      const failed = items.filter(item => item.status !== "complete");

      if (failed.length) {
        throw new Error(
          `Seal Pot OIS 구간 ${failed.length}개가 완료되지 않았습니다.`
        );
      }

      await refreshBlowerData();
      const assets = sealPotAssets();
      currentReport = await analyseItems(
        items,
        range,
        assets,
        "저장 RAW"
      );

      saveCache(currentReport);
      renderReport();
      renderStatus(
        "Seal Pot OIS V2 계산 완료 · 검증을 통과한 누적시간만 [적용]할 수 있습니다.",
        "complete"
      );
    } catch (error) {
      console.error(error);
      renderStatus(
        error.message || "Seal Pot OIS 조회에 실패했습니다.",
        "error"
      );
    } finally {
      polling = false;
      setBusy(false);
      renderReport();
    }
  }

  function sameDateTime(left, right) {
    const leftDate = new Date(left || "");
    const rightDate = new Date(right || "");

    return (
      !Number.isNaN(leftDate.getTime()) &&
      !Number.isNaN(rightDate.getTime()) &&
      Math.abs(leftDate.getTime() - rightDate.getTime()) < 1000
    );
  }

  function firstRunningAtAfterReplacement(reportAsset) {
    const replacementAt = new Date(reportAsset?.lastReplacementAt || "");
    if (Number.isNaN(replacementAt.getTime())) return "";

    for (const segment of reportAsset?.runtime?.segments || []) {
      if (String(segment?.state || "") !== "running") continue;

      const startAt = new Date(segment.startAt);
      const endAt = new Date(segment.endAt);

      if (
        Number.isNaN(startAt.getTime()) ||
        Number.isNaN(endAt.getTime()) ||
        endAt <= replacementAt
      ) {
        continue;
      }

      return new Date(
        Math.max(startAt.getTime(), replacementAt.getTime())
      ).toISOString();
    }

    return "";
  }

  function buildApplyPlan(reportAsset, report = currentReport) {
    const tagNumber = String(reportAsset?.tagNumber || "").trim().toUpperCase();
    const currentAsset = findCurrentAsset(tagNumber);
    const runtime = reportAsset?.runtime || {};
    const queue = report?.queue || {};
    const chunkCount = Number(queue.chunkCount || 0);
    const completeCount = Number(queue.completeCount || 0);
    const failedCount = Number(queue.failedCount || 0) + Number(queue.missingCount || 0);
    const oisState = String(runtime.oisState || "unknown");
    const cycleRuntimeHours = finiteNumber(runtime.cycleRuntimeHours);
    const registeredRuntimeHours = finiteNumber(currentAsset?.cycleElapsedHours);
    const rangeCoveragePct = Number(runtime.rangeCoveragePct || 0);
    const cycleCoveragePct = Number(runtime.cycleCoveragePct || 0);
    const latestSampleAt = String(runtime.latestSampleAt || "");
    const latestDate = new Date(latestSampleAt);
    const latestAgeHours = Number.isNaN(latestDate.getTime())
      ? Infinity
      : (Date.now() - latestDate.getTime()) / 3600000;
    const startupPending = String(currentAsset?.cycleStartState || "legacy") === "pending";
    const currentRunning = Boolean(currentAsset?.isRunning);
    const stateDecided = ["running", "stopped"].includes(oisState);
    const stateFresh = latestAgeHours >= -0.1 && latestAgeHours <= STATE_FRESH_HOURS;
    const pressureState = String(runtime.latestSource || "") === "pressure";
    const stateEligible = stateDecided && stateFresh && pressureState;
    const targetRunning = stateDecided
      ? oisState === "running"
      : currentRunning;
    const firstRunningAt = firstRunningAtAfterReplacement(reportAsset);
    const requiresStartupCandidate = startupPending && (
      (cycleRuntimeHours || 0) > 0.01 ||
      (stateEligible && targetRunning)
    );

    let commonReason = "";

    if (!currentAsset || currentAsset.blowerType !== "seal_pot") {
      commonReason = "현재 Seal Pot 설비정보가 없습니다.";
    } else if (!hasWriteAccess()) {
      commonReason = "현재 계정은 Blower 값을 변경할 수 없습니다.";
    } else if (
      chunkCount < 1 ||
      completeCount !== chunkCount ||
      failedCount > 0
    ) {
      commonReason = "선택기간 OIS 구간을 모두 완료한 뒤 적용할 수 있습니다.";
    } else if (!currentAsset.lastReplacementAt) {
      commonReason = "확정된 V-Belt 교체일이 없습니다.";
    } else if (!sameDateTime(currentAsset.lastReplacementAt, reportAsset.lastReplacementAt)) {
      commonReason = "조회 후 최근 V-Belt 교체일이 변경되었습니다. 다시 분석해 주세요.";
    } else if (runtime.cycleRangeComplete !== true) {
      commonReason = "선택기간이 최근 V-Belt 교체일부터 현재까지를 모두 포함하지 않습니다.";
    } else if (reportAsset.runtimeSignalReady !== true) {
      commonReason = "운전시간 판정에 필요한 압력/온도 채널이 부족합니다.";
    } else if (cycleRuntimeHours === null || cycleRuntimeHours < 0) {
      commonReason = "교체 후 OIS 누적시간을 계산하지 못했습니다.";
    } else if (
      rangeCoveragePct < APPLY_COVERAGE_PCT ||
      cycleCoveragePct < APPLY_COVERAGE_PCT
    ) {
      commonReason = `OIS 판정률이 ${APPLY_COVERAGE_PCT}% 미만입니다.`;
    } else if (
      !startupPending &&
      !String(currentAsset.cycleRuntimeRevision || "")
    ) {
      commonReason = "현재 Cycle revision을 확인할 수 없습니다.";
    }

    let runtimeReason = commonReason;

    if (!runtimeReason && requiresStartupCandidate && !stateEligible) {
      runtimeReason = pressureState
        ? "기동 대기 Cycle은 현재 OIS 상태가 확정된 최신 자료가 있어야 시작할 수 있습니다."
        : "기동 대기 Cycle은 최신 토출압력으로 첫 기동을 확인해야 자동 시작할 수 있습니다.";
    } else if (!runtimeReason && requiresStartupCandidate && !firstRunningAt) {
      runtimeReason = "교체 후 첫 기동시각을 OIS 운전구간에서 찾지 못했습니다.";
    }

    let stateReason = commonReason;

    if (!stateReason && !stateDecided) {
      stateReason = "현재 OIS 상태가 판정보류입니다.";
    } else if (!stateReason && !stateFresh) {
      stateReason = "최신 OIS 자료가 3시간 이내가 아닙니다.";
    } else if (!stateReason && !pressureState) {
      stateReason = "온도 판정은 누적시간만 반영하고 기동·정지 상태는 유지합니다.";
    } else if (!stateReason && requiresStartupCandidate && !firstRunningAt) {
      stateReason = "교체 후 첫 기동시각을 OIS 운전구간에서 찾지 못했습니다.";
    }

    const runtimeDifferenceHours =
      registeredRuntimeHours === null || cycleRuntimeHours === null
        ? null
        : cycleRuntimeHours - registeredRuntimeHours;
    const needsRuntimeCorrection = !startupPending && (
      registeredRuntimeHours === null ||
      Math.abs(runtimeDifferenceHours || 0) > 0.05
    );
    const runtimeHasChanges = Boolean(
      requiresStartupCandidate || needsRuntimeCorrection
    );
    const requiresStartup = Boolean(
      requiresStartupCandidate && !runtimeReason
    );
    const runtimeApplicable = Boolean(
      runtimeHasChanges && !runtimeReason
    );
    const needsStateChange = stateDecided && (
      startupPending
        ? (requiresStartupCandidate && !targetRunning)
        : currentRunning !== targetRunning
    );
    const stateApplicable = Boolean(
      needsStateChange &&
      !stateReason &&
      (!startupPending || runtimeApplicable)
    );
    const hasChanges = Boolean(runtimeHasChanges || needsStateChange);
    const hasApplicableChanges = Boolean(runtimeApplicable || stateApplicable);

    let reason = "";

    if (!hasChanges) {
      reason = startupPending
        ? "기동 대기·누적 0시간이 OIS 계산과 일치합니다."
        : "현재 카드 상태와 누적시간이 OIS 계산과 일치합니다.";
    } else if (!hasApplicableChanges) {
      reason = runtimeHasChanges && runtimeReason
        ? runtimeReason
        : stateReason || "적용 가능한 OIS 계산값이 없습니다.";
    } else if (runtimeApplicable && !stateApplicable && stateReason) {
      reason = `누적시간 적용 가능 · ${stateReason}`;
    }

    return {
      tagNumber,
      displayName: reportAsset?.displayName || currentAsset?.displayName || tagNumber,
      currentAsset,
      reportAsset,
      oisState,
      targetRunning,
      currentRunning,
      cycleRuntimeHours,
      registeredRuntimeHours,
      runtimeDifferenceHours,
      rangeCoveragePct,
      cycleCoveragePct,
      latestSampleAt,
      latestAgeHours,
      startupPending,
      stateDecided,
      stateFresh,
      pressureState,
      stateEligible,
      requiresStartupCandidate,
      requiresStartup,
      firstRunningAt,
      needsRuntimeCorrection,
      runtimeHasChanges,
      runtimeApplicable,
      runtimeReason,
      needsStateChange,
      stateApplicable,
      stateReason,
      hasChanges,
      hasApplicableChanges,
      reason
    };
  }

  function formatApplyPlanLine(plan) {
    const beforeState = plan.startupPending
      ? "기동 대기"
      : plan.currentRunning ? "운전" : "정지";
    const beforeRuntime = plan.registeredRuntimeHours === null
      ? "-"
      : formatHours(plan.registeredRuntimeHours);
    const afterState = plan.targetRunning ? "운전" : "정지";
    const afterRuntime = formatHours(plan.cycleRuntimeHours);
    const changes = [];

    if (plan.runtimeApplicable) {
      changes.push(`누적 ${beforeRuntime} → ${afterRuntime}`);
    }

    if (plan.stateApplicable) {
      changes.push(`상태 ${beforeState} → ${afterState}`);
    } else if (plan.runtimeApplicable && plan.stateReason) {
      changes.push(`상태 유지 · ${plan.stateReason}`);
    }

    return `${plan.displayName} : ${changes.join(" · ") || plan.reason || "변경 없음"}`;
  }

  async function applyPlanMutations(plan) {
    const range = getRange();

    if (plan.requiresStartup && plan.runtimeApplicable) {
      const current = findCurrentAsset(plan.tagNumber);

      if (!current || String(current.cycleStartState || "") !== "pending") {
        throw new Error(
          `${plan.displayName}의 기동 대기 상태가 변경되었습니다. 새로고침 후 다시 적용해 주세요.`
        );
      }

      await postBlower({
        action: "startup",
        tagNumber: plan.tagNumber,
        eventDate: plan.firstRunningAt,
        expectedLastReplacementAt: current.lastReplacementAt,
        note: "Seal Pot OIS 계산 적용 · 토출압력으로 교체 후 첫 운전구간 확인"
      });

      await refreshBlowerData();
    }

    let current = findCurrentAsset(plan.tagNumber);

    if (!current) {
      throw new Error(`${plan.displayName}의 최신 카드 상태를 불러오지 못했습니다.`);
    }

    if (plan.runtimeApplicable) {
      if (String(current.cycleStartState || "") === "pending") {
        throw new Error(`${plan.displayName}의 Cycle이 아직 기동 대기 상태입니다.`);
      }

      const stateNote = plan.stateApplicable
        ? (plan.targetRunning ? "OIS 운전" : "OIS 정지")
        : "현재 카드 상태 유지";
      const note =
        `Seal Pot OIS 누적시간 적용 · ${range.startDate}~${range.endDate}` +
        ` · ${stateNote}` +
        ` · 누적 ${Number(plan.cycleRuntimeHours).toFixed(2)}h` +
        ` · Cycle 판정률 ${Number(plan.cycleCoveragePct).toFixed(1)}%`;

      await postBlower({
        action: "runtime",
        tagNumber: plan.tagNumber,
        runtimeHours: plan.cycleRuntimeHours,
        expectedCycleRuntimeRevision: current.cycleRuntimeRevision || "",
        note
      });

      await refreshBlowerData();
      current = findCurrentAsset(plan.tagNumber);

      if (!current) {
        throw new Error(`${plan.displayName}의 누적시간 적용 후 상태를 불러오지 못했습니다.`);
      }
    }

    if (
      plan.stateApplicable &&
      Boolean(current.isRunning) !== plan.targetRunning
    ) {
      await postBlower({
        action: "runtime_state",
        tagNumber: plan.tagNumber,
        eventDate: new Date().toISOString(),
        isRunning: plan.targetRunning,
        expectedCycleRuntimeRevision: current.cycleRuntimeRevision || "",
        note: `Seal Pot OIS 토출압력 계산 적용 · 현재 상태 ${plan.targetRunning ? "운전" : "정지"}`
      });

      await refreshBlowerData();
    }
  }

  async function applyCalculatedResults() {
    if (polling || applying || restoringSaved || isMobileMonitoring()) return;

    const range = getRange();

    if (
      !currentReport ||
      currentReport.startDate !== range.startDate ||
      currentReport.endDate !== range.endDate
    ) {
      renderStatus("현재 선택기간의 OIS 계산 결과를 먼저 조회해 주세요.", "error");
      return;
    }

    try {
      await refreshBlowerData();
    } catch (error) {
      renderStatus(error.message || "최신 Blower 상태를 불러오지 못했습니다.", "error");
      return;
    }

    const plans = (currentReport.assets || []).map(asset =>
      buildApplyPlan(asset, currentReport)
    );
    const changed = plans.filter(plan => plan.hasApplicableChanges);
    const blocked = plans.filter(plan => plan.hasChanges && !plan.hasApplicableChanges);

    if (!changed.length) {
      renderStatus(
        blocked[0]?.reason || "현재 적용 가능한 OIS 계산값이 없습니다.",
        "warning"
      );
      renderReport();
      return;
    }

    const runtimePlans = changed.filter(plan => plan.runtimeApplicable);
    const statePlans = changed.filter(plan => plan.stateApplicable);
    const stateHoldCount = changed.filter(
      plan => plan.runtimeApplicable && !plan.stateApplicable && Boolean(plan.stateReason)
    ).length;
    const preview = changed.map(formatApplyPlanLine).join("\n");
    const excludedText = blocked.length
      ? `\n\n적용 제외 ${blocked.length}대:\n` +
        blocked.map(plan => `${plan.displayName} · ${plan.reason}`).join("\n")
      : "";
    const confirmed = window.confirm(
      "Seal Pot OIS 계산 결과 중 검증을 통과한 값만 실제 카드에 반영합니다.\n\n" +
      preview +
      excludedText +
      (stateHoldCount > 0
        ? `\n\n온도 기반 또는 최신성 미충족 ${stateHoldCount}대는 누적시간만 반영하고 기존 기동·정지 상태를 유지합니다.`
        : "") +
      "\n\n누적시간은 조회기간·Cycle 판정률 95% 이상만 적용합니다. 기동·정지는 최신 3시간 이내 토출압력으로 확정된 경우에만 변경합니다. 교체일·교체주기는 변경하지 않습니다.\n\n계속할까요?"
    );

    if (!confirmed) return;

    applying = true;
    setBusy(true);
    renderReport();

    const failures = [];
    let runtimeAppliedCount = 0;
    let stateAppliedCount = 0;

    try {
      for (let index = 0; index < changed.length; index += 1) {
        const plan = changed[index];
        renderStatus(
          `OIS 계산값 적용 중 · ${index + 1}/${changed.length} · ${plan.displayName}`,
          "running"
        );

        try {
          await applyPlanMutations(plan);
          if (plan.runtimeApplicable) runtimeAppliedCount += 1;
          if (plan.stateApplicable) stateAppliedCount += 1;
        } catch (error) {
          failures.push({
            displayName: plan.displayName,
            message: error?.message || "적용 실패"
          });
          console.error("Seal Pot OIS apply failed:", plan, error);
        }
      }

      const summary = `누적시간 ${runtimeAppliedCount}대 · 상태 ${stateAppliedCount}대`;

      if (failures.length) {
        window.alert(
          `Seal Pot OIS 적용 완료: ${summary}\n실패 ${failures.length}대\n\n` +
          failures.map(item => `${item.displayName}: ${item.message}`).join("\n")
        );
      } else {
        window.alert(`Seal Pot OIS 계산값 적용 완료 · ${summary}`);
      }

      window.location.reload();
    } finally {
      applying = false;
      setBusy(false);
    }
  }

  function currentPlans() {
    if (!currentReport?.assets?.length || !blowerData) return [];
    return currentReport.assets.map(asset => buildApplyPlan(asset, currentReport));
  }

  function setBusy(value) {
    dialog?.querySelectorAll(
      "#sealPotOisRun,#sealPotOisRequery,#sealPotOisApply"
    ).forEach(element => {
      element.disabled = Boolean(value);
    });
  }

  function renderStatus(text, state = "") {
    const element = dialog?.querySelector("#sealPotOisStatus");
    if (!element) return;
    element.textContent = text;
    element.dataset.state = state;
  }

  function renderReport() {
    if (!dialog) return;

    const body = dialog.querySelector("#sealPotOisBody");
    const headline = dialog.querySelector("#sealPotOisHeadline");
    const applyButton = dialog.querySelector("#sealPotOisApply");

    if (!currentReport?.assets?.length) {
      headline.textContent = "Seal Pot OIS 운전시간 분석 대기";
      body.innerHTML = "";
      applyButton.disabled = true;
      applyButton.textContent = "적용 가능한 계산값 없음";
      return;
    }

    const plans = currentPlans();
    const planByTag = new Map(plans.map(plan => [plan.tagNumber, plan]));
    const applicable = plans.filter(plan => plan.hasApplicableChanges);
    const runtimeApplyCount = applicable.filter(plan => plan.runtimeApplicable).length;
    const stateApplyCount = applicable.filter(plan => plan.stateApplicable).length;

    headline.textContent =
      `${currentReport.startDate} ~ ${currentReport.endDate} · ` +
      `${currentReport.dayCount}일 · 6대` +
      (blowerData ? ` · 누적시간 적용 가능 ${runtimeApplyCount}대` : "");

    if (applyButton) {
      applyButton.disabled =
        polling ||
        restoringSaved ||
        applying ||
        !hasWriteAccess() ||
        applicable.length < 1;
      applyButton.textContent = applying
        ? "OIS 계산값 적용 중..."
        : runtimeApplyCount > 0 && stateApplyCount === 0
          ? `누적시간 적용 ${runtimeApplyCount}대`
          : applicable.length > 0
            ? `OIS 계산값 적용 ${applicable.length}대`
            : "적용 가능한 계산값 없음";
    }

    body.innerHTML = currentReport.assets.map(reportAsset => {
      const runtime = reportAsset.runtime || {};
      const plan = planByTag.get(String(reportAsset.tagNumber || "").toUpperCase());
      const current = plan?.currentAsset || findCurrentAsset(reportAsset.tagNumber);
      const currentCardState = current
        ? (current.isRunning ? "running" : "stopped")
        : "unknown";
      const planText = plan
        ? (plan.hasApplicableChanges
            ? (plan.runtimeApplicable && !plan.stateApplicable && plan.stateReason
                ? `누적 적용 가능 · ${plan.stateReason}`
                : "적용 가능")
            : plan.reason)
        : "최신 카드 상태 확인 중";
      const rowClass = plan && plan.hasChanges && !plan.hasApplicableChanges
        ? " class=\"is-blocked\""
        : "";

      return `
        <tr${rowClass}>
          <td>
            <strong>${escapeHtml(reportAsset.displayName)}</strong>
            <small>${escapeHtml(reportAsset.tagNumber)}</small>
          </td>
          <td>
            <strong>${escapeHtml(stateLabel(runtime.oisState))}</strong>
            <small>현재 카드 ${escapeHtml(stateLabel(currentCardState))}</small>
            <small>${escapeHtml(runtime.latestSource === "pressure" ? "상태: 토출압력" : "상태: 온도 판정(유지)")}</small>
          </td>
          <td>
            <strong>${escapeHtml(formatHours(runtime.rangeRunningHours))}</strong>
            <small>조회 판정률 ${Number(runtime.rangeCoveragePct || 0).toFixed(1)}%</small>
          </td>
          <td>
            <strong>${escapeHtml(formatHours(runtime.cycleRuntimeHours))}</strong>
            <small>Cycle 판정률 ${Number(runtime.cycleCoveragePct || 0).toFixed(1)}%</small>
            <small>${escapeHtml(planText || "-")}</small>
          </td>
          <td>
            <strong>${escapeHtml(reportAsset.classifier)}</strong>
            <small>${Number(reportAsset.successfulSensorCount || 0)}/5 TAG</small>
          </td>
          <td>
            <small>${escapeHtml(runtime.latestSampleAt || "-")}</small>
            <small>전환 ${Number(runtime.transitionCount || 0)}건</small>
          </td>
        </tr>
      `;
    }).join("");
  }

  async function handleRangeSelection(startDate, endDate) {
    setRange(startDate, endDate);

    if (restoreCache(startDate, endDate)) {
      await refreshBlowerData().catch(() => null);
      renderReport();
      renderStatus("저장된 Seal Pot V2 분석 결과를 표시합니다.", "complete");
      return;
    }

    currentReport = null;
    renderReport();

    const range = getRange();
    const restored = await restoreSavedRawRange(range, true);

    if (!restored) {
      renderStatus(
        "선택 기간의 V2 계산결과가 없습니다. [OIS 조회]를 누르면 기존 완료자료를 우선 재사용합니다.",
        "idle"
      );
    }
  }

  function buildDialog() {
    if (dialog) return dialog;

    dialog = document.createElement("dialog");
    dialog.className = "seal-pot-ois-dialog";
    dialog.innerHTML = `
      <div class="seal-pot-ois-window">
        <header>
          <div>
            <span>SEAL POT OIS 운전상태 · 누적시간 분석 V2</span>
            <strong id="sealPotOisHeadline">Seal Pot OIS 운전시간 분석 대기</strong>
          </div>
          <button type="button" class="button secondary" id="sealPotOisClose">닫기</button>
        </header>

        <div class="seal-pot-ois-note">
          누적시간은 토출압력 또는 베어링온도 판정률이 조회기간·Cycle 모두 95% 이상일 때만 적용합니다.
          기동·정지 상태는 최신 3시간 이내 토출압력으로 확정된 경우에만 변경하며, 온도만으로 판정된 경우 기존 카드 상태를 유지합니다.
        </div>

        <div class="seal-pot-ois-presets">
          <button type="button" data-days="7">7일</button>
          <button type="button" data-days="30">30일</button>
          <button type="button" data-days="90">3개월</button>
          <button type="button" data-days="180">6개월</button>
          <button type="button" data-days="365">1년</button>
        </div>

        <div class="seal-pot-ois-controls">
          <label>시작일 <input type="date" id="sealPotOisStart"></label>
          <span>~</span>
          <label>종료일 <input type="date" id="sealPotOisEnd"></label>
          <button type="button" class="button primary" id="sealPotOisRun">OIS 조회</button>
          <button type="button" class="button secondary" id="sealPotOisRequery">전체 재조회</button>
          <button type="button" class="button secondary seal-pot-ois-apply" id="sealPotOisApply" disabled>적용 가능한 계산값 없음</button>
        </div>

        <div class="seal-pot-ois-status" id="sealPotOisStatus" data-state="idle">
          조회할 기간을 선택해 주세요.
        </div>

        <div class="seal-pot-ois-table-wrap">
          <table>
            <thead>
              <tr>
                <th>설비</th>
                <th>OIS 상태</th>
                <th>조회기간 운전</th>
                <th>교체 후 OIS 누적</th>
                <th>판정 기준</th>
                <th>최신 / 전환</th>
              </tr>
            </thead>
            <tbody id="sealPotOisBody"></tbody>
          </table>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    const endDate = isoToday();
    let startDate = addDays(endDate, -29);

    try {
      const saved = JSON.parse(localStorage.getItem(LAST_RANGE_KEY) || "null");

      if (
        saved?.startDate &&
        saved?.endDate &&
        countDays(saved.startDate, saved.endDate) >= 1 &&
        saved.endDate <= endDate
      ) {
        startDate = saved.startDate;
        setRange(saved.startDate, saved.endDate);
      } else {
        setRange(startDate, endDate);
      }
    } catch {
      setRange(startDate, endDate);
    }

    dialog.querySelector("#sealPotOisClose").addEventListener("click", () => {
      dialog.close();
    });

    dialog.querySelector("#sealPotOisRun").addEventListener("click", () => {
      query(false);
    });

    dialog.querySelector("#sealPotOisRequery").addEventListener("click", () => {
      if (
        window.confirm(
          "선택한 Seal Pot OIS 기간을 처음부터 다시 조회할까요?\n기존 완료자료는 삭제하지 않습니다."
        )
      ) {
        query(true);
      }
    });

    dialog.querySelector("#sealPotOisApply").addEventListener("click", () => {
      applyCalculatedResults();
    });

    dialog.querySelector(".seal-pot-ois-presets").addEventListener("click", event => {
      const target = event.target.closest("[data-days]");
      if (!target) return;

      const days = Number(target.dataset.days);
      const end = isoToday();
      const start = addDays(end, -(days - 1));
      handleRangeSelection(start, end);
    });

    const handleCustomRange = () => {
      const range = getRange();
      if (range.dayCount < 1) return;
      handleRangeSelection(range.startDate, range.endDate);
    };

    dialog.querySelector("#sealPotOisStart").addEventListener("change", handleCustomRange);
    dialog.querySelector("#sealPotOisEnd").addEventListener("change", handleCustomRange);

    dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    });

    return dialog;
  }

  async function openAnalysis() {
    const dlg = buildDialog();
    dlg.showModal();

    const range = getRange();

    try {
      await refreshBlowerData();
    } catch (error) {
      renderStatus(error.message || "Blower 상태를 불러오지 못했습니다.", "error");
      return;
    }

    if (restoreCache(range.startDate, range.endDate)) {
      renderReport();
      renderStatus("저장된 Seal Pot V2 분석 결과를 표시합니다.", "complete");
      return;
    }

    currentReport = null;
    renderReport();

    const restored = await restoreSavedRawRange(range, true);

    if (!restored) {
      renderStatus(
        "이전에 조회한 OIS RAW가 없거나 일부 구간이 없습니다. [OIS 조회]를 누르면 완료자료를 우선 재사용하고 누락 구간만 요청합니다.",
        "idle"
      );
    }
  }

  function activeType() {
    return document.querySelector(".type-tab.is-active")?.dataset?.type || "";
  }

  function syncButton() {
    const assetManager = document.getElementById("assetManagerButton");
    if (!assetManager) return;

    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "button primary seal-pot-ois-launch";
      button.textContent = "OIS 조회";
      button.addEventListener("click", openAnalysis);
      assetManager.insertAdjacentElement("afterend", button);
    }

    button.hidden =
      activeType() !== "seal_pot" ||
      !currentUser() ||
      isMobileMonitoring();
  }

  document.addEventListener("click", event => {
    if (event.target.closest(".type-tab")) {
      window.setTimeout(syncButton, 0);
    }
  });

  const observer = new MutationObserver(syncButton);
  observer.observe(document.body, {subtree: true, childList: true});

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncButton, {once: true});
  } else {
    syncButton();
  }
})();
