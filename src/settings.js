import {api,cloudWorkspace} from './domain.js';
import {createDemoAuth,demoCredentials} from './integrations.js';
import {createLocalModel} from './local-model.js';
import {protectLocalModelKey,revealLocalModelKey} from './local-model-credentials.js';
import {runWorkspaceTool} from './workspace-tools.js';
import {memoryMarkdown} from './assistant-memory.js';
import {dueReminders,markRemindersRead,taskReminderGuidance} from './task-reminders.js';
const auth=cloudWorkspace?.auth||createDemoAuth(api);
const model=createLocalModel(cloudWorkspace?.modelRequest,{
 ...(cloudWorkspace&&{serviceName:'云端模型服务'}),
 persistence:{
  read:()=>api.store.get().settings.model.connection,
  async write(connection){
   api.store.update(data=>{data.settings.model.connection=connection;});
   await cloudWorkspace?.readForAssistant();
  },
  ...(!cloudWorkspace&&{
   protect:apiKey=>protectLocalModelKey(api.store.get().account.email,apiKey),
   reveal:credential=>revealLocalModelKey(api.store.get().account.email,credential),
  }),
 },
});
const modelConnection=settings=>model.connection||settings.model;

const portraits=[['warm-female','暖色女助手'],['cool-female','冷色女助手'],['warm-male','暖色男助手'],['cool-male','冷色男助手']];
const styles=[['direct','简洁直接'],['care','温暖关怀'],['fun','可爱有趣'],['custom','自定义']];
const prompt='先给结论，再补充必要细节。优先根据工作台记录和参考资料回答。不确定就说明，缺少关键信息时问一个具体问题。不要编造事实、来源或任务进展。\n'+taskReminderGuidance;

export function authView(h) {
 const {ui,button,primary,field,esc,state}=h;
 if(cloudWorkspace)return `<main class="auth"><header class="page-heading"><h1>个人工作台</h1></header>
 <form data-form="auth" class="editor">
 ${field('邮箱账号','email',ui.authEmail||'','email','required autocomplete="username"')}
 ${field('密码','password','','password','required autocomplete="current-password"')}
 <label class="switch-row"><span>保持登录 30 天</span><input type="checkbox" name="keepSignedIn" ${ui.keepSignedIn!==false?'checked':''}></label>
 ${ui.authMessage?`<p class="notice" role="status">${esc(ui.authMessage)}</p>`:''}
 ${primary('登录')}
 </form></main>`;
 if(!ui.captcha)refreshCaptcha(ui);
 const registration=ui.authMode==='register';
 const reset=ui.authMode==='reset';
 const needsCode=registration||ui.authChallenge;
 return `<main class="auth"><header class="page-heading"><h1>${reset?'找回密码':'个人工作台'}</h1>${reset?button('‹ 返回登录','auth-mode','text-button page-back','data-value="login" aria-label="返回登录"'):''}</header>
 ${reset?'':`<nav class="tabs">${button('账号登录','auth-mode',!registration?'selected':'','data-value="login"')}${button('注册新账户','auth-mode',registration?'selected':'','data-value="register"')}</nav>`}
 <form data-form="auth" class="editor">
 ${field(reset?'注册邮箱':'邮箱账号','email',ui.authEmail||'','email','placeholder="输入邮箱" required autocomplete="username"')}
 ${registration?`<div class="field"><label class="field-title" for="registration-password">密码</label><div class="password-field"><input id="registration-password" name="password" type="password" placeholder="输入密码" required autocomplete="new-password">${button('显示','toggle-registration-password','text-button','aria-label="显示密码" aria-controls="registration-password"')}</div></div>`:reset?'<p class="muted">如果该邮箱可用于找回密码，你将收到一封含重置链接的邮件。</p>':field('密码','password','','password','placeholder="输入密码" required autocomplete="current-password"')}
 ${registration?field('昵称','nickname','','text','placeholder="输入昵称" required'):''}
 ${needsCode&&!reset?`<div class="captcha"><label for="captcha">图形验证码</label><div><output aria-label="验证码">${esc(ui.captcha)}</output>${button('换一张','captcha')}</div><input id="captcha" name="captcha" placeholder="输入图片中的字符" required autocomplete="off"></div>`:''}
 ${ui.authMessage?`<p class="notice" role="status">${esc(ui.authMessage)}</p>`:''}
 ${primary(reset?'发送重置链接':registration?'注册新账户':'登录')}
 ${!reset&&!registration?button('忘记密码','auth-mode','text-button','data-value="reset"'):''}
 ${!reset&&!registration?button('进入本地演示','demo','text-button'):''}
 </form></main>`;
}

function refreshCaptcha(ui) {
 const challenge=auth.captcha();
 ui.captcha=challenge.text;
 ui.captchaId=challenge.id;
}

function toggle(label,action,on,disabled=false) {
 return `<label class="switch-row"><span>${label}</span><input type="checkbox" role="switch" data-onchange="${action}" ${on?'checked':''} ${disabled?'disabled':''}></label>`;
}

export function settingsView(h) {
 const {ui,state,toolbar,field,primary,button,area,select,option,avatar,esc,accountAvatar}=h;
 const {account,settings}=state();
 const connection=modelConnection(settings);
 const appearance=settings.appearance==='warm'?'warm':'cool';
 if(ui.section==='settings')return `${toolbar('设置','返回当前板块')}<div class="settings-stack">
  <section class="settings-card"><h2>账号</h2><div class="identity">${accountAvatar()}<strong>${esc(account.displayName||account.email||'Daniel')}</strong></div><div class="button-row">${button('修改昵称','setting-section','','data-value="nickname"')}${cloudWorkspace?'':button('修改密码','setting-section','','data-value="password"')}${button('上传头像','setting-section','','data-value="avatar"')}</div></section>
  <section class="settings-card"><h2 id="appearance-heading">外观</h2><div class="button-row" role="group" aria-labelledby="appearance-heading">${[['cool','冷色调'],['warm','暖色调']].map(([key,label])=>button(label,'appearance',appearance===key?'selected':'',`data-value="${key}" aria-pressed="${appearance===key}"`)).join('')}</div></section>
  <section class="settings-card"><h2>小助手与模型</h2><p class="muted">DeepSeek · ${connection.status==='connected'?'已连接':'未连接'}</p><div class="button-row">${button('配置 API Key','setting-section','','data-value="model"')}${button('个性化小助手','setting-section','','data-value="personalization"')}</div></section>
  <section class="settings-card"><h2>数据与备份</h2><div class="button-row">${button('导出备份','export-backup')}${button('从备份导入','import-backup','','title="支持 JSON 备份和旧版 HTML 待办清单"')}</div>${cloudWorkspace?'':toggle('自动备份','auto-backup',settings.autoBackup)}<input hidden id="backup-input" type="file" accept=".json,.html,.htm,application/json,text/html" data-onchange="backup-file"></section>
  ${button('退出登录','logout','danger')}
 </div>`;
 if(ui.section==='nickname')return `${toolbar('修改昵称','设置')}<form class="editor settings-form" data-form="nickname">${field('昵称','nickname',account.displayName,'text','required')}${primary('保存昵称')}</form>`;
 if(ui.section==='password')return `${toolbar('修改密码','设置')}<form class="editor settings-form" data-form="password">${field('当前密码','oldPassword','','password','required')}${field('新密码','newPassword','','password','required minlength="6"')}${field('确认新密码','checkPassword','','password','required')}${primary('保存密码')}</form>`;
 if(ui.section==='avatar')return `${toolbar('上传头像','设置')}<form class="editor settings-form" data-form="avatar"><span>当前头像</span><div class="avatar-preview">${ui.avatarDraft?`<img class="avatar" src="${esc(ui.avatarDraft)}" alt="头像预览">`:accountAvatar()}</div><input name="image" type="file" accept="image/*" data-onchange="avatar-file" required>${primary('确认上传')}</form>`;
 if(ui.section==='model'){
  const model=connection;
  const choices=ui.modelValidated?ui.modelChoices:(model.models||[]);
  const selected=ui.modelValidated?ui.modelChoice:model.model;
  const canSearch=model.model==='deepseek-flash';
  return `${toolbar('小助手与模型','设置')}<div class="editor settings-form">
  ${select('模型厂商','provider',option('DeepSeek','DeepSeek','DeepSeek'))}<p class="muted">当前连接 · ${model.status==='connected'?'已连接':'未连接'}</p>
  ${model.maskedKey?`<p class="muted">当前 API Key <code>${esc(model.maskedKey)}</code></p>`:''}
  <div class="button-row">${button('输入密钥','model-key')}${button('测试连接','model-test','soft')}${button('断开连接','model-disconnect')}</div>
  ${ui.modelValidated?`<section class="guidance"><strong>已获取可用模型</strong><p>确认时会发送一条简短测试消息，验证所选模型能对话。</p>${button('确认连接','model-confirm','primary')}</section>`:''}
  ${select('当前模型','model',choices.map(item=>option(item.id,item.name,selected)).join('')||option(model.model||'',({'demo-flash':'DeepSeek Flash（推荐）','demo-pro':'DeepSeek Pro'})[model.model]||model.model||'连接后选择模型',model.model||''),'data-onchange="model-choice"')}
  ${toggle('联网搜索','search-toggle',model.search,!canSearch)}<p class="muted">${canSearch?'开启后，小助手可按需搜索并显示来源。':'连接并选择 DeepSeek Flash 后可开启联网搜索。'}</p>
  ${toggle('思考模式','thinking-toggle',settings.model.thinking)}<p class="muted">默认关闭。开启后，DeepSeek 可以深入推理，回复可能更慢。从下一条消息生效。</p>
  </div>`;
 }
 const a=ui.assistantDraft||(ui.assistantDraft={...settings.assistant});
 if(ui.section==='assistant-avatars')return `${toolbar('选择助手头像','个性化小助手')}<section class="avatar-picker"><div class="portrait-grid">${portraits.map(([id,name])=>button(`${avatar(id)}${(ui.pickedAvatar||a.avatar)===id?'<span class="portrait-check" aria-hidden="true">✓</span>':''}`,'choose-portrait',(ui.pickedAvatar||a.avatar)===id?'selected':'',`data-value="${id}" aria-label="${name}" aria-pressed="${(ui.pickedAvatar||a.avatar)===id}"`)).join('')}</div>${button('使用此头像','confirm-portrait','primary full')}</section>`;
 const custom=a.style==='custom';
 return `${toolbar('个性化小助手','设置')}<form class="editor settings-form" data-form="assistant">
 <div class="assistant-avatar-row">${button(`${avatar(a.avatar)}<span>助手头像</span><b aria-hidden="true">›</b>`,'assistant-avatars','soft full','aria-label="助手头像"')}</div>
 ${field('小助手的称呼','name',a.name)}${field('小助手怎么称呼你','userName',a.userName,'text',`placeholder="跟随账号昵称（当前：${esc(account.displayName)}）" aria-describedby="assistant-name-hint"`)}
 <small id="assistant-name-hint" class="account-name-hint">留空时跟随账号昵称。</small>
 <span class="field-title">交流风格</span><div class="style-grid">${styles.map(([name,title])=>button(title,'assistant-style',a.style===name?'selected':'',`data-value="${name}"`)).join('')}</div>
 <header class="row-head"><h2>自定义风格</h2>${button('恢复默认','assistant-reset','',custom?'':'disabled')}</header>
 ${area('','customPrompt',(custom&&a.customPrompt)||prompt,`rows="5" aria-label="自定义风格" ${custom?'':'disabled'}`)}
 ${custom?'':'<p class="muted">选择「自定义」后可编辑</p>'}
 <div class="button-row">${button('试聊一句','assistant-trial')}${primary('保存')}</div>
 <details><summary>长期记忆</summary>
 ${area('当前账号的 memory.md','memoryPreview',memoryMarkdown(settings),'rows="5" readonly')}
 ${button('下载 memory.md','memory-export')}
 </details></form>`;
}

export function ideaView(h) {
 const {ui,state,toolbar,field,area,primary,button,esc,empty}=h;
 const idea=ui.idea;
 if(idea)return `${toolbar('记下灵感','灵感池')}<form class="editor idea-editor" data-form="idea">
 ${field('标题（可选）','title',idea.title,'text','placeholder="留空时保存后自动提炼"')}${area('正文','body',idea.body,`rows="8" placeholder="记下你的灵感" ${idea.id?'':'required'}`)}
 ${button('按住说话','idea-voice','voice-button')}<p class="muted centered">追加到正文，可手动修改</p>${primary('确认保存')}
 ${idea.id?`<div class="button-row">${button('删除灵感','idea-delete','danger')}${button('转为正式任务','idea-convert')}</div>`:''}</form>`;
 return `${toolbar('灵感池')}<div class="ideas-list">${state().ideas.map(item=>button(`<span><strong>${esc(item.title)}</strong><small>${esc(item.body)}</small></span><b>›</b>`,'idea-open','idea-tile',`data-id="${esc(item.id)}"`)).join('')||empty('暂无灵感。')}</div><div class="idea-dock">${button('记下灵感','idea-new','soft')}<p class="muted">点按输入文字 · 长按直接说话</p></div>`;
}

export function chatView(h) {
 const {ui,state,button,avatar,esc,primary,safeURL}=h;
 const {trial,messages,pending,draft,progress,searchOpen,searchQuery,limit}=ui.chat;
 const current=state();
 const settings=trial?ui.assistantDraft:current.settings.assistant;
 const timeline=trial?messages:chatTimeline();
 const older=!trial&&timeline.length>limit;
 const visibleMessages=trial?messages:[...timeline.slice(-limit),...dueReminders(current).map(item=>({...item,role:'assistant'}))]
  .sort((a,b)=>(a.at||0)-(b.at||0));
 const controls=trial?(messages.length&&!pending?button('新对话','chat-reset'):''):
  button('<span class="chat-search-icon" aria-hidden="true"></span> 搜索历史对话','chat-search','',pending?'disabled':'');
 const closeButton=button('×','chat-close','icon-button','aria-label="关闭对话"');
 const panel='<div class="chat-scrim" data-action="chat-close"></div><section class="chat" id="assistant-dialog" tabindex="-1" role="dialog" aria-labelledby="chat-heading">';
 if(searchOpen){
  return `${panel}<header>${button('‹ 返回对话','chat-search-back','text-button')}<strong id="chat-heading">搜索历史对话</strong><div class="chat-actions">${closeButton}</div></header>
  <section class="chat-history" aria-label="搜索历史对话"><div class="chat-search-field"><span class="chat-search-icon" aria-hidden="true"></span><input type="search" class="chat-search-input" value="${esc(searchQuery||'')}" aria-label="搜索历史消息" placeholder="输入关键词"></div><div class="chat-search-results">${searchResults(h,searchQuery||'')}</div></section></section>`;
 }
 const header=`${panel}<header><div class="chat-title">${avatar(settings.avatar)}<div><strong id="chat-heading">${esc(settings.name||'小助手')}</strong>${trial?'<small>试聊 · 使用当前设置</small>':''}</div></div><div class="chat-actions">${controls}${closeButton}</div></header>`;
 return `${header}
 <div class="chat-scroll" role="log" ${older?'data-has-older':''}>${older?button('↑ 上滑查看更早消息','chat-older','text-button chat-older'):''}${visibleMessages.map((item,index)=>`${trial?'':chatDateLabel(item,visibleMessages[index-1])}<div class="message ${item.role==='user'?'outgoing':'incoming'}" ${item.messageKey?`data-message-key="${esc(item.messageKey)}" ${item.messageKey===ui.chat.highlighted?'data-highlighted':''}`:''}>${item.role==='user'?'':avatar(settings.avatar)}<div>${esc(item.text)}${item.sources?.length?`<ul class="message-sources">${item.sources.map(source=>{const url=safeURL(source.url);return url?`<li><a href="${url}" target="_blank" rel="noopener noreferrer">${esc(source.title||source.name||'来源')}</a></li>`:'';}).join('')}</ul>`:''}</div></div>`).join('')}
 ${pending&&!ui.chat.pendingChange?`<div class="message incoming">${avatar(settings.avatar)}<div>${esc(progress||'正在思考')} <span class="typing">● ● ●</span></div></div>`:''}
 ${ui.chat.pendingChange?`<section class="guidance" aria-label="待确认的工作台操作"><p>${esc(ui.chat.pendingChange.description)}</p><div class="button-row">${button('取消操作','assistant-cancel')}${button('确认操作','assistant-confirm','primary')}</div></section>`:''}</div>
 <form data-form="chat"><textarea class="chat-input" name="message" rows="1" enterkeyhint="send" placeholder="输入消息" aria-label="输入消息">${esc(draft||'')}</textarea>${primary('发送')}</form></section>`;
}

function syncAssistant(ui) {
 const form=document.querySelector('[data-form="assistant"]');
 if(!form)return;
 for(const name of ['name','userName','customPrompt']){
  const field=form.elements[name]; if(!field.disabled)ui.assistantDraft[name]=field.value;
 }
}
function saveIdeaDraft(ui) {
 const form=document.querySelector('[data-form="idea"]');
 if(form)Object.assign(ui.idea,{title:form.elements.title.value,body:form.elements.body.value});
}
const textTitle=body=>body.trim().split(/[\r\n。！？]/)[0].slice(0,24);
const chatPageSize=10;
const newChat=(trial=false)=>({id:crypto.randomUUID(),trial,messages:[],transcript:[],draft:'',limit:chatPageSize});
let retainedChat=newChat();
let assistantOwner=null;
let sessionChatHistory=[];
const chatHistoryKey=()=>`personal-workbench:chat-history:${cloudWorkspace?'cloud':'local'}:${assistantOwner}`;
function chatHistory() {
 if(!assistantOwner)return [];
 try{
  const stored=JSON.parse(localStorage.getItem(chatHistoryKey())||'[]');
  if(Array.isArray(stored)){
   const known=new Map();
   for(const chat of [...stored,...sessionChatHistory]){
    if(!known.has(chat.id)||chat.updatedAt>=known.get(chat.id).updatedAt)known.set(chat.id,chat);
   }
   return [...known.values()].sort((a,b)=>b.updatedAt-a.updatedAt);
  }
 }catch{}
 return sessionChatHistory;
}
function chatTimeline() {
 return chatHistory().slice().reverse().flatMap(chat=>chat.messages.map((message,index)=>({...message,messageKey:chat.id+':'+index})))
  .sort((a,b)=>(a.at||0)-(b.at||0));
}
function chatDateLabel(message,previous) {
 if(!Number.isFinite(message.at))return '';
 const date=new Date(message.at);
 const day=date.toDateString();
 if(day===new Date(previous?.at).toDateString())return '';
 const label=day===new Date().toDateString()?'今天':date.toLocaleDateString('zh-CN');
 return `<time class="chat-date" datetime="${date.toISOString()}">${label} ${date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time>`;
}
export function searchResults({button,esc}, query) {
 const term=query.trim().toLowerCase();
 if(!term)return '<p class="empty">输入关键词查找历史消息。</p>';
 const matches=chatTimeline().reverse().flatMap(message=>{
  const index=message.text.toLowerCase().indexOf(term);
  return index<0?[]:[{message,index}];
 });
 if(!matches.length)return '<p class="empty">没有找到匹配的消息。</p>';
 return `<p class="chat-result-count" role="status">${matches.length} 条结果</p>`+matches.map(({message,index})=>{
  const text=message.text,start=Math.max(0,index-28),end=index+term.length,stop=Math.min(text.length,end+58);
  const snippet=(start?'…':'')+esc(text.slice(start,index))+'<mark>'+esc(text.slice(index,end))+'</mark>'+esc(text.slice(end,stop))+(stop<text.length?'…':'');
  const date=new Date(message.at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
  return button(`<span><small>${esc(date)} · ${message.role==='user'?'你':'小助手'}</small><span>${snippet}</span></span><b aria-hidden="true">›</b>`,'chat-jump','chat-history-item',`data-id="${esc(message.messageKey)}"`);
 }).join('');
}
function rememberChat(chat) {
 if(chat.trial||!assistantOwner)return true;
 const entry={id:chat.id,messages:structuredClone(chat.messages),updatedAt:Date.now()};
 sessionChatHistory=[entry,...chatHistory().filter(item=>item.id!==entry.id)];
 try{localStorage.setItem(chatHistoryKey(),JSON.stringify(sessionChatHistory));return true;}
 catch{return false;}
}
function cancelPendingChange(chat) {
 if(!chat?.pendingChange)return;
 chat.pendingChange.resolve({ok:false,canceled:true});
 chat.pendingChange=null;
}
export function closeAssistantChat(ui) {
 if(ui.chat?.trial)cancelPendingChange(ui.chat);
 if(ui.chat)Object.assign(ui.chat,{searchOpen:false,searchQuery:'',highlighted:null,limit:chatPageSize,scrollRequest:null});
 ui.chat=null;
}
export function syncAssistantSession(ui, state) {
 const owner=state.session?(cloudWorkspace?cloudWorkspace.getAccountId():state.account.email):null;
 if(owner===assistantOwner)return false;
 assistantOwner=owner;
 sessionChatHistory=[];
 cancelPendingChange(ui.chat);
 cancelPendingChange(retainedChat);
 retainedChat=newChat();
 Object.assign(ui,{chat:null,dialog:null,settingsOrigin:null,idea:null,assistantDraft:null,modelKey:'',modelValidated:false,modelChoices:[],modelChoice:''});
 model.resetSession();
 return true;
}

export async function settingsAction(action,h,event) {
 const {ui,state,api,render,notify,confirmation,openTask,makeId}=h;
 const values=event.type==='submit'?Object.fromEntries(new FormData(event.target)):{};
 const control=event.target.closest('[data-action]')||event.target;
 const {value,id}=control.dataset;
 switch(action){
  case 'auth-mode':if(value==='register'&&!cloudWorkspace&&ui.authMode!==value)refreshCaptcha(ui);ui.authMode=value;ui.authMessage='';render();return;
  case 'toggle-registration-password':{
   const input=document.getElementById('registration-password');
   const toggle=input.form.querySelector('[data-action="toggle-registration-password"]');
   const visible=input.type==='password';
   input.type=visible?'text':'password';
   toggle.textContent=visible?'隐藏':'显示';
   toggle.setAttribute('aria-label',visible?'隐藏密码':'显示密码');
   return;
  }
  case 'captcha':{
   refreshCaptcha(ui);
   const input=document.getElementById('captcha');
   input.form.querySelector('output').textContent=ui.captcha;
   input.value='';
   return;
  }
  case 'demo':await auth.login(demoCredentials);render();return;
  case 'form:auth': {
    const submit=event.target.querySelector('[type="submit"]');
    if(submit?.disabled)return;
    if(submit)submit.disabled=true;
    ui.authEmail=values.email;
    if(cloudWorkspace)ui.keepSignedIn=values.keepSignedIn==='on';
    if(ui.authMode==='reset'){await auth.reset({email:values.email});ui.authMessage='已提交找回密码请求（本地演示，不发送邮件）。';render();return;}
    try{
     const controls={email:values.email,password:values.password,keepSignedIn:ui.keepSignedIn,captchaId:values.captcha?ui.captchaId:undefined,captchaAnswer:values.captcha};
     if(ui.authMode==='register')await auth.register({...controls,displayName:values.nickname});
     else await auth.login(controls);
     ui.authMessage='';ui.authChallenge=false;render();
    }catch(error){ui.authMessage=error.message;if(!cloudWorkspace){ui.authChallenge=auth.challengeRequired(values.email);refreshCaptcha(ui);}render();}
    return;
  }
  case 'setting-section':ui.section=value;ui.avatarDraft='';ui.assistantDraft=null;render();return;
  case 'appearance':{
   if(!['cool','warm'].includes(value)||state().settings.appearance===value)return;
   api.store.update(data=>{data.settings.appearance=value;});
   render();
   document.querySelector('[data-action="appearance"][aria-pressed="true"]')?.focus({preventScroll:true});
   return;
  }
  case 'form:nickname':api.store.update(data=>{data.account.displayName=values.nickname.trim();});ui.section='settings';notify('昵称已保存');return;
  case 'form:password': {
    if(values.newPassword!==values.checkPassword)throw new Error('两次输入的新密码不一致。');
    await auth.changePassword({currentPassword:values.oldPassword,newPassword:values.newPassword});
    ui.section='settings';notify('密码已修改');return;
  }
  case 'avatar-file':{
    const file=event.target.files[0];if(!file)return;
    if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)||file.size>2_000_000)throw new Error('请选择小于 2 MB 的 PNG、JPEG、WebP 或 GIF。');
    ui.avatarDraft=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
    const preview=document.querySelector('.avatar-preview');preview.replaceChildren(Object.assign(new Image(),{src:ui.avatarDraft,alt:'头像预览',className:'avatar'}));return;
  }
  case 'form:avatar':if(!ui.avatarDraft)return;api.store.update(data=>{data.account.avatar=ui.avatarDraft;});ui.section='settings';notify('头像已更新');return;
  case 'export-backup':{
    const data=await api.backup.export();
    const url=URL.createObjectURL(new Blob([typeof data==='string'?data:JSON.stringify(data,null,2)],{type:'application/json'}));
    const a=Object.assign(document.createElement('a'),{href:url,download:`个人工作台-${new Date().toISOString().slice(0,10)}.json`});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
  }
  case 'memory-export':{
    const url=URL.createObjectURL(new Blob([memoryMarkdown(state().settings)],{type:'text/markdown;charset=utf-8'}));
    Object.assign(document.createElement('a'),{href:url,download:'memory.md'}).click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);return;
  }
  case 'import-backup':document.querySelector('#backup-input').click();return;
  case 'backup-file':{
    const file=event.target.files[0];if(!file)return;const text=await file.text();
    const legacy=/\.html?$/i.test(file.name)||file.type==='text/html';
    confirmation('替换当前工作区？','导入将替换当前工作区记录。',async()=>{
      if(legacy)await api.backup.importLegacyHtml(text);else await api.backup.import(text);
      ui.dialog=null;ui.settingsOrigin=null;notify('已导入');
    },null);
    return;
  }
  case 'auto-backup':api.store.update(data=>{data.settings.autoBackup=event.target.checked;});return;
  case 'logout':confirmation('退出登录？','可再次使用当前账号登录。',async()=>{
   await auth.logout();
   model.resetSession();
   Object.assign(ui,{modelKey:'',modelValidated:false,modelChoices:[],modelChoice:''});
   Object.assign(ui,{dialog:null,section:'',chat:null,authMode:'login',authMessage:'',authChallenge:false});
   cancelPendingChange(retainedChat);
   retainedChat=newChat();
   render();
  },null);return;
  case 'model-key':ui.dialog={kind:'model-key'};render();return;
  case 'form:model-key':ui.modelKey=values.key;ui.modelValidated=false;ui.dialog=null;render();return;
  case 'model-test':{
   if(!ui.modelKey)throw new Error('请先输入密钥。');
   ui.modelValidated=false;ui.modelChoices=[];
   const test=await model.test({provider:'DeepSeek',apiKey:ui.modelKey});
   ui.modelKey='';
   ui.modelValidated=test.testId;ui.modelChoices=test.models;ui.modelChoice=(test.models.find(item=>/flash/i.test(item.id))||test.models[0])?.id;render();return;
  }
  case 'model-confirm': {
   const value=document.querySelector('[name="model"]').value;
   const confirmButton=event.target.closest('button');
   confirmButton.disabled=true;
   try{await model.confirm({testId:ui.modelValidated,model:value,search:state().settings.model.search});}
   finally{confirmButton.disabled=false;}
   ui.modelKey='';ui.modelValidated=false;ui.modelChoices=[];notify('DeepSeek 已连接');return;
  }
  case 'model-disconnect':await model.disconnect();ui.modelKey='';ui.modelValidated=false;ui.modelChoices=[];render();return;
  case 'model-choice':
   if(ui.modelValidated)ui.modelChoice=event.target.value;
   else if(model.connection.status==='connected') {
    const select=event.target;
    select.disabled=true;
    try{await model.selectModel(select.value);}finally{render();}
   }
   return;
  case 'search-toggle':
   await model.setSearch(event.target.checked);
   return;
  case 'thinking-toggle':api.store.update(data=>{data.settings.model.thinking=event.target.checked;});return;
  case 'assistant-style':syncAssistant(ui);ui.assistantDraft.style=value;render();return;
  case 'assistant-reset':syncAssistant(ui);ui.assistantDraft.customPrompt=prompt;render();return;
  case 'assistant-avatars':syncAssistant(ui);ui.pickedAvatar=ui.assistantDraft.avatar;ui.section='assistant-avatars';render();return;
  case 'choose-portrait':ui.pickedAvatar=value;render();return;
  case 'confirm-portrait':ui.assistantDraft.avatar=ui.pickedAvatar;ui.section='personalization';render();return;
  case 'form:assistant':syncAssistant(ui);api.store.update(data=>{data.settings.assistant={...ui.assistantDraft,name:ui.assistantDraft.name.trim()||'小助手'};});ui.assistantDraft=null;ui.section='settings';notify('助手设置已保存');return;
  case 'assistant-trial':syncAssistant(ui);closeAssistantChat(ui);ui.chat=newChat(true);await sendChat(h,'我今天先做什么？');return;
  case 'chat-toggle':
   if(ui.chat)closeAssistantChat(ui);
   else {ui.chat=retainedChat;markRemindersRead(api,dueReminders(state()));}
   render();return;
  case 'chat-close':closeAssistantChat(ui);render();return;
  case 'chat-reset':
   if(ui.chat&&!ui.chat.pending){
    ui.chat=newChat(ui.chat.trial);
    if(!ui.chat.trial)retainedChat=ui.chat;
    render();
    document.querySelector('.chat-input')?.focus();
   }
   return;
  case 'chat-search':
   if(!ui.chat||ui.chat.trial||ui.chat.pending)return;
   ui.chat.searchPosition=document.querySelector('.chat:not([inert]) .chat-scroll')?.scrollTop;
   ui.chat.searchOpen=true;
   render();
   document.querySelector('.chat-search-input')?.focus();
   return;
  case 'chat-search-back':
   if(!ui.chat?.searchOpen)return;
   ui.chat.searchOpen=false;
   ui.chat.scrollRequest={top:ui.chat.searchPosition};
   render();
   document.querySelector('.chat [data-action="chat-search"]')?.focus({preventScroll:true});
   return;
  case 'chat-jump':{
   if(!ui.chat?.searchOpen)return;
   const timeline=chatTimeline();
   const index=timeline.findIndex(message=>message.messageKey===id);
   if(index<0)return;
   ui.chat.limit=Math.max(ui.chat.limit,timeline.length-index);
   ui.chat.searchOpen=false;
   ui.chat.highlighted=id;
   ui.chat.scrollRequest={key:id,center:true};
   render();
   document.querySelector('.chat:not([inert])')?.focus({preventScroll:true});
   return;
  }
  case 'chat-older':{
   const scroll=document.querySelector('.chat:not([inert]) .chat-scroll[data-has-older]');
   if(!scroll||!ui.chat)return;
   const oldest=scroll.querySelector('[data-message-key]');
   if(!oldest)return;
   ui.chat.scrollRequest={key:oldest.dataset.messageKey,offset:oldest.getBoundingClientRect().top-scroll.getBoundingClientRect().top};
   ui.chat.limit+=chatPageSize;
   render();
   return;
  }
  case 'assistant-cancel':
  case 'assistant-confirm':{
   const chat=ui.chat;
   const change=chat?.pendingChange;
   if(!change)return;
   chat.pendingChange=null;
   render();
   try{
    const confirm=action==='assistant-confirm'&&state().session&&assistantOwner===change.owner;
    const result=confirm?{ok:true,message:await change.perform()}:{ok:false,canceled:true};
    change.resolve(result);
   }catch(error){
    change.resolve({ok:false,error:error.message});
   }
   return;
  }
  case 'form:chat':await sendChat(h,event.target.elements.message.value);return;
  case 'idea-new':ui.idea={title:'',body:''};render();return;
  case 'idea-open':ui.idea=structuredClone(state().ideas.find(item=>item.id===id));render();return;
  case 'form:idea':{
   saveIdeaDraft(ui);
   if(!ui.idea.title.trim()&&!ui.idea.body.trim()){notify('请填写灵感标题或正文。');return;}
   const idea={...ui.idea,id:ui.idea.id||makeId(),title:ui.idea.title.trim()||textTitle(ui.idea.body)};
   api.store.update(data=>{const current=data.ideas.find(item=>item.id===idea.id);if(current)Object.assign(current,idea);else data.ideas.unshift(idea);});
   ui.idea=null;render();return;
  }
  case 'idea-delete':saveIdeaDraft(ui);confirmation('删除灵感？','已转成任务的内容将保留。',()=>{api.store.update(data=>{data.ideas=data.ideas.filter(item=>item.id!==ui.idea.id);});ui.idea=null;ui.dialog=null;render();},null);return;
  case 'idea-convert':saveIdeaDraft(ui);openTask(null,null,ui.idea);return;
 }
}

async function sendChat(h,text) {
 const {ui,state,render,notify}=h, chat=ui.chat;
 const value=String(text??'');
 if(!chat||chat.pending||!value.trim())return;
 const owner=assistantOwner;
 const isCurrent=()=>owner===assistantOwner&&state().session&&(chat.trial?ui.chat===chat:retainedChat===chat);
 if(!chat.trial){
  chat.transcript=chatTimeline().filter(message=>!message.error).slice(-20).map(({role,text})=>({role,content:text}));
  chat.limit=chatPageSize;
  chat.highlighted=null;
  chat.scrollRequest={latest:true};
 }
 chat.messages.push({role:'user',text:value,at:Date.now()});
 chat.draft='';
 chat.searchOpen=false;
 chat.pending=true;
 rememberChat(chat);
 render();
 try{
  const {settings,account}=state();
  const response=await model.send({
   text:value,transcript:chat.transcript,thinking:settings.model.thinking,isCurrent,
   assistant:chat.trial?ui.assistantDraft:settings.assistant,accountName:account.displayName,
   memory:memoryMarkdown(settings),
   onProgress(name, text){
    chat.progress=text||(name==='read_workspace'?'正在查询工作台…':name==='change_workspace'?'正在处理工作台操作…':'正在处理…');
    if(ui.chat===chat)render();
   },
   async runTool(name,args){
    await cloudWorkspace?.readForAssistant();
    if(!isCurrent())throw new Error('会话已关闭或账号已变化。');
    const result=await runWorkspaceTool(api,name,args,(description,perform)=>new Promise(resolve=>{
     chat.pendingChange={description,perform,owner,resolve};
     if(ui.chat===chat)render();
    }));
    if(result?.ok!==false&&name!=='read_workspace')await cloudWorkspace?.readForAssistant();
    return result;
   },
  });
  if(isCurrent())chat.messages.push({role:'assistant',text:response.body,sources:response.sources,at:Date.now()});
 }catch(error){if(isCurrent())chat.messages.push({role:'assistant',text:error.message,error:true,at:Date.now()});}
 chat.pending=false;
 chat.progress='';
 const saved=!isCurrent()||rememberChat(chat);
 if(ui.chat===chat){
  if(saved)render();else notify('浏览器存储不可用，本次对话仅在当前页面保留。');
  const reply=chat.messages.at(-1);
  if(reply?.role==='assistant')document.querySelector('#assistant-announcement').textContent=reply.text;
 }
}

export function bindVoice(h) {
 const {ui,render,notify}=h;
 let press;
 let blockClick=false;
 const voiceTarget='.assistant-launcher,.chat-input,.voice-button,[data-action="idea-new"]';
 const keyboardFallback='可以点进输入框，用手机键盘的语音键输入。';
 const voiceErrors={
  'not-allowed':'浏览器未授权语音输入，请检查此网站的麦克风权限。',
  'audio-capture':'浏览器无法打开麦克风，请检查设备权限或是否被其他应用占用。',
  'network':'浏览器的语音转写服务连接失败。',
  'service-not-allowed':'此浏览器的语音转写服务不可用。',
  'language-not-supported':'此浏览器的转写服务不支持中文。',
  'no-speech':'没有听到声音，请按住说话后再松手。',
 };
 document.addEventListener('click',event=>{if(blockClick&&event.target.closest(voiceTarget)){event.stopPropagation();event.preventDefault();blockClick=false;}},true);
 document.addEventListener('contextmenu',event=>{
  if(press&&event.target.closest(voiceTarget)===press.node)event.preventDefault();
 });
 const cancelRecording=gesture=>{
  gesture.canceled=true;
  gesture.overlay?.remove();
  try{gesture.recognizer?.abort();}catch{}
 };
 const submitRecording=gesture=>{
  if(gesture.owner!==assistantOwner)return;
  if(!gesture.released||gesture.canceled||gesture.submitted||!gesture.transcript)return;
  gesture.submitted=true;
  if(gesture.node.matches('.assistant-launcher,.chat-input')){
   if(!ui.chat)ui.chat=retainedChat;
   sendChat(h,gesture.transcript);
  }else{
   if(ui.idea)saveIdeaDraft(ui);else ui.idea={title:'',body:''};
   ui.idea.body+=(ui.idea.body?'\n':'')+gesture.transcript;
   render();
  }
 };
 document.addEventListener('pointerdown',event=>{
  const node=event.target.closest(voiceTarget);
  if(!node||event.button!==0||press)return;
  if(node.matches('.assistant-launcher,.voice-button,[data-action="idea-new"]'))node.setPointerCapture(event.pointerId);
  const gesture={id:event.pointerId,x:event.clientX,y:event.clientY,node,owner:assistantOwner};
  press=gesture;
  gesture.timer=setTimeout(()=>{
   if(press!==gesture||gesture.dragged)return;
   blockClick=true;
   const Speech=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition;
   if(!Speech){notify('当前浏览器未提供语音转写。'+keyboardFallback);return;}
   const recognizer=new Speech();gesture.recognizer=recognizer;recognizer.lang='zh-CN';
   recognizer.onstart=()=>{
    if(gesture.released&&!gesture.canceled){try{recognizer.stop();}catch{}}
   };
   recognizer.onresult=result=>{
    gesture.transcript=[...result.results].map(item=>item[0].transcript).join('');
    submitRecording(gesture);
   };
   recognizer.onerror=event=>{
    gesture.overlay?.remove();
    if(gesture.canceled||gesture.owner!==assistantOwner)return;
    gesture.canceled=true;
    notify((voiceErrors[event.error]||'浏览器未能完成语音转写。')+keyboardFallback);
   };
   recognizer.onend=()=>{gesture.overlay?.remove();};
   try{
    const recording=document.createElement('div');recording.className='voice-overlay';recording.setAttribute('role','status');
    recording.innerHTML='<div><strong>正在听</strong><span class="wave" aria-hidden="true">▂▅▇▃▆</span><p>继续说话，松手转写</p></div>';
    gesture.overlay=recording;
    document.body.appendChild(recording);
    recognizer.start();
   }catch{
    cancelRecording(gesture);
    notify('无法启动语音转写。');
   }
  },450);
 });
 document.addEventListener('pointermove',event=>{
  if(!press||press.id!==event.pointerId||!press.node.matches('.assistant-launcher')||Math.hypot(event.clientX-press.x,event.clientY-press.y)<12)return;
  clearTimeout(press.timer);
  if(!press.dragged)cancelRecording(press);
  press.dragged=true;blockClick=true;
  press.lastX=event.clientX;
  press.node.style.left=Math.max(6,Math.min(innerWidth-58,event.clientX-26))+'px';
  press.node.style.top=Math.max(60,Math.min(innerHeight-65,event.clientY-26))+'px';
  press.node.style.bottom='auto';
 });
 for(const name of ['pointerup','pointercancel'])document.addEventListener(name,event=>{
  if(!press||press.id!==event.pointerId)return;
  const gesture=press;
  press=null;
  clearTimeout(gesture.timer);
  if(gesture.dragged){
   const dock=gesture.node,x=event.type==='pointercancel'?gesture.lastX:event.clientX;
   dock.style.left=x<innerWidth/2?'12px':'auto';
   dock.style.right=x<innerWidth/2?'auto':'12px';
   ui.launcher={left:dock.style.left,right:dock.style.right,top:dock.style.top};
  }
  if(event.type==='pointercancel')cancelRecording(gesture);
  else if(!gesture.canceled){
   gesture.released=true;
   gesture.overlay?.remove();
   try{gesture.recognizer?.stop();}catch{}
   submitRecording(gesture);
  }
  setTimeout(()=>{blockClick=false;},180);
 });
}
