import type {Property} from '../../shared/domain';
export function BibliographicPropertyEvidence({property}:{property:Property}) {
 const projection=property.bibliographicProjection;if(!projection)return null;
 return <div className="property-provenance"><small>Bibliographic record · edit in Bibliographic details</small>{projection.legacyValues.length>0&&<details><summary>{projection.legacyValues.some(value=>value.conflicts)?'Retained authored values · conflict needs review':'Retained authored values'}</summary>{projection.legacyValues.map(value=><p key={value.id}>{value.name}: {value.value??value.targetName??value.target_id}{value.conflicts?' · differs from the bibliographic record':''}</p>)}<p>Original values are preserved as evidence and cannot be edited independently.</p></details>}</div>;
}
