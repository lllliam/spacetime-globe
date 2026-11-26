const worldReadingLinks = new Map(JSON.parse(inlineText('world-reading')));
const worldPin = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 10c0 5-7 10-7 10S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.2"/></svg>';
const worldBook = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5C9 3 5.5 3 2.5 4.5v13c3-1.5 6.5-1.5 9.5.5 3-2 6.5-2 9.5-.5v-13C18.5 3 15 3 12 5Zm0 0v13"/></svg>';
const worldChevron = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
let worldListYear = null;
let indexedEvents = null, eventStarts = new Set();
const eventGroupsByYear = new Map();

function isLongTermBackground(event) {
  if (event.point) return false;
  // 「其他」也收录航行和营建。保留有限时段的活动，跨世代的文化或社会发展仍归入背景。
  const years = ord(event.end) - ord(event.start);
  return event.kind === 'era' || years >= (event.kind === 'other' ? 40 : 12);
}

function activeTimelineEntries() {
  return entries.length ? canonicalEntries : [];
}

function concreteEventStarts() {
  const source = activeTimelineEntries();
  if (indexedEvents !== entries) {
    indexedEvents = entries;
    eventGroupsByYear.clear();
    eventStarts = new Set(source.filter(event => !isLongTermBackground(event)).map(event => event.start));
  }
  return eventStarts;
}

function yearEventGroups(year) {
  concreteEventStarts();
  if (eventGroupsByYear.has(year)) return eventGroupsByYear.get(year);
  const first = ord(year), end = first + 1;
  const groups = { events: [], background: [] };
  for (const event of activeTimelineEntries()) {
    if (event.t1 < first || event.t0 >= end) continue;
    groups[isLongTermBackground(event) ? 'background' : 'events'].push(event);
  }
  if (eventGroupsByYear.size >= 64) eventGroupsByYear.delete(eventGroupsByYear.keys().next().value);
  eventGroupsByYear.set(year, groups);
  return groups;
}

function worldEventYear(event) {
  return clamp(state.year, event.start, event.point ? event.start : event.end);
}

function worldReadingTargets(event, year) {
  const ids = event?.memberIds || (event ? [event.id] : []);
  const seenBooks = new Set();
  const list = [];
  for (const id of ids) {
    const link = worldReadingLinks.get(id);
    if (!link) continue;
    const [bookId, chapterId] = link;
    if (seenBooks.has(bookId)) continue;
    seenBooks.add(bookId);
    const book = subjectsById.get(bookId);
    if (!book) continue;
    const recommendations = chapterId ? [] : recommendChapters(book, year);
    const chapter = chapterId ? book.chapters.find(c => c.id === chapterId)
      : recommendations.length === 1 ? recommendations[0] : null;
    list.push({ book, chapter, year, eventId: id });
  }
  return list;
}

function worldReadingTarget(event, year) {
  return worldReadingTargets(event, year)[0] || null;
}

function worldEntryMarkup(item) {
  const { event, targets } = item;
  const note = timelineItem(event);
  const title = note.title || event.zh;
  const regionNames = [...new Set((event.regions || [event.region])
    .map(rid => regionById.get(rid)?.zh || event.regionRef?.zh).filter(Boolean))];
  const dates = fmtYear(event.start) + (!event.point && event.start !== event.end ? '—' + fmtYear(event.end) : '') + ' 年';
  return '<li class="witem"><button type="button" class="wrow" data-event="' + esc(event.id) + '" aria-label="' +
    esc(title + '，在地球上看') + '"><span><strong>' + esc(title) + '</strong><small>' +
    esc(dates + (regionNames.length ? ' · ' + regionNames.join('、') : '')) + '</small></span>' + worldPin + '</button>' +
    targets.map(t => '<button type="button" class="world-read" data-world-read="' + esc(event.id) +
      '" data-world-book="' + esc(t.book.id) + '">' + worldBook + '读《' + esc(t.book.title) + '》</button>').join('') +
    (note.related ? '<button type="button" class="world-read" data-world-topic="' + esc(event.id) + '">' +
      worldBook + '阅读相关专题</button>' : '') + '</li>';
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
  if (session.mode !== 'Explore') return;
  worldListYear = state.year;
  const groups = yearEventGroups(state.year);
  const item = event => {
    const targets = worldReadingTargets(event, worldEventYear(event));
    return { event, targets, target: targets[0] || null };
  };
  const events = groups.events.map(item), background = groups.background.map(item);
  // 同一开始年份里，优先呈现可以接着读的条目。
  const byDate = (a, b) => b.event.start - a.event.start || Number(!!b.target) - Number(!!a.target) || b.event.t0 - a.event.t0;
  events.sort(byDate);
  background.sort((a,b) => Number(!!b.target) - Number(!!a.target) || byDate(a,b));
  overlayTitle.textContent = yearLabel(state.year);
  overlaySub.textContent = '选取史事可在地球上查看，带书名的条目可继续阅读。';
  overlaySub.hidden = !overlaySub.textContent;
  overlayBody.innerHTML = '<section aria-labelledby="world-events-heading"><h2 id="world-events-heading">这一年的事件</h2>' +
    (events.length ? worldList(events.slice(0, 4)) + worldDisclosure('更多事件', events.slice(4))
      : '<p class="wempty">这一年暂无收录的具体事件。</p>') + '</section>' +
    worldDisclosure('长期背景', background, !events.length);
  restoreWorld(null, 0);
}

function restoreWorld(button, scroll) {
  overlay.hidden = false;
  syncTopChrome();
  updateVernier();
  canvas.inert = el('hud').inert = true;
  overlayBody.scrollTop = scroll;
  button?.focus({preventScroll:true});
}

function worldSource(eventId, action, bookId = null) {
  return session.source({ kind: 'events', year: session.mode === 'Explore' ? state.year : session.explore.year,
    eventId, action, ...(bookId ? { bookId } : {}), scroll: overlayBody.scrollTop,
    disclosures: [...overlayBody.querySelectorAll('details')].map(node => node.open) });
}

function restoreWorldSource(source) {
  if (source.year !== state.year) return;
  if (worldListYear !== source.year) openWorld();
  const rows = overlayBody.querySelectorAll(source.action==='read' ? '[data-world-read]' :
    source.action==='topic' ? '[data-world-topic]' : '[data-event]');
  const resolvedId = canonicalEventById.get(source.eventId)?.id || source.eventId;
  const row = [...rows].find(node => (node.dataset.worldRead || node.dataset.worldTopic || node.dataset.event) === resolvedId &&
    (!source.bookId || node.dataset.worldBook === source.bookId)) ||
    [...rows].find(node => (node.dataset.worldRead || node.dataset.worldTopic || node.dataset.event) === resolvedId);
  overlayBody.querySelectorAll('details').forEach((node, index) => {
    if (index < source.disclosures.length) node.open = source.disclosures[index];
  });
  if (row?.closest('details')) row.closest('details').open = true;
  restoreWorld(row || el('overlay-close'), source.scroll);
}

function closeWorld(focus = false) {
  if (overlay.hidden) return;
  overlay.hidden = true;
  syncTopChrome();
  updateVernier();
  canvas.inert = el('hud').inert = false;
  if (focus) vernierEventsBtn.focus({preventScroll:true});
  invalidate();
}

overlayBody.addEventListener('click', event => {
  const button = event.target.closest('button[data-event],button[data-world-read],button[data-world-topic]');
  if (!button) return;
  const id = button.dataset.event || button.dataset.worldRead || button.dataset.worldTopic;
  const entry = canonicalEventById.get(id) || entries.find(item => String(item.id) === id);
  if (!entry) return;
  if (button.dataset.event) { openWorldEvent(entry); return; }
  if (button.dataset.worldTopic) {
    const related = timelineItem(entry).related;
    const topic = TOPICS.find(item=>item.id===related?.topicId);
    if (topic) beginReading(null,topic,related.chapterId,null,{entryYear:worldEventYear(entry),source:worldSource(entry.id,'topic')});
    return;
  }
  const targets = worldReadingTargets(entry, worldEventYear(entry));
  const target = (button.dataset.worldBook && targets.find(t => t.book.id === button.dataset.worldBook)) || targets[0];
  if (!target) return;
  beginReading(null, null, target.chapter?.id, target.book, {
    entryYear:target.year, source:worldSource(entry.id, 'read', target.book.id),
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
