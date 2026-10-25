import type {BuiltinPersonaId,PersonaExpression} from './ai-personas.js';
import type {IntelligencePreferences} from './intelligence.js';
export interface PersonaPreviewInput {input:string;personaId:BuiltinPersonaId;personaExpression:PersonaExpression;modelSettings:IntelligencePreferences}
