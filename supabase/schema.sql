-- Personal Workbench cloud-sync schema
-- Safe to run more than once.

create table if not exists public.workbench_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  entity_type text not null check (entity_type in ('task', 'note', 'event', 'resource')),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create index if not exists workbench_items_user_type_updated_idx
  on public.workbench_items (user_id, entity_type, updated_at desc);

alter table public.workbench_items enable row level security;

revoke all on table public.workbench_items from anon;
grant select, insert, update, delete on table public.workbench_items to authenticated;

drop policy if exists "Users can read their own workbench items" on public.workbench_items;
create policy "Users can read their own workbench items"
  on public.workbench_items
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own workbench items" on public.workbench_items;
create policy "Users can insert their own workbench items"
  on public.workbench_items
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own workbench items" on public.workbench_items;
create policy "Users can update their own workbench items"
  on public.workbench_items
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own workbench items" on public.workbench_items;
create policy "Users can delete their own workbench items"
  on public.workbench_items
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
