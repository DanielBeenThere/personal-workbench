export const taskReminderGuidance = "对于所有设有计划完成时间的未完成任务，在到期前一个月、到期前一周、到期前3天、到期前1天和到期当天分别触发一次提醒。";

const dayMs = 24 * 60 * 60 * 1000;
const shanghaiOffsetMs = 8 * 60 * 60 * 1000;
const reminderDays = [
  [7, "一周后到期"], [3, "3 天后到期"], [1, "明天到期"], [0, "今天到期"],
];

export function reminderTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("提醒时间无效。");
  return date.toISOString();
}

function reminderSchedule(due) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return [];
  const date = new Date(due + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== due) return [];
  const dayOfMonth = date.getUTCDate();
  const previousMonthEnd = new Date(date);
  previousMonthEnd.setUTCDate(0);
  const earlier = previousMonthEnd.setUTCDate(Math.min(dayOfMonth, previousMonthEnd.getUTCDate()));
  const midnight = date.getTime() - shanghaiOffsetMs;
  return [
    [earlier - shanghaiOffsetMs, "一个月后到期"],
    ...reminderDays.map(([days, label]) => [midnight - days * dayMs, label]),
  ];
}

export function dueReminders(state, now = Date.now()) {
  if (!state.session) return [];
  const seen = new Set(state.settings.readReminders || []);
  const startOfToday = Math.floor((now + shanghaiOffsetMs) / dayMs) * dayMs - shanghaiOffsetMs;
  return state.tasks
    .filter(task => task.status !== "已完成")
    .flatMap(task => {
      const notices = [];
      for (const [at, label] of reminderSchedule(task.due)) {
        const id = `${task.id}@due:${task.due}:${at}`;
        if (at <= now && (at >= startOfToday || seen.has(id))) {
          notices.push({ id, unread: !seen.has(id), at, text: `任务提醒：「${task.title}」${label}。` });
        }
      }
      const at = Date.parse(task.remindAt);
      if (at <= now) {
        const id = task.id + "@" + task.remindAt;
        notices.push({ id, unread: !seen.has(id), at, text: `任务提醒：「${task.title}」到提醒时间了。` });
      }
      return notices;
    })
    .sort((a, b) => a.at - b.at);
}

export function markRemindersRead(api, notices, now = Date.now()) {
  if (!notices.some(notice => notice.unread)) return;
  api.store.update(state => {
    const due = new Set(dueReminders(state, now).map(notice => notice.id));
    state.settings.readReminders = [...new Set([...(state.settings.readReminders || []), ...notices.map(notice => notice.id)])]
      .filter(id => due.has(id));
  });
}
