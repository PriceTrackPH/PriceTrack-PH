import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
    const body=action==='catalog'?{}:{p_table:req.body.table,p_after:req.body.after??null,p_upper:req.body.upper??null};
    if(action==='page' && (typeof body.p_table!=='string' || !/^[a-z_][a-z0-9_]*$/.test(body.p_table))) return send(res,400,{error:'Invalid table'});
    const headers={apikey:secret,'Content-Type':'application/json',...(secret.startsWith('ey')?{Authorization:`Bearer ${secret}`}:{})};
    const response=await fetch(`${url}/rest/v1/rpc/admin_backup_${action}`,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
    if(!response.ok) throw new Error(`Backup read failed (${response.status})`);
    const result=await response.json();
    if(action==='catalog') {
      // Avoid silently creating an incomplete backup if platform storage/auth is added later.
      if(result.storageObjects!==0 || result.authUsers!==0) return send(res,409,{error:'This project now has Storage files or Auth users; full backup support must be extended before downloading.'});
      result.websiteCommit=process.env.VERCEL_GIT_COMMIT_SHA||'local-build';
      result.projectRef=new URL(url).hostname.split('.')[0];
      result.environmentVariableNames=Object.keys(process.env).filter(k=>/^(SUPABASE_|VITE_|ADMIN_|ADSENSE_|VAPID_|CONTACT_|RESEND_|GOOGLE_)/.test(k)).sort();
    }
    return send(res,200,result);
  } catch {
    return send(res,502,{error:'Backup could not be completed. Please try again.'});
  }
}
