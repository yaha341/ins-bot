-- ===== Instagram Bot Schema =====

-- Rules table
create table if not exists ig_rules (
  id uuid primary key default gen_random_uuid(),
  media_id text not null,
  media_url text default '',
  media_title text default '',
  keywords text[] default '{}',
  dm_message text default '',
  dm_fail_reply text default '',
  comment_reply text default '',
  is_active boolean default true,
  created_at timestamptz default now()
);

-- Trigger log
create table if not exists ig_triggers (
  id uuid primary key default gen_random_uuid(),
  ig_rule_id uuid references ig_rules(id) on delete cascade,
  media_id text,
  comment_id text,
  comment_text text,
  sender_ig_id text,
  triggered_at timestamptz default now()
);

-- Processed comments (dedup)
create table if not exists ig_processed_comments (
  comment_id text primary key,
  processed_at timestamptz default now()
);

-- IG session + settings
create table if not exists ig_settings (
  id int primary key default 1,
  username text,
  session jsonb,        -- serialized instagram-private-api session
  is_connected boolean default false,
  last_poll timestamptz,
  last_error text,
  updated_at timestamptz default now()
);

insert into ig_settings (id) values (1) on conflict do nothing;