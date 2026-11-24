const yearControl = el('year-control');
const yearForm = el('year-form'), yearInput = el('year-input'), yearError = el('year-error');
const yearMinIndex = ord(YMIN), yearMaxIndex = ord(YMAX);

function yearAtIndex(index) {
  const ordinal = clamp(Math.round(index), yearMinIndex, yearMaxIndex);
  return ordinal <= 0 ? ordinal - 1 : ordinal;
}

function yearControlOpen() {
  return !yearForm.hidden;
}

function syncYearControl(year) {
  el('year-num').textContent = fmtYear(year);
  const status = mapYearStatus();
  const statusEl = el('year-era');
  if (statusEl.textContent !== status) statusEl.textContent = status;
  elYear.setAttribute('aria-label', yearLabel(year) + '，' + status + '。选择年份');
  updateVernier();
}

function closeYearControl({ focus = false } = {}) {
  if (!yearControlOpen()) return;
  yearForm.hidden = true;
  yearControl.classList.remove('editing');
  yearError.textContent = '';
  yearInput.removeAttribute('aria-invalid');
  elYear.setAttribute('aria-expanded', 'false');
  if (focus) elYear.focus({ preventScroll: true });
  invalidate();
}

function dismissYearFromGlobe() {
  const wasOpen = yearControlOpen();
  closeYearControl();
  return wasOpen;
}

function openYearInput() {
  if (session.mode !== 'Explore' || !overlay.hidden) return;
  finishVernierMotion();
  closeView(false);
  closeSheet();
  yearInput.value = fmtYear(state.year);
  yearForm.hidden = false;
  yearControl.classList.add('editing');
  elYear.setAttribute('aria-expanded', 'true');
  yearInput.focus({ preventScroll: true });
  yearInput.select();
  invalidate();
}

function openYearWorld() {
  if (session.mode !== 'Explore' || !overlay.hidden) return;
  finishVernierMotion();
  closeYearControl();
  closeView(false);
  closeSheet();
  openWorld();
  el('overlay-close').focus({ preventScroll: true });
}

elYear.addEventListener('click', () => {
  if (yearControlOpen()) closeYearControl({ focus: true });
  else openYearInput();
});

function parseYear(raw) {
  const input = raw.normalize('NFKC').trim().replace(/^−/, '-');
  const match = /^(?:(公元\s*前|前|公元|-)\s*)?(\d+)\s*年?$/.exec(input);
  if (!match) return null;
  const year = Number(match[2]) * (match[1] === '-' || match[1]?.endsWith('前') ? -1 : 1);
  return session.validYear(year) ? year : null;
}

function chooseYear(year) {
  commitYear(year);
  closeYearControl({ focus: true });
}

yearForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const year = parseYear(yearInput.value);
  if (year === null) {
    yearError.textContent = '请输入' + yearLabel(YMIN) + '至 ' + yearLabel(YMAX) + '之间的年份。没有公元 0 年。';
    yearInput.setAttribute('aria-invalid', 'true');
    return;
  }
  chooseYear(year);
});
yearInput.addEventListener('input', () => {
  yearError.textContent = '';
  yearInput.removeAttribute('aria-invalid');
});
yearForm.addEventListener('click', (event) => {
  const jump = event.target.closest('[data-year-jump]');
  if (jump) chooseYear(Number(jump.dataset.yearJump));
});
el('year-current').textContent = String(THIS_YEAR);
el('year-today').addEventListener('click', () => chooseYear(THIS_YEAR));

const vernier = el('vernier'), vernierTrack = el('vernier-track'), vernierTicks = el('vernier-ticks');
const vernierYearEl = el('vernier-year'), vernierEraEl = el('vernier-era'), vernierEventsBtn = el('vernier-events');
const VERNIER_SPAN = 12;
const vernierStep = 100 / (VERNIER_SPAN * 2);
const vernierSlots = Array.from({ length: VERNIER_SPAN * 2 + 3 }, (_, i) => {
  const tick = vernierTicks.appendChild(document.createElement('span'));
  tick.style.left = (50 + (i - VERNIER_SPAN - 1) * vernierStep) + '%';
  return { tick, label: tick.appendChild(document.createElement('em')) };
});
vernierTrack.setAttribute('aria-valuemax', String(YMAX));

let vernierGesture = null, vernierIdleTimer = 0;
let vernierPosition = ord(state.year), vernierCenter = null, vernierCommittedYear = state.year;
let vernierDragFrame = 0, vernierGlideFrame = 0;
let vernierReadout = '', vernierEventYear = null, vernierEventEntries = null, vernierMarks = null;

function wakeVernier(hold = false) {
  clearTimeout(vernierIdleTimer);
  vernier.classList.add('active');
  if (!hold) vernierIdleTimer = setTimeout(() => vernier.classList.remove('active'), 1250);
}

function paintVernier() {
  const center = clamp(Math.round(vernierPosition), yearMinIndex, yearMaxIndex);
  vernierTicks.style.transform = `translate3d(${(center - vernierPosition) * vernierStep}%,0,0)`;
  const marks = concreteEventStarts();
  if (vernierCenter !== center || vernierMarks !== marks) {
    vernierCenter = center;
    vernierMarks = marks;
    for (let i = 0; i < vernierSlots.length; i++) {
      const index = center + i - VERNIER_SPAN - 1;
      const { tick, label } = vernierSlots[i];
      tick.hidden = index < yearMinIndex || index > yearMaxIndex;
      if (tick.hidden) continue;
      const year = yearAtIndex(index);
      const major = year === YMAX || year % 10 === 0;
      tick.className = (major ? 'major' : year % 5 === 0 ? 'med' : 'minor') + (marks.has(year) ? ' has-event' : '');
      label.textContent = major ? fmtYear(year) : '';
    }
  }
  const year = yearAtIndex(center);
  const preview = year !== state.year;
  const text = preview ? '预览 ' + yearLabel(year) + '，地图 ' + yearLabel(state.year) : yearLabel(year);
  if (text !== vernierReadout) {
    vernierReadout = text;
    vernierYearEl.textContent = fmtYear(year);
    vernierEraEl.textContent = preview ? '预览 · 地图 ' + yearLabel(state.year) : '';
    vernierTrack.setAttribute('aria-valuenow', String(year));
    vernierTrack.setAttribute('aria-valuetext', text);
  }
}

function updateVernier() {
  if (vernierCommittedYear !== state.year) {
    resetVernierPreview();
    vernierCommittedYear = state.year;
  }
  const sheetClosed = sheetState.detent === 'hidden' && !document.body.classList.contains('sheet-open');
  const visible = sheetClosed && !state.focus && session.mode === 'Explore' && overlay.hidden && viewPanel.hidden;
  if (vernier.hidden === visible) {
    vernier.hidden = !visible;
    vernier.inert = !visible;
    if (!visible) resetVernierPreview();
  }
  if (!visible) return;
  paintVernier();
  if (vernierEventYear === state.year && vernierEventEntries === entries) return;
  vernierEventYear = state.year;
  vernierEventEntries = entries;
  const { events } = yearEventGroups(state.year);
  vernierEventsBtn.textContent = events.length ? '这一年 · ' + events.length + ' 件史事' : '这一年';
  vernierEventsBtn.setAttribute('aria-label', yearLabel(state.year) + '的史事' + (events.length ? '，' + events.length + ' 件' : ''));
}

function cancelVernierFrames() {
  cancelAnimationFrame(vernierDragFrame);
  cancelAnimationFrame(vernierGlideFrame);
  vernierDragFrame = vernierGlideFrame = 0;
}

function resetVernierPreview() {
  cancelVernierFrames();
  vernierGesture = null;
  vernierPosition = ord(state.year);
}

function abortVernierPreview() {
  if (!vernierGesture && !vernierGlideFrame) return false;
  resetVernierPreview();
  paintVernier();
  wakeVernier();
  invalidate();
  return true;
}

function commitVernierPosition(position) {
  resetVernierPreview();
  const year = yearAtIndex(position);
  if (year !== state.year) commitYear(year);
  else paintVernier();
  invalidate();
}

function finishVernierMotion() {
  if (vernierGesture || vernierGlideFrame) commitVernierPosition(vernierPosition);
}

function settleVernier(target, velocity = 0) {
  cancelVernierFrames();
  const from = vernierPosition;
  const end = ord(yearAtIndex(target));
  const distance = Math.abs(end - from);
  if (reducedGlobeMotion.matches || distance < .02) {
    commitVernierPosition(end);
    return;
  }
  const start = performance.now();
  const movingTowardTarget = (end - from) * velocity > 0;
  const maxDuration = clamp(390 + (distance - 12) * 2.1, 390, 680);
  const duration = movingTowardTarget ? clamp(2 * distance / Math.abs(velocity), 145, maxDuration) : 145;
  const initialSlope = movingTowardTarget ? Math.min(2, Math.abs(velocity) * duration / distance) : 0;
  const frame = (now) => {
    const progress = clamp((now - start) / duration, 0, 1);
    const eased = progress * progress * (3 - 2 * progress) + initialSlope * progress * (1 - progress) ** 2;
    vernierPosition = lerp(from, end, eased);
    paintVernier();
    if (progress < 1) vernierGlideFrame = requestAnimationFrame(frame);
    else commitVernierPosition(end);
  };
  vernierGlideFrame = requestAnimationFrame(frame);
}

vernierEventsBtn.addEventListener('click', openYearWorld);
vernierTrack.addEventListener('pointerdown', (event) => {
  if (vernier.hidden || event.isPrimary === false || event.button !== 0 || session.mode !== 'Explore') return;
  wakeVernier(true);
  const catching = !!vernierGlideFrame;
  cancelVernierFrames();
  vernierGesture = {
    id: event.pointerId, startX: event.clientX, startY: event.clientY,
    lastX: event.clientX, lastT: event.timeStamp, origin: vernierPosition,
    pixelsPerYear: vernierTrack.clientWidth / (VERNIER_SPAN * 2),
    velocity: 0, catching, moved: false,
  };
  try { vernierTrack.setPointerCapture(event.pointerId); } catch {}
});

vernierTrack.addEventListener('pointermove', (event) => {
  const drag = vernierGesture;
  if (!drag || event.pointerId !== drag.id) return;
  const dx = event.clientX - drag.startX;
  if (!drag.moved && Math.abs(dx) <= Math.max(3, Math.abs(event.clientY - drag.startY))) return;
  drag.moved = true;
  const stepDx = event.clientX - drag.lastX;
  const dt = Math.max(8, event.timeStamp - drag.lastT);
  drag.lastX = event.clientX;
  drag.lastT = event.timeStamp;
  drag.velocity = lerp(drag.velocity, -stepDx / drag.pixelsPerYear / dt, .55);
  const next = drag.origin - dx / drag.pixelsPerYear;
  const bound = clamp(next, yearMinIndex, yearMaxIndex);
  vernierPosition = bound + clamp((next - bound) * .24, -.45, .45);
  if (!vernierDragFrame) vernierDragFrame = requestAnimationFrame(() => {
    vernierDragFrame = 0;
    paintVernier();
  });
});

for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  vernierTrack.addEventListener(type, (event) => {
    const drag = vernierGesture;
    if (!drag || event.pointerId !== drag.id) return;
    vernierGesture = null;
    if (type !== 'pointerup') {
      settleVernier(ord(state.year));
    } else if (!drag.moved && !drag.catching && Math.abs(event.clientY - drag.startY) <= 10) {
      const rect = vernierTrack.getBoundingClientRect();
      const years = (event.clientX - rect.left - rect.width / 2) / drag.pixelsPerYear;
      settleVernier(drag.origin + years);
    } else {
      const velocity = !reducedGlobeMotion.matches && drag.moved && event.timeStamp - drag.lastT < 90 ? drag.velocity : 0;
      const speed = Math.abs(velocity) * drag.pixelsPerYear;
      const boost = 76 * Math.max(0, speed - .45) ** 2;
      const coast = Math.sign(velocity) * Math.min(120, Math.abs(velocity) * 140 + boost);
      settleVernier(vernierPosition + coast, velocity);
    }
    wakeVernier();
  });
}

vernierTrack.addEventListener('keydown', (event) => {
  const moves = { ArrowLeft: Math.round(vernierPosition) - 1, ArrowRight: Math.round(vernierPosition) + 1,
    Home: yearMinIndex, End: yearMaxIndex };
  if (!Object.hasOwn(moves, event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  wakeVernier();
  commitVernierPosition(moves[event.key]);
});

document.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary) return;
  if (!vernierTrack.contains(event.target)) finishVernierMotion();
  if (event.target !== canvas && !yearControl.contains(event.target)) closeYearControl();
}, true);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    closeYearControl();
    abortVernierPreview();
  }
});

updateVernier();
