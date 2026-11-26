/* 地球视图只决定表面显示，年份仍由年份入口控制。 */
const chrome = {panel:false, labels:true, grid:false, natural:false, followTime:true};
const viewPanel = el('view-panel'), viewShade = el('view-shade'), hudViewBtn = el('hud-view');
const viewModes = [...viewPanel.querySelectorAll('[data-view]')];
let viewMotion = null, viewOpeningPress = false, resetAnim = 0;
let viewTrigger = canvas;
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
}

function mapYearStatus() {
  if (chrome.natural) return '自然地形';
  if (state.layerId === 'country') return chrome.followTime && state.year > POLITY_END
    ? '现代参考边界 · 历史疆域截至 ' + POLITY_END
    : '现代参考边界 · Natural Earth';
  if (state.year < POLITY_START) return '暂无收录疆域 · 自然底图';
  if (state.year > POLITY_END) return '历史疆域截至 ' + POLITY_END;
  if (polityState.error) return '历史疆域加载失败';
  if (!polityState.loaded) return '正在加载历史疆域…';
  return partition.shapes.length ? '历史疆域' : '该年暂无收录疆域';
}

function explorationLayer(year, followTime, natural) {
  return followTime && !natural && year <= POLITY_END ? 'polity' : 'country';
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
    updateVernier();
    invalidate();
  });
}

function focusActiveView() {
  viewModes.find(button => button.getAttribute('aria-pressed') === 'true')?.focus({preventScroll:true});
}

function showView(fromHold = false, trigger = canvas) {
  if (session.mode !== 'Explore' || !overlay.hidden) return;
  if (chrome.panel) { closeView(false); return; }
  closeYearControl();
  finishVernierMotion();
  closeSheet();
  cancelZoom();
  stopPanReturn();
  cancelResetAnim();
  momentum.yaw = momentum.tilt = 0;
  pointers.clear();
  drag = pinch = null;
  chrome.panel = true;
  viewTrigger = trigger;
  viewOpeningPress = fromHold;
  viewPanel.hidden = viewShade.hidden = viewPanel.inert = false;
  canvas.inert = el('hud').inert = true;
  updateVernier();
  syncChrome();
  focusActiveView();
  animateViewPopover(true);
  invalidate();
}

function selectView(mode) {
  if (session.mode !== 'Explore' || !viewModes.some(button => button.dataset.view === mode)) return;
  chrome.followTime = mode === 'history';
  chrome.natural = mode === 'nature';
  commitYear(state.year);
}

function commitYear(year) {
  if (session.mode !== 'Explore' || !session.validYear(year)) return;
  claimSession();
  exploreIntent();
  pendingPolityTap = null;
  state.year = year;
  const layer = explorationLayer(year, chrome.followTime, chrome.natural);
  if (state.layerId !== layer) setLayer(layer);
  else onYearChanged();
  if (layer === 'polity' && hasHistoricalCoverage(year) && !polityState.loaded) ensurePolity();
  rememberExplore();
  saveSession();
}
function stepYear(delta) { commitYear(yearAtIndex(ord(state.year) + delta)); }

function cancelResetAnim() {
  cancelAnimationFrame(resetAnim);
  resetAnim = 0;
}

function resetView(animate = true) {
  if (session.mode === 'Explore') claimSession();
  closeSheet();
  cancelZoom();
  stopPanReturn();
  cancelResetAnim();
  momentum.yaw = momentum.tilt = 0;
  const target = { ...HOME_CAMERA, lift:0 };
  if (!animate || reducedGlobeMotion.matches) {
    Object.assign(state, target);
    layout();
    invalidate();
    cameraSettled();
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
    else { resetAnim = 0; Object.assign(state, target); layout(); invalidate(); cameraSettled(); }
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
    claimSession();
    if (session.mode !== 'Explore') return;
    exploreIntent();
    chrome[key] = !chrome[key];
    try { localStorage.setItem('globe.display.v4', JSON.stringify({labels:chrome.labels, grid:chrome.grid})); } catch {}
    syncChrome();
    invalidate();
    rememberExplore();
    saveSession();
  });
}
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelGlobeHold(); });

addEventListener('keydown', event => {
  if (chrome.panel && event.key === 'Tab') {
    const focusable = [...viewPanel.querySelectorAll('button:not(:disabled)')].filter(node => node.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (!viewPanel.contains(document.activeElement)) { event.preventDefault(); focusActiveView(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
}, true);

hudViewBtn.addEventListener('click', () => showView(false, hudViewBtn));
el('view-close').addEventListener('click', () => {
  closeView(false);
  viewTrigger.focus({preventScroll:true});
});
el('reset-view').addEventListener('click', () => {
  closeView();
  resetView();
});
