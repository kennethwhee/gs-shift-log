"use strict";

(function installManagementCommon() {
  const AUTH_STORAGE_KEY =
    "gsShiftLog.currentUser";

  let toastTimer = null;

  function loadCurrentUser() {
    try {
      const raw =
        localStorage.getItem(
          AUTH_STORAGE_KEY
        );

      if (!raw) {
        return null;
      }

      const parsed =
        JSON.parse(raw);

      return (
        parsed &&
        typeof parsed === "object"
      )
        ? parsed
        : null;

    } catch {
      return null;
    }
  }

  function getSessionToken() {
    const user =
      loadCurrentUser();

    return String(
      user?.sessionToken ||
      user?.session_token ||
      ""
    ).trim();
  }

  function getAuthHeaders(
    extraHeaders = {}
  ) {
    const token =
      getSessionToken();

    return {
      Accept:
        "application/json",

      ...extraHeaders,

      ...(
        token
          ? {
              Authorization:
                `Bearer ${token}`
            }
          : {}
      )
    };
  }

  function getUserName() {
    const user =
      loadCurrentUser();

    return String(
      user?.name ||
      user?.employeeName ||
      user?.employee_name ||
      ""
    ).trim();
  }

  function getEmployeeNo() {
    const user =
      loadCurrentUser();

    return String(
      user?.employeeNo ||
      user?.employee_no ||
      user?.employeeId ||
      user?.employee_id ||
      user?.id ||
      ""
    ).trim();
  }

  function showToast(
    message,
    type = "info"
  ) {
    let toast =
      document.getElementById(
        "managementToast"
      );

    if (!toast) {
      toast =
        document.createElement(
          "div"
        );

      toast.id =
        "managementToast";

      toast.className =
        "management-toast";

      document.body.append(
        toast
      );
    }

    toast.className =
      "management-toast";

    if (type === "error") {
      toast.classList.add(
        "is-error"
      );
    }

    if (type === "success") {
      toast.classList.add(
        "is-success"
      );
    }

    toast.textContent =
      String(message || "");

    toast.hidden = false;

    if (toastTimer) {
      clearTimeout(
        toastTimer
      );
    }

    toastTimer =
      setTimeout(
        () => {
          toast.hidden = true;
        },
        2800
      );
  }

  function todayDate() {
    const now =
      new Date();

    const year =
      now.getFullYear();

    const month =
      String(
        now.getMonth() + 1
      ).padStart(2, "0");

    const day =
      String(
        now.getDate()
      ).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function escapeHtml(
    value
  ) {
    return String(
      value ?? ""
    )
      .replaceAll(
        "&",
        "&amp;"
      )
      .replaceAll(
        "<",
        "&lt;"
      )
      .replaceAll(
        ">",
        "&gt;"
      )
      .replaceAll(
        '"',
        "&quot;"
      )
      .replaceAll(
        "'",
        "&#039;"
      );
  }

  function textToHtml(
    value
  ) {
    return escapeHtml(
      value
    ).replaceAll(
      "\n",
      "<br>"
    );
  }

  function createId(
    prefix = "mg"
  ) {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID ===
        "function"
    ) {
      return `${prefix}-${crypto.randomUUID()}`;
    }

    return (
      `${prefix}-` +
      Date.now().toString(36) +
      "-" +
      Math.random()
        .toString(36)
        .slice(2)
    );
  }

  function parseJsonResponse(
    response
  ) {
    return response
      .json()
      .catch(
        () => ({
          ok: false,
          message:
            "서버 응답을 읽지 못했습니다."
        })
      );
  }

  window.GSManagement = {
    AUTH_STORAGE_KEY,
    loadCurrentUser,
    getSessionToken,
    getAuthHeaders,
    getUserName,
    getEmployeeNo,
    showToast,
    todayDate,
    escapeHtml,
    textToHtml,
    createId,
    parseJsonResponse
  };
})();
