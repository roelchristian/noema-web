/** 5000 distinct words cross the old 4096-word histogram cap; do not shrink them. */
export function numberedWords(count=5000,prefix='word') {
  return Array.from({length:count},(_,index)=>`${prefix}${index}`);
}

/** Keep the retained vocabulary and the omitted repeated tail independently visible. */
export function omittedVocabularyTail(retained,tail,{count=6000,trailingSpace=true}={}) {
  const text=retained+' '+(tail+' ').repeat(count);
  return trailingSpace?text:text.trimEnd();
}

/** Reproduce the legacy cap using caller-owned tokenization, not current production code. */
export function legacyTokenEvidence(tokens) {
  const tokenCounts=Object.create(null);let distinct=0;
  for(const token of tokens) {
    if(Object.hasOwn(tokenCounts,token))tokenCounts[token]++;
    else if(distinct<4096){tokenCounts[token]=1;distinct++;}
  }
  return {tokenCounts,tokenCount:tokens.length};
}
