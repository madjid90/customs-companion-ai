-- Lexical links between pages and ten-digit HS codes. A mention is evidence
-- of co-occurrence only; it is never an applicability or tariff assertion.
create table public.source_page_hs_mentions (
  source_page_id uuid not null references public.source_pages(id) on delete cascade,
  code text not null check (code ~ '^[0-9]{10}$'),
  extraction_method text not null default 'exact_10_digit_text',
  created_at timestamptz not null default now(),
  primary key (source_page_id, code)
);
create index source_page_hs_mentions_code_idx on public.source_page_hs_mentions(code);
alter table public.source_page_hs_mentions enable row level security;
grant select on public.source_page_hs_mentions to authenticated;
create policy source_page_hs_mentions_read on public.source_page_hs_mentions
  for select to authenticated using (
    exists (select 1 from public.source_pages p where p.id = source_page_id)
  );

create or replace function private.refresh_source_page_hs_mentions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.source_page_hs_mentions where source_page_id = new.id;
  if new.review_status <> 'rejected' then
    insert into public.source_page_hs_mentions(source_page_id,code)
    select new.id, matches.code
    from (
      select distinct (regexp_matches(new.text_content,
        '(^|[^0-9])([0-9]{10})([^0-9]|$)', 'g'))[2] as code
    ) matches
    where left(matches.code,2)::integer between 1 and 97
    limit 100
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.refresh_source_page_hs_mentions() from public, anon, authenticated;
create trigger source_page_hs_mentions_refresh
after insert or update of text_content,review_status on public.source_pages
for each row execute function private.refresh_source_page_hs_mentions();

insert into public.source_page_hs_mentions(source_page_id,code)
select p.id, matches.code
from public.source_pages p
cross join lateral (
  select distinct (regexp_matches(p.text_content,
    '(^|[^0-9])([0-9]{10})([^0-9]|$)', 'g'))[2] as code
) matches
where p.review_status <> 'rejected'
  and left(matches.code,2)::integer between 1 and 97
on conflict do nothing;
