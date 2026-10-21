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
 return <main className="watchlist-background"><CommunityCollector watchlist={saved}/></main>;
}
