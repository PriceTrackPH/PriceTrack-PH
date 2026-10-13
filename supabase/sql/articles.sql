create table public.articles (
 id uuid primary key default gen_random_uuid(), title text not null check(length(title) between 1 and 200),
 slug text not null unique check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug)<=120),
 excerpt text not null default '' check(length(excerpt)<=400), cover_url text,
 content text not null default '' check(length(content)<=200000), revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.published_articles (
 id uuid primary key references public.articles(id) on delete cascade,
 title text not null, slug text not null unique, excerpt text not null, cover_url text, content text not null,
 published_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.articles enable row level security;
alter table public.published_articles enable row level security;
revoke all on public.articles, public.published_articles from public, anon, authenticated;
grant all on public.articles, public.published_articles to service_role;
grant select on public.published_articles to anon, authenticated;
create policy published_articles_read on public.published_articles for select to anon, authenticated using(true);
create function public.publish_article(p_id uuid, p_revision integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare draft public.articles; published public.published_articles;
begin
 select * into draft from public.articles where id=p_id and revision=p_revision for update;
 if not found then raise exception 'Draft changed; reload before publishing.' using errcode='40001'; end if;
 if btrim(regexp_replace(draft.content,'<[^>]*>','','g'))='' and draft.content not like '%<img %' then
 raise exception 'Write article content before publishing.' using errcode='22023'; end if;
 insert into public.published_articles(id,title,slug,excerpt,cover_url,content)
 values(draft.id,draft.title,draft.slug,draft.excerpt,draft.cover_url,draft.content)
 on conflict(id) do update set title=excluded.title,slug=excluded.slug,excerpt=excluded.excerpt,
 cover_url=excluded.cover_url,content=excluded.content,updated_at=now() returning * into published;
 return to_jsonb(published);
end $$;
revoke all on function public.publish_article(uuid,integer) from public,anon,authenticated;
grant execute on function public.publish_article(uuid,integer) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('article-images','article-images',true,2097152,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
