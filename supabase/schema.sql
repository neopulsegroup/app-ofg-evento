-- OFG Recife 2026 · esquema Postgres (executar no Supabase: SQL Editor > New query > Run)
-- Todo o acesso é feito pela API (service role). RLS ativo e sem políticas = clientes anónimos não leem nada.

create table if not exists users (
  id text primary key,
  name text not null,
  email text not null unique,
  company text not null default '',
  role text not null default '',
  linkedin text not null default '',
  pass text,
  fails int not null default 0,
  lock_until bigint not null default 0,
  interests text[] not null default '{}',
  favorites text[] not null default '{}',
  push_subs jsonb not null default '[]',
  checkins jsonb not null default '{}',
  points int not null default 0,
  sent int not null default 0,
  created_at bigint not null
);
create table if not exists tokens (token text primary key, user_id text not null references users(id) on delete cascade);
create table if not exists connections (
  id text primary key,
  from_id text not null references users(id) on delete cascade,
  to_id text not null references users(id) on delete cascade,
  status text not null default 'pending',
  at bigint not null,
  unique (from_id, to_id)
);
create table if not exists messages (
  id text primary key,
  pair text not null,               -- ids ordenados "a:b"
  from_id text not null references users(id) on delete cascade,
  to_id text not null references users(id) on delete cascade,
  text text not null,
  at bigint not null
);
create index if not exists messages_pair_at on messages (pair, at);
create table if not exists announcements (id text primary key, title text not null, body text not null default '', kind text not null default 'info', at bigint not null);
create table if not exists notifications (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  kind text not null, title text not null, body text not null default '',
  session_id text, from_user text, at bigint not null
);
create index if not exists notifications_user_at on notifications (user_id, at desc);
create table if not exists polls (id text primary key, session_id text not null default '', question text not null, options jsonb not null, open boolean not null default true, at bigint not null);
create table if not exists poll_votes (poll_id text references polls(id) on delete cascade, user_id text references users(id) on delete cascade, option int not null, primary key (poll_id, user_id));
create table if not exists questions (id text primary key, session_id text not null, user_id text not null references users(id) on delete cascade, text text not null, anonymous boolean not null default false, at bigint not null);
create table if not exists question_votes (question_id text references questions(id) on delete cascade, user_id text references users(id) on delete cascade, primary key (question_id, user_id));
-- chave/valor: PINs de recuperação, lembretes já enviados, marca de leitura de notificações
create table if not exists kv (key text primary key, value jsonb not null);

alter table users enable row level security;
alter table tokens enable row level security;
alter table connections enable row level security;
alter table messages enable row level security;
alter table announcements enable row level security;
alter table notifications enable row level security;
alter table polls enable row level security;
alter table poll_votes enable row level security;
alter table questions enable row level security;
alter table question_votes enable row level security;
alter table kv enable row level security;

-- incrementos atómicos (evita ler-e-gravar pontos em paralelo)
create or replace function add_points(uid text, n int) returns void language sql as $$ update users set points = points + n where id = uid $$;
revoke all on function add_points(text, int) from public, anon, authenticated;
alter table users add column if not exists is_admin boolean not null default false;
alter table users add column if not exists phone text not null default '';
alter table announcements add column if not exists audience text not null default 'all', add column if not exists recipient_ids text[] not null default '{}';

-- foto de perfil (URL pública no bucket 'avatars' do Storage)
alter table users add column if not exists photo text not null default '';
