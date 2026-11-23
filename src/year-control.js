const yearControl = el('year-control'), yearStrip = el('year-strip');
const yearForm = el('year-form'), yearInput = el('year-input'), yearError = el('year-error');
const yearMinIndex = ord(YMIN), yearMaxIndex = ord(YMAX);
const YEAR_HOLD_MS = 460;
const yearSlots = Array.from({ length: 7 }, () => yearStrip.appendChild(document.createElement('span')));
const yearDisplay = (year) => year === YMAX ? '今天' : fmtYear(year);
const yearAtIndex = (index) => {
  const i = clamp(Math.round(index), yearMinIndex, yearMaxIndex);
  return i <= 0 ? i - 1 : i;
};

let yearBrowsing = false, yearPosition = ord(state.year), yearPress = null;
let yearStride = 80, yearFrame = 0, yearDragFrame = 0, yearDestination = null, yearTapTimer = 0;
let yearTap = null, suppressYearClick = false;

function yearControlOpen() {
  return yearBrowsing || !yearForm.hidden;
}

function eraLabelForYear(year) {
  let era = year === YMAX ? '时空地球 · 现代边界' : chapterOf(year).n + ' · 历史疆域';
  const f = state.focus;
  const ent = f && entityByKey(f.layerId, f.key, f.id);
  const book = reading.active && reading.subject ? reading.subject : (ent && subjectBookForEntity(ent));
  if (book) {
    era = book.title;
    if (book.id === 'ming' && year >= 1403 && year <= 1424) era = '永乐' + (year - 1402) + '年 · 大明';
  }
  return era;
}

function syncYearControl(year) {
  el('year-num').textContent = yearDisplay(year);
  el('year-era').textContent = eraLabelForYear(year);
  if (typeof updateVernier === 'function') updateVernier();
  const spoken = year === YMAX ? '今天' : (year < 0 ? '公元前 ' + -year : year) + ' 年';
  elYear.setAttribute('aria-label', spoken + '。点击输入年份，长按或按 Shift+Enter 拨动年份');
  if (yearBrowsing && !yearPress && !yearFrame) {
    yearPosition = ord(year);
    updateYearStride();
  }
}

function renderYearStrip() {
  const first = Math.round(yearPosition) - 3;
  for (let i = 0; i < yearSlots.length; i++) {
    const index = first + i;
    const slot = yearSlots[i];
    slot.hidden = index < yearMinIndex || index > yearMaxIndex;
    if (slot.hidden) continue;
    const distance = index - yearPosition;
    const emphasis = Math.max(0, 1 - Math.abs(distance));
    const label = yearDisplay(yearAtIndex(index));
    if (slot.textContent !== label) slot.textContent = label;
    slot.style.transform = 'translateX(calc(-50% + ' + (distance * yearStride) + 'px)) scale(' +
      lerp(.54, 1, emphasis) + ')';
    slot.style.opacity = lerp(.46, 1, emphasis);
  }
}

function updateYearStride() {
  if (!yearBrowsing) return;
  yearStride = clamp(yearControl.clientWidth * .205, 73, 111);
  if (yearAtIndex(yearPosition) <= -100) {
    const fontSize = parseFloat(getComputedStyle(yearControl).fontSize);
    yearStride = Math.max(yearStride, fontSize * 2.65);
  }
  renderYearStrip();
}

function cancelYearTap() {
  clearTimeout(yearTapTimer);
  yearTapTimer = 0;
  yearTap = null;
}

function cancelYearGlide() {
  cancelAnimationFrame(yearFrame);
  cancelAnimationFrame(yearDragFrame);
  yearFrame = yearDragFrame = 0;
  yearDestination = null;
}

function applyYearPosition(index) {
  yearPosition = clamp(Math.round(index), yearMinIndex, yearMaxIndex);
  const year = yearAtIndex(yearPosition);
  if (state.year !== year) commitYear(year);
  if (yearBrowsing) renderYearStrip();
}

function settleYear(target) {
  cancelYearGlide();
  const from = yearPosition;
  const destination = clamp(Math.round(target), yearMinIndex, yearMaxIndex);
  const distance = Math.abs(destination - from);
  if (reducedGlobeMotion.matches || distance < .003) {
    applyYearPosition(destination);
    return;
  }
  const duration = clamp(170 + distance * 19, 170, 490);
  const start = performance.now();
  yearDestination = destination;
  const frame = (now) => {
    const t = clamp((now - start) / duration, 0, 1);
    if (t === 1) {
      cancelYearGlide();
      applyYearPosition(destination);
      return;
    }
    yearPosition = lerp(from, destination, 1 - (1 - t) ** 3);
    renderYearStrip();
    yearFrame = requestAnimationFrame(frame);
  };
  yearFrame = requestAnimationFrame(frame);
}

function closeYearControl({ focus = false, finish = false } = {}) {
  const destination = finish ? yearDestination : null;
  const wasOpen = yearControlOpen();
  cancelYearTap();
  cancelYearGlide();
  if (yearPress) {
    clearTimeout(yearPress.timer);
    yearPress = null;
    suppressYearClick = true;
  }
  if (!wasOpen) return;
  yearBrowsing = false;
  yearControl.classList.remove('browsing', 'editing');
  yearForm.hidden = true;
  yearError.textContent = '';
  yearInput.removeAttribute('aria-invalid');
  elYear.setAttribute('aria-expanded', 'false');
  if (destination !== null) applyYearPosition(destination);
  if (focus) elYear.focus({ preventScroll: true });
  invalidate();
}

function dismissYearFromGlobe() {
  const wasOpen = yearControlOpen();
  closeYearControl({ finish: true });
  return wasOpen;
}

function showYearControl() {
  if (yearBrowsing) return;
  finishVernierMotion();
  document.body.classList.remove('chrome-hidden');
  cancelYearTap();
  closeWorld();
  closeView(false);
  closeSheet();
  momentum.yaw = momentum.tilt = 0;
  yearPosition = ord(state.year);
  yearBrowsing = true;
  updateYearStride();
  yearControl.classList.add('browsing');
  elYear.setAttribute('aria-expanded', 'true');
  invalidate();
}

function openYearInput() {
  finishVernierMotion();
  document.body.classList.remove('chrome-hidden');
  closeYearControl({ finish: true });
  closeView(false);
  closeSheet();
  yearInput.value = state.year === YMAX ? String(YMAX) : fmtYear(state.year);
  yearForm.hidden = false;
  yearControl.classList.add('editing');
  elYear.setAttribute('aria-expanded', 'true');
  yearInput.focus({ preventScroll: true });
  yearInput.select();
  invalidate();
}

function openYearWorld() {
  finishVernierMotion();
  document.body.classList.remove('chrome-hidden');
  closeYearControl({ finish: true });
  closeView(false);
  closeSheet();
  openWorld();
  el('overlay-close').focus({ preventScroll: true });
}

yearControl.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary || event.button !== 0 || worldEvent || reading.active || !yearForm.hidden) return;
  const catching = yearFrame !== 0;
  cancelYearGlide();
  suppressYearClick = catching;
  clearTimeout(yearTapTimer);
  yearTapTimer = 0;
  const press = {
    id: event.pointerId, startX: event.clientX, startY: event.clientY, origin: yearPosition,
    lastAt: event.timeStamp, velocity: 0, active: yearBrowsing, moved: false, timer: 0,
  };
  yearPress = press;
  if (!press.active) {
    press.timer = setTimeout(() => {
      if (yearPress !== press) return;
      showYearControl();
      press.active = true;
      press.origin = yearPosition;
      suppressYearClick = true;
    }, YEAR_HOLD_MS);
  }
  try { event.target.setPointerCapture(event.pointerId); } catch {}
});

yearControl.addEventListener('pointermove', (event) => {
  const press = yearPress;
  if (!press || event.pointerId !== press.id) return;
  const dx = event.clientX - press.startX;
  if (!press.active) {
    if (Math.hypot(dx, event.clientY - press.startY) > 10) {
      clearTimeout(press.timer);
      cancelYearTap();
      suppressYearClick = true;
    }
    return;
  }
  if (!press.moved && Math.abs(dx) < 5) return;
  press.moved = true;
  suppressYearClick = true;
  const distance = Math.abs(dx) / yearStride;
  const excess = Math.max(0, distance - 1);
  const travel = distance + 2.6 * excess * excess / (1 + excess);
  const next = press.origin - Math.sign(dx) * travel;
  const bound = clamp(next, yearMinIndex, yearMaxIndex);
  const position = bound + clamp((next - bound) * .24, -.35, .35);
  const elapsed = Math.max(8, event.timeStamp - press.lastAt);
  press.velocity = lerp(press.velocity, (position - yearPosition) / elapsed, .65);
  press.lastAt = event.timeStamp;
  yearPosition = position;
  if (!yearDragFrame) yearDragFrame = requestAnimationFrame(() => {
    yearDragFrame = 0;
    renderYearStrip();
  });
});

for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  yearControl.addEventListener(type, (event) => {
    const press = yearPress;
    if (!press || event.pointerId !== press.id) return;
    clearTimeout(press.timer);
    yearPress = null;
    if (type !== 'pointerup') {
      cancelYearTap();
      suppressYearClick = true;
      if (press.active) settleYear(ord(state.year));
      return;
    }
    if (press.active) {
      const coast = event.timeStamp - press.lastAt < 95 ? clamp(press.velocity * 175, -17, 17) : 0;
      settleYear(yearPosition + coast);
    }
  });
}

elYear.addEventListener('click', () => {
  if (!worldEvent && !reading.active && !suppressYearClick && !yearBrowsing) {
    if (!yearForm.hidden) closeYearControl({ focus: true });
    else openYearInput();
  }
});

yearControl.addEventListener('contextmenu', (event) => {
  if (yearForm.hidden) event.preventDefault();
});
elYear.addEventListener('keydown', (event) => {
  if (worldEvent || event.repeat) return;
  if (event.key === 'F2') {
    event.preventDefault();
    openYearInput();
  } else if (event.shiftKey && event.key === 'Enter') {
    event.preventDefault();
    showYearControl();
  }
});

yearForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = yearInput.value.normalize('NFKC').replace(/\s+/g, '').replace(/^公元/, '')
    .replace(/^前|^−/, '-').replace(/年$/, '');
  const year = input === '今天' ? YMAX : (/^-?\d+$/.test(input) ? Number(input) : NaN);
  if (!Number.isInteger(year) || year === 0 || year < YMIN || year > YMAX) {
    yearError.textContent = '请输入前 3500 年至 ' + YMAX + ' 年之间的年份（无公元 0 年）。';
    yearInput.setAttribute('aria-invalid', 'true');
    return;
  }
  commitYear(year);
  closeYearControl({ focus: true });
});
yearInput.addEventListener('input', () => {
  yearError.textContent = '';
  yearInput.removeAttribute('aria-invalid');
});

addEventListener('keydown', (event) => {
  if (!yearControlOpen()) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeYearControl({ focus: true });
  } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) && yearBrowsing) {
    cancelYearGlide();
  }
}, true);
document.addEventListener('pointerdown', (event) => {
  if (event.isPrimary && !vernierTrack.contains(event.target)) finishVernierMotion();
  if (event.isPrimary && event.target !== canvas && !yearControl.contains(event.target)) closeYearControl({ finish: true });
}, true);
addEventListener('resize', updateYearStride);
yearStrip.addEventListener('transitionend', invalidate);
document.addEventListener('visibilitychange', () => { if (document.hidden) closeYearControl(); });

yearForm.addEventListener('click', (event) => {
  const jump = event.target.closest('[data-year-jump]');
  if (!jump) return;
  commitYear(Number(jump.dataset.yearJump));
  closeYearControl({ focus: true });
});

/* ── 无边框精密天文游标（动静两态 + 史事微光点 + 上拉直达当年史事） ── */
const vernier = el('vernier'), vernierTrack = el('vernier-track'), vernierTicks = el('vernier-ticks');
const vernierYearEl = el('vernier-year'), vernierEraEl = el('vernier-era'), vernierEventsBtn = el('vernier-events');
const VERNIER_SPAN = 12;
const vernierStep = 100 / (VERNIER_SPAN * 2);
const vernierSlots = Array.from({ length:VERNIER_SPAN * 2 + 3 }, (_, i) => {
  const tick = vernierTicks.appendChild(document.createElement('span'));
  tick.style.left = (50 + (i - VERNIER_SPAN - 1) * vernierStep) + '%';
  return { tick, label:tick.appendChild(document.createElement('em')) };
});
let vernierGesture = null, vernierIdleTimer = 0;
let vernierPosition = ord(state.year), vernierCenter = null, vernierCommittedYear = state.year;
let vernierDragFrame = 0, vernierGlideFrame = 0, vernierDestination = null;
let vernierReadoutIndex = null, vernierEventYear = null, vernierEventEntries = null, vernierMarks = null;
let eventYearSet = null;

function ensureEventYearSet() {
  if (eventYearSet && eventYearSet.size) return eventYearSet;
  if (!entries.length) return null;
  const set = new Set([-550, -221, 220, 618, 960, 1368, 1421, 1644, 1945]);
  for (const e of entries) {
    if (e.kind !== 'era') set.add(e.start);
  }
  eventYearSet = set;
  return set;
}

function yearEventCounts(year) {
  const [start, end] = windowOf(year);
  const first = ord(start), last = ord(end) + 1;
  let concrete = 0, bg = 0;
  for (const event of entries) {
    if (event.t1 < first || event.t0 >= last) continue;
    const isBg = !event.point && event.kind === 'era';
    if (isBg) bg++; else concrete++;
  }
  return { concrete, bg, recent: start !== end };
}

function wakeVernier(hold = false) {
  clearTimeout(vernierIdleTimer);
  vernier.classList.add('active');
  if (!hold) {
    vernierIdleTimer = setTimeout(() => {
      if (!vernierGesture) vernier.classList.remove('active');
    }, 1250);
  }
}

function paintVernier(syncEra = false) {
  const center = clamp(Math.round(vernierPosition), yearMinIndex, yearMaxIndex);
  vernierTicks.style.transform = `translate3d(${(center - vernierPosition) * vernierStep}%,0,0)`;
  const marks = ensureEventYearSet();
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
      tick.className = (major ? 'major' : year % 5 === 0 ? 'med' : 'minor') + (marks?.has(year) ? ' has-event' : '');
      label.textContent = major && year !== YMAX ? fmtYear(year) : '';
    }
  }
  const changedYear = vernierReadoutIndex !== center;
  const year = yearAtIndex(center);
  if (changedYear) {
    vernierReadoutIndex = center;
    vernierYearEl.textContent = yearDisplay(year);
    vernierTrack.setAttribute('aria-valuenow', year);
    vernierTrack.setAttribute('aria-valuetext', yearDisplay(year));
  }
  if (changedYear || syncEra) {
    const era = eraLabelForYear(year);
    if (vernierEraEl.textContent !== era) vernierEraEl.textContent = era;
  }
}

function updateVernier() {
  if (vernierCommittedYear !== state.year) {
    cancelVernierMotion();
    vernierPosition = ord(state.year);
    vernierCommittedYear = state.year;
  }
  const sheetClosed = sheetState.detent === 'hidden' && !document.body.classList.contains('sheet-open');
  const visible = sheetClosed && !state.focus && !reading.active && !worldEvent && overlay.hidden && viewPanel.hidden;
  vernier.hidden = !visible;
  if (!visible) return;
  paintVernier(true);
  const year = state.year;
  if (vernierEventYear === year && vernierEventEntries === entries) return;
  vernierEventYear = year;
  vernierEventEntries = entries;
  const { concrete, bg, recent } = yearEventCounts(year);
  if (concrete > 0) {
    vernierEventsBtn.textContent = recent ? '近年史事' : concrete + ' 件史事';
    vernierEventsBtn.hidden = false;
  } else if (bg > 0 && !recent) {
    vernierEventsBtn.textContent = '时代背景';
    vernierEventsBtn.hidden = false;
  } else {
    vernierEventsBtn.hidden = true;
  }
}

function cancelVernierMotion() {
  cancelAnimationFrame(vernierDragFrame);
  cancelAnimationFrame(vernierGlideFrame);
  vernierDragFrame = vernierGlideFrame = 0;
  vernierDestination = null;
}

function commitVernierPosition(position) {
  cancelVernierMotion();
  const year = yearAtIndex(position);
  vernierPosition = ord(year);
  if (year !== state.year) commitYear(year);
  else paintVernier();
  invalidate();
}

function finishVernierMotion() {
  if (vernierDestination !== null) commitVernierPosition(vernierPosition);
}

function settleVernier(target, velocity = 0) {
  cancelVernierMotion();
  const from = vernierPosition;
  const end = ord(yearAtIndex(target));
  const distance = Math.abs(end - from);
  if (reducedGlobeMotion.matches || distance < .02) {
    commitVernierPosition(end);
    return;
  }
  const start = performance.now();
  const movingTowardTarget = (end - from) * velocity > 0;
  const maxDuration = clamp(390 + (distance - 12) * 2.1, 390, 760);
  const duration = movingTowardTarget ? clamp(2 * distance / Math.abs(velocity), 145, maxDuration) : 145;
  // Long throws ease in from the finger's release speed and come to rest at the destination.
  const initialSlope = movingTowardTarget ? Math.min(2, Math.abs(velocity) * duration / distance) : 0;
  vernierDestination = end;
  const frame = (now) => {
    const progress = clamp((now - start) / duration, 0, 1);
    const eased = progress * progress * (3 - 2 * progress) + initialSlope * progress * (1 - progress) ** 2;
    vernierPosition = lerp(from, end, eased);
    paintVernier();
    vernierGlideFrame = requestAnimationFrame(progress < 1 ? frame : () => commitVernierPosition(end));
  };
  vernierGlideFrame = requestAnimationFrame(frame);
}

vernierEventsBtn.addEventListener('click', () => openYearWorld());

vernierTrack.addEventListener('pointerdown', (event) => {
  if (vernier.hidden || event.isPrimary === false || event.button !== 0 || reading.active) return;
  document.body.classList.remove('chrome-hidden');
  wakeVernier(true);
  const catching = vernierDestination !== null;
  cancelVernierMotion();
  vernierGesture = {
    id: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastT: event.timeStamp,
    origin: vernierPosition,
    pixelsPerYear: vernierTrack.clientWidth / (VERNIER_SPAN * 2),
    velocity: 0,
    catching,
    moved: false,
    swipeUp: false,
  };
  vernierTrack.setPointerCapture(event.pointerId);
});

vernierTrack.addEventListener('pointermove', (event) => {
  if (!vernierGesture || event.pointerId !== vernierGesture.id) return;
  const g = vernierGesture;
  const totalDx = event.clientX - g.startX;
  const totalDy = event.clientY - g.startY;
  if (g.swipeUp) return;
  if (!g.moved) {
    if (totalDy < -18 && -totalDy > Math.abs(totalDx) * 1.4) {
      g.swipeUp = true;
      g.moved = true;
      return;
    }
    if (Math.abs(totalDx) <= Math.max(3, Math.abs(totalDy))) return;
    g.moved = true;
  }
  const stepDx = event.clientX - g.lastX;
  const dt = Math.max(8, event.timeStamp - g.lastT);
  g.lastX = event.clientX;
  g.lastT = event.timeStamp;
  g.velocity = lerp(g.velocity, -stepDx / g.pixelsPerYear / dt, .55);
  const next = g.origin - totalDx / g.pixelsPerYear;
  const bound = clamp(next, yearMinIndex, yearMaxIndex);
  vernierPosition = bound + clamp((next - bound) * .24, -.45, .45);
  if (!vernierDragFrame) vernierDragFrame = requestAnimationFrame(() => {
    vernierDragFrame = 0;
    paintVernier();
  });
});

for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  vernierTrack.addEventListener(type, (event) => {
    if (!vernierGesture || event.pointerId !== vernierGesture.id) return;
    const drag = vernierGesture;
    vernierGesture = null;
    if (type !== 'pointerup') {
      settleVernier(ord(state.year));
    } else if (drag.swipeUp) {
      commitVernierPosition(vernierPosition);
      vernier.classList.remove('active');
      openYearWorld();
      return;
    } else if (!drag.moved && !drag.catching && Math.abs(event.clientY - drag.startY) <= 10) {
      const rect = vernierTrack.getBoundingClientRect();
      const years = (event.clientX - rect.left - rect.width / 2) / drag.pixelsPerYear;
      settleVernier(drag.origin + years);
    } else {
      const velocity = !reducedGlobeMotion.matches && drag.moved && event.timeStamp - drag.lastT < 90
        ? drag.velocity : 0;
      const speed = Math.abs(velocity) * drag.pixelsPerYear;
      const boost = 76 * Math.max(0, speed - .45) ** 2;
      const coast = Math.sign(velocity) * Math.min(180, Math.abs(velocity) * 140 + boost);
      settleVernier(vernierPosition + coast, velocity);
    }
    wakeVernier(false);
  });
}

vernierTrack.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    event.stopPropagation();
    wakeVernier(false);
    commitVernierPosition(Math.round(vernierPosition) + (event.key === 'ArrowRight' ? 1 : -1));
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    openYearWorld();
  }
});

updateVernier();
