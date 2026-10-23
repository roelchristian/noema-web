/** Versioned, deliberately finite saved rules. Values are data; SQL is never accepted. */
export type SmartRulePredicate =
  | {field:'title';operator:'contains'|'equals';value:string}
  | {field:'created_at'|'updated_at';operator:'before'|'after';value:string}
  | {field:'language';operator:'equals';value:string}
  | {field:'favourite'|'reading_note'|'unfiled';operator:'is';value:boolean}
  | {field:'folder';operator:'is'|'within';value:string}
  | {field:'subject';operator:'is'|'within';value:string;role?:'primary'|'secondary'|'any'}
  | {field:'entity';operator:'mentions'|'associated';value:string};
export interface SmartRuleGroup {op:'all'|'any'|'none';children:SmartRuleNode[]}
export type SmartRuleNode = SmartRulePredicate | SmartRuleGroup;
export type RuleNode = SmartRuleNode;
export interface SmartRuleDefinition {version:1;root:SmartRuleNode}
export const smartRuleLimits = {nodes:64,depth:8,children:16,valueLength:500} as const;

/** Copies only validated keys, rejecting malformed, cyclic, oversized or future ASTs. */
export function parseSmartRule(input:unknown):SmartRuleDefinition {
  const invalid=(message:string):never=>{throw new Error(`Invalid collection rule: ${message}`);};
  const record=(value:unknown):Record<string,unknown>=>{
    if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return invalid('expected an object');
    return value as Record<string,unknown>;
  };
  const keys=(value:Record<string,unknown>,allowed:string[])=>{
    if(Object.keys(value).some(key=>!allowed.includes(key)))invalid('unknown field');
  };
  const definition=record(input);keys(definition,['version','root']);
  if(definition.version!==1)invalid('unsupported version');
  let count=0;const ancestors=new Set<object>();
  const visit=(input:unknown,depth:number):SmartRuleNode=>{
    if(++count>smartRuleLimits.nodes||depth>smartRuleLimits.depth)invalid('too complex');
    const value=record(input);
    if(ancestors.has(value))invalid('cyclic group');
    ancestors.add(value);
    try {
      if('op' in value) {
        keys(value,['op','children']);
        if(!['all','any','none'].includes(String(value.op)))invalid('unknown group');
        if(!Array.isArray(value.children)||value.children.length<1||value.children.length>smartRuleLimits.children)invalid('groups need 1–16 conditions');
        return {op:value.op as SmartRuleGroup['op'],children:Array.from(value.children as unknown[],child=>visit(child,depth+1))};
      }
      keys(value,value.field==='subject'?['field','operator','value','role']:['field','operator','value']);
      const operators:Record<string,readonly string[]>={title:['contains','equals'],created_at:['before','after'],updated_at:['before','after'],language:['equals'],favourite:['is'],reading_note:['is'],unfiled:['is'],folder:['is','within'],subject:['is','within'],entity:['mentions','associated']};
      if(typeof value.field!=='string'||!Object.hasOwn(operators,value.field)||!operators[value.field]!.includes(String(value.operator)))invalid('unknown condition or operator');
      if(['favourite','reading_note','unfiled'].includes(value.field as string)) {
        if(typeof value.value!=='boolean')invalid('expected a boolean');
      } else {
        if(typeof value.value!=='string'||!value.value.trim()||value.value.length>smartRuleLimits.valueLength||/[\u0000-\u001f\u007f]/.test(value.value))invalid('expected a nonempty value of at most 500 characters');
        if(['created_at','updated_at'].includes(value.field as string)&&(!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value.value as string)||!Number.isFinite(Date.parse(value.value as string))))invalid('expected an ISO date');
        if(['created_at','updated_at'].includes(value.field as string)) {
          const date=String(value.value),year=Number(date.slice(0,4)),month=Number(date.slice(5,7)),day=Number(date.slice(8,10));
          const leap=year%4===0&&(year%100!==0||year%400===0);
          const monthDays=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
          if(month<1||month>12||day<1||day>monthDays[month-1]!||(date.length>10&&Number(date.slice(11,13))>23))invalid('expected a real calendar date');
        }
        if(value.field==='language'&&!/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(value.value as string))invalid('expected a language tag');
      }
      if(value.field==='subject'&&value.role!==undefined&&!['primary','secondary','any'].includes(String(value.role)))invalid('invalid Subject role');
      return {...value} as SmartRulePredicate;
    } finally {ancestors.delete(value);}
  };
  return {version:1,root:visit(definition.root,1)};
}
