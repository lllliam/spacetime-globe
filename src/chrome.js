/* 时间和观察方式是两个独立入口，后续边界类型通过 VIEW_MODES 扩展。 */
const VIEW_MODES = [
  {id:'history', title:'历史疆域', note:'政权边界随年份变化 · 前3400—2024', layer:'polity'},
  {id:'modern', title:'现代国家', note:'以现代边界定位历史', layer:'country'},
  {id:'nature', title:'自然地理', note:'观察地形与海陆', layer:'country'},
];
const chrome = {timeline:false, panel:false, labels:true, grid:false, natural:false, followTime:true, playing:false, timer:0, playTimer:0};
const timeDock = el('dock'), viewPanel = el('view-panel'), homeStory = el('home-story');
const storiesByYear = new Map();
for (const topic of TOPICS) {
  for (const chapter of topic.chapters) {
    const featured = storiesByYear.get(chapter.year);
    if (!featured || (topic.priority || 0) > (featured.topic.priority || 0)) {
      storiesByYear.set(chapter.year, { topic, chapter });
    }
  }
}
function syncHomeStory() {
  if (scrubbing || chrome.playing) return;
  const featured = storiesByYear.get(state.year);
  const label = featured ? featured.chapter.title : '浏览历史专题';
  if (homeStory.textContent !== label) homeStory.textContent = label;
}
function syncHomeZoom() {
  document.body.classList.toggle('globe-zoomed', state.zoom > 1);
}
homeStory.addEventListener('click', () => openHomeReading(storiesByYear.get(state.year)));
el('year-input').max = YMAX;
track.setAttribute('aria-valuemax',YMAX);
try { const p=JSON.parse(localStorage.getItem('globe.display.v4')||'{}'); chrome.labels=p.labels!==false; chrome.grid=p.grid===true; } catch {}
el('view-modes').innerHTML = VIEW_MODES.map(m=>'<button type="button" data-view="'+m.id+'" aria-pressed="false"><i></i><span><strong>'+m.title+'</strong><small>'+m.note+'</small></span></button>').join('');
function saveDisplay() { try { localStorage.setItem('globe.display.v4',JSON.stringify({labels:chrome.labels,grid:chrome.grid})); } catch {} }
function syncChrome() {
  syncHomeStory();
  const mode=chrome.natural?'nature':state.layerId==='polity'?'history':'modern';
  for(const b of viewPanel.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed',String(b.dataset.view===mode));
  el('toggle-labels').setAttribute('aria-checked',String(chrome.labels));
  el('toggle-grid').setAttribute('aria-checked',String(chrome.grid));
  const spokenYear = state.year >= YMAX ? '今天' : fmtYear(state.year) + '年';
  elYear.setAttribute('aria-label', spokenYear + '的全球事件，长按或按 Shift+Enter 展开时间轴');
  track.setAttribute('aria-valuenow',state.year);
  track.setAttribute('aria-valuetext',spokenYear);
  el('time-play').textContent=chrome.playing?'暂停':state.year>=YMAX?'从头播放':'播放';
  el('time-play').setAttribute('aria-pressed',String(chrome.playing));
  let status = '';
  if (state.layerId === 'polity') {
    if (state.year < -3400) status = '此前暂无疆域资料';
    else if (state.year > POLITY_END) status = '疆域资料截至 ' + POLITY_END + ' 年';
    else if (polityState.error) status = '历史疆域加载失败';
  }
  elSub.textContent = status;
  elSub.hidden = !status;
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
  closeWorld(); closeView(false); closeSheet();
  chrome.timeline=true; document.body.classList.add('time-open'); timeDock.inert=false;
  layoutTrack(); drawTrack(); scheduleTimelineHide(); invalidate();
}
function hideTimeline(focus=false) {
  clearTimeout(chrome.timer); stopTime();
  chrome.timeline=false; document.body.classList.remove('time-open'); timeDock.inert=true;
  el('year-form').hidden=true; el('time-input-toggle').setAttribute('aria-expanded','false');
  if(focus||timeDock.contains(document.activeElement)) elYear.focus({preventScroll:true});
  invalidate();
}
function closeView(focus=true) {
  chrome.panel=false; viewPanel.hidden=true; el('view-shade').hidden=true;
  if(focus) canvas.focus({preventScroll:true});
  invalidate();
}
function showView() {
  if (reading.active || !overlay.hidden) return;
  hideTimeline(false); closeSheet(); chrome.panel=true;
  viewPanel.hidden=false; el('view-shade').hidden=false;
  viewPanel.querySelector('[aria-pressed="true"]').focus({preventScroll:true});
  invalidate();
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
  closeView(false); closeSheet(); cancelZoom(); stopPanReturn();
  momentum.yaw=momentum.tilt=0;
  Object.assign(state,{yaw:-1.42,tilt:.30,zoom:1,panX:0,panY:0,lift:0}); layout(); invalidate();
}
// Long press and ordinary activation are mutually exclusive. Dragging and extra
// pointers cancel the hold before the globe's own rotation or pinch can finish.
function bindHold(target, onHold, canStart = () => true) {
  let press = null;
  let ignoreClickUntil = 0;
  function cancel(suppressClick = false) {
    if (!press) return;
    clearTimeout(press.timer);
    if (suppressClick) ignoreClickUntil = performance.now() + 400;
    press = null;
  }
  target.addEventListener('pointerdown', e => {
    if (!e.isPrimary) { cancel(); return; }
    if (e.button !== 0 || !canStart(e)) return;
    ignoreClickUntil = 0;
    const timer = setTimeout(() => {
      ignoreClickUntil = Infinity;
      onHold();
    }, 500);
    press = {id:e.pointerId, x:e.clientX, y:e.clientY, timer};
    try { target.setPointerCapture(e.pointerId); } catch {}
  });
  target.addEventListener('pointermove', e => {
    if (press?.id === e.pointerId && Math.hypot(e.clientX-press.x,e.clientY-press.y)>9) cancel(true);
  });
  for (const event of ['pointerup','pointercancel','lostpointercapture']) {
    target.addEventListener(event, e => {
      if (press?.id === e.pointerId) cancel(ignoreClickUntil === Infinity || event !== 'pointerup');
    });
  }
  target.addEventListener('contextmenu', e => e.preventDefault());
  return event => event.detail > 0 && performance.now() < ignoreClickUntil;
}
const ignoreYearClick = bindHold(elYear, showTimeline);
elYear.addEventListener('click', e => {
  if (ignoreYearClick(e)) return;
  hideTimeline(false);
  closeView(false);
  closeSheet();
  openWorld();
  el('overlay-close').focus({preventScroll:true});
});
elYear.addEventListener('keydown', e => {
  if (e.shiftKey && e.key === 'Enter' && !e.repeat) {
    e.preventDefault();
    showTimeline();
    track.focus({preventScroll:true});
  }
});
bindHold(canvas, showView, e => !!mapPointAt(e.clientX,e.clientY));
canvas.addEventListener('contextmenu', e => {
  if (e.button === 2 && mapPointAt(e.clientX,e.clientY)) showView();
});
canvas.addEventListener('keydown', e => {
  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
    e.preventDefault();
    showView();
  }
});
el('view-close').addEventListener('click',()=>closeView());
el('view-shade').addEventListener('click',()=>closeView());
viewPanel.addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)selectView(b.dataset.view);});
for(const [id,key] of [['toggle-labels','labels'],['toggle-grid','grid']]) el(id).addEventListener('click',()=>{chrome[key]=!chrome[key];saveDisplay();syncChrome();invalidate();});
el('reset-view').addEventListener('click',resetView);
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
