/* 时间和观察方式是两个独立入口，后续边界类型通过 VIEW_MODES 扩展。 */
const VIEW_MODES = [
  {id:'history', title:'历史疆域', note:'政权边界随年份变化 · 前3400—2024', layer:'polity'},
  {id:'modern', title:'现代国家', note:'以现代边界定位历史', layer:'country'},
  {id:'nature', title:'自然地理', note:'观察地形与海陆', layer:'country'},
];
const chrome = {timeline:false, panel:false, labels:true, grid:false, natural:false, followTime:true, playing:false, timer:0, playTimer:0};
const timeDock = el('dock'), viewPanel = el('view-panel'), viewToggle = el('view-toggle');
el('year-input').max = YMAX;
track.setAttribute('aria-valuemax',YMAX);
try { const p=JSON.parse(localStorage.getItem('globe.display.v4')||'{}'); chrome.labels=p.labels!==false; chrome.grid=p.grid===true; } catch {}
el('view-modes').innerHTML = VIEW_MODES.map(m=>'<button type="button" data-view="'+m.id+'" aria-pressed="false"><i></i><span><strong>'+m.title+'</strong><small>'+m.note+'</small></span></button>').join('');
function saveDisplay() { try { localStorage.setItem('globe.display.v4',JSON.stringify({labels:chrome.labels,grid:chrome.grid})); } catch {} }
function syncChrome() {
  const mode=chrome.natural?'nature':state.layerId==='polity'?'history':'modern';
  for(const b of viewPanel.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed',String(b.dataset.view===mode));
  el('toggle-labels').setAttribute('aria-checked',String(chrome.labels));
  el('toggle-grid').setAttribute('aria-checked',String(chrome.grid));
  el('time-current').textContent=elYear.textContent;
  track.setAttribute('aria-valuenow',state.year);
  track.setAttribute('aria-valuetext',elYear.textContent);
  el('time-play').textContent=chrome.playing?'暂停':state.year>=YMAX?'从头播放':'播放';
  el('time-play').setAttribute('aria-pressed',String(chrome.playing));
  if(chrome.natural) elSub.textContent='自然地理 · 现代海陆底图';
  else if(state.layerId==='country') elSub.textContent='现代国家 · 现代边界参考';
  else if(polityState.loading&&!polityState.loaded) elSub.textContent='正在加载历史疆域';
  else if(polityState.error&&!polityState.loaded) elSub.textContent='历史疆域加载失败 · 在视图中重试';
  else elSub.textContent=state.year<-3400?'此前暂无疆域数据':state.year>POLITY_END?'疆域资料截至2024年':'历史疆域';
}
function stopTime() { clearInterval(chrome.playTimer); chrome.playing=false; syncChrome(); }
function scheduleTimelineHide() {
  clearTimeout(chrome.timer);
  if(!chrome.timeline) return;
  chrome.timer=setTimeout(()=>{
    if(scrubbing||chrome.playing||timeDock.contains(document.activeElement)&&document.activeElement.tagName==='INPUT') { scheduleTimelineHide(); return; }
    hideTimeline(false);
  },6500);
}
function showTimeline() {
  closeView(false); closeSheet();
  chrome.timeline=true; document.body.classList.add('time-open'); timeDock.inert=false;
  elYear.setAttribute('aria-expanded','true'); layoutTrack(); drawTrack(); scheduleTimelineHide();
}
function hideTimeline(focus=false) {
  clearTimeout(chrome.timer); stopTime();
  chrome.timeline=false; document.body.classList.remove('time-open'); timeDock.inert=true;
  el('year-form').hidden=true; el('time-input-toggle').setAttribute('aria-expanded','false');
  elYear.setAttribute('aria-expanded','false');
  if(focus||timeDock.contains(document.activeElement)) elYear.focus({preventScroll:true});
}
function closeView(focus=true) {
  chrome.panel=false; viewPanel.hidden=true; el('view-shade').hidden=true;
  viewToggle.setAttribute('aria-expanded','false');
  if(focus) viewToggle.focus({preventScroll:true});
}
function showView() {
  hideTimeline(false); closeSheet(); chrome.panel=true;
  viewPanel.hidden=false; el('view-shade').hidden=false;
  viewToggle.setAttribute('aria-expanded','true');
  viewPanel.querySelector('[aria-pressed="true"]').focus({preventScroll:true});
}
function selectView(mode) {
  const m=VIEW_MODES.find(m=>m.id===mode); if(!m)return;
  stopTime(); chrome.followTime=false; chrome.natural=mode==='nature';
  if(state.layerId===m.layer) onYearChanged(); else setLayer(m.layer);
  if(mode==='history'&&!polityState.loaded) ensurePolity();
  closeView();
}
function commitYear(year) {
  if(!Number.isFinite(year))return;
  year=clamp(Math.round(year),YMIN,YMAX); if(year===0)year=1;
  if(chrome.followTime) {
    chrome.natural=false;
    const layer=year>POLITY_END?'country':'polity';
    state.year=year;
    if(state.layerId!==layer) {setLayer(layer);return;}
  }
  state.year=year; onYearChanged();
}
function stepYear(delta) { let y=state.year+delta; if(y===0)y=delta<0?-1:1; commitYear(y); scheduleTimelineHide(); }
function resetView() {
  closeView(false); closeSheet(); cancelAnimationFrame(zoomAnim); spinning=false;
  momentum.yaw=momentum.tilt=0;
  Object.assign(state,{yaw:-1.42,tilt:.30,zoom:1,panX:0,panY:0,lift:0}); layout(); invalidate();
}
elYear.addEventListener('click',()=>chrome.timeline?hideTimeline():showTimeline());
el('time-close').addEventListener('click',()=>hideTimeline(true));
viewToggle.addEventListener('click',()=>chrome.panel?closeView():showView());
el('view-close').addEventListener('click',()=>closeView());
el('view-shade').addEventListener('click',()=>closeView());
viewPanel.addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)selectView(b.dataset.view);});
for(const [id,key] of [['toggle-labels','labels'],['toggle-grid','grid']]) el(id).addEventListener('click',()=>{chrome[key]=!chrome[key];saveDisplay();syncChrome();invalidate();});
el('reset-view').addEventListener('click',resetView);
el('world-open').addEventListener('click',()=>{closeView(false);openWorld();});
timeDock.addEventListener('pointerdown',scheduleTimelineHide);
timeDock.addEventListener('pointerup',scheduleTimelineHide);
timeDock.addEventListener('keydown',scheduleTimelineHide);
for(const b of timeDock.querySelectorAll('[data-year-step]'))b.addEventListener('click',()=>{stopTime();stepYear(Number(b.dataset.yearStep));});
el('time-play').addEventListener('click',()=>{
  if(chrome.playing){stopTime();scheduleTimelineHide();return;}
  if(state.year>=YMAX)commitYear(YMIN);
  chrome.playing=true; syncChrome();
  chrome.playTimer=setInterval(()=>{
    if(document.hidden){stopTime();return;}
    stepYear(Number(el('time-speed').value));
    if(state.year>=YMAX)stopTime();
  },700);
});
el('time-today').addEventListener('click',()=>{stopTime();chrome.followTime=true;commitYear(YMAX);scheduleTimelineHide();});
el('time-input-toggle').addEventListener('click',()=>{
  stopTime(); const form=el('year-form');form.hidden=!form.hidden;
  el('time-input-toggle').setAttribute('aria-expanded',String(!form.hidden));
  if(!form.hidden){el('year-input').value=state.year;el('year-error').textContent='';el('year-input').focus({preventScroll:true});el('year-input').select();}
  scheduleTimelineHide();
});
el('year-form').addEventListener('submit',e=>{
  e.preventDefault(); const y=Number(el('year-input').value);
  if(!Number.isInteger(y)||y===0||y<YMIN||y>YMAX){el('year-error').textContent='请输入前3500年至'+YMAX+'年之间的整数，没有公元0年。';return;}
  el('year-error').textContent=''; commitYear(y);el('year-form').hidden=true;
  el('time-input-toggle').setAttribute('aria-expanded','false');el('time-input-toggle').focus();scheduleTimelineHide();
});
canvas.addEventListener('pointerdown',()=>{hideTimeline(false);closeView(false);});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopTime();});
// 观察面板限定Tab范围，Esc先关闭当前工具；输入年份时不把方向键交给地球。
addEventListener('keydown',e=>{
  if(e.key==='Escape'&&(chrome.panel||chrome.timeline)){e.preventDefault();e.stopImmediatePropagation();if(chrome.panel)closeView();else hideTimeline(true);return;}
  if(chrome.panel&&e.key==='Tab'){
    const a=[...viewPanel.querySelectorAll('button,a[href]')],first=a[0],last=a[a.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }
},true);
if(inlineText('atlas'))el('classic-link').href='classic.offline.html';
