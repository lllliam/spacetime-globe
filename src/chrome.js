/* 地球视图只决定表面显示，年份仍由年份入口控制。 */
const chrome = {panel:false, labels:true, grid:false, natural:false, followTime:true};
const viewPanel = el('view-panel'), viewHead = el('view-head'), viewShade = el('view-shade');
const viewModes = [...viewPanel.querySelectorAll('[data-view]')];
let viewMotion = null, viewDrag = null, viewOpeningPress = false;
try {
  const display = JSON.parse(localStorage.getItem('globe.display.v4') || '{}');
  chrome.labels = display.labels !== false;
  chrome.grid = display.grid === true;
} catch {}

function syncChrome() {
  const mode = chrome.natural ? 'nature' : chrome.followTime ? 'history' : 'modern';
  for (const button of viewModes) button.setAttribute('aria-pressed', String(button.dataset.view === mode));
  el('toggle-labels').setAttribute('aria-checked', String(chrome.labels));
  el('toggle-labels').disabled = chrome.natural;
  el('toggle-grid').setAttribute('aria-checked', String(chrome.grid));

  let status = '';
  if (state.layerId === 'polity') {
    if (state.year < -3400) status = '此前暂无疆域资料';
    else if (state.year > POLITY_END) status = '疆域资料截至 ' + POLITY_END + ' 年';
    else if (polityState.error) status = '历史疆域加载失败';
  }
  elSub.textContent = status;
  elSub.hidden = !status;
  el('view-caption').textContent = mode === 'nature' ? '浏览海陆与地形。'
    : mode === 'modern' ? '以今天的边界定位，选年后仍使用这张底图。'
    : status ? status + '。'
    : state.layerId === 'country' ? '今天显示现代边界，选择过往年份可查看历史疆域。'
    : '随年份显示历史疆域，点选可阅读。';
}

function moveView(from, to, duration, onFinish) {
  viewMotion?.cancel();
  const translate = y => 'translateY(' + y + 'px)';
  viewPanel.style.transform = translate(to);
  if (reducedReadingMotion.matches) {
    viewMotion = null;
    onFinish?.();
    return;
  }
  const motion = viewPanel.animate([{transform:translate(from)}, {transform:translate(to)}], {
    duration, easing:'cubic-bezier(.22,.76,.24,1)',
  });
  viewMotion = motion;
  motion.onfinish = () => {
    if (viewMotion !== motion) return;
    viewMotion = null;
    onFinish?.();
  };
}

function closeView(focus = true) {
  if (!chrome.panel) return;
  const offset = Math.max(0, viewPanel.getBoundingClientRect().top - viewPanel.offsetTop);
  chrome.panel = false;
  viewDrag = null;
  viewPanel.inert = true;
  canvas.inert = el('hud').inert = false;
  if (focus) canvas.focus({preventScroll:true});
  moveView(offset, viewPanel.offsetHeight, 200, () => {
    viewPanel.hidden = viewShade.hidden = true;
    invalidate();
  });
}

function focusActiveView() {
  viewModes.find(button => button.getAttribute('aria-pressed') === 'true').focus({preventScroll:true});
}

function showView(fromHold = false) {
  if (worldEvent || reading.active || !overlay.hidden || chrome.panel) return;
  closeYearControl();
  closeSheet();
  cancelZoom();
  stopPanReturn();
  momentum.yaw = momentum.tilt = 0;
  pointers.clear();
  drag = pinch = null;
  chrome.panel = true;
  viewOpeningPress = fromHold;
  viewPanel.style.transform = '';
  viewPanel.hidden = viewShade.hidden = viewPanel.inert = false;
  el('view-options').open = false;
  viewPanel.scrollTop = 0;
  canvas.inert = el('hud').inert = true;
  syncChrome();
  focusActiveView();
  moveView(viewPanel.offsetHeight, 0, 290);
  invalidate();
}

function selectView(mode) {
  if (!viewModes.some(button => button.dataset.view === mode)) return;
  chrome.followTime = mode === 'history';
  chrome.natural = mode === 'nature';
  commitYear(state.year);
}

function commitYear(year) {
  if (!Number.isFinite(year)) return;
  year = clamp(Math.round(year), YMIN, YMAX);
  state.year = year === 0 ? 1 : year;
  const layer = chrome.followTime && state.year <= POLITY_END ? 'polity' : 'country';
  if (state.layerId !== layer) setLayer(layer);
  else onYearChanged();
}
function stepYear(delta) { commitYear(yearAtIndex(ord(state.year) + delta)); }

function resetView() {
  closeSheet(); cancelZoom(); stopPanReturn();
  momentum.yaw = momentum.tilt = 0;
  Object.assign(state,{yaw:-1.42,tilt:.30,zoom:1,panX:0,panY:0,lift:0}); layout(); invalidate();
}

let globeHold = null;
function cancelGlobeHold() {
  clearTimeout(globeHold?.timer);
  globeHold = null;
}
canvas.addEventListener('pointerdown', event => {
  cancelGlobeHold();
  if (!event.isPrimary || event.button !== 0 || !mapPointAt(event.clientX, event.clientY)) return;
  globeHold = {x:event.clientX, y:event.clientY, timer:setTimeout(() => { cancelGlobeHold(); showView(true); }, 500)};
});
canvas.addEventListener('pointermove', event => {
  if (globeHold && Math.hypot(event.clientX - globeHold.x, event.clientY - globeHold.y) > 9) cancelGlobeHold();
});
for (const type of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(type, cancelGlobeHold);
canvas.addEventListener('contextmenu', event => {
  event.preventDefault();
  if (event.button === 2 && mapPointAt(event.clientX, event.clientY)) showView();
});
canvas.addEventListener('keydown', event => {
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    event.preventDefault();
    showView();
  }
});

viewHead.addEventListener('pointerdown', event => {
  if (!chrome.panel || !event.isPrimary || event.button !== 0 || event.target.closest('button')) return;
  const offset = Math.max(0, viewPanel.getBoundingClientRect().top - viewPanel.offsetTop);
  viewPanel.style.transform = 'translateY(' + offset + 'px)';
  viewMotion?.cancel();
  viewMotion = null;
  viewDrag = {id:event.pointerId, start:event.clientY - offset, offset};
  viewHead.setPointerCapture(event.pointerId);
});
viewHead.addEventListener('pointermove', event => {
  if (viewDrag?.id !== event.pointerId) return;
  viewDrag.offset = Math.max(0, event.clientY - viewDrag.start);
  viewPanel.style.transform = 'translateY(' + viewDrag.offset + 'px)';
});
for (const type of ['pointerup','pointercancel','lostpointercapture']) {
  viewHead.addEventListener(type, event => {
    if (viewDrag?.id !== event.pointerId) return;
    const {offset} = viewDrag;
    viewDrag = null;
    if (type === 'pointerup' && offset >= 68) closeView();
    else moveView(offset, 0, 200);
  });
}

el('view-close').addEventListener('click', () => closeView());
// 长按抬手时的合成点击不能操作刚出现的面板。
addEventListener('pointerdown', () => { viewOpeningPress = false; }, true);
addEventListener('click', event => {
  if (!chrome.panel || !viewOpeningPress || !event.detail) return;
  viewOpeningPress = false;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!viewPanel.contains(document.activeElement)) focusActiveView();
}, true);
viewShade.addEventListener('pointerdown', event => {
  if (event.isPrimary && event.button === 0) closeView();
});
for (const button of viewModes) button.addEventListener('click', () => selectView(button.dataset.view));
for (const [id,key] of [['toggle-labels','labels'],['toggle-grid','grid']]) {
  el(id).addEventListener('click', () => {
    chrome[key] = !chrome[key];
    try { localStorage.setItem('globe.display.v4', JSON.stringify({labels:chrome.labels, grid:chrome.grid})); } catch {}
    syncChrome();
    invalidate();
  });
}
el('reset-view').addEventListener('click', resetView);
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelGlobeHold(); });

addEventListener('keydown', event => {
  if (!chrome.panel) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeView();
  } else if (event.key === 'Tab') {
    const focusable = [...viewPanel.querySelectorAll('button:not(:disabled),summary')].filter(node => node.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (!viewPanel.contains(document.activeElement)) { event.preventDefault(); focusActiveView(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
}, true);
