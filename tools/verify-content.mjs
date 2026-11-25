/* Shared structure checks and an editorial coverage report. */
import {writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadHistoryModel} from './history-model.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {books:subjectBooks, topics, scenes:historicalScenes, polityNames, plan:plans, warnings, subjects, bindings, version} = loadHistoryModel(root);
const plan = [...plans.values()];
const byId = new Map(topics.map(topic=>[topic.id,topic]));
const bookChapters = subjectBooks.reduce((sum,book)=>sum+book.chapters.length,0);
const chapters = topics.flatMap(topic=>topic.chapters);
const lengthOf = c => (c.sections.map(s=>s.text).join('').match(/[\u3400-\u9fff]/g)||[]).length;
const chars = chapters.reduce((sum,chapter)=>sum+lengthOf(chapter),0);
const sources = new Set(chapters.flatMap(chapter=>chapter.sources.map(source=>new URL(source.url).href)));
const coverageRows = [...plan.map(item=>item.id),...topics.filter(topic=>!plans.has(topic.id)).map(topic=>topic.id)];
const activeScenes = historicalScenes.filter(scene=>scene.status==='available').length;

const lines=['# 世界历史书的内容覆盖','',
  '## 主体书卷','',
  '| 书卷 | 年代 | 章节数 |','| --- | --- | ---: |',
  ...subjectBooks.map((book)=>`| ${book.title} | ${book.dateLabel || bookYears(book)} | ${book.chapters.length} |`),'',
  `共 ${subjectBooks.length} 卷、${bookChapters} 章，历史现场编目 ${historicalScenes.length} 个，其中 ${activeScenes} 个可进入观察，${historicalScenes.length-activeScenes} 个保留记录并暂停入口。正文按段落标注出处。`,'',
  '有地理轮廓的主体可在地球上定位。主体书卷由编辑选材。未收录正文的主体可查看地图资料，相关书卷依独立关联呈现。','',
  '## 补充专题资料','',
  '专题覆盖全球主要文明、地区及历史阶段，兼顾六大有人居住的大洲。','',
  `已编写 ${topics.length}/${plan.length} 组专题、${chapters.length} 篇正文，共 ${chars.toLocaleString('en-US')} 个汉字；独立来源网址 ${sources.size} 个。`, '',
  '正文长度只统计各节正文中的汉字，不含标题、摘要、来源或重复说明。结构检查不能代替事实审校；来源同时包含原始文献与博物馆、大学等机构的研究导读。','',
  '| 专题 | 地区 | 覆盖年代 | 正文篇数 | 每篇正文汉字 |','| --- | --- | --- | ---: | --- |',
  ...coverageRows.map(id=>{const p=plans.get(id),t=byId.get(id);return t?`| ${t.title} | ${t.continents.join('、')} | ${t.from}—${t.to} | ${t.chapters.length} | ${t.chapters.map(lengthOf).join(' / ')} |`:`| ${p.title} | ${p.continents.join('、')} | 待完成 | 0 | — |`;}),'',
  '## 地理与时间边界','', '历史疆域覆盖取决于地图资料，书卷年代取决于所采用的叙事范围。现代区域以现代国界绘制。补充专题在历史书目中按需查阅。','',
  `历史地图 ${polityNames.total} 条原始记录中，${polityNames.names.size} 条主体有规范中文名称，${polityNames.relations.size} 条为双边或联合关系记录（不作主体标签绘制），余下 ${polityNames.total - polityNames.names.size - polityNames.relations.size} 条待考主体可在地图资料中展开底图原名。`,'',
  '## 校验结果','','历史内容模型 v' + version + ' 的稳定身份、年代、地点、来源和内部关联结构通过。正文长度与篇数描述编辑覆盖。逐条论断与证据的核对留待审校。','',
  '场景处置、全球关系的分类和必要的证据复核见 [Phase 06 报告](progress/PHASE-06.md)。','',
  '存量对象的审校覆盖、实际读过的资料和未复核清单见 [Phase 07 进度](progress/PHASE-07.md)。','',
  '《明朝》标杆书卷的目录、来源范围及单独审校记录见 [Phase 08 报告](progress/PHASE-08.md)。','',
  ...warnings.map(p=>'- 待处理 · '+p),''];
writeFileSync(join(root,'docs/CONTENT-COVERAGE.md'),lines.join('\n').trimEnd()+'\n');
console.log(JSON.stringify({books:subjectBooks.length,bookChapters,historicalScenes:historicalScenes.length,activeScenes,polityNames:polityNames.names.size,polityRelations:polityNames.relations.size,polityTotal:polityNames.total,topics:topics.length,planned:plan.length,chapters:chapters.length,hanCharacters:chars,sourceUrls:sources.size,subjects:subjects.size,bindings:bindings.length,problems:0,warnings:warnings.length},null,2));
for (const warning of warnings) console.warn(warning);

function bookYears({from, to}) {
  const format = (year) => year < 0 ? '公元前 ' + -year : String(year);
  if (from === null) return '年代待考';
  return format(from) + (to === null ? ' 年至今' : '—' + format(to) + ' 年');
}
