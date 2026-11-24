/** Optional same-origin backend. The local app can run without these routes. */
export function createRemoteAdapters({
  basePath = "/api/v1",
  fetcher = globalThis.fetch.bind(globalThis),
  csrfToken = () => "",
} = {}) {
  if (!/^\/[\w/-]+$/.test(basePath) || basePath.startsWith("//")) {
    throw new TypeError("接口路径必须是同站点路径");
  }
  const prefix = basePath.replace(/\/$/, "");

  async function request(path, { method = "GET", body, signal, revision } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (revision != null) headers["If-Match"] = String(revision);
    const token = method === "GET" ? "" : csrfToken();
    if (token) headers["X-CSRF-Token"] = token;

    const response = await fetcher(prefix + path, {
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    if (response.status === 204) return undefined;
    const isJson = response.headers.get("Content-Type")?.includes("json");
    const payload = isJson ? await response.json() : null;
    if (!response.ok || !isJson) {
      const error = new Error(payload?.message || "接口暂不可用");
      error.code = payload?.code || "REQUEST_FAILED";
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  return {
    auth: {
      session: (signal) => request("/auth/session", { signal }),
      captcha: (signal) => request("/auth/captcha", { signal }),
      login: (body, signal) => request("/auth/login", { method: "POST", body, signal }),
      register: (body, signal) => request("/auth/register", { method: "POST", body, signal }),
      reset: (body, signal) => request("/auth/password-reset", { method: "POST", body, signal }),
      logout: (signal) => request("/auth/logout", { method: "POST", signal }),
      updateProfile: (body, signal) => request("/account/profile", { method: "PATCH", body, signal }),
      changePassword: (body, signal) => request("/account/password", { method: "PUT", body, signal }),
    },
    workspace: {
      load: (signal) => request("/workspace", { signal }),
      save: (snapshot, revision, signal) =>
        request("/workspace", { method: "PUT", body: snapshot, revision, signal }),
    },
    model: {
      send: (body, signal) => request("/assistant/messages", { method: "POST", body, signal }),
      test: (body, signal) => request("/model/connection/test", { method: "POST", body, signal }),
      confirm: (body, signal) => request("/model/connection", { method: "PUT", body, signal }),
      disconnect: (signal) => request("/model/connection", { method: "DELETE", signal }),
    },
    agent: {
      list: (signal) => request("/agent/assignments", { signal }),
      claim: (body, signal) => request("/agent/claims", { method: "POST", body, signal }),
      finish: (claimId, body, signal) =>
        request("/agent/claims/" + encodeURIComponent(claimId) + "/completion", {
          method: "POST", body, signal,
        }),
      release: (claimId, signal) =>
        request("/agent/claims/" + encodeURIComponent(claimId), { method: "DELETE", signal }),
    },
  };
}
