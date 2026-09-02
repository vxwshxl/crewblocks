-- CrewBlocks — database schema
-- =============================================================================
-- Run this once in your Supabase project's SQL editor (Dashboard → SQL Editor →
-- New query → paste → Run). It is idempotent: safe to re-run.
--
-- Table and column names deliberately keep the legacy `chatflow` naming so an
-- existing Supabase project works without migration. Everything user-facing in
-- the app says "agent". See CLAUDE.md.
--
-- Security model: the app talks to Supabase with the ANON key under the signed
-- in user's session, so every table has RLS enabled and access is scoped to
-- `auth.uid()`. Squad visibility is resolved through SECURITY DEFINER helper
-- functions so a policy never queries a table whose own policy queries back
-- into it (which Postgres would reject as infinite recursion).
-- =============================================================================

-- gen_random_uuid() lives in pgcrypto. Supabase usually has it; ensure it.
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER = bypass RLS, break the recursion cycle)
-- ----------------------------------------------------------------------------

-- Squads the current user belongs to.
create or replace function public.user_squad_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select squad_id from public.squad_members where user_id = auth.uid()
$$;

-- Is the current user the owner of the given squad?
create or replace function public.is_squad_owner(target_squad uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.squads
    where id = target_squad and owner_id = auth.uid()
  )
$$;

-- =============================================================================
-- Tables
-- =============================================================================

-- Agents. The whole block stack is stored in `data` as { version, blocks }.
create table if not exists public.chatflows (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null default 'New agent',
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chatflows_user_id_idx on public.chatflows(user_id);

-- Per-user provider API keys (e.g. Gemini). Table name is camelCase on purpose
-- to match the app; it must always be double-quoted in SQL.
create table if not exists public."apiKeys" (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  provider   text not null,
  name       text,
  key        text not null,
  created_at timestamptz not null default now()
);
create index if not exists apikeys_user_id_idx on public."apiKeys"(user_id);

-- Chat transcript for an agent run.
create table if not exists public.chat_history (
  id          uuid primary key default gen_random_uuid(),
  chatflow_id uuid not null references public.chatflows(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null,
  content     text,
  image_data  jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists chat_history_lookup_idx
  on public.chat_history(chatflow_id, user_id, created_at);

-- Long-term memory an agent has chosen to keep.
create table if not exists public.chatflow_memory (
  id          uuid primary key default gen_random_uuid(),
  chatflow_id uuid not null references public.chatflows(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  content     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists chatflow_memory_lookup_idx
  on public.chatflow_memory(chatflow_id, user_id, created_at);

-- A squad: a shared space several users can put agents into.
create table if not exists public.squads (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  is_public   boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists squads_owner_id_idx on public.squads(owner_id);

-- Squad membership.
create table if not exists public.squad_members (
  id         uuid primary key default gen_random_uuid(),
  squad_id   uuid not null references public.squads(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member',
  created_at timestamptz not null default now(),
  unique (squad_id, user_id)
);
create index if not exists squad_members_squad_idx on public.squad_members(squad_id);
create index if not exists squad_members_user_idx  on public.squad_members(user_id);

-- Which agents belong to which squad. The FK to chatflows is what lets the
-- extension's /models route embed `chatflows(...)` through this table.
create table if not exists public.squad_chatflows (
  id          uuid primary key default gen_random_uuid(),
  squad_id    uuid not null references public.squads(id) on delete cascade,
  chatflow_id uuid not null references public.chatflows(id) on delete cascade,
  added_by    uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (squad_id, chatflow_id)
);
create index if not exists squad_chatflows_squad_idx    on public.squad_chatflows(squad_id);
create index if not exists squad_chatflows_chatflow_idx on public.squad_chatflows(chatflow_id);

-- Community marketplace listings.
create table if not exists public.marketplace_workflows (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  description   text,
  category      text,
  price         numeric not null default 0,
  is_premium    boolean not null default false,
  icon          text,
  template_data jsonb,
  creator_name  text,
  rating        numeric not null default 0,
  reviews       integer not null default 0,
  installs      integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists marketplace_workflows_created_idx
  on public.marketplace_workflows(created_at desc);

-- One rating per user per listing.
create table if not exists public.marketplace_ratings (
  id          uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.marketplace_workflows(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  rating      integer not null check (rating between 1 and 5),
  created_at  timestamptz not null default now(),
  unique (workflow_id, user_id)
);
create index if not exists marketplace_ratings_workflow_idx
  on public.marketplace_ratings(workflow_id);

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table public.chatflows             enable row level security;
alter table public."apiKeys"             enable row level security;
alter table public.chat_history           enable row level security;
alter table public.chatflow_memory        enable row level security;
alter table public.squads                 enable row level security;
alter table public.squad_members          enable row level security;
alter table public.squad_chatflows        enable row level security;
alter table public.marketplace_workflows  enable row level security;
alter table public.marketplace_ratings    enable row level security;

-- Drop-then-create so the whole file is safely re-runnable.

-- chatflows: your own agents, plus any agent shared into a squad you are in.
drop policy if exists chatflows_select on public.chatflows;
create policy chatflows_select on public.chatflows for select
  using (
    user_id = auth.uid()
    or id in (
      select chatflow_id from public.squad_chatflows
      where squad_id in (select public.user_squad_ids())
    )
  );
drop policy if exists chatflows_insert on public.chatflows;
create policy chatflows_insert on public.chatflows for insert
  with check (user_id = auth.uid());
drop policy if exists chatflows_update on public.chatflows;
create policy chatflows_update on public.chatflows for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists chatflows_delete on public.chatflows;
create policy chatflows_delete on public.chatflows for delete
  using (user_id = auth.uid());

-- apiKeys: strictly your own.
drop policy if exists apikeys_all on public."apiKeys";
create policy apikeys_all on public."apiKeys" for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- chat_history: strictly your own.
drop policy if exists chat_history_all on public.chat_history;
create policy chat_history_all on public.chat_history for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- chatflow_memory: strictly your own.
drop policy if exists chatflow_memory_all on public.chatflow_memory;
create policy chatflow_memory_all on public.chatflow_memory for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- squads: public squads, squads you own, or squads you are a member of.
drop policy if exists squads_select on public.squads;
create policy squads_select on public.squads for select
  using (
    is_public
    or owner_id = auth.uid()
    or id in (select public.user_squad_ids())
  );
drop policy if exists squads_insert on public.squads;
create policy squads_insert on public.squads for insert
  with check (owner_id = auth.uid());
drop policy if exists squads_update on public.squads;
create policy squads_update on public.squads for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists squads_delete on public.squads;
create policy squads_delete on public.squads for delete
  using (owner_id = auth.uid());

-- squad_members: your own rows, plus co-members of squads you are in.
drop policy if exists squad_members_select on public.squad_members;
create policy squad_members_select on public.squad_members for select
  using (
    user_id = auth.uid()
    or squad_id in (select public.user_squad_ids())
  );
-- You add yourself; the squad owner may add anyone.
drop policy if exists squad_members_insert on public.squad_members;
create policy squad_members_insert on public.squad_members for insert
  with check (user_id = auth.uid() or public.is_squad_owner(squad_id));
-- You leave; the squad owner may remove anyone.
drop policy if exists squad_members_delete on public.squad_members;
create policy squad_members_delete on public.squad_members for delete
  using (user_id = auth.uid() or public.is_squad_owner(squad_id));

-- squad_chatflows: visible to members; a member adds; a member removes.
drop policy if exists squad_chatflows_select on public.squad_chatflows;
create policy squad_chatflows_select on public.squad_chatflows for select
  using (squad_id in (select public.user_squad_ids()));
drop policy if exists squad_chatflows_insert on public.squad_chatflows;
create policy squad_chatflows_insert on public.squad_chatflows for insert
  with check (
    added_by = auth.uid()
    and squad_id in (select public.user_squad_ids())
  );
drop policy if exists squad_chatflows_delete on public.squad_chatflows;
create policy squad_chatflows_delete on public.squad_chatflows for delete
  using (squad_id in (select public.user_squad_ids()));

-- marketplace_workflows: anyone can browse; only the creator can change/remove.
-- (Install-count and rating roll-ups on someone else's listing therefore won't
-- persist for non-owners. Add a SECURITY DEFINER RPC later if you need them to.)
drop policy if exists marketplace_workflows_select on public.marketplace_workflows;
create policy marketplace_workflows_select on public.marketplace_workflows for select
  using (true);
drop policy if exists marketplace_workflows_insert on public.marketplace_workflows;
create policy marketplace_workflows_insert on public.marketplace_workflows for insert
  with check (user_id = auth.uid());
drop policy if exists marketplace_workflows_update on public.marketplace_workflows;
create policy marketplace_workflows_update on public.marketplace_workflows for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists marketplace_workflows_delete on public.marketplace_workflows;
create policy marketplace_workflows_delete on public.marketplace_workflows for delete
  using (user_id = auth.uid());

-- marketplace_ratings: anyone can read; you manage only your own rating.
drop policy if exists marketplace_ratings_select on public.marketplace_ratings;
create policy marketplace_ratings_select on public.marketplace_ratings for select
  using (true);
drop policy if exists marketplace_ratings_write on public.marketplace_ratings;
create policy marketplace_ratings_write on public.marketplace_ratings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =============================================================================
-- Realtime — the block editor broadcasts presence + stack changes over a
-- channel and does not require table replication, but enabling it on chatflows
-- is harmless and lets you add row-level sync later.
-- =============================================================================
-- alter publication supabase_realtime add table public.chatflows;
