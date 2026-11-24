import {api,cloudWorkspace,assignees as people} from './domain.js';
import {authView, settingsView, ideaView, chatView, settingsAction, bindVoice} from './settings.js';

const app = document.querySelector('#app');
const state = () => api.store.get();
const makeId = () => crypto.randomUUID();
const nav = [['today','今日重点'],['themes','任务清单'],['ideas','灵感池'],['done','已完成']];
const statuses = ['未开始','进行中','等待中','逾期','已完成'];
const customAssignee = '其他／自定义';
const ui = {
  page:'today', section:'', themeId:null, mobileTree:false, sidebar:false, collapsed:false, defaultTheme:false,
  editingThemes:false, expanded:new Set(), dialog:null, doneTab:'details', historyDays:14, chartDays:11,
  toast:'', chat:null, authMode:'login', authMessage:'', captcha:'', authChallenge:false
};
const esc = (value='') => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icon = name => ({menu:'<span class="menu-lines" aria-hidden="true"></span>',chevron:'<span class="chevron" aria-hidden="true"></span>',star:'<span class="star" aria-hidden="true">★</span>'}[name] || '');
const button = (text,action,cls='',attributes='') => `<button type="button" class="button ${cls}" data-action="${action}" ${attributes}>${text}</button>`;
const primary = text => `<button class="button primary" type="submit">${text}</button>`;
const field = (label,name,value='',type='text',attrs='') => `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
const dateField = value => `<label class="field"><span id="task-due-label">计划完成时间</span><span class="date-control ${value?'':'date-empty'}"><input name="due" type="date" aria-labelledby="task-due-label" value="${esc(value)}"><span class="date-hint" aria-hidden="true">选择日期${icon('chevron')}</span></span></label>`;
const area = (label,name,value='',attrs='') => `<label class="field"><span>${label}</span><textarea name="${name}" ${attrs}>${esc(value)}</textarea></label>`;
const option = (val,text,current,disabled=false) => `<option value="${esc(val)}" ${String(val)===String(current)?'selected':''} ${disabled?'disabled':''}>${esc(text)}</option>`;
const select = (label,name,options) => `<label class="field"><span>${label}</span><select name="${name}">${options}</select></label>`;
const taskSelect = (label,name,value,options) => `<div class="field dropdown"><label id="field-${name}" for="trigger-${name}">${label}</label><select name="${name}" hidden aria-hidden="true" tabindex="-1">${options}</select><button id="trigger-${name}" class="dropdown-trigger" type="button" data-action="open-options" aria-labelledby="field-${name}" aria-haspopup="listbox" aria-expanded="false"><span>${esc(value)}</span>${icon('chevron')}</button></div>`;
const checkbox = (label,name,checked) => `<label class="check ${checked?'checked':''}"><input type="checkbox" name="${name}" ${checked?'checked':''}>${label}</label>`;
const avatar = (name,size='') => `<img class="avatar ${size}" src="./assets/avatar-${/^(cool|warm)-(male|female)$/.test(name)?name:'cool-female'}.png" alt="" draggable="false">`;
const prettyDate = value => {const date = new Date(value);return isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(date).replace(/月|日/g, '/').replace('/ ', ' ');};
const safeURL = value => {try {const url = new URL(value); return ['http:','https:'].includes(url.protocol) ? esc(url.href) : '';} catch {return '';}};
const sidebarButton = (extra='',label='切换侧栏') => button(icon('menu'),'sidebar',`icon-button sidebar-toggle ${extra}`,`aria-label="${label}"`);
const toolbar = (title,back='') => `<header class="page-header"><div class="page-heading">${sidebarButton()}<h1>${title}</h1>${back?button('‹ '+back,'back','text-button page-back'):''}</div></header>`;
const empty = text=>`<p class="empty">${text}</p>`;
const helpers = {ui,state,api,esc,button,primary,field,area,select,option,checkbox,avatar,toolbar,empty,safeURL,makeId,prettyDate};

function navBar(mobile=false) {
  const items=mobile?nav.slice(0,3):nav;
  const current=mobile&&ui.page==='done'?'themes':ui.page;
  return `<nav class="tabs main-tabs" aria-label="待办板块">${items.map(([name,label])=>button(label,'navigate',current===name?'selected':'',`data-value="${name}" ${current===name?'aria-current="page"':''}`)).join('')}</nav>`;
}

function accountAvatar() {
  const account = state().account;
  return account.avatar?.startsWith('data:image/') ? `<img alt="" class="avatar" src="${esc(account.avatar)}">` : `<span class="account-avatar">${esc((account.displayName||'D')[0])}</span>`;
}

function sidebar() {
  return `${ui.sidebar?'<button class="menu-shade" data-action="sidebar" aria-label="关闭侧栏"></button>':''}<aside class="sidebar ${ui.sidebar?'sidebar-open':''}">
    <h2>个人工作台</h2>${button('<span class="module-full">待办清单</span><span class="module-small">待办</span>','workbench','selected module')}
    <footer>${accountAvatar()}<strong>${esc(state().account.displayName||'Daniel')}</strong>${button('设置','settings','','aria-label="设置"')}</footer>
  </aside>`;
}

function taskItem(task,asPriority=false) {
  const children=state().tasks.filter(item=>item.parentId===task.id&&item.status!=='已完成');
  const status=task.status==='等待中'?'waiting':task.status==='逾期'?'overdue':'';
  return `<article class="task-card ${task.priority?'priority':''} ${asPriority?'today-card':''}">
   <div class="task-copy"><h3>${!task.parentId&&!asPriority?button(icon('chevron'),'expand',`icon-button disclosure ${ui.expanded.has(task.id)?'expanded':''}`,`data-id="${esc(task.id)}" aria-expanded="${ui.expanded.has(task.id)}" aria-label="展开或折叠任务"`):''}${task.priority?icon('star'):''}${esc(task.title)}</h3>
   <p>${asPriority?esc(task.description||state().themes.find(t=>t.id===task.themeId)?.name||'未归类'):`${task.parentId?'二级任务 · ':''}<span class="${status}">${esc(task.status)}</span>${children.length?' · 由下属任务自动汇总':''}${task.due?' · '+esc(task.due):''}`}</p></div>
   ${button(asPriority?'查看任务':'编辑','edit-task',task.priority?'soft':'',`data-id="${esc(task.id)}"`)}
  </article>`;
}
function today() {
  const list=api.tasks.recommend();
  return `${toolbar('今日重点')}<section class="today-list"><p>今天可以优先推进的事项</p>${list.map(task=>taskItem(task,true)).join('')||empty('暂无推荐任务。')}</section>`;
}

function themeList() {
  const {groups,themes}=state();
  const data=[...groups,{id:'',name:'未分组'}];
  return `<section class="theme-list card"><header><h2>战略主题</h2><div>${button('编辑分组','groups')}${button('编辑主题','theme-mode',ui.editingThemes?'selected':'')}</div></header>
  ${data.map(group=>{
    const items=themes.filter(theme=>theme.status!=='已完成'&&(theme.groupId||'')===group.id);
    return items.length?`<section class="topic-group"><h3>${esc(group.name)}</h3><div>${items.map(theme=>{
      const selected=theme.id===ui.themeId;
      const trailing=ui.editingThemes?'<span class="topic-edit-label">编辑</span>':`${selected?'<small>当前查看</small>':''}${icon('chevron')}`;
      return `<button class="topic-tile ${theme.priority?'priority':''} ${selected?'topic-selected':''}" data-action="${ui.editingThemes?'edit-theme':'open-theme'}" data-id="${esc(theme.id)}">${theme.priority?icon('star'):''}<span>${esc(theme.name)}</span>${trailing}</button>`;
    }).join('')}</div></section>`:'';
  }).join('')}
  <div class="theme-footer">${ui.editingThemes?button('新建主题','edit-theme','soft'):`${button('未归类项目','open-theme','','data-id=""')}${button('已完成','navigate','mobile-only','data-value="done"')}`}</div></section>`;
}

const sorted = list => [...list].sort((a,b)=>(a.due||'9999-12-31').localeCompare(b.due||'9999-12-31'));
function taskTree() {
  const theme=state().themes.find(item=>item.id===ui.themeId);
  const tasks=state().tasks.filter(item=>(item.themeId||null)===ui.themeId&&item.status!=='已完成');
  return `<section class="task-tree card ${theme?'linked-task-tree':''}"><header><h2>${esc(theme?.name||'未归类项目')}</h2><small>主题内任务</small>${button('新增一级任务','new-task','soft')}</header>
  ${sorted(tasks.filter(task=>!task.parentId)).map(task=>`<section class="tree-family">${taskItem(task)}${ui.expanded.has(task.id)?`<div class="tree-children">${sorted(tasks.filter(item=>item.parentId===task.id)).map(item=>taskItem(item)).join('')}${button('新增二级任务','new-task','',`data-parent="${esc(task.id)}"`)}</div>`:''}</section>`).join('')||empty('这个主题还没有任务。')}${button('已完成','navigate','mobile-only','data-value="done"')}</section>`;
}

function themes() {
  return `${toolbar(ui.mobileTree?esc(state().themes.find(t=>t.id===ui.themeId)?.name||'未归类项目'):'战略主题',ui.mobileTree?'战略主题':'')}<div class="theme-layout ${ui.mobileTree?'show-tree':''}">${themeList()}${taskTree()}</div>`;
}

function history() {
  const data=state();
  const rows=data.completions.filter(entry=>!entry.revokedAt).map(entry=>({
    id:entry.itemId, label:entry.title, type:{theme:'theme',task1:'root',task2:'child'}[entry.kind], completedAt:entry.at
  }));
  const iso=value=>{const d=new Date(value); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const groups=rows.sort((a,b)=>String(b.completedAt).localeCompare(String(a.completedAt))).reduce((result,record)=>{
    (result[iso(record.completedAt)]??=[]).push(record);return result;
  },{});
  const days=Object.keys(groups);
  const latest=new Date(Math.max(Date.now(),...rows.map(row=>new Date(row.completedAt).valueOf())));
  const oldest=days.at(-1);
  const allowance=Math.max(4,...Object.values(groups).map(items=>items.length));
  const tickStep=Math.max(1, Math.ceil(allowance/6));
  const scale=Math.ceil(allowance/tickStep)*tickStep;
  const ticks=Array.from({length:scale/tickStep+1},(_,i)=>`<span>${i*tickStep}</span>`).join('');
  const details=days.slice(0,ui.historyDays).map(day=>`<section class="date-group"><h3>${day.replace(/-/g,' / ')} <small>${groups[day].length} 项</small></h3>${groups[day].map(row=>button(`<time>${new Date(row.completedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time>${row.type==='theme'?icon('star'):''}<span>${esc(row.label)}</span>${icon('chevron')}`,row.type==='theme'?'edit-theme':'edit-task',`history-row ${row.type}`,`data-id="${esc(row.id)}"`)).join('')}</section>`).join('');
  const chart=Array.from({length:ui.chartDays},(_,index)=>{
    const d=new Date(latest);d.setDate(d.getDate()-index); const key=iso(d); const items=groups[key]||[];
    const counts=['theme','root','child'].map(type=>items.filter(entry=>entry.type===type).length);
    const monthStart=index>0&&d.getDate()===new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
    return `${monthStart?`<h3 class="chart-month">${d.getFullYear()} 年 ${d.getMonth()+1} 月</h3>`:''}<div class="chart-row" style="--tick-length:${tickStep/scale*100}%"><time datetime="${key}">${key.slice(5).replace('-','/')}</time><div class="bar" role="img" aria-label="主题 ${counts[0]}，一级任务 ${counts[1]}，二级任务 ${counts[2]}，合计 ${items.length}">${['theme','root','child'].map((type,j)=>`<i class="${type}" style="width:${counts[j]/scale*100}%"></i>`).join('')}<span class="bar-total" aria-hidden="true">${items.length}</span></div></div>`;
  }).join('');
  return `${toolbar('已完成','战略主题')}<section class="history"><div class="tabs">${button('明细','history-tab',ui.doneTab==='details'?'selected':'','data-value="details"')}${button('统计','history-tab',ui.doneTab==='chart'?'selected':'','data-value="chart"')}</div>
  ${ui.doneTab==='details'?details||empty('暂无已完成任务。'):`<h3 class="chart-month">${latest.getMonth()+1} 月</h3><div class="legend"><span>战略主题</span><span>一级任务</span><span>二级任务</span></div><div class="history-chart">${chart}<div class="chart-row"><span></span><div class="chart-ticks">${ticks}</div></div><div class="chart-axis">完成数量（项）</div></div>`}
  ${(ui.doneTab==='chart' ? oldest&&iso(new Date(latest.getFullYear(),latest.getMonth(),latest.getDate()-ui.chartDays+1))>oldest : days.length>ui.historyDays)
    ?button('加载更多','history-more','soft'):''}</section>`;
}

function taskForm(task) {
  const data=state(), themes=[{id:'',name:'未归类'},...data.themes.filter(t=>t.status!=='已完成'||t.id===task.themeId)];
  const hasChildren=data.tasks.some(t=>t.parentId===task.id);
  const parents=hasChildren?[]:data.tasks.filter(t=>!t.parentId&&t.id!==task.id&&(t.themeId||'')===(task.themeId||''));
  const selectedPrerequisites=new Set(task.prerequisites||[]);
  const dependencyMap=new Map(data.tasks.map(item=>[item.id,item.prerequisites||[]]));
  function wouldCycle(candidate) {
    if(!task.id)return false;
    const pending=[candidate],visited=new Set();
    while(pending.length){
      const id=pending.pop();
      if(id===task.id)return true;
      if(visited.has(id))continue;
      visited.add(id);
      pending.push(...(dependencyMap.get(id)||[]));
    }
    return false;
  }
  const updateRows=(task.updates||[]).slice().sort((a,b)=>b.at.localeCompare(a.at)).map(update=>`<li><strong>${esc(prettyDate(update.at))} · ${esc(update.author)}</strong><p>${esc(update.body)}</p></li>`).join('');
  const guidance=task.guidance||{};
  const assignedToPreset=people.includes(task.assignee);
  const assignee=assignedToPreset?task.assignee:task.assignee?customAssignee:'本人';
  const showCustomAssignee=assignee===customAssignee;
  return `<form data-form="task" class="editor">
  ${field('名称','title',task.title,'text','required')}${area('任务描述（可选）','description',task.description,'rows="3"')}
  ${taskSelect('所属主题','themeId',themes.find(t=>t.id===(task.themeId||''))?.name||'未归类',themes.map(t=>option(t.id,t.name,task.themeId||'')).join(''))}
  ${taskSelect('上级任务','parentId',parents.find(t=>t.id===task.parentId)?.title||'无上级 · 作为一级任务',option('','无上级 · 作为一级任务',task.parentId||'')+parents.map(t=>option(t.id,t.title,task.parentId)).join(''))}
  ${dateField(task.due)}
  ${taskSelect('前置任务','prerequisites',data.tasks.find(t=>selectedPrerequisites.has(t.id))?.title||'关联前置任务',option('','关联前置任务',[...selectedPrerequisites][0]||'')+themes.map(theme=>`<optgroup label="${esc(theme.name)}">${data.tasks.filter(t=>(t.themeId||'')===theme.id).flatMap(t=>t.parentId?[]:[t,...data.tasks.filter(c=>c.parentId===t.id)]).filter(t=>t.id!==task.id).map(t=>option(t.id,(t.parentId?'　':'')+t.title,[...selectedPrerequisites][0],wouldCycle(t.id))).join('')}</optgroup>`).join(''))}
  ${checkbox('标为重点任务','priority',task.priority)}
  ${wheel('交给谁来做','assignee',people,assignee)}
  <div data-custom-assignee ${showCustomAssignee?'':'hidden'}>${field('自定义执行人','assigneeCustom',assignedToPreset?'':task.assignee,'text',`placeholder="输入执行人姓名" ${showCustomAssignee?'':'disabled'}`)}</div>
  ${wheel('进度','status',statuses,task.status||'未开始')}
  <section><header class="row-head"><h2>任务进展</h2>${button('新增任务进展','progress','soft')}</header>${updateRows?`<ul class="timeline">${updateRows}</ul>`:empty('暂无进展')}</section>
  <section><h2>下一步指导</h2><div class="guidance"><strong>${esc(guidance.summary)}</strong><p>${esc(guidance.prompt)}</p>${(guidance.references||[]).map(ref=>referenceLink(ref)).join('')}${button('编辑 Prompt 和参考资料','guidance')}</div></section>
  <footer class="form-footer">${task.id?button('删除任务','delete-task','danger'):''}${button('取消','close-dialog')}${primary('保存修改')}</footer></form>`;
}

function wheel(label,name,choices,selected) {
  const id='wheel-'+name, index=Math.max(0,choices.indexOf(selected));
  return `<div class="field wheel"><label for="${id}">${label}</label><div class="wheel-control"><select id="${id}" class="wheel-select" name="${name}">${choices.map(value=>option(value,value,selected)).join('')}</select><div class="wheel-face" aria-hidden="true"><small>${esc(choices[index-1]||'')}</small><strong>${esc(choices[index])}<b>⌃<br>⌄</b></strong><small>${esc(choices[index+1]||'')}</small></div></div></div>`;
}

function themeForm(theme) {
  return `<form class="editor" data-form="theme">${field('主题名称','name',theme.name,'text','required')}${select('所属分组','groupId',option('','未分组',theme.groupId||'')+state().groups.map(g=>option(g.id,g.name,theme.groupId)).join(''))}${checkbox('设为重点主题','priority',theme.priority)}${checkbox('标为已完成','completed',theme.status==='已完成')}<footer class="form-footer">${theme.id?button('删除主题','delete-theme','danger'):''}${button('取消','close-dialog')}${primary('保存修改')}</footer></form>`;
}

function groupList() {
  return `<div class="group-list">${state().groups.map(g=>`<div class="group-row" data-group="${esc(g.id)}"><strong>${esc(g.name)}</strong>${button('编辑','group-edit','',`data-id="${esc(g.id)}"`)}${button(icon('menu'),'group-move','icon-button',`data-id="${esc(g.id)}" draggable="true" aria-label="拖动分组，点击上移"`)}</div>`).join('')}${button('新建分组','group-edit','soft full')}</div>`;
}

function dialogHTML(d,underlay=false) {
  if(!d)return '';
  let title, content, extra='';
  if(d.kind==='task'){title='编辑任务';content=taskForm(d.item);extra='task-dialog';}
  if(d.kind==='theme'){title=d.item.id?'修改主题':'新建主题';content=themeForm(d.item);extra='task-dialog';}
  if(d.kind==='group'){title=d.item.id?'编辑分组':'新建分组';content=`<form class="editor" data-form="group">${field('组名','name',d.item.name,'text','required')}<footer class="form-footer">${d.item.id?button('删除分组','delete-group','danger'):''}${button('取消','close-dialog')}${primary('保存')}</footer></form>`;}
  if(d.kind==='progress'){title='新增任务进展';content=`<form class="editor" data-form="progress">${area('输入这次进展','body','','rows="7" required')}${primary('确认添加')}</form>`;extra='task-dialog';}
  if(d.kind==='guidance'){title='下一步指导';const g=d.parent.item.guidance||{};content=`<form class="editor" data-form="guidance"><div class="summary-field">${field('摘要（可选）','summary',g.summary)}<p class="muted">留空时保存后从 Prompt 自动提炼。</p></div>${area('给执行人的 Prompt','prompt',g.prompt,'rows="7"')}<section><header class="row-head"><h2>参考文件和链接</h2>${button('添加文件或链接','reference')}</header><div id="references">${(g.references||[]).map(ref=>referenceRow(ref)).join('')}</div></section><footer>${primary('保存指导')}</footer></form>`;extra='task-dialog';}
  if(d.kind==='confirm'){title=d.title;content=`<p>${esc(d.description||'')}</p>${completionGroups(d)}<div class="form-footer confirm-footer">${button('取消','close-dialog')}${button(d.completing?'确认完成':'确认','confirm','primary')}</div>`;}
  if(d.kind==='celebration'){content=`<div class="celebration-stage"><div class="celebration-badge" aria-hidden="true"><svg viewBox="0 0 40 40" class="celebration-check"><path pathLength="1" d="M 9,20 L 17,28 L 31,13"></path></svg><i></i>${Array.from({length:8},(_,i)=>`<b style="--index:${i}">✦</b>`).join('')}</div></div><h2 id="dialog-heading" class="celebration-heading">${d.isTheme?'战略主题已完成':'任务已完成'}</h2><p class="completion-title">${esc(d.label)}</p><div class="celebration-actions">${button('返回任务列表','celebration-return','primary full')}${button('查看已完成任务','celebration-done','full')}</div>`;}
  if(d.kind==='model-key'){title='配置 API Key';content=`<form class="editor" data-form="model-key">${field('API Key','key','','password','required autocomplete="off"')}<footer class="form-footer">${button('取消','close-dialog')}${primary('确认')}</footer></form>`;}
  const mobileBack=extra?button('‹ '+(d.parent?'编辑任务':ui.page==='done'?'已完成':'返回主题'),'close-dialog','text-button page-back task-mobile-tool'):'';
  const variant=d.kind==='celebration'?' celebration-dialog':d.completing?' completion-confirm':'';
  const closeButton=d.completing?'':'<button type="button" data-action="close-dialog" class="button icon-button close" aria-label="关闭">×</button>';
  const heading=title?`<h2 ${underlay?'':'id="dialog-heading"'}>${title}</h2>`:'';
  const head=title?`<header>${closeButton}${extra?`<div class="page-heading">${sidebarButton('task-mobile-tool')}${heading}${mobileBack}</div>`:heading}</header>`:'';
  return `<div class="modal-layer ${extra}${variant}${underlay?' dialog-underlay':''}" ${underlay?'inert aria-hidden="true"':'data-action="dismiss-overlay"'}><article class="dialog" ${underlay?'':'tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="dialog-heading"'}>${head}<div class="dialog-body">${content||''}</div>${extra?`<div class="task-mobile-nav">${navBar(true)}</div>`:''}</article></div>`;
}
function completionGroups(dialog) {
 const affected=dialog.affected||[];
 if(!affected.length)return '';
 let groups=[['未完成直属二级 → 升为同主题一级任务',affected]];
 if(dialog.parent?.kind==='theme'){
   const roots=affected.filter(task=>!task.parentId);
   const rootIds=new Set(roots.map(task=>task.id));
   groups=[
    ['未完成一级任务及其子树 → 未归类项目',roots],
    ['已完成一级中的未完成二级 → 升为未归类一级',affected.filter(task=>task.parentId&&!rootIds.has(task.parentId))]
   ].filter(([,tasks])=>tasks.length);
 }
 return `<div class="reassign"><h3>未完成任务将重新归属</h3>${groups.map(([rule,tasks])=>`<section><strong>${rule}</strong><ul>${tasks.map(task=>`<li>${esc(task.title)}</li>`).join('')}</ul></section>`).join('')}<p class="muted">已完成记录保留原归属路径。</p></div>`;
}
const localAttachment = /^data:application\/octet-stream;base64,[a-zA-Z0-9+/=]+$/;
function referenceLink(ref) {
 const attachment=localAttachment.test(ref.url);
 const url=attachment?esc(ref.url):safeURL(ref.url);
 return url?`<a class="reference-link" href="${url}" ${attachment?`download="${esc(ref.name||'资料')}"`:'target="_blank" rel="noopener noreferrer"'}>${esc(ref.name||'参考资料')}</a>`:ref.name?`<p>${esc(ref.name)}</p>`:'';
}
function referenceRow(ref={}) {
 const attachment=localAttachment.test(ref.url);
 return `<div class="reference-row">${field('资料名','referenceName',ref.name)}${attachment?`<input name="referenceUrl" type="hidden" value="${esc(ref.url)}">${referenceLink(ref)}`:field('链接','referenceUrl',ref.url,'url','placeholder="https://…"')}
 ${button('选择本地文件','reference-choose')}${button('移除','reference-remove','danger')}<input type="file" class="reference-file" hidden aria-label="选择参考文件"></div>`;
}
function hideOptions(restore=false) {
 const menu=app.querySelector('.option-menu');
 if(!menu)return;
 const trigger=menu.previousElementSibling;
 trigger.setAttribute('aria-expanded','false');
 menu.remove();
 if(restore)trigger.focus();
}
function showOptions(trigger) {
 if(trigger.getAttribute('aria-expanded')==='true'){hideOptions(true);return;}
 hideOptions();
 const input=trigger.previousElementSibling;
 const markup=[...input.children].map(node=>{
  const optionHTML=entry=>`<button class="menu-option" type="button" role="option" aria-selected="${entry.selected}" data-action="select-option" data-option="${entry.index}" ${entry.disabled?'disabled':''}>${esc(entry.text)}</button>`;
  if(node.tagName==='OPTGROUP')return node.children.length?`<div role="group" aria-label="${esc(node.label)}"><small>${esc(node.label)}</small>${[...node.children].map(optionHTML).join('')}</div>`:'';
  return optionHTML(node);
 }).join('');
 trigger.setAttribute('aria-expanded','true');
 trigger.insertAdjacentHTML('afterend',`<div role="listbox" class="option-menu" aria-labelledby="field-${input.name}">${markup}</div>`);
 const menu=trigger.nextElementSibling;
 const rect=trigger.getBoundingClientRect();
 const dialog=trigger.closest('.dialog').getBoundingClientRect();
 if(rect.bottom+Math.min(menu.scrollHeight,260)>dialog.bottom-15&&rect.top-dialog.top>200)menu.classList.add('opens-up');
 (menu.querySelector('[aria-selected="true"]')||menu.querySelector('.menu-option'))?.focus({preventScroll:true});
 const active=menu.querySelector('[aria-selected=true]');
 if(active)menu.scrollTop=Math.max(0,active.offsetTop-60);
}

let focusedDialog,lastRenderedRevision,renderedView,renderedThemeId,historyObserver;
const viewPositions=new Map();
const dialogPositions=new WeakMap();
const dialogTriggers=new WeakMap();

function viewKey() {
 if(ui.section)return 'settings:'+ui.section;
 if(ui.page==='themes'&&ui.mobileTree&&!matchMedia('(min-width:1024px)').matches){
  return 'theme:'+(ui.themeId||'uncategorized');
 }
 if(ui.page==='ideas'&&ui.idea)return 'idea:'+(ui.idea.id||'new');
 if(ui.page==='done')return 'done:'+ui.doneTab;
 return ui.page;
}

function observeHistory() {
 historyObserver?.disconnect();
 const button=app.querySelector('[data-action=history-more]');
 if(!button||!globalThis.IntersectionObserver)return;
 historyObserver=new IntersectionObserver(([entry])=>{
  if(!button.isConnected||!entry.isIntersecting||ui.dialog)return;
  historyObserver.disconnect();
  moreHistory();
 },{rootMargin:'0px 0px 60px 0px'});
 historyObserver.observe(button);
}

function moreHistory() {
 if(ui.doneTab==='chart')ui.chartDays+=11;
 else ui.historyDays+=14;
 render();
}

function resizeChatInput(input){
  input.style.height='auto';
  input.style.height=Math.min(input.scrollHeight,88)+'px';
}

function animateEntry(element,from,duration){
  element?.animate([from,{opacity:1}],{duration,easing:'cubic-bezier(.2,.75,.3,1)'});
}

function animateOverlay(workspace,previousWorkspace,panel,shade,offset){
  const current=workspace.querySelector(panel);
  const previous=previousWorkspace?.querySelector(`${panel}:not([inert])`);
  if(Boolean(previous)===Boolean(current))return;

  const panels=[[panel,{opacity:0,transform:offset}],[shade,{opacity:0}]];
  for(const [selector,frame] of panels){
    if(current){
      animateEntry(workspace.querySelector(selector),frame,180);
      continue;
    }
    const element=previousWorkspace.querySelector(`${selector}:not([inert])`);
    if(!element)continue;
    element.inert=true;
    element.setAttribute('aria-hidden','true');
    workspace.append(element);
    const exit=element.animate([{opacity:1},frame],{duration:130,easing:'ease-in'});
    exit.finished.then(()=>element.remove(),()=>element.remove());
  }
}

const motionEnabled=()=>typeof app.animate==='function'&&!matchMedia('(prefers-reduced-motion: reduce)').matches;

function toggleMobileSidebar(){
  const workspace=app.querySelector('.workspace');
  const previous=document.createElement('div');
  for(const element of workspace.querySelectorAll(':scope > .sidebar,:scope > .menu-shade'))previous.append(element);
  ui.sidebar=!ui.sidebar;
  const menu=document.createElement('template');
  menu.innerHTML=sidebar();
  workspace.prepend(menu.content);
  if(motionEnabled())animateOverlay(workspace,previous,'.sidebar-open','.menu-shade','translateX(-100%)');
  const focusTarget=ui.sidebar?workspace.querySelector('.sidebar-open .module'):
    workspace.querySelector('.dialog[role=dialog] [data-action=sidebar]')||workspace.querySelector('.page-header [data-action=sidebar]');
  focusTarget?.focus({preventScroll:true});
}

function render(origin) {
  const data=state();
  document.documentElement.dataset.theme=data.session&&data.settings.appearance==='warm'?'warm':'cool';
  const previousWorkspace=app.querySelector('.workspace');
  if(renderedView)viewPositions.set(renderedView,window.scrollY);
  const prevDialog=app.querySelector('.dialog[role=dialog]');
  if(prevDialog&&focusedDialog)dialogPositions.set(focusedDialog,prevDialog.scrollTop);
  const dialogChanged=focusedDialog!==ui.dialog;
  const returning=dialogChanged&&focusedDialog?.parent===ui.dialog;
  const outside=dialogChanged&&focusedDialog&&!ui.dialog;
  const trigger=document.activeElement?.closest('button[data-action]');
  if(ui.dialog&&dialogChanged&&!returning&&trigger){
    const {action,id,parent,value}=trigger.dataset;
    dialogTriggers.set(ui.dialog,{action,id,parent,value});
  }
  const previousScroll=app.querySelector('.chat:not([inert]) .chat-scroll');
  const activeInput=document.activeElement?.matches('.chat-input')?document.activeElement:null;
  const scrollPosition=previousScroll?.scrollTop||0;
  const following=previousScroll ? previousScroll.scrollHeight-previousScroll.clientHeight-scrollPosition<=36 : true;
  lastRenderedRevision=data.revision;
  if(!data.session){
    historyObserver?.disconnect();
    viewPositions.clear();
    renderedView=undefined;
    ui.settingsOrigin=null;
    ui.defaultTheme=false;
    app.innerHTML=cloudWorkspace?.getStatus()==='正在恢复登录…'
      ? '<main class="auth" data-cloud-restoring><p role="status">正在恢复登录…</p></main>'
      : authView(helpers)+cloudStatusNotice();
    return;
  }
  if(!ui.defaultTheme){
    ui.themeId=data.themes.find(t=>t.name==='创业与商业实践')?.id||data.themes.find(t=>t.status!=='已完成')?.id||null;
    const first=data.tasks.find(t=>t.themeId===ui.themeId&&!t.parentId);
    if(first)ui.expanded.add(first.id);
    ui.defaultTheme=true;
  }
  const section=ui.section;
  const settingsMode=Boolean(section&&section!=='groups');
  const background=ui.dialog?.completing?ui.dialog.parent:ui.dialog?.background;
  const body=section==='groups'?`${toolbar('编辑分组','战略主题')}${groupList()}` : section ? settingsView(helpers) :
    ui.page==='themes'?themes() : ui.page==='ideas'?ideaView(helpers) : ui.page==='done'?history():today();
  app.innerHTML=`<div class="workspace ${ui.collapsed?'collapsed':''}">${sidebar()}<main><header class="desktop-header">${sidebarButton('',ui.collapsed?'展开侧栏':'收起侧栏')}`+
    `<strong>待办清单</strong>${navBar()}</header><div class="page"${settingsMode?' data-secondary':''}>${cloudStatusNotice()}${body}</div>${settingsMode?'':`<div class="mobile-nav">${navBar(true)}</div>`}</main>
  ${button(avatar(data.settings.assistant.avatar),'chat-toggle','assistant-launcher',`aria-label="小助手" aria-haspopup="dialog" aria-expanded="${Boolean(ui.chat)}" ${ui.chat?'aria-controls="assistant-dialog"':''}`)}${ui.chat?chatView(helpers):''}${dialogHTML(background,true)}${dialogHTML(ui.dialog)}
  ${ui.toast?`<div class="toast" role="status">${esc(ui.toast)}</div>`:''}</div>`;
  if(origin?.page)app.querySelector('.page').replaceWith(origin.page);
  if(origin?.dialogLayer)app.querySelector('.modal-layer:not([inert])').replaceWith(origin.dialogLayer);
  if(ui.launcher) Object.assign(app.querySelector('.assistant-launcher').style,{...ui.launcher,bottom:'auto'});
  markConnection();
  alignOverlay();
  const chatScroll=app.querySelector('.chat-scroll');
  const chatInput=app.querySelector('.chat-input');
  if(chatInput?.value)resizeChatInput(chatInput);
  if(chatScroll) chatScroll.scrollTop=following?chatScroll.scrollHeight:scrollPosition;
  const nextView=viewKey();
  const viewChanged=nextView!==renderedView;
  const themeChanged=nextView==='themes'&&ui.themeId!==renderedThemeId;
  renderedView=nextView;
  renderedThemeId=ui.themeId;
  window.scrollTo(0,viewPositions.get(renderedView)||0);
  const underlay=app.querySelector('.dialog-underlay .dialog');
  if(underlay&&background)underlay.scrollTop=dialogPositions.get(background)||0;
  const dialog=app.querySelector('.dialog[role=dialog]');
  if(dialog&&ui.dialog)dialog.scrollTop=dialogPositions.get(ui.dialog)||0;
  if(returning||outside){
    const origin=dialogTriggers.get(focusedDialog);
    const scope=dialog||app;
    const control=origin&&[...scope.querySelectorAll('button[data-action]')].find((candidate)=>
      Object.entries(origin).every(([name,value])=>candidate.dataset[name]===value)&&candidate.getClientRects().length);
    (control||dialog)?.focus({preventScroll:true});
  }else if(ui.dialog&&dialogChanged)dialog?.focus({preventScroll:true});
  else if(!ui.dialog){
    if(chatInput&&activeInput){
      chatInput.focus({preventScroll:true});
      if(chatInput.value===activeInput.value)chatInput.setSelectionRange(activeInput.selectionStart,activeInput.selectionEnd);
    }else if(ui.chat&&!previousScroll)app.querySelector('.chat')?.focus({preventScroll:true});
    else if(!ui.chat&&previousScroll)app.querySelector('.assistant-launcher')?.focus({preventScroll:true});
  }
  if(motionEnabled()){
    const workspace=app.querySelector('.workspace');
    if(viewChanged)animateEntry(workspace.querySelector('.page'),{opacity:.55},150);
    else if(themeChanged)animateEntry(workspace.querySelector('.task-tree'),{opacity:.55},150);
    animateOverlay(workspace,previousWorkspace,'.sidebar-open','.menu-shade','translateX(-100%)');
    animateOverlay(workspace,previousWorkspace,'.chat','.chat-scrim','translateY(12px)');
    if(dialogChanged&&dialog)animateEntry(dialog,{opacity:.55},150);
  }
  focusedDialog=ui.dialog;
  observeHistory();
}

function alignOverlay(){
 const chat=app.querySelector('.chat:not([inert])'), tree=app.querySelector('.task-tree'), launcher=app.querySelector('.assistant-launcher');
 if(!chat||!matchMedia('(min-width:1024px)').matches)return;
 const anchor=launcher.getBoundingClientRect();
 const panel=tree?.getBoundingClientRect();
 const alignToPanel=panel&&panel.width&&panel.height&&!ui.launcher;
 chat.style.right=(alignToPanel?innerWidth-panel.right+12:ui.launcher?(anchor.left<innerWidth/2?innerWidth-anchor.right+12:innerWidth-anchor.right):40)+'px';
 chat.style.bottom=(alignToPanel?Math.max(18,innerHeight-panel.bottom+12):Math.min(innerHeight-140,Math.max(20,innerHeight-anchor.bottom+30)))+'px';
}

function markConnection() {
 const layout=app.querySelector('.theme-layout');
 const tile=layout?.querySelector('.topic-selected');
 if(tile)layout.style.setProperty('--connector-y',`${tile.getBoundingClientRect().top-layout.getBoundingClientRect().top+tile.offsetHeight/2}px`);
}

function notify(message) {
  ui.toast=message;
  render();
  clearTimeout(notify.timer);
  notify.timer=setTimeout(()=>{ui.toast=''; app.querySelector('.toast')?.remove();},2800);
}
const navigate = value => {ui.page=value;ui.section='';ui.mobileTree=false;ui.dialog=null;ui.sidebar=false;ui.settingsOrigin=null;render();};
function openSettings(){
  if(!ui.section||ui.section==='groups'){
    const page=app.querySelector('.page');
    ui.settingsOrigin={
      section:ui.section,
      dialog:ui.dialog,
      page:page.querySelector('form')?page:null,
      dialogLayer:app.querySelector('.modal-layer:not([inert])'),
    };
  }
  ui.section='settings';
  ui.dialog=null;
  ui.sidebar=false;
  render();
}
function returnFromSettings(){
  const origin=ui.settingsOrigin;
  ui.settingsOrigin=null;
  ui.section=origin?.section||'';
  ui.dialog=origin?.dialog||null;
  render(origin);
}
const openTask = (id,parent=null,idea=null) => {
 const existing=state().tasks.find(t=>t.id===id);
 ui.dialog={kind:'task',item:existing?structuredClone(existing):{title:idea?.title||'',description:idea?.body||'',themeId:ui.themeId,parentId:parent,status:'未开始',priority:false,assignee:'本人',prerequisites:[],updates:[],...(idea?{ideaId:idea.id}: {})}};
 render();
};
const close = () => {ui.dialog=ui.dialog?.parent||null;render();};
const complete=(item)=>{const background=ui.dialog?.completing?ui.dialog.parent:ui.dialog;ui.dialog={kind:'celebration',label:item.title||item.name,isTheme:background?.kind==='theme',background};render();};
const confirmation=(title,description,run,parent=ui.dialog,affected=[],completing=false)=>{ui.dialog={kind:'confirm',title,description,run,parent,affected,completing};render();};

function applyTaskFields(form) {
 const values=Object.fromEntries(new FormData(form));
 const item=ui.dialog.item;
 const oldTheme=item.themeId;
 const prerequisites=values.prerequisites?[values.prerequisites]:[];
 if((item.prerequisites||[])[0]===values.prerequisites)prerequisites.push(...item.prerequisites.slice(1));
 Object.assign(item,{title:values.title,description:values.description,themeId:values.themeId||null,parentId:values.parentId||null,due:values.due,status:values.status,assignee:values.assignee===customAssignee?(values.assigneeCustom?.trim()||customAssignee):values.assignee,priority:!!values.priority,prerequisites});
 if(oldTheme!==item.themeId&&item.parentId&&!state().tasks.some(t=>t.id===item.parentId&&(t.themeId||null)===item.themeId))item.parentId=null;
 return item;
}

async function saveTask(task,confirm=false){
 const prior=state().tasks.find(t=>t.id===task.id);
 const result=await api.tasks.save(task,{confirm});
 if(!result.ok && result.code==='CONFIRM_REQUIRED'){confirmation(task.parentId?'确认完成二级任务？':'确认完成一级任务？',task.title,()=>saveTask(task,true),ui.dialog,result.affected,true);return;}
 if(!result.ok)throw new Error(result.message||'保存失败');
 if(result.item.status==='已完成'&&prior?.status!=='已完成'){complete(result.item);return;}
 if(prior?.status==='已完成'){ui.themeId=result.item.themeId||null;ui.mobileTree=true;ui.page='themes';}
 close();
}

async function saveTheme(theme,confirm=false){
 const prior=state().themes.find(t=>t.id===theme.id);
 const result=await api.themes.save(theme,{confirm});
 if(!result.ok && result.code==='CONFIRM_REQUIRED'){confirmation('确认完成战略主题？',theme.name,()=>saveTheme(theme,true),ui.dialog,result.affected,true);return;}
 if(!result.ok)throw new Error(result.message||'保存失败');
 if(result.item.status==='已完成'&&prior?.status!=='已完成'){complete(result.item);return;}
 close();
}

Object.assign(helpers,{render,navigate,notify,confirmation,openTask,accountAvatar,close});
const readTaskDraft=()=>{const form=app.querySelector('[data-form="task"]');if(form&&ui.dialog?.kind==='task')applyTaskFields(form);};

app.addEventListener('click',async event=>{
 if(!event.target.closest('.dropdown'))hideOptions();
 const target=event.target.closest('[data-action]');
 if(!target){if(ui.chat&&!event.target.closest('.chat,.assistant-launcher')){ui.chat=null;render();}return;}
 const {action,id,value,parent}=target.dataset;
 try {
  if(ui.chat&&!target.closest('.chat,.assistant-launcher')&&action!=='dismiss-overlay'){ui.chat=null;render();return;}
  if(action==='navigate'){navigate(value);return;}
  if(action==='workbench'){navigate('today');return;}
  if(action==='sidebar'){
   if(matchMedia('(min-width:1024px)').matches){ui.collapsed=!ui.collapsed;render();}
   else toggleMobileSidebar();
   return;
  }
  if(action==='settings'){openSettings();return;}
  if(action==='back'){if(ui.section==='settings'){returnFromSettings();return;}if(ui.section){ui.section=ui.section==='assistant-avatars'?'personalization':['nickname','password','avatar','model','personalization'].includes(ui.section)?'settings':'';}else if(ui.page==='ideas')ui.idea=null;else if(ui.page==='done'){ui.page='themes';ui.mobileTree=false;}else if(ui.mobileTree)ui.mobileTree=false; render();return;}
  if(action==='open-theme'){ui.themeId=id||null;ui.mobileTree=true;const first=state().tasks.find(t=>!t.parentId&&(t.themeId||null)===ui.themeId);if(first)ui.expanded.add(first.id);render();return;}
  if(action==='expand'){ui.expanded.has(id)?ui.expanded.delete(id):ui.expanded.add(id);render();return;}
  if(action==='edit-task'){openTask(id);return;}
  if(action==='new-task'){openTask(null,parent||null);return;}
  if(action==='open-options'){showOptions(target);return;}
  if(action==='select-option'){
   const dropdown=target.closest('.dropdown'),input=dropdown.querySelector('select');
   input.selectedIndex=Number(target.dataset.option);
   dropdown.querySelector('.dropdown-trigger span').textContent=input.selectedOptions[0].text.trim();
   hideOptions(true);
   input.dispatchEvent(new Event('change',{bubbles:true}));
   return;
  }
  if(action==='theme-mode'){ui.editingThemes=!ui.editingThemes;render();return;}
  if(action==='edit-theme'){ui.dialog={kind:'theme',item:structuredClone(state().themes.find(t=>t.id===id)||{name:'',groupId:'',status:'进行中'})};render();return;}
  if(action==='groups'){ui.section='groups';render();return;}
  if(action==='group-edit'){ui.dialog={kind:'group',item:structuredClone(state().groups.find(g=>g.id===id)||{name:''})};render();return;}
  if(action==='group-move'){moveGroup(id);return;}
  if(action==='history-tab'){ui.doneTab=value;render();return;}
  if(action==='history-more'){moreHistory();return;}
  if(action==='dismiss-overlay'){if(event.target===target)close();return;}
  if(action==='close-dialog'){close();return;}
  if(action==='confirm'){await ui.dialog.run();return;}
  if(action==='delete-task'){readTaskDraft();confirmation('删除任务？','确认后移除此任务。',async()=>{await api.tasks.remove(ui.dialog.parent.item.id);ui.dialog=null;render();});return;}
  if(action==='delete-theme'){confirmation('删除主题？','该主题下的任务将移至未归类项目。',async()=>{await api.themes.remove(ui.dialog.parent.item.id);ui.themeId=null;ui.dialog=null;render();});return;}
  if(action==='delete-group'){confirmation('删除分组？','该分组下的主题将移至未分组。',()=>{const gid=ui.dialog.parent.item.id;api.store.update(data=>{data.groups=data.groups.filter(g=>g.id!==gid);data.themes.forEach(t=>{if(t.groupId===gid)t.groupId='';});});ui.dialog=null;render();});return;}
  if(action==='progress'||action==='guidance'){readTaskDraft();ui.dialog={kind:action,parent:ui.dialog};render();return;}
  if(action==='reference'){app.querySelector('#references').insertAdjacentHTML('beforeend',referenceRow());app.querySelector('#references .reference-row:last-child input')?.focus();return;}
  if(action==='reference-choose'){target.closest('.reference-row').querySelector('input[type=file]').click();return;}
  if(action==='reference-remove'){target.closest('.reference-row').remove();return;}
  if(action==='celebration-return'||action==='celebration-done'){navigate(action==='celebration-return'?'themes':'done');return;}
  await settingsAction(action,helpers,event);
 }catch(error){notify(error.message);}
});

app.addEventListener('submit',async event=>{
 event.preventDefault();
 const form=event.target;
 const type=form.dataset.form;
 try {
  if(type==='task'){await saveTask(applyTaskFields(form));return;}
  const fd=new FormData(form),values=Object.fromEntries(fd);
  if(type==='theme'){const item={...ui.dialog.item,name:values.name,groupId:values.groupId,status:values.completed?'已完成':'进行中',priority:!!values.priority};await saveTheme(item);return;}
  if(type==='group'){const item={...ui.dialog.item,name:values.name.trim()};if(!item.name)return;api.store.update(data=>{if(!item.id)data.groups.push({...item,id:makeId()});else Object.assign(data.groups.find(g=>g.id===item.id),item);});close();return;}
  if(type==='progress'){const body=values.body.trim();if(!body)return;const parent=ui.dialog.parent.item;(parent.updates??=[]).push({id:makeId(),body,at:new Date().toISOString(),author:state().account.displayName||'本人'});close();return;}
  if(type==='guidance'){const item=ui.dialog.parent.item;item.guidance={...item.guidance,summary:values.summary.trim()||values.prompt.trim().split(/[。！？\n]/)[0].slice(0,56),prompt:values.prompt,references:[...form.querySelectorAll('.reference-row')].map(row=>({name:row.querySelector('[name="referenceName"]').value,url:row.querySelector('[name="referenceUrl"]').value})).filter(ref=>ref.name||ref.url)};close();return;}
  await settingsAction('form:'+type,helpers,event);
 }catch(error){notify(error.message);}
});
app.addEventListener('change',async event=>{
 const input=event.target;
 if(input.matches('.date-control input'))input.parentElement.classList.toggle('date-empty',!input.value);
 if(input.matches('.reference-file')){
  const file=input.files[0];
  if(!file)return;
  if(file.size>512*1024){notify('参考文件最大 512 KB，请改用链接引用更大的文件。');return;}
  try{
   const blob=new Blob([await file.arrayBuffer()],{type:'application/octet-stream'});
   const url=await new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result);fr.onerror=reject;fr.readAsDataURL(blob);});
   if(input.isConnected)input.closest('.reference-row').outerHTML=referenceRow({name:file.name,url});
  }catch{notify('无法读取参考文件。');}
  return;
 }
 if(ui.dialog?.kind==='task'&&input.name==='themeId'){applyTaskFields(input.form);render();}
 if(input.matches('.wheel-select')){
  const face=input.nextElementSibling;
  face.querySelector('strong').firstChild.nodeValue=input.selectedOptions[0].text;
  face.firstElementChild.textContent=input.options[input.selectedIndex-1]?.text||'';
  face.lastElementChild.textContent=input.options[input.selectedIndex+1]?.text||'';
  if(input.name==='assignee'){
   const showCustom=input.value===customAssignee;
   input.form.querySelector('[data-custom-assignee]').hidden=!showCustom;
   input.form.elements.assigneeCustom.disabled=!showCustom;
  }
 }
 if(input.matches('[data-onchange]'))settingsAction(input.dataset.onchange,helpers,event).catch(error=>notify(error.message));
});
app.addEventListener('wheel',event=>{
 const control=event.target.closest('.wheel-control');
 if(!control||!event.deltaY)return;
 event.preventDefault();
 if(control.dataset.wheeling)return;
 control.dataset.wheeling='true';setTimeout(()=>delete control.dataset.wheeling,125);
 shiftWheel(control.querySelector('select'),Math.sign(event.deltaY));
},{passive:false});
let wheelPress;
app.addEventListener('pointerdown',event=>{
 if(event.target.matches('.wheel-select'))wheelPress={input:event.target,y:event.clientY};
});
app.addEventListener('pointerup',event=>{
 if(!wheelPress)return;
 const offset=wheelPress.y-event.clientY;
 if(Math.abs(offset)>18){event.preventDefault();shiftWheel(wheelPress.input,Math.sign(offset));}
 wheelPress=null;
});
function shiftWheel(input,direction){
 const i=Math.max(0,Math.min(input.options.length-1,input.selectedIndex+direction));
 input.selectedIndex=i;input.dispatchEvent(new Event('change',{bubbles:true}));
}
app.addEventListener('input',event=>{
 if(event.target.matches('.chat-input')){resizeChatInput(event.target);ui.chat.draft=event.target.value;}
});
app.addEventListener('keydown',event=>{
 const input=event.target;
 if(event.key!=='Enter'||!input.matches('.chat-input')||event.isComposing||event.keyCode===229)return;
 if(event.ctrlKey||event.metaKey)return;
 event.preventDefault();
 if(event.shiftKey||event.altKey){
  input.setRangeText('\n',input.selectionStart,input.selectionEnd,'end');
  input.dispatchEvent(new Event('input',{bubbles:true}));
 }else if(!event.repeat){
  input.form.requestSubmit();
 }
});
app.addEventListener('dragstart',event=>{if(event.target.matches('[data-action="group-move"]'))event.dataTransfer.setData('text/plain',event.target.dataset.id);});
app.addEventListener('dragover',event=>{if(event.target.closest('[data-group]'))event.preventDefault();});
app.addEventListener('drop',event=>{const row=event.target.closest('[data-group]');if(row){event.preventDefault();moveGroup(event.dataTransfer.getData('text/plain'),row.dataset.group);}});
let groupPointer;
app.addEventListener('pointerdown',event=>{
 const handle=event.target.closest('[data-action="group-move"]');
 if(!handle||event.pointerType==='mouse')return;
 groupPointer={id:handle.dataset.id,x:event.clientX,y:event.clientY,pointerId:event.pointerId,handle};
 handle.setPointerCapture(event.pointerId);
});
app.addEventListener('pointermove',event=>{
 if(!groupPointer||event.pointerId!==groupPointer.pointerId||Math.hypot(event.clientX-groupPointer.x,event.clientY-groupPointer.y)<9)return;
 groupPointer.moved=true;
 app.querySelector('.group-row.dragging')?.classList.remove('dragging');
 document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-group]')?.classList.add('dragging');
});
app.addEventListener('pointerup',event=>{
 if(!groupPointer||event.pointerId!==groupPointer.pointerId)return;
 const drag=groupPointer;groupPointer=null;
 if(!drag.moved)return;
 const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-group]');
 drag.handle.addEventListener('click',click=>{click.preventDefault();click.stopPropagation();},{once:true});
 app.querySelector('.group-row.dragging')?.classList.remove('dragging');
 if(target&&target.dataset.group!==drag.id)moveGroup(drag.id,target.dataset.group);
});
app.addEventListener('pointercancel',()=>{groupPointer=null;app.querySelector('.group-row.dragging')?.classList.remove('dragging');});
function moveGroup(id,to){
 api.store.update(data=>{const index=data.groups.findIndex(g=>g.id===id);const destination=to?data.groups.findIndex(g=>g.id===to):index-1;if(index<0||destination<0||index===destination)return;const [group]=data.groups.splice(index,1);data.groups.splice(destination,0,group);});
 render();
}
document.addEventListener('keydown',event=>{
 const options=app.querySelector('.option-menu');
 if(options&&event.key==='Escape'){event.preventDefault();hideOptions(true);return;}
 if(options&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
  event.preventDefault();
  const entries=[...options.querySelectorAll('.menu-option:not(:disabled)')],current=entries.indexOf(document.activeElement);
  const i=event.key==='Home'?0:event.key==='End'?entries.length-1:Math.max(0,Math.min(entries.length-1,current+(event.key==='ArrowDown'?1:-1)));
  entries[i]?.focus();
  return;
 }
 if(event.key==='Escape'){if(ui.sidebar)toggleMobileSidebar();else if(ui.dialog)close();else if(ui.chat){ui.chat=null;render();}return;}
 if(event.key!=='Tab'||!ui.dialog&&!ui.sidebar)return;
 const dialog=app.querySelector(ui.sidebar?'.sidebar-open:not([inert])':'.dialog[role=dialog]');
 if(!dialog)return;
 const controls=[...dialog.querySelectorAll('button,input,textarea,select,a[href]')].filter(control=>!control.disabled&&control.getClientRects().length);
 if(!controls.length)return;
 if(event.shiftKey&&(document.activeElement===controls[0]||document.activeElement===dialog)){event.preventDefault();controls.at(-1).focus();}
 if(!event.shiftKey&&document.activeElement===controls.at(-1)){event.preventDefault();controls[0].focus();}
});
window.addEventListener('resize',()=>{markConnection();alignOverlay();});
bindVoice(helpers);
function cloudStatusNotice() {
 const message=cloudWorkspace?.getStatus();
 return cloudWorkspace?`<p class="notice" data-cloud-status role="status" ${message?'':'hidden'}>${esc(message)}</p>`:'';
}
window.addEventListener('workbench-cloud-status',()=>{
 if(app.querySelector('[data-cloud-restoring]')&&cloudWorkspace.getStatus()!=='正在恢复登录…'){render();return;}
 const notice=app.querySelector('[data-cloud-status]');
 if(!notice)return;
 notice.textContent=cloudWorkspace.getStatus();
 notice.hidden=!notice.textContent;
});
api.store.subscribe(next=>{
 queueMicrotask(()=>{
  if(next.revision===lastRenderedRevision||ui.dialog&&next.session)return;
  if(!next.session){ui.dialog=null;ui.chat=null;}
  render();
 });
});
void cloudWorkspace?.start();
render();
