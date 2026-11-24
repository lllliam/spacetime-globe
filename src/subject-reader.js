const subjectBooks = JSON.parse(inlineText('subject-books'));
const historicalScenes = new Map(JSON.parse(inlineText('historical-scenes')).map(scene => [scene.id, scene]));
const subjectsById = new Map(subjectBooks.map((book) => [book.id, book]));
const subjectsByPolity = new Map(subjectBooks.flatMap((book) => book.polityIds.map((id, i) =>
  [id, { book, name: book.polities[i] }])));
const subjectsByEvent = new Map(subjectBooks.flatMap((book) => book.chapters.flatMap((chapter) =>
  (chapter.eventIds || []).map((id) => [id, { book, chapter }]))));

const coversYear = ({ from, to }, year) => year >= from && (to == null || year <= to);
function subjectBookForEntity(entity, year = state.year) {
  if (entity.kind === 'polity') {
    const binding = subjectsByPolity.get(entity.entId);
    return binding?.name === entity.name && coversYear(binding.book, year) ? binding.book : null;
  }
  return subjectBooks.find((book) =>
    book.countries?.some((binding) => entity.iso === binding.iso && coversYear(binding, year))) || null;
}

function politySelectionsAt(point, primaryId) {
  if (!point || state.layerId !== 'polity') return [];
  const peers = new Set();
  probeCtx.save();
  probeCtx.setTransform(1, 0, 0, 1, 0, 0);
  for (const shape of [...partition.shapes].reverse()) {
    const id = shape.ent.id;
    if (id === primaryId || peers.has(id)) continue;
    const polygon = polityShape(pk, shape.pathId);
    if (probeCtx.isPointInPath(polygon.path, point.x, point.y, 'evenodd')) peers.add(id);
    if (peers.size === 5) break;
  }
  probeCtx.restore();
  return [...peers];
}

function subjectYears({ from, to, dateLabel }) {
  if (dateLabel) return dateLabel;
  const year = (y) => y < 0 ? '公元前 ' + -y : String(y);
  if (from === to) return year(from) + ' 年';
  return year(from) + (to == null ? ' 年至今' : '—' + year(to) + ' 年');
}

function subjectEntityName(entity) {
  return entity.kind === 'polity'
    ? polityNames.get(entity.name) || '中文名待考 · ' + (entity.entId + 1)
    : entity.name;
}

function subjectSheetMarkup(entity) {
  const book = subjectBookForEntity(entity);
  const title = book ? book.title : subjectEntityName(entity);
  const meta = book ? subjectYears(book) : entity.kind === 'polity' ? subjectYears(entity) + ' · 地图记录' : fmtYear(state.year) + ' 年';
  const source = entity.kind === 'polity'
    ? ['Cliopatria', 'https://github.com/Seshat-Global-History-Databank/cliopatria']
    : ['Natural Earth', 'https://www.naturalearthdata.com/'];
  return '<div class="sheet-overview"><h2>' + esc(title) + '</h2>' +
    '<p class="era">' + esc(meta) + '</p></div>' +
    (book ? '<p class="subject-sheet-summary">' + esc(book.summary) + '</p>' :
      '<p class="subject-sheet-summary map-sheet-summary">' + esc(meta) +
      ' <a href="' + source[1] + '" target="_blank" rel="noopener noreferrer">' + source[0] + ' ↗</a></p>') +
    '<button class="topic-entry" type="button" data-read-subject><strong>' +
    (book ? '打开全卷' : '查看地图资料') + '</strong>' + readingArrow + '</button>';
}

function subjectLibraryLink() {
  return '<nav class="reading-next"><button type="button" data-subject-library>历史书目' + readingArrow + '</button></nav>';
}

function subjectChapterButton(id, label) {
  return '<button type="button" data-reading-detail="' + esc(id) + '">' + esc(label) + readingArrow + '</button>';
}

function subjectNeighbors() {
  if (!reading.ent) return '';
  const currentBook = reading.subject?.id;
  const seen = new Set();
  const candidates = readingEntryPeers.filter((id) => id !== reading.ent.entId)
    .map((id) => entityByKey('polity', id)).filter(Boolean).flatMap((entity) => {
      const linked = subjectBookForEntity(entity, reading.year);
      const key = linked?.id ?? entity.entId;
      if (linked?.id && linked.id === currentBook || seen.has(key)) return [];
      seen.add(key);
      return [{ entity, label: linked?.title || subjectEntityName(entity) }];
    });
  if (!candidates.length) return '';
  return '<details class="subject-secondary"><summary>地图上重叠的主体</summary>' +
    '<p class="reading-note">这些轮廓在入口处重叠，范围与关系取决于地图资料。</p>' +
    '<nav class="reading-next">' + candidates.map(({ entity, label }) => '<button type="button" data-atlas-entity="' +
      entity.entId + '">' + esc(label) + readingArrow + '</button>').join('') + '</nav></details>';
}

function renderAtlasReading() {
  const entity = reading.ent;
  setReadingBack(reading.trail.length ? '返回上一级' : '');
  const title = subjectEntityName(entity);
  const history = entity.kind === 'polity';
  return '<div class="atlas-reading">' + readingHeading(title, fmtYear(reading.year) + ' 年') +
    '<p class="lede">这个主体的历史正文尚未收录。</p>' +
    '<p class="reading-note">' + (history ? '疆域资料记录于 ' + esc(subjectYears(entity)) + '。覆盖年代取决于底图资料。'
      : '这里使用现代国界定位。历史政权可在对应年代的历史疆域视图中查找。') + '</p>' +
    (history && !polityNames.has(entity.name)
      ? '<details class="subject-secondary"><summary>底图原名</summary><p>' + esc(entity.name) + '</p></details>' : '') +
    subjectNeighbors() +
    sourcesMarkup(history ? [{title:'历史疆域 · Cliopatria',url:'https://github.com/Seshat-Global-History-Databank/cliopatria'}]
      : [{title:'现代底图 · Natural Earth',url:'https://www.naturalearthdata.com/'}]) +
    subjectLibraryLink() + '</div>';
}

function renderSubjectOutline(book) {
  const anchor = book.chapters.find((c) => coversYear(c, reading.year));
  const saved = session.readingProgress('subject:' + book.id);
  const progress = saved && book.chapters.some(chapter => chapter.id === saved.chapter) ? saved : null;
  return readingHeading(book.title, subjectYears(book)) + '<p class="lede">' + esc(book.summary) + '</p>' +
    '<nav class="reading-next subject-entry-actions" aria-label="开始阅读">' +
    (progress ? '<button type="button" data-subject-resume>继续阅读' + readingArrow + '</button>' : '') +
    subjectChapterButton(book.chapters[0].id, '从头读') +
    (anchor && anchor !== book.chapters[0] && anchor.id !== progress?.chapter
      ? subjectChapterButton(anchor.id, '跳到 ' + fmtYear(reading.year) + ' 年所在章节') : '') + '</nav>' +
    '<div class="subject-outline">' + readingRows(book.chapters.map((c) => readingRow({ ...c, date: subjectYears(c) },
      { current: c === anchor, timeline: true })), '章节目录', true) + '</div>' +
    subjectNeighbors() + subjectLibraryLink();
}

function sceneButton(scene) {
  const places = scene.places.slice(0, 3).map(place => place.name).join('、') + (scene.places.length > 3 ? '等 ' + scene.places.length + ' 处地点' : '');
  const badges = [];
  if (scene.routes?.length) badges.push('含路线');
  if (scene.steps?.length) badges.push(scene.steps.length + ' 步推演');
  if (scene.focusPolities?.length > 1) badges.push(scene.focusPolities.length + ' 方政权');
  const badgeHtml = badges.length
    ? '<span class="subject-scene-badges">' + badges.map(b => '<em>' + esc(b) + '</em>').join('') + '</span>'
    : '';
  const routeType = scene.routes?.[0]?.type || scene.routes?.[0]?.kind || 'trade';
  const label = ({canal:'漕运', military:'军事', frontier:'边防', trade:'贸易'})[routeType] || '史地';
  return '<button type="button" class="subject-scene scene-plate" data-subject-scene="' + esc(scene.id) + '">' +
    '<span class="scene-plate-top"><span class="scene-plate-tags"><em class="route-pill ' + esc(routeType) + '">' + label +
    '</em><small>' + esc(fmtYear(scene.year) + ' 年') + '</small></span><b>在地球观察 →</b></span>' +
    '<strong>' + esc(scene.title) + '</strong><small class="scene-plate-desc">' + esc(scene.summary) + '</small>' +
    '<span class="scene-place-preview">' + esc(places) + '</span>' + badgeHtml + '</button>';
}

function decorateParagraphPlaces(text, placeMatchers, linkedPlaces) {
  if (!placeMatchers.length) return esc(text);
  let html = esc(text);
  for (const item of placeMatchers) {
    if (linkedPlaces.has(item.key)) continue;
    const escapedName = esc(item.name);
    const idx = html.indexOf(escapedName);
    if (idx < 0) continue;
    // Avoid replacing inside an already-inserted HTML tag
    const before = html.slice(0, idx);
    if ((before.match(/<button/g) || []).length > (before.match(/<\/button>/g) || []).length) continue;
    linkedPlaces.add(item.key);
    const btn = '<button type="button" class="inline-place" data-pin-scene="' + esc(item.sceneId) +
      '" data-pin-place="' + esc(item.placeId) + '" title="在地球上定位：' + escapedName + '">' + escapedName + '</button>';
    html = before + btn + html.slice(idx + escapedName.length);
  }
  return html;
}

function renderSubjectChapter(book, chapter) {
  const index = book.chapters.indexOf(chapter);
  const next = book.chapters[index + 1];
  const previous = book.chapters[index - 1];
  const scenes = (chapter.sceneRefs || []).map(ref => ({after:ref.after, scene:historicalScenes.get(ref.id)}));
  const refs = [...new Set(chapter.paragraphs.flatMap((p) => p.refs))];
  const references = new Map(refs.map((id, i) => [id, i]));
  const sources = refs.map(id => book.sources[id]);
  const urls = new Set(sources.map(source => source.url));
  for (const {scene} of scenes) {
    for (const source of scene.sources) {
      if (urls.has(source.url)) continue;
      urls.add(source.url);
      sources.push(source);
    }
  }
  // Build inline place matchers from chapter scenes (longer names first)
  const placeMatchers = [];
  const seenNames = new Set();
  for (const { scene } of scenes) {
    for (const p of scene.places) {
      if (p.name.length < 2 || seenNames.has(p.name)) continue;
      seenNames.add(p.name);
      placeMatchers.push({ key: scene.id + ':' + p.id, name: p.name, sceneId: scene.id, placeId: p.id });
    }
  }
  placeMatchers.sort((a, b) => b.name.length - a.name.length);
  const linkedPlaces = new Set();

  const related = (chapter.related || []).map((link) => {
    const attrs = link.book ? ' data-subject-book="' + esc(link.book) + '" data-subject-chapter="' + esc(link.chapter || '') + '"'
      : ' data-reading-topic="' + esc(link.topic) + '" data-reading-chapter="' + esc(link.chapter || '') + '"';
    return '<button type="button"' + attrs + '>' + esc(link.label) + readingArrow + '</button>';
  }).join('');

  const contemporaries = (chapter.contemporaries || []).length
    ? '<section class="subject-contemporaries"><h2>同一时期的地球</h2><div class="contemporary-grid">' +
      chapter.contemporaries.map((item) => {
        const target = subjectsById.get(item.book);
        return '<button type="button" class="reading-card contemporary-card" data-subject-book="' + esc(item.book) +
          '" data-subject-chapter="' + esc(item.chapter || '') + '">' +
          '<small>' + esc(item.year ? fmtYear(item.year) + ' 年 · ' : '') + esc(target?.title || '') + '</small>' +
          '<strong>' + esc(item.label) + '</strong><span>' + esc(item.note) + '</span>' + readingArrow + '</button>';
      }).join('') + '</div></section>'
    : '';

  const thesisHtml = chapter.spatialThesis
    ? '<div class="subject-thesis"><span>空间线索</span><p>' + esc(chapter.spatialThesis) + '</p></div>'
    : '';

  const ribbon = '<nav class="chapter-ribbon" aria-label="切换书卷章节">' + book.chapters.map((item, i) =>
    '<button type="button" class="chapter-chip" data-reading-detail="' + esc(item.id) + '" aria-current="' +
    (item.id === chapter.id ? 'page' : 'false') + '">' + (i + 1) + ' · ' + esc(item.title) + '</button>').join('') + '</nav>';
  return ribbon + '<p class="subject-book-label">' + esc(book.title) + ' · 第 ' + (index + 1) + ' 章</p>' +
    readingHeading(chapter.title, subjectYears(chapter)) +
    thesisHtml +
    '<article class="subject-prose">' + chapter.paragraphs.map((paragraph, i) => {
      const headingHtml = paragraph.heading
        ? '<h2 class="subject-section-heading">' + esc(paragraph.heading) + '</h2>'
        : '';
      const calloutHtml = paragraph.callout
        ? '<aside class="subject-callout"><small>' + esc(paragraph.callout.label) + '</small>' +
          (paragraph.callout.title ? '<strong>' + esc(paragraph.callout.title) + '</strong>' : '') +
          '<p>' + esc(paragraph.callout.text) + '</p></aside>'
        : '';
      const bodyHtml = decorateParagraphPlaces(paragraph.text, placeMatchers, linkedPlaces);
      return headingHtml +
        '<p>' + bodyHtml + referencesMarkup(paragraph.refs.map((id) => references.get(id))) + '</p>' +
        calloutHtml +
        (!session.observe ? scenes.filter(ref => ref.after === i + 1).map(ref => sceneButton(ref.scene)).join('') : '');
    }).join('') + '</article>' +
    contemporaries +
    (next || previous ? '<nav class="reading-next subject-chapter-next" aria-label="连续阅读">' +
      (next ? subjectChapterButton(next.id, '下一章 · ' + next.title) : '') +
      (previous ? subjectChapterButton(previous.id, '上一章 · ' + previous.title) : '') + '</nav>' : '') +
    (related ? '<details class="subject-secondary"><summary>延伸阅读</summary><nav class="reading-next">' +
      related + '</nav></details>' : '') +
    sourcesMarkup(sources);
}

function syncSubjectGlobeForReading(book, chapter) {
  if (!isSplitReading() || !book) return;
  const firstRef = chapter?.sceneRefs?.[0] || book.chapters.find((c) => c.sceneRefs?.length)?.sceneRefs?.[0];
  if (firstRef) {
    const sc = historicalScenes.get(firstRef.id);
    if (sc) { syncSplitScene(sc, { force: true }); return; }
  }
  clearSplitScene();
  const targetYear = chapter ? chapter.from : clamp(reading.year, book.from, book.to ?? book.from);
  if (state.year !== targetYear) {
    state.year = targetYear;
    onYearChanged();
  }
}

function renderSubjectLibrary() {
  setReadingBack('返回阅读');
  bookBody.innerHTML = readingHeading('历史书目', '从建立、转折读到结局与影响') +
    subjectBooks.map((book) => '<button class="reading-card reading-link" type="button" data-subject-book="' + esc(book.id) +
      '"><small>' + esc(subjectYears(book)) + '</small><strong>' + esc(book.title) + '</strong>' + readingArrow + '</button>').join('') +
    '<nav class="reading-next"><button type="button" data-reading-catalog>补充专题资料' + readingArrow + '</button></nav>';
  bookBody.scrollTop = reading.scroll;
}

function followSubject({ book = null, chapter = null, entity = null, library = false } = {}) {
  const ref = entity && { layerId: entity.layerId, key: entity.key, name: entity.name };
  navigateReading({ entity: ref, bookId: book?.id, topicId: null, detail: chapter?.id,
    library, catalog: false, scroll: 0, position: null, linkEntry: true });
}

function handleSubjectButton(button) {
  if (button.hasAttribute('data-subject-resume')) {
    const saved = session.readingProgress(readingKey());
    if (saved) openReadingDetail(saved.chapter, saved.position);
  } else if (button.hasAttribute('data-subject-library')) followSubject({ library: true });
  else if (button.hasAttribute('data-subject-book')) {
    const book = subjectsById.get(button.dataset.subjectBook);
    if (book) followSubject({ book, chapter: book.chapters.find((c) => c.id === button.dataset.subjectChapter) });
  } else if (button.hasAttribute('data-atlas-entity')) {
    const entity = entityByKey('polity', Number(button.dataset.atlasEntity));
    if (entity) followSubject({ entity, book: subjectBookForEntity(entity, reading.year) });
  } else if (button.hasAttribute('data-subject-scene')) {
    const chapter = reading.subject?.chapters.find((c) => c.id === reading.detail);
    const id = button.dataset.subjectScene;
    if (chapter?.sceneRefs?.some(ref => ref.id === id)) openReadingScene(historicalScenes.get(id), button);
  } else if (button.hasAttribute('data-pin-scene')) {
    const sc = historicalScenes.get(button.dataset.pinScene);
    if (sc) openReadingScene(sc, button, { initialPlaceId: button.dataset.pinPlace });
  }
}
