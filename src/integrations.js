import { createRemoteAdapters } from "../domain/remote-adapters.mjs";

export { createRemoteAdapters };

export const demoCredentials = { email: "demo@example.com", password: "workbench-demo" };
const profileFields = ["account", "groups", "themes", "tasks", "ideas", "settings", "completions", "agentClaims"];
const loginWindowMs = 10 * 60 * 1000;
const accountKey = "personal-workbench:demo-accounts:v1";
const samplePasswordMinimum = 8;
const canonicalEmail = (value) => String(value || "").trim().toLowerCase();
const hex = (data) => [...new Uint8Array(data)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

async function verifier(password, salt) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({
    name: "PBKDF2", salt: encoder.encode(salt), iterations: 120_000, hash: "SHA-256",
  }, key, 256));
}

function validEmail(value) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw failure("INVALID_EMAIL", "请输入有效邮箱");
}

function demoPassword(value) {
  if (typeof value !== "string" || value.length < samplePasswordMinimum) {
    throw failure("INVALID_PASSWORD", "演示密码至少 8 个字符");
  }
}

/** Browser-only demonstration. Never reuse a production password here. */
export function createDemoAuth(api, { storage = globalThis.localStorage, now = Date.now } = {}) {
  const challenges = new Map();
  let memory = { accounts: {}, attempts: {} };
  function read() {
    const saved = storage?.getItem(accountKey);
    return saved ? JSON.parse(saved) : structuredClone(memory);
  }
  function write(data) {
    if (storage) storage.setItem(accountKey, JSON.stringify(data));
    else memory = structuredClone(data);
  }
  const original = api.store.get();
  const baseSettings = structuredClone(original.settings);
  baseSettings.autoBackup = false;
  baseSettings.model = { provider: "DeepSeek", status: "disconnected", model: "", search: false };
  baseSettings.assistant = { name: "小助手", userName: "", avatar: "cool-female", style: "direct", customPrompt: "" };
  function snapshot(state) {
    return Object.fromEntries(profileFields.map((key) => [key, structuredClone(state[key])]));
  }
  function activate(data, email) {
    const active = api.store.get();
    if (active.session && active.account.email && active.account.email !== email) {
      const entry = data.accounts[active.account.email];
      if (entry) entry.workspace = snapshot(active);
    }
    const account = data.accounts[email];
    const demoSeed = email === demoCredentials.email && !original.account.email ? snapshot(original) : null;
    const workspace = account.workspace || demoSeed || {
      groups: [], themes: [], tasks: [], ideas: [], completions: [],
      agentClaims: [], settings: structuredClone(baseSettings),
    };
    api.store.update((state) => {
      for (const [key, value] of Object.entries(workspace)) state[key] = structuredClone(value);
      state.session = true;
      state.account = { avatar: "", displayName: account.displayName, ...account.workspace?.account, email };
    });
    write(data);
    return api.store.get().account;
  }
  function validateChallenge(captchaId, answer) {
    const challenge = challenges.get(captchaId);
    challenges.delete(captchaId);
    if (!challenge || challenge.until <= now() || challenge.text !== String(answer || "").trim().toUpperCase()) {
      throw failure("INVALID_CAPTCHA", "验证码输入错误或已过期");
    }
  }
  async function accepts(entry, password) {
    return entry ? await verifier(password, entry.salt) === entry.verifier : false;
  }
  return {
    captcha() {
      const id = crypto.randomUUID();
      const alphabet = "23456789ACDEFGHJKLMNPQRTUVWXYZ";
      const text = [...crypto.getRandomValues(new Uint8Array(5))]
        .map((value) => alphabet[value % alphabet.length]).join("");
      challenges.clear();
      challenges.set(id, { text, until: now() + 2 * 60 * 1000 });
      return { id, text };
    },
    challengeRequired(email) {
      return (read().attempts[canonicalEmail(email)] || []).filter((time) => time > now() - loginWindowMs).length >= 3;
    },
    async register({ email, password, displayName, captchaId, captchaAnswer }) {
      email = canonicalEmail(email);
      validEmail(email);
      demoPassword(password);
      validateChallenge(captchaId, captchaAnswer);
      const name = clean(displayName);
      if (!name) throw failure("INVALID_NAME", "请输入昵称");
      const salt = crypto.randomUUID();
      const secret = await verifier(password, salt);
      const data = read();
      if (data.accounts[email] || email === demoCredentials.email) throw failure("EMAIL_TAKEN", "该邮箱已注册");
      data.accounts[email] = { displayName: name, salt, verifier: secret };
      delete data.attempts[email];
      return activate(data, email);
    },
    async login({ email, password, captchaId, captchaAnswer }) {
      email = canonicalEmail(email);
      validEmail(email);
      if (this.challengeRequired(email)) {
        if (!captchaId) throw failure("CAPTCHA_REQUIRED", "请先输入验证码");
        validateChallenge(captchaId, captchaAnswer);
      }
      const current = read();
      const entry = current.accounts[email];
      const accepted = entry ? await accepts(entry, String(password || ""))
        : email === demoCredentials.email && password === demoCredentials.password;
      const data = read();
      if (!accepted) {
        data.attempts[email] = [...(data.attempts[email] || []).filter((time) => time > now() - loginWindowMs), now()];
        write(data);
        throw failure("INVALID_CREDENTIALS", "邮箱或密码不正确");
      }
      if (!data.accounts[email]) {
        const salt = crypto.randomUUID();
        data.accounts[email] = { displayName: "Daniel", salt, verifier: await verifier(password, salt) };
      }
      delete data.attempts[email];
      return activate(data, email);
    },
    async reset({ email }) {
      validEmail(canonicalEmail(email));
      return { simulated: true };
    },
    async logout() {
      const state = api.store.get();
      const data = read();
      const entry = data.accounts[state.account.email];
      if (entry) entry.workspace = snapshot(state);
      write(data);
      api.store.update((draft) => {
        draft.session = false;
        draft.account = { displayName: "", email: "", avatar: "" };
        for (const key of ["groups", "themes", "tasks", "ideas", "completions", "agentClaims"]) draft[key] = [];
        draft.settings = structuredClone(baseSettings);
      });
    },
    async changePassword({ currentPassword, newPassword }) {
      demoPassword(newPassword);
      const email = api.store.get().account.email;
      const data = read();
      const entry = data.accounts[email];
      if (!await accepts(entry, String(currentPassword || ""))) throw failure("INVALID_CREDENTIALS", "当前密码不正确");
      const salt = crypto.randomUUID();
      entry.verifier = await verifier(newPassword, salt);
      entry.salt = salt;
      write(data);
    },
  };
}

const demoModels = [{ id: "demo-flash", name: "DeepSeek Flash（推荐）" }, { id: "demo-pro", name: "DeepSeek Pro" }];
const clean = (text) => typeof text === "string" ? text.trim() : "";
const ready = (task) => task && ["未开始", "进行中", "逾期"].includes(task.status)
  && Boolean(task.guidance?.version && task.guidance.prompt?.trim())
  && task.guidance.executedVersion !== task.guidance.version;
function prerequisitesMet(state, task) {
  return (task.prerequisites || []).every((id) => state.tasks.find((item) => item.id === id)?.status === "已完成");
}

/** Demo calls are explicit and never send the typed key or workspace over the network. */
export function createDemoModel(api) {
  let tested = null;
  return {
    async test({ provider, apiKey }) {
      if (provider !== "DeepSeek" || clean(apiKey).length < 6) {
        tested = null;
        throw new Error("模拟连接失败，请输入至少 6 个字符的演示密钥");
      }
      tested = { testId: crypto.randomUUID(), provider };
      return { ...tested, models: structuredClone(demoModels), simulated: true };
    },
    async confirm({ testId, model, search = false }) {
      if (!tested || tested.testId !== testId || !demoModels.some((item) => item.id === model)) {
        throw new Error("请先测试所选厂商和密钥");
      }
      const settings = { provider: tested.provider, status: "connected", model, search: Boolean(search), simulated: true };
      api.store.update((state) => { state.settings.model = settings; });
      tested = null;
      return settings;
    },
    async disconnect() {
      tested = null;
      api.store.update((state) => {
        state.settings.model = { provider: "DeepSeek", status: "disconnected", model: "", search: false };
      });
    },
    async send({ text, assistant } = {}) {
      const content = clean(text);
      if (!content) throw new Error("请输入消息");
      const task = api.tasks.recommend()[0];
      const name = clean(assistant?.userName) || api.store.get().account.displayName;
      const salutation = name ? `${name}，` : "";
      const reply = task
        ? `${salutation}可以先看「${task.title}」，并记录一个可推进的下一步。`
        : `${salutation}目前没有可推进的待办。你可以先在任务清单里新增一项。`;
      return { body: reply, sources: [], simulated: true };
    },
  };
}

/** Prototype task handoff. A deployed service must enforce identity and claims atomically server-side. */
export function createLocalAgent(store, { lockName = "personal-workbench:agent" } = {}) {
  const activeFor = (state, task) => state.agentClaims?.find((claim) =>
    claim.taskId === task.id && claim.version === task.guidance.version);
  const available = (state, task, agent) => ready(task) && task.assignee === agent
    && prerequisitesMet(state, task) && !activeFor(state, task);
  function underLock(run) {
    return globalThis.window?.navigator?.locks?.request
      ? globalThis.window.navigator.locks.request(lockName, run)
      : Promise.resolve().then(run);
  }
  return {
    list(agent) {
      const state = store.get();
      return state.tasks.filter((task) => available(state, task, agent));
    },
    claim({ taskId, agent, version }) {
      return underLock(() => store.update((state) => {
        const task = state.tasks.find((item) => item.id === taskId);
        if (!available(state, task, agent) || task.guidance.version !== version) {
          throw new Error("该任务不可领取，或指导已更新");
        }
        const claim = { id: crypto.randomUUID(), taskId, agent, version };
        (state.agentClaims ||= []).push(claim);
        return claim;
      }));
    },
    finish(id, { agent, progress }) {
      const body = clean(progress);
      if (!body) throw new Error("请提供执行进展");
      return underLock(() => store.update((state) => {
        const claim = state.agentClaims?.find((entry) => entry.id === id);
        const task = state.tasks.find((entry) => entry.id === claim?.taskId);
        if (!claim || claim.agent !== agent || !ready(task) || task.assignee !== agent
          || task.guidance.version !== claim.version || !prerequisitesMet(state, task)) {
          throw new Error("领取已失效，无法更新该任务");
        }
        const update = { id: crypto.randomUUID(), author: agent, body, at: new Date().toISOString() };
        (task.updates ||= []).unshift(update);
        task.guidance.executedVersion = claim.version;
        state.agentClaims = state.agentClaims.filter((entry) => entry.id !== id);
        return update;
      }));
    },
    release(id, agent) {
      return underLock(() => store.update((state) => {
        state.agentClaims = (state.agentClaims || []).filter((claim) => claim.id !== id || claim.agent !== agent);
      }));
    },
  };
}
