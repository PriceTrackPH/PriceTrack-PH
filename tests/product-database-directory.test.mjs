import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Optional local Postgres runtime. Production has no dependency on PGlite.
test('directory preserves owners, enforces capacity and protects assignments', {skip: !process.env.PGLITE_TEST_MODULE}, async () => {
  const {PGlite}=await import(process.env.PGLITE_TEST_MODULE);
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.products(platform text,external_shop_id text,external_product_id text);
      insert into public.products values('shopee','123','456');
      grant select on public.products to service_role;`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261127080747_product_database_directory.sql',import.meta.url),'utf8'));
    const assign=async(s,p)=> (await db.query('select public.assign_product_database($1,$2,$3) as owner',['shopee',s,p])).rows[0].owner;
    await db.exec('set role service_role');
    assert.equal(await assign('123','456'),'db1');
    await assert.rejects(assign('123','999'), /No database is accepting/);
    await db.exec("update public.product_databases set accepts_new=true,capacity_available=true,product_limit=1 where database_id='db2'");
    assert.equal(await assign('123','999'),'db2');
    assert.equal(await assign('123','999'),'db2');
    await assert.rejects(assign('123','1000'), /capacity reached/);
    await db.exec("update public.product_databases set capacity_available=false where database_id='db2'");
    assert.equal(await assign('123','999'),'db2');
    await db.exec("update public.product_database_directory set migration_in_progress=true where external_product_id='999'");
    await assert.rejects(assign('123','999'), /migration in progress/);
    await assert.rejects(assign('invalid','999'), /Invalid product identity/);
    const count=(await db.query('select count(*)::int as n from public.product_database_directory')).rows[0].n;
    assert.equal(count,2);
    await db.exec('reset role; set role anon');
    await assert.rejects(assign('123','456'), /permission denied/);
    await assert.rejects(db.query('select * from public.product_database_directory'), /permission denied/);
  } finally { await db.close(); }
});
