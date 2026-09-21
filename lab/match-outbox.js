// Stable IDs make a lost save response safe to retry, even after a new match.
const KEY='kaputt-match-outbox-v1';
const read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'[]');}catch{return [];}};
let queue=read(),saving=false;
const store=()=>{try{localStorage.setItem(KEY,JSON.stringify(queue));return true;}catch{return false;}};
export const pendingMatches=()=>queue.length;
export function queueMatch(match) {
  if(!queue.some(m=>m.id===match.id))queue.push(match);
  return store();
}
export async function flushMatches(onStatus=()=>{}) {
  if(saving || !queue.length)return;
  saving=true;
  try {
    while(queue.length) {
      const item=queue[0];onStatus(`Saving ${queue.length===1?'match':`${queue.length} matches`}…`);
      const r=await fetch('/api/matches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item),signal:AbortSignal.timeout(9000)});
      if(!r.ok)throw new Error('Save unavailable');
      const data=await r.json();if(!data.ok)throw new Error('Save unavailable');
      queue=queue.filter(m=>m.id!==item.id);store();
    }
    onStatus('All completed matches saved.');
  } catch {onStatus('Save pending. Your completed match stays on this device and will retry when connected.');}
  finally{saving=false;}
}
