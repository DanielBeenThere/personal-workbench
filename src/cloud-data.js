import { publishableKey, supabaseUrl } from "./cloud-config.js";

const workspacePath = "/rest/v1/workbench_workspaces";

export function createCloudData(fetcher = globalThis.fetch) {
  async function request(path, { token, method = "GET", body, representation = false } = {}) {
    const headers = { apikey: publishableKey };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (representation) headers.Prefer = "return=representation";
    const response = await fetcher(new URL(path, supabaseUrl), {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = response.status === 204 ? null : await response.json();
    if (!response.ok) {
      const error = new Error(data?.message || data?.msg || "工作台服务暂时不可用。");
      error.status = response.status;
      error.code = data?.code || data?.error_code;
      throw error;
    }
    return data;
  }
  const workspaceQuery = (userId) => `${workspacePath}?user_id=eq.${encodeURIComponent(userId)}&select=revision,snapshot,last_write_id`;
  async function authToken(grantType, body) {
    const session = await request(`/auth/v1/token?grant_type=${grantType}`, { method: "POST", body });
    session.expires_at ??= Math.floor(Date.now() / 1000) + session.expires_in;
    return session;
  }

  return {
    signIn(email, password) {
      return authToken("password", { email, password });
    },
    refresh(refreshToken) {
      return authToken("refresh_token", { refresh_token: refreshToken });
    },
    signOut(token) {
      return request("/auth/v1/logout?scope=local", { method: "POST", token });
    },
    async load(userId, token) {
      const [row] = await request(workspaceQuery(userId), { token });
      return row ?? null;
    },
    async create(userId, snapshot, token) {
      const [row] = await request(workspacePath, {
        method: "POST", token, representation: true, body: { user_id: userId, snapshot },
      });
      return row;
    },
    async save(userId, revision, snapshot, writeId, token) {
      const [row] = await request(`${workspaceQuery(userId)}&revision=eq.${revision}`, {
        method: "PATCH", token, representation: true,
        body: { revision: revision + 1, snapshot, last_write_id: writeId },
      });
      return row ?? null;
    },
  };
}
