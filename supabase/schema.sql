create extension if not exists pgcrypto;

create type public.review_status as enum ('draft', 'in_review', 'approved', 'needs_revision');
create type public.risk_level as enum ('low', 'medium', 'high');

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  city text not null check (char_length(city) <= 140),
  permit_type text not null check (char_length(permit_type) <= 180),
  applicant text not null check (char_length(applicant) <= 180),
  notes text not null check (char_length(notes) <= 5000),
  risk_level public.risk_level not null default 'medium',
  status public.review_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reviews enable row level security;

create policy "Users can read their own reviews"
on public.reviews for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can create their own reviews"
on public.reviews for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own reviews"
on public.reviews for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own reviews"
on public.reviews for delete
to authenticated
using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger reviews_set_updated_at
before update on public.reviews
for each row
execute function public.set_updated_at();

create index reviews_user_updated_idx on public.reviews (user_id, updated_at desc);
