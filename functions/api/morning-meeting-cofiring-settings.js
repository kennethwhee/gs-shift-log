/*
  Morning Meeting co-firing calorific compatibility bridge.
  Canonical storage: /api/cofiring-calculation-settings
  Legacy Morning Meeting route is preserved only as a request/response adapter.
*/
import * as SharedSettingsApi from "./cofiring-calculation-settings.js";

const SHARED_PATH = "/api/cofiring-calculation-settings";
const FUELS = ["coal", "bio", "organic", "manure"];
const UNITS = ["unit1", "unit2"];
const LEGACY_FIELDS = Object.freeze({
  coal: "coalKcalPerKg",
  bio: "bioKcalPerKg",
  organic: "organicKcalPerKg",
  manure: "manureKcalPerKg"
});

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

function isValidDate(value) {
  const text = clean(value);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number);
  const test = new Date(Date.UTC(year, month - 1, day));
  return test.getUTCFullYear() === year &&
    test.getUTCMonth() === month - 1 &&
    test.getUTCDate() === day;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requestId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `00000000-0000-4000-8000-${String(Date.now()).padStart(12, "0").slice(-12)}`;
}

function sharedUrl(requestUrl, targetDate) {
  const url = new URL(requestUrl);
  url.pathname = SHARED_PATH;
  url.search = "";
  if (targetDate) url.searchParams.set("targetDate", targetDate);
  return url;
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

async function readJson(response) {
  try {
    return await response.clone().json();
  } catch {
    return {};
  }
}

function extractSharedSettings(payload) {
  const settings = payload?.entry?.settings || payload?.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  for (const unit of UNITS) {
    for (const fuel of FUELS) {
      const item = settings?.[unit]?.[fuel];
      if (!item || !Number.isFinite(Number(item.calorific)) || !Number.isFinite(Number(item.coefficient))) {
        return null;
      }
    }
  }
  return clone(settings);
}

function legacySettingFromShared(payload, targetDate = "") {
  const settings = extractSharedSettings(payload);
  if (!settings) return null;
  const entry = payload?.entry || {};
  const effectiveDate = clean(entry.effectiveDate || payload?.effectiveDate || targetDate);
  const source = payload?.source === "saved" || entry.effectiveDate ? "saved" : "default";
  const setting = {
    effectiveDate,
    coalKcalPerKg: Number(settings.unit1.coal.calorific),
    bioKcalPerKg: Number(settings.unit1.bio.calorific),
    organicKcalPerKg: Number(settings.unit1.organic.calorific),
    manureKcalPerKg: Number(settings.unit1.manure.calorific),
    updatedById: clean(entry.updatedById || payload?.updatedById),
    updatedByName: clean(entry.updatedByName || payload?.updatedByName),
    updatedAt: clean(entry.updatedAt || payload?.updatedAt),
    source
  };
  return { setting, settings };
}

function compatiblePayload(sharedPayload, targetDate) {
  const mapped = legacySettingFromShared(sharedPayload, targetDate);
  if (!mapped) return { ...sharedPayload };
  return {
    ...sharedPayload,
    ok: sharedPayload?.ok !== false,
    targetDate: clean(sharedPayload?.targetDate || targetDate),
    effectiveDate: mapped.setting.effectiveDate,
    source: mapped.setting.source,
    setting: mapped.setting,
    settings: mapped.settings,
    coalKcalPerKg: mapped.setting.coalKcalPerKg,
    bioKcalPerKg: mapped.setting.bioKcalPerKg,
    organicKcalPerKg: mapped.setting.organicKcalPerKg,
    manureKcalPerKg: mapped.setting.manureKcalPerKg
  };
}

async function callSharedGet(context, targetDate) {
  const request = new Request(sharedUrl(context.request.url, targetDate), {
    method: "GET",
    headers: bridgeHeaders(context.request)
  });
  const handler = SharedSettingsApi.onRequestGet || SharedSettingsApi.onRequest;
  if (typeof handler !== "function") {
    return json({ ok: false, message: "공용 혼소율 발열량 조회 API를 확인할 수 없습니다." }, 500);
  }
  return handler({ ...context, request });
}

async function callSharedPost(context, body) {
  const request = new Request(sharedUrl(context.request.url), {
    method: "POST",
    headers: bridgeHeaders(context.request, { jsonBody: true }),
    body: JSON.stringify(body)
  });
  const handler = SharedSettingsApi.onRequestPost || SharedSettingsApi.onRequest;
  if (typeof handler !== "function") {
    return json({ ok: false, message: "공용 혼소율 발열량 저장 API를 확인할 수 없습니다." }, 500);
  }
  return handler({ ...context, request });
}

function calorificCandidate(body, fuel) {
  const field = LEGACY_FIELDS[fuel];
  const candidates = [
    body?.[field],
    body?.setting?.[field],
    body?.settings?.unit1?.[fuel]?.calorific,
    body?.settings?.unit2?.[fuel]?.calorific
  ];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === "") continue;
    const number = Number(candidate);
    if (Number.isFinite(number) && number > 0 && number <= 50000) return number;
    return NaN;
  }
  return null;
}

function mergeLegacyCalorifics(baseSettings, body) {
  const next = clone(baseSettings);
  let changed = false;
  for (const fuel of FUELS) {
    const value = calorificCandidate(body, fuel);
    if (Number.isNaN(value)) return null;
    if (value === null) continue;
    changed = true;
    for (const unit of UNITS) {
      next[unit][fuel] = {
        ...next[unit][fuel],
        calorific: value
      };
    }
  }
  return changed ? next : null;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const targetDate = clean(
    url.searchParams.get("targetDate") ||
    url.searchParams.get("effectiveDate") ||
    url.searchParams.get("date")
  );
  if (!isValidDate(targetDate)) {
    return json({ ok: false, message: "조회할 발열량 적용일을 확인해 주세요." }, 400);
  }
  const response = await callSharedGet(context, targetDate);
  const payload = await readJson(response);
  if (!response.ok || payload?.ok === false) return json(payload, response.status);
  return json(compatiblePayload(payload, targetDate), response.status);
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ ok: false, message: "저장할 발열량 JSON을 확인해 주세요." }, 400);
  }
  const effectiveDate = clean(body?.effectiveDate || body?.targetDate || body?.setting?.effectiveDate);
  if (!isValidDate(effectiveDate)) {
    return json({ ok: false, message: "발열량 적용 시작일을 확인해 주세요." }, 400);
  }

  const baseResponse = await callSharedGet(context, effectiveDate);
  const basePayload = await readJson(baseResponse);
  if (!baseResponse.ok || basePayload?.ok === false) return json(basePayload, baseResponse.status);
  const baseSettings = extractSharedSettings(basePayload);
  if (!baseSettings) {
    return json({ ok: false, message: "공용 혼소율 발열량 기준값을 확인할 수 없습니다." }, 409);
  }

  const nextSettings = mergeLegacyCalorifics(baseSettings, body);
  if (!nextSettings) {
    return json({ ok: false, message: "저장할 Coal/Bio/유기성/축분 발열량을 확인해 주세요." }, 400);
  }

  const sharedBody = {
    effectiveDate,
    settings: nextSettings,
    requestId: clean(body?.requestId) || requestId()
  };
  const response = await callSharedPost(context, sharedBody);
  const payload = await readJson(response);
  if (!response.ok || payload?.ok === false) return json(payload, response.status);
  return json(compatiblePayload(payload, effectiveDate), response.status);
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ ok: false, message: "지원하지 않는 요청 방식입니다." }, 405);
}
