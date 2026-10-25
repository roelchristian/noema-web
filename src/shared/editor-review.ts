export interface EditorReviewText {id:string; text:string}
export interface EditorReviewSuggestion {id:string; replacement:string; reason:string}

export const writingActions = ['proofread','refine','rewrite','recast'] as const;
export type WritingAction = typeof writingActions[number];
export interface WritingReviewOptions {action?:WritingAction;personaId?:string;personaExpression?:import('./ai-personas.js').PersonaExpression}
export interface WritingProvenance {action:WritingAction;persona?:import('./ai-personas.js').PersonaIdentity;acceptedAt:string}
