create table if not exists public.team_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'reviewer' check (role in ('reviewer', 'manager', 'admin')),
  company_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_invites (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_at timestamptz not null default now()
);

alter table public.team_profiles enable row level security;
alter table public.company_invites enable row level security;

drop policy if exists "Authenticated users can view team profiles" on public.team_profiles;
create policy "Authenticated users can view team profiles" on public.team_profiles
for select to authenticated using (true);
drop policy if exists "Users can create own profile" on public.team_profiles;
create policy "Users can create own profile" on public.team_profiles
for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users can update own profile" on public.team_profiles;
create policy "Users can update own profile" on public.team_profiles
for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can view invites they created" on public.company_invites;
create policy "Users can view invites they created" on public.company_invites
for select to authenticated using (auth.uid() = inviter_id);
drop policy if exists "Users can create invites" on public.company_invites;
create policy "Users can create invites" on public.company_invites
for insert to authenticated with check (auth.uid() = inviter_id);
drop policy if exists "Users can update invites they created" on public.company_invites;
create policy "Users can update invites they created" on public.company_invites
for update to authenticated using (auth.uid() = inviter_id);

drop trigger if exists team_profiles_set_updated_at on public.team_profiles;
create trigger team_profiles_set_updated_at before update on public.team_profiles
for each row execute function public.set_updated_at();
