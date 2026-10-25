import {DOMAINS,domainPath} from '../../shared/domains.js';

/** Curated subject aliases, not a translation service. Unknown wording uses the broad fallback below. */
const aliases:Record<string,string>={
  'general.interdisciplinary':'interdisciplinario|interdisciplinar|跨学科',
  'general.research_methods':'metodología de investigación|métodos de investigación|研究方法',
  'general.knowledge_organization':'biblioteconomía|organización del conocimiento|图书馆学|知识组织',
  'general.bibliography':'bibliografía|文献目录',
  'philosophy.metaphysics':'metafísica|ontología|形而上学|本体论',
  'philosophy.epistemology':'epistemología|认识论',
  'philosophy.logic':'lógica filosófica|哲学逻辑',
  'philosophy.ethics':'ética|filosofía moral|伦理学',
  'philosophy.philosophy_science':'filosofía de la ciencia|科学哲学',
  'philosophy.political_philosophy':'filosofía política|政治哲学',
  'philosophy.history_philosophy':'historia de la filosofía|哲学史',
  'psychology.cognitive':'psicología cognitiva|memoria|atención|认知心理学|记忆|注意力',
  'psychology.developmental':'psicología del desarrollo|发展心理学',
  'psychology.social_personality':'psicología social|personalidad|社会心理学|人格',
  'psychology.clinical':'psicología clínica|临床心理学',
  'psychology.behavioural':'psicología conductual|行为心理学',
  'psychology.methods':'psicometría|心理测量',
  'religion.comparative':'religión comparada|比较宗教',
  'religion.christianity':'cristianismo|基督教',
  'religion.christianity.biblical':'exégesis|estudios bíblicos|圣经研究|释经',
  'religion.christianity.theology':'teología sistemática|系统神学',
  'religion.christianity.patristics':'patrística|historia de la iglesia|教父学|教会史',
  'religion.christianity.liturgy':'liturgia|sacramentos|礼仪|圣礼',
  'religion.christianity.morals':'ética cristiana|基督教伦理',
  'religion.judaism':'judaísmo|犹太教',
  'religion.islam':'islam|伊斯兰教',
  'religion.hinduism':'hinduismo|印度教',
  'religion.buddhism':'budismo|佛教',
  'religion.east_asian':'religiones de asia oriental|东亚宗教',
  'religion.other_religions':'otras religiones|其他宗教',
  'history.historiography':'historiografía|史学',
  'history.ancient':'historia antigua|古代史',
  'history.ancient.greek_roman':'historia griega|historia romana|古希腊|古罗马',
  'history.medieval':'historia medieval|中世纪',
  'history.early_modern':'edad moderna|近代早期',
  'history.modern':'historia contemporánea|现代史',
  'history.regional':'historia local|地方史',
  'history.archaeology':'arqueología|考古学',
  'geography.physical':'geografía física|自然地理',
  'geography.human':'geografía humana|人文地理',
  'geography.cartography':'cartografía|sistemas de información geográfica|制图学|地理信息系统',
  'geography.cultural_anthropology':'antropología cultural|文化人类学',
  'geography.biological_anthropology':'antropología biológica|生物人类学',
  'geography.sport_recreation':'deporte|recreación|体育|休闲',
  'society.sociology':'sociología|社会学',
  'society.demography':'demografía|人口学',
  'society.social_policy':'política social|bienestar social|社会政策|社会福利',
  'society.communication':'comunicación|medios de comunicación|传播学|媒体研究',
  'society.gender_family':'género|familia|性别|家庭',
  'society.criminology':'criminología|犯罪学',
  'economics_business.microeconomics':'microeconomía|微观经济',
  'economics_business.macroeconomics':'macroeconomía|宏观经济',
  'economics_business.economic_history':'historia económica|经济史',
  'economics_business.econometrics':'econometría|计量经济',
  'economics_business.finance':'finanzas|inversión|金融|投资',
  'economics_business.accounting':'contabilidad|auditoría|会计|审计',
  'economics_business.management':'gestión empresarial|administración de empresas|企业管理',
  'economics_business.operations':'mercadotecnia|cadena de suministro|营销|供应链',
  'politics.theory':'teoría política|政治理论',
  'politics.comparative':'política comparada|比较政治',
  'politics.public_administration':'administración pública|公共行政',
  'politics.international_relations':'relaciones internacionales|diplomacia|国际关系|外交',
  'politics.security':'geopolítica|地缘政治',
  'law.jurisprudence':'jurisprudencia|teoría jurídica|法理学',
  'law.constitutional':'derecho constitucional|宪法|行政法',
  'law.commercial':'derecho mercantil|商法|私法',
  'law.criminal':'derecho penal|刑法',
  'law.international':'derecho internacional|国际法',
  'law.religious':'derecho canónico|教会法|宗教法',
  'education.theory':'pedagogía|教育学',
  'education.curriculum':'currículo|教学|课程',
  'education.assessment':'evaluación educativa|教育测量',
  'education.higher':'educación superior|高等教育',
  'education.language':'enseñanza de idiomas|语言教育',
  'language_literature.linguistics':'lingüística|语言学',
  'language_literature.linguistics.phonetics':'fonética|fonología|语音学|音系学',
  'language_literature.linguistics.grammar':'morfología|sintaxis|形态学|句法',
  'language_literature.linguistics.semantics':'semántica|pragmática|语义学|语用学',
  'language_literature.linguistics.historical':'lingüística histórica|sociolingüística|历史语言学|社会语言学',
  'language_literature.philology':'filología|文献学',
  'language_literature.language_learning':'aprendizaje de idiomas|traducción|语言学习|翻译',
  'language_literature.literary_theory':'teoría literaria|文学理论',
  'language_literature.literature':'literatura|文学史',
  'language_literature.rhetoric':'retórica|escritura|修辞|写作',
  'arts.visual':'artes visuales|视觉艺术',
  'arts.architecture':'arquitectura|建筑学',
  'arts.music':'música|musicología|音乐',
  'arts.performing':'teatro|artes escénicas|戏剧|表演艺术',
  'arts.film':'cine|película|电影',
  'arts.design':'diseño|设计',
  'mathematics.foundations':'fundamentos matemáticos|数学基础',
  'mathematics.foundations.logic_set_theory':'lógica matemática|teoría de conjuntos|数学逻辑|集合论',
  'mathematics.foundations.category_theory':'teoría de categorías|范畴论|函子|functor',
  'mathematics.algebra':'álgebra|代数',
  'mathematics.algebra.linear':'álgebra lineal|matriz|matrices|vector|线性代数|矩阵|向量',
  'mathematics.algebra.abstract':'abstract algebra|algebraic|homomorphism|group|ring|field|module|álgebra abstracta|grupo|anillo|cuerpo|campo|módulo|homomorfismo|estructura algebraica|抽象代数|群论|环论|域论|同态|代数结构',
  'mathematics.number_theory':'teoría de números|número primo|数论|素数',
  'mathematics.analysis':'análisis matemático|cálculo|derivada|integral|数学分析|微积分|导数|积分',
  'mathematics.geometry_topology':'geometría|topología|几何|拓扑',
  'mathematics.probability_statistics':'probabilidad|estadística|概率|统计',
  'mathematics.applied':'matemática aplicada|optimización|应用数学|优化',
  'computing.algorithms':'algoritmo|estructura de datos|算法|数据结构',
  'computing.programming':'programación|compilador|编程|编译器',
  'computing.software_engineering':'ingeniería de software|软件工程',
  'computing.systems':'sistema operativo|red informática|操作系统|计算机网络',
  'computing.databases':'base de datos|bases de datos|recuperación de información|数据库|信息检索',
  'computing.ai':'inteligencia artificial|人工智能',
  'computing.ai.machine_learning':'aprendizaje automático|red neuronal|机器学习|神经网络',
  'computing.ai.knowledge_representation':'representación del conocimiento|知识表示|知识推理',
  'computing.ai.nlp':'procesamiento del lenguaje natural|自然语言处理',
  'computing.security':'ciberseguridad|seguridad informática|网络安全',
  'computing.hci':'interacción humano computadora|人机交互',
  'computing.data_science':'ciencia de datos|数据科学',
  'natural_sciences.physics':'física|mecánica cuántica|物理|量子力学',
  'natural_sciences.chemistry':'química|化学',
  'natural_sciences.biology':'biología|生物学',
  'natural_sciences.biology.botany':'botánica|植物学',
  'natural_sciences.biology.zoology':'zoología|动物学',
  'natural_sciences.biology.genetics':'genética|biología molecular|遗传学|分子生物学',
  'natural_sciences.earth_space':'astronomía|geología|天文学|地质学',
  'natural_sciences.ecology':'ecología|medio ambiente|生态学|环境科学',
  'medicine.anatomy':'anatomía|fisiología|解剖学|生理学',
  'medicine.clinical':'medicina clínica|临床医学',
  'medicine.neuroscience':'neurociencia|神经科学',
  'medicine.public_health':'salud pública|epidemiología|公共卫生|流行病学',
  'medicine.pharmacology':'farmacología|terapéutica|药理学|治疗学',
  'medicine.psychiatry':'psiquiatría|salud mental|精神病学|心理健康',
  'engineering.electrical':'ingeniería eléctrica|electrónica|电气工程|电子工程',
  'engineering.mechanical':'ingeniería mecánica|aeroespacial|机械工程|航空航天',
  'engineering.civil':'ingeniería civil|土木工程',
  'engineering.materials':'ciencia de materiales|ingeniería química|材料科学|化学工程',
  'engineering.industrial':'ingeniería industrial|fabricación|工业工程|制造',
  'engineering.energy':'energía renovable|ingeniería ambiental|可再生能源|环境工程',
  'engineering.innovation':'innovación tecnológica|技术创新',
  'agriculture.crops':'cultivo|horticultura|农作物|园艺',
  'agriculture.animal':'ganadería|veterinaria|畜牧|兽医',
  'agriculture.forestry':'silvicultura|林业',
  'agriculture.food':'nutrición|ciencia de alimentos|营养|食品科学',
  'defence.strategy':'estrategia militar|军事战略',
  'defence.operations':'operaciones militares|军事行动',
  'defence.naval':'estudios navales|海军',
  'defence.technology':'tecnología militar|军事技术',
};

// Fold accents and plurals for Latin text while preserving Han characters. Phrase
// matching below uses word boundaries for Latin and substrings for unspaced Han.
function normalize(text:string) {
  return text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase()
    .replace(/[\p{L}\p{N}]+/gu,word=>/^[a-z]+s$/.test(word)&&word.length>4?word.slice(0,-1):word)
    .replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
const indexed=DOMAINS.filter(domain=>domain.parent_id).map(domain=>({
  domain,
  words:new Set(normalize(`${domain.label} ${domain.scope_note??''} ${domain.id.replace(/[._]/g,' ')}`).split(' ').filter(word=>word.length>=4)),
  aliases:(aliases[domain.id]??'').split('|').filter(Boolean).map(normalize),
}));

/** Canonical candidates for one request, with no remote language detection.
 * Strong local matches use at most 24 descendant paths. Weak evidence exposes
 * the complete compact, finite registry: an unfamiliar language must not force
 * the provider to choose a root when the correct detailed subject exists.
 */
export function domainShortlist(text:string,associatedIds:readonly string[]=[]) {
  const normalized=normalize(text),padded=` ${normalized} `,words=new Set(normalized.split(' '));
  const ranked=indexed.map(item=>({...item,score:
    [...item.words].reduce((score,word)=>score+(words.has(word)?1:0),0)+
    item.aliases.reduce((score,alias)=>score+((/\p{Script=Han}/u.test(alias)?normalized.includes(alias):padded.includes(` ${alias} `))?4:0),0),
  })).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.domain.id.localeCompare(b.domain.id));
  const selected=new Set(DOMAINS.filter(domain=>!domain.parent_id).map(domain=>domain.id));
  if((ranked[0]?.score??0)<3) {
    for(const domain of DOMAINS)selected.add(domain.id);
  }else {
    // Content wins all contested slots; previous subjects offer only a few extra
    // paths and cannot suppress a newly introduced subject.
    for(const {domain} of ranked.slice(0,24))for(const node of domainPath(domain.id))selected.add(node.id);
    for(const id of [...new Set(associatedIds)].slice(0,4))for(const node of domainPath(id))selected.add(node.id);
  }
  return DOMAINS.filter(domain=>selected.has(domain.id)).map(domain=>({id:domain.id,name:domainPath(domain.id).map(node=>node.label).join(' → ')}));
}
