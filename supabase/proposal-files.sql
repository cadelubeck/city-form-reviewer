alter table public.proposals
  add column if not exists file_path text,
  add column if not exists page_reviews jsonb not null default '[]'::jsonb;

alter table public.engineering_documents
  add column if not exists source_url text,
  add column if not exists file_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'proposal-files',
  'proposal-files',
  false,
  52428800,
  array['application/pdf', 'text/plain']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Reviewers can read proposal files" on storage.objects;
create policy "Reviewers can read proposal files"
on storage.objects for select to authenticated
using (
  bucket_id = 'proposal-files'
  and exists (
    select 1
    from public.proposals
    where proposals.file_path = storage.objects.name
      and (proposals.user_id = auth.uid() or proposals.assigned_to_id = auth.uid())
  )
);

drop policy if exists "Users can upload their proposal files" on storage.objects;
create policy "Users can upload their proposal files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'proposal-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update their proposal files" on storage.objects;
create policy "Users can update their proposal files"
on storage.objects for update to authenticated
using (
  bucket_id = 'proposal-files'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'proposal-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can delete their proposal files" on storage.objects;
create policy "Users can delete their proposal files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'proposal-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);
