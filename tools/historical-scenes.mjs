import {readFileSync} from 'node:fs';
import {join} from 'node:path';

function distanceLabel(first, second) {
  const rad = Math.PI / 180;
  const haversine = Math.sin((second.lat - first.lat) * rad / 2) ** 2 +
    Math.cos(first.lat * rad) * Math.cos(second.lat * rad) *
    Math.sin((second.lon - first.lon) * rad / 2) ** 2;
  const km = 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(haversine)));
  const rounded = km < 10 ? Math.round(km * 10) / 10 : Math.round(km / 10) * 10;
  const distance = rounded ? '约 ' + rounded + ' 公里' : '不足 100 米';
  return first.name + '至' + second.name + ' · 直线' + distance;
}

const ROUTE_KINDS = new Set(['military', 'trade', 'canal', 'frontier']);
const validCoord = (pair) => Array.isArray(pair) && pair.length === 2 &&
  Number.isFinite(pair[0]) && Math.abs(pair[0]) <= 180 &&
  Number.isFinite(pair[1]) && Math.abs(pair[1]) <= 90;

export function loadHistoricalScenes(root, books, topics) {
  const records = JSON.parse(readFileSync(join(root, 'data/scenes.json'), 'utf8'));
  const topicEvents = new Map(topics.flatMap(topic => topic.chapters.filter(chapter => chapter.mapStory)
    .map(chapter => [chapter.mapStory.worldEntryId, chapter])));
  const scenes = new Map();
  const linkedEvents = new Set();
  const validYear = year => Number.isSafeInteger(year) && year !== 0;
  const require = (condition, label) => { if (!condition) throw new Error('历史场景校验失败：' + label); };

  for (const record of records) {
    const {id, topicEvent} = record;
    require(typeof id === 'string' && /^[a-z][a-z0-9-]*$/.test(id) && !scenes.has(id), id);
    let scene = record;
    if (topicEvent) {
      const chapter = topicEvents.get(topicEvent);
      require(chapter?.place && !linkedEvents.has(topicEvent), id + ' 专题事件');
      linkedEvents.add(topicEvent);
      const story = chapter.mapStory;
      const [name, role] = chapter.place.label.split(' · ', 2);
      scene = {
        id, topicEvent, year:chapter.year, title:story.title, summary:story.summary,
        places:[{id:'main', name, role, lon:chapter.place.lon, lat:chapter.place.lat}, ...story.places],
        sources:story.refs.map(index => chapter.sources[index]),
      };
    }
    require(scene.title && scene.summary && validYear(scene.year) &&
      (scene.from === undefined && scene.to === undefined ||
        validYear(scene.from) && validYear(scene.to) && scene.from <= scene.year && scene.year <= scene.to), id + ' 年代');
    require(Array.isArray(scene.places) && scene.places.length >= 2 && new Set(scene.places.map(p => p.id)).size === scene.places.length &&
      scene.places.every(p => p.id && p.name && p.role && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180 &&
        Number.isFinite(p.lat) && Math.abs(p.lat) <= 90), id + ' 地点');
    require(scene.sources?.length && scene.sources.every(s => s?.title && /^https:\/\//.test(s.url)), id + ' 来源');
    const placeIds = new Set(scene.places.map(p => p.id));
    if (scene.routes !== undefined) {
      require(Array.isArray(scene.routes) && scene.routes.every(r =>
        r && (placeIds.has(r.from) || validCoord(r.from)) && (placeIds.has(r.to) || validCoord(r.to)) &&
        (r.via === undefined || (Array.isArray(r.via) && r.via.every(validCoord))) &&
        (r.kind === undefined || ROUTE_KINDS.has(r.kind)) &&
        (r.label === undefined || typeof r.label === 'string')
      ), id + ' 路线');
    }
    if (scene.focusPolities !== undefined) {
      require(Array.isArray(scene.focusPolities) && scene.focusPolities.every(name => typeof name === 'string' && name.length > 0), id + ' 关联政权');
    }
    if (scene.steps !== undefined) {
      const routeCount = scene.routes?.length || 0;
      require(Array.isArray(scene.steps) && scene.steps.length >= 2 && scene.steps.every(step =>
        step && validYear(step.year) && step.title && step.note &&
        (step.places === undefined || (Array.isArray(step.places) && step.places.every(pid => placeIds.has(pid)))) &&
        (step.routes === undefined || (Array.isArray(step.routes) && step.routes.every(idx => Number.isInteger(idx) && idx >= 0 && idx < routeCount))) &&
        (step.focusPolities === undefined || (Array.isArray(step.focusPolities) && step.focusPolities.every(name => typeof name === 'string' && name.length > 0)))
      ), id + ' 演进步骤');
    }
    if (scene.distanceBetween !== undefined) {
      require(Array.isArray(scene.distanceBetween) && scene.distanceBetween.length === 2, id + ' 距离地点');
      const [first, second] = scene.distanceBetween.map(key => scene.places.find(place => place.id === key));
      require(first && second && first !== second && (first.lat !== second.lat || first.lon !== second.lon), id + ' 距离地点');
      scene = {...scene, distanceLabel: distanceLabel(first, second)};
    }
    scenes.set(id, scene);
  }

  const used = new Set();
  for (const book of books) {
    for (const chapter of book.chapters) {
      const seen = new Set();
      require(!chapter.map, book.id + '/' + chapter.id + ' 应使用场景引用');
      for (const ref of chapter.sceneRefs || []) {
        const scene = scenes.get(ref.id);
        require(scene && !seen.has(ref.id) && Number.isInteger(ref.after) && ref.after >= 1 &&
          ref.after <= chapter.paragraphs.length && scene.year >= chapter.from &&
          scene.year <= (chapter.to ?? Infinity), book.id + '/' + chapter.id + ' → ' + ref.id);
        seen.add(ref.id);
        used.add(ref.id);
      }
    }
  }
  require(used.size === scenes.size, '存在未关联书卷的场景');
  return [...scenes.values()];
}
