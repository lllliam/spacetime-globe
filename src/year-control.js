const yearControl = el('year-control'), yearStrip = el('year-strip');
const yearForm = el('year-form'), yearInput = el('year-input'), yearError = el('year-error');
const yearMinIndex = ord(YMIN), yearMaxIndex = ord(YMAX);
const YEAR_HOLD_MS = 460, YEAR_DOUBLE_TAP_MS = 250;
const yearSlots = Array.from({ length: 7 }, () => yearStrip.appendChild(document.createElement('span')));
const yearDisplay = (year) => year === YMAX ? '今天' : fmtYear(year);
const yearAtIndex = (index) => {
  const i = clamp(Math.round(index), yearMinIndex, yearMaxIndex);
  return i <= 0 ? i - 1 : i;
};

let yearBrowsing = false, yearPosition = ord(state.year), yearPress = null;
let yearStride = 80, yearFrame = 0, yearDestination = null, yearTapTimer = 0;
let yearTap = null, suppressYearClick = false;

function yearControlOpen() {
  return yearBrowsing || !yearForm.hidden;
}

function syncYearControl(year) {
  elYear.textContent = yearDisplay(year);
  const spoken = year === YMAX ? '今天' : (year < 0 ? '公元前 ' + -year : year) + ' 年';
  elYear.setAttribute('aria-label', spoken + '的全球事件。长按或按 Shift+Enter 拨动年份，双击或按 F2 输入年份');
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
  // Long BCE labels include a prefix, so reserve enough room for the adjacent year.
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
  yearFrame = 0;
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
  stopTime();
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
  closeYearControl({ finish: true });
  stopTime();
  closeView(false);
  closeSheet();
  yearInput.value = state.year === YMAX ? String(YMAX) : fmtYear(state.year);
  yearForm.hidden = false;
  yearControl.classList.add('editing');
  yearInput.focus({ preventScroll: true });
  yearInput.select();
  invalidate();
}

function openYearWorld() {
  closeYearControl({ finish: true });
  stopTime();
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
  // Extend longer strokes smoothly while keeping the first year's movement one-to-one.
  const excess = Math.max(0, distance - 1);
  const travel = distance + 2.6 * excess * excess / (1 + excess);
  const next = press.origin - Math.sign(dx) * travel;
  const bound = clamp(next, yearMinIndex, yearMaxIndex);
  const position = bound + clamp((next - bound) * .24, -.35, .35);
  const elapsed = Math.max(8, event.timeStamp - press.lastAt);
  press.velocity = lerp(press.velocity, (position - yearPosition) / elapsed, .65);
  press.lastAt = event.timeStamp;
  yearPosition = position;
  renderYearStrip();
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
      // A flick extends the movement. A stationary release snaps to the nearest year.
      const coast = event.timeStamp - press.lastAt < 95 ? clamp(press.velocity * 175, -17, 17) : 0;
      settleYear(yearPosition + coast);
    }
  });
}

elYear.addEventListener('click', (event) => {
  if (worldEvent) { returnToWorld(); return; }
  if (reading.active || !yearForm.hidden) return;
  if (event.detail === 0) { openYearWorld(); return; }
  if (suppressYearClick) return;
  const now = performance.now();
  if (yearTap && now - yearTap.at <= YEAR_DOUBLE_TAP_MS &&
      Math.hypot(event.clientX - yearTap.x, event.clientY - yearTap.y) <= 30) {
    openYearInput();
    return;
  }
  cancelYearTap();
  yearTap = { at: now, x: event.clientX, y: event.clientY };
  yearTapTimer = setTimeout(openYearWorld, YEAR_DOUBLE_TAP_MS);
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
  if (event.isPrimary && event.target !== canvas && !yearControl.contains(event.target)) closeYearControl({ finish: true });
}, true);
addEventListener('resize', updateYearStride);
document.addEventListener('visibilitychange', () => { if (document.hidden) closeYearControl(); });
