// Sequential polling and idempotent commands. No dice are generated on the client.
const ACTIVE='kaputt-remote-session-v2', SAVED='kaputt-remote-resume-v2';
const read=(storage,key)=>{try{return JSON.parse(storage.getItem(key)||'null');}catch{return null;}};
const write=(storage,key,value)=>{try{value?storage.setItem(key,JSON.stringify(value)):storage.removeItem(key);}catch{}};
export const randomId=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
export function playerIdentity() {
  let id;try{id=sessionStorage.getItem('kaputt-player-uuid');}catch{}
  if(!id || !/^[a-zA-Z0-9-]{16,80}$/.test(id)){id=randomId();try{sessionStorage.setItem('kaputt-player-uuid',id);}catch{}}
  return id;
}
export class RemoteClient {
  constructor({onState,onConnection}) {
    this.onState=onState;this.onConnection=onConnection;this.epoch=0;this.room=null;this.session=null;
    this.pending=null;this.sending=false;this.polling=false;this.timer=0;this.connected=false;this.fatal=false;
    this.onOnline=()=>this.poll();this.onVisible=()=>{if(!document.hidden)this.poll();};
    addEventListener('online',this.onOnline);document.addEventListener('visibilitychange',this.onVisible);
  }
  get active(){return !!this.session;}
  get saved(){return read(localStorage,SAVED);}
  get current(){return read(sessionStorage,ACTIVE);}
  remember(){
    const value=this.session?{...this.session,pending:this.pending}:null;
    write(sessionStorage,ACTIVE,value);if(value)write(localStorage,SAVED,value);
  }
  async request(path,body,token) {
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),9000);
    try {
      const response=await fetch(path,{method:body?'POST':'GET',cache:'no-store',signal:controller.signal,
        headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
      let data;try{data=await response.json();}catch{throw new Error('Online play is unavailable on this host. Open the Cloudflare game.');}
      if(!response.ok||!data.ok){const e=new Error(data.error||'The server could not complete this move.');e.status=response.status;throw e;}
      return data;
    } catch(e) {if(e.name==='AbortError')throw new Error('Connection timed out. Your move can be retried safely.');throw e;}
    finally{clearTimeout(timeout);}
  }
  status(connected,message='') {this.connected=connected;this.onConnection({connected,message,pending:!!this.pending,sending:this.sending,fatal:this.fatal});}
  accept(room) {
    if(this.room && room.code===this.room.code && room.version<this.room.version)return;
    const changed=!this.room||room.version!==this.room.version;
    if(room.state===undefined && this.room?.code===room.code)room={...room,state:this.room.state};
    this.room=room;this.fatal=false;
    if(this.pending && room.state?.lastAction?.id===this.pending.requestId){this.pending=null;this.remember();}
    this.status(true);this.onState(room,changed);
  }
  attach(session,room=null) {
    this.detach(false);this.session={code:session.code,token:session.token,name:session.name};this.pending=session.pending||null;
    this.remember();if(room)this.accept(room);this.poll();
  }
  async create(config) {
    // Preserve a creation key across a lost response; Retry creates no duplicate room.
    this.creation ||= {sessionToken:randomId(),playerId:playerIdentity(),...config};
    const {room}=await this.request('/api/rooms',this.creation);
    this.attach({code:room.code,token:this.creation.sessionToken,name:config.hostName},room);this.creation=null;return room;
  }
  async join(code,name) {
    if(!/^[A-Z0-9]{4}$/.test(code))throw new Error('Enter the four-character room code.');
    this.joining ||= {code,sessionToken:randomId()};
    if(this.joining.code!==code)this.joining={code,sessionToken:randomId()};
    const {room}=await this.request(`/api/rooms/${code}/join`,{guestName:name,playerId:playerIdentity(),sessionToken:this.joining.sessionToken});
    this.attach({code,token:this.joining.sessionToken,name},room);this.joining=null;return room;
  }
  resume(session=this.current||this.saved) {if(session)this.attach(session);}
  async poll() {
    clearTimeout(this.timer);
    if(!this.session||this.polling||this.sending)return;
    const epoch=this.epoch,session=this.session;this.polling=true;
    try {const {room}=await this.request(`/api/rooms/${session.code}${this.room?`?since=${this.room.version}`:""}`,null,session.token);if(epoch===this.epoch)this.accept(room);}
    catch(e){if(epoch===this.epoch){this.fatal=[401,403,404,426].includes(e.status);this.status(false,e.message);}}
    finally{if(epoch===this.epoch){this.polling=false;if(!this.fatal)this.timer=setTimeout(()=>this.poll(),document.hidden?10000:this.connected?1500:3500);}}
  }
  async send(action,details={}) {
    if(!this.session||!this.room||this.sending)return null;
    if(this.pending && this.pending.action!==action)throw new Error('Retry the pending move before choosing another.');
    this.pending ||= {action,...details,version:this.room.version,requestId:randomId()};this.remember();
    const epoch=this.epoch,command=this.pending,session=this.session;this.sending=true;this.status(this.connected);
    try {
      const {room}=await this.request(`/api/rooms/${session.code}/action`,command,session.token);
      if(epoch!==this.epoch)return null;
      this.pending=null;this.remember();this.accept(room);return room;
    } catch(e) {
      if(epoch!==this.epoch)return null;
      if(e.status && e.status<500){this.pending=null;this.remember();}
      this.status(false,e.message);throw e;
    } finally {
      if(epoch===this.epoch){this.sending=false;this.onConnection({connected:this.connected,pending:!!this.pending,sending:false});this.poll();}
    }
  }
  retry(){return this.pending?this.send(this.pending.action):this.poll();}
  detach(forget=true) {
    clearTimeout(this.timer);this.epoch++;this.session=null;this.room=null;this.pending=null;this.polling=false;this.sending=false;this.fatal=false;
    if(forget){write(sessionStorage,ACTIVE,null);write(localStorage,SAVED,null);}
  }
}
