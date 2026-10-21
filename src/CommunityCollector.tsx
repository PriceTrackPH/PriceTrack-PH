import { useEffect, useRef, useState } from 'react';
import './community-collector.css';
import { COLLECTOR_PRODUCT_WAIT_MS, COLLECTOR_STOP_GRACE_MS } from './collector-product-wait-policy';
type Product={id:number;shopId:string;externalProductId:string;name:string;image:string|null;source:string;url:string;token:string};
type Run={started:string;seconds:number;collected:number;failed:number;unavailable?:number;status:string};
const key='pricetrack-community-history-v1';
function readHistory():Run[]{try{const rows=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(rows)?rows.filter(r=>r&&typeof r.started==='string'&&Number.isFinite(r.seconds)&&Number.isFinite(r.collected)&&Number.isFinite(r.failed)).slice(0,20):[];}catch{return [];}}
export default function CommunityCollector({watchlist}:{watchlist:{id:string|number}[]}){
 const [remaining,setRemaining]=useState<number|null>(null),[history,setHistory]=useState(readHistory),[status,setStatus]=useState('Ready'),[collected,setCollected]=useState(0),[failed,setFailed]=useState(0),[unavailable,setUnavailable]=useState(0),[seconds,setSeconds]=useState(0),[product,setProduct]=useState<Product|null>(null),[message,setMessage]=useState('');
 const running=useRef(false),paused=useRef(false),tab=useRef<Window|null>(null),active=useRef<Product|null>(null),outcome=useRef(''),started=useRef(''),counts=useRef({collected:0,failed:0,unavailable:0}),ready=useRef(false),verification=useRef(false),stopAt=useRef<number|null>(null),elapsed=useRef(0),saved=useRef(watchlist),abort=useRef<AbortController|null>(null);
 saved.current=watchlist;
 async function api(body:object){const controller=new AbortController();abort.current=controller;const timer=setTimeout(()=>controller.abort(),20000);try{const response=await fetch('/api/observations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({communityCollector:true,...body}),signal:controller.signal});const data=await response.json();if(!response.ok)throw Error(data.error||'Collection failed.');return data;}finally{clearTimeout(timer);}}
 useEffect(()=>{
  let cancelled=false;
  const refresh=async()=>{try{const response=await fetch('/api/observations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({communityCollector:true,action:'remaining',watchlist:watchlist.map(p=>p.id)})});if(!response.ok)return;const data=await response.json();if(!cancelled&&Number.isInteger(data.remaining))setRemaining(data.remaining);}catch{/* Keep the last confirmed count. */}};
  void refresh();window.addEventListener('focus',refresh);
  const midnight=new Date(new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'})+'T00:00:00+08:00').getTime()+86400000;
  const timer=setTimeout(()=>void refresh(),Math.max(1,midnight-Date.now()+1000));
  return()=>{cancelled=true;clearTimeout(timer);window.removeEventListener('focus',refresh);};
 },[watchlist,collected,unavailable,status]);
 async function release(p:Product){try{await api({action:'release',token:p.token});}catch{/* Reservation expires automatically. */}}
 function stop(){stopAt.current=Date.now();paused.current=false;setStatus('Stopping');}
 useEffect(()=>{const timer=setInterval(()=>{if(running.current&&!paused.current){elapsed.current++;setSeconds(elapsed.current);}},1000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{
  const listener=(event:MessageEvent)=>{if(event.origin!=='https://shopee.ph'||event.source!==tab.current)return;const data=event.data,p=active.current;if(!p||data?.source!=='pricetrack-ph-collector-product'||!['product-outcome','collector-ready'].includes(data.type))return;
   if(data.type==='collector-ready'){if(String(data.shopId)===String(p.shopId)&&String(data.externalProductId)===String(p.externalProductId))ready.current=true;return;}if(data.outcome==='account_restricted'||(String(data.shopId)===String(p.shopId)&&String(data.externalProductId)===String(p.externalProductId))){
   if(['verification','account_restricted'].includes(data.outcome)){verification.current=data.outcome==='verification';paused.current=true;setStatus('Paused');setMessage(data.outcome==='verification'?'Complete Shopee verification, then press Resume.':'Shopee account restricted. Collection stopped.');if(data.outcome==='account_restricted'){running.current=false;paused.current=false;setStatus('Stopping');}}
   else if(['unlisted','does_not_exist','page_error','sold_out'].includes(data.outcome))outcome.current=data.outcome;
  }};
  const leave=()=>{if(active.current)void fetch('/api/observations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({communityCollector:true,action:'release',token:active.current.token}),keepalive:true});};
  window.addEventListener('message',listener);window.addEventListener('pagehide',leave);
  return()=>{running.current=false;abort.current?.abort();leave();window.removeEventListener('message',listener);window.removeEventListener('pagehide',leave);};
 },[]);
 async function start(){
  if(running.current)return;
  // A separate browsing context keeps this public run apart from an admin run.
  const opened=window.open('about:blank',`ptph-community-${crypto.randomUUID()}`);
  if(!opened){setMessage('Allow pop-ups for PriceTrack PH, then press Start.');return;}
  tab.current=opened;running.current=true;paused.current=false;stopAt.current=null;verification.current=false;
  started.current=new Date().toISOString();counts.current={collected:0,failed:0,unavailable:0};elapsed.current=0;setSeconds(0);setCollected(0);setFailed(0);setUnavailable(0);setMessage('');setStatus('Collecting');
  const excluded:number[]=[];let lastShopId:string|null=null;const shops=new Set<string>();let finalStatus='Stopped';
  try{while(running.current&&!stopAt.current){
   while(paused.current&&running.current)await new Promise(r=>setTimeout(r,250));if(!running.current||stopAt.current)break;
   if(opened.closed)throw Error('The Shopee tab was closed.');
   const data=await api({action:'claim',watchlist:saved.current.map(p=>p.id),excluded,lastShopId,excludedShops:[...shops]});
   const p:Product|null=data.product;
   if(!p){finalStatus='Completed';setMessage('No eligible products are available right now.');break;}
   active.current=p;
   if(!running.current||stopAt.current){await release(p);active.current=null;break;}
   setProduct(p);excluded.push(p.id);lastShopId=p.shopId;shops.add(p.shopId);outcome.current='';ready.current=false;const target=new URL(p.url);target.searchParams.set('ptph_community','1');opened.location.href=target.href;
   let complete=false,terminal=false,waited=0;
   while(running.current&&waited<COLLECTOR_PRODUCT_WAIT_MS){
    await new Promise(r=>setTimeout(r,1000));if(opened.closed)throw Error('The Shopee tab was closed.');
    waited+=1000;
    if(stopAt.current&&Date.now()-stopAt.current>=COLLECTOR_STOP_GRACE_MS)break;
    if(outcome.current){
     const detected=outcome.current;
     await api({action:'outcome',token:p.token,outcome:detected});
     terminal=true;
     if(detected==='page_error'){counts.current.failed++;setFailed(counts.current.failed);}
     else{counts.current.unavailable++;setUnavailable(counts.current.unavailable);}
     break;
    }
    const result=await api({action:'status',token:p.token});
    if(result.completed){complete=true;break;}
    if(!ready.current&&waited>=10000)throw Error('No connection to the Community Collector extension. Install the updated Web extension, reload Shopee, and start again.');
    if(paused.current&&verification.current)break;
   }
   if(complete){counts.current.collected++;setCollected(counts.current.collected);window.dispatchEvent(new Event('pricetrack-watchlist-updated'));}
   else if(!terminal&&running.current&&!paused.current&&!stopAt.current){counts.current.failed++;setFailed(counts.current.failed);}
   await release(p);active.current=null;
   if(verification.current)excluded.pop();
   if(excluded.length>=2000){finalStatus='Completed';setMessage('This collection session has finished.');break;}
  }}catch(error){finalStatus='Interrupted';setMessage(error instanceof Error?error.message:'Collection interrupted.');}
  finally{
   running.current=false;paused.current=false;
   if(active.current){await release(active.current);active.current=null;}
   setProduct(null);setStatus(finalStatus);
   const row={started:started.current,seconds:elapsed.current,...counts.current,status:finalStatus};
   setHistory(previous=>{const next=[row,...previous].slice(0,20);try{localStorage.setItem(key,JSON.stringify(next));}catch{/* Keep the current session visible. */}return next;});
  }
 }
 const busy=['Collecting','Paused','Stopping'].includes(status);
 return <section className="community-collector" aria-label="Collection controls and history">
  <div className="community-buttons"><button disabled={busy} onClick={()=>void start()}>▶ Start collection</button><button disabled={!busy||status==='Stopping'} onClick={()=>{paused.current=!paused.current;setStatus(paused.current?'Paused':'Collecting');if(!paused.current){verification.current=false;setMessage('');}}}>{status==='Paused'?'▶ Resume':'Ⅱ Pause collection'}</button><button disabled={!busy||status==='Stopping'} onClick={stop}>■ Stop collection</button></div>
  <div className="community-stats" aria-live="polite"><div>Watchlist remaining<strong>{remaining??'…'}</strong></div><div>Collected<strong>{collected}</strong></div><div>Unavailable<strong>{unavailable}</strong></div><div>Failed<strong>{failed}</strong></div><div>Running time<strong>{Math.floor(seconds/60)}m {seconds%60}s</strong></div><div>Status<strong>{status}</strong></div></div>
  {product&&<div className="community-current">{product.image&&<img src={product.image} alt=""/>}<div><small>{product.source} · Checking product prices…</small><strong>{product.name}</strong></div></div>}
  <p className="community-note">Requires the updated PriceTrack PH Web extension with Community Collector support. Keep this page and the Shopee tab open. Complete verification manually if prompted. Use one collection session per browser.</p>
  {message&&<p role="status">{message}</p>}
  <details><summary>Collection history</summary><p>Saved in this browser only.</p><div className="community-history"><table><thead><tr><th>Started</th><th>Duration</th><th>Collected</th><th>Unavailable</th><th>Failed</th><th>Status</th></tr></thead><tbody>{history.map((r,i)=><tr key={`${r.started}-${i}`}><td>{new Date(r.started).toLocaleString('en-PH',{hour12:true})}</td><td>{Math.floor(r.seconds/60)}m {r.seconds%60}s</td><td>{r.collected}</td><td>{r.unavailable||0}</td><td>{r.failed}</td><td>{r.status}</td></tr>)}</tbody></table>{!history.length&&<p>No collection sessions yet.</p>}</div></details>
 </section>;
}
