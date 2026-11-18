const worldReadingLinks = new Map(Object.entries(JSON.parse(inlineText('world-reading'))));
const worldPin = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 10c0 5-7 10-7 10S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.2"/></svg>';
const worldBook = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5C9 3 5.5 3 2.5 4.5v13c3-1.5 6.5-1.5 9.5.5 3-2 6.5-2 9.5-.5v-13C18.5 3 15 3 12 5Zm0 0v13"/></svg>';
const worldChevron = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const backgroundEntries = new Set(['i-kr-empire']);
const extendedEvents = new Set(['i-010', 'i-158']);

function worldReadingTarget(event, year) {
  const mapped = subjectsByEvent.get(event.id);
  if (mapped) return { ...mapped, year: clamp(year, mapped.chapter.from, mapped.chapter.to ?? YMAX) };
  const link = worldReadingLinks.get(event.id);
  if (!link) return null;
  const [bookId, chapterId] = link.split('/');
  const book = subjectsById.get(bookId);
  const chapter = chapterId
    ? book.chapters.find(c => c.id === chapterId)
    : book.chapters.find(c => coversYear(c, year));
  if (!chapter) return null;
  return { book, chapter, year: clamp(year, chapter.from, chapter.to ?? YMAX) };
}

function worldEntryMarkup(item) {
  const {event, target} = item;
  const title = timelineItem(event).title || event.zh;
  const region = event.regionRef || regionById.get(event.region);
  const dates = fmtYear(event.start) + (!event.point && event.start !== event.end ? '—' + fmtYear(event.end) : '') + ' 年';
  return '<li class="witem"><button type="button" class="wrow" data-event="' + esc(event.id) + '" aria-label="' +
    esc(title + '，在地球上看') + '"><span><strong>' + esc(title) + '</strong><small>' +
    esc(dates + (region?.zh ? ' · ' + region.zh : '')) + '</small></span>' + worldPin + '</button>' +
    (target ? '<button type="button" class="world-read" data-world-read="' + esc(event.id) + '">' +
      worldBook + '读《' + esc(target.book.title) + '》</button>' : '') + '</li>';
}

function worldList(items) {
  return '<ul class="world-list">' + items.map(worldEntryMarkup).join('') + '</ul>';
}

function worldDisclosure(title, items, open = false) {
  if (!items.length) return '';
  return '<details class="world-background"' + (open ? ' open' : '') + '><summary>' + title + worldChevron +
    '</summary>' + worldList(items) + '</details>';
}

function openWorld() {
  const [start, end] = windowOf(state.year);
  const first = ord(start), last = ord(end) + 1;
  const recent = start !== end;
  const events = [], background = [];
  for (const event of entries) {
    if (event.t1 < first || event.t0 >= last) continue;
    const item = { event, target:worldReadingTarget(event, clamp(state.year, event.start, event.point ? event.start : event.end)) };
    const isBackground = !event.point && !extendedEvents.has(event.id) &&
      (event.kind === 'era' || ord(event.end) - ord(event.start) >= 15 || backgroundEntries.has(event.id));
    (isBackground ? background : events).push(item);
  }
  // 同一开始年份里，优先呈现可以接着读的条目。
  const byDate = (a, b) => b.event.start - a.event.start || Number(!!b.target) - Number(!!a.target) || b.event.t0 - a.event.t0;
  events.sort(byDate);
  background.sort((a,b) => Number(!!b.target) - Number(!!a.target) || byDate(a,b));
  overlayTitle.textContent = recent ? '近 ' + TODAY_SPAN + ' 年' : fmtYear(state.year) + ' 年';
  overlaySub.textContent = recent ? '寻找值得读下去的历史'
    : events.length ? '从这一年的事件读起' : background.length ? '从这一年的背景读起' : '';
  overlaySub.hidden = !overlaySub.textContent;
  overlayBody.innerHTML = '<section aria-labelledby="world-events-heading"><h2 id="world-events-heading">' +
    (recent ? '近年的事件' : '这一年的事件') + '</h2>' +
    (events.length ? worldList(events.slice(0, 4)) + worldDisclosure('更多事件', events.slice(4))
      : '<p class="wempty">' + (recent ? '这个时段' : '这一年') + '暂无收录的具体事件。</p>') + '</section>' +
    worldDisclosure('长期背景', background, !events.length);
  restoreWorld(null, 0);
}

function restoreWorld(button, scroll) {
  overlay.hidden = false;
  canvas.inert = el('hud').inert = true;
  overlayBody.scrollTop = scroll;
  button?.focus({preventScroll:true});
}

function closeWorld(focus = false) {
  if (overlay.hidden) return;
  overlay.hidden = true;
  canvas.inert = el('hud').inert = false;
  if (focus) elYear.focus({preventScroll:true});
  invalidate();
}

overlayBody.addEventListener('click', event => {
  const button = event.target.closest('button[data-event],button[data-world-read]');
  if (!button) return;
  const id = button.dataset.event || button.dataset.worldRead;
  const entry = entries.find(item => String(item.id) === id);
  if (!entry) return;
  if (button.dataset.event) { openWorldEvent(entry, button); return; }
  const target = worldReadingTarget(entry, clamp(state.year, entry.start, entry.point ? entry.start : entry.end));
  if (!target) return;
  const scroll = overlayBody.scrollTop;
  closeWorld();
  beginReading(null, null, target.chapter.id, sheetDetents().hidden, target.book, {
    entryYear:target.year, returnTo:() => restoreWorld(button, scroll),
  });
});
el('overlay-close').addEventListener('click', () => closeWorld(true));
overlay.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const first = el('overlay-close');
  const last = [...overlayBody.querySelectorAll('button,summary')].findLast(node => node.getClientRects().length) || first;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
