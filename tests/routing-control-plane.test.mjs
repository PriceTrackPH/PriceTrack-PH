import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('central queues can lease and complete a moved product without a DB1 product/history copy', {skip:!process.env.PGLITE_TEST_MODULE}, async()=>{
  const {PGlite}=await import(process.env.PGLITE_TEST_MODULE);
  const db=new PGlite();
  const sql=path=>readFile(new URL(path,import.meta.url),'utf8');
  try {
    await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
    await db.exec(await sql('./fixtures/routing-live-schema.sql'));
    await db.exec(`
      alter table products add primary key(id);
      alter table products add unique(platform,external_shop_id,external_product_id);
      alter table product_variations add primary key(id);
      alter table product_variations add foreign key(product_id) references products(id) on delete cascade;
      alter table product_daily_checks add primary key(id);
      alter table product_daily_checks add unique(product_id,checked_date);
      alter table product_daily_checks add foreign key(product_id) references products(id) on delete cascade;
      alter table personal_collection_products add primary key(product_id);
      alter table personal_collection_products add foreign key(product_id) references products(id) on delete cascade;
      alter table collector_backlogs add primary key(id);
      alter table collector_backlog_products add primary key(backlog_id,product_id);
      alter table collector_backlog_products add foreign key(product_id) references products(id) on delete cascade;
      alter table product_daily_extension_visits add foreign key(product_id) references products(id) on delete cascade;
      alter table public_collection_requests add primary key(request_id);
      alter table public_collection_requests add unique(platform,external_shop_id,external_product_id);
      alter table public_collection_request_quotas add primary key(requester_hash,requested_date);
      alter table store_collection_requests add primary key(request_id);
      alter table site_settings add primary key(key);
      insert into products(id,platform,external_shop_id,external_product_id,product_url,name,total_sold,next_check_at)
        overriding system value values(1,'shopee','100','101','https://shopee.ph/product/100/101','Local',10,now()-interval '1 day'),
        (2,'shopee','200','201','https://shopee.ph/product/200/201','Moved title',100,now()-interval '1 day');
      insert into product_variations(product_id,external_variation_id) values(1,'11'),(2,'22');
      grant select,insert,update,delete on all tables in schema public to service_role;
      grant usage on all sequences in schema public to service_role;
    `);
    const product=(await db.query('select to_jsonb(p) as row from products p where id=2')).rows[0].row;
    await db.exec(await sql('./fixtures/routing-live-functions.sql'));
    await db.exec(await sql('./fixtures/routing-mark-check.sql'));
    await db.exec(await sql('../supabase/migrations/20261127080747_product_database_directory.sql'));
    await db.exec(await sql('../supabase/routing/control-plane.sql'));
    await db.exec("update product_database_directory set database_id='db2' where internal_product_id=2; delete from products where id=2;");
    await db.query('select sync_owned_product_queue($1,$2::jsonb,true,null)',['db2',JSON.stringify(product)]);
    assert.deepEqual((await db.query('select id from products order by id')).rows,[{id:1}]);
    assert.deepEqual((await db.query('select id,name from only collector_products')).rows,[{id:2,name:null}]);
    assert.equal((await db.query('select count(*)::int n from product_variations where product_id=2')).rows[0].n,0);
    assert.equal((await db.query('select total_tracked::int,total_due::int from collector_available_summary_v3()')).rows[0].total_tracked,2);
    const leased=(await db.query("select * from claim_random_available_product_check_v2_rotation(array[1]::bigint[],true,null,'{}'::text[])")).rows;
    assert.equal(Number(leased[0].product_id),2);
    assert.equal((await db.query("select * from claim_random_available_product_check_v2_rotation(array[1]::bigint[],true,null,'{}'::text[])")).rows.length,0);
    await db.exec('update collector_products set check_lease_until=null where id=2;insert into personal_collection_products(product_id) values(2);');
    const backlog=(await db.query('select * from collector_backlog_begin()')).rows[0];
    assert.equal(Number(backlog.total),2);
    assert.equal((await db.query('select count(*)::int n from collector_backlog_products where product_id=2')).rows[0].n,1);
    const outcome=(await db.query("select mark_collector_product_outcome('random',null,2,'200','201','sold_out',now()) as result")).rows[0].result;
    assert.equal(outcome.outcome,'sold_out');
    assert.equal((await db.query('select consecutive_sold_out_checks from only collector_products where id=2')).rows[0].consecutive_sold_out_checks,1);
    const checkedDate=(await db.query("select (now() at time zone 'Asia/Manila')::date::text as date")).rows[0].date;
    const at=new Date().toISOString();
    const check={checked_date:checkedDate,checked_at:at,source:'extension',status:'success',variation_count:1,changed_count:0,unchanged_count:1,failed_count:0,metadata:{all_variations_unchanged:true}};
    await db.query('select sync_owned_product_queue($1,$2::jsonb,true,$3::jsonb)',['db2',JSON.stringify({...product,last_checked_at:at,last_check_attempt_at:at}),JSON.stringify(check)]);
    assert.equal((await db.query('select status from collector_product_daily_checks where product_id=2')).rows[0].status,'success');
    assert.equal((await db.query('select count(*)::int n from product_daily_checks where product_id=2')).rows[0].n,0);
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from collector_products'),/permission denied/);
  } finally {await db.close();}
});
