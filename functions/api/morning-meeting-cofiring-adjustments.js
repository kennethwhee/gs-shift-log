/*
  Morning Meeting co-firing adjustment compatibility bridge.
  Canonical storage: /api/cofiring-period-adjustments
  A Morning Meeting target date maps to the exact full-day canonical period
  [00:00, next-day 00:00].
*/
import * as SharedAdjustmentApi from "./cofiring-period-adjustments.js";

const SHARED_PATH = "/api/cofiring-period-adjustments";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function clean(value) {
  return String(value ?? "").trim();
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isValidDate(value) {
  const text = clean(value);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number);
  const test = new Date(Date.UTC(year, month - 1, day));
  return test.getUTCFullYear() === year && test.getUTCMonth() === month - 1 && test.getUTCDate() === day;
}

function nextDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day) + 86400000);
  return value.toISOString().slice(0, 10);
}

function periodForDate(date) {
  return {
    start: `${date}T00:00`,
    end: `${nextDate(date)}T00:00`
  };
}

function requestId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `00000000-0000-4000-8000-${String(Date.now()).padStart(12, "0").slice(-12)}`;
}

function bridgeHeaders(request, { jsonBody = false } = {}) {
  const headers = new Headers(request.headers);
  headers.set("Accept", "application/json");
  if (jsonBody) {
    headers.set("Content-Type", "application/json");
    headers.set("X-ShiftLog-Client", "desktop");
  }
  return headers;
}

function sharedUrl(requestUrl, period = null) {
  const url = new URL(requestUrl);
  url.pathname = SHARED_PATH;
  url.search = "";
  if (period) {
    url.searchParams.set("start", period.start);
    url.searchParams.set("end", period.end);
  }
  return url;
}

async function readJson(response) {
  try {
    return await response.clone().json();
  } catch {
    return {};
  }
}

function legacyAdjustment(adjustment) {
  if (!adjustment || typeof adjustment !== "object" || Array.isArray(adjustment)) return null;
  const finalOne = finite(adjustment.finalBioUnit1 ?? adjustment.finalBioUnitOne);
  const finalTwo = finite(adjustment.finalBioUnit2 ?? adjustment.finalBioUnitTwo);
  const maxBio = finite(adjustment.maxBioTpd ?? adjustment.maxBioLimit);
  return {
    ...adjustment,
    finalBioUnit1: finalOne,
    finalBioUnit2: finalTwo,
    finalBioUnitOne: finalOne,
    finalBioUnitTwo: finalTwo,
    maxBioTpd: maxBio,
    maxBioLimit: maxBio
  };
}

function legacySetting(setting) {
  const maxBio = finite(setting?.maxBioTpd ?? setting?.maxBioLimit);
  return {
    ...(setting && typeof setting === "object" ? setting : {}),
    maxBioTpd: maxBio,
    maxBioLimit: maxBio
  };
}

function compatiblePayload(payload, targetDate) {
  return {
    ...payload,
    ok: payload?.ok !== false,
    targetDate,
    adjustment: legacyAdjustment(payload?.adjustment || payload?.entry?.adjustment || payload?.entry),
    revision: Number(payload?.revision ?? payload?.entry?.revision ?? 0) || 0,
    setting: legacySetting(payload?.setting)
  };
}

async function callSharedGet(context, targetDate) {
  const period = periodForDate(targetDate);
  const request = new Request(sharedUrl(context.request.url, period), {
    method: "GET",
    headers: bridgeHeaders(context.request)
  });
  const handler = SharedAdjustmentApi.onRequestGet || SharedAdjustmentApi.onRequest;
  const response = typeof handler === "function"
    ? await handler({ ...context, request })
    : json({ ok: false, message: "공용 혼소 조정 조회 API를 확인할 수 없습니다." }, 500);
  const payload = await readJson(response);
  return { response, payload, period };
}

async function callSharedPost(context, body) {
  const request = new Request(sharedUrl(context.request.url), {
    method: "POST",
    headers: bridgeHeaders(context.request, { jsonBody: true }),
    body: JSON.stringify(body)
  });
  const handler = SharedAdjustmentApi.onRequestPost || SharedAdjustmentApi.onRequest;
  const response = typeof handler === "function"
    ? await handler({ ...context, request })
    : json({ ok: false, message: "공용 혼소 조정 저장 API를 확인할 수 없습니다." }, 500);
  return { response, payload: await readJson(response) };
}

function targetDateFrom(context, body = null) {
  const url = new URL(context.request.url);
  return clean(
    body?.targetDate ||
    body?.date ||
    body?.adjustment?.targetDate ||
    url.searchParams.get("targetDate") ||
    url.searchParams.get("date")
  );
}

function sourceAdjustment(body) {
  if (body?.adjustment && typeof body.adjustment === "object" && !Array.isArray(body.adjustment)) return body.adjustment;
  if (body?.result?.adjustment && typeof body.result.adjustment === "object") return { ...body.result.adjustment, result: body.result };
  return body || {};
}

function normalizeSaveAdjustment(body, currentSetting) {
  const source = sourceAdjustment(body);
  const result = source.result || body?.result || {};
  const finalOne = finite(
    source.finalBioUnit1 ?? source.finalBioUnitOne ??
    body?.finalBioUnit1 ?? body?.finalBioUnitOne ??
    result?.fuelData?.unitOne?.bio ?? result?.units?.unit1?.bio?.quantity
  );
  const finalTwo = finite(
    source.finalBioUnit2 ?? source.finalBioUnitTwo ??
    body?.finalBioUnit2 ?? body?.finalBioUnitTwo ??
    result?.fuelData?.unitTwo?.bio ?? result?.units?.unit2?.bio?.quantity
  );
  if (finalOne === null || finalTwo === null || finalOne < 0 || finalTwo < 0) return null;
  const fromUnitRaw = source.fromUnit ?? body?.fromUnit;
  const fromUnit = fromUnitRaw === null || fromUnitRaw === undefined || fromUnitRaw === "" ? null : (Number(fromUnitRaw) === 2 ? 2 : 1);
  const transfer = finite(source.bioTransferTons ?? body?.bioTransferTons) ?? 0;
  const excluded = finite(source.excludedBioTons ?? body?.excludedBioTons ?? result?.excludedBioTons) ?? 0;
  const maxBio = finite(source.maxBioTpd ?? source.maxBioLimit ?? body?.maxBioTpd ?? body?.maxBioLimit ?? currentSetting?.maxBioTpd);
  return {
    mode: clean(source.mode || body?.mode || result?.mode || "manual_final") || "manual_final",
    fromUnit,
    bioTransferTons: Math.max(0, transfer),
    finalBioUnit1: finalOne,
    finalBioUnit2: finalTwo,
    maxBioTpd: maxBio,
    excludedBioTons: Math.max(0, excluded),
    note: clean(source.note || body?.note || result?.exclusionNote)
  };
}

async function freshCompatible(context, targetDate) {
  const latest = await callSharedGet(context, targetDate);
  if (!latest.response.ok || latest.payload?.ok === false) return json(latest.payload, latest.response.status);
  return json(compatiblePayload(latest.payload, targetDate), latest.response.status);
}

export async function onRequestGet(context) {
  const targetDate = targetDateFrom(context);
  if (!isValidDate(targetDate)) return json({ ok: false, message: "혼소 조정 기준일을 확인해 주세요." }, 400);
  return freshCompatible(context, targetDate);
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ ok: false, message: "저장할 혼소 조정 JSON을 확인해 주세요." }, 400);
  }
  const action = clean(body?.action).toLowerCase().replace(/[\s-]+/g, "_");
  const possibleMaxBio = finite(body?.maxBioTpd ?? body?.maxBioLimit ?? body?.setting?.maxBioTpd ?? body?.setting?.maxBioLimit);
  const hasAdjustmentValue = [
    body?.finalBioUnit1, body?.finalBioUnitOne, body?.finalBioUnit2, body?.finalBioUnitTwo,
    body?.bioTransferTons, body?.mode, body?.adjustment, body?.result
  ].some(value => value !== undefined && value !== null && value !== "");
  const settingOnly =
    action === "save_setting" || action === "setting" || action === "save_limit" ||
    (!action && possibleMaxBio !== null && !hasAdjustmentValue);

  if (settingOnly) {
    const maxBio = possibleMaxBio;
    if (maxBio === null || maxBio <= 0 || maxBio > 2000) {
      return json({ ok: false, message: "호기당 Bio 최대량을 확인해 주세요." }, 400);
    }
    const saved = await callSharedPost(context, { action: "save_setting", maxBioTpd: maxBio });
    if (!saved.response.ok || saved.payload?.ok === false) return json(saved.payload, saved.response.status);
    return json({
      ...saved.payload,
      ok: true,
      setting: legacySetting(saved.payload?.setting || { maxBioTpd: maxBio })
    }, saved.response.status);
  }

  const targetDate = targetDateFrom(context, body);
  if (!isValidDate(targetDate)) return json({ ok: false, message: "혼소 조정 기준일을 확인해 주세요." }, 400);
  const current = await callSharedGet(context, targetDate);
  if (!current.response.ok || current.payload?.ok === false) return json(current.payload, current.response.status);
  const expectedRevision = Number(current.payload?.revision) || 0;

  if (["clear", "reset", "delete", "restore"].includes(action)) {
    const saved = await callSharedPost(context, {
      action: "clear",
      start: current.period.start,
      end: current.period.end,
      expectedRevision,
      requestId: clean(body?.requestId) || requestId()
    });
    if (!saved.response.ok || saved.payload?.ok === false) return json(saved.payload, saved.response.status);
    return freshCompatible(context, targetDate);
  }

  const adjustment = normalizeSaveAdjustment(body, current.payload?.setting);
  if (!adjustment) return json({ ok: false, message: "저장할 최종 Bio 사용량을 확인해 주세요." }, 400);
  const saved = await callSharedPost(context, {
    action: "save",
    start: current.period.start,
    end: current.period.end,
    adjustment,
    expectedRevision,
    requestId: clean(body?.requestId) || requestId()
  });
  if (!saved.response.ok || saved.payload?.ok === false) return json(saved.payload, saved.response.status);
  return freshCompatible(context, targetDate);
}

export async function onRequestDelete(context) {
  const targetDate = targetDateFrom(context);
  if (!isValidDate(targetDate)) return json({ ok: false, message: "혼소 조정 기준일을 확인해 주세요." }, 400);
  const current = await callSharedGet(context, targetDate);
  if (!current.response.ok || current.payload?.ok === false) return json(current.payload, current.response.status);
  const saved = await callSharedPost(context, {
    action: "clear",
    start: current.period.start,
    end: current.period.end,
    expectedRevision: Number(current.payload?.revision) || 0,
    requestId: requestId()
  });
  if (!saved.response.ok || saved.payload?.ok === false) return json(saved.payload, saved.response.status);
  return freshCompatible(context, targetDate);
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  if (context.request.method === "DELETE") return onRequestDelete(context);
  return json({ ok: false, message: "지원하지 않는 요청 방식입니다." }, 405);
}
