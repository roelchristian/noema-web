import {test} from 'node:test';
import assert from 'node:assert/strict';
import {domainShortlist} from '../src/server/modules/domain-shortlist.ts';
import {Intelligence} from '../src/server/modules/intelligence.ts';
import {DOMAINS,domainPath} from '../src/shared/domains.ts';

const equivalentTopics=[
  {id:'mathematics.algebra.abstract',texts:[
    'Abstract algebra studies groups, rings, fields and homomorphisms.',
    'El álgebra abstracta estudia grupos, anillos, cuerpos y homomorfismos.',
    '抽象代数研究群、环、域和同态。',
  ]},
  {id:'mathematics.algebra.linear',texts:[
    'Linear algebra uses matrices and vectors to solve linear equations.',
    'El álgebra lineal usa matrices y vectores para resolver ecuaciones lineales.',
    '线性代数使用矩阵和向量求解线性方程。',
  ]},
  {id:'mathematics.foundations.category_theory',texts:[
    'Category theory studies functors and natural transformations.',
    'La teoría de categorías estudia funtores y transformaciones naturales.',
    '范畴论研究函子和自然变换。',
  ]},
  {id:'computing.ai.machine_learning',texts:[
    'Machine learning trains neural networks on examples.',
    'El aprendizaje automático entrena una red neuronal con ejemplos.',
    '机器学习通过样本训练神经网络。',
  ]},
  {id:'medicine.public_health',texts:[
    'Public health and epidemiology study disease incidence.',
    'La salud pública y la epidemiología estudian la incidencia de enfermedades.',
    '公共卫生与流行病学研究疾病发病率。',
  ]},
];
for(const {id,texts} of equivalentTopics)test(`English, Spanish and Chinese admit ${id} on the first shortlist`,()=>{
  for(const text of texts) {
    const shortlist=domainShortlist(text);
    assert.ok(shortlist.some(domain=>domain.id===id),text);
    assert.ok(shortlist.length<=DOMAINS.length);
    assert.equal(shortlist.filter(domain=>!domain.id.includes('.')).length,20);
    assert.equal(new Set(shortlist.map(domain=>domain.id)).size,shortlist.length);
  }
});

test('Spanish accent, case and plural variations retain detailed mathematical candidates',()=>{
  for(const text of ['ÁLGEBRA ABSTRACTA: GRUPOS, ANILLOS Y HOMOMORFISMOS','algebra abstracta: grupos, anillos y homomorfismos']) {
    const shortlist=domainShortlist(text);
    assert.ok(shortlist.some(domain=>domain.id==='mathematics.algebra.abstract'));
    assert.ok(shortlist.length<70);
  }
});

test('low lexical confidence exposes the complete compact hierarchy, including unfamiliar subject shifts',()=>{
  for(const text of ['คณิตศาสตร์ที่ไม่อยู่ในพจนานุกรม','seldomseenword zqxv','', '无已知别名的新话题']) {
    const shortlist=domainShortlist(text,['psychology.cognitive']);
    assert.equal(shortlist.length,DOMAINS.length);
    assert.ok(shortlist.some(domain=>domain.id==='mathematics.foundations.category_theory'));
    assert.ok(shortlist.some(domain=>domain.id==='religion.christianity.patristics'));
    assert.ok(shortlist.some(domain=>domain.id==='natural_sciences.biology.genetics'));
    for(const candidate of shortlist)assert.equal(candidate.name,domainPath(candidate.id).map(node=>node.label).join(' → '));
  }
});

test('existing domains cannot displace strong evidence for a different subject',()=>{
  const previous=DOMAINS.map(domain=>domain.id).reverse().concat(['invented.subject']);
  for(const {id,texts} of equivalentTopics)for(const text of texts) {
    const shortlist=domainShortlist(text,previous);
    assert.ok(shortlist.some(domain=>domain.id===id));
    assert.ok(!shortlist.some(domain=>domain.id==='invented.subject'));
    assert.ok(shortlist.length<=DOMAINS.length);
  }
});

test('one request can admit multiple new multilingual subjects without previous-domain gating',()=>{
  const shortlist=domainShortlist('Álgebra abstracta, grupos y homomorfismos. 机器学习与神经网络。 Epidemiología y salud pública.', ['arts.music']);
  for(const id of ['mathematics.algebra.abstract','computing.ai.machine_learning','medicine.public_health','arts.music'])assert.ok(shortlist.some(domain=>domain.id===id),id);
  assert.ok(shortlist.length<70);
});


test('mocked provider can return each multilingual detailed ID from its first validated request',async()=>{
  const secrets={value:null,read(){return this.value;},write(value){this.value=value;},remove(){this.value=null;}};
  let expected,calls=0;
  const ai=new Intelligence(secrets,async(_url,request)=>{
    calls++;
    const payload=JSON.parse(request.body);
    const eligible=payload.text.format.schema.properties.primaryDomainId.anyOf[0].enum;
    assert.ok(eligible.includes(expected));
    return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({primaryDomainId:expected,secondaryDomainIds:[]})}]}]});
  });
  ai.save({apiKey:'sk-domain-shortlist-test-secret'});
  for(const {id,texts} of equivalentTopics)for(const text of texts){
    expected=id;
    const result=await ai.generatePageEnrichment(text,{requestedFields:['domains'],domains:domainShortlist(text,['arts.music'])},undefined,true);
    assert.equal(result.primaryDomainId,id);
  }
  assert.equal(calls,15,'one dispatched request per note, with no translation or repair calls');
});


test('ambiguous everyday field, group, ring and order wording retains broad unfamiliar candidates',()=>{
  for(const text of [
    'We toured the field before harvest.',
    'Our group placed an order for lunch.',
    'The field is next to the farmhouse.',
    'We bought rings for the wedding.',
    'El grupo visitó el campo antes de la cosecha.',
    'El anillo llegó con el pedido.',
    'El cuerpo descansó después de caminar.',
    '我们在收获前参观了田野。',
    '我们的团体订购了午餐。',
  ]) {
    const shortlist=domainShortlist(text,['mathematics.algebra.abstract']);
    assert.equal(shortlist.length,DOMAINS.length,text);
    for(const id of ['agriculture.crops','agriculture.food','society.sociology'])assert.ok(shortlist.some(domain=>domain.id===id),`${text}: ${id}`);
  }
});
