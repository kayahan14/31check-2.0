create table if not exists public.messages (
  id text primary key,
  scope_key text not null,
  channel_id text not null,
  author_name text not null,
  avatar_label text not null default '',
  avatar_url text not null default '',
  content text not null,
  message_type text not null default 'text',
  created_at timestamptz not null,
  created_at_ms bigint not null,
  server_created_at timestamptz not null,
  server_created_at_ms bigint not null
);

create index if not exists messages_scope_channel_server_created_idx
  on public.messages (scope_key, channel_id, server_created_at_ms desc);

create index if not exists messages_scope_server_created_idx
  on public.messages (scope_key, server_created_at_ms desc);
