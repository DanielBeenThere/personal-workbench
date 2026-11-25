import { makeDemoContent } from "./demo-content.js";
import { parseLegacyBoard } from "./legacy-board.js";
import { createRemoteAdapters } from "../domain/remote-adapters.mjs";
import { cloudMode, createCloudWorkspace } from "./cloud-workspace.js";

export const statuses = ["未开始", "进行中", "等待中", "逾期", "已完成"];
export const assignees = ["本人", "Hermes", "Codex", "Workbuddy", "其他／自定义"];
const done = "已完成";
const storageKey = "personal-workbench:v1";
const copy = (value) => structuredClone(value);
const timestamp = () => new Date().toISOString();
const identifier = () => globalThis.crypto.randomUUID();
const localDay = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const get = (rows, id) => rows.find((row) => row.id === id);
const nameRequired = (value, label) => {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw new Error(`请填写${label}`);
  return name;
};

export const blankGuidance = () => ({ summary: "", prompt: "", references: [], version: 0, executedVersion: null });

function makeInitialState() {
  return {
    schemaVersion: 1, revision: 0, session: false,
    account: { displayName: "", email: "", avatar: "" },
    ...makeDemoContent(blankGuidance),
    completions: [], agentClaims: [],
    settings: {
      appearance: "cool", autoBackup: false,
      assistant: { name: "小助手", userName: "", avatar: "cool-female", style: "direct", customPrompt: "" },
      assistantMemory: [],
      model: { provider: "DeepSeek", status: "disconnected", model: "", search: false, thinking: false },
    },
  };
}

function loadState(storage, key) {
  const existing = storage?.getItem(key);
  if (!existing) return makeInitialState();
  try {
    const state = JSON.parse(existing);
    if (state.schemaVersion === 1 && Array.isArray(state.tasks)) return state;
  } catch {
    // A malformed local record can still be retained while the user imports a backup.
  }
  return makeInitialState();
}

function createStore(storage, key) {
  let state = loadState(storage, key);
  const subscribers = new Set();
  function notify() { subscribers.forEach((subscriber) => subscriber(copy(state))); }
  globalThis.addEventListener?.("storage", (event) => {
    if (event.key === key || event.key === null) {
      state = loadState(storage, key);
      notify();
    }
  });
  return {
    get: () => copy(state),
    update(edit) {
      if (storage?.getItem(key)) state = loadState(storage, key);
      const draft = copy(state);
      const result = edit(draft);
      draft.revision = state.revision + 1;
      storage?.setItem(key, JSON.stringify(draft));
      state = draft;
      if (draft.settings.autoBackup && storage) {
        try {
          const day = localDay();
          if (!storage.getItem(key + ":backup:" + day)) {
            storage.setItem(key + ":backup:" + day, JSON.stringify(exportData(draft)));
          }
        } catch {
          // The authoritative local state has already been committed.
        }
      }
      notify();
      return copy(result);
    },
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
  };
}

function themeName(state, id) { return get(state.themes, id)?.name || "未归类项目"; }
function recordCompletion(state, item, kind) {
  state.completions ||= [];
  state.completions.push({
    id: identifier(), itemId: item.id, kind, title: item.title || item.name,
    at: item.completedAt, themeName: kind === "theme" ? item.name : themeName(state, item.themeId),
    parentId: item.parentId || null,
  });
}
function revokeCompletion(state, id) {
  const latest = state.completions?.findLast((entry) => entry.itemId === id && !entry.revokedAt);
  if (latest) latest.revokedAt = timestamp();
}

function synchronizeParent(state, id) {
  const parent = get(state.tasks, id);
  if (!parent) return;
  const children = state.tasks.filter((task) => task.parentId === id);
  const allDone = children.length > 0 && children.every((task) => task.status === done);
  if (allDone && parent.status !== done) {
    parent.status = done;
    parent.completedAt = timestamp();
    parent.autoCompleted = true;
    recordCompletion(state, parent, "task1");
  } else if (!allDone && parent.status === done && (children.length > 0 || parent.autoCompleted)) {
    revokeCompletion(state, parent.id);
    parent.status = "进行中";
    parent.completedAt = null;
    parent.autoCompleted = false;
  }
}

function removeTask(state, id) {
  const removed = get(state.tasks, id);
  state.tasks = state.tasks.filter((item) => item.id !== id);
  for (const task of state.tasks) {
    if (task.parentId === id) task.parentId = null;
    task.prerequisites = (task.prerequisites || []).filter((key) => key !== id);
  }
  revokeCompletion(state, id);
  if (removed?.parentId) synchronizeParent(state, removed.parentId);
}

function summarize(text) {
  return text.trim().split(/[。！？\n]/)[0].slice(0, 42);
}

function normalizeGuidance(previous, input) {
  const source = input || {};
  const prior = previous || blankGuidance();
  const prompt = String(source.prompt || "").trim();
  const summary = String(source.summary || "").trim() || summarize(prompt);
  const references = (source.references || []).map((ref) => ({ name: String(ref.name || ""), url: String(ref.url || "") }));
  const sanitized = { summary, prompt, references };
  const changed = JSON.stringify(sanitized) !== JSON.stringify({
    summary: prior.summary || "", prompt: prior.prompt || "", references: prior.references || [],
  });
  return {
    ...sanitized, version: (prior.version || 0) + Number(changed),
    executedVersion: prior.executedVersion ?? null,
  };
}

function mergeUpdates(previous = [], incoming = []) {
  const byId = new Map(previous.map((entry) => [entry.id, entry]));
  for (const entry of incoming) if (!byId.has(entry.id)) byId.set(entry.id, entry);
  return [...byId.values()];
}

function validateTask(state, task, previous) {
  if (!statuses.includes(task.status)) throw new Error("任务状态无效");
  if (task.themeId && !get(state.themes, task.themeId)) throw new Error("请选择有效的主题");
  const parent = get(state.tasks, task.parentId);
  if (task.parentId && (!parent || parent.id === task.id || parent.parentId || parent.themeId !== task.themeId)) {
    throw new Error("上级必须是该主题下的一级任务");
  }
  const children = state.tasks.filter((item) => item.parentId === task.id);
  if (children.length && task.parentId) throw new Error("有下级任务时不能改为二级任务");
  if (previous && task.themeId !== previous.themeId && children.length) {
    children.forEach((item) => { item.themeId = task.themeId; });
  }
  const dependencies = new Map(state.tasks.map((item) => [item.id, item.prerequisites || []]));
  const pending = [...task.prerequisites];
  const visited = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (id === task.id) throw new Error("前置任务不能形成循环");
    if (!dependencies.has(id)) throw new Error("前置任务不存在");
    if (!visited.has(id)) pending.push(...dependencies.get(id));
    visited.add(id);
  }
}

function saveTask(store, input, { confirm = false } = {}) {
  const snapshot = store.get();
  const existing = get(snapshot.tasks, input.id);
  const sourceIdeaId = !input.id ? input.ideaId : null;
  if (sourceIdeaId) {
    const converted = snapshot.tasks.find(task => task.ideaId === sourceIdeaId);
    if (converted && !get(snapshot.ideas, sourceIdeaId)) return { ok: true, item: converted, alreadyExists: true };
    if (converted) throw new Error("这条灵感已关联到现有任务，请查看已转换的任务。");
  }
  const affected = snapshot.tasks.filter((t) => t.parentId && t.parentId === input.id && t.status !== done);
  if (input.status === done && existing?.status !== done && !confirm) return { ok: false, code: "CONFIRM_REQUIRED", affected };
  return store.update((state) => {
    const previous = get(state.tasks, input.id);
    const source = sourceIdeaId && get(state.ideas, sourceIdeaId);
    if (sourceIdeaId && !source) throw new Error("原灵感已不存在，无法转换。");
    const task = {
      ...previous, ...input,
      id: input.id || identifier(), title: nameRequired(input.title ?? source?.title, "任务名称"),
      parentId: input.parentId || null, themeId: input.themeId || null, description: input.description ?? source?.body ?? "",
      status: input.status || "未开始", due: input.due || "", assignee: input.assignee || "本人",
      priority: Boolean(input.priority), prerequisites: [...new Set(input.prerequisites || [])],
      updates: mergeUpdates(previous?.updates, input.updates),
      guidance: normalizeGuidance(previous?.guidance, input.guidance || previous?.guidance),
      completedAt: previous?.completedAt || null,
    };
    validateTask(state, task, previous);
    if (task.status === done && previous?.status !== done) {
      state.tasks.filter((item) => item.parentId === task.id && item.status !== done)
        .forEach((item) => { item.parentId = null; });
      task.completedAt = timestamp();
      task.autoCompleted = false;
      recordCompletion(state, task, task.parentId ? "task2" : "task1");
    } else if (task.status !== done && previous?.status === done) {
      task.completedAt = null;
      task.autoCompleted = false;
      revokeCompletion(state, task.id);
      const parent = get(state.tasks, task.parentId);
      if (parent?.status === done) {
        revokeCompletion(state, parent.id);
        parent.status = "进行中";
        parent.completedAt = null;
        parent.autoCompleted = false;
      }
    }
    const index = state.tasks.findIndex((item) => item.id === task.id);
    if (index === -1) state.tasks.push(task);
    else state.tasks[index] = task;
    if (task.parentId) synchronizeParent(state, task.parentId);
    if (previous?.parentId && previous.parentId !== task.parentId) synchronizeParent(state, previous.parentId);
    if (source) state.ideas = state.ideas.filter(idea => idea.id !== sourceIdeaId);
    return { ok: true, item: task };
  });
}

function saveTheme(store, input, { confirm = false } = {}) {
  const snapshot = store.get();
  if (input.status === done && get(snapshot.themes, input.id)?.status !== done && !confirm) {
    return { ok: false, code: "CONFIRM_REQUIRED",
      affected: snapshot.tasks.filter((item) => item.themeId === input.id && item.status !== done) };
  }
  return store.update((state) => {
    const previous = get(state.themes, input.id);
    const theme = { ...previous, ...input, id: input.id || identifier(),
      name: nameRequired(input.name, "主题名称"), groupId: input.groupId || null, status: input.status || "进行中" };
    if (theme.groupId && !get(state.groups, theme.groupId)) throw new Error("请选择有效的分组");
    if (theme.status === done && previous?.status !== done) {
      const tasks = state.tasks.filter((item) => item.themeId === theme.id);
      const roots = new Set(tasks.filter((item) => !item.parentId && item.status !== done).map((item) => item.id));
      for (const task of tasks) {
        if (roots.has(task.id) || roots.has(task.parentId)) task.themeId = null;
        else if (task.status !== done) { task.themeId = null; task.parentId = null; }
      }
      theme.completedAt = timestamp();
      recordCompletion(state, theme, "theme");
    } else if (theme.status !== done && previous?.status === done) {
      theme.completedAt = null;
      revokeCompletion(state, theme.id);
    }
    const index = state.themes.findIndex((item) => item.id === theme.id);
    if (index === -1) state.themes.push(theme);
    else state.themes[index] = theme;
    return { ok: true, item: theme };
  });
}

function recommend(state) {
  const tasks = new Map(state.tasks.map((task) => [task.id, task]));
  const order = (a, b) => Number(Boolean(b.priority)) - Number(Boolean(a.priority))
    || (a.due || "9999").localeCompare(b.due || "9999");
  const selected = new Map();
  function consider(task, visiting = new Set()) {
    if (!task || task.status === done || visiting.has(task.id)) return;
    const blocked = (task.prerequisites || []).map((id) => tasks.get(id)).filter((item) => item && item.status !== done);
    if (blocked.length) {
      const next = new Set(visiting).add(task.id);
      blocked.sort(order).forEach((item) => consider(item, next));
    } else if (selected.size < 5) selected.set(task.id, task);
  }
  [...tasks.values()].sort(order).forEach((task) => consider(task));
  return [...selected.values()];
}

function exportData(state) {
  return {
    schemaVersion: 1, exportedAt: timestamp(), groups: state.groups, themes: state.themes,
    tasks: state.tasks, ideas: state.ideas, completions: state.completions || [],
  };
}

function validateBackup(data) {
  if (!data || data.schemaVersion !== 1) throw new Error("备份格式或版本不正确");
  for (const key of ["groups", "themes", "tasks", "ideas", "completions"]) {
    if (!Array.isArray(data[key])) throw new Error(`备份缺少 ${key}`);
    if (new Set(data[key].map((item) => item?.id)).size !== data[key].length
      || data[key].some((item) => typeof item?.id !== "string" || !item.id)) throw new Error("备份中有无效或重复的记录");
  }
  data.groups.forEach((entry) => nameRequired(entry.name, "分组名称"));
  data.themes.forEach((entry) => {
    nameRequired(entry.name, "主题名称");
    if (entry.groupId && !get(data.groups, entry.groupId)) throw new Error("主题的分组不存在");
  });
  data.tasks.forEach((entry) => {
    nameRequired(entry.title, "任务名称");
    if (entry.prerequisites != null && !Array.isArray(entry.prerequisites)) throw new Error("前置任务格式无效");
    validateTask(data, { ...entry, prerequisites: entry.prerequisites || [] }, null);
  });
  return data;
}

export function createApi({ storage = globalThis.localStorage, key = storageKey, store = createStore(storage, key) } = {}) {
  return {
    store, createRemoteAdapters,
    tasks: {
      save: (task, options) => saveTask(store, task, options),
      remove: (id) => store.update((state) => removeTask(state, id)),
      convertToIdea(id, { title, description }) {
        return store.update((state) => {
          if (!get(state.tasks, id)) throw new Error("找不到要归入灵感池的任务。");
          const idea = { id: identifier(), title: nameRequired(title, "任务名称"), body: description ?? "" };
          state.ideas.unshift(idea);
          removeTask(state, id);
          return idea;
        });
      },
      recommend: () => recommend(store.get()),
    },
    themes: {
      save: (theme, options) => saveTheme(store, theme, options),
      remove(id) {
        return store.update((state) => {
          state.themes = state.themes.filter((item) => item.id !== id);
          state.tasks.filter((task) => task.themeId === id).forEach((task) => { task.themeId = null; });
          revokeCompletion(state, id);
        });
      },
    },
    backup: {
      export: () => JSON.stringify(exportData(store.get()), null, 2),
      import(json) {
        const data = validateBackup(typeof json === "string" ? JSON.parse(json) : copy(json));
        return store.update((state) => {
          for (const key of ["groups", "themes", "tasks", "ideas", "completions"]) state[key] = data[key];
          state.agentClaims = [];
          return { tasks: state.tasks.length, ideas: state.ideas.length };
        });
      },
      importLegacyHtml(html) { return this.import(parseLegacyBoard(html)); },
    },
  };
}

export const cloudWorkspace = cloudMode ? createCloudWorkspace(makeInitialState()) : null;
export const api = createApi({ store: cloudWorkspace?.store });
