import type {Intelligence} from '../../src/server/modules/intelligence.js';

/** Only the interface consumed by PageEnrichment; signature drift fails typecheck. */
export function enrichmentProvider(
  generate: Intelligence['generatePageEnrichment'],
  selection: ReturnType<Intelligence['enrichmentSelection']>={model:'gpt-6-luna',reasoningEffort:'none'},
): Pick<Intelligence,'enrichmentSelection'|'generatePageEnrichment'> {
  return {enrichmentSelection:()=>selection,generatePageEnrichment:generate};
}
