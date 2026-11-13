-- B1: builder sign-in. Developers belong to a workspace (rpx.dev_users, from 0001); their sessions live apart from
-- application sessions, and a failed-login counter locks an account after repeated wrong passwords.
alter table rpx.dev_users add column failed_logins int not null default 0;

create table rpx.dev_sessions (
     id            uuid        primary key default gen_random_uuid()
   , dev_user_id   uuid        not null references rpx.dev_users (id) on delete cascade
   , csrf_token    text        not null default encode(gen_random_bytes(32), 'hex')
   , created_at    timestamptz not null default now()
   , last_seen_at  timestamptz not null default now()
   , expires_at    timestamptz not null
   , flash         jsonb                                -- one message shown on the next page (post/redirect/get)
);
create index on rpx.dev_sessions (dev_user_id);
create index on rpx.dev_sessions (expires_at);
