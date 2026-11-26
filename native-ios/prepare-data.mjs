import { strict as assert } from 'node:assert';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadHistoryModel } from '../tools/history-model.mjs';
import history from '../src/history-rules.js';

const root = new URL('../', import.meta.url);
const bundle = new URL('./OfflineData/', import.meta.url);
mkdirSync(bundle, { recursive: true });
const model = loadHistoryModel(fileURLToPath(root));
const { world } = model;
const write = (file, content) => writeFileSync(new URL(file, bundle), JSON.stringify(content), 'utf8');
const sources = list => (list ?? []).map(({id,title,url,note}) => ({id,title,url,note}));
const references = list => (list ?? []).map(ref => typeof ref === 'string' ? { sourceId: ref } : ref);
const block = value => ({
  id:value.id, heading:value.heading ?? value.title, text:value.text, refs:references(value.refs),
  ...(value.callout && {callout:{...value.callout, refs:references(value.callout.refs)}}),
});
const link = value => ({
  id:value.id, volume:value.book ?? (value.topicId && 'topic:' + value.topicId),
  chapter:value.chapter ?? value.chapterId, label:value.label,
  note:value.display ?? value.reason, refs:references(value.evidence),
});

const volumes = [...model.books.map(book => ({
  id:book.id, title:book.title, from:book.from, to:book.to, summary:book.summary, notice:book.editorialNotice,
  chapters:book.chapters.map(ch => ({
    id:ch.id, title:ch.title, from:ch.from, to:ch.to, date:ch.dateLabel, summary:ch.summary,
    scope:ch.scope, thesis:ch.spatialThesis, thesisId:ch.spatialThesisId,
    recommend:ch.recommendation !== false && Boolean(ch.recommendation || !ch.kind || ch.kind === 'narrative'),
    recommendationPriority:ch.recommendation?.priority,
    recommendationFrom:ch.recommendation?.range?.from,
    recommendationTo:ch.recommendation?.range?.to,
    blocks:ch.paragraphs.map(block), sources:sources(book.sources),
    links:[...(ch.related ?? []), ...(ch.contemporaries ?? [])].map(link).filter(x=>x.volume),
    scenes:ch.sceneRefs ?? [],
  })),
})), ...model.topics.map(topic => ({
  id:'topic:' + topic.id, title:topic.title, from:topic.from, to:topic.to,
  summary:topic.summary, subtitle:topic.subtitle, notice:topic.scope, continents:topic.continents,
  chapters:topic.chapters.map(ch => ({
    id:ch.id, title:ch.title, from:ch.year, to:ch.year, date:ch.date, summary:ch.summary, recommend:true,
    blocks:ch.sections.map(block), sources:sources(ch.sources),
    links:(ch.connections ?? []).map(link).filter(x=>x.volume),
    scenes:model.scenes.filter(scene => scene.topicEvent && scene.topicEvent === ch.mapStory?.worldEntryId)
      .map(scene => ({id:scene.id})),
  })),
}))];

const byId = new Map(world.entries.map(event => [event.id,event]));
const grouped = new Set();
const groups = model.eventGroups.map(([, id, memberIds, title]) => {
  const members = memberIds.map(member => byId.get(member));
  memberIds.forEach(member => grouped.add(member));
  assert.ok(members.every(Boolean), id);
  return {event:byId.get(id) ?? members[0], members, title};
});
for (const event of world.entries) {
  if (!grouped.has(event.id)) groups.push({ event, members:[event] });
}
const regionNames = new Map(world.regions.map(region => [region.id,region.zh]));
const events = groups.map(({event,members,title}) => {
  const point = members.find(({px,py})=>Number.isFinite(px) && Number.isFinite(py));
  const reading = new Map();
  for (const member of members) {
    const target = model.eventLinks.get(member.id);
    if (target) reading.set(target.join('/'), {volume:target[0],chapter:target[1]});
  }
  for (const topic of model.topics) for (const chapter of topic.chapters) {
    if (members.some(member => member.id === chapter.mapStory?.worldEntryId)) {
      reading.set(topic.id + '/' + chapter.id,{volume:'topic:' + topic.id,chapter:chapter.id});
    }
  }
  return {
    id:event.id,title:title || event.zh,from:event.start,to:event.point ? event.start : event.end ?? event.start,
    background:!event.point && (event.kind === 'era' || event.end - event.start >= (event.kind === 'other' ? 40 : 12)),
    regions:[...new Set(members.map(member => regionNames.get(member.region)).filter(Boolean))],
    sources:[...new Set(members.map(member => member.source).filter(Boolean))],
    ...(point && {lon:point.px * .36 - 180,lat:90 - point.py * .36}),
    reading:[...reading.values()], scene:model.scenes.find(scene => members.some(member => member.id === scene.topicEvent))?.id,
  };
});

const modern = new Map();
for (const [iso, path] of world.map) {
  const key = iso === 'TW' ? 'CN' : iso;
  const rings = (modern.get(key) ?? []);
  for (const ring of path.split('Z')) {
    const points = [...ring.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)]
      .map(([, x, y]) => [Number(x), Number(y)]);
    if (points.length >= 3) rings.push(points);
  }
  modern.set(key, rings);
}
const countries = [...modern].map(([iso,rings]) => ({id:iso,name:world.isoNames[iso] ?? iso,rings}));
const books = Object.fromEntries(model.mapBindings.map(([key,bindings])=>[key,bindings.map(
  ([volume,from,to,relation,reason,chapter])=>({volume,from,to,relation,reason,chapter}))]));
const coverage = model.metadata.polity.coverage;
const atlas = {
  countries, books, coverage, subjects:Object.fromEntries(model.compiledSubjects),
  names:Object.fromEntries(model.polityNames.names), relations:[...model.polityNames.relations.keys()],
  mapSources:model.metadata,
};

const chapterKeys = new Set(volumes.flatMap(v => v.chapters.map(ch => v.id + '/' + ch.id)));
const sceneKeys = new Set(model.scenes.map(scene => scene.id));
assert.equal(chapterKeys.size, volumes.reduce((n,v)=>n+v.chapters.length,0));
for (const event of events) for (const target of event.reading) {
  assert.ok(volumes.some(v=>v.id===target.volume));
  if (target.chapter) assert.ok(chapterKeys.has(target.volume + '/' + target.chapter));
}
for (const volume of volumes) for (const chapter of volume.chapters) {
  assert.ok(chapter.blocks.length, volume.id + '/' + chapter.id);
  for (const scene of chapter.scenes) assert.ok(sceneKeys.has(scene.id), scene.id);
}
assert.ok(events.find(e=>e.id==='i-tr-constantinople-1453').reading.some(t=>t.volume==='roman'));
assert.ok(books['polity:Ming Dynasty'].some(t=>t.volume==='ming' && t.from<=1500 && t.to>=1500));

const scenes = model.scenes.map(scene => {
  const steps = scene.steps?.length ? scene.steps : [{id:"overview", title:"总览"}];
  return {...scene, frames:steps.map(step => {
    const frame = history.observationFrame(scene,step);
    const locations = new Map(frame.places.map(place => [place.id,[place.lon,place.lat]]));
    const resolve = point => typeof point === 'string' ? locations.get(point) : point;
    const routes = frame.routes.map(route=>({
      id:route.id, label:route.label, note:route.note, precision:route.precision,
      coordinates:[route.from, ...(route.via ?? []), route.to].map(resolve).filter(Array.isArray),
    })).filter(route=>route.coordinates.length >= 2);
    return {...step,year:frame.year,places:frame.places,routes};
  })};
});
write('Library.json', {volumes,events,scenes});
write('Atlas.json', atlas);
for (const file of ['polity.bin','earth-detail.jpg','clouds.png','terrain-4k-v1.png']) {
  copyFileSync(new URL('data/' + file,root), new URL(file,bundle));
}
copyFileSync(new URL('./Globe.metal',import.meta.url), new URL('Globe.metal.txt',bundle));
assert.equal(readFileSync(new URL('polity.bin',bundle)).toString('ascii',0,4), 'SGP1');
console.log(`${volumes.length} volumes/topics, ${chapterKeys.size} texts, ${events.length} events, ${model.scenes.length} scenes, ${countries.length} modern shapes`);
