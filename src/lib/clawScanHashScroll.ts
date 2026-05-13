const DISABLE_DUPLICATE_CLAWSCAN_HASH_SCROLL = `(function(){try{if(location.hash.indexOf('#clawscan-finding-')!==0)return;history.replaceState(Object.assign({},history.state,{__hashScrollIntoViewOptions:false}),'',location.href)}catch(e){}})()`;

export function getClawScanHashScrollScripts(scanner: string) {
  return scanner === "clawscan"
    ? [{ children: DISABLE_DUPLICATE_CLAWSCAN_HASH_SCROLL }]
    : undefined;
}
