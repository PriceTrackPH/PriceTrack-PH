import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate';

type Table = { name: string; rowCount: string; upperKey: Record<string,string> | null };
type Catalog = { tables: Table[]; exportedAt: string; websiteCommit: string; projectRef: string; environmentVariableNames: string[] };
type WritableFile = { write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> };
type SaveWindow = Window & { showSaveFilePicker?: (options: object) => Promise<{ createWritable(): Promise<WritableFile> }> };

export async function downloadFullBackup(token: string, progress: (message: string) => void) {
  const filename = `PriceTrack-PH-Backup-${new Date().toISOString().replace(/[:.]/g,'-')}.zip`;
  // Pick the destination while the button click still has user activation.
  const picker = (window as SaveWindow).showSaveFilePicker;
  let file: WritableFile | undefined;
  if (picker) {
    try {
      const handle = await picker.call(window, { suggestedName: filename, types: [{ description: 'ZIP backup', accept: { 'application/zip': ['.zip'] } }] });
      file = await handle.createWritable();
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') { progress('Backup cancelled.'); return; }
      throw e;
    }
  }
  const controller = new AbortController();
  const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
  window.addEventListener('beforeunload', leave);
  const chunks: Uint8Array[] = [];
  let writes = Promise.resolve();
  let zipFailure: Error | null = null;
  let compressedBytes = 0;
  let resolveZip!: () => void;
  let rejectZip!: (error: Error) => void;
  const finished = new Promise<void>((resolve,reject) => { resolveZip=resolve; rejectZip=reject; });
  // Attach the rejection handler immediately; await completion below.
  void finished.catch(() => undefined);
  const zip = new Zip((error,bytes,final) => {
    if (error) { zipFailure=error; rejectZip(error); return; }
    compressedBytes += bytes.length;
    if (file) {
      writes = writes.then(() => file!.write(bytes));
      void writes.catch((e: Error) => { zipFailure=e; controller.abort(); rejectZip(e); });
    } else {
      chunks.push(bytes.slice());
    }
    if (final) resolveZip();
  });
  async function request(action: string, body: object = {}) {
    for (let attempt=0; attempt<3; attempt++) {
      if (zipFailure) throw zipFailure;
      const timeout = AbortSignal.timeout(60000);
      try {
        const response = await fetch('/api/admin-backup', { method:'POST', headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, body:JSON.stringify({action,...body}), cache:'no-store', signal:AbortSignal.any([controller.signal,timeout]) });
        if (!response.ok) {
          const message = (await response.json().catch(() => ({}))).error || `Backup request failed (${response.status})`;
          if (response.status===401 || response.status===400 || response.status===403 || response.status===409) throw Object.assign(new Error(message), { permanent:true });
          throw new Error(message);
        }
        return response;
      } catch (e) {
        if ((e as { permanent?: boolean }).permanent || attempt===2 || controller.signal.aborted) throw e;
        await new Promise(resolve => setTimeout(resolve,1000*(attempt+1)));
      }
    }
    throw new Error('Backup read failed');
  }
  async function addText(name: string, text: string) {
    const entry = new ZipDeflate(name,{level:6}); zip.add(entry); entry.push(strToU8(text),true);
    await writes; if (zipFailure) throw zipFailure;
  }
  try {
    progress('Preparing backup…');
    const catalog = await (await request('catalog')).json() as Catalog;
    const exported: { name:string; exportedRows:number }[] = [];
    await addText('database/catalog.json',JSON.stringify(catalog,null,2));
    progress('Backing up website code and assets…');
    const website = new Uint8Array(await (await request('website')).arrayBuffer());
    const websiteEntry = new ZipPassThrough('website.zip'); zip.add(websiteEntry); websiteEntry.push(website,true); await writes;
    let done=0;
    const expected=catalog.tables.reduce((sum,t)=>sum+Number(t.rowCount),0);
    for (const table of catalog.tables) {
      const entry=new ZipDeflate(`database/${table.name}.ndjson`,{level:6}); zip.add(entry);
      let after: Record<string,string> | null=null;
      let count=0;
      if (table.upperKey) {
        while (true) {
          const page=await (await request('page',{table:table.name,after,upper:table.upperKey})).json() as { rows:string[]; cursor:Record<string,string>|null };
          if (page.rows.length===0) break;
          if (!page.cursor || JSON.stringify(page.cursor)===JSON.stringify(after)) throw new Error(`Backup cursor did not advance for ${table.name}`);
          entry.push(strToU8(page.rows.join('\n')+'\n'),false);
          after=page.cursor; count+=page.rows.length; done+=page.rows.length;
          await writes; if (zipFailure) throw zipFailure;
          progress(`Backing up ${table.name}: ${done.toLocaleString()} of ${expected.toLocaleString()} rows…`);
          if (page.rows.length<1000) break;
        }
      }
      entry.push(new Uint8Array(),true); await writes;
      if(count!==Number(table.rowCount)) throw new Error(`Data changed during backup (${table.name}). Stop recording activity and try again.`);
      exported.push({name:table.name,exportedRows:count});
    }
    const preferences: Record<string,string>={};
    for(let i=0;i<localStorage.length;i++) {
      const key=localStorage.key(i)!;
      if(key.startsWith('pricetrack-') && !/token|secret|password|credential|contact-draft/i.test(key)) preferences[key]=localStorage.getItem(key)!;
    }
    await addText('device-settings.json',JSON.stringify(preferences,null,2));
    // Restore instructions/tools are also inside website.zip's backup/ directory.
    await addText('README.txt','PriceTrack PH application backup. Extract website.zip and read backup/README.txt for contents, limitations and restore instructions. No backup was stored in Supabase.');
    await addText('manifest.json',JSON.stringify({format:1,complete:true,startedAt:catalog.exportedAt,finishedAt:new Date().toISOString(),projectRef:catalog.projectRef,websiteCommit:catalog.websiteCommit,environmentVariableNames:catalog.environmentVariableNames,tables:exported,consistency:'paginated live export; stop recording activity before backing up'},null,2));
    zip.end(); await finished; await writes;
    if(zipFailure) throw zipFailure;
    if(file) await file.close();
    else {
      const blob=new Blob(chunks as BlobPart[],{type:'application/zip'});
      const url=URL.createObjectURL(blob); const link=document.createElement('a');
      link.href=url; link.download=filename; link.click();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
    }
    progress(`Backup downloaded — ${(compressedBytes/1024/1024).toFixed(1)} MB.`);
  } catch(e) {
    controller.abort(); zip.terminate();
    if(file) await file.abort().catch(()=>undefined);
    throw e;
  } finally {
    window.removeEventListener('beforeunload',leave);
  }
}
