import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync } from 'fflate';
// Package source/build assets on deployment; never scan runtime environment values.
const roots = ['src','api','server','google-apps-script','public','supabase','extension','extension-release-fixes','pc-collector','docs','scripts','backup','tests','dist','.github'];
const topFiles = ['package.json','package-lock.json','tsconfig.json','vite.config.ts','vercel.json','index.html','README.md','.env.example','.gitignore','GOOGLE_DRIVE_ARCHIVE_SETUP.md','PROJECT_HISTORY.md','NEW_CHAT_HANDOFF.md'];
const files = {};
function add(path) {
  if (/(^|\/)(node_modules|__pycache__|\.git|\.vercel|\.env(?!\.example$)|\.backup)(\/|$)/.test(path) || /\.(log|pyc|tsbuildinfo)$/.test(path)) return;
  if (statSync(path).isDirectory()) for (const name of readdirSync(path)) add(join(path,name));
  else files[path.replaceAll('\\','/')] = new Uint8Array(readFileSync(path));
}
for (const root of [...roots,...topFiles]) { try { add(root); } catch (e) { if(e.code!=='ENOENT') throw e; } }
mkdirSync('.backup',{recursive:true});
writeFileSync('.backup/website.zip',zipSync(files,{level:6}));
console.log(`Backup source bundle: ${Object.keys(files).length} files`);
