import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {readPolityIds} from './polity-names.mjs';

export function loadSubjectBooks(root) {
  const read = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'));
  const dir = join(root, 'data/books');
  const books = readdirSync(dir).filter((file) => file.endsWith('.json')).sort().map((file) => read('data/books/' + file));
  const topics = new Map(readdirSync(join(root, 'data/topics')).filter((file) => file.endsWith('.json'))
    .map((file) => { const topic = read('data/topics/' + file); return [topic.id, topic]; }));
  const world = read('data/world.json');
  const countries = new Set(world.map.map(([iso]) => iso));
  const events = new Map([...topics.values()].flatMap((t) => t.chapters.filter((c) => c.mapStory)
    .map((c) => [c.mapStory.worldEntryId, c.year])));
  const byId = new Map(books.map((book) => [book.id, book]));
  const polityIds = readPolityIds(root);
  const claimed = new Set(), boundEvents = new Set();
  const validYear = (year) => Number.isInteger(year) && year !== 0;
  const idFormat = /^[a-z][a-z0-9-]*$/;
  const require = (valid, label) => { if (!valid) throw new Error('历史书校验失败：' + label); };
  require(books.length && byId.size === books.length, '书卷身份缺失或重复');
  for (const book of books) {
    require(typeof book.id === 'string' && idFormat.test(book.id) && book.title && book.summary && validYear(book.from) &&
      (book.to === null || validYear(book.to) && book.to >= book.from) &&
      book.chapters?.length > 1 && book.polities?.length && book.sources?.length, book.id);
    require(book.sources.every((s) => s.title && /^https:\/\//.test(s.url)), book.id + ' 出处');
    require(book.dateLabel === undefined || typeof book.dateLabel === 'string' && /\p{Script=Han}/u.test(book.dateLabel),
      book.id + ' 书卷年代说明');
    book.polityIds = book.polities.map((name) => {
      const id = polityIds.get(name);
      require(id !== undefined && !claimed.has(id), book.id + ' 疆域绑定 ' + name);
      claimed.add(id);
      return id;
    });
    for (const binding of book.countries || []) {
      require(countries.has(binding.iso) && validYear(binding.from) && binding.from >= book.from &&
        (binding.to ?? Infinity) <= (book.to ?? Infinity) && (binding.to == null || validYear(binding.to) && binding.to >= binding.from),
        book.id + ' 现代边界入口');
    }
    const seen = new Set();
    let next = book.from;
    const refs = (list) => list?.length && list.every((i) => Number.isInteger(i) && book.sources[i]);
    for (const chapter of book.chapters) {
      const label = book.id + '/' + chapter.id;
      require(typeof chapter.id === 'string' && idFormat.test(chapter.id) && !seen.has(chapter.id) && chapter.title && chapter.summary &&
        validYear(chapter.from) && chapter.from === next &&
        (chapter.to === null ? chapter === book.chapters.at(-1) && book.to === null
          : validYear(chapter.to) && chapter.to >= chapter.from) &&
        chapter.paragraphs?.length >= 3 && chapter.paragraphs.every((p) => p.text && refs(p.refs)), label);
      seen.add(chapter.id);
      if (chapter.to !== null) next = chapter.to === -1 ? 1 : chapter.to + 1;
      for (const id of chapter.eventIds || []) {
        const year = events.get(id);
        require(year >= chapter.from && year <= (chapter.to ?? Infinity) && !boundEvents.has(id), label + ' 事件 ' + id);
        boundEvents.add(id);
      }
      for (const link of chapter.related || []) {
        const target = link.book ? byId.get(link.book) : topics.get(link.topic);
        require(link.label && target && (!link.chapter || target.chapters.some((c) => c.id === link.chapter)), label + ' 关联');
      }
    }
    require(book.chapters.at(-1).to === book.to, book.id + ' 终止年');
  }
  const modern = books.flatMap((book) => book.countries || []);
  require(!modern.some((a, i) => modern.slice(i + 1).some((b) => a.iso === b.iso &&
    a.from <= (b.to ?? Infinity) && b.from <= (a.to ?? Infinity))), '现代边界入口重叠');
  return books;
}
