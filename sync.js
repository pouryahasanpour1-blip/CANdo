/* همگام‌سازی آنلاین CANdo با Supabase (جدول جدای cando_data) */
(()=>{
'use strict';
const P='dakhl-',TX='dakhl-kharj-v1';
const LOCAL=new Set(['dakhl-theme-v1','dakhl-lock-v1','dakhl-priv-v1','dakhl-bksnooze-v1','dakhl-lastbk-v1','dakhl-firstuse-v1','dakhl-vis-v2']);
const K_CFG='cando-sync-cfg',K_AUTH='cando-sync-auth',K_META='cando-sync-meta',K_DL='cando-sync-dl',K_LAST='cando-sync-last';
const TABLE='cando_data';
const SQL=`create table if not exists public.cando_data (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  rev integer not null default 1,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.cando_data enable row level security;
create policy "own cando row" on public.cando_data
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);`;

const g=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[<>&"]/g,m=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[m]));
const rawSet=Storage.prototype.setItem,rawDel=Storage.prototype.removeItem;
const lsGet=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
const lsSet=(k,v)=>{try{v==null?rawDel.call(localStorage,k):rawSet.call(localStorage,k,v)}catch(e){}};
const J=(k,d)=>{try{const v=JSON.parse(lsGet(k));return v==null?d:v}catch(e){return d}};
const synced=k=>typeof k==='string'&&k.startsWith(P)&&!LOCAL.has(k);

/* تنظیمات Supabase؛ اگر اپ «بودجه» روی همین دامنه تنظیم شده باشد، از همان استفاده می‌شود */
const cfg=()=>{const c=J(K_CFG,null)||J('bd-sync-cfg',{})||{};return{url:String(c.url||'').trim().replace(/\/+$/,''),key:String(c.key||'').trim()}};
const cfgOk=()=>{const c=cfg();return /^https:\/\//.test(c.url)&&c.key.length>20};
let auth=J(K_AUTH,null);
let meta=J(K_META,{}),dl=J(K_DL,{});
let st={s:auth?'idle':'off',m:'',t:+(lsGet(K_LAST)||0)};
let rev=null,busy=false,again=false,applying=false,timer=null,pendingReload=false;

/* ---------- ثبت زمان تغییر هر کلید و حذف تراکنش‌ها ---------- */
const txIds=v=>{try{return new Set((JSON.parse(v)||[]).map(x=>x&&x.id).filter(x=>x!=null))}catch(e){return new Set()}};
let knownTx=txIds(lsGet(TX));
function touch(k,v){
  const n=Date.now();meta[k]=n;
  if(k===TX){const cur=txIds(v);knownTx.forEach(id=>{if(!cur.has(id))dl[id]=n});cur.forEach(id=>{if(dl[id])delete dl[id]});knownTx=cur;
    const cut=n-120*864e5;Object.keys(dl).forEach(id=>{if(dl[id]<cut)delete dl[id]});lsSet(K_DL,JSON.stringify(dl))}
  lsSet(K_META,JSON.stringify(meta));
}
Storage.prototype.setItem=function(k,v){const r=rawSet.call(this,k,v);if(this===localStorage&&!applying&&synced(k)){touch(k,String(v));schedule()}return r};
Storage.prototype.removeItem=function(k){const r=rawDel.call(this,k);if(this===localStorage&&!applying&&synced(k)){touch(k,null);schedule()}return r};

/* ---------- داده ---------- */
function localKeys(){const a=new Set(Object.keys(meta).filter(synced));try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(synced(k))a.add(k)}}catch(e){}return a}
function payload(){const k={};localKeys().forEach(x=>{k[x]=[lsGet(x),meta[x]||1]});return{v:1,k,dl}}
const hash=p=>{const s=JSON.stringify(Object.keys(p.k).sort().map(x=>[x,p.k[x][0]]))+JSON.stringify(Object.keys(p.dl||{}).sort());let h=5381;for(let i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))|0;return h+':'+s.length};

function mergeTx(lv,lt,rv,rt,D){
  let L=[],R=[];try{L=JSON.parse(lv)||[]}catch(e){}try{R=JSON.parse(rv)||[]}catch(e){}
  const rm=new Map(R.map(x=>[x.id,x])),lm=new Map(L.map(x=>[x.id,x])),out=[];
  const rn=rt>lt;
  L.forEach(x=>{if(D[x.id])return;out.push(rm.has(x.id)&&rn?rm.get(x.id):x)});
  R.forEach(x=>{if(D[x.id]||lm.has(x.id))return;out.push(x)});
  return JSON.stringify(out);
}
/* برمی‌گرداند: آیا داده‌ی محلی عوض شد */
function merge(r){
  const D=Object.assign({},dl);Object.entries(r.dl||{}).forEach(([id,t])=>{D[id]=Math.max(D[id]||0,t)});
  const keys=new Set([...localKeys(),...Object.keys(r.k||{}).filter(synced)]);let changed=false;
  applying=true;
  try{
    keys.forEach(k=>{
      const lv=lsGet(k),lt=meta[k]||(lv==null?0:1),rr=(r.k||{})[k],rv=rr?rr[0]:null,rt=rr?rr[1]:0;
      let nv,nt;
      if(k===TX&&lv!=null&&rv!=null){nv=mergeTx(lv,lt,rv,rt,D);nt=Math.max(lt,rt)}
      else if(rt>lt){nv=rv;nt=rt}else{nv=lv;nt=lt}
      if(k===TX&&nv!=null){try{const a=JSON.parse(nv).filter(x=>!D[x.id]);nv=JSON.stringify(a)}catch(e){}}
      if(nv!==lv){lsSet(k,nv);changed=true}
      if(nt)meta[k]=nt;
    });
  }finally{applying=false}
  dl=D;knownTx=txIds(lsGet(TX));
  lsSet(K_META,JSON.stringify(meta));lsSet(K_DL,JSON.stringify(dl));
  return changed;
}

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
async function errText(r){try{const j=await r.json();if(j.code==='42P01'||/relation .* does not exist|schema cache/i.test(j.message||''))return 'NOTABLE';return j.message||j.msg||j.error_description||('HTTP '+r.status)}catch(e){return 'HTTP '+r.status}}
async function getRow(){const r=await api('/rest/v1/'+TABLE+'?select=rev,data&limit=1');if(!r.ok)throw new Error(await errText(r));const a=await r.json();return a[0]||null}
async function putRow(row,data){
  let r;
  if(!row){r=await api('/rest/v1/'+TABLE,{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({data})});if(r.status===409)return false}
  else r=await api('/rest/v1/'+TABLE+'?user_id=eq.'+auth.uid+'&rev=eq.'+row.rev,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({data,rev:row.rev+1,updated_at:new Date().toISOString()})});
  if(!r.ok)throw new Error(await errText(r));
  const a=await r.json();if(!a.length)return false;rev=a[0].rev;return true;
}

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
      let changed=false;
      if(row&&row.data&&row.data.v===1)changed=merge(row.data);
      const p=payload();
      if(row&&row.data&&row.data.k&&hash(p)===hash(row.data)){rev=row.rev;done=true}
      else done=await putRow(row,p);
      if(changed)pendingReload=true;
    }
    setSt(done?'ok':'error',done?'':'تداخل؛ دوباره امتحان می‌شود');
  }catch(e){const m=e&&e.message||'';setSt(m==='SESSION'?'off':'error',m==='NOTABLE'?'جدول cando_data در Supabase ساخته نشده':m==='SESSION'?'':(e instanceof TypeError?'اتصال به سرور ممکن نشد':m))}
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
    h=`<div class="sy-hint">اطلاعاتت روی همه‌ی گوشی‌ها یکی می‌شه. آدرس و کلید پروژه رو از Supabase › Project Settings › API بردار.</div>`+fld('syurl','Project URL','url',c.url,'https://xxxx.supabase.co')+fld('sykey','anon public key','text',c.key)+`<button class="sy-b" id="sycs">ذخیره</button>`;
  }else if(!auth){
    h=`<div class="sy-hint">با ایمیل و رمزت وارد شو. روی هر دستگاه همین ایمیل رو بزن تا اطلاعات یکی بشه. اگه توی اپ «بودجه» حساب داری، همون کار می‌کنه.</div>`+fld('syem','ایمیل','email')+fld('sypw','رمز (حداقل ۶ کاراکتر)','password')+`<div class="sy-row"><button class="sy-b" id="syin">ورود</button><button class="sy-b s" id="sysu">ساخت حساب</button></div><button class="sy-b d" id="syfg" style="margin-top:6px">تغییر آدرس پروژه</button>`;
  }else{
    const dot=st.s==='syncing'?'busy':st.s==='error'?'err':'';
    h=`<div class="sy-card"><span class="sy-dot ${dot}" aria-hidden="true"></span><div style="flex:1;min-width:0"><div style="font-weight:700" dir="ltr">${esc(auth.email||'')}</div><div style="font-size:13px;color:var(--mute);margin-top:2px">${esc(sub())}</div></div></div><button class="sy-b" id="sysync">همگام‌سازی الان</button>`;
  }
  h+=`<details class="sy-d"><summary>اولین بار؟ ساخت جدول در Supabase</summary><div class="sy-hint" style="margin-top:0">این رو یک‌بار در Supabase › SQL Editor اجرا کن. جدول CANdo از جدول «بودجه» جداست.</div><pre class="sy-sql" id="sysql">${esc(SQL)}</pre><button class="sy-b s" id="sycp">کپی SQL</button></details>`;
  if(auth)h+=`<div class="sy-hint" style="margin-top:8px">تم، قفل، مخفی‌کردن مبالغ و چیدمان صفحه برای هر گوشی جدا می‌مونه.</div><button class="sy-b d" id="syout">خروج از حساب</button>`;
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
  else if(id==='sycp'){try{await navigator.clipboard.writeText(SQL);sm('کپی شد')}catch(x){sm('متن را دستی انتخاب و کپی کن')}}
  else if(id==='syout'){auth=null;lsSet(K_AUTH,null);st.s='off';ui();paint();sm('از حساب خارج شدی؛ اطلاعات روی این گوشی می‌مونه.')}
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
