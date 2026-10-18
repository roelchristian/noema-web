import {revealCitationTarget} from './citation-navigation';
import {createContext} from 'react';
import {citationKey, citationLocation, noteCitations, type CitationStyle} from '../../shared/citations';
import type {Entity,Block} from '../../shared/domain';
import {Icon} from '../components/Icon';
export interface CitationPresentation {style:CitationStyle;entries:ReturnType<typeof noteCitations>}
export const CitationPresentationContext=createContext<CitationPresentation>({style:'references',entries:new Map()});
export function NoteReferences({blocks,entities}: {blocks:Block[];entities:Entity[]}){
  const entries=[...noteCitations(blocks).values()].sort((left,right)=>left.number-right.number);
  const names=new Map(entities.map(entity=>[entity.id,entity.name]));
  if(!entries.length)return null;
  return <section className="note-references" aria-labelledby="note-references-title">
    <header className="note-references-heading"><h2 id="note-references-title">References</h2></header>
    <ol role="list">{entries.map(({number,reference,occurrences})=>{
      const name=names.get(reference.sourceId)??'Source';
      const location=citationLocation(reference);
      return <li key={citationKey(reference)} id={`note-reference-${number}`} tabIndex={-1}>
        <div className="note-reference-entry">
          <button type="button" className="note-reference-source" data-citation-number={number} data-source-reference={JSON.stringify(reference)} title={`${name} · ${reference.contextLabel??location}`} aria-label={`Open reference ${number}: ${name}, ${location}`}>
            <span className="note-reference-number" aria-hidden="true">[{number}]</span>
            <span className="note-reference-name">{name}</span>
            <span className="note-reference-location">{location}</span>
          </button>
          <span className="note-reference-backlinks" role="group" aria-label={`Backlinks for reference ${number}`}>{occurrences.length>1&&<Icon name="arrow-up"/>}{occurrences.map((id,index)=>{
            const label=`Return to citation ${number}${occurrences.length>1?`, occurrence ${index+1}`:''}`;
            return <button key={id} type="button" title={label} aria-label={label} onClick={()=>{
              revealCitationTarget(document.getElementById(`note-citation-${id}`));
            }}>{occurrences.length>1?<span>{index+1}</span>:<Icon name="arrow-up"/>}</button>;
          })}</span>
        </div>
      </li>;
    })}</ol>
  </section>;
}
