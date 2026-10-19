import {t as uiText} from '../i18n';
import {useContext,type CSSProperties} from 'react';
import {CitationPresentationContext} from '../sources/CitationPresentation';
import {semanticFunctions} from '../../shared/semantic-blocks';
import {blockListNumber} from '../../shared/domain';
import type {Block, Entity, Segment} from '../../shared/domain';
import {imageURL} from '../api';
import {Icon} from '../components/Icon';
import {segmentHTML} from './segments';
import {renderMath} from './math';

/** Generated content uses display surfaces only, including tables and equations. */
export function ReadOnlyExplanationBlock({block,blocks,entities,onOpen,vaultId,explanation=true}: {block:Block;blocks:Block[];entities:Entity[];onOpen:(id:string)=>void;vaultId:string;explanation?:boolean}) {
  const citations=useContext(CitationPresentationContext);
  const Content = block.type === 'heading1' ? 'h2' : block.type === 'heading2' ? 'h3' : 'div';
  const html=(segments:Segment[])=>({__html:segmentHTML(segments,entities,undefined,true,citations)});
  return <div data-block-id={block.id} data-semantic-kind={explanation ? 'ai-explanation' : block.semantic ?? block.semanticGroup?.kind} style={!explanation && block.semantic ? {'--semantic-color':semanticFunctions[block.semantic].color} as CSSProperties : undefined} className={'block '+block.type+(!explanation&&block.semantic?' semantic-block':'')} contentEditable={false} onDragStart={event=>event.preventDefault()} onClick={event=>{
    const mention=(event.target as Element).closest<HTMLElement>('[data-entity]');if(mention)onOpen(mention.dataset.entity!);
  }}>
    {!explanation&&block.semantic&&<span className="semantic-callout-icon" aria-hidden="true"><Icon name={semanticFunctions[block.semantic].icon}/></span>}
    {block.type==='todo'?<input type="checkbox" checked={block.checked} disabled aria-label={uiText("Complete task")}/>:block.type==='bullet'?<span className="bullet-marker">•</span>:block.type==='numbered'?<span className="bullet-marker numbered-marker">{blockListNumber(blocks,block.id)}.</span>:null}
    {block.type==='columns'?<div className="columns-block">{(block.rows?.[0]??[[],[]]).map((cell,index)=><div className="column-pane" key={index}><div className="block-content table-cell" dangerouslySetInnerHTML={html(cell)}/></div>)}</div>:block.type==='divider'?<div className="divider-block"><hr/></div>:block.type==='code'?<pre className="code-block"><code>{block.content.map(segment=>segment.text??'').join('')}</code></pre>:block.type==='table'?<table><tbody>{block.rows?.map((row,i)=><tr key={i}>{row.map((cell,j)=><td className="block-content table-cell" key={j} dangerouslySetInnerHTML={html(cell)}/>)}</tr>)}</tbody></table>
      :block.type==='image'?<div className="image-block"><img src={imageURL(vaultId,block.imageId!)} alt={block.alt||''} draggable={false}/></div>
      :block.type==='math'?<div className="math-block-render" dangerouslySetInnerHTML={{__html:renderMath(block.content.map(s=>s.text??'').join(''),true)}}/>
      :<Content className="block-content" dangerouslySetInnerHTML={html(block.content)}/>}
  </div>;
}
