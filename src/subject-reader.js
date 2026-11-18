const subjectBooks = JSON.parse(inlineText('subject-books'));
const historicalScenes = new Map(JSON.parse(inlineText('historical-scenes')).map(scene => [scene.id, scene]));
const subjectsById = new Map(subjectBooks.map((book) => [book.id, book]));
const subjectsByPolity = new Map(subjectBooks.flatMap((book) => book.polityIds.map((id, i) =>
  [id, { book, name: book.polities[i] }])));
const subjectsByEvent = new Map(subjectBooks.flatMap((book) => book.chapters.flatMap((chapter) =>
  (chapter.eventIds || []).map((id) => [id, { book, chapter }]))));
const subjectProgress = new Map();

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
  return '<div class="sheet-overview"><h2>' + esc(title) + '</h2>' +
    '<p class="era">' + esc(meta) + '</p></div>' +
    (book ? '<p class="subject-sheet-summary">' + esc(book.summary) + '</p>' : '') +
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
  const candidates = (reading.snapshot.focus?.atlasPeers || []).filter((id) => id !== reading.ent.entId)
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
  return readingHeading(title, '地图资料 · ' + fmtYear(reading.year) + ' 年入口') +
    '<p class="lede">这个主体的历史正文尚未收录。</p>' +
    '<p class="reading-note">' + (history ? '疆域资料记录于 ' + esc(subjectYears(entity)) + '。覆盖年代取决于底图资料。'
      : '这里使用现代国界定位。历史政权可在对应年代的历史疆域视图中查找。') + '</p>' +
    (history && !polityNames.has(entity.name)
      ? '<details class="subject-secondary"><summary>底图原名</summary><p>' + esc(entity.name) + '</p></details>' : '') +
    subjectNeighbors() +
    sourcesMarkup(history ? [{title:'历史疆域 · Cliopatria',url:'https://github.com/Seshat-Global-History-Databank/cliopatria'}]
      : [{title:'现代底图 · Natural Earth',url:'https://www.naturalearthdata.com/'}]) +
    subjectLibraryLink();
}

function renderSubjectOutline(book) {
  const anchor = book.chapters.find((c) => coversYear(c, reading.year));
  const progress = subjectProgress.get(book.id);
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
  const places = scene.places.slice(0, 3).map(place => place.name).join('、') + (scene.places.length > 3 ? '等地点' : '');
  return '<button type="button" class="subject-scene" data-subject-scene="' + esc(scene.id) + '">' +
    '<span><strong>在地球上看 · ' + esc(scene.title) + '</strong><small>' +
    esc(fmtYear(scene.year) + ' 年 · ' + places) + '</small></span>' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4.5" ry="9"/><path d="M3.5 12h17M5.5 7.5h13m-13 9h13"/></svg></button>';
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
  const related = (chapter.related || []).map((link) => {
    const attrs = link.book ? ' data-subject-book="' + esc(link.book) + '" data-subject-chapter="' + esc(link.chapter || '') + '"'
      : ' data-reading-topic="' + esc(link.topic) + '" data-reading-chapter="' + esc(link.chapter || '') + '"';
    return '<button type="button"' + attrs + '>' + esc(link.label) + readingArrow + '</button>';
  }).join('');
  return '<p class="subject-book-label">' + esc(book.title) + ' · 第 ' + (index + 1) + ' 章</p>' +
    readingHeading(chapter.title, subjectYears(chapter)) +
    '<article class="subject-prose">' + chapter.paragraphs.map((paragraph, i) =>
      '<p>' + esc(paragraph.text) + referencesMarkup(paragraph.refs.map((id) => references.get(id))) + '</p>' +
      (!worldEvent ? scenes.filter(ref => ref.after === i + 1).map(ref => sceneButton(ref.scene)).join('') : '')).join('') + '</article>' +
    (next || previous ? '<nav class="reading-next subject-chapter-next" aria-label="连续阅读">' +
      (next ? subjectChapterButton(next.id, '下一章 · ' + next.title) : '') +
      (previous ? subjectChapterButton(previous.id, '上一章 · ' + previous.title) : '') + '</nav>' : '') +
    (related ? '<details class="subject-secondary"><summary>延伸阅读</summary><nav class="reading-next">' +
      related + '</nav></details>' : '') +
    sourcesMarkup(sources);
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
  rememberReading();
  reading.trail.push(readingFrame());
  Object.assign(reading, { ent: entity, subject: book, topic: null, detail: chapter?.id || null,
    library, catalog: false, scroll: 0, detailScroll: 0, linkEntry: true });
  renderReading();
  el('reading-title').focus({ preventScroll: true });
}

function handleSubjectButton(button) {
  if (button.hasAttribute('data-subject-resume')) {
    const saved = subjectProgress.get(reading.subject.id);
    if (saved) openReadingDetail(saved.chapter, saved.offset);
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
  }
}
