import {blockListNumber} from '../../shared/domain';
import type {Block, Entity, Segment} from '../../shared/domain';
import {imageURL} from '../api';
import {segmentHTML} from './segments';
import {renderMath} from './math';

/** Generated content uses display surfaces only, including tables and equations. */
export function ReadOnlyExplanationBlock({block,blocks,entities,onOpen,vaultId}: {block:Block;blocks:Block[];entities:Entity[];onOpen:(id:string)=>void;vaultId:string}) {
  const Content = block.type === 'heading1' ? 'h2' : block.type === 'heading2' ? 'h3' : 'div';
  const html=(segments:Segment[])=>({__html:segmentHTML(segments,entities,undefined,true)});
  return <div data-block-id={block.id} data-semantic-kind="ai-explanation" className={'block '+block.type} contentEditable={false} onDragStart={event=>event.preventDefault()} onClick={event=>{
    const mention=(event.target as Element).closest<HTMLElement>('[data-entity]');if(mention)onOpen(mention.dataset.entity!);
  }}>
    {block.type==='todo'?<input type="checkbox" checked={block.checked} disabled aria-label="Complete task"/>:block.type==='bullet'?<span className="bullet-marker">•</span>:block.type==='numbered'?<span className="bullet-marker numbered-marker">{blockListNumber(blocks,block.id)}.</span>:null}
    {block.type==='columns'?<div className="columns-block">{(block.rows?.[0]??[[],[]]).map((cell,index)=><div className="column-pane" key={index}><div className="block-content table-cell" dangerouslySetInnerHTML={html(cell)}/></div>)}</div>:block.type==='divider'?<div className="divider-block"><hr/></div>:block.type==='code'?<pre className="code-block"><code>{block.content.map(segment=>segment.text??'').join('')}</code></pre>:block.type==='table'?<table><tbody>{block.rows?.map((row,i)=><tr key={i}>{row.map((cell,j)=><td className="block-content table-cell" key={j} dangerouslySetInnerHTML={html(cell)}/>)}</tr>)}</tbody></table>
      :block.type==='image'?<img src={imageURL(vaultId,block.imageId!)} alt={block.alt||''} draggable={false}/>
      :block.type==='math'?<div className="math-block-render" dangerouslySetInnerHTML={{__html:renderMath(block.content.map(s=>s.text??'').join(''),true)}}/>
      :<Content className="block-content" dangerouslySetInnerHTML={html(block.content)}/>}
  </div>;
}
