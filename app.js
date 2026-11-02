'use strict';
const $ = id => document.getElementById(id);
const defaults = () => ({version: 1, title: '我的夯到拉排行榜', tiers: [
  {id:'t0',name:'夯',color:'#ff7979'}, {id:'t1',name:'顶级',color:'#ffb276'},
  {id:'t2',name:'人上人',color:'#ffe18a'}, {id:'t3',name:'NPC',color:'#9fdbad'}, {id:'t4',name:'拉',color:'#8db9e8'}
], items: [], order: {t0:[],t1:[],t2:[],t3:[],t4:[],pool:[]}});
let state = defaults(), selected = null, history = [], db, saveChain = Promise.resolve(), revision = 0, savedRevision = 0, importing = false;
let toastTimer, drag = null, ignoreClickUntil = 0, recordMode = 'screen', recordFiles = 0;
const codes = ['S','A','B','C','D'];
function toast(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4200); }
function saveStatus(text, error = false) { $('saveStatus').textContent = text; $('saveStatus').classList.toggle('error', error); }
function snapshot() {
  // Immutable image strings are shared; avoid duplicating megabytes of image data in undo history.
  history.push({ ...state, tiers: state.tiers.map(t => ({...t})), items: state.items.map(i => ({...i})), order: Object.fromEntries(Object.entries(state.order).map(([k,v]) => [k,[...v]])) });
  if (history.length > 20) history.shift();
}
function save() {
  const current = ++revision;
  if (!db) { saveStatus('未能自动保存，请保存项目', true); return; }
  saveStatus('正在保存…');
  const copy = structuredClone(state);
  saveChain = saveChain.catch(() => {}).then(() => new Promise((resolve, reject) => {
    const tx = db.transaction('boards','readwrite'); tx.objectStore('boards').put(copy, 'current');
    tx.oncomplete = () => { savedRevision = current; if (revision === current) saveStatus('已自动保存到本机'); resolve(); };
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('保存失败'));
  })).catch(() => { saveStatus('保存失败，请保存项目备份', true); toast('本地存储不可用或空间不足，请点击“保存项目”备份。'); });
}
function commit() { render(); save(); }
function itemById(id) { return state.items.find(i => i.id === id); }
function tile(item) {
  const button = document.createElement('button'); button.className = 'tile'; button.dataset.item = item.id;
  button.setAttribute('aria-label', `选择图片：${item.name}`); button.classList.toggle('selected', selected === item.id);
  const img = new Image(); img.src = item.src; img.alt = item.name; img.draggable = false;
  const label = document.createElement('span'); label.textContent = item.name; button.append(img, label); return button;
}
function fillZone(zone, ids, hint) {
  ids.forEach(id => { const item = itemById(id); if (item) zone.append(tile(item)); });
  if (!ids.length && hint) { const label = document.createElement('span'); label.className = 'zone-hint'; label.textContent = hint; zone.append(label); }
}
function render() {
  $('boardTitle').value = state.title; $('board').replaceChildren();
  state.tiers.forEach((tier, index) => {
    const row = document.createElement('div'); row.className = 'tier';
    const label = document.createElement('div'); label.className = 'tier-label'; label.style.background = tier.color;
    const name = document.createElement('span'); name.textContent = tier.name;
    const sub = document.createElement('small'); sub.textContent = `${codes[index]} TIER`; label.append(name, sub);
    const zone = document.createElement('div'); zone.className = 'dropzone'; zone.dataset.zone = tier.id; zone.setAttribute('aria-label', `${tier.name}分级`);
    fillZone(zone,state.order[tier.id], '把你的选择拖到这里'); row.append(label,zone); $('board').append(row);
  });
  $('pool').replaceChildren(); fillZone($('pool'),state.order.pool);
  if (!state.order.pool.length) {
    const empty = document.createElement('div'); empty.className = 'empty-pool';
    const title = document.createElement('b'); title.textContent = state.items.length ? '全员就位，排名完成。' : '把图片拖到这里，开启你的榜单';
    const sub = document.createElement('small'); sub.textContent = '支持批量上传 / 粘贴截图 · JPG、PNG、WebP、GIF、AVIF'; empty.append(title,sub);
    if (!state.items.length) { const demo = document.createElement('button'); demo.textContent = '先用示例体验一下 →'; demo.onclick = addDemo; empty.append(document.createElement('br'),demo); }
    $('pool').append(empty);
  }
  $('poolCount').textContent = state.order.pool.length;
  $('rankCount').textContent = `${state.items.length - state.order.pool.length} / ${state.items.length} 已排名`;
  $('undoBtn').disabled = !history.length; renderPreview();
}
function renderPreview() {
  const item = itemById(selected); $('itemTools').hidden = !item;
  document.querySelectorAll('.tile').forEach(el => el.classList.toggle('selected',el.dataset.item === selected));
  if (!item) { $('preview').innerHTML = '<div class="preview-empty"><span>◎</span><p>点一张图片<br><small>放大看看，再做决定</small></p></div>'; return; }
  const img = new Image(); img.src = item.src; img.alt = item.name; $('preview').replaceChildren(img); $('itemName').value = item.name;
  $('moveTarget').replaceChildren();
  [...state.tiers,{id:'pool',name:'待排名'}].forEach(t => { const option = new Option(t.name,t.id); $('moveTarget').add(option); });
  $('moveTarget').value = Object.keys(state.order).find(key => state.order[key].includes(selected));
}
function move(id, zone, before = null) {
  if (!itemById(id) || !state.order[zone] || before === id) return;
  snapshot(); for (const list of Object.values(state.order)) { const index = list.indexOf(id); if (index >= 0) list.splice(index,1); }
  const list = state.order[zone]; const index = before ? list.indexOf(before) : -1;
  list.splice(index < 0 ? list.length : index,0,id); selected = id; commit();
}
function shiftSelected(delta) {
  const key = Object.keys(state.order).find(k => state.order[k].includes(selected)); if (!key) return;
  const list = state.order[key], index = list.indexOf(selected), next = index + delta;
  if (next < 0 || next >= list.length) return; snapshot(); [list[index],list[next]] = [list[next],list[index]]; commit();
}
async function imageFromFile(file) {
  if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type)) throw new Error('不支持该图片格式');
  if (file.size > 20 * 1024 * 1024) throw new Error('单张图片超过 20 MB');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const scale = Math.min(1,640 / Math.max(img.naturalWidth,img.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1,Math.round(img.naturalWidth*scale)); canvas.height = Math.max(1,Math.round(img.naturalHeight*scale));
    canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
    return {id:crypto.randomUUID(),name:file.name.replace(/\.[^.]+$/,'').slice(0,60) || '未命名图片',src:canvas.toDataURL('image/webp',.9)};
  } finally { URL.revokeObjectURL(url); }
}
async function importImages(files) {
  if (importing) return toast('图片正在处理中，请稍候。');
  const all = [...files]; if (!all.length) return;
  if (state.items.length + all.length > 300) return toast('每个项目最多 300 张图片，请分成多个项目。');
  importing = true; $('uploadBtn').disabled = true; let failed = 0; const added = [];
  for (const file of all) { try { added.push(await imageFromFile(file)); } catch { failed++; } }
  if (added.length) { snapshot(); state.items.push(...added); state.order.pool.push(...added.map(i => i.id)); commit(); }
  importing = false; $('uploadBtn').disabled = false; $('imageInput').value = '';
  toast(`已添加 ${added.length} 张图片${failed ? `；${failed} 张格式不支持、损坏或超过 20 MB` : ''}`);
}
function addDemo() {
  if (state.items.length) return;
  snapshot();
  const examples = [['🍔','汉堡','#694936'],['🍕','披萨','#664052'],['🍜','拉面','#355d61'],['🍣','寿司','#6d4c47'],['🍟','薯条','#685f34'],['🥟','饺子','#4f5871'],['🍦','冰淇淋','#605270'],['☕','咖啡','#385b4a']];
  for (const [emoji,name,color] of examples) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 320; const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0,0,320,320); ctx.font = '150px "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(emoji,160,150);
    const item = {id:crypto.randomUUID(),name,src:canvas.toDataURL('image/png')}; state.items.push(item); state.order.pool.push(item.id);
  }
  state.title = '今天吃什么？美食夯到拉'; commit(); toast('示例已就位，试着把图片拖到上方分级。');
}
function clearDrag() {
  if (drag?.ghost) drag.ghost.remove(); document.querySelectorAll('.drag-source,.over,.insert-before,.insert-after').forEach(el => el.classList.remove('drag-source','over','insert-before','insert-after')); drag = null;
}
document.addEventListener('pointerdown', event => {
  const tileEl = event.target.closest('.tile'); if (!tileEl || event.button !== 0) return;
  drag = {id:tileEl.dataset.item,el:tileEl,x:event.clientX,y:event.clientY,pointer:event.pointerId,active:false};
  tileEl.setPointerCapture(event.pointerId);
});
document.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.pointer) return;
  if (!drag.active && Math.hypot(event.clientX-drag.x,event.clientY-drag.y) < 6) return;
  event.preventDefault();
  if (!drag.active) { drag.active = true; drag.ghost = drag.el.cloneNode(true); drag.ghost.classList.add('drag-ghost'); drag.ghost.removeAttribute('data-item'); document.body.append(drag.ghost); drag.el.classList.add('drag-source'); }
  drag.ghost.style.left = `${event.clientX - 35}px`; drag.ghost.style.top = `${event.clientY - 35}px`;
  document.querySelectorAll('.over,.insert-before,.insert-after').forEach(el => el.classList.remove('over','insert-before','insert-after'));
  const target = document.elementFromPoint(event.clientX,event.clientY), zone = target?.closest('.dropzone'); drag.zone = zone?.dataset.zone; drag.before = null;
  if (zone) {
    zone.classList.add('over'); const tileEl = target.closest('.tile');
    if (tileEl && tileEl.dataset.item !== drag.id) { const rect = tileEl.getBoundingClientRect(), after = event.clientX > rect.left + rect.width / 2; const ids = state.order[drag.zone].filter(id => id !== drag.id); drag.before = after ? ids[ids.indexOf(tileEl.dataset.item)+1] || null : tileEl.dataset.item; tileEl.classList.add(after ? 'insert-after' : 'insert-before'); }
    else if (tileEl?.dataset.item === drag.id) drag.before = drag.id;
  }
  if (event.clientY > innerHeight-55) window.scrollBy(0,16); else if (event.clientY < 75) window.scrollBy(0,-16);
},{passive:false});
document.addEventListener('pointerup', event => {
  if (!drag || event.pointerId !== drag.pointer) return;
  const result = {...drag}; clearDrag();
  if (result.active) { ignoreClickUntil = Date.now()+300; if (result.zone) move(result.id,result.zone,result.before); }
});
document.addEventListener('pointercancel',clearDrag);
document.addEventListener('click',event => { const el = event.target.closest('.tile'); if (el && Date.now() > ignoreClickUntil) { selected = el.dataset.item; renderPreview(); } });
let fileDepth = 0;
document.addEventListener('dragenter',e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); fileDepth++; $('fileOverlay').hidden = false; } });
document.addEventListener('dragover',e => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
document.addEventListener('dragleave',e => { if ([...e.dataTransfer.types].includes('Files')) { fileDepth = Math.max(0,fileDepth-1); if (!fileDepth) $('fileOverlay').hidden = true; } });
document.addEventListener('drop',e => { e.preventDefault(); fileDepth = 0; $('fileOverlay').hidden = true; if (e.dataTransfer.files.length) importImages(e.dataTransfer.files); });
document.addEventListener('paste',e => { const files = [...(e.clipboardData?.files || [])]; if (files.length) { e.preventDefault(); importImages(files); } });
function filename(ext) { return `${state.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,50) || '夯到拉'}-${new Date().toISOString().replace(/[:.]/g,'-')}.${ext}`; }
function download(blob,name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url),60000); }
function fitText(ctx,text,x,y,width) { while (ctx.measureText(text).width > width && text.length > 1) text = text.slice(0,-2)+'…'; ctx.fillText(text,x,y); }
async function exportImage() {
  $('exportBtn').disabled = true;
  try {
    const boardState = structuredClone(state), images = new Map();
    await Promise.all(boardState.items.map(async item => { const image = new Image(); image.src = item.src; await image.decode(); images.set(item.id,image); }));
    const width = 1600, pad = 48, labelWidth = 150, size = 120, gap = 12, columns = Math.floor((width-pad*2-labelWidth-gap)/(size+gap));
    const rows = [...boardState.tiers]; if (boardState.order.pool.length) rows.push({id:'pool',name:'待排名',color:'#abb3be'});
    const heights = rows.map(t => Math.max(1,Math.ceil(boardState.order[t.id].length/columns))*(size+gap)+gap);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = 188 + heights.reduce((a,b) => a+b,0)+pad;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#111419'; ctx.fillRect(0,0,width,canvas.height);
    ctx.fillStyle = '#d2f76b'; ctx.font = 'bold 20px "Microsoft YaHei", sans-serif'; ctx.fillText('夯到拉 / YOUR TASTE. YOUR TIERS.',pad,48);
    ctx.fillStyle = '#eef0f3'; ctx.font = 'bold 40px "Microsoft YaHei", sans-serif'; fitText(ctx,boardState.title,pad,112,width-pad*2);
    let y = 160;
    rows.forEach((tier,rowIndex) => {
      const height = heights[rowIndex]; ctx.fillStyle = '#20252e'; ctx.fillRect(pad,y,width-pad*2,height-2); ctx.fillStyle = tier.color; ctx.fillRect(pad,y,labelWidth,height-2);
      ctx.fillStyle = '#171b21'; ctx.font = 'bold 28px "Microsoft YaHei",sans-serif'; ctx.textAlign = 'center'; fitText(ctx,tier.name,pad+labelWidth/2,y+height/2+10,labelWidth-20); ctx.textAlign = 'left';
      boardState.order[tier.id].forEach((id,index) => {
        const img = images.get(id), item = boardState.items.find(i => i.id === id), x = pad+labelWidth+gap+(index%columns)*(size+gap), iy = y+gap+Math.floor(index/columns)*(size+gap);
        ctx.fillStyle = '#12161c'; ctx.fillRect(x,iy,size,size); const scale = Math.min(size/img.naturalWidth,size/img.naturalHeight); const w = img.naturalWidth*scale,h = img.naturalHeight*scale; ctx.drawImage(img,x+(size-w)/2,iy+(size-h)/2,w,h);
        ctx.fillStyle = '#000b'; ctx.fillRect(x,iy+size-25,size,25); ctx.fillStyle = '#fff'; ctx.font = '14px "Microsoft YaHei",sans-serif'; ctx.textAlign = 'center'; fitText(ctx,item.name,x+size/2,iy+size-8,size-10); ctx.textAlign = 'left';
      }); y += height;
    });
    const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/png')); if (!blob) throw new Error('图片过大'); download(blob,filename('png')); toast('高清 PNG 已导出，包含未排名图片。');
  } catch { toast('导出失败，请减少图片数量后重试。'); } finally { $('exportBtn').disabled = false; }
}
function validateProject(data) {
  if (!data || data.version !== 1 || typeof data.title !== 'string' || data.title.length > 50 || !Array.isArray(data.tiers) || data.tiers.length !== 5 || !Array.isArray(data.items) || data.items.length > 300 || !data.order || typeof data.order !== 'object') throw new Error('项目格式无效');
  const tiers = data.tiers.map((tier,index) => { if (tier.id !== `t${index}` || typeof tier.name !== 'string' || !tier.name.trim() || tier.name.length > 12 || !/^#[0-9a-f]{6}$/i.test(tier.color)) throw new Error('分级无效'); return {id:tier.id,name:tier.name,color:tier.color}; });
  const ids = new Set();
  const items = data.items.map(item => { if (!item || typeof item.id !== 'string' || item.id.length > 100 || ids.has(item.id) || typeof item.name !== 'string' || item.name.length > 60 || typeof item.src !== 'string' || item.src.length > 4*1024*1024 || !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(item.src)) throw new Error('图片数据无效'); ids.add(item.id); return {id:item.id,name:item.name,src:item.src}; });
  const used = new Set(), order = {};
  for (const key of [...tiers.map(t => t.id),'pool']) { const list = data.order[key]; if (!Array.isArray(list)) throw new Error('排序无效'); order[key] = list.map(id => { if (!ids.has(id) || used.has(id)) throw new Error('图片排序重复或丢失'); used.add(id); return id; }); }
  if (used.size !== ids.size) throw new Error('图片排序不完整');
  return {version:1,title:data.title,tiers,items,order};
}
async function restoreProject(file) {
  if (!file || importing) return;
  if (file.size > 100*1024*1024) return toast('项目文件过大，最多 100 MB。');
  importing = true;
  try {
    const data = validateProject(JSON.parse(await file.text()));
    for (const item of data.items) { const image = new Image(); image.src = item.src; await image.decode(); }
    snapshot(); state = data; selected = null; commit(); toast('项目已恢复，可撤销此次替换。');
  } catch (error) { toast(`无法打开项目：${error.message}`); }
  finally { importing = false; $('projectInput').value = ''; }
}
function focusMode(enabled) { document.body.classList.toggle('focus',enabled); $('focusBar').hidden = !enabled; }
function formatTime(ms) { const total = Math.floor(ms/1000); return `${Math.floor(total/60).toString().padStart(2,'0')}:${(total%60).toString().padStart(2,'0')}`; }
const recorder = new LocalRecorder(phase => {
  const idle = phase === 'idle', active = ['recording','paused'].includes(phase);
  ['screenMode','audioMode','micToggle','systemToggle'].forEach(id => $(id).disabled = !idle || (id === 'micToggle' && recordMode === 'audio'));
  $('startRecord').hidden = active || phase === 'stopping'; $('startRecord').disabled = !idle;
  $('startRecord').textContent = phase === 'starting' ? '正在等待授权…' : recordMode === 'screen' ? '● 开始录屏' : '● 开始录音';
  document.querySelector('.record-controls').hidden = !active; $('focusStop').hidden = !active;
  $('pauseRecord').textContent = phase === 'paused' ? '▶ 继续' : 'Ⅱ 暂停';
  document.querySelector('.recording-panel').classList.toggle('recording',!idle);
  const source = [recorder.hasMic ? '麦克风' : '', recorder.hasSystem ? '屏幕声音' : ''].filter(Boolean).join(' + ') || '无声音';
  $('recordStatus').textContent = {idle: recordFiles ? '录制完成，请在下方下载' : '准备好，开始你的锐评',starting:'请完成浏览器授权',recording:`录制中 · ${source}`,paused:'已暂停 · 点击继续恢复',stopping:'正在生成录制文件…'}[phase];
}, (blob,mode,duration) => {
  recordFiles++;
  const url = URL.createObjectURL(blob), file = document.createElement('div'); file.className = 'recording-file';
  const label = document.createElement('strong'); label.textContent = `${mode === 'audio' ? '录音' : '录屏'} ${recordFiles} · ${formatTime(duration)} · ${(blob.size/1024/1024).toFixed(1)} MB`;
  const media = document.createElement(mode === 'audio' ? 'audio' : 'video'); media.src = url; media.controls = true; media.preload = 'metadata';
  const ext = blob.type.includes('mp4') ? (mode === 'audio' ? 'm4a' : 'mp4') : 'webm';
  const a = document.createElement('a'); a.href = url; a.download = filename(ext); a.textContent = `↓ 下载${mode === 'audio' ? '录音' : '录屏'}（${ext.toUpperCase()}）`;
  file.append(label,media,a); $('recordings').prepend(file); $('recordStatus').textContent = '录制完成，请在下方下载';
  focusMode(false); toast('录制已完成，文件已生成，请下载保存。');
}, message => { $('recordStatus').textContent = message; toast(message); });
setInterval(() => { const text = formatTime(recorder.duration()); $('recordTimer').textContent = text; $('focusTimer').textContent = ['recording','paused'].includes(recorder.phase) ? `${recorder.phase === 'paused' ? 'Ⅱ' : '●'} ${text}` : ''; },250);
function setMode(mode) {
  if (recorder.phase !== 'idle') return; recordMode = mode;
  ['screen','audio'].forEach(m => { $(`${m}Mode`).classList.toggle('active',m === mode); $(`${m}Mode`).setAttribute('aria-pressed',String(m === mode)); });
  $('systemRow').hidden = mode === 'audio'; $('micToggle').disabled = mode === 'audio'; if (mode === 'audio') $('micToggle').checked = true;
  $('startRecord').textContent = mode === 'audio' ? '● 开始录音' : '● 开始录屏';
  $('recordHint').textContent = mode === 'audio' ? '只录制麦克风声音。开始时请允许浏览器访问麦克风。' : '选择要录制的标签页、窗口或屏幕。共享声音需在浏览器弹窗中勾选。';
}
$('screenMode').onclick = () => setMode('screen'); $('audioMode').onclick = () => setMode('audio');
$('startRecord').onclick = () => recorder.start(recordMode,$('micToggle').checked,$('systemToggle').checked);
$('pauseRecord').onclick = () => recorder.pause(); $('stopRecord').onclick = $('focusStop').onclick = () => recorder.stop();
$('uploadBtn').onclick = () => $('imageInput').click(); $('imageInput').onchange = e => importImages(e.target.files);
$('boardTitle').onchange = e => { snapshot(); state.title = e.target.value.trim() || '我的夯到拉排行榜'; commit(); };
$('itemName').onchange = e => { const item = itemById(selected); if (item) { snapshot(); item.name = e.target.value.trim() || '未命名图片'; commit(); } };
$('moveBtn').onclick = () => move(selected,$('moveTarget').value); $('leftBtn').onclick = () => shiftSelected(-1); $('rightBtn').onclick = () => shiftSelected(1);
$('deleteBtn').onclick = () => { if (!itemById(selected)) return; snapshot(); state.items = state.items.filter(i => i.id !== selected); for (const key in state.order) state.order[key] = state.order[key].filter(id => id !== selected); selected = null; commit(); toast('图片已移除，可点击撤销恢复。'); };
$('undoBtn').onclick = () => { if (!history.length) return; state = history.pop(); selected = null; commit(); toast('已撤销上一步'); };
$('resetBtn').onclick = () => { if (!state.items.length) return; snapshot(); state.order.pool = [...state.tiers.flatMap(t => state.order[t.id]),...state.order.pool]; state.tiers.forEach(t => state.order[t.id] = []); commit(); toast('已全部移回待排名，可撤销。'); };
$('backupBtn').onclick = () => { download(new Blob([JSON.stringify(state)],{type:'application/json'}),filename('json')); toast('项目已导出，包含图片和排名。'); };
$('restoreBtn').onclick = () => $('projectInput').click(); $('projectInput').onchange = e => restoreProject(e.target.files[0]); $('exportBtn').onclick = exportImage;
$('focusBtn').onclick = () => focusMode(true); $('exitFocus').onclick = () => focusMode(false);
$('helpBtn').onclick = () => $('helpDialog').showModal(); document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => $(button.dataset.close).close());
$('editTiersBtn').onclick = () => {
  $('tierFields').replaceChildren();
  state.tiers.forEach((tier,index) => { const row = document.createElement('div'); row.className = 'tier-field'; const code = document.createElement('span'); code.textContent = codes[index]; const color = document.createElement('input'); color.type = 'color'; color.value = tier.color; color.name = `color${index}`; color.setAttribute('aria-label',`${codes[index]}级颜色`); const name = document.createElement('input'); name.type = 'text'; name.value = tier.name; name.name = `name${index}`; name.maxLength = 12; name.required = true; name.setAttribute('aria-label',`${codes[index]}级名称`); row.append(code,color,name); $('tierFields').append(row); }); $('tiersDialog').showModal();
};
$('tiersForm').onsubmit = e => { e.preventDefault(); const form = new FormData(e.target); snapshot(); state.tiers.forEach((tier,index) => { tier.name = form.get(`name${index}`).trim() || tier.name; tier.color = form.get(`color${index}`); }); $('tiersDialog').close(); commit(); };
document.addEventListener('keydown',e => { if (e.key === 'Escape') { clearDrag(); focusMode(false); } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { e.preventDefault(); $('undoBtn').click(); } });
window.addEventListener('beforeunload',e => { if (recorder.phase !== 'idle' || recordFiles || revision !== savedRevision) { e.preventDefault(); e.returnValue = ''; } });
async function init() {
  try {
    db = await new Promise((resolve,reject) => { const request = indexedDB.open('hang-to-la-local',1); request.onupgradeneeded = () => request.result.createObjectStore('boards'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const existing = await new Promise((resolve,reject) => { const request = db.transaction('boards').objectStore('boards').get('current'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    if (existing) state = validateProject(existing); saveStatus('已自动保存到本机');
  } catch { saveStatus('存档不可用，请保存项目备份',true); }
  render();
}
init();
