import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Optional local Postgres runtime. Production has no dependency on PGlite.
test('directory preserves owners, enforces capacity and protects assignments', {skip: !process.env.PGLITE_TEST_MODULE}, async () => {
  const {PGlite}=await import(process.env.PGLITE_TEST_MODULE);
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.products(id bigint,platform text,external_shop_id text,external_product_id text);
      insert into public.products values(1,'shopee','123','456');
      grant select,insert,update,delete on public.products to service_role;`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261127080747_product_database_directory.sql',import.meta.url),'utf8'));
    const assign=async(s,p)=> (await db.query('select public.assign_product_database($1,$2,$3) as owner',['shopee',s,p])).rows[0].owner;
    await db.exec('set role service_role');
    assert.equal(await assign('123','456'),'db1');
    await assert.rejects(assign('123','999'), /No database is accepting/);
    await db.exec("update public.product_databases set accepts_new=true,capacity_available=true,product_limit=1 where database_id='db2'");
    assert.equal(await assign('123','999'),'db2');
    assert.equal(await assign('123','999'),'db2');
    await assert.rejects(assign('123','1000'), /capacity reached/);
    await db.exec("update public.product_databases set accepts_new=true,capacity_available=true,product_limit=1 where database_id='db3'");
    assert.equal(await assign('123','1000'),'db3');
    assert.equal(await assign('123','999'),'db2');
    await assert.rejects(assign('123','1001'), /capacity reached/);
    await assert.rejects(db.query("update public.product_databases set product_limit=15001 where database_id='db4'"), /check constraint/);
    await db.exec("update public.product_databases set capacity_available=false where database_id='db2'");
    assert.equal(await assign('123','999'),'db2');
    await db.exec("update public.product_database_directory set migration_in_progress=true where external_product_id='999'");
    await assert.rejects(assign('123','999'), /migration in progress/);
    await assert.rejects(assign('invalid','999'), /Invalid product identity/);
    const count=(await db.query('select count(*)::int as n from public.product_database_directory')).rows[0].n;
    assert.equal(count,3);
    await db.exec("update public.product_database_directory set migration_in_progress=false,internal_product_id=2 where external_product_id='999'");
    await assert.rejects(db.query("insert into public.products values(2,'shopee','123','999')"), /another database/);
    await assert.rejects(db.query("update public.products set external_product_id='457' where id=1"), /identity cannot change/);
    await assert.rejects(db.query("insert into public.products values(3,'shopee','123','457')"), /must be assigned/);
    await db.exec("update public.product_databases set accepts_new=true,capacity_available=true,product_limit=2 where database_id='db1'");
    assert.equal(await assign('123','457'),'db1');
    await db.exec("insert into public.products values(3,'shopee','123','457')");
    assert.equal(await assign('123','457'),'db1');
    await db.exec('reset role; set role anon');
    await assert.rejects(assign('123','456'), /permission denied/);
    await assert.rejects(db.query('select * from public.product_database_directory'), /permission denied/);
  } finally { await db.close(); }
});
