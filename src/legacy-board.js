const read = (element) => element?.textContent.trim() || "";
const legacyKey = (part, index) => `legacy-${part}-${index + 1}`;

/** Read the old export as inert markup. The template is never mounted in the document. */
export function parseLegacyBoard(html, document = globalThis.document) {
  if (typeof html !== "string" || html.length > 2_000_000 || !document) throw new Error("无法读取旧版待办文件");
  const template = document.createElement("template");
  template.innerHTML = html;
  const root = template.content;
  const cards = [...root.querySelectorAll("div.card")];
  if (!root.querySelector(".layer") || !cards.length) throw new Error("文件不是已知的旧版待办清单");
  const groups = [];
  const themes = [];
  const tasks = [];
  const focusCodes = new Set([...root.querySelectorAll(".focus .tk b")].map(read));
  const focusTitles = new Set([...root.querySelectorAll(".focus .tk")].map((row) => {
    const text = read(row);
    return row.querySelector("b") ? text.slice(read(row.querySelector("b")).length).trim() : text;
  }));

  function task(title, description = "", code = "", status = "未开始") {
    const row = {
      id: legacyKey("task", tasks.length), title, description,
      themeId, parentId: null, due: "", status, assignee: "本人",
      priority: focusCodes.has(code) || focusTitles.has(title),
      prerequisites: [], updates: [],
      guidance: { summary: "", prompt: "", references: [], version: 0, executedVersion: null },
      completedAt: null,
    };
    tasks.push(row);
    return row;
  }

  let groupId = null;
  let themeId = null;
  let parentId = null;
  for (const node of root.querySelectorAll("div.layer, h2, h3, div.card")) {
    if (node.closest(".focus")) continue;
    if (node.classList.contains("layer")) {
      const original = read(node);
      if (original === "未归类") { groupId = null; continue; }
      const name = original === "项目主题" ? "业务主题" : original;
      let group = groups.find((item) => item.name === name);
      if (!group) {
        group = { id: legacyKey("group", groups.length), name };
        groups.push(group);
      }
      groupId = group.id;
    } else if (node.tagName === "H2") {
      parentId = null;
      const name = read(node);
      if (name === "其他" || name === "没挂到看板上的待办") {
        themeId = null;
        continue;
      }
      themeId = legacyKey("theme", themes.length);
      themes.push({ id: themeId, groupId, name, priority: false, status: "进行中" });
    } else if (node.tagName === "H3") {
      const title = [...node.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
      if (title) parentId = task(title).id;
    } else {
      const title = read(node.querySelector(".row .t"));
      if (!title) continue;
      const description = read(node.querySelector(".d"));
      const sourceState = read(node.querySelector(".pill"));
      const status = /推进中|进行中/.test(sourceState) ? "进行中" : "未开始";
      const row = task(title, description, read(node.querySelector(".num")), status);
      row.parentId = parentId;
      if (sourceState && !["待办", "进行中"].includes(sourceState)) row.legacyStatus = sourceState;
    }
  }
  const activeParents = new Set(tasks.filter((item) => item.parentId && item.status === "进行中").map((item) => item.parentId));
  for (const item of tasks) if (activeParents.has(item.id)) item.status = "进行中";
  if (!themes.length || !tasks.length) throw new Error("旧文件内没有可导入的主题和任务");
  return { schemaVersion: 1, groups, themes, tasks, ideas: [], completions: [] };
}
