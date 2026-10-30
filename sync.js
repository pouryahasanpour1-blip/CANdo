/* همگام‌سازی آنلاین CANdo — داده‌ی مشترک با اپ «بودجه» (جدول budget_data در Supabase)
   CANdo داده‌ی خودش را به قالب «بودجه» تبدیل می‌کند، تغییراتش را روی نسخه‌ی سرور اعمال می‌کند
   و بعد نسخه‌ی نهایی را دوباره به قالب خودش برمی‌گرداند؛ پس هر دو اپ همیشه یک داده را می‌بینند. */
(()=>{
'use strict';
const K_CFG='cando-sync-cfg',K_AUTH='cando-sync-auth',K_LAST='cando-sync-last',K_BASE='cando-sync-base2',K_PASS='cando-sync-pass';
const TABLE='budget_data';
const LS={items:'dakhl-kharj-v1',budget:'dakhl-budget-v1',cats:'dakhl-cats-v2',accs:'dakhl-acc-v1',recs:'dakhl-rec-v1',insts:'dakhl-inst-v1',debts:'dakhl-debt-v1',sgoals:'dakhl-sgoal-v1',cbud:'dakhl-cbud-v1',cgoal:'dakhl-cgoal-v1'};
const WATCH=new Set(Object.values(LS));
const PAL=['#ff5fb7','#8b5cf6','#3b82f6','#2fe6d3','#ff9f43','#ffd21f','#9ccc65','#ff5c7a','#4dd0e1'];
['cando-sync-meta','cando-sync-dl'].forEach(k=>{try{localStorage.removeItem(k)}catch(e){}});

const g=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[<>&"]/g,m=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[m]));
const rawSet=Storage.prototype.setItem,rawDel=Storage.prototype.removeItem;
const lsGet=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
const lsSet=(k,v)=>{try{v==null?rawDel.call(localStorage,k):rawSet.call(localStorage,k,v)}catch(e){}};
const J=(k,d)=>{try{const v=JSON.parse(lsGet(k));return v==null?d:v}catch(e){return d}};
const cfg=()=>{const c=J(K_CFG,null)||J('bd-sync-cfg',{})||{};return{url:String(c.url||'').trim().replace(/\/+$/,''),key:String(c.key||'').trim()}};
const cfgOk=()=>{const c=cfg();return /^https:\/\//.test(c.url)&&c.key.length>20};
const pass=()=>lsGet(K_PASS)||lsGet('bd-sync-pass')||'';
let auth=J(K_AUTH,null);
let st={s:auth?'idle':'off',m:'',t:+(lsGet(K_LAST)||0)};
let busy=false,again=false,applying=false,timer=null,pendingReload=false;

Storage.prototype.setItem=function(k,v){const r=rawSet.call(this,k,v);if(this===localStorage&&!applying&&WATCH.has(k))schedule();return r};
Storage.prototype.removeItem=function(k){const r=rawDel.call(this,k);if(this===localStorage&&!applying&&WATCH.has(k))schedule();return r};

/* ---------- ابزار ---------- */
const canon=o=>Array.isArray(o)?'['+o.map(canon).join(',')+']':o&&typeof o==='object'?'{'+Object.keys(o).filter(k=>o[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canon(o[k])).join(',')+'}':JSON.stringify(o===undefined?null:o);
const same=(a,b)=>canon(a)===canon(b);
const clean=o=>{Object.keys(o).forEach(k=>{if(o[k]===undefined)delete o[k]});return o};
function hnum(s){let a=5381,b=52711;s=String(s);for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);a=((a<<5)+a+c)|0;b=(((b<<5)+b)^c)|0}return 1e15+(a>>>0)*32768+((b>>>0)&32767)}
/* شناسه‌ی «بودجه» ← شناسه‌ی CANdo (قطعی و یکسان روی همه‌ی دستگاه‌ها) */
const PFX={tx:'cd',acc:'cda',cat:'cdc',rec:'cd',ins:'cdi',debt:'cdd',sg:'cd'};
function cidOf(kind,rid){rid=String(rid);const p=PFX[kind],m=rid.match(new RegExp('^'+p+(kind==='cat'?'[oi]':'')+'(\\d+)$'));return m?+m[1]:hnum(rid)}
const newRid=(kind,cid,t)=>PFX[kind]+(kind==='cat'?(t==='in'?'i':'o'):'')+cid;
const hasJ=()=>typeof j2g==='function'&&typeof jp==='function';
const iso2=s=>new Date(s+'T12:00:00Z');
const ym=iso=>{if(!iso||!hasJ())return null;const[y,m]=jp(iso2(iso));return y*100+m};
const jday=iso=>{if(!iso||!hasJ())return 1;return jp(iso2(iso))[2]};
const ym2iso=(k,d)=>hasJ()&&k?j2g(Math.floor(k/100),k%100,d||1):undefined;

/* ---------- خواندن و نوشتن داده‌ی CANdo ---------- */
function readC(){
  const dc=(typeof CATS!=='undefined'&&CATS)?{out:CATS.out,in:CATS.in}:{out:[],in:[]};
  const cats=J(LS.cats,null)||dc;
  return{items:J(LS.items,[]),budget:+(lsGet(LS.budget)||0)||0,cats:{out:cats.out||[],in:cats.in||[]},accs:J(LS.accs,[{id:0,n:'نقد'},{id:1,n:'کارت'}]),
    recs:J(LS.recs,[]),insts:J(LS.insts,[]),debts:J(LS.debts,[]),sgoals:J(LS.sgoals,[]),cbud:J(LS.cbud,{}),cgoal:J(LS.cgoal,{})};
}
function writeC(c){
  const cur=readC();let changed=false;
  const put=(k,v,raw)=>{const o=raw?String(v):JSON.stringify(v);if(lsGet(k)!==o){lsSet(k,o);changed=true}};
  applying=true;
  try{
    if(!same(cur.items,c.items))put(LS.items,c.items);
    if(cur.budget!==c.budget)put(LS.budget,c.budget,1);
    if(!same(cur.cats,c.cats))put(LS.cats,c.cats);
    ['accs','recs','insts','debts','sgoals','cbud','cgoal'].forEach(k=>{if(!same(cur[k],c[k]))put(LS[k],c[k])});
  }finally{applying=false}
  return changed;
}

/* ---------- تبدیل «بودجه» ← CANdo ---------- */
function fromB(R,prev){
  const accC=rid=>rid==null?undefined:cidOf('acc',rid),catC=rid=>rid==null||rid===''?undefined:cidOf('cat',rid);
  const accs=(R.accs||[]).map(a=>({id:accC(a.id),n:a.n||'حساب'}));
  if(!accs.length)accs.push({id:0,n:'نقد'});
  const a0=accs[0].id;
  const cats={out:[],in:[]};(R.cats||[]).forEach(c=>{if(c.t==='out'||c.t==='in')cats[c.t].push({id:catC(c.id),e:c.e||'🏷',n:c.n||'دسته'})});
  ['out','in'].forEach(t=>{if(!cats[t].length)cats[t]=prev.cats[t].length?prev.cats[t]:[{id:0,e:'📦',n:'سایر'}]});
  const items=(R.tx||[]).filter(x=>x&&x.a>0&&x.d).map(x=>clean({id:cidOf('tx',x.id),t:x.t,a:x.a,c:x.t==='tr'?undefined:catC(x.c),n:x.n||'',d:x.d,ac:x.ac!=null?accC(x.ac):a0,to:x.t==='tr'?accC(x.to):undefined}));
  const cbud={},cgoal={};
  Object.entries(R.bud||{}).forEach(([k,v])=>{if(+v>0)cbud[catC(k)]=+v});
  Object.entries(R.goal||{}).forEach(([k,v])=>{if(+v>0)cgoal[catC(k)]=+v});
  const pRec=new Map((prev.recs||[]).map(x=>[x.id,x])),pIns=new Map((prev.insts||[]).map(x=>[x.id,x]));
  const recs=(R.rec||[]).map(r=>{const id=cidOf('rec',r.id),o=pRec.get(id),last=ym(r.last);return clean({id,t:r.t,a:r.a,c:catC(r.c),n:r.n||'',ac:r.ac!=null?accC(r.ac):a0,day:r.day||1,sk:o&&o.sk||last,last})});
  const insts=[],debts=[];
  (R.dbt||[]).forEach(x=>{
    if(x.k==='ins'){const id=cidOf('ins',x.id),o=pIns.get(id);insts.push(clean({id,n:x.n||'قسط',a:x.a,day:x.day||jday(x.due),nd:ym(x.due)||(o&&o.nd),total:x.cnt||0,paid:x.paid||0,ac:x.ac!=null?accC(x.ac):(o&&o.ac!=null?o.ac:a0),log:x.log!=null?!!x.log:(o?o.log:R.dbtTx!==false)}))}
    else if(x.k==='owe'||x.k==='lend')debts.push({id:cidOf('debt',x.id),w:x.n||'',a:x.a,dir:x.k,n:x.nt||'',due:x.due||null,done:!!x.done,doneAt:x.doneAt||0});
  });
  const sgoals=(R.sg||[]).map(x=>({id:cidOf('sg',x.id),n:x.n||'هدف',t:x.target||0,s:x.saved||0,e:x.e||'🎯'}));
  return{items,budget:+R.mb||0,cats,accs,recs,insts,debts,sgoals,cbud,cgoal};
}

/* ---------- اعمال تغییرات CANdo روی نسخه‌ی سرور ---------- */
const COLL={items:'tx',accs:'acc',recs:'rec',insts:'ins',debts:'debt',sgoals:'sg'};
const BARR={tx:'tx',acc:'accs',cat:'cats',rec:'rec',ins:'dbt',debt:'dbt',sg:'sg'};
const DLK={tx:'tx',acc:'acc',cat:'cat',rec:'rec',ins:'dbt',debt:'dbt',sg:'sg'};
function applyC(R,base,cur){
  const now=Date.now();let dirty=false;
  R.dl=R.dl||{};R.rv=R.rv||{};
  ['tx','accs','cats','rec','dbt','sg'].forEach(k=>{if(!Array.isArray(R[k]))R[k]=[]});
  // نقشه‌ی شناسه‌ها: CANdo ← «بودجه»
  const map={};const add=(kind,cid,rid,t)=>{map[kind+(t||'')+':'+cid]=rid};
  R.tx.forEach(x=>add('tx',cidOf('tx',x.id),x.id));R.accs.forEach(x=>add('acc',cidOf('acc',x.id),x.id));
  R.cats.forEach(x=>add('cat',cidOf('cat',x.id),x.id,x.t));R.rec.forEach(x=>add('rec',cidOf('rec',x.id),x.id));
  R.dbt.forEach(x=>add(x.k==='ins'?'ins':'debt',cidOf(x.k==='ins'?'ins':'debt',x.id),x.id));R.sg.forEach(x=>add('sg',cidOf('sg',x.id),x.id));
  const bm=base&&base.map||{};Object.keys(bm).forEach(k=>{if(!map[k])map[k]=bm[k]});
  const first=!base;
  if(first){ // بار اول: دسته‌ها و حساب‌های هم‌نام را یکی کن
    ['out','in'].forEach(t=>cur.cats[t].forEach(c=>{const k='cat'+t+':'+c.id;if(map[k])return;const m=R.cats.find(x=>x.t===t&&x.n===c.n);if(m)map[k]=m.id}));
    cur.accs.forEach(a=>{const k='acc:'+a.id;if(map[k])return;const m=R.accs.find(x=>x.n===a.n);if(m)map[k]=m.id});
  }
  const rid=(kind,cid,t)=>{const k=kind+(t||'')+':'+cid;if(!map[k])map[k]=newRid(kind,cid,t);return map[k]};
  const accR=cid=>rid('acc',cid==null?(cur.accs[0]&&cur.accs[0].id):cid);
  const catR=(t,cid)=>cid==null?'':rid('cat',cid,t);
  const findB=(kind,r)=>R[BARR[kind]].findIndex(x=>x.id===r);
  const dead=(kind,r)=>{const key=DLK[kind]+':'+r;return(R.dl[key]||0)>(R.rv[key]||0)};
  const upsert=(kind,r,obj)=>{const arr=R[BARR[kind]],i=findB(kind,r);const o=Object.assign({},i>=0?arr[i]:{},obj);clean(o);
    if(i>=0){if(same(arr[i],o))return;arr[i]=o}else arr.push(o);R.rv[DLK[kind]+':'+r]=now;dirty=true};
  const remove=(kind,r)=>{const arr=R[BARR[kind]],i=findB(kind,r);if(i>=0){arr.splice(i,1);dirty=true}const key=DLK[kind]+':'+r;R.dl[key]=now;delete R.rv[key];dirty=true};
  const toB={
    tx:(x,r)=>({id:r,d:x.d,a:x.a,t:x.t,c:x.t==='tr'?'':catR(x.t,x.c),ac:accR(x.ac),n:x.n||'',to:x.t==='tr'?accR(x.to):undefined}),
    acc:(x,r,old)=>({id:r,n:x.n,b:old&&old.b||0}),
    rec:(x,r)=>({id:r,t:x.t,c:catR(x.t,x.c),a:x.a,ac:accR(x.ac),n:x.n||'',day:x.day,last:ym2iso(x.last,1)}),
    ins:x=>({k:'ins',n:x.n,a:x.a,day:x.day,due:ym2iso(x.nd,x.day),cnt:x.total||0,paid:x.paid||0,done:x.total>0&&x.paid>=x.total?1:0,ac:accR(x.ac),log:!!x.log}),
    debt:x=>({k:x.dir==='owe'?'owe':'lend',n:x.w,nt:x.n||'',a:x.a,due:x.due||undefined,done:x.done?1:0,doneAt:x.doneAt||0}),
    sg:x=>({n:x.n,target:x.t,saved:x.s||0,e:x.e||'🎯'})
  };
  // حساب‌ها و دسته‌ها اول (چون تراکنش‌ها به آن‌ها اشاره می‌کنند)
  const order=['accs','items','recs','insts','debts','sgoals'];
  const diffList=(name,curL,baseL,kind)=>{
    const bmap=new Map((baseL||[]).map(x=>[x.id,x])),cset=new Set();
    curL.forEach(x=>{cset.add(x.id);const b=bmap.get(x.id);if(b&&same(b,x))return;const r=rid(kind,x.id);
      if(dead(kind,r))return; // در دستگاه دیگری حذف شده
      if(!b&&kind==='tx'&&findB('tx',r)<0){ // تراکنش تکراری (مثلاً تکرار ماهانه که اپ دیگر هم ساخته)
        const nb=toB.tx(x,r),ids=new Set(curL.map(z=>z.id));
        if(R.tx.some(y=>y.d===nb.d&&y.a===nb.a&&y.t===nb.t&&(y.c||'')===nb.c&&(y.n||'')===nb.n&&y.ac===nb.ac&&!ids.has(cidOf('tx',y.id))))return}
      const old=R[BARR[kind]][findB(kind,r)];upsert(kind,r,Object.assign({id:r},toB[kind](x,r,old)))});
    if(baseL)baseL.forEach(x=>{if(!cset.has(x.id))remove(kind,rid(kind,x.id))});
  };
  // دسته‌ها
  ['out','in'].forEach(t=>{
    const bl=base?base.st.cats[t]:null,bmap=new Map((bl||[]).map(x=>[x.id,x])),cset=new Set();
    cur.cats[t].forEach((c,i)=>{cset.add(c.id);const b=bmap.get(c.id);if(b&&same(b,c))return;const r=rid('cat',c.id,t);if(dead('cat',r))return;
      const old=R.cats[findB('cat',r)];upsert('cat',r,{id:r,n:c.n,e:c.e,t,c:old&&old.c||PAL[R.cats.length%9]})});
    if(bl)bl.forEach(c=>{if(!cset.has(c.id))remove('cat',rid('cat',c.id,t))});
  });
  order.forEach(name=>diffList(name,cur[name]||[],base?base.st[name]:null,COLL[name]));
  // سقف‌ها و هدف‌های دسته
  const mapObj=(o,t)=>{const r={};Object.entries(o||{}).forEach(([k,v])=>{r[catR(t,+k)]=+v});return r};
  if(!base||!same(base.st.cbud,cur.cbud)||base.st.budget!==cur.budget){
    if(base||Object.keys(cur.cbud).length||cur.budget){
      let nb,mb=+R.mb||0;
      if(base){nb=Object.assign({},R.bud||{});Object.keys(base.st.cbud||{}).forEach(k=>{if(!(k in cur.cbud))nb[catR('out',+k)]=0});Object.assign(nb,mapObj(cur.cbud,'out'));if(base.st.budget!==cur.budget)mb=cur.budget}
      else{nb=Object.assign(mapObj(cur.cbud,'out'),R.bud||{});if(!mb)mb=cur.budget}
      if(!same(nb,R.bud||{})||(+R.mb||0)!==mb){R.bud=nb;if(mb)R.mb=mb;else delete R.mb;R.budTs=now;delete R.dl['bud:*'];dirty=true}}
  }
  if(!base||!same(base.st.cgoal,cur.cgoal)){
    if(base||Object.keys(cur.cgoal).length){
      let ng;if(base){ng=Object.assign({},R.goal||{});Object.keys(base.st.cgoal||{}).forEach(k=>{if(!(k in cur.cgoal))ng[catR('in',+k)]=0});Object.assign(ng,mapObj(cur.cgoal,'in'))}else ng=Object.assign(mapObj(cur.cgoal,'in'),R.goal||{});
      if(!same(ng,R.goal||{})){R.goal=ng;R.goalTs=now;delete R.dl['goal:*'];dirty=true}}
  }
  if(dirty)R.ts=Math.max(now,(R.ts||0)+1);
  return{dirty,map};
}

/* ---------- رمزنگاری (همان روش اپ «بودجه») ---------- */
const te=new TextEncoder(),td=new TextDecoder();
const b2s=u=>{let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s)};
const s2b=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function dkey(pw,salt){const m=await crypto.subtle.importKey('raw',te.encode(pw),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:150000,hash:'SHA-256'},m,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
async function seal(p){const pw=pass();if(!pw)return{enc:0,p};const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),k=await dkey(pw,salt);
  const c=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},k,te.encode(JSON.stringify(p))));return{enc:1,s:b2s(salt),i:b2s(iv),c:b2s(c)}}
async function open(d){if(!d)return null;if(!d.enc)return d.p;const pw=pass();if(!pw)throw new Error('NEEDPASS');
  try{const k=await dkey(pw,s2b(d.s));return JSON.parse(td.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:s2b(d.i)},k,s2b(d.c))))}catch(e){throw new Error('BADPASS')}}

/* ---------- Supabase ---------- */
function setAuth(j){auth={at:j.access_token,rt:j.refresh_token,exp:Math.floor(Date.now()/1000)+(j.expires_in||3600),uid:j.user&&j.user.id,email:j.user&&j.user.email};lsSet(K_AUTH,JSON.stringify(auth))}
async function refresh(){
  const c=cfg(),r=await fetch(c.url+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:c.key,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:auth.rt})});
  if(r.status===400||r.status===401){auth=null;lsSet(K_AUTH,null);throw new Error('SESSION')}
  if(!r.ok)throw new Error('HTTP '+r.status);setAuth(await r.json());
}
async function api(path,o,retry){
  if(!auth)throw new Error('SESSION');
  if(auth.exp-Date.now()/1000<60)await refresh();
  const c=cfg();o=o||{};
  const r=await fetch(c.url+path,Object.assign({},o,{headers:Object.assign({apikey:c.key,Authorization:'Bearer '+auth.at,'Content-Type':'application/json'},o.headers||{})}));
  if(r.status===401&&!retry){await refresh();return api(path,o,1)}
  return r;
}
async function errText(r){try{const j=await r.json();if(j.code==='42P01'||/does not exist|schema cache/i.test(j.message||''))return 'NOTABLE';return j.message||j.msg||j.error_description||('HTTP '+r.status)}catch(e){return 'HTTP '+r.status}}
async function getRow(){const r=await api('/rest/v1/'+TABLE+'?select=rev,data&limit=1');if(!r.ok)throw new Error(await errText(r));const a=await r.json();return a[0]||null}
async function putRow(row,data){
  let r;
  if(!row){r=await api('/rest/v1/'+TABLE,{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({data})});if(r.status===409)return false}
  else r=await api('/rest/v1/'+TABLE+'?user_id=eq.'+auth.uid+'&rev=eq.'+row.rev,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({data,rev:row.rev+1,updated_at:new Date().toISOString()})});
  if(!r.ok)throw new Error(await errText(r));
  const a=await r.json();return a.length>0;
}
const emptyB=()=>({v:1,ts:0,dl:{},rv:{},u:'تومان',tx:[],accs:[],cats:[],sg:[],rec:[],dbt:[],bud:{},goal:{},budTs:0,goalTs:0});

/* ---------- حلقه ---------- */
function setSt(s,m){st.s=s;st.m=m||'';if(s==='ok'){st.t=Date.now();lsSet(K_LAST,String(st.t))}paint()}
async function sync(){
  if(!auth||!cfgOk()||!navigator.onLine)return;
  if(busy){again=true;return}
  busy=true;setSt('syncing');
  try{
    let done=false;
    for(let i=0;i<4&&!done;i++){
      const row=await getRow();
      const R=Object.assign(emptyB(),row?(await open(row.data))||{}:{});
      let base=J(K_BASE,null);if(base&&base.uid!==auth.uid)base=null;
      const cur=readC();
      const {dirty,map}=applyC(R,base,cur);
      if(dirty||!row){if(!(await putRow(row,await seal(R))))continue}
      const next=fromB(R,cur);
      if(writeC(next))pendingReload=true;
      lsSet(K_BASE,JSON.stringify({uid:auth.uid,map,st:next}));
      done=true;
    }
    setSt(done?'ok':'error',done?'':'تداخل؛ دوباره امتحان می‌شود');
  }catch(e){const m=e&&e.message||'';
    setSt(m==='SESSION'?'off':'error',m==='NOTABLE'?'جدول budget_data در Supabase نیست؛ اول همگام‌سازی اپ بودجه رو راه بنداز':m==='NEEDPASS'?'رمز رمزنگاری لازمه':m==='BADPASS'?'رمز رمزنگاری اشتباهه':m==='SESSION'?'':(e instanceof TypeError?'اتصال به سرور ممکن نشد':m))}
  finally{busy=false;if(again){again=false;schedule(800)}tryReload()}
}
function schedule(ms){clearTimeout(timer);if(auth)timer=setTimeout(sync,ms||2500)}
function tryReload(){
  if(!pendingReload)return;
  const open=document.querySelector('.sheet-bg.open'),lock=g('lock'),locked=lock&&getComputedStyle(lock).display!=='none';
  if(open||locked||document.activeElement&&/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){setTimeout(tryReload,2000);return}
  pendingReload=false;location.reload();
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')schedule(300)});
window.addEventListener('online',()=>schedule(300));
setInterval(()=>{if(document.visibilityState==='visible')sync()},60000);

/* ---------- رابط کاربری ---------- */
const ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><path d="m9 14 2 2 4-4"/></svg>';
const CHEV='<span class="sr-chev" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg></span>';
const X='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const fmtT=t=>t?new Date(t).toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'}):'';
const sub=()=>!cfgOk()?'تنظیم نشده':!auth?'خاموش · برای روشن کردن بزن':st.s==='syncing'?'در حال همگام‌سازی…':st.s==='error'?'خطا: '+st.m:'روشن'+(st.t?' · آخرین: '+fmtT(st.t):'');

const css=document.createElement('style');css.textContent=`
.sy-card{background:var(--card);border-radius:20px;padding:16px;margin:6px 0 12px;display:flex;gap:12px;align-items:center}
.sy-dot{width:10px;height:10px;border-radius:50%;background:var(--t);flex:none;box-shadow:0 0 0 4px color-mix(in srgb,var(--t) 20%,transparent)}
.sy-dot.err{background:var(--r);box-shadow:0 0 0 4px color-mix(in srgb,var(--r) 20%,transparent)}
.sy-dot.busy{background:var(--y);animation:sypulse 1s infinite alternate}
@keyframes sypulse{to{opacity:.35}}
@media (prefers-reduced-motion:reduce){.sy-dot.busy{animation:none}}
.sy-hint{font-size:13.5px;color:var(--mute);line-height:1.9;margin:4px 4px 12px}
.sy-f{display:block;margin-bottom:10px}.sy-f span{display:block;font-size:13px;color:var(--mute);margin:0 4px 6px;font-weight:600}
.sy-f input{width:100%;min-height:48px;background:var(--card);border:0;border-radius:14px;padding:12px 14px;color:var(--txt);outline:none;font-size:15px}
.sy-f input:focus{box-shadow:0 0 0 2px var(--y)}
.sy-row{display:flex;gap:8px}.sy-row>*{flex:1}
.sy-b{min-height:50px;border:0;border-radius:16px;font-weight:700;font-size:15px;cursor:pointer;background:var(--y);color:var(--yd);width:100%}
.sy-b.s{background:var(--card);color:var(--txt)}.sy-b.d{background:none;color:var(--r)}
.sy-sql{direction:ltr;text-align:left;white-space:pre-wrap;font:12px/1.6 ui-monospace,Menlo,monospace;background:var(--card);border-radius:14px;padding:12px;margin:0 0 8px;max-height:180px;overflow:auto}
.sy-msg{min-height:22px;font-size:13.5px;color:var(--y);margin:10px 4px;text-align:center}
details.sy-d summary{cursor:pointer;color:var(--mute);font-size:13.5px;padding:12px 4px;min-height:44px}`;
document.head.appendChild(css);

const bg=document.createElement('div');bg.className='sheet-bg';bg.id='sybg';
bg.innerHTML=`<div class="sheet" role="dialog" aria-labelledby="syttl" style="max-height:92vh;overflow-y:auto;padding-top:10px"><div class="set-grab" aria-hidden="true"></div><div class="set-head"><h2 id="syttl">همگام‌سازی آنلاین</h2><button class="set-x" id="syx" aria-label="بستن">${X}</button></div><div id="sybody"></div><div class="sy-msg" id="symsg" role="status"></div></div>`;
document.body.appendChild(bg);
const sm=t=>{const m=g('symsg');if(m)m.textContent=t||''};
const fld=(id,lb,t,v,ph)=>`<label class="sy-f"><span>${lb}</span><input id="${id}" type="${t||'text'}" dir="ltr" autocomplete="off" value="${esc(v||'')}" placeholder="${ph||''}"></label>`;
function ui(){
  const c=cfg();let h='';
  if(!cfgOk()){
    h=`<div class="sy-hint">اطلاعات CANdo با اپ «بودجه» و همه‌ی گوشی‌هات یکی می‌شه. همون آدرس و کلید Supabase که توی بودجه زدی رو اینجا بزن (Project Settings › API).</div>`+fld('syurl','Project URL','url',c.url,'https://xxxx.supabase.co')+fld('sykey','anon public key','text',c.key)+`<button class="sy-b" id="sycs">ذخیره</button>`;
  }else if(!auth){
    h=`<div class="sy-hint">با همون ایمیل و رمزی که توی اپ «بودجه» داری وارد شو تا تراکنش‌ها، حساب‌ها، دسته‌ها، اقساط، بدهی‌ها و هدف‌ها بین دو اپ یکی بشن.</div>`+fld('syem','ایمیل','email')+fld('sypw','رمز (حداقل ۶ کاراکتر)','password')+`<div class="sy-row"><button class="sy-b" id="syin">ورود</button><button class="sy-b s" id="sysu">ساخت حساب</button></div><button class="sy-b d" id="syfg" style="margin-top:6px">تغییر آدرس پروژه</button>`;
  }else{
    const dot=st.s==='syncing'?'busy':st.s==='error'?'err':'';
    h=`<div class="sy-card"><span class="sy-dot ${dot}" aria-hidden="true"></span><div style="flex:1;min-width:0"><div style="font-weight:700" dir="ltr">${esc(auth.email||'')}</div><div style="font-size:13px;color:var(--mute);margin-top:2px">${esc(sub())}</div></div></div><button class="sy-b" id="sysync">همگام‌سازی الان</button>`;
  }
  if(auth)h+=`<details class="sy-d"${pass()?'':''}><summary>رمز رمزنگاری${pass()?' · ذخیره شده':' (اگه توی بودجه گذاشتی)'}</summary><div class="sy-hint" style="margin-top:0">اگه توی اپ بودجه رمز رمزنگاری گذاشتی، همون رو اینجا بزن. بدون رمز درست، اطلاعات خونده نمی‌شه.</div>`+fld('sypass','رمز','password','',pass()?'ذخیره شده':'')+`<div class="sy-row"><button class="sy-b s" id="sypset">ذخیره‌ی رمز</button><button class="sy-b s" id="sypclr">حذف رمز</button></div></details>`;
  if(auth)h+=`<div class="sy-hint" style="margin-top:8px">تم، قفل و چیدمان برای هر اپ جدا می‌مونه. عکس رسید و تگ‌های بودجه توی CANdo نشون داده نمی‌شن ولی پاک هم نمی‌شن.</div><button class="sy-b d" id="syout">خروج از حساب</button>`;
  g('sybody').innerHTML=h;
}
function paint(){const r=g('syopen');if(r){const s=r.querySelector('small');if(s)s.textContent=sub()}if(bg.classList.contains('open')&&g('sysync'))ui()}
const tr=e=>{const m=e&&e.message||'';if(/Invalid login/i.test(m))return 'ایمیل یا رمز اشتباهه';if(/already registered/i.test(m))return 'این ایمیل قبلاً ثبت شده؛ وارد شو';if(e instanceof TypeError)return 'اتصال به سرور ممکن نشد';return m||'خطا'};
async function authCall(kind){
  const em=g('syem').value.trim(),pw=g('sypw').value;
  if(!em||pw.length<6)return sm('ایمیل و رمز (حداقل ۶ کاراکتر) را وارد کن');
  sm('…');
  try{
    const c=cfg(),r=await fetch(c.url+(kind==='in'?'/auth/v1/token?grant_type=password':'/auth/v1/signup'),{method:'POST',headers:{apikey:c.key,'Content-Type':'application/json'},body:JSON.stringify({email:em,password:pw})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.msg||j.error_description||j.message||'خطا');
    if(!j.access_token){sm('ایمیل تأیید فرستاده شد. بعد از تأیید، وارد شو.');return}
    setAuth(j);rev=null;st.s='idle';ui();sm('');sync();
  }catch(e){sm(tr(e))}
}
bg.addEventListener('click',async e=>{
  if(e.target===bg){bg.classList.remove('open');return}
  const b=e.target.closest('button[id]');if(!b)return;const id=b.id;
  if(id==='syx')bg.classList.remove('open');
  else if(id==='sycs'){const u=g('syurl').value.trim(),k=g('sykey').value.trim();if(!/^https:\/\//.test(u)||k.length<20)return sm('آدرس یا کلید درست نیست');lsSet(K_CFG,JSON.stringify({url:u.replace(/\/+$/,''),key:k}));sm('');ui();paint()}
  else if(id==='syfg'){lsSet(K_CFG,JSON.stringify({url:'',key:''}));ui();paint()}
  else if(id==='syin')authCall('in');
  else if(id==='sysu')authCall('up');
  else if(id==='sysync'){sm('');await sync();sm(st.s==='ok'?'همگام شد':st.m)}
  else if(id==='sypset'){const v=g('sypass').value;if(!v)return sm('رمز را بنویس');lsSet(K_PASS,v);sm('ذخیره شد');sync().then(()=>{ui()})}
  else if(id==='sypclr'){lsSet(K_PASS,null);sm('رمز حذف شد');ui()}
  else if(id==='syout'){auth=null;lsSet(K_AUTH,null);lsSet(K_BASE,null);st.s='off';ui();paint();sm('از حساب خارج شدی؛ اطلاعات روی این گوشی می‌مونه.')}
});

/* ردیف در تنظیمات › داده و امنیت */
function addRow(){
  const bk=g('bkopen');if(!bk||g('syopen'))return;
  const r=document.createElement('button');r.className='sr';r.id='syopen';
  r.innerHTML=`<span class="sr-ic" style="--c:#0abab5">${ICON}</span><span class="sr-tx"><b>همگام‌سازی آنلاین</b><small></small></span>${CHEV}`;
  bk.parentNode.insertBefore(r,bk);
  r.onclick=()=>{const s=g('sbg');if(s)s.classList.remove('open');sm('');ui();bg.classList.add('open')};
  paint();
}
addRow();
if(auth)setTimeout(sync,1200);
})();
