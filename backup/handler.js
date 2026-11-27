import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalogTargets } from '../server/product-catalog.js';
import { databaseConfig } from '../server/product-owner.js';
const send = (res,status,body) => res.status(status).json(body);
function matches(a,b) { if (!a || !b) return false; const x=Buffer.from(a),y=Buffer.from(b); return x.length===y.length && crypto.timingSafeEqual(x,y); }
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return send(res,405,{error:'Method not allowed'});
  const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!matches(token,process.env.ADMIN_HEALTH_TOKEN||'')) return send(res,401,{error:'Unauthorized'});
  const origin=req.headers.origin;
  if(origin) { try { if(new URL(origin).host!==req.headers.host) return send(res,403,{error:'Invalid origin'}); } catch { return send(res,403,{error:'Invalid origin'}); } }
  const action=req.body?.action;
  if(!['catalog','page','website'].includes(action)) return send(res,400,{error:'Invalid backup action'});
  try {
    if(action==='website') {
      const bytes=await readFile(join(process.cwd(),'.backup/website.zip'));
      res.setHeader('Content-Type','application/zip');
      return res.status(200).send(bytes);
    }
    const url=(process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL||'').replace(/\/$/,'');
    const secret=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'';
    if(!url||!secret) return send(res,503,{error:'Backup is not configured'});
    const targets=await catalogTargets(process.env);
    if(process.env.PRICETRACK_DB2_PILOT_LIVE==='1'&&!targets.some(t=>t.owner==='db2'))targets.push(databaseConfig(process.env,'db2'));
    const requestedTable=String(req.body.table||'');
    const virtual=requestedTable.match(/^(db[1-9]\d{0,2})__([a-z_][a-z0-9_]*)$/);
    const owner=virtual?.[1]||'db1';
    const target=targets.find(t=>t.owner===owner);
    if(!target)return send(res,400,{error:'Invalid backup database'});
    const body=action==='catalog'?{}:{p_table:virtual?.[2]||req.body.table,p_after:req.body.after??null,p_upper:req.body.upper??null};
    if(action==='page' && (typeof body.p_table!=='string' || !/^[a-z_][a-z0-9_]*$/.test(body.p_table))) return send(res,400,{error:'Invalid table'});
    const targetHeaders={apikey:target.secret,'Content-Type':'application/json',...(target.secret.startsWith('ey')?{Authorization:`Bearer ${target.secret}`}:{})};
    const response=await fetch(`${target.url}/rest/v1/rpc/admin_backup_${action}`,{method:'POST',headers:targetHeaders,body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
    if(!response.ok) throw new Error(`Backup read failed (${response.status})`);
    const result=await response.json();
    if(action==='catalog') {
      // Avoid silently creating an incomplete backup if platform storage/auth is added later.
      if(result.storageObjects!==0 || result.authUsers!==0) return send(res,409,{error:'This project now has Storage files or Auth users; full backup support must be extended before downloading.'});
      result.websiteCommit=process.env.VERCEL_GIT_COMMIT_SHA||'local-build';
      result.projectRef=new URL(url).hostname.split('.')[0];
      result.environmentVariableNames=Object.keys(process.env).filter(k=>/^(SUPABASE_|VITE_|ADMIN_|ADSENSE_|VAPID_|CONTACT_|RESEND_|GOOGLE_)/.test(k)).sort();
      const catalogs=[{owner:'db1',catalog:{...result}}];
      const otherCatalogs=await Promise.all(targets.filter(t=>t.owner!=='db1').map(async other=> {
        const r=await fetch(`${other.url}/rest/v1/rpc/admin_backup_catalog`,{method:'POST',headers:{apikey:other.secret,'Content-Type':'application/json',...(other.secret.startsWith('ey')?{Authorization:`Bearer ${other.secret}`}:{})},body:'{}',signal:AbortSignal.timeout(25000)});
        if(!r.ok)throw Error('An assigned database could not be backed up');
        const catalog=await r.json();
        if(catalog.storageObjects!==0||catalog.authUsers!==0) throw Error('An assigned database has Auth users or Storage files requiring additional backup support.');
        catalog.projectRef=new URL(other.url).hostname.split('.')[0];
        return {owner:other.owner,catalog};
      }));
      catalogs.push(...otherCatalogs);
      if(catalogs.length>1){
        result.databases=catalogs;
        result.tables=catalogs.flatMap(({owner,catalog})=>catalog.tables.map(table=>({...table,name:`${owner}__${table.name}`})));
      }
    }
    return send(res,200,result);
  } catch {
    return send(res,502,{error:'Backup could not be completed. Please try again.'});
  }
}
