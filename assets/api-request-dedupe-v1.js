/* =========================================================
  GS Shift Log 첫 화면 중복 요청 공유 v1 (2026-11-20)

  첫 화면이 뜨는 동안 여러 모듈이 같은 GET 요청을 거의 동시에 보낸다.
  (측정: 에이전트 완료 이력 7번, 날씨 3번, 보일러 온도 2번)

  처음 15초 동안, 아래 허용 목록에 있는 같은 GET 요청은
  서버에 한 번만 보내고 응답을 복사해서 나눠 준다.

  - 같은 요청이 진행 중이면 그 요청을 같이 기다린다.
  - 끝난 뒤 5초 안에 같은 요청이 오면 그 응답을 다시 쓴다(정상 응답만).
  - /api/ 쓰기 요청(POST·PUT·PATCH·DELETE)이 나가면 공유 중인 응답을 모두 버린다.
  - 요청마다 걸린 취소 신호(AbortSignal)는 그 요청에만 적용된다.
  - 15초가 지나면 아무 일도 하지 않고 원래 fetch를 그대로 쓴다.
========================================================= */
(function installGsApiRequestDedupeV1(global) {
  "use strict";

  if (
    !global ||
    typeof global.fetch !== "function" ||
    global.__gsApiRequestDedupeV1
  ) {
    return;
  }

  const nativeFetch = global.fetch.bind(global);
  const STARTUP_WINDOW_MS = 15000;
  const REUSE_AFTER_COMPLETE_MS = 5000;
  const startedAt = Date.now();
  const entries = new Map();

  const SHARED_OIS_ACTIONS = new Set([
    "completed_history",
    "logsheet_batch_status",
    "morning_meeting_auto_history_reset_status",
    "cofiring_period_source"
  ]);

  const SHARED_PATHS = new Set([
    "/api/weather-forecast",
    "/api/legacy-logs",
    "/api/morning-meeting-boiler-snapshot"
  ]);

  function now() {
    return Date.now();
  }

  function abortError(signal) {
    if (signal && signal.reason !== undefined) {
      return signal.reason;
    }

    try {
      return new DOMException("The operation was aborted.", "AbortError");
    } catch (_error) {
      const error = new Error("The operation was aborted.");
      error.name = "AbortError";
      return error;
    }
  }

  function describe(input, init) {
    const isRequest =
      typeof Request !== "undefined" &&
      input instanceof Request;

    const rawUrl = isRequest ? input.url : String(input);
    const method = String(
      (init && init.method) ||
      (isRequest ? input.method : "") ||
      "GET"
    ).toUpperCase();

    let url = null;

    try {
      url = new URL(rawUrl, global.location.href);
    } catch (_error) {
      return null;
    }

    return {
      isRequest,
      url,
      method,
      sameOrigin: url.origin === global.location.origin,
      authorization: (() => {
        try {
          return new Headers(
            (init && init.headers) ||
            (isRequest ? input.headers : undefined)
          ).get("Authorization") || "";
        } catch (_error) {
          return "";
        }
      })()
    };
  }

  function shareKey(request) {
    if (
      !request ||
      request.isRequest ||
      !request.sameOrigin ||
      request.method !== "GET"
    ) {
      return "";
    }

    const path = request.url.pathname;

    if (path === "/api/ois-data-requests") {
      if (!SHARED_OIS_ACTIONS.has(request.url.searchParams.get("action") || "")) {
        return "";
      }
    } else if (!SHARED_PATHS.has(path)) {
      return "";
    }

    const params = [...request.url.searchParams]
      .filter(([name]) => name !== "_")
      .sort((left, right) => {
        if (left[0] !== right[0]) {
          return left[0] < right[0] ? -1 : 1;
        }

        return left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0;
      });

    return path + "?" + new URLSearchParams(params).toString() + "#" + request.authorization;
  }

  function waitFor(promise, signal) {
    if (!signal) {
      return promise;
    }

    if (signal.aborted) {
      return Promise.reject(abortError(signal));
    }

    return new Promise((resolve, reject) => {
      const onAbort = () => reject(abortError(signal));

      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        value => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        error => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        }
      );
    });
  }

  function dedupedFetch(input, init) {
    let request = null;

    try {
      request = describe(input, init);
    } catch (_error) {
      request = null;
    }

    if (
      request &&
      request.sameOrigin &&
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      request.url.pathname.startsWith("/api/")
    ) {
      entries.clear();
    }

    const key =
      now() - startedAt < STARTUP_WINDOW_MS
        ? shareKey(request)
        : "";

    if (!key) {
      return nativeFetch(input, init);
    }

    const signal = init && init.signal;
    const existing = entries.get(key);

    if (
      existing &&
      (!existing.completedAt || now() - existing.completedAt < REUSE_AFTER_COMPLETE_MS)
    ) {
      return waitFor(existing.promise, signal).then(response => response.clone());
    }

    const sharedInit = init ? { ...init } : undefined;

    if (sharedInit) {
      delete sharedInit.signal;
    }

    const entry = { completedAt: 0, promise: null };

    entry.promise = nativeFetch(input, sharedInit).then(
      response => {
        entry.completedAt = now();

        if (!response.ok && entries.get(key) === entry) {
          entries.delete(key);
        }

        return response;
      },
      error => {
        if (entries.get(key) === entry) {
          entries.delete(key);
        }

        throw error;
      }
    );

    entries.set(key, entry);

    return waitFor(entry.promise, signal).then(response => response.clone());
  }

  global.fetch = dedupedFetch;
  global.__gsApiRequestDedupeV1 = {
    version: 1,
    startedAt,
    entries,
    nativeFetch
  };

  if (typeof global.setTimeout === "function") {
    global.setTimeout(() => entries.clear(), STARTUP_WINDOW_MS + REUSE_AFTER_COMPLETE_MS);
  }
})(typeof window !== "undefined" ? window : globalThis);
