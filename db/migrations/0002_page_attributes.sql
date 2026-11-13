-- 0002: page title / breadcrumb and button styling, needed by the M1 runtime.
alter table rpx.pages   add column title      text;
alter table rpx.pages   add column attributes jsonb not null default '{}';   -- {"breadcrumb_parent": 1}
alter table rpx.buttons add column attributes jsonb not null default '{}';   -- {"style": "danger"}

-- tables created by later migrations stay readable/writable by the engine role
alter default privileges in schema rpx grant select, insert, update, delete on tables to rpx_engine;
alter default privileges in schema rpx grant usage on sequences to rpx_engine;
