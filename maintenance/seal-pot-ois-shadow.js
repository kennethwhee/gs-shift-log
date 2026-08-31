"use strict";

(() => {
  const API_URL = "/api/blower-history";
  const OIS_URL = "/api/ois-data-requests";
  const AUTH_STORAGE_KEY = "gsShiftLog.currentUser";
  const CACHE_KEY = "gsShiftLog.blowerHistory.sealPotOisShadow.v1";
  const LAST_RANGE_KEY = "gsShiftLog.blowerHistory.sealPotOisLastRange.v1";
  const MAX_DAYS = 366;
  const GAP_MS = 90 * 60 * 1000;

  let button = null;
  let dialog = null;
  let currentReport = null;
  let polling = false;

  function currentUser() {
    try {
      return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null");
    } catch {
      return null;
    }
  }

  function authHeaders(json = false) {
    const token = String(
      currentUser()?.sessionToken ||
      currentUser()?.session_token ||
      ""
    ).trim();

    return {
      Accept: "application/json",
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
      throw new Error(payload.message || `요청 실패 (${response.status})`);
    }
    return payload;
  }

  function isoToday() {
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return now.toISOString().slice(0, 10);
  }

  function addDays(value, days) {
    const d = new Date(`${value}T00:00:00+09:00`);
    if (Number.isNaN(d.getTime())) return "";
    d.setUTCDate(d.getUTCDate() + Number(days || 0));
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
  }

  function countDays(startDate, endDate) {
    const s = new Date(`${startDate}T00:00:00+09:00`);
    const e = new Date(`${endDate}T00:00:00+09:00`);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return 0;
    return Math.floor((e - s) / 86400000) + 1;
  }

  function rangeKey(startDate, endDate) {
    return `${startDate}~${endDate}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
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
      return {...sensor, low: null, high: null, spread: 0, reliable: false};
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
      const scale = Math.max(Math.abs(Number(low) || 0), Math.abs(Number(high) || 0), 1);
      reliable = spread > 0 && (
        spread >= scale * 0.12 ||
        (Math.abs(Number(low) || 0) <= scale * 0.08 && spread >= scale * 0.04)
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

    const points = [...timestamps]
      .sort()
      .map(sampledAt => {
        const pressureEntry = byRole.get("discharge_pressure");
        const pressureValue = pressureEntry?.samples.get(sampledAt);
        const pressureIndex = normalizeByProfile(
          pressureValue,
          pressureEntry?.profile
        );

        const tempRoles = [
          "blower_de_temp",
          "blower_nde_temp",
          "motor_de_temp",
          "motor_nde_temp"
        ];

        const tempIndexes = tempRoles
          .map(role => {
            const entry = byRole.get(role);
            return normalizeByProfile(entry?.samples.get(sampledAt), entry?.profile);
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
          state
        };
      });

    for (let i = 1; i < points.length - 1; i += 1) {
      const prev = points[i - 1];
      const cur = points[i];
      const next = points[i + 1];

      if (
        cur.state === "unknown" &&
        prev.state === next.state &&
        ["running", "stopped"].includes(prev.state)
      ) {
        const span =
          new Date(next.sampledAt).getTime() -
          new Date(prev.sampledAt).getTime();

        if (span <= 2 * GAP_MS) {
          cur.state = prev.state;
        }
      }
    }

    return {profiles, points};
  }

  function sumRuntime(points, startAt = null) {
    let runningMs = 0;
    let stoppedMs = 0;
    let unknownMs = 0;
    let latestState = "unknown";
    let latestAt = "";
    let lastStartAt = "";
    let lastStopAt = "";
    let transitions = 0;
    let previousState = "";

    for (let i = 0; i < points.length - 1; i += 1) {
      const current = points[i];
      const next = points[i + 1];
      const currentAt = new Date(current.sampledAt);
      const nextAt = new Date(next.sampledAt);

      if (
        Number.isNaN(currentAt.getTime()) ||
        Number.isNaN(nextAt.getTime())
      ) {
        continue;
      }

      let intervalStart = currentAt;
      let intervalEnd = nextAt;

      if (startAt instanceof Date) {
        if (intervalEnd <= startAt) continue;
        if (intervalStart < startAt) intervalStart = startAt;
      }

      const delta = intervalEnd - intervalStart;

      if (!(delta > 0) || delta > GAP_MS) {
        continue;
      }

      if (current.state === "running") runningMs += delta;
      else if (current.state === "stopped") stoppedMs += delta;
      else unknownMs += delta;

      if (
        ["running", "stopped"].includes(current.state) &&
        previousState &&
        previousState !== current.state
      ) {
        transitions += 1;
        if (current.state === "running") lastStartAt = current.sampledAt;
        if (current.state === "stopped") lastStopAt = current.sampledAt;
      }

      if (["running", "stopped"].includes(current.state)) {
        previousState = current.state;
      }
    }

    const last = [...points]
      .reverse()
      .find(point => ["running", "stopped"].includes(point.state));

    if (last) {
      latestState = last.state;
      latestAt = last.sampledAt;
    }

    const decidedMs = runningMs + stoppedMs;
    const totalMs = decidedMs + unknownMs;

    return {
      runningHours: runningMs / 3600000,
      stoppedHours: stoppedMs / 3600000,
      unknownHours: unknownMs / 3600000,
      coveragePct: totalMs > 0 ? decidedMs / totalMs * 100 : 0,
      currentState: latestState,
      latestAt,
      lastStartAt,
      lastStopAt,
      transitions
    };
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

  function profileSummary(profiles) {
    const pressure = profiles.find(sensor => sensor.role === "discharge_pressure");
    const tempReliable = profiles.filter(
      sensor =>
        sensor.role !== "discharge_pressure" &&
        sensor.reliable
    ).length;

    if (pressure?.reliable) {
      return "압력 우선";
    }

    if (tempReliable >= 2) {
      return `온도 ${tempReliable}/4`;
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

    return assets.map(asset => {
      const tag = String(asset.tagNumber || "").trim().toUpperCase();
      const rawAsset = rawByTag.get(tag) || {assetTag: tag, sensors: []};
      const built = buildAssetPoints(rawAsset);
      const rangeRuntime = sumRuntime(built.points);

      const replacementAt = asset.lastReplacementAt
        ? new Date(asset.lastReplacementAt)
        : null;

      const cycleRuntime = replacementAt &&
        !Number.isNaN(replacementAt.getTime())
        ? sumRuntime(built.points, replacementAt)
        : null;

      const latest = rangeRuntime.latestAt
        ? new Date(rangeRuntime.latestAt)
        : null;

      const latestAgeHours = latest && !Number.isNaN(latest.getTime())
        ? (Date.now() - latest.getTime()) / 3600000
        : Infinity;

      const currentState =
        latestAgeHours <= 3
          ? rangeRuntime.currentState
          : "unknown";

      return {
        tagNumber: tag,
        displayName: asset.displayName || tag,
        unitNo: asset.unitNo,
        positionLabel: asset.positionLabel,
        currentCardState: asset.isRunning ? "running" : "stopped",
        lastReplacementAt: asset.lastReplacementAt || "",
        profiles: built.profiles,
        successfulSensorCount: (rawAsset.sensors || []).filter(
          sensor => (sensor.samples || []).length > 0
        ).length,
        runtime: {
          rangeRunningHours: rangeRuntime.runningHours,
          rangeStoppedHours: rangeRuntime.stoppedHours,
          rangeUnknownHours: rangeRuntime.unknownHours,
          rangeCoveragePct: rangeRuntime.coveragePct,
          cycleRuntimeHours: cycleRuntime?.runningHours ?? null,
          cycleCoveragePct: cycleRuntime?.coveragePct ?? null,
          oisState: currentState,
          latestSampleAt: rangeRuntime.latestAt,
          transitionCount: rangeRuntime.transitions
        },
        classifier: profileSummary(built.profiles)
      };
    });
  }

  function aggregateReports(reports, startDate, endDate, assets) {
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

    const mergedAssets = assets.map(asset => {
      const chunks = byTag.get(String(asset.tagNumber || "").toUpperCase()) || [];

      const weighted = (field, coverageField = null) => {
        const values = chunks
          .map(chunk => Number(chunk.runtime?.[field]))
          .filter(Number.isFinite);
        return values.length ? values.reduce((a, b) => a + b, 0) : null;
      };

      const rangeRunningHours = weighted("rangeRunningHours") || 0;
      const rangeStoppedHours = weighted("rangeStoppedHours") || 0;
      const rangeUnknownHours = weighted("rangeUnknownHours") || 0;
      const decided = rangeRunningHours + rangeStoppedHours;
      const total = decided + rangeUnknownHours;

      const cycleRuntimeHours = chunks
        .map(chunk => Number(chunk.runtime?.cycleRuntimeHours))
        .filter(Number.isFinite)
        .reduce((a, b) => a + b, 0);

      const latestChunk = [...chunks]
        .filter(chunk => chunk.runtime?.latestSampleAt)
        .sort((a, b) =>
          String(b.runtime.latestSampleAt).localeCompare(
            String(a.runtime.latestSampleAt)
          )
        )[0];

      return {
        tagNumber: asset.tagNumber,
        displayName: asset.displayName,
        currentCardState: asset.isRunning ? "running" : "stopped",
        lastReplacementAt: asset.lastReplacementAt || "",
        successfulSensorCount: Math.max(
          0,
          ...chunks.map(chunk => Number(chunk.successfulSensorCount || 0))
        ),
        classifier: latestChunk?.classifier || chunks[0]?.classifier || "-",
        runtime: {
          rangeRunningHours,
          rangeStoppedHours,
          rangeUnknownHours,
          rangeCoveragePct: total > 0 ? decided / total * 100 : 0,
          cycleRuntimeHours,
          oisState: latestChunk?.runtime?.oisState || "unknown",
          latestSampleAt: latestChunk?.runtime?.latestSampleAt || "",
          transitionCount: chunks.reduce(
            (sum, chunk) => sum + Number(chunk.runtime?.transitionCount || 0),
            0
          )
        }
      };
    });

    return {
      startDate,
      endDate,
      dayCount: countDays(startDate, endDate),
      assets: mergedAssets,
      completedAt: new Date().toISOString()
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
    if (!report?.startDate || !report?.endDate) return;
    const cache = readCache();
    cache[rangeKey(report.startDate, report.endDate)] = report;

    const keys = Object.keys(cache).sort((a, b) =>
      String(cache[b]?.completedAt || "").localeCompare(
        String(cache[a]?.completedAt || "")
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
    } catch {}
  }

  function restoreCache(startDate, endDate) {
    const report = readCache()[rangeKey(startDate, endDate)];
    if (report?.assets?.length) {
      currentReport = report;
      return true;
    }
    return false;
  }

  function getRange() {
    const start = dialog?.querySelector("#sealPotOisStart")?.value || "";
    const end = dialog?.querySelector("#sealPotOisEnd")?.value || "";
    return {
      startDate: start,
      endDate: end,
      dayCount: countDays(start, end)
    };
  }

  function setRange(startDate, endDate) {
    const start = dialog.querySelector("#sealPotOisStart");
    const end = dialog.querySelector("#sealPotOisEnd");
    start.value = startDate;
    end.value = endDate;
  }

  async function loadAssets() {
    const response = await fetch(API_URL, {
      headers: authHeaders(),
      cache: "no-store"
    });
    const payload = await readJson(response);
    return (payload.assets || []).filter(asset => asset.blowerType === "seal_pot");
  }

  async function fetchRaw(targetDate) {
    const url = new URL(API_URL, window.location.origin);
    url.searchParams.set("action", "seal_pot_raw");
    url.searchParams.set("targetDate", targetDate);
    url.searchParams.set("_", String(Date.now()));

    const response = await fetch(url, {
      headers: authHeaders(),
      cache: "no-store"
    });
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
        `OIS 조회 중 · ${all.filter(item => item.status === "complete").length}/${all.length}`
      );

      if (all.every(item => !["pending", "processing"].includes(item.status))) {
        return all;
      }

      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    throw new Error("Seal Pot OIS 조회가 최대 대기시간을 초과했습니다.");
  }

  async function query(forceRefresh = false) {
    if (polling) return;

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
      renderReport();
      renderStatus("저장된 Seal Pot 분석 결과를 표시합니다.");
      return;
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

      const assets = await loadAssets();
      const reports = [];

      for (let i = 0; i < items.length; i += 1) {
        renderStatus(`저장 RAW 분석 중 · ${i + 1}/${items.length}`);
        const item = items[i];
        const raw = await fetchRaw(item.targetDate);
        const [startDate, endDate] = String(item.targetDate).split("~");
        reports.push({
          startDate,
          endDate: endDate || startDate,
          assets: analyseRawChunk(raw, assets, startDate, endDate || startDate)
        });
      }

      currentReport = aggregateReports(
        reports,
        range.startDate,
        range.endDate,
        assets
      );

      saveCache(currentReport);
      renderReport();
      renderStatus(
        "Seal Pot OIS Shadow 계산 완료 · 카드 상태/누적시간에는 아직 반영하지 않습니다."
      );
    } catch (error) {
      console.error(error);
      renderStatus(error.message || "Seal Pot OIS 조회에 실패했습니다.", "error");
    } finally {
      polling = false;
      setBusy(false);
    }
  }

  function setBusy(value) {
    dialog.querySelectorAll(
      "#sealPotOisRun,#sealPotOisRequery"
    ).forEach(el => {
      el.disabled = Boolean(value);
    });
  }

  function renderStatus(text, state = "") {
    const el = dialog?.querySelector("#sealPotOisStatus");
    if (!el) return;
    el.textContent = text;
    el.dataset.state = state;
  }

  function renderReport() {
    const body = dialog.querySelector("#sealPotOisBody");
    const headline = dialog.querySelector("#sealPotOisHeadline");

    if (!currentReport?.assets?.length) {
      headline.textContent = "Seal Pot OIS 분석 대기";
      body.innerHTML = "";
      return;
    }

    headline.textContent =
      `${currentReport.startDate} ~ ${currentReport.endDate} · ` +
      `${currentReport.dayCount}일 · 6대 Shadow`;

    body.innerHTML = currentReport.assets.map(asset => {
      const runtime = asset.runtime || {};
      return `
        <tr>
          <td>
            <strong>${escapeHtml(asset.displayName)}</strong>
            <small>${escapeHtml(asset.tagNumber)}</small>
          </td>
          <td>
            <strong>${escapeHtml(stateLabel(runtime.oisState))}</strong>
            <small>현재 카드 ${escapeHtml(stateLabel(asset.currentCardState))}</small>
          </td>
          <td>
            <strong>${escapeHtml(formatHours(runtime.rangeRunningHours))}</strong>
            <small>판정률 ${Number(runtime.rangeCoveragePct || 0).toFixed(1)}%</small>
          </td>
          <td>
            <strong>${escapeHtml(formatHours(runtime.cycleRuntimeHours))}</strong>
            <small>${escapeHtml(asset.lastReplacementAt ? "교체 후 계산" : "교체일 없음")}</small>
          </td>
          <td>
            <strong>${escapeHtml(asset.classifier)}</strong>
            <small>${Number(asset.successfulSensorCount || 0)}/5 TAG</small>
          </td>
          <td>
            <small>${escapeHtml(runtime.latestSampleAt || "-")}</small>
            <small>전환 ${Number(runtime.transitionCount || 0)}건</small>
          </td>
        </tr>
      `;
    }).join("");
  }

  function buildDialog() {
    if (dialog) return dialog;

    dialog = document.createElement("dialog");
    dialog.className = "seal-pot-ois-dialog";
    dialog.innerHTML = `
      <div class="seal-pot-ois-window">
        <header>
          <div>
            <span>SEAL POT OIS SHADOW V1</span>
            <strong id="sealPotOisHeadline">Seal Pot OIS 분석 대기</strong>
          </div>
          <button type="button" class="button secondary" id="sealPotOisClose">닫기</button>
        </header>

        <div class="seal-pot-ois-note">
          베어링 온도 4TAG와 토출압력 1TAG를 이용한 검증용 Shadow입니다.
          현재 카드의 기동·정지·누적시간은 변경하지 않습니다.
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
        </div>

        <div class="seal-pot-ois-status" id="sealPotOisStatus">
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
        countDays(saved.startDate, saved.endDate) >= 1
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

    dialog.querySelector("#sealPotOisRun").addEventListener("click", () => query(false));

    dialog.querySelector("#sealPotOisRequery").addEventListener("click", () => {
      if (
        window.confirm(
          "선택한 Seal Pot OIS 기간을 처음부터 다시 조회할까요?\n기존 완료자료는 삭제하지 않습니다."
        )
      ) {
        query(true);
      }
    });

    dialog.querySelector(".seal-pot-ois-presets").addEventListener("click", event => {
      const target = event.target.closest("[data-days]");
      if (!target) return;

      const days = Number(target.dataset.days);
      const end = isoToday();
      const start = addDays(end, -(days - 1));
      setRange(start, end);

      if (restoreCache(start, end)) {
        renderReport();
        renderStatus("저장된 Seal Pot 분석 결과를 표시합니다.");
      } else {
        currentReport = null;
        renderReport();
        renderStatus("선택 기간은 아직 조회하지 않았습니다.");
      }
    });

    dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    });

    return dialog;
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
      button.addEventListener("click", () => {
        const dlg = buildDialog();
        const range = getRange();

        if (restoreCache(range.startDate, range.endDate)) {
          renderReport();
          renderStatus("저장된 Seal Pot 분석 결과를 표시합니다.");
        }

        dlg.showModal();
      });

      assetManager.insertAdjacentElement("afterend", button);
    }

    button.hidden =
      activeType() !== "seal_pot" ||
      !currentUser() ||
      window.matchMedia?.("(max-width: 700px)").matches;
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
