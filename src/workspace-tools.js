import { updateAssistantMemory } from "./assistant-memory.js";
import { reminderTime } from "./task-reminders.js";

const fields = {
  tasks: ["title", "description", "themeId", "parentId", "status", "due", "remindAt", "assignee", "priority", "prerequisites", "progress", "guidanceSummary", "guidancePrompt", "sourceIdeaId"],
  themes: ["name", "groupId", "status", "priority"],
  groups: ["name"],
  ideas: ["title", "body"],
};

const entities = Object.keys(fields);

export const hasWorkspaceControl = text =>
  /WORKBENCH_ACTION|<\/?result\b|<[^<>\n]*\bDSML\b|"(?:requested_operations|tool_call_id)"\s*:|"(?:name|tool)"\s*:\s*"(?:read_workspace|change_workspace|assistant_memory)"\s*[,}]/i.test(text);

const exists = (values, id) => values.some(item => item.id === id);
const label = item => item.title || item.name || "";
const summary = item => Object.fromEntries(Object.entries(item).filter(([key]) =>
  ["id", "title", "name", "status", "themeId", "groupId", "parentId", "due", "remindAt", "assignee", "priority", "at", "kind"].includes(key)));

const normalizedName = value => value.normalize("NFKC").toLowerCase().replace(/[\p{P}\s]/gu, "");

function similarName(left, right) {
  const length = Math.max(left.length, right.length);
  if (Math.abs(left.length - right.length) > Math.floor(length / 5)) return false;
  let distances = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < right.length; j++) {
      next.push(Math.min(next[j] + 1, distances[j + 1] + 1, distances[j] + Number(left[i] !== right[j])));
    }
    distances = next;
  }
  return distances[right.length] <= Math.floor(length / 5);
}

function read(state, { entity, query, id, offset, themeId, nameOnly }) {
  if (entity === "tasks" && themeId && !exists(state.themes, themeId)) throw new Error("找不到这个主题，请先查询主题。");
  const records = entity === "tasks" && themeId ? state.tasks.filter(task => task.themeId === themeId) : state[entity] || [];
  if (id) {
    const item = records.find(entry => entry.id === id);
    if (!item) throw new Error("找不到该记录。");
    return { ...summary(item), description: item.description?.slice(0, 1000), body: item.body?.slice(0, 1000),
      prerequisites: item.prerequisites, updates: item.updates?.slice(-5).map(({ at, body }) => ({ at, body: body?.slice(0, 200) })),
      guidance: item.guidance ? { summary: item.guidance.summary?.slice(0, 250), prompt: item.guidance.prompt?.slice(0, 1500) } : undefined };
  }
  const keyword = typeof query === "string" ? query.trim().toLowerCase() : "";
  const target = nameOnly ? normalizedName(keyword) : "";
  let matches;
  if (target) {
    matches = records.filter(item => normalizedName(label(item)) === target);
    if (!matches.length) matches = records.filter(item => similarName(target, normalizedName(label(item))));
  } else {
    matches = records.filter(item => !keyword || [label(item), item.body, item.description].some(value => value?.toLowerCase().includes(keyword)));
  }
  const start = Number.isSafeInteger(offset) ? Math.max(0, offset) : 0;
  const size = entity === "tasks" && themeId ? 24 : 12;
  return { total: matches.length, offset: start, nextOffset: start + size < matches.length ? start + size : null,
    records: matches.slice(start, start + size).map(summary) };
}

function validatedFields(state, entity, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("请提供要保存的字段。");
  for (const [key, value] of Object.entries(input)) {
    if (!fields[entity].includes(key)) throw new Error("该字段不支持助手修改。");
    const valid = key === "priority" ? typeof value === "boolean"
      : key === "prerequisites" ? Array.isArray(value) && value.every(id => typeof id === "string")
      : (key.endsWith("Id") && value === null) || (typeof value === "string" && value.length <= 4000);
    if (!valid) throw new Error("字段值格式无效。");
  }
  if (input.groupId && !exists(state.groups, input.groupId)) throw new Error("分组不存在。");
  if (input.due && !/^\d{4}-\d{2}-\d{2}$/.test(input.due)) throw new Error("日期应为 YYYY-MM-DD。");
  if (entity === "themes" && input.status && !["进行中", "已完成"].includes(input.status)) throw new Error("主题状态无效。");
  return input;
}

export async function runWorkspaceTool(api, name, args, requestConfirmation) {
  const state = api.store.get();
  if (!state.session) throw new Error("请先登录。");
  if (name === "assistant_memory") return updateAssistantMemory(api, args || {});
  const { entity, action, id } = args || {};
  if (name === "read_workspace" && [...entities, "completions"].includes(entity)) return read(state, args);
  if (name !== "change_workspace" || !entities.includes(entity) || !["create", "update", "delete", "convert_to_idea"].includes(action)) {
    throw new Error("不支持该工作台操作。");
  }
  const previous = state[entity].find(item => item.id === id);
  if (action !== "create" && !previous) throw new Error("找不到要修改的记录，请先查询。");
  if (action === "convert_to_idea") {
    if (entity !== "tasks") throw new Error("只能把任务归入灵感池。");
    const children = state.tasks.filter(task => task.parentId === id && task.status !== "已完成");
    const note = children.length ? " 未完成的二级任务将升为一级任务。" : "";
    return requestConfirmation(`将「${previous.title}」归入灵感池并移除原任务？${note}`, () => {
      const current = api.store.get().tasks.find(task => task.id === id);
      if (!current) throw new Error("原任务已不存在。");
      const idea = api.tasks.convertToIdea(id, current);
      return `已归入灵感池「${idea.title}」。`;
    });
  }
  if (action === "delete") {
    return requestConfirmation(`删除「${label(previous)}」？`, async () => {
      if (!exists(api.store.get()[entity], id)) throw new Error("该记录已不存在。");
      if (api[entity]?.remove) await api[entity].remove(id);
      else api.store.update(data => {
        data[entity] = data[entity].filter(item => item.id !== id);
        if (entity === "groups") for (const theme of data.themes) if (theme.groupId === id) theme.groupId = null;
      });
      return "已删除。";
    });
  }
  const { progress, guidanceSummary, guidancePrompt, sourceIdeaId, ...patch } = validatedFields(state, entity, args.fields);
  const item = { ...(action === "update" ? previous : {}), ...patch };
  if (sourceIdeaId) {
    if (entity !== "tasks" || action !== "create") throw new Error("原灵感只能用于创建任务。");
    item.ideaId = sourceIdeaId;
  }
  if (patch.remindAt !== undefined) {
    if (patch.remindAt && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(patch.remindAt)) throw new Error("请先确认带时区的完整提醒时间。");
    item.remindAt = reminderTime(patch.remindAt);
  }
  if (progress?.trim()) item.updates = [{ id: crypto.randomUUID(), at: new Date().toISOString(), author: "小助手", body: progress.trim() }];
  if (guidanceSummary !== undefined || guidancePrompt !== undefined) {
    item.guidance = { ...previous?.guidance, ...(guidanceSummary !== undefined && { summary: guidanceSummary }),
      ...(guidancePrompt !== undefined && { prompt: guidancePrompt }) };
  }
  if (api[entity]?.save) {
    const result = await api[entity].save(item);
    if (result.code === "CONFIRM_REQUIRED") {
      const children = result.affected.map(label).join("、");
      return requestConfirmation(`完成「${label(item)}」？${children ? "以下未完成任务将重新归属：" + children : ""}`, async () => {
        if (item.id && !exists(api.store.get()[entity], item.id)) throw new Error("该记录已不存在。");
        const confirmed = await api[entity].save(item, { confirm: true });
        if (!confirmed.ok) throw new Error("保存失败。");
        return "已标记完成。";
      });
    }
    if (!result.ok) throw new Error(result.message || "保存失败。");
    return { ok: true, record: summary(result.item), ...(result.alreadyExists && { alreadyExists: true }) };
  }
  const titleField = entity === "groups" ? "name" : "title";
  item[titleField] = item[titleField]?.trim() || (entity === "ideas" ? item.body?.trim().slice(0, 32) : "");
  if (!item[titleField]) throw new Error("请填写名称。");
  if (action === "create") item.id = crypto.randomUUID();
  api.store.update(data => {
    if (action === "create") data[entity].push(item);
    else Object.assign(data[entity].find(entry => entry.id === id), item);
  });
  return { ok: true, record: summary(item) };
}
