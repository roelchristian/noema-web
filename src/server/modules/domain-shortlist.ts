import {DOMAINS,domainPath} from '../../shared/domains.js';
/** Keep roots available; retrieve specific subjects locally without a second AI call. */
export function domainShortlist(text:string,associatedIds:readonly string[]=[]) {
  const words=new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)??[]);
  const associated=new Set(associatedIds.flatMap(id=>domainPath(id).map(node=>node.id)));
  const ranked=DOMAINS.filter(domain=>domain.parent_id).map(domain=>({domain,score:
    (associated.has(domain.id)?20:0)+[...new Set(`${domain.label} ${domain.scope_note??''} ${domain.id.replace(/[._]/g,' ')}`.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu)??[])].reduce((score,word)=>score+(words.has(word)?1:0),0)}))
    .filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.domain.id.localeCompare(b.domain.id)).slice(0,24);
  const selected=new Set([...DOMAINS.filter(domain=>!domain.parent_id).map(domain=>domain.id),...ranked.flatMap(({domain})=>domainPath(domain.id).map(node=>node.id))]);
  return DOMAINS.filter(domain=>selected.has(domain.id)).map(domain=>({id:domain.id,name:domainPath(domain.id).map(node=>node.label).join(' → ')}));
}
