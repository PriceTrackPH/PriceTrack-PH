import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import handler from '../backup/handler.js';

test('backup catalog and pages use physical rows once with inherited queue tables', {skip:!process.env.PGLITE_TEST_MODULE},async()=>{
  const {PGlite}=await import(process.env.PGLITE_TEST_MODULE);const db=new PGlite();
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema storage;create schema auth;create table storage.objects(id int);create table auth.users(id int);
      create table collector_products(id bigint primary key,name text);
      create table products(id bigint primary key,name text) inherits(collector_products);
      insert into products values(1,'Local');insert into collector_products values(2,null);
      select set_config('request.jwt.claims','{"role":"service_role"}',false);`);
    await db.exec(await readFile(new URL('../backup/export.sql',import.meta.url),'utf8'));
    const catalog=(await db.query('select admin_backup_catalog() as c')).rows[0].c;
    assert.deepEqual(catalog.inheritance,[{child:'products',parent:'collector_products'}]);
    for(const name of ['products','collector_products']){
      const table=catalog.tables.find(t=>t.name===name);assert.equal(table.rowCount,'1');
      const page=(await db.query('select admin_backup_page($1,null,$2::jsonb) as p',[name,JSON.stringify(table.upperKey)])).rows[0].p;
      assert.equal(page.rows.length,1);assert.equal(JSON.parse(page.rows[0]).id,name==='products'?1:2);
    }
  }finally{await db.close();}
});

test('multiple database backups keep owner credentials and reject unknown owners',async()=>{
  const oldEnv={...process.env},originalFetch=globalThis.fetch;
  Object.assign(process.env,{ADMIN_HEALTH_TOKEN:'admin',SUPABASE_URL:'https://db1.example',SUPABASE_SECRET_KEY:'secret1',PRICETRACK_DATABASE_ROUTING:'1',SUPABASE_DB2_URL:'https://db2.example',SUPABASE_DB2_SECRET_KEY:'secret2'});
  const response=()=>({status(n){this.code=n;return this},json(body){this.body=body;return this},setHeader(){}});
  try{
    globalThis.fetch=async(url,opts)=>{
      if(url.endsWith('list_product_database_owners'))return Response.json([{database_id:'db1'},{database_id:'db2'}]);
      assert.equal(opts.headers.apikey,url.startsWith('https://db2.')?'secret2':'secret1');
      if(url.endsWith('admin_backup_catalog'))return Response.json({storageObjects:0,authUsers:0,tables:[{name:'products',rowCount:'1'}]});
      assert.equal(JSON.parse(opts.body).p_table,'products');return Response.json({rows:['{"id":2}']});
    };
    let res=response();await handler({method:'POST',headers:{authorization:'Bearer admin'},body:{action:'catalog'}},res);
    assert.equal(res.code,200);assert.deepEqual(res.body.tables.map(t=>t.name),['db1__products','db2__products']);
    assert.equal(res.body.databases.length,2);assert(!JSON.stringify(res.body).includes('secret2'));
    res=response();await handler({method:'POST',headers:{authorization:'Bearer admin'},body:{action:'page',table:'db2__products'}},res);assert.equal(res.code,200);
    res=response();await handler({method:'POST',headers:{authorization:'Bearer admin'},body:{action:'page',table:'db3__products'}},res);assert.equal(res.code,400);
  }finally{process.env=oldEnv;globalThis.fetch=originalFetch;}
});
