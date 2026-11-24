import { createCloudData } from "./cloud-data.js";

export const cloudMode = Boolean(globalThis.document?.querySelector('meta[name="workbench-cloud"]')) ||
  new URLSearchParams(globalThis.location?.search).get("cloud") === "1";

export function createCloudWorkspace(initialState, data = createCloudData()) {
  const blank = structuredClone(initialState);
  for (const key of ["groups", "themes", "tasks", "ideas", "completions", "agentClaims"]) blank[key] = [];
  const listeners = new Set();
  const sessionKey = "personal-workbench:supabase-session";
  let session;
  let identity;
  let state = blank;
  let remoteRevision = 0;
  let pending;
  let inFlight;
  let writing = false;
  let reading = false;
  let refreshing;
  let conflict = false;
  let status = "";
  const hasChanges = () => Boolean(pending || inFlight);

  function notify() {
    listeners.forEach(listener => listener(structuredClone(state)));
  }

  function setStatus(message) {
    if (status === message) return;
    status = message;
    globalThis.dispatchEvent?.(new Event("workbench-cloud-status"));
  }

  function remember(next) {
    session = next;
    if (next) globalThis.sessionStorage?.setItem(sessionKey, JSON.stringify(next));
    else globalThis.sessionStorage?.removeItem(sessionKey);
  }

  async function token() {
    if (!session) throw new Error("请先登录工作台。");
    if (session.expires_at * 1000 > Date.now() + 60000) return session.access_token;
    if (!refreshing) {
      const previous = session;
      refreshing = data.refresh(previous.refresh_token).then(next => {
        if (session !== previous) throw new Error("登录状态已变化，请重试。");
        remember(next);
        return next.access_token;
      }).finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  function apply(row, user) {
    remoteRevision = row.revision;
    state = { ...structuredClone(row.snapshot), session: true, revision: state.revision + 1 };
    state.account = { ...blank.account, ...state.account, email: user.email };
    notify();
  }

  async function activate(next) {
    remember(next);
    const user = next.user;
    const accessToken = await token();
    let row = await data.load(user.id, accessToken);
    if (!row) {
      try {
        row = await data.create(user.id, blank, accessToken);
      } catch (error) {
        if (error.code !== "23505") throw error;
        row = await data.load(user.id, accessToken);
        if (!row) throw error;
      }
    }
    identity = user;
    apply(row, user);
  }

  async function flush() {
    if (writing || conflict || !hasChanges() || !identity) return;
    writing = true;
    const user = identity;
    try {
      while (hasChanges()) {
        if (!inFlight) {
          inFlight = pending;
          pending = null;
        }
        const write = inFlight;
        setStatus("正在同步到云端…");
        const accessToken = await token();
        let row = await data.save(user.id, remoteRevision, write.snapshot, write.id, accessToken);
        if (!row) {
          const latest = await data.load(user.id, accessToken);
          if (latest?.last_write_id === write.id) row = latest;
        }
        if (!row) {
          conflict = true;
          setStatus("其他设备已有更新。本页的改动未同步，请先导出备份，再刷新读取云端版本。");
          return;
        }
        remoteRevision = row.revision;
        inFlight = null;
      }
      setStatus("");
    } catch {
      setStatus("改动暂未同步，请保持本页打开，恢复连接后会重试。");
    } finally {
      writing = false;
    }
  }

  async function refreshWorkspace() {
    if (!identity || reading || writing || conflict) return;
    if (hasChanges()) { await flush(); return; }
    reading = true;
    const user = identity;
    const revisionBefore = state.revision;
    try {
      const row = await data.load(user.id, await token());
      if (identity === user && revisionBefore === state.revision && row?.revision > remoteRevision) apply(row, user);
      if (identity === user && !hasChanges()) setStatus("");
    } catch {
      if (identity === user && !hasChanges()) setStatus("暂时无法读取最新任务，恢复连接后会重试。");
    } finally {
      reading = false;
    }
  }

  return {
    getStatus: () => status,
    store: {
      get: () => structuredClone(state),
      update(edit) {
        if (!identity) throw new Error("请先登录工作台。");
        const draft = structuredClone(state);
        const result = edit(draft);
        draft.revision += 1;
        state = draft;
        pending = { id: crypto.randomUUID(), snapshot: draft };
        void flush();
        notify();
        return structuredClone(result);
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    auth: {
      async login({ email, password }) {
        try {
          await activate(await data.signIn(email.trim(), password));
        } catch (error) {
          remember(null);
          if (error.code === "invalid_credentials") throw new Error("邮箱或密码不正确。");
          throw error;
        }
      },
      async logout() {
        if (hasChanges() || writing) throw new Error("还有改动未同步，请等待同步或先导出备份再刷新。");
        await data.signOut(await token());
        remember(null);
        identity = null;
        state = { ...blank, revision: state.revision + 1 };
        setStatus("");
        notify();
      },
    },
    async start() {
      try {
        const stored = JSON.parse(globalThis.sessionStorage?.getItem(sessionKey) || "null");
        if (stored) await activate(stored);
      } catch {
        remember(null);
        setStatus("暂未恢复登录，请重新登录。");
      }
      globalThis.addEventListener("online", refreshWorkspace);
      globalThis.addEventListener("focus", refreshWorkspace);
      globalThis.addEventListener("beforeunload", event => {
        if (hasChanges()) event.preventDefault();
      });
      globalThis.setInterval(() => {
        if (!globalThis.document.hidden) void refreshWorkspace();
      }, 4000);
    },
  };
}
