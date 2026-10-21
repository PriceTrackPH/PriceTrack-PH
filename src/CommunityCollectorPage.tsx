import { useEffect, useState } from 'react';
import CommunityCollector from './CommunityCollector';
import './watchlist.css';
function readWatchlist(): {id:string|number}[] {
  try {
    const value:unknown=JSON.parse(localStorage.getItem('pricetrack-watchlist-v1')||'[]');
    return Array.isArray(value)?value.filter((p):p is {id:string|number}=>Boolean(p&&typeof p==='object'&&'id' in p&&(typeof p.id==='string'||typeof p.id==='number'))):[];
  }catch{return [];}
}
export default function CommunityCollectorPage(){
 const [saved,setSaved]=useState(readWatchlist);
 useEffect(()=>{
  const previous=document.title;document.title='Community Collector — PriceTrack PH';
  const refresh=()=>setSaved(readWatchlist());
  window.addEventListener('storage',refresh);window.addEventListener('pricetrack-watchlist-changed',refresh);
  return()=>{document.title=previous;window.removeEventListener('storage',refresh);window.removeEventListener('pricetrack-watchlist-changed',refresh);};
 },[]);
 return <main className="watchlist-background community-page">
  <header className="community-heading"><span className="watchlist-kicker">COMMUNITY CONTRIBUTIONS</span><h1>Community Collector</h1><p>Help keep Shopee price history up to date by checking public product prices in one dedicated browser tab.</p></header>
  <CommunityCollector watchlist={saved}/>
  <section className="community-guide" aria-labelledby="community-guide-title"><h2 id="community-guide-title">Before you start</h2>
   <p>Use a desktop browser with the PriceTrack PH Web extension that supports Community Collector. The website controls the run; the extension records prices from Shopee. The required extension store update has not been published yet.</p>
   <ol><li>Open your Watchlist in this browser and save the products you want checked first.</li><li>Press <strong>Start collection</strong> and allow the dedicated Shopee tab to open.</li><li>Keep both tabs open and your device awake with an internet connection. Closing this page interrupts the run.</li></ol>
   <h3>What gets collected?</h3><p>Your eligible Watchlist products are checked first. After those, the collector checks eligible Normal Queue products. Products that are not due or are already reserved may be skipped. Your Watchlist does not add products to the admin Priority Queue.</p>
   <h3>Pause, resume, and stop</h3><p><strong>Pause</strong> prevents the next product from starting; a product already open may still finish recording. Press <strong>Resume</strong> to continue. <strong>Stop</strong> ends this run and releases its reservation; prices already saved remain in the database. Use one collection session per browser.</p>
   <h3>If Shopee asks for verification</h3><p>Complete it manually in the Shopee tab, then press Resume if the collector is paused. If your account is restricted, stop using the collector until the restriction is resolved.</p>
   <h3>Your stats and history</h3><p>Collected, Failed, running time, and status describe your current session. Up to 20 completed or interrupted sessions are saved in this browser only. They do not sync between devices. Clearing site data or using a private session can erase this history.</p>
  </section>
 </main>;
}
