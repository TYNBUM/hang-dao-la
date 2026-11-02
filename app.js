'use strict';
const $ = id => document.getElementById(id);
const classicColors = ['#ff0000','#ff9900','#ffff00','#ffffcc','#ffffff'];
const oldColors = ['#ff7979','#ffb276','#ffe18a','#9fdbad','#8db9e8'];
const defaults = () => ({version: 1, background: 'white', displayNames: false, title: '我的夯到拉排行榜', tiers: [
  {id:'t0',name:'夯',color:classicColors[0]}, {id:'t1',name:'顶级',color:classicColors[1]},
  {id:'t2',name:'人上人',color:classicColors[2]}, {id:'t3',name:'NPC',color:classicColors[3]}, {id:'t4',name:'拉',color:classicColors[4]}
], items: [], order: {t0:[],t1:[],t2:[],t3:[],t4:[],pool:[],trash:[]}});
let state = defaults(), selected = null, history = [], db, saveChain = Promise.resolve(), revision = 0, savedRevision = 0, importing = false;
let toastTimer, drag = null, ignoreClickUntil = 0, recordMode = 'screen', recordFiles = 0;

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
  const card = document.createElement('div'); card.className = 'tile'; card.dataset.item = item.id; card.title = item.name;
  card.classList.toggle('selected', selected === item.id);
  const button = document.createElement('button'); button.type = 'button'; button.className = 'tile-select';
  button.setAttribute('aria-label', `选择图片：${item.name}`);
  const img = new Image(); img.src = item.src; img.alt = item.name; img.draggable = false;
  const label = document.createElement('span'); label.textContent = item.name; button.append(img,label);
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'tile-remove'; remove.textContent = '×';
  remove.title = '移入垃圾桶'; remove.setAttribute('aria-label', `删除图片：${item.name}`);
  remove.onpointerdown = event => event.stopPropagation();
  remove.onclick = event => { event.stopPropagation(); if (!drag?.active && Date.now() > ignoreClickUntil) move(item.id,'trash'); };
  card.append(button,remove); return card;
}
function fillZone(zone, ids, hint) {
  ids.forEach(id => { const item = itemById(id); if (item) zone.append(tile(item)); });
  if (!ids.length && hint) { const label = document.createElement('span'); label.className = 'zone-hint'; label.textContent = hint; zone.append(label); }
}
function render() {
  $('boardTitle').value = state.title; $('board').replaceChildren();
  const dark = state.background === 'black';
  document.body.classList.toggle('dark', dark); document.documentElement.classList.toggle('dark', dark);
  $('themeSelect').value = dark ? 'black' : 'white'; document.querySelector('meta[name="theme-color"]').content = dark ? '#111111' : '#ffffff';
  document.body.classList.toggle('show-names', !!state.displayNames); $('namesToggle').checked = !!state.displayNames;
  state.tiers.forEach((tier, index) => {
    const row = document.createElement('div'); row.className = 'tier';
    const label = document.createElement('div'); label.className = 'tier-label'; label.style.background = tier.color;
    const name = document.createElement('span'); name.textContent = tier.name;
    label.append(name);
    const zone = document.createElement('div'); zone.className = 'dropzone'; zone.dataset.zone = tier.id; zone.setAttribute('aria-label', `${tier.name}分级`);
    fillZone(zone,state.order[tier.id]); row.append(label,zone); $('board').append(row);
  });
  $('pool').replaceChildren(); fillZone($('pool'),state.order.pool);
  if (!state.order.pool.length) {
    const empty = document.createElement('div'); empty.className = 'empty-pool';
    const title = document.createElement('b'); title.textContent = state.items.length - state.order.trash.length ? '所有图片已排名' : '上传图片，或拖入图片文件';
    const sub = document.createElement('small'); sub.textContent = '支持批量上传 / 粘贴截图 · JPG、PNG、WebP、GIF、AVIF'; empty.append(title,sub);
    if (!state.items.length) { const demo = document.createElement('button'); demo.textContent = '载入示例'; demo.onclick = addDemo; empty.append(document.createElement('br'),demo); }
    $('pool').append(empty);
  }
  $('poolCount').textContent = state.order.pool.length;
  const activeCount = state.items.length - state.order.trash.length;
  $('rankCount').textContent = `${activeCount - state.order.pool.length} / ${activeCount} 已排名`;
  $('trashCount').textContent = state.order.trash.length; renderTrash();
  $('undoBtn').disabled = !history.length; $('clearAllBtn').disabled = !state.items.length; renderPreview();
}
function renderPreview() {
  const item = itemById(selected); $('itemTools').hidden = !item; document.querySelector('.preview-panel').hidden = !item;
  document.querySelectorAll('.tile').forEach(el => el.classList.toggle('selected',el.dataset.item === selected));
  if (!item) { $('preview').innerHTML = '<p class="small">点击图片预览</p>'; return; }
  const img = new Image(); img.src = item.src; img.alt = item.name; $('preview').replaceChildren(img); $('itemName').value = item.name;
  $('itemSource').replaceChildren(); $('itemSource').hidden = !item.bgmId && !item.rankingUrl;
  const subjectUrl = item.rankingUrl || (item.bgmId ? `https://bgm.tv/subject/${item.bgmId}` : null);
  if (subjectUrl) {
    const link = document.createElement('a'); link.href = subjectUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `${item.rankingSource || 'Bangumi'} 条目`; $('itemSource').append(link);
    if (item.coverSourceUrl) { const coverLink = document.createElement('a'); coverLink.href = item.coverSourceUrl; coverLink.target = '_blank'; coverLink.rel = 'noopener noreferrer'; coverLink.textContent = `图片来源：${item.coverSource || '公开页面'}`; $('itemSource').append(' · ', coverLink); }
  }
  if (item.coverNote) { const note = document.createElement('span'); note.className = 'cover-note'; note.textContent = item.coverNote; $('itemSource').append(note); }
  $('moveTarget').replaceChildren();
  [...state.tiers,{id:'pool',name:'待排名'}].forEach(t => { const option = new Option(t.name,t.id); $('moveTarget').add(option); });
  $('moveTarget').value = Object.keys(state.order).find(key => state.order[key].includes(selected));
}
function move(id, zone, before = null) {
  if (!itemById(id) || !state.order[zone] || before === id) return;
  snapshot(); for (const list of Object.values(state.order)) { const index = list.indexOf(id); if (index >= 0) list.splice(index,1); }
  const list = state.order[zone]; const index = before ? list.indexOf(before) : -1;
  list.splice(index < 0 ? list.length : index,0,id); selected = zone === 'trash' ? null : id; commit(); if (zone === 'trash') toast('已放进垃圾桶，可随时恢复。');
}
function shiftSelected(delta) {
  const key = Object.keys(state.order).find(k => state.order[k].includes(selected)); if (!key) return;
  const list = state.order[key], index = list.indexOf(selected), next = index + delta;
  if (next < 0 || next >= list.length) return; snapshot(); [list[index],list[next]] = [list[next],list[index]]; commit();
}
function renderTrash() {
  $('trashList').replaceChildren(); $('restoreAllTrash').disabled = !state.order.trash.length;
  if (!state.order.trash.length) { const text = document.createElement('p'); text.className = 'small'; text.textContent = '垃圾桶是空的'; $('trashList').append(text); return; }
  state.order.trash.forEach(id => {
    const item = itemById(id), row = document.createElement('div'); row.className = 'trash-item';
    const img = new Image(); img.src = item.src; img.alt = item.name;
    const name = document.createElement('span'); name.textContent = item.name;
    const button = document.createElement('button'); button.textContent = '恢复'; button.setAttribute('aria-label', `恢复：${item.name}`); button.onclick = () => move(id,'pool');
    row.append(img,name,button); $('trashList').append(row);
  });
}
const presetSources = {
  bangumi: {label:'Bangumi', global:'BANGUMI_GALGAME_PACK', url:'https://bgm.tv/game/tag/galgame/?sort=rank', rule:'Galgame 标签按排名排序，不同版本分别保留。'},
  vndb: {label:'VNDB', global:'VNDB_GALGAME_PACK', url:'https://vndb.org/v?f=&s=34w', rule:'视觉小说按加权评分排序，包含乙女、BL 等类型。'},
  egs: {label:'批评空间', global:'EGS_GALGAME_PACK', url:'https://erogamescape.dyndns.org/~ap2/ero/toukei_kaiseki/toukei_median.php?count=100&year=1900', rule:'按中位数排序，至少 100 票，保留网站原顺序及不同发行版本。'}
};
const presetPromises = new Map();
const validPresetRef = ref => typeof ref === 'string' && /^(bangumi:[1-9]\d*|vndb:v[1-9]\d*|egs:[1-9]\d*)$/.test(ref);
function itemRefs(item) { return [...(item.presetRefs || []), ...(item.bgmId ? [`bangumi:${item.bgmId}`] : [])]; }
function updatePresetSource() {
  const config = presetSources[$('presetSource').value];
  $('presetRule').textContent = `${config.rule} 快照：2026-11-02。`;
  $('presetSourceLink').textContent = `查看 ${config.label} 原榜单`; $('presetSourceLink').href = config.url;
  $('presetStatus').textContent = '追加到待排名区，保留已有排序。已加入或已丢弃的同一条目会跳过。';
}
function getPresetPack(source) {
  const config = presetSources[source];
  if (window[config.global]) return Promise.resolve(window[config.global]);
  if (!presetPromises.has(source)) {
    const promise = new Promise((resolve,reject) => {
      const script = document.createElement('script'); script.src = `./${source}-galgame.js?v=6`;
      script.onload = () => { if (window[config.global]?.items?.length === 100) resolve(window[config.global]); else { script.remove(); reject(new Error('素材包内容不完整')); } };
      script.onerror = () => { script.remove(); reject(new Error('素材包加载失败，请稍后重试')); };
      document.head.append(script);
    }).catch(error => { presetPromises.delete(source); throw error; });
    presetPromises.set(source,promise);
  }
  return presetPromises.get(source);
}
async function loadPreset(count, source = $('presetSource').value) {
  if (![20,50,100].includes(count) || !Object.hasOwn(presetSources,source)) return;
  if (importing) return toast('图片正在处理中，请稍候。');
  importing = true; $('uploadBtn').disabled = true; $('presetSource').disabled = true; document.querySelectorAll('[data-preset]').forEach(button => button.disabled = true);
  $('presetStatus').textContent = '正在加载封面素材…';
  try {
    const pack = await getPresetPack(source), existing = new Set(state.items.flatMap(itemRefs));
    if (pack.id !== source || !Array.isArray(pack.items) || pack.items.length !== 100) throw new Error('素材包来源或内容无效');
    const candidates = pack.items.slice(0,count).map(item => {
      const ownRef = `${source}:${item.subjectId}`;
      if (!validPresetRef(ownRef) || !Array.isArray(item.presetRefs) || !item.presetRefs.includes(ownRef) || item.presetRefs.length > 3 || !item.presetRefs.every(validPresetRef) || typeof item.name !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(item.src)) throw new Error('素材包数据无效');
      return item;
    });
    const chosen = candidates.filter(item => {
      if (item.presetRefs.some(ref => existing.has(ref))) return false;
      item.presetRefs.forEach(ref => existing.add(ref)); return true;
    });
    if (state.items.length + chosen.length > 300) throw new Error('当前项目最多容纳 300 张图片（含垃圾桶），请改选较少的封面。');
    const added = chosen.map(item => {
      const result = {id:crypto.randomUUID(), name:item.name.slice(0,60), src:item.src, presetRefs:[...item.presetRefs], rankingSource:presetSources[source].label, rankingUrl:item.subjectUrl, coverSource:item.coverSource, coverSourceUrl:item.coverSourceUrl, coverNote:item.coverNote || ''};
      const bgmRef = item.presetRefs.find(ref => ref.startsWith('bangumi:'));
      if (bgmRef) result.bgmId = Number(bgmRef.split(':')[1]);
      return result;
    });
    // Read the current board after loading, so edits during the download are retained.
    if (added.length) { snapshot(); const empty = state.items.length === 0; state.items.push(...added); state.order.pool.push(...added.map(item => item.id)); if (empty) state.title = `Galgame 夯到拉 · ${presetSources[source].label} 前 ${count}`; commit(); }
    const message = `已加入 ${added.length} 张图片，跳过 ${count-added.length} 个已有或已丢弃条目。`;
    $('presetStatus').textContent = message; toast(message); $('materialsDialog').close();
  } catch (error) { $('presetStatus').textContent = error.message; toast(error.message); }
  finally { importing = false; $('uploadBtn').disabled = false; $('presetSource').disabled = false; document.querySelectorAll('[data-preset]').forEach(button => button.disabled = false); }
}
$('materialsBtn').onclick = () => { updatePresetSource(); $('materialsDialog').showModal(); };
$('presetSource').onchange = updatePresetSource;
document.querySelectorAll('[data-preset]').forEach(button => button.onclick = () => loadPreset(Number(button.dataset.preset)));
$('trashTarget').onclick = () => { if (Date.now() > ignoreClickUntil) { renderTrash(); $('trashDialog').showModal(); } };
$('restoreAllTrash').onclick = () => { if (!state.order.trash.length) return; snapshot(); state.order.pool.push(...state.order.trash); state.order.trash = []; commit(); toast('垃圾桶图片已恢复到待排名。'); };
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
  document.body.classList.remove('dragging-item'); if (drag?.ghost) drag.ghost.remove(); document.querySelectorAll('.drag-source,.over,.insert-before,.insert-after').forEach(el => el.classList.remove('drag-source','over','insert-before','insert-after')); drag = null;
}
document.addEventListener('pointerdown', event => {
  if (event.target.closest('.tile-remove')) return;
  const tileEl = event.target.closest('.tile'); if (!tileEl || event.button !== 0) return;
  drag = {id:tileEl.dataset.item,el:tileEl,x:event.clientX,y:event.clientY,pointer:event.pointerId,active:false};
  tileEl.setPointerCapture(event.pointerId);
});
document.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.pointer) return;
  if (!drag.active && Math.hypot(event.clientX-drag.x,event.clientY-drag.y) < 6) return;
  event.preventDefault();
  if (!drag.active) { drag.active = true; drag.ghost = drag.el.cloneNode(true); drag.ghost.classList.add('drag-ghost'); drag.ghost.removeAttribute('data-item'); document.body.append(drag.ghost); drag.el.classList.add('drag-source'); document.body.classList.add('dragging-item'); }
  drag.ghost.style.left = `${event.clientX - 35}px`; drag.ghost.style.top = `${event.clientY - 35}px`;
  document.querySelectorAll('.over,.insert-before,.insert-after').forEach(el => el.classList.remove('over','insert-before','insert-after'));
  const target = document.elementFromPoint(event.clientX,event.clientY), zone = target?.closest('.dropzone'); drag.zone = zone?.dataset.zone; drag.before = null;
  if (zone) {
    zone.classList.add('over'); const tileEl = target.closest('.tile');
    if (drag.zone !== 'trash' && tileEl && tileEl.dataset.item !== drag.id) { const rect = tileEl.getBoundingClientRect(), after = event.clientX > rect.left + rect.width / 2; const ids = state.order[drag.zone].filter(id => id !== drag.id); drag.before = after ? ids[ids.indexOf(tileEl.dataset.item)+1] || null : tileEl.dataset.item; tileEl.classList.add(after ? 'insert-after' : 'insert-before'); }
    else if (tileEl?.dataset.item === drag.id) drag.before = drag.id;
  }
  // Keep the bin and its approach area still; only the board's viewport edges scroll.
  const bin = $('trashTarget').getBoundingClientRect(), board = $('board').getBoundingClientRect();
  const nearBin = event.clientX >= bin.left-48 && event.clientX <= bin.right+48 && event.clientY >= bin.top-48 && event.clientY <= bin.bottom+48;
  const overBoardWidth = event.clientX >= board.left && event.clientX <= board.right;
  if (drag.zone !== 'trash' && !nearBin && overBoardWidth) {
    if (event.clientY > innerHeight-32) window.scrollBy(0,16);
    else if (event.clientY < 32) window.scrollBy(0,-16);
  }
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
    const width = 1600, pad = 24, labelWidth = 180, size = 128, line = 2, columns = Math.floor((width-pad*2-labelWidth-line*2)/size);
    const rows = [...boardState.tiers]; if (boardState.order.pool.length) rows.push({id:'pool',name:'待排名',color:'#ffffff'});
    const heights = rows.map(t => Math.max(1,Math.ceil(boardState.order[t.id].length/columns))*size+line);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = 98 + heights.reduce((a,b) => a+b,0)+pad;
    const dark = boardState.background === 'black', lineColor = dark ? '#777777' : '#111111';
    const ctx = canvas.getContext('2d'); ctx.fillStyle = dark ? '#000000' : '#ffffff'; ctx.fillRect(0,0,width,canvas.height);
    ctx.fillStyle = dark ? '#eeeeee' : '#111111'; ctx.font = 'bold 36px "Microsoft YaHei",sans-serif'; fitText(ctx,boardState.title,pad,58,width-pad*2);
    let y = 96;
    ctx.fillStyle = lineColor; ctx.fillRect(pad,y-line,width-pad*2,line);
    rows.forEach((tier,rowIndex) => {
      const height = heights[rowIndex];
      ctx.fillStyle = tier.color; ctx.fillRect(pad+line,y,labelWidth-line,height-line);
      ctx.fillStyle = lineColor; ctx.fillRect(pad,y,line,height); ctx.fillRect(pad+labelWidth,y,line,height); ctx.fillRect(width-pad-line,y,line,height); ctx.fillRect(pad,y+height-line,width-pad*2,line);
      ctx.fillStyle = '#111111'; ctx.font = 'bold 38px "Microsoft YaHei",sans-serif'; ctx.textAlign = 'center'; fitText(ctx,tier.name,pad+labelWidth/2,y+(height-line)/2+14,labelWidth-20); ctx.textAlign = 'left';
      boardState.order[tier.id].forEach((id,index) => {
        const img = images.get(id), item = boardState.items.find(i => i.id === id), x = pad+labelWidth+line+(index%columns)*size, iy = y+Math.floor(index/columns)*size;
        const scale = Math.min(size/img.naturalWidth,size/img.naturalHeight); const w = img.naturalWidth*scale,h = img.naturalHeight*scale; ctx.drawImage(img,x+(size-w)/2,iy+(size-h)/2,w,h);
        if (boardState.displayNames) { ctx.fillStyle = '#000b'; ctx.fillRect(x,iy+size-25,size,25); ctx.fillStyle = '#fff'; ctx.font = '14px "Microsoft YaHei",sans-serif'; ctx.textAlign = 'center'; fitText(ctx,item.name,x+size/2,iy+size-8,size-10); ctx.textAlign = 'left'; }
      }); y += height;
    });
    const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/png')); if (!blob) throw new Error('图片过大'); download(blob,filename('png')); toast('高清 PNG 已导出，包含未排名图片。');
  } catch { toast('导出失败，请减少图片数量后重试。'); } finally { $('exportBtn').disabled = false; }
}
function validateProject(data) {
  if (!data || data.version !== 1 || typeof data.title !== 'string' || data.title.length > 50 || !Array.isArray(data.tiers) || data.tiers.length !== 5 || !Array.isArray(data.items) || data.items.length > 300 || !data.order || typeof data.order !== 'object') throw new Error('项目格式无效');
  const tiers = data.tiers.map((tier,index) => { if (tier.id !== `t${index}` || typeof tier.name !== 'string' || !tier.name.trim() || tier.name.length > 12 || !/^#[0-9a-f]{6}$/i.test(tier.color)) throw new Error('分级无效'); return {id:tier.id,name:tier.name,color:tier.color}; });
  const ids = new Set();
  const items = data.items.map(item => {
    if (!item || typeof item.id !== 'string' || item.id.length > 100 || ids.has(item.id) || typeof item.name !== 'string' || item.name.length > 60 || typeof item.src !== 'string' || item.src.length > 4*1024*1024 || !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(item.src)) throw new Error('图片数据无效');
    ids.add(item.id); const result = {id:item.id,name:item.name,src:item.src};
    if (Number.isSafeInteger(item.bgmId) && item.bgmId > 0) result.bgmId = item.bgmId;
    if (Array.isArray(item.presetRefs) && item.presetRefs.length <= 3 && item.presetRefs.every(validPresetRef)) result.presetRefs = [...new Set(item.presetRefs)];
    for (const key of ['coverSource','rankingSource','coverNote']) if (typeof item[key] === 'string') result[key] = item[key].slice(0,key === 'coverNote' ? 120 : 60);
    for (const key of ['coverSourceUrl','rankingUrl']) {
      if (typeof item[key] !== 'string' || item[key].length >= 1000) continue;
      try { const url = new URL(item[key]); if (url.protocol === 'https:' && !url.username && !url.password) result[key] = url.href; } catch { /* Ignore invalid optional source links. */ }
    }
    return result;
  });
  const used = new Set(), order = {};
  for (const key of [...tiers.map(t => t.id),'pool','trash']) { const list = key === 'trash' && !Object.hasOwn(data.order,'trash') ? [] : data.order[key]; if (!Array.isArray(list)) throw new Error('排序无效'); order[key] = list.map(id => { if (!ids.has(id) || used.has(id)) throw new Error('图片排序重复或丢失'); used.add(id); return id; }); }
  if (used.size !== ids.size) throw new Error('图片排序不完整');
  return {version:1,background:data.background === 'black' ? 'black' : 'white',displayNames:data.displayNames === true,title:data.title,tiers,items,order};
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
  document.querySelector('.recording-panel').classList.toggle('recording',!idle); $('recordToggle').classList.toggle('is-recording',!idle);
  const source = [recorder.hasMic ? '麦克风' : '', recorder.hasSystem ? '屏幕声音' : ''].filter(Boolean).join(' + ') || '无声音';
  $('recordStatus').textContent = {idle: recordFiles ? '录制完成，请在下方下载' : '未开始录制',starting:'请完成浏览器授权',recording:`录制中 · ${source}`,paused:'已暂停 · 点击继续恢复',stopping:'正在生成录制文件…'}[phase];
}, (blob,mode,duration) => {
  recordFiles++;
  const url = URL.createObjectURL(blob), file = document.createElement('div'); file.className = 'recording-file';
  const label = document.createElement('strong'); label.textContent = `${mode === 'audio' ? '录音' : '录屏'} ${recordFiles} · ${formatTime(duration)} · ${(blob.size/1024/1024).toFixed(1)} MB`;
  const media = document.createElement(mode === 'audio' ? 'audio' : 'video'); media.src = url; media.controls = true; media.preload = 'metadata';
  const ext = blob.type.includes('mp4') ? (mode === 'audio' ? 'm4a' : 'mp4') : 'webm';
  const a = document.createElement('a'); a.href = url; a.download = filename(ext); a.textContent = `↓ 下载${mode === 'audio' ? '录音' : '录屏'}（${ext.toUpperCase()}）`;
  file.append(label,media,a); $('recordings').prepend(file); $('recordStatus').textContent = '录制完成，请在下方下载';
  focusMode(false); setRecordPanel(true); toast('录制已完成，文件已生成，请下载保存。');
}, message => { $('recordStatus').textContent = message; toast(message); });
setInterval(() => { const text = formatTime(recorder.duration()); $('recordToggle').textContent = ['recording','paused'].includes(recorder.phase) ? `${recorder.phase === 'paused' ? '已暂停' : '录制中'} ${text}` : '录音 / 录屏'; $('recordTimer').textContent = text; $('focusTimer').textContent = ['recording','paused'].includes(recorder.phase) ? `${recorder.phase === 'paused' ? 'Ⅱ' : '●'} ${text}` : ''; },250);
function setMode(mode) {
  if (recorder.phase !== 'idle') return; recordMode = mode;
  ['screen','audio'].forEach(m => { $(`${m}Mode`).classList.toggle('active',m === mode); $(`${m}Mode`).setAttribute('aria-pressed',String(m === mode)); });
  $('systemRow').hidden = mode === 'audio'; $('micToggle').disabled = mode === 'audio'; if (mode === 'audio') $('micToggle').checked = true;
  $('startRecord').textContent = mode === 'audio' ? '● 开始录音' : '● 开始录屏';
  $('recordHint').textContent = mode === 'audio' ? '只录制麦克风声音。开始时请允许浏览器访问麦克风。' : '选择要录制的标签页、窗口或屏幕。共享声音需在浏览器弹窗中勾选。';
}
function setRecordPanel(open) { $('recordPanel').hidden = !open; $('recordToggle').setAttribute('aria-expanded', String(open)); }
$('recordToggle').onclick = () => setRecordPanel($('recordPanel').hidden);
$('closeRecordPanel').onclick = () => setRecordPanel(false);
$('closePreview').onclick = () => { selected = null; renderPreview(); };
$('themeSelect').onchange = e => { snapshot(); state.background = e.target.value === 'black' ? 'black' : 'white'; commit(); };
$('namesToggle').onchange = e => { snapshot(); state.displayNames = e.target.checked; commit(); };
$('screenMode').onclick = () => setMode('screen'); $('audioMode').onclick = () => setMode('audio');
$('startRecord').onclick = () => recorder.start(recordMode,$('micToggle').checked,$('systemToggle').checked);
$('pauseRecord').onclick = () => recorder.pause(); $('stopRecord').onclick = $('focusStop').onclick = () => recorder.stop();
$('uploadBtn').onclick = () => $('imageInput').click(); $('imageInput').onchange = e => importImages(e.target.files);
$('boardTitle').onchange = e => { snapshot(); state.title = e.target.value.trim() || '我的夯到拉排行榜'; commit(); };
$('itemName').onchange = e => { const item = itemById(selected); if (item) { snapshot(); item.name = e.target.value.trim() || '未命名图片'; commit(); } };
$('moveBtn').onclick = () => move(selected,$('moveTarget').value); $('leftBtn').onclick = () => shiftSelected(-1); $('rightBtn').onclick = () => shiftSelected(1);
$('deleteBtn').onclick = () => move(selected,'trash');
$('undoBtn').onclick = () => { if (!history.length) return; state = history.pop(); selected = null; commit(); toast('已撤销上一步'); };
$('resetBtn').onclick = () => { if (!state.items.length) return; snapshot(); state.order.pool = [...state.tiers.flatMap(t => state.order[t.id]),...state.order.pool]; state.tiers.forEach(t => state.order[t.id] = []); commit(); toast('已全部移回待排名，可撤销。'); };
$('clearAllBtn').onclick = () => {
  if (importing) return toast('图片正在处理中，请完成后再清空。');
  if (!state.items.length) return;
  clearDrag(); snapshot(); state.items = []; selected = null;
  for (const key of Object.keys(state.order)) state.order[key] = [];
  commit(); toast('已清空全部图片和垃圾桶，点击“撤销”可恢复。');
};
$('backupBtn').onclick = () => { download(new Blob([JSON.stringify(state)],{type:'application/json'}),filename('json')); toast('项目已导出，包含图片和排名。'); };
$('restoreBtn').onclick = () => $('projectInput').click(); $('projectInput').onchange = e => restoreProject(e.target.files[0]); $('exportBtn').onclick = exportImage;
$('focusBtn').onclick = () => focusMode(true); $('exitFocus').onclick = () => focusMode(false);
$('helpBtn').onclick = () => $('helpDialog').showModal(); document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => $(button.dataset.close).close());
$('editTiersBtn').onclick = () => {
  $('tierFields').replaceChildren();
  state.tiers.forEach((tier,index) => { const row = document.createElement('div'); row.className = 'tier-field'; const code = document.createElement('span'); code.textContent = index + 1; const color = document.createElement('input'); color.type = 'color'; color.value = tier.color; color.name = `color${index}`; color.setAttribute('aria-label',`第${index+1}栏颜色`); const name = document.createElement('input'); name.type = 'text'; name.value = tier.name; name.name = `name${index}`; name.maxLength = 12; name.required = true; name.setAttribute('aria-label',`第${index+1}栏名称`); row.append(code,color,name); $('tierFields').append(row); }); $('tiersDialog').showModal();
};
$('tiersForm').onsubmit = e => { e.preventDefault(); const form = new FormData(e.target); snapshot(); state.tiers.forEach((tier,index) => { tier.name = form.get(`name${index}`).trim() || tier.name; tier.color = form.get(`color${index}`); }); $('tiersDialog').close(); commit(); };
document.addEventListener('keydown',e => { if (e.key === 'Escape') { clearDrag(); focusMode(false); } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { e.preventDefault(); $('undoBtn').click(); } });
window.addEventListener('beforeunload',e => { if (recorder.phase !== 'idle' || recordFiles || revision !== savedRevision) { e.preventDefault(); e.returnValue = ''; } });
async function init() {
  try {
    db = await new Promise((resolve,reject) => { const request = indexedDB.open('hang-to-la-local',1); request.onupgradeneeded = () => request.result.createObjectStore('boards'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const existing = await new Promise((resolve,reject) => { const request = db.transaction('boards').objectStore('boards').get('current'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    saveStatus('已自动保存到本机');
    if (existing) {
      state = validateProject(existing);
      if (state.tiers.every((tier,index) => tier.color.toLowerCase() === oldColors[index])) { state.tiers.forEach((tier,index) => tier.color = classicColors[index]); save(); }
    }
  } catch { saveStatus('存档不可用，请保存项目备份',true); }
  render();
}
init();
