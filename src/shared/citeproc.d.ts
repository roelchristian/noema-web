declare module 'citeproc' {
 const CSL: {Engine:new(sys:{retrieveLocale:(language:string)=>string|false;retrieveItem:(id:string)=>unknown},style:string,language?:string)=>{setOutputFormat(format:string):void;updateItems(ids:string[]):void;makeBibliography():[unknown,string[]]|false;makeCitationCluster(items:unknown[]):string;processCitationCluster(citation:{citationID:string;citationItems:unknown[];properties:{noteIndex:number}},preceding:Array<[string,number]>,following:Array<[string,number]>):[unknown,Array<[number,string,string?]>]}};
 export default CSL;
}
