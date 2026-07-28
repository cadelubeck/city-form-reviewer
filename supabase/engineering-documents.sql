create table if not exists public.engineering_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) <= 240),
  document_type text not null check (document_type in (
    'city-standard', 'client-standard', 'manual', 'geotechnical-report',
    'environmental-report', 'seismic-source', 'water-table-source', 'flood-source', 'soil-source'
  )),
  jurisdiction text not null default '' check (char_length(jurisdiction) <= 180),
  client_id text,
  project_types text[] not null default '{}',
  effective_date date,
  original_name text,
  source_url text,
  extraction_status text not null default 'pending' check (extraction_status in ('pending', 'complete', 'failed')),
  detected_jurisdiction jsonb not null default '{}',
  project_scope text[] not null default '{}',
  requirements jsonb not null default '[]',
  openai_response_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.engineering_documents enable row level security;

create policy "Users read own engineering documents"
on public.engineering_documents for select to authenticated
using (auth.uid() = user_id);

create policy "Users create own engineering documents"
on public.engineering_documents for insert to authenticated
with check (auth.uid() = user_id);

create policy "Users update own engineering documents"
on public.engineering_documents for update to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users delete own engineering documents"
on public.engineering_documents for delete to authenticated
using (auth.uid() = user_id);

create index engineering_documents_user_updated_idx
on public.engineering_documents (user_id, updated_at desc);
