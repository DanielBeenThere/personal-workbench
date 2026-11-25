export function searchWorkspace({ themes, tasks, ideas }, keyword) {
  const query = keyword.trim();
  if (!query) return [];
  const literal = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(literal, "iu");
  const highlight = new RegExp(`(${literal})`, "giu");
  const split = text => text.split(highlight);
  const themesById = new Map(themes.map(theme => [theme.id, theme]));
  const tasksById = new Map(tasks.map(task => [task.id, task]));
  const groups = [
    { label: "战略主题", results: [] },
    { label: "一级任务", results: [] },
    { label: "二级任务", results: [] },
    { label: "灵感", results: [] },
  ];

  function add(group, { id, title, action, path, content = [] }) {
    title = typeof title === "string" ? title : "";
    const titleMatch = match.test(title);
    if (!titleMatch) {
      for (const line of content) {
        if (typeof line !== "string" || !line) continue;
        const text = line.replace(/\s+/g, " ");
        const hit = match.exec(text);
        if (!hit) continue;
        const start = Math.max(0, hit.index - 18);
        const end = Math.min(text.length, hit.index + hit[0].length + 26);
        const snippet = (start ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
        groups[group].results.push({ id, title: [title], action, path, snippet: split(snippet), titleMatch });
        break;
      }
      return;
    }
    groups[group].results.push({ id, title: split(title), action, path, titleMatch });
  }

  for (const theme of themes) {
    add(0, { id: theme.id, title: theme.name, action: theme.status === "已完成" ? "edit-theme" : "search-theme" });
  }
  for (const task of tasks) {
    const parent = tasksById.get(task.parentId);
    const theme = themesById.get(task.themeId)?.name || "未归类项目";
    add(task.parentId ? 2 : 1, {
      id: task.id, title: task.title, action: "edit-task", path: [theme, parent?.title].filter(Boolean).join(" / "),
      content: [task.description, ...(task.updates || []).map(update => update.body), task.guidance?.summary, task.guidance?.prompt],
    });
  }
  for (const idea of ideas) add(3, { id: idea.id, title: idea.title, action: "idea-open", content: [idea.body] });

  return groups.filter(group => group.results.length).map(group => ({
    ...group, results: group.results.sort((a, b) => Number(b.titleMatch) - Number(a.titleMatch)),
  }));
}
