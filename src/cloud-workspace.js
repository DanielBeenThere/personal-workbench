import { createCloudData } from "./cloud-data.js";

export const cloudMode = Boolean(globalThis.document?.querySelector('meta[name="workbench-cloud"]')) ||
  new URLSearchParams(globalThis.location?.search).get("cloud") === "1";

const rememberFor = 30 * 24 * 60 * 60 * 1000;

export function createCloudWorkspace(initialState, data = createCloudData()) {
  const blank = structuredClone(initialState);
  for (const key of ["groups", "themes", "tasks", "ideas", "completions", "agentClaims"]) blank[key] = [];
  const listeners = new Set();
  const sessionKey = "personal-workbench:supabase-session";
  const rememberedKey = sessionKey + ":remembered";
  let session;
  let rememberUntil;
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

  function readRemembered() {
    try {
      return JSON.parse(globalThis.localStorage?.getItem(rememberedKey) || "null");
    } catch {
      return null;
    }
  }

  function remember(next) {
    session = next;
    if (next && rememberUntil) {
      globalThis.localStorage?.setItem(rememberedKey, JSON.stringify({ session: next, expiresAt: rememberUntil }));
      globalThis.sessionStorage?.removeItem(sessionKey);
    } else if (next) {
      globalThis.sessionStorage?.setItem(sessionKey, JSON.stringify(next));
    } else {
      globalThis.sessionStorage?.removeItem(sessionKey);
    }
  }

  function endSession(message = "") {
    if (rememberUntil && readRemembered()?.expiresAt === rememberUntil) globalThis.localStorage?.removeItem(rememberedKey);
    rememberUntil = null;
    remember(null);
    identity = null;
    pending = null;
    inFlight = null;
    conflict = false;
    state = { ...blank, revision: state.revision + 1 };
    setStatus(message);
    notify();
  }

  function syncRemembered() {
    if (!rememberUntil) return;
    const latest = readRemembered();
    if (!latest || latest.expiresAt !== rememberUntil || latest.expiresAt <= Date.now()) {
      if (hasChanges()) throw new Error("登录已过期。请先导出本页未同步的改动，再重新登录。");
      endSession("请重新登录工作台。");
      throw new Error("请重新登录工作台。");
    }
    session = latest.session;
  }

  function rememberExpired() {
    return rememberUntil && (rememberUntil <= Date.now() || readRemembered()?.expiresAt !== rememberUntil);
  }

  async function renew() {
    syncRemembered();
    if (!session) throw new Error("请先登录工作台。");
    if (session.expires_at * 1000 > Date.now() + 60000) return session.access_token;
    const previous = session;
    const previousDeadline = rememberUntil;
    try {
      const next = await data.refresh(previous.refresh_token);
      if (session?.refresh_token !== previous.refresh_token || rememberUntil !== previousDeadline ||
          (previousDeadline && readRemembered()?.expiresAt !== previousDeadline)) {
        throw new Error("登录状态已变化，请重试。");
      }
      remember(next);
      return next.access_token;
    } catch (error) {
      if (error.status === 400 || error.status === 401 || error.status === 403) {
        if (!hasChanges()) endSession("登录会话已失效，请重新登录。");
      }
      throw error;
    }
  }

  async function token() {
    if (!refreshing) {
      const locks = globalThis.navigator?.locks;
      refreshing = (rememberUntil && locks ? locks.request(rememberedKey, renew) : renew())
        .finally(() => { refreshing = null; });
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
    session = next;
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
      if (identity === user) setStatus(rememberExpired()
        ? "登录已过期。请先导出本页未同步的改动，再重新登录。"
        : "改动暂未同步，请保持本页打开，恢复连接后会重试。");
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
    getAccountId: () => identity?.id,
    async readForAssistant() {
      const user = identity;
      if (!user) throw new Error("请先登录工作台。");
      if (hasChanges() && !writing) await flush();
      if (writing || conflict || hasChanges()) throw new Error("工作台改动尚未同步，请同步完成后再查询。");
      const revision = state.revision;
      const row = await data.load(user.id, await token());
      if (identity !== user || revision !== state.revision || hasChanges()) {
        throw new Error("工作台刚刚发生变化，请重新查询。");
      }
      if (!row || row.revision < remoteRevision) throw new Error("暂时无法取得 Supabase 上的工作台数据。");
      if (row.revision > remoteRevision) apply(row, user);
      return structuredClone(state);
    },
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
      async login({ email, password, keepSignedIn = false }) {
        try {
          await activate(await data.signIn(email.trim(), password));
          rememberUntil = keepSignedIn ? Date.now() + rememberFor : null;
          remember(session);
        } catch (error) {
          endSession();
          if (error.code === "invalid_credentials") throw new Error("邮箱或密码不正确。");
          throw error;
        }
      },
      async logout() {
        if (hasChanges() || writing) throw new Error("还有改动未同步，请等待同步或先导出备份再刷新。");
        try { await data.signOut(await token()); }
        finally { endSession(); }
      },
    },
    async start() {
      try {
        const stored = JSON.parse(globalThis.sessionStorage?.getItem(sessionKey) || "null");
        const remembered = readRemembered();
        if (stored) await activate(stored);
        else if (remembered?.expiresAt > Date.now()) {
          rememberUntil = remembered.expiresAt;
          setStatus("正在恢复登录…");
          await activate(remembered.session);
          setStatus("");
        } else if (remembered) {
          globalThis.localStorage?.removeItem(rememberedKey);
        }
      } catch {
        rememberUntil = null;
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
