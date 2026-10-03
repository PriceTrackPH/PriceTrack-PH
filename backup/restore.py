#!/usr/bin/env python3
"""Restore a PriceTrack PH backup into an EMPTY Supabase application schema.
Install: python -m pip install 'psycopg[binary]'
Run: python restore.py /path/to/backup.zip --database-url 'postgresql://...'
Never use this against the live project. No automatic deletion is performed.
"""
import argparse
import json
import zipfile
import psycopg
from psycopg import sql


def q(name):
    return '"' + name.replace('"', '""') + '"'


def role(name):
    return 'PUBLIC' if name == 'PUBLIC' else q(name)


def schema_commands(catalog):
    pre = ['SET search_path = public, extensions', 'SET check_function_bodies = off']
    post = []
    for s in catalog['sequences']:
        if not s['identity']:
            pre.append(f"CREATE SEQUENCE public.{q(s['name'])} AS {s['type']} START {s['start']} INCREMENT {s['increment']} MINVALUE {s['min']} MAXVALUE {s['max']} CACHE {s['cache']} {'CYCLE' if s['cycle'] else 'NO CYCLE'}")
    for t in catalog['tables']:
        cols = []
        for c in t['columns']:
            definition = q(c['name']) + ' ' + c['type']
            if c.get('collation'):
                definition += ' COLLATE ' + c['collation']
            if c['identity']:
                s = c['sequence']
                definition += ' GENERATED ' + ('ALWAYS' if c['identity'] == 'a' else 'BY DEFAULT') + ' AS IDENTITY'
                if s:
                    definition += f" (START WITH {s['start']} INCREMENT BY {s['increment']} MINVALUE {s['min']} MAXVALUE {s['max']} CACHE {s['cache']} {'CYCLE' if s['cycle'] else 'NO CYCLE'})"
            elif c['generated']:
                definition += ' GENERATED ALWAYS AS (' + c['default'] + ') STORED'
            elif c['default'] is not None:
                definition += ' DEFAULT ' + c['default']
            if c['notNull']:
                definition += ' NOT NULL'
            cols.append(definition)
        pre.append(f"CREATE TABLE public.{q(t['name'])} ({', '.join(cols)})")
    pre.extend(f['definition'] for f in catalog['functions'])
    for c in catalog['constraints']:
        command = f"ALTER TABLE public.{q(c['table'])} ADD CONSTRAINT {q(c['name'])} {c['definition']}"
        (post if c['type'] == 'f' else pre).append(command)
    post.extend(catalog['indexes'])
    for v in catalog['views']:
        options = ' WITH (' + ','.join(v['options']) + ')' if v['options'] else ''
        post.append(f"CREATE VIEW public.{q(v['name'])}{options} AS {v['definition']}")
    post.extend(catalog['triggers'])
    for p in catalog['policies']:
        command = f"CREATE POLICY {q(p['policyname'])} ON public.{q(p['tablename'])} AS {p['permissive']} FOR {p['cmd']} TO " + ','.join(role(r) for r in p['roles'])
        if p['qual']:
            command += ' USING (' + p['qual'] + ')'
        if p['with_check']:
            command += ' WITH CHECK (' + p['with_check'] + ')'
        post.append(command)
    for t in catalog['tables']:
        if t['rls']:
            post.append(f"ALTER TABLE public.{q(t['name'])} ENABLE ROW LEVEL SECURITY")
        if t['forceRls']:
            post.append(f"ALTER TABLE public.{q(t['name'])} FORCE ROW LEVEL SECURITY")
    for t in catalog['tables'] + catalog['views']:
        post.append(f"REVOKE ALL ON TABLE public.{q(t['name'])} FROM PUBLIC, anon, authenticated, service_role")
    for g in catalog['grants']:
        post.append(f"GRANT {g['privilege']} ON TABLE public.{q(g['name'])} TO {role(g['role'])}" + (' WITH GRANT OPTION' if g['grantable'] else ''))
    for f in catalog['functions']:
        post.append(f"REVOKE ALL ON FUNCTION {f['identity']} FROM PUBLIC, anon, authenticated, service_role")
    for g in catalog['functionGrants']:
        post.append(f"GRANT EXECUTE ON FUNCTION {g['identity']} TO {role(g['role'])}" + (' WITH GRANT OPTION' if g['grantable'] else ''))
    for s in catalog['sequences']:
        if not s['identity'] and s['ownerTable']:
            post.append(f"ALTER SEQUENCE public.{q(s['name'])} OWNED BY public.{q(s['ownerTable'])}.{q(s['ownerColumn'])}")
        post.append(f"REVOKE ALL ON SEQUENCE public.{q(s['name'])} FROM PUBLIC, anon, authenticated, service_role")
        state = next((v for v in catalog.get('sequenceStates', []) if v['name'] == s['name']), {})
        value = state.get('lastValue')
        if value is not None:
            post.append(f"SELECT setval('public.{q(s['name'])}'::regclass, {value}, {'true' if state['isCalled'] else 'false'})")
    for g in catalog['sequenceGrants']:
        post.append(f"GRANT {g['privilege']} ON SEQUENCE public.{q(g['name'])} TO {role(g['role'])}" + (' WITH GRANT OPTION' if g['grantable'] else ''))
    for comment in catalog.get('comments', []):
        target = comment['target']
        text = "'" + comment['comment'].replace("'", "''") + "'"
        post.append('COMMENT ON ' + target + ' IS ' + text)
    return pre, post


def restore(archive, database_url):
    with zipfile.ZipFile(archive) as z:
        manifest = json.loads(z.read('manifest.json'))
        if manifest.get('complete') is not True:
            raise ValueError('Backup is incomplete')
        catalog = json.loads(z.read('database/catalog.json'))
        pre, post = schema_commands(catalog)
        with psycopg.connect(database_url) as connection:
            with connection.cursor() as cur:
                # A clean Supabase target has standard platform schemas/extensions already.
                existing = cur.execute("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','m')").fetchone()[0]
                if existing:
                    raise ValueError('Target public schema is not empty. Restore stopped; nothing was deleted.')
                for command in pre:
                    cur.execute(command)
                cur.execute('CREATE TEMP TABLE ptph_restore_rows (payload jsonb) ON COMMIT DROP')
                counts = {t['name']: int(t['exportedRows']) for t in manifest['tables']}
                for table in catalog['tables']:
                    cur.execute('TRUNCATE ptph_restore_rows')
                    count = 0
                    with cur.copy('COPY ptph_restore_rows (payload) FROM STDIN') as copy:
                        with z.open('database/' + table['name'] + '.ndjson') as f:
                            for line in f:
                                copy.write_row((line.decode('utf-8').strip(),))
                                count += 1
                    if count != counts[table['name']]:
                        raise ValueError('Row count mismatch: ' + table['name'])
                    columns = [c['name'] for c in table['columns'] if not c['generated']]
                    names = sql.SQL(',').join(map(sql.Identifier, columns))
                    cur.execute(sql.SQL('INSERT INTO public.{} ({}) OVERRIDING SYSTEM VALUE SELECT {} FROM ptph_restore_rows j CROSS JOIN LATERAL jsonb_populate_record(NULL::public.{}, j.payload) r').format(sql.Identifier(table['name']), names, sql.SQL(',').join(sql.SQL('r.{}').format(sql.Identifier(n)) for n in columns), sql.Identifier(table['name'])))
                    print(table['name'], count, 'rows restored')
                for command in post:
                    cur.execute(command)
                for p in catalog.get('publications', []):
                    if cur.execute('select 1 from pg_publication where pubname=%s', (p['pubname'],)).fetchone():
                        present = cur.execute('select 1 from pg_publication_tables where pubname=%s and schemaname=%s and tablename=%s', (p['pubname'], 'public', p['tablename'])).fetchone()
                        if not present:
                            cur.execute(sql.SQL('ALTER PUBLICATION {} ADD TABLE public.{}').format(sql.Identifier(p['pubname']), sql.Identifier(p['tablename'])))
            # Commit only after all data and constraints validate. Any failure rolls back.
        print('Application database restored. Reconfigure server secrets and review cronJobs in catalog.json before enabling scheduled jobs.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive')
    parser.add_argument('--database-url', required=True)
    args = parser.parse_args()
    restore(args.archive, args.database_url)
