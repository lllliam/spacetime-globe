/* 地球视图只决定表面显示，年份仍由年份入口控制。 */
const chrome = {panel:false, labels:true, grid:false, natural:false, followTime:true};
const viewPanel = el('view-panel'), viewShade = el('view-shade'), hudViewBtn = el('hud-view');
const viewModes = [...viewPanel.querySelectorAll('[data-view]')];
let viewMotion = null, viewOpeningPress = false, resetAnim = 0;
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
  hudViewBtn.setAttribute('aria-expanded', String(chrome.panel));
  hudViewBtn.classList.toggle('active', chrome.panel || mode !== 'history' || chrome.grid);

  let status = '';
  if (state.layerId === 'polity') {
    if (state.year < -3400) status = '此前暂无疆域资料';
    else if (state.year > POLITY_END) status = '疆域资料截至 ' + POLITY_END + ' 年';
    else if (polityState.error) status = '历史疆域加载失败';
  }
  elSub.textContent = status;
  elSub.hidden = !status;
}

function animateViewPopover(opening, onFinish) {
  viewMotion?.cancel();
  if (reducedReadingMotion.matches) {
    viewMotion = null;
    viewPanel.style.opacity = opening ? '1' : '0';
    viewPanel.style.transform = opening ? 'none' : 'translateY(-6px) scale(.97)';
    onFinish?.();
    return;
  }
  const from = opening
    ? { opacity: 0, transform: 'translateY(-6px) scale(.97)' }
    : { opacity: 1, transform: 'translateY(0) scale(1)' };
  const to = opening
    ? { opacity: 1, transform: 'translateY(0) scale(1)' }
    : { opacity: 0, transform: 'translateY(-6px) scale(.97)' };
  const motion = viewPanel.animate([from, to], {
    duration: opening ? 210 : 150,
    easing: 'cubic-bezier(.22,.82,.26,1)',
    fill: 'forwards',
  });
  viewMotion = motion;
  motion.onfinish = () => {
    if (viewMotion !== motion) return;
    viewMotion = null;
    viewPanel.style.opacity = '';
    viewPanel.style.transform = '';
    onFinish?.();
  };
}

function closeView(focus = true) {
  if (!chrome.panel) return;
  chrome.panel = false;
  viewPanel.inert = true;
  canvas.inert = el('hud').inert = false;
  syncChrome();
  if (focus) canvas.focus({preventScroll:true});
  animateViewPopover(false, () => {
    if (chrome.panel) return;
    viewPanel.hidden = viewShade.hidden = true;
    invalidate();
  });
}

function focusActiveView() {
  viewModes.find(button => button.getAttribute('aria-pressed') === 'true')?.focus({preventScroll:true});
}

function showView(fromHold = false) {
  if (worldEvent || reading.active || !overlay.hidden) return;
  if (chrome.panel) { closeView(false); return; }
  document.body.classList.remove('chrome-hidden');
  closeYearControl();
  closeSheet();
  cancelZoom();
  stopPanReturn();
  cancelResetAnim();
  momentum.yaw = momentum.tilt = 0;
  pointers.clear();
  drag = pinch = null;
  chrome.panel = true;
  viewOpeningPress = fromHold;
  viewPanel.hidden = viewShade.hidden = viewPanel.inert = false;
  canvas.inert = el('hud').inert = true;
  syncChrome();
  focusActiveView();
  animateViewPopover(true);
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

function cancelResetAnim() {
  cancelAnimationFrame(resetAnim);
  resetAnim = 0;
}

function resetView(animate = true) {
  closeSheet();
  cancelZoom();
  stopPanReturn();
  cancelResetAnim();
  momentum.yaw = momentum.tilt = 0;
  const target = { yaw: -1.42, tilt: 0.30, zoom: 1, panX: 0, panY: 0, lift: 0 };
  if (!animate || reducedGlobeMotion.matches) {
    Object.assign(state, target);
    layout();
    invalidate();
    return;
  }
  const from = { yaw: state.yaw, tilt: state.tilt, zoom: state.zoom, panX: state.panX, panY: state.panY, lift: state.lift || 0 };
  let dyaw = ((target.yaw - from.yaw + Math.PI) % TAU + TAU) % TAU - Math.PI;
  const start = performance.now(), dur = 440;
  const step = (now) => {
    const t = clamp((now - start) / dur, 0, 1);
    const k = 1 - Math.pow(1 - t, 3);
    state.yaw = from.yaw + dyaw * k;
    state.tilt = lerp(from.tilt, target.tilt, k);
    state.zoom = lerp(from.zoom, target.zoom, k);
    state.panX = lerp(from.panX, target.panX, k);
    state.panY = lerp(from.panY, target.panY, k);
    state.lift = lerp(from.lift, target.lift, k);
    view.cy = (view.cyBase || view.cy) - state.lift;
    view.Rz = view.R * state.zoom;
    invalidate();
    if (t < 1) resetAnim = requestAnimationFrame(step);
    else { resetAnim = 0; Object.assign(state, target); layout(); invalidate(); }
  };
  resetAnim = requestAnimationFrame(step);
}

let globeHold = null;
function cancelGlobeHold() {
  clearTimeout(globeHold?.timer);
  globeHold = null;
}
canvas.addEventListener('pointerdown', event => {
  cancelGlobeHold();
  cancelResetAnim();
  if (!event.isPrimary || event.button !== 0 || !mapPointAt(event.clientX, event.clientY)) return;
  globeHold = {x:event.clientX, y:event.clientY, timer:setTimeout(() => { cancelGlobeHold(); showView(true); }, 520)};
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

// 长按抬手时的合成点击不能操作刚出现的浮层。
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
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelGlobeHold(); });

addEventListener('keydown', event => {
  if (!chrome.panel) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeView();
  } else if (event.key === 'Tab') {
    const focusable = [...viewPanel.querySelectorAll('button:not(:disabled)')].filter(node => node.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (!viewPanel.contains(document.activeElement)) { event.preventDefault(); focusActiveView(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
}, true);

hudViewBtn.addEventListener('click', () => showView());
