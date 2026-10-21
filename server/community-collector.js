import crypto from 'node:crypto';
import { claimRandomProduct, markCollectorProductOutcome } from '../api/admin-pc-collector.js';
const sign = (value, secret) => crypto.createHmac('sha256', secret).update(value).digest('base64url');
export function encodeClaim(claim, secret) {
  const value = Buffer.from(JSON.stringify(claim)).toString('base64url');
  return `${value}.${sign(value, secret)}`;
}
export function decodeClaim(token, secret) {
  const [value, signature] = String(token || '').split('.');
  const expected = sign(value || '', secret);
  if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw Error('Invalid collection claim');
  const claim = JSON.parse(Buffer.from(value, 'base64url'));
  if (claim.expires < Date.now()) throw Error('Collection claim expired');
  return claim;
}
export default async function communityCollector(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const origin = req.headers.origin;
  if (!origin || !['https://pricetrackph.com', 'https://www.pricetrackph.com', `https://${req.headers.host}`].includes(origin)) return res.status(403).json({error:'Open the collector on PriceTrack PH.'});
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return res.status(503).json({error:'Collector is not configured.'});
  const headers = {apikey:secret,'Content-Type':'application/json', ...(secret.startsWith('ey') ? {Authorization:`Bearer ${secret}`} : {})};
  async function rest(path, options = {}) {
    const response = await fetch(`${url}/rest/v1/${path}`, {signal:AbortSignal.timeout(15000), ...options, headers:{...headers,...options.headers}});
    if (!response.ok) throw Error('Unable to contact the collection service.');
    return response.status===204 ? [] : response.json();
  }
  try {
    const body=req.body || {};
    if(body.action==='remaining') {
      const ids=Array.isArray(body.watchlist)?[...new Set(body.watchlist.map(Number).filter(n=>Number.isSafeInteger(n)&&n>0))].slice(0,2000):[];
      if(!ids.length)return res.status(200).json({remaining:0});
      const midnight=new Date(new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'})+'T00:00:00+08:00').toISOString();
      const rows=await rest(`products?select=id,last_checked_at,last_check_attempt_at,collector_page_outcome&id=in.(${ids.join(',')})&platform=eq.shopee&limit=2000`);
      const remaining=rows.filter(row=>!(row.last_checked_at&&Date.parse(row.last_checked_at)>=Date.parse(midnight))&&!(row.collector_page_outcome&&row.last_check_attempt_at&&Date.parse(row.last_check_attempt_at)>=Date.parse(midnight))).length;
      return res.status(200).json({remaining});
    }
    if (body.action==='claim') {
      const ids = value => Array.isArray(value) ? [...new Set(value.map(Number).filter(n=>Number.isSafeInteger(n)&&n>0))].slice(0,2000) : [];
      const excluded=ids(body.excluded);
      const watchlist=ids(body.watchlist).filter(id=>!excluded.includes(id));
      let product;
      const now=new Date().toISOString();
      const midnight=new Date(new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'})+'T00:00:00+08:00').toISOString();
      if (watchlist.length) {
        const candidates=await rest(`products?select=id,external_shop_id,external_product_id,name,image_url,last_checked_at,last_check_attempt_at,collector_page_outcome&id=in.(${watchlist.join(',')})&platform=eq.shopee&or=(last_checked_at.is.null,last_checked_at.lt.${midnight})&and=(or(check_lease_until.is.null,check_lease_until.lt.${now}))&limit=2000`);
        for (const candidate of candidates) {
          if(candidate.last_checked_at && Date.parse(candidate.last_checked_at)>=Date.parse(midnight))continue;
          if(candidate.collector_page_outcome && candidate.last_check_attempt_at && Date.parse(candidate.last_check_attempt_at)>=Date.parse(midnight))continue;
          const lease=new Date(Date.now()+120000).toISOString();
          const rows=await rest(`products?id=eq.${candidate.id}&or=(check_lease_until.is.null,check_lease_until.lt.${now})&and=(or(last_checked_at.is.null,last_checked_at.lt.${midnight}))`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({check_lease_until:lease})});
          if(rows.length) {product={productId:candidate.id,shopId:candidate.external_shop_id,externalProductId:candidate.external_product_id,leaseUntil:lease};break;}
        }
      }
      const source=product?'Watchlist':'Normal Queue';
      if (!product) {
        const lastShop=/^\d+$/.test(String(body.lastShopId))?String(body.lastShopId):null;
        const shops=ids(body.excludedShops).map(String);
        product=await claimRandomProduct(url,secret,excluded,true,lastShop,null,shops);
        if(!product && shops.length)product=await claimRandomProduct(url,secret,excluded,true,lastShop);
      }
      if (!product) return res.status(200).json({product:null});
      const [row]=await rest(`products?id=eq.${product.productId}&select=name,image_url,last_checked_at`);
      const claim={id:product.productId,lease:product.leaseUntil,baseline:row?.last_checked_at,shopId:product.shopId,externalProductId:product.externalProductId,started:now,expires:Date.now()+180000};
      return res.status(200).json({product:{id:product.productId,shopId:product.shopId,externalProductId:product.externalProductId,name:row?.name || 'Shopee product',image:row?.image_url,source,url:`https://shopee.ph/product/${product.shopId}/${product.externalProductId}`,token:encodeClaim(claim,secret)}});
    }
    const claim=decodeClaim(body.token,secret);
    if(body.action==='outcome') {
      if(!['sold_out','does_not_exist','unlisted','page_error'].includes(body.outcome)) throw Error('Invalid product outcome.');
      // Claim the exact signed lease before changing any product status. Replays
      // cannot increment unavailable/error counters or affect a newer reservation.
      const processingLease=new Date(Date.now()+30000).toISOString();
      const rows=await rest(`products?id=eq.${claim.id}&check_lease_until=eq.${encodeURIComponent(claim.lease)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({check_lease_until:processingLease})});
      if(!rows.length) return res.status(200).json({ok:true,alreadyFinished:true});
      try {
        const result=await markCollectorProductOutcome(url,secret,{claimSource:'random',productId:claim.id,shopId:claim.shopId,externalProductId:claim.externalProductId,outcome:body.outcome});
        return res.status(200).json({ok:true,result});
      }catch(error){
        await rest(`products?id=eq.${claim.id}&check_lease_until=eq.${encodeURIComponent(processingLease)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({check_lease_until:claim.lease})});
        throw error;
      }
    }
    if(body.action==='release') {
      await rest(`products?id=eq.${claim.id}&check_lease_until=eq.${encodeURIComponent(claim.lease)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({check_lease_until:null})});
      return res.status(200).json({ok:true});
    }
    if(body.action==='status') {
      const [row]=await rest(`products?id=eq.${claim.id}&select=last_checked_at`);
      return res.status(200).json({completed:Boolean(row?.last_checked_at && Date.parse(row.last_checked_at)>Date.parse(claim.baseline||'1970-01-01'))});
    }
    return res.status(400).json({error:'Invalid collection action.'});
  }catch(error){return res.status(400).json({error:error.message});}
}
