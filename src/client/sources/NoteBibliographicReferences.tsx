import {useContext} from 'react';
import {CitationPresentationContext} from './CitationPresentation';
export function NoteBibliographicReferences() {
 const presentation=useContext(CitationPresentationContext).scholarly;
 if(!presentation?.count)return null;
 const {style,setStyle,error,loading,retry,bibliography}=presentation;
 return <section className="note-references" aria-label="Bibliographic references"><header className="note-references-heading"><h2>Bibliography</h2><select aria-label="Bibliography style" value={style} onChange={event=>setStyle(event.target.value as 'apa'|'ieee')}><option value="apa">APA 7</option><option value="ieee">IEEE</option></select></header>{error?<p role="alert">{error} <button type="button" onClick={retry}>Retry</button></p>:loading?<p role="status">Loading bibliographic references…</p>:<ol>{bibliography.map((entry,index)=><li key={index}>{entry}</li>)}</ol>}</section>;
}
