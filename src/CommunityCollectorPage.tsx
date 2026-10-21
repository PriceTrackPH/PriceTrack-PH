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
   <p>Use a desktop browser with PriceTrack PH Web extension v1.1.3 or a later version that supports Community Collector. The website chooses products and controls the run; the extension reads public prices from Shopee and saves them to PriceTrack PH.</p>
   <ol><li>Save the products you want checked first to your Watchlist in this browser.</li><li>Press <strong>Start collection</strong> and allow the dedicated Shopee tab to open.</li><li>Keep the collector page and Shopee tab open, with your device awake and connected to the internet. Use one collection session per browser.</li></ol>
   <h3>Collection order</h3><p>Your Watchlist comes first, once per day, resetting at midnight Philippine time. Products already checked that day are skipped. Normal skip schedules do not prevent this Watchlist check, but a product reserved by another collector must wait. After your Watchlist, collection continues with database products using the existing Normal Queue rules and store rotation.</p>
   <h3>What the counters mean</h3>
   <ul><li><strong>Watchlist remaining:</strong> saved products still needing a check for the current day. It decreases after a successful price recording or a saved unavailable result. Collecting never removes products from your Watchlist.</li><li><strong>Collected:</strong> products with successfully recorded prices during this run.</li><li><strong>Unavailable:</strong> products detected as sold out, unlisted, removed, or nonexistent. They are counted separately from Collected and Failed.</li><li><strong>Failed:</strong> page errors or products that timed out without a confirmed price recording.</li><li><strong>Running time:</strong> session time while the collector is not paused.</li><li><strong>Status:</strong> whether the collector is ready, collecting, paused, stopping, completed, or interrupted.</li></ul>
   <h3>Pause, resume, and stop</h3><p><strong>Pause</strong> prevents the next product from starting; the current product may finish recording. <strong>Resume</strong> continues the run. <strong>Stop</strong> prevents the next product from starting and allows the current product up to 30 seconds to finish before releasing its reservation. Closing the collector page interrupts the run. Prices already saved remain recorded.</p>
   <h3>Verification and connection problems</h3><p>If Shopee asks for verification, complete it manually in the Shopee tab, then press <strong>Resume</strong> if paused. A detected account restriction stops collection immediately. If the extension connection cannot be confirmed, the run is interrupted with a message; check that the compatible extension is installed and enabled, then reload Shopee before starting again.</p>
   <h3>History stays on your device</h3><p>The latest <strong>20 session summaries</strong> are saved in your browser on your device, with no time limit. Saving another session after the limit removes the oldest summary. Session history stays in your browser and does not sync between browsers or devices. Clearing site data or deleting your browser profile erases it; private browsing usually loses it when the private session closes. Starting a new run resets the session counters, while Watchlist remaining is checked against the current day’s saved results.</p>
  </section>
 </main>;
}
