/* 编辑验收：字数是底线，不代表史学质量自动通过。事实与解释仍需人工核对。 */
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadSubjectBooks} from './subject-books.mjs';
import {loadPolityNames} from './polity-names.mjs';
import {loadHistoricalScenes} from './historical-scenes.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const subjectBooks = loadSubjectBooks(root);
const polityNames = loadPolityNames(root);
const bookChapters = subjectBooks.reduce((total, book) => total + book.chapters.length, 0);
const read = (f) => JSON.parse(readFileSync(join(root, f), 'utf8'));
const plan = read('data/content-plan.json');
const topics = readdirSync(join(root, 'data/topics')).filter(f=>f.endsWith('.json')).map(f=>read('data/topics/'+f));
const historicalScenes = loadHistoricalScenes(root, subjectBooks, topics);
const byId = new Map(topics.map(t=>[t.id,t]));
const problems = [], warnings = [], texts = new Set(), sources = new Set();
let chapters=0, chars=0;
const lengthOf = c => (c.sections.map(s=>s.text).join('').match(/[\u3400-\u9fff]/g)||[]).length;
for(const p of plan) {
  const t=byId.get(p.id);
  if(!t) {problems.push('缺专题：'+p.title); continue;}
  if(t.chapters.length!==p.chapters) problems.push(t.id+' 节点数不符合计划');
}
if(byId.size!==topics.length) problems.push('专题 id 重复');
for(const t of topics) {
  if(!plan.some(p=>p.id===t.id)) problems.push('未纳入覆盖计划：'+t.id);
  if(!Number.isFinite(t.from)||!Number.isFinite(t.to)||t.from>t.to) problems.push('年代不合法：'+t.id);
  if(!t.continents?.length || !t.countryIsos?.length || !t.scope) problems.push('专题范围缺失：'+t.id);
  const ids=new Set();
  for(const c of t.chapters) {
    chapters++; const n=lengthOf(c); chars+=n;
    const label=t.id+'/'+c.id;
    if(ids.has(c.id)) problems.push('节点 id 重复：'+label); ids.add(c.id);
    if(n<500||n>800) problems.push(label+' 正文 '+n+' 字，不在500—800之间');
    if(c.sections.length<4||c.sources.length<2) problems.push(label+' 结构或独立来源不足');
    if(c.year<t.from||c.year>t.to) problems.push(label+' 定位年越界');
    if(!c.place||Math.abs(c.place.lon)>180||Math.abs(c.place.lat)>90||!c.place.label) problems.push(label+' 地点不合法');
    for(const s of c.sections) {
      if(texts.has(s.text)) problems.push(label+' 出现重复正文段落'); texts.add(s.text);
      if(!s.refs?.length || s.refs.some(i=>!Number.isInteger(i)||!c.sources[i])) problems.push(label+' 段落出处缺失或越界');
    }
    for(const s of c.sources) {
      try { const u=new URL(s.url); if(u.protocol!=='https:') throw Error(); sources.add(u.href); }
      catch {problems.push(label+' 来源网址不合法');}
      if(!s.title||!s.checkedAt) problems.push(label+' 来源元数据缺失');
    }
    for(const l of c.connections||[]) checkLink(t,c,l);
  }
  if(!(t.connections||[]).length) warnings.push(t.id+' 尚无专题之间的联系');
  for(const l of t.connections||[]) checkLink(t,null,l);
}
function checkLink(t,c,l) {
  const target=byId.get(l.topicId);
  if(!target) {problems.push(t.id+' 关联目标不存在：'+l.topicId);return;}
  if(l.chapterId&&!target.chapters.some(x=>x.id===l.chapterId)) problems.push(t.id+' 关联节点不存在：'+l.chapterId);
  const targetChapter=target.chapters.find(x=>x.id===l.chapterId);
  if(c&&l.relation==='contemporary'&&(!targetChapter||Math.abs(c.year-targetChapter.year)>25)) problems.push(t.id+'/'+c.id+' 同期篇章超过25年或未指定节点');
  if(!l.label||!l.reason) problems.push(t.id+' 关联缺少解释');
  if(l.relation==='contemporary'&&Math.max(t.from,target.from)>Math.min(t.to,target.to)) problems.push(t.id+' 将不同时期标为同期');
}
const lines=['# 世界历史书的内容覆盖','',
  '## 主体书卷','',
  '| 书卷 | 年代 | 章节数 |','| --- | --- | ---: |',
  ...subjectBooks.map((book)=>`| ${book.title} | ${book.dateLabel || bookYears(book)} | ${book.chapters.length} |`),'',
  `共 ${subjectBooks.length} 卷、${bookChapters} 章，正文关联 ${historicalScenes.length} 个可进入地球观察的历史场景。正文按段落标注出处。`,'',
  '有地理轮廓的主体可在地球上定位。主体书卷由编辑选材与核对，未收录正文的主体可查看地图资料。','',
  '## 补充专题资料','',
  '专题覆盖全球主要文明、地区及历史阶段，兼顾六大有人居住的大洲。','',
  `已编写 ${topics.length}/${plan.length} 组专题、${chapters} 篇正文，共 ${chars.toLocaleString('en-US')} 个汉字；独立来源网址 ${sources.size} 个。`, '',
  '正文长度只统计各节正文中的汉字，不含标题、摘要、来源或重复说明。结构检查不能代替事实审校；来源同时包含原始文献与博物馆、大学等机构的研究导读。','',
  '| 专题 | 地区 | 覆盖年代 | 正文篇数 | 每篇正文汉字 |','| --- | --- | --- | ---: | --- |',
  ...plan.map(p=>{const t=byId.get(p.id);return t?`| ${t.title} | ${t.continents.join('、')} | ${t.from}—${t.to} | ${t.chapters.length} | ${t.chapters.map(lengthOf).join(' / ')} |`:`| ${p.title} | ${p.continents.join('、')} | 待完成 | 0 | — |`;}),'',
  '## 地理与时间边界','', '历史疆域覆盖取决于地图资料，书卷年代取决于所采用的叙事范围。现代区域以现代国界绘制。补充专题在历史书目中按需查阅。','',
  `历史地图 ${polityNames.total} 条名称中，${polityNames.direct} 条有独立中文对照，${polityNames.names.size - polityNames.direct} 条使用已核对主体名组成关系名称。余下 ${polityNames.total - polityNames.names.size} 条可在地图资料中展开底图原名。`,'',
  '## 校验结果','',problems.length?problems.map(p=>'- '+p).join('\n'):'所有计划专题的节点数、正文长度、来源索引、地点、年代和内部关联结构检查通过。','',
  ...warnings.map(p=>'- 待补关系：'+p),''];
writeFileSync(join(root,'docs/CONTENT-COVERAGE.md'),lines.join('\n').trimEnd()+'\n');
console.log(JSON.stringify({books:subjectBooks.length,bookChapters,historicalScenes:historicalScenes.length,polityNames:polityNames.names.size,polityTotal:polityNames.total,topics:topics.length,planned:plan.length,chapters,hanCharacters:chars,sourceUrls:sources.size,problems:problems.length,warnings:warnings.length},null,2));
for(const p of problems) console.error(p);
if(problems.length) process.exitCode=1;

function bookYears({from, to}) {
  const format = (year) => year < 0 ? '公元前 ' + -year : String(year);
  return format(from) + (to === null ? ' 年至今' : '—' + format(to) + ' 年');
}
