import {Fragment,type CSSProperties} from 'react';
import type {Block,Entity,PageSummary} from '../../shared/domain';
import {isAIExplanation,semanticFunctions,semanticRuns,type SemanticKind} from '../../shared/semantic-blocks';
import {pageTitleKey} from '../../shared/page-links';
import {ReadOnlyExplanationBlock} from './ReadOnlyExplanationBlock';
import {Icon} from '../components/Icon';

export function ReadOnlyPageBlocks({blocks,entities,pages,vaultId,onOpenEntity,onOpenPage}: {blocks:Block[];entities:Entity[];pages:PageSummary[];vaultId:string;onOpenEntity:(id:string)=>void;onOpenPage:(id:string)=>void}) {
  const style=(kind:SemanticKind)=>({'--semantic-color':semanticFunctions[kind].color} as CSSProperties);
  const renderBlock=(block:Block)=><ReadOnlyExplanationBlock key={block.id} block={block} blocks={blocks} entities={entities} vaultId={vaultId} onOpen={onOpenEntity} explanation={isAIExplanation(block)}/>;
  function renderRuns(list:Block[]) {
    return semanticRuns(list).map(run=>run.type==='block'?renderBlock(run.block):<section className="semantic-group" data-semantic-kind={run.kind} style={style(run.kind)} key={run.id} aria-label={semanticFunctions[run.kind].label}>
      <span className="semantic-callout-icon" aria-hidden="true"><Icon name={semanticFunctions[run.kind].icon}/></span>
      {run.kind==='ai-explanation'?<details className="ai-explanation" open><summary className="ai-explanation-label"><span>AI explanation</span><Icon name="chevron"/></summary>
        {run.blocks[0]?.semanticGroup?.source&&<div className="ai-explanation-source"><span>Passage explained</span><blockquote>{run.blocks[0].semanticGroup.source.excerpt}</blockquote></div>}
        <div className="semantic-children">{run.blocks.map(renderBlock)}</div>
      </details>:<div className="semantic-children">{run.blocks.map(renderBlock)}</div>}
    </section>);
  }
  const runs:{id:string;column:boolean;blocks:Block[]}[]=[];
  for(const block of blocks) {
    const last=runs.at(-1),id=block.column?.id;
    if(last&&(id?last.column&&last.id===id:!last.column))last.blocks.push(block);
    else runs.push({id:id??block.id,column:!!id,blocks:[block]});
  }
  return <div className="page-read-only-blocks" onKeyDown={event=>{
    if(event.key!=='Enter'&&event.key!==' ')return;
    const link=(event.target as Element).closest<HTMLElement>('[data-entity],[data-page-title]');
    if(link){event.preventDefault();link.click();}
  }} onClick={event=>{
    const link=(event.target as Element).closest<HTMLElement>('[data-page-title]');
    if(!link)return;
    event.preventDefault();
    const matching=pages.filter(page=>pageTitleKey(page.title)===pageTitleKey(link.dataset.pageTitle!));
    if(matching.length===1)onOpenPage(matching[0]!.id);
  }}>{runs.map(run=>run.column?<div className="columns-block" key={run.id} role="group" aria-label="Two columns">{([0,1] as const).map(column=><div className="column-pane" key={column}>{renderRuns(run.blocks.filter(block=>block.column?.index===column))}</div>)}</div>:<Fragment key={run.id}>{renderRuns(run.blocks)}</Fragment>)}</div>;
}
