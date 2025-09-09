// --- PWA install (на iOS кнопка может не появиться — это норм) ---
let deferredPrompt=null;
const installBtn=document.getElementById('installBtn');
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;installBtn.hidden=false;});
installBtn?.addEventListener('click',async()=>{installBtn.hidden=true;if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;});
if('serviceWorker'in navigator) navigator.serviceWorker.register('./sw.js');

// --- IndexedDB (клиенты / уроки / абонементы / настройки) ---
const DB='tutor-ledger-db', VER=1; let db;
const openDB=()=>new Promise((res,rej)=>{const r=indexedDB.open(DB,VER);r.onupgradeneeded=e=>{db=e.target.result;db.createObjectStore('clients',{keyPath:'id'});db.createObjectStore('lessons',{keyPath:'id'});db.createObjectStore('payments',{keyPath:'id'});db.createObjectStore('settings',{keyPath:'key'});};r.onsuccess=()=>{db=r.result;res();};r.onerror=()=>rej(r.error);});
const tx=(s,m='readonly')=>db.transaction(s,m).objectStore(s);
const getAll=s=>new Promise((res,rej)=>{const q=tx(s).getAll();q.onsuccess=()=>res(q.result||[]);q.onerror=()=>rej(q.error);});
const put=(s,o)=>new Promise((res,rej)=>{const q=tx(s,'readwrite').put(o);q.onsuccess=()=>res();q.onerror=()=>rej(q.error);});
const del=(s,k)=>new Promise((res,rej)=>{const q=tx(s,'readwrite').delete(k);q.onsuccess=()=>res();q.onerror=()=>rej(q.error);});
const uid=()=>crypto.randomUUID();

// Настройки / валюта
async function getCur(){const x=await tx('settings').get('currency');return x?.value||'₽';}
async function setCur(v){await put('settings',{key:'currency',value:v});}

// Данные
const listClients=async()=> (await getAll('clients')).sort((a,b)=>a.name.localeCompare(b.name));
const listLessons=async()=> (await getAll('lessons')).sort((a,b)=>a.date-b.date);
const listPayments=async()=> (await getAll('payments')).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
const clientLessons=async id=> (await listLessons()).filter(l=>l.clientId===id);

const addClient=async({name,colorIndex=0,note='',tags=[]})=>put('clients',{id:uid(),name,colorIndex,note,tags});
const addLesson=async({clientId,date=Date.now(),duration=60,price=0,paid=false,canceled=false,cancelReason=null})=>put('lessons',{id:uid(),clientId,date,duration,price,paid,canceled,cancelReason});
const updateLesson=o=>put('lessons',o);
const addPayment=async({clientId,title,amount,lessons=0,note=''})=>put('payments',{id:uid(),clientId,createdAt:new Date().toISOString(),title,prepaidAmount:amount,remainingAmount:amount,totalLessons:lessons>0?lessons:null,remainingLessons:lessons>0?lessons:null,note});

const money=(v,c)=>`${Math.round(v)} ${c}`;
const isDepleted=p=>(p.remainingLessons??0)<=0 && p.remainingAmount<=0.0001;
async function markPaidWithAutoDeduct(id){
  const ls=await listLessons(); const l=ls.find(x=>x.id===id); if(!l) return;
  const pays=(await listPayments()).filter(p=>p.clientId===l.clientId && !isDepleted(p)).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
  if(pays.length){ const p=pays[0]; let covered=0;
    if(p.remainingLessons>0){p.remainingLessons-=1; covered=l.price;}
    if(p.remainingAmount>0){const need=Math.max(0,l.price-covered); const cash=Math.min(need,p.remainingAmount); p.remainingAmount-=cash; covered+=cash;}
    await put('payments',p);
  }
  l.paid=true; await updateLesson(l);
}

// --- UI helpers ---
const view=document.getElementById('view'); const $=(s,r=document)=>r.querySelector(s);
async function renderClients(){
  const cur=await getCur(); const ls=await listLessons(); const tpl=document.getElementById('clientsTpl').content.cloneNode(true);
  const owed=ls.filter(l=>!l.paid&&!l.canceled).reduce((s,l)=>s+l.price,0);
  const now=new Date(); const ym=now.getFullYear()*100+now.getMonth();
  const forecast=ls.filter(l=>{const d=new Date(l.date);return (d.getFullYear()*100+d.getMonth())===ym && !l.canceled;}).reduce((s,l)=>s+l.price,0);
  $('#owed',tpl).textContent=money(owed,cur); $('#forecast',tpl).textContent=money(forecast,cur);
  const ul=$('#clientsList',tpl);
  for(const c of await listClients()){
    const cls=ls.filter(l=>l.clientId===c.id);
    const unpaidCnt=cls.filter(l=>!l.paid&&!l.canceled).length;
    const unpaidSum=cls.filter(l=>!l.paid&&!l.canceled).reduce((s,l)=>s+l.price,0);
    const li=document.createElement('li'); li.className='item';
    li.innerHTML=`<div class="row"><div><b>${c.name}</b> ${(c.tags||[]).map(t=>`<span class="tag">${t}</span>`).join('')}
    <div class="muted">-${unpaidCnt} услуг | -${Math.round(unpaidSum)} ${cur}</div></div>
    <button data-id="${c.id}">Открыть</button></div>`;
    $('button',li).onclick=()=>renderClientDetail(c.id); ul.appendChild(li);
  }
  $('#addClientBtn',tpl).onclick=async()=>{const name=prompt('Имя клиента')?.trim(); if(!name)return;
    const tags=(prompt('Теги (через запятую)')||'').split(',').map(s=>s.trim()).filter(Boolean); await addClient({name,tags}); renderClients();};
  view.replaceChildren(tpl);
}

async function renderClientDetail(id){
  const c=(await listClients()).find(x=>x.id===id); if(!c) return; const ls=await clientLessons(id); const cur=await getCur();
  const tpl=document.getElementById('clientDetailTpl').content.cloneNode(true);
  $('#clientName',tpl).textContent=c.name; $('#backBtn',tpl).onclick=renderClients;

  const unpaid=ls.filter(l=>!l.paid&&!l.canceled).sort((a,b)=>b.date-a.date);
  const paid=ls.filter(l=>l.paid).sort((a,b)=>b.date-a.date);
  const canceled=ls.filter(l=>l.canceled).sort((a,b)=>b.date-a.date);
  $('#clientDebt',tpl).textContent=money(unpaid.reduce((s,l)=>s+l.price,0),cur);
  const done=ls.filter(l=>l.paid&&!l.canceled).length, canc=canceled.length;
  $('#clientConv',tpl).textContent=(done+canc)? Math.round(100*done/(done+canc))+'%':'—';

  function liLesson(l){const dt=new Date(l.date); const n=document.createElement('li'); n.className='item';
    n.innerHTML=`<div class="row"><div><b>${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</b>
    <div class="muted">${l.canceled?'Отменено':(l.paid?'Оплачено':'Не оплачено')} • ${Math.round(l.price)} ${cur}</div></div>
    <button data-id="${l.id}">Открыть</button></div>`; $('button',n).onclick=()=>renderLesson(l.id); return n;}
  for(const l of unpaid) $('#unpaidList',tpl).appendChild(liLesson(l));
  for(const l of paid) $('#paidList',tpl).appendChild(liLesson(l));
  for(const l of canceled) $('#canceledList',tpl).appendChild(liLesson(l));

  $('#addLessonBtn',tpl).onclick=async()=>{
    const ds=prompt('Дата и время (YYYY-MM-DD HH:MM)')||''; const price=parseFloat(prompt('Стоимость')||'0')||0; const dur=parseInt(prompt('Длительность (мин)')||'60')||60;
    const d=new Date(ds.replace(' ','T')); if(isNaN(d)){alert('Формат даты!');return;}
    await addLesson({clientId:c.id,date:d.getTime(),duration:dur,price}); renderClientDetail(id);
  };
  $('#addPackBtn',tpl).onclick=async()=>{
    const title=prompt('Название абонемента')||'Абонемент'; const amount=parseFloat(prompt('Предоплата, ₽')||'0')||0; const lessons=parseInt(prompt('Занятий (0 если не нужно)')||'0')||0;
    await addPayment({clientId:c.id,title,amount,lessons}); alert('Абонемент создан');
  };

  view.replaceChildren(tpl);
}

async function renderSchedule(){
  const tpl=document.getElementById('scheduleTpl').content.cloneNode(true);
  const ul=$('#scheduleList',tpl); const cls=await listClients();
  for(const l of await listLessons()){
    const dt=new Date(l.date); const name=cls.find(c=>c.id===l.clientId)?.name||'—';
    const li=document.createElement('li'); li.className='item';
    li.innerHTML=`<div class="row"><div><b>${name}</b><div class="muted">${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</div></div>
    <div class="rowgap"><button data-act="open" data-id="${l.id}">Открыть</button>
    <button data-act="+1h" data-id="${l.id}">+1 час</button><button data-act="+1d" data-id="${l.id}">+1 день</button></div></div>`;
    ul.appendChild(li);
  }
  ul.addEventListener('click',async e=>{
    const b=e.target.closest('button'); if(!b)return; const id=b.dataset.id; const act=b.dataset.act;
    const ls=await listLessons(); const l=ls.find(x=>x.id===id); if(!l)return;
    if(act==='open') return renderLesson(id);
    if(act==='+1h'){l.date=l.date+3600*1000; await updateLesson(l);}
    if(act==='+1d'){l.date=l.date+86400*1000; await updateLesson(l);}
    renderSchedule();
  });
  view.replaceChildren(tpl);
}

async function renderLesson(id){
  const l=(await listLessons()).find(x=>x.id===id); if(!l) return;
  const c=(await listClients()).find(x=>x.id===l.clientId);
  const tpl=document.getElementById('lessonTpl').content.cloneNode(true);
  const dt=new Date(l.date); const cur=await getCur();
  $('#backBtn',tpl).onclick=()=>renderClients();
  $('#lClient',tpl).textContent=c?.name||'—';
  $('#lPrice',tpl).textContent=`${Math.round(l.price)} ${cur} ${l.paid?'(Оплачено)':'(Не оплачено)'}`;
  $('#lDate',tpl).textContent=dt.toLocaleDateString();
  $('#lTime',tpl).textContent=dt.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  $('#lDur',tpl).textContent=`${l.duration} мин`;
  $('#lStatus',tpl).textContent=l.canceled?'Отменено':(l.paid?'Оплачено':'Не оплачено');

  $('#markPaidBtn',tpl).onclick=async()=>{await markPaidWithAutoDeduct(l.id); renderLesson(id);};
  $('#cancelBtn',tpl).onclick=async()=>{const r=prompt('Причина отмены?')||'Без причины'; l.canceled=true; l.cancelReason=r; await updateLesson(l); renderLesson(id);};
  $('#plus1hBtn',tpl).onclick=async()=>{l.date=l.date+3600*1000; await updateLesson(l); renderLesson(id);};
  $('#plus1dBtn',tpl).onclick=async()=>{l.date=l.date+86400*1000; await updateLesson(l); renderLesson(id);};

  view.replaceChildren(tpl);
}

async function renderAnalytics(){
  const tpl=document.getElementById('analyticsTpl').content.cloneNode(true);
  const cur=await getCur(); const lessons=await listLessons(); const payments=await listPayments(); const clients=await listClients();

  const tagSel=$('#tagFilter',tpl);
  const tags=[...new Set(clients.flatMap(c=>c.tags||[]))].sort();
  for(const t of tags){const o=document.createElement('option');o.value=t;o.textContent=t;tagSel.appendChild(o);}

  const month=new Date(); const start=new Date(month.getFullYear(),month.getMonth(),1), end=new Date(month.getFullYear(),month.getMonth()+1,1);
  const forecast=lessons.filter(l=>l.date>=start.getTime() && l.date<end.getTime() && !l.canceled).reduce((s,l)=>s+l.price,0);
  const done=lessons.filter(l=>l.paid && !l.canceled).length, canc=lessons.filter(l=>l.canceled).length;
  const remain=payments.reduce((s,p)=>s+(p.remainingAmount||0),0);

  $('#aForecast',tpl).textContent=money(forecast,cur);
  $('#aConv',tpl).textContent=(done+canc)? Math.round(100*done/(done+canc))+'%':'—';
  $('#aRemain',tpl).textContent=money(remain,cur);

  const byClient=$('#byClient',tpl);
  function drawClients(tag='*'){
    byClient.innerHTML='';
    for(const c of clients.filter(c=>tag==='*'||(c.tags||[]).includes(tag))){
      const ls=lessons.filter(l=>l.clientId===c.id);
      const d=ls.filter(l=>l.paid && !l.canceled).length, k=ls.filter(l=>l.canceled).length;
      const conv=(d+k)?Math.round(100*d/(d+k)):100;
      const li=document.createElement('li'); li.className='item';
      li.innerHTML=`<div class="row"><b>${c.name}</b><span class="muted">Конв. ${conv}%</span></div>`;
      byClient.appendChild(li);
    }
  }
  drawClients(); tagSel.onchange=()=>drawClients(tagSel.value);

  const reasons=$('#reasons',tpl); const map={};
  for(const l of lessons){if(l.canceled && l.cancelReason){map[l.cancelReason]=(map[l.cancelReason]||0)+1;}}
  const arr=Object.entries(map).sort((a,b)=>b[1]-a[1]);
  if(!arr.length){const li=document.createElement('li'); li.className='item'; li.textContent='Пока нет отмен'; reasons.appendChild(li);}
  for(const [r,cnt] of arr){const li=document.createElement('li'); li.className='item'; li.innerHTML=`<div class="row"><span>${r}</span><span class="muted">${cnt}</span></div>`; reasons.appendChild(li);}

  view.replaceChildren(tpl);
}

// --- Навигация (табы) ---
const tab=document.getElementById('tabSelect');
tab.onchange=()=>route();
async function renderSettings(){
  const tpl=document.getElementById('settingsTpl').content.cloneNode(true);
  $('#currencyInput',tpl).value=await getCur();
  $('#currencyInput',tpl).addEventListener('input',e=>setCur(e.target.value));
  view.replaceChildren(tpl);
}
async function route(){
  await openDB();
  const v=tab.value;
  if(v==='clients') return renderClients();
  if(v==='schedule') return renderSchedule();
  if(v==='analytics') return renderAnalytics();
  if(v==='settings')  return renderSettings();
}
route();
