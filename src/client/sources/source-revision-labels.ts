type RevisionIdentity={id:string;versionNumber?:number};

/** Labels use persisted identities, independent of status, filtering, or deletion. */
export function sourceRevisionLabels(revisions:RevisionIdentity[]):Map<string,string>{
 return new Map(revisions.map(revision=>[revision.id,revision.versionNumber?`V${revision.versionNumber}`:'']));
}
