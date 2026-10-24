declare module 'citeproc' {
 const CSL: {Engine:new(sys:{retrieveLocale:(language:string)=>string|false;retrieveItem:(id:string)=>unknown},style:string,language?:string)=>{setOutputFormat(format:string):void;updateItems(ids:string[]):void;makeBibliography():[unknown,string[]]|false;makeCitationCluster(items:unknown[]):string}};
 export default CSL;
}
