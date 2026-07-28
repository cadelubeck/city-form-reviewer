-- Run this migration once for existing City Form Reviewer Supabase projects.
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (char_length(event_type) <= 80),
  endpoint text check (endpoint is null or char_length(endpoint) <= 300),
  method text check (method is null or method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  status_code integer check (status_code is null or status_code between 0 and 599),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.usage_events enable row level security;

drop policy if exists "Users can read their own usage" on public.usage_events;
create policy "Users can read their own usage"
on public.usage_events for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can record their own usage" on public.usage_events;
create policy "Users can record their own usage"
on public.usage_events for insert
to authenticated
with check (auth.uid() = user_id);

create index if not exists usage_events_user_created_idx
on public.usage_events (user_id, created_at desc);
