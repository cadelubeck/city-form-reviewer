create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) <= 220),
  client text not null default '' check (char_length(client) <= 180),
  location text not null default '' check (char_length(location) <= 220),
  status text not null default 'pending'
    check (status in ('pending', 'in_review', 'needs_updates', 'accepted', 'rejected')),
  priority text not null default '' check (priority in ('', 'low', 'medium', 'high')),
  assigned_to_id uuid references auth.users(id) on delete set null,
  assigned_to_name text,
  due_date date,
  original_name text,
  text_content text not null default '',
  detected_jurisdiction jsonb not null default '{}'::jsonb,
  project_scope text[] not null default '{}',
  extracted_requirements jsonb not null default '[]'::jsonb,
  sections jsonb not null default '[]'::jsonb,
  highlights jsonb not null default '[]'::jsonb,
  versions jsonb not null default '[]'::jsonb,
  compliance_review jsonb,
  diagram_analysis jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.proposals enable row level security;

drop policy if exists "Users can read proposals" on public.proposals;
create policy "Users can read proposals" on public.proposals
for select to authenticated using (auth.uid() = user_id or auth.uid() = assigned_to_id);

drop policy if exists "Users can create proposals" on public.proposals;
create policy "Users can create proposals" on public.proposals
for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users can update proposals" on public.proposals;
create policy "Users can update proposals" on public.proposals
for update to authenticated
using (auth.uid() = user_id or auth.uid() = assigned_to_id)
with check (auth.uid() = user_id or auth.uid() = assigned_to_id);

drop policy if exists "Users can delete proposals" on public.proposals;
create policy "Users can delete proposals" on public.proposals
for delete to authenticated using (auth.uid() = user_id);

drop trigger if exists proposals_set_updated_at on public.proposals;
create trigger proposals_set_updated_at before update on public.proposals
for each row execute function public.set_updated_at();

create index if not exists proposals_user_updated_idx
on public.proposals (user_id, updated_at desc);

create index if not exists proposals_assigned_updated_idx
on public.proposals (assigned_to_id, updated_at desc);
