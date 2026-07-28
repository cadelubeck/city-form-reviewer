-- Durable, company-scoped engineering records.
-- Run after schema.sql, engineering-documents.sql, proposals.sql, and team.sql.

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.companies enable row level security;

alter table public.team_profiles add column if not exists company_id uuid references public.companies(id);
alter table public.company_invites add column if not exists company_id uuid references public.companies(id);
alter table public.proposals add column if not exists company_id uuid references public.companies(id);
alter table public.proposals add column if not exists file_path text;
alter table public.proposals add column if not exists page_reviews jsonb not null default '[]'::jsonb;
alter table public.proposals add column if not exists archived_at timestamptz;
alter table public.engineering_documents add column if not exists company_id uuid references public.companies(id);
alter table public.engineering_documents add column if not exists source_url text;
alter table public.engineering_documents add column if not exists file_path text;
alter table public.engineering_documents add column if not exists archived_at timestamptz;

insert into public.companies (name, created_by)
select coalesce(nullif(profile.company_name, ''), split_part(profile.email, '@', 2), 'Engineering company'), profile.user_id
from public.team_profiles profile
where profile.company_id is null
  and not exists (select 1 from public.companies company where company.created_by = profile.user_id);

update public.team_profiles profile
set company_id = company.id
from public.companies company
where profile.company_id is null and company.created_by = profile.user_id;

update public.proposals proposal
set company_id = profile.company_id
from public.team_profiles profile
where proposal.company_id is null and proposal.user_id = profile.user_id;

update public.engineering_documents document
set company_id = profile.company_id
from public.team_profiles profile
where document.company_id is null and document.user_id = profile.user_id;

create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.team_profiles where user_id = auth.uid()
$$;

revoke all on function public.current_company_id() from public;
grant execute on function public.current_company_id() to authenticated;

drop policy if exists "Company members can view company" on public.companies;
create policy "Company members can view company" on public.companies
for select to authenticated using (id = public.current_company_id() or created_by = auth.uid());
drop policy if exists "Users can create company" on public.companies;
create policy "Users can create company" on public.companies
for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "Company admins can update company" on public.companies;
create policy "Company admins can update company" on public.companies
for update to authenticated using (
  id = public.current_company_id()
  and exists (
    select 1 from public.team_profiles
    where user_id = auth.uid() and role in ('manager', 'admin')
  )
);

drop policy if exists "Authenticated users can view team profiles" on public.team_profiles;
create policy "Company members can view team profiles" on public.team_profiles
for select to authenticated using (
  user_id = auth.uid() or company_id = public.current_company_id()
);

drop policy if exists "Users can view invites they created" on public.company_invites;
create policy "Company can view invites" on public.company_invites
for select to authenticated using (
  company_id = public.current_company_id()
  or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

drop policy if exists "Users can create invites" on public.company_invites;
create policy "Company can create invites" on public.company_invites
for insert to authenticated with check (
  inviter_id = auth.uid() and company_id = public.current_company_id()
);

drop policy if exists "Users can update invites they created" on public.company_invites;
create policy "Invite parties can update invites" on public.company_invites
for update to authenticated using (
  inviter_id = auth.uid() or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

drop policy if exists "Users can read proposals" on public.proposals;
create policy "Company can read proposals" on public.proposals
for select to authenticated using (company_id = public.current_company_id());
drop policy if exists "Users can create proposals" on public.proposals;
create policy "Company can create proposals" on public.proposals
for insert to authenticated with check (
  user_id = auth.uid() and company_id = public.current_company_id()
);
drop policy if exists "Users can update proposals" on public.proposals;
create policy "Company can update proposals" on public.proposals
for update to authenticated
using (company_id = public.current_company_id())
with check (company_id = public.current_company_id());
drop policy if exists "Users can delete proposals" on public.proposals;

drop policy if exists "Users read own engineering documents" on public.engineering_documents;
create policy "Company can read engineering documents" on public.engineering_documents
for select to authenticated using (company_id = public.current_company_id());
drop policy if exists "Users create own engineering documents" on public.engineering_documents;
create policy "Company can create engineering documents" on public.engineering_documents
for insert to authenticated with check (
  user_id = auth.uid() and company_id = public.current_company_id()
);
drop policy if exists "Users update own engineering documents" on public.engineering_documents;
create policy "Company can update engineering documents" on public.engineering_documents
for update to authenticated
using (company_id = public.current_company_id())
with check (company_id = public.current_company_id());
drop policy if exists "Users delete own engineering documents" on public.engineering_documents;

create table if not exists public.proposal_history (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete restrict,
  company_id uuid not null references public.companies(id),
  actor_id uuid not null references auth.users(id),
  event_type text not null,
  status text,
  summary text not null default '',
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.proposal_history enable row level security;
drop policy if exists "Company can read proposal history" on public.proposal_history;
create policy "Company can read proposal history" on public.proposal_history
for select to authenticated using (company_id = public.current_company_id());
drop policy if exists "Company can append proposal history" on public.proposal_history;
create policy "Company can append proposal history" on public.proposal_history
for insert to authenticated with check (
  actor_id = auth.uid() and company_id = public.current_company_id()
);

create index if not exists proposals_company_updated_idx
on public.proposals (company_id, archived_at, updated_at desc);
create index if not exists proposal_history_proposal_created_idx
on public.proposal_history (proposal_id, created_at desc);
create index if not exists engineering_documents_company_updated_idx
on public.engineering_documents (company_id, updated_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proposal-files', 'proposal-files', false, 52428800, array['application/pdf', 'text/plain'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Reviewers can read proposal files" on storage.objects;
create policy "Reviewers can read proposal files"
on storage.objects for select to authenticated
using (
  bucket_id = 'proposal-files'
  and (storage.foldername(name))[1] = public.current_company_id()::text
);

drop policy if exists "Users can upload their proposal files" on storage.objects;
create policy "Users can upload their proposal files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'proposal-files'
  and (storage.foldername(name))[1] = public.current_company_id()::text
);

drop policy if exists "Users can update their proposal files" on storage.objects;
drop policy if exists "Users can delete their proposal files" on storage.objects;
