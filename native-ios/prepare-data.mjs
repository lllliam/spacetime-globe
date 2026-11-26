import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadHistoryModel } from '../tools/history-model.mjs';
import history from '../src/history-rules.js';

const root = new URL('../', import.meta.url);
const bundle = new URL('./OfflineData/', import.meta.url);
const chapterDirectory = new URL('Chapters/', bundle);
mkdirSync(chapterDirectory, { recursive: true });
const model = loadHistoryModel(fileURLToPath(root));
const { world } = model;
const hash = createHash('sha256');
const read = path => readFileSync(new URL(path, root));
const json = path => JSON.parse(read(path));
function publish(path, bytes) {
  hash.update(path + '\0').update(bytes).update('\0');
  writeFileSync(new URL(path, bundle), bytes);
}
const write = (path, value) => publish(path, JSON.stringify(value));
const references = list => (list ?? []).map(ref => typeof ref === 'string' ? { sourceId: ref } : ref);
const block = value => ({
  ...value, heading:value.heading ?? value.title ?? value.headline, refs:references(value.refs),
  ...(value.callout && {callout:{...value.callout, refs:references(value.callout.refs)}}),
});
const aliases = value => Array.isArray(value.aliases) ? value.aliases.filter(x=>typeof x==='string') : [];

function readingLink(value, fallback) {
  const topic = value.topicId ?? value.topic;
  return {
    ...value,
    id:value.id, volume:value.book ?? (topic && 'topic:' + topic), chapter:value.chapter ?? value.chapterId,
    relation:value.relation ?? fallback, note:value.display ?? value.reason ?? value.note,
    refs:references(value.evidence),
  };
}

const byId = new Map(world.entries.map(event => [event.id,event]));
const regionByID = new Map(world.regions.map(region => [region.id,region]));
const groups = model.eventGroups.map(([groupId,id, memberIds, title]) => ({
  groupId, event:byId.get(id), members:memberIds.map(member => byId.get(member)), title,
}));
const grouped = new Set(groups.flatMap(g=>g.members.map(e=>e.id)));
for (const event of world.entries) {
  if (!grouped.has(event.id)) groups.push({ event, members:[event] });
}
const topicEvents = new Map();
const scenesByEvent = new Map();
for (const topic of model.topics) for (const chapter of topic.chapters) {
  if (chapter.mapStory?.worldEntryId) topicEvents.set(chapter.mapStory.worldEntryId,{topic,chapter});
}
for (const scene of model.scenes) if (scene.topicEvent) scenesByEvent.set(scene.topicEvent, scene);

const volumeRegions = new Map();
const events = groups.map(({groupId,event,members,title}) => {
  const memberIds = members.map(m=>m.id);
  const point = members.find(({px,py})=>Number.isFinite(px) && Number.isFinite(py));
  const note = members.map(m=>model.notes[m.id]).find(Boolean);
  const reading = new Map(), linked = members.map(m=>topicEvents.get(m.id)).find(Boolean);
  const regions = [...new Set(members.map(m=>regionByID.get(m.region)?.zh).filter(Boolean))];
  for (const member of members) {
    const target = model.eventLinks.get(member.id);
    if (!target) continue;
    reading.set(target.join('/'), {volume:target[0],chapter:target[1]});
    const labels = volumeRegions.get(target[0]) ?? new Set();
    for (const label of regions) labels.add(label);
    volumeRegions.set(target[0],labels);
  }
  if (linked) {
    const volume = 'topic:' + linked.topic.id;
    reading.set(volume + '/' + linked.chapter.id,{volume,chapter:linked.chapter.id});
  }
  const scene = members.map(m=>scenesByEvent.get(m.id)).find(s=>s?.status==='available');
  const from = note?.start ?? event.start, to = note?.end ?? (event.point ? event.start : event.end ?? event.start);
  const labels = [...new Set([...members.flatMap(m=>[m.zh,m.en,m.es,...aliases(m)]),...regions])].filter(Boolean);
  return {
    id:event.id,groupId,memberIds,title:title || note?.title || event.zh,aliases:labels,
    from,to,date:note?.date,
    background:note?.context === true || (from !== to && (event.kind === 'era' || to - from >= (event.kind === 'other' ? 40 : 12))),
    regions,sources:[...new Set(members.map(member => member.source).filter(Boolean))],
    ...(point && {lon:point.px * .36 - 180,lat:90 - point.py * .36,placement:'region'}),
    reading:[...reading.values()], scene:scene?.id,
    ...(note && {annotation:{...note,blocks:note.paragraphs.map(block)}}),
  };
});

const volumeIndex = [];
const chapterKeys = new Set();
const chapterFiles = new Set();
function catalogVolume({id, title, from, to, date, summary, notice, scope, regions, sources, chapters, links, aliases, subjectIds, audit}) {
  const entries = chapters.map(({header,body}) => {
    const key = id + '/' + header.id;
    assert.ok(!chapterKeys.has(key), key);
    assert.ok(body.blocks.length, key);
    chapterKeys.add(key);
    const file = 'Chapters/' + createHash('sha256').update(key).digest('hex').slice(0,24) + '.json';
    chapterFiles.add(file);
    write(file, body);
    return {...header, file};
  });
  volumeIndex.push({id,title,from,to,date,summary,notice,scope,regions,sources,chapters:entries,links,aliases,subjectIds,audit});
}
for (const book of model.books) {
  catalogVolume({
    ...book, date:book.dateLabel, notice:book.editorialNotice, regions:[...(volumeRegions.get(book.id) ?? [])],
    aliases:aliases(book), links:[],
    chapters:book.chapters.map(ch => {
      const {paragraphs,related,contemporaries,sceneRefs,...fields} = ch;
      const links = [
        ...(related ?? []).map(link=>readingLink(link,'further')),
        ...(contemporaries ?? []).map(link=>readingLink(link,'contemporary')),
      ].filter(x=>x.volume);
      return {
        header:{id:ch.id,title:ch.title,from:ch.from,to:ch.to,date:ch.dateLabel,summary:ch.summary,
          kind:ch.kind,aliases:aliases(ch),recommendation:ch.recommendation === false ? undefined : ch.recommendation,
          recommend:ch.recommendation !== false && Boolean(ch.recommendation || !ch.kind || ch.kind === 'narrative')},
        body:{...fields,scope:ch.scope,thesis:ch.spatialThesis,blocks:paragraphs.map(block),links,scenes:sceneRefs ?? []},
      };
    }),
  });
}
for (const topic of model.topics) {
  catalogVolume({
    ...topic, id:'topic:' + topic.id, date:topic.subtitle, regions:topic.continents, aliases:aliases(topic),
    links:(topic.connections ?? []).map(link=>readingLink(link,'further')).filter(x=>x.volume),
    chapters:topic.chapters.map(ch => {
      const {opening,sections,connections,...fields} = ch;
      const scene = scenesByEvent.get(ch.mapStory?.worldEntryId);
      return {
        header:{id:ch.id,title:ch.title,from:ch.year,to:ch.year,date:ch.date,summary:ch.summary,aliases:aliases(ch),recommend:true},
        body:{...fields,blocks:[...(opening ? [opening] : []), ...sections].map(block),
          links:(connections ?? []).map(link=>readingLink(link,'further')).filter(x=>x.volume),
          scenes:scene ? [{id:scene.id}] : []},
      };
    }),
  });
}

const scenes = model.scenes.map(scene => {
  const steps = scene.steps?.length ? scene.steps : [{id:'overview',title:'总览'}];
  return {...scene, frames:steps.map(step => {
    const frame = history.observationFrame(scene,step);
    const locations = new Map(frame.places.map(place => [place.id,[place.lon,place.lat]]));
    const resolve = point => typeof point === 'string' ? locations.get(point) : point;
    const routes = frame.routes.map(route=>({
      ...route, coordinates:[route.from, ...(route.precision==='schematic' ? [] : route.via ?? []), route.to]
        .map(resolve).filter(Array.isArray),
    })).filter(route=>route.coordinates.length >= 2);
    return {...step,year:frame.year,places:frame.places,routes,focusPolities:frame.focusPolities};
  })};
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
const subjects = {};
for (const [key, subject] of model.compiledSubjects) {
  const record = model.subjects.get(subject.id);
  subjects[key] = {...record,...subject,aliases:aliases(record)};
}
const books = {};
for (const row of model.bindings) {
  const key = row.map.type + ':' + row.map.key;
  (books[key] ??= []).push({
    volume:row.target.bookId,chapter:row.target.chapterId,from:row.range.from,to:row.range.to,relation:row.relation,
    reason:row.scope,audit:row.audit,subjectId:row.subjectId,
  });
}
for (const rows of Object.values(books)) rows.sort((a,b)=>
  Number(b.relation==='primary')-Number(a.relation==='primary') || a.volume.localeCompare(b.volume) || a.from-b.from);
const coverage = model.metadata.polity.coverage;
const atlas = {
  countries, books, coverage, subjects,
  names:Object.fromEntries(model.polityNames.names), relations:[...model.polityNames.relations.keys()],
  mapSources:model.metadata,
};

const volumeIds = new Set(volumeIndex.map(v=>v.id));
for (const path of readdirSync(chapterDirectory)) {
  if (/^[0-9a-f]{24}\.json$/.test(path) && !chapterFiles.has('Chapters/' + path)) {
    unlinkSync(new URL(path,chapterDirectory));
  }
}
for (const event of events) for (const target of event.reading) {
  assert.ok(volumeIds.has(target.volume), event.id);
  if (target.chapter) assert.ok(chapterKeys.has(target.volume + '/' + target.chapter), event.id);
}
assert.equal(new Set(events.flatMap(e=>e.memberIds)).size, world.entries.length);
assert.equal(scenes.length, model.scenes.length);
write('Library.json',{volumes:volumeIndex,events});
write('Scenes.json',scenes);
write('Atlas.json',atlas);
write('Editorial.json',{
  registryVersion:model.version,
  subjects:[...model.subjects.values()],
  bindings:model.bindings,
  eventIdentities:json('data/history/event-identities.json'),
  eventEntries:world.entries,
  geographicRegions:world.regions,
  observationRecords:json('data/scenes.json'),
});
for (const file of ['polity.bin','earth-detail.jpg','clouds.png','terrain-4k-v1.png']) publish(file,read('data/' + file));
const contentVersion = hash.digest('hex').slice(0,16);
writeFileSync(new URL('Manifest.json',bundle),JSON.stringify({schemaVersion:2,contentVersion,registryVersion:model.version}));
writeFileSync(new URL('Globe.metal.txt',bundle),read('native-ios/Globe.metal'));
assert.equal(read('data/polity.bin').toString('ascii',0,4), 'SGP1');
console.log(volumeIndex.length + ' volumes/topics, ' + chapterKeys.size + ' texts, ' + events.length +
  ' events, ' + scenes.length + ' scenes, schema 2, content ' + contentVersion);
