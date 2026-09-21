import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {RemoteClient} from '../lab/remote-client.js';
const original={fetch:globalThis.fetch,document:globalThis.document,addEventListener:globalThis.addEventListener,sessionStorage:globalThis.sessionStorage,localStorage:globalThis.localStorage};
const storage=()=>{const map=new Map();return{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
globalThis.document={hidden:false,addEventListener(){}};globalThis.addEventListener=()=>{};
globalThis.sessionStorage=storage();globalThis.localStorage=storage();
after(()=>Object.assign(globalThis,original));
const response=room=>new Response(JSON.stringify({ok:true,room}),{headers:{'Content-Type':'application/json'}});
const room=(version=1)=>({code:'TEST',version,playerIndex:0,status:'playing',state:{phase:'rolled',values:[null,null],lastAction:null},presence:[{online:true},{online:true}]});
test('lost action response survives reload and retries exactly once with the same identifier',async()=>{
  let command,attempts=0;
  globalThis.fetch=async(url,options)=>{
    if(options.method==='POST'){const body=JSON.parse(options.body);if(!attempts++){command=body;throw new TypeError('Network lost');}assert.deepEqual(body,command);return response({...room(2),state:{...room().state,lastAction:{id:body.requestId}}});}
    return response(room());
  };
  const c=new RemoteClient({onState(){},onConnection(){}});c.attach({code:'TEST',token:'a'.repeat(64),name:'A'},room());
  await assert.rejects(c.send('reveal',{dieIndex:1}));assert.ok(c.current.pending);const saved=c.current;c.detach(false);
  const resumed=new RemoteClient({onState(){},onConnection(){}});resumed.attach(saved,room());await resumed.retry();
  assert.equal(attempts,2);assert.equal(resumed.pending,null);assert.equal(resumed.room.version,2);resumed.detach();
});
test('late polls cannot overwrite a newer move; unchanged polls retain public state',()=>{
  const states=[],c=new RemoteClient({onState:r=>states.push(r),onConnection(){}});
  c.accept({...room(5),state:{...room().state,phase:'first',values:[4,null]}});c.accept(room(4));assert.equal(states.length,1);
  const unchanged={...room(5)};delete unchanged.state;c.accept(unchanged);assert.deepEqual(c.room.state.values,[4,null]);c.detach();
});
test('leaving while a response is in flight never restores the abandoned room',async()=>{
  let complete;globalThis.fetch=()=>new Promise(resolve=>{complete=resolve;});
  const c=new RemoteClient({onState(){throw new Error('Stale state restored');},onConnection(){}});
  c.attach({code:'TEST',token:'a'.repeat(64),name:'A'});c.detach();complete(response(room()));await new Promise(resolve=>setTimeout(resolve,0));assert.equal(c.active,false);assert.equal(c.room,null);
});
