const maxLength = 1800;
const maxEntries = 18;
const heading = "# 小助手长期记忆";

export function memoryMarkdown(settings) {
  const entries = settings.assistantMemory || [];
  return [heading, "", ...entries.map(item => `- ${item.topic}：${item.preference}`), ""].join("\n");
}

export function updateAssistantMemory(api, { action, topic, preference, important }) {
  topic = typeof topic === "string" ? topic.trim().replace(/\s+/g, " ") : "";
  if (topic.length < 2 || topic.length > 32) throw new Error("记忆主题须为 2 至 32 个字符。");
  if (!["remember", "forget", "used"].includes(action)) throw new Error("记忆操作无效。");
  preference = typeof preference === "string" ? preference.trim().replace(/\s+/g, " ") : "";
  if (action === "remember" && (!preference || preference.length > 180 ||
      /API\s*Key|访问令牌|密码|验证码|Bearer\s|\bsk-[\w-]{8,}|-----BEGIN/i.test(topic + " " + preference))) {
    throw new Error("请用 1 至 180 个字符概括偏好，记忆里不能存放密钥、密码等凭据。");
  }
  return api.store.update(state => {
    if (!state.session || !state.account.email) throw new Error("请先登录。");
    const entries = state.settings.assistantMemory ||= [];
    const index = entries.findIndex(item => item.topic.toLowerCase() === topic.toLowerCase());
    const prior = entries[index];
    if (action === "forget") {
      if (prior) entries.splice(index, 1);
      return { ok: true, removed: Boolean(prior) };
    }
    if (action === "used") {
      if (!prior) return { ok: false, error: "这条记忆已不存在。" };
      prior.uses = (prior.uses || 0) + 1;
      prior.lastUsed = Date.now();
      return { ok: true };
    }
    const item = { topic, preference, important: important === true || prior?.important === true,
      uses: prior?.uses || 0, lastUsed: Date.now() };
    if (prior) entries[index] = item;
    else entries.push(item);
    while (entries.length > maxEntries || memoryMarkdown(state.settings).length > maxLength) {
      const oldest = entries.filter(entry => entry !== item).sort((a, b) =>
        Number(a.important) - Number(b.important) || a.uses - b.uses || a.lastUsed - b.lastUsed)[0];
      entries.splice(entries.indexOf(oldest), 1);
    }
    return { ok: true, topic, preference };
  });
}
