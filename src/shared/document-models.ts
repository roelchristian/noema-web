/** Official documentation checked 2026-10-26. Prices are USD per million tokens,
 * standard synchronous tier, not an account-access or quality guarantee. */
export const documentRegistryVersion='2026-10-26.2';
export interface DocumentPrice {from:string;input:number;output:number;cachedInput:number;cacheWrite?:number;longInputThreshold?:number;longInputMultiplier?:number;longOutputMultiplier?:number}
export interface DocumentModel {id:string;provider:'openai'|'gemini';role:'default'|'quality';verified:true;contextTokens:number;maxOutputTokens:number;pdf:true;structuredOutput:true;unifiedContext:boolean;verifiedAt:string;documentation:string;prices:readonly DocumentPrice[]}
export const documentModels:readonly DocumentModel[]=[
 {id:'gpt-6.1-sol',provider:'openai',role:'default',verified:true,contextTokens:1050000,maxOutputTokens:128000,pdf:true,structuredOutput:true,unifiedContext:true,verifiedAt:'2026-10-26',documentation:'https://developers.openai.com/api/docs/models/gpt-6.1-sol',prices:[{from:'2026-10-26',input:2,output:10,cachedInput:.1,cacheWrite:2.5,longInputThreshold:272000,longInputMultiplier:2,longOutputMultiplier:1.5}]},
 {id:'gpt-6-astra',provider:'openai',role:'quality',verified:true,contextTokens:1050000,maxOutputTokens:128000,pdf:true,structuredOutput:true,unifiedContext:true,verifiedAt:'2026-10-26',documentation:'https://developers.openai.com/api/docs/models/gpt-6-astra',prices:[{from:'2026-10-26',input:10,output:50,cachedInput:1,cacheWrite:12.5,longInputThreshold:272000,longInputMultiplier:2,longOutputMultiplier:1.5}]},
 {id:'gemini-3.8-flash',provider:'gemini',role:'default',verified:true,contextTokens:1048576,maxOutputTokens:65536,pdf:true,structuredOutput:true,unifiedContext:false,verifiedAt:'2026-10-26',documentation:'https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash',prices:[{from:'2026-10-26',input:.75,output:3.75,cachedInput:.075},{from:'2027-01-01',input:1.5,output:7.5,cachedInput:.15}]},
 {id:'gemini-4-argon',provider:'gemini',role:'quality',verified:true,contextTokens:1048576,maxOutputTokens:65536,pdf:true,structuredOutput:true,unifiedContext:true,verifiedAt:'2026-10-26',documentation:'https://ai.google.dev/gemini-api/docs/models/gemini-4-argon',prices:[{from:'2026-10-26',input:2,output:10,cachedInput:.1},{from:'2026-12-01',input:4,output:20,cachedInput:.2}]},
];
export function documentModel(id:string){return documentModels.find(model=>model.id===id);}
export function documentPrice(id:string,date:string){return documentModel(id)?.prices.filter(price=>price.from<=date).at(-1);}
