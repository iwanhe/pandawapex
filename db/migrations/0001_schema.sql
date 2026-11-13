-- =============================================================================
--  REPLICA APEX: metadata + runtime schema (migration 0001)
--  Target   : PostgreSQL 16+
--  Schemas  : rpx     = engine metadata & runtime (owned by role rpx_engine)
--             rpx_rt  = helper functions callable from user code (v(), set_item(), ...)
--  Style    : PANDAWA (lowercase, 3-space indent, leading commas)
--  Note     : "rpx" is a working name; rename after /replica-brand.
-- =============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid() (built-in on PG13+, kept for clarity)
create extension if not exists citext;     -- case-insensitive usernames / aliases

create schema if not exists rpx;
create schema if not exists rpx_rt;

set search_path = rpx, public;

-- -----------------------------------------------------------------------------
-- common: updated_at trigger
-- -----------------------------------------------------------------------------
create or replace function rpx.set_updated_at()
returns trigger
language plpgsql
as $$
begin
   new.updated_at := now();
   return new;
end;
$$;

-- =============================================================================
-- 1. WORKSPACE & USERS
-- =============================================================================
create table rpx.workspaces (
     id           uuid        primary key default gen_random_uuid()
   , name         citext      not null unique
   , db_role      text        not null unique          -- PG role that runs this workspace's user code
   , created_at   timestamptz not null default now()
   , updated_at   timestamptz not null default now()
   , constraint workspaces_db_role_chk check (db_role ~ '^[a-z][a-z0-9_]{2,62}$')
);

-- PG schemas a workspace may parse against (APEX: "workspace to schema assignment")
create table rpx.workspace_schemas (
     workspace_id uuid        not null references rpx.workspaces (id) on delete cascade
   , schema_name  text        not null
   , created_at   timestamptz not null default now()
   , primary key (workspace_id, schema_name)
);

-- developers / workspace admins (builder side)
create table rpx.dev_users (
     id           uuid        primary key default gen_random_uuid()
   , workspace_id uuid        not null references rpx.workspaces (id) on delete cascade
   , username     citext      not null
   , email        citext      not null
   , pwd_hash     text        not null                 -- argon2id
   , is_admin     boolean     not null default false
   , locked       boolean     not null default false
   , last_login   timestamptz
   , created_at   timestamptz not null default now()
   , updated_at   timestamptz not null default now()
   , unique (workspace_id, username)
);

-- end users (APEX accounts equivalent); OIDC users are auto-provisioned here too
create table rpx.app_users (
     id            uuid        primary key default gen_random_uuid()
   , workspace_id  uuid        not null references rpx.workspaces (id) on delete cascade
   , username      citext      not null
   , email         citext
   , pwd_hash      text                                -- null for OIDC-only users
   , oidc_issuer   text
   , oidc_subject  text
   , groups        text[]      not null default '{}'
   , locked        boolean     not null default false
   , failed_logins int         not null default 0
   , last_login    timestamptz
   , created_at    timestamptz not null default now()
   , updated_at    timestamptz not null default now()
   , unique (workspace_id, username)
   , unique (oidc_issuer, oidc_subject)
   , constraint app_users_cred_chk check (pwd_hash is not null or oidc_subject is not null)
);
create index on rpx.app_users using gin (groups);

-- =============================================================================
-- 2. APPLICATION & SHARED COMPONENTS
-- =============================================================================
create table rpx.applications (
     id              uuid        primary key default gen_random_uuid()
   , workspace_id    uuid        not null references rpx.workspaces (id) on delete cascade
   , alias           citext      not null
   , name            text        not null
   , version         text        not null default '1.0'
   , parsing_schema  text        not null
   , home_page_no    int         not null default 1
   , login_page_no   int         not null default 9999
   , session_timeout interval    not null default '8 hours'
   , idle_timeout    interval    not null default '1 hour'
   , ssp_enabled     boolean     not null default true   -- session state protection
   , substitutions   jsonb       not null default '{}'   -- {"COMPANY_NAME": "KCSI"}
   , globalization   jsonb       not null default '{}'   -- language, date format, timezone
   , spec_hash       text                                -- sha256 of last imported spec
   , created_at      timestamptz not null default now()
   , updated_at      timestamptz not null default now()
   , unique (workspace_id, alias)
   , foreign key (workspace_id, parsing_schema)
        references rpx.workspace_schemas (workspace_id, schema_name) on delete restrict
);

create table rpx.auth_schemes (
     id           uuid        primary key default gen_random_uuid()
   , app_id       uuid        not null references rpx.applications (id) on delete cascade
   , name         text        not null
   , scheme_type  text        not null
   , attributes   jsonb       not null default '{}'   -- oidc: issuer, client_id, secret_ref, scopes
   , is_current   boolean     not null default false
   , created_at   timestamptz not null default now()
   , updated_at   timestamptz not null default now()
   , unique (app_id, name)
   , constraint auth_schemes_type_chk
        check (scheme_type in ('builtin_accounts','oidc','http_header','custom_fn','no_auth'))
);
-- exactly one current scheme per app
create unique index auth_schemes_one_current on rpx.auth_schemes (app_id) where is_current;

create table rpx.authz_schemes (
     id           uuid        primary key default gen_random_uuid()
   , app_id       uuid        not null references rpx.applications (id) on delete cascade
   , name         text        not null
   , scheme_type  text        not null
   , source       text        not null                -- sql / plpgsql expr / group name
   , evaluation   text        not null default 'once_per_session'
   , error_msg    text        not null default 'Insufficient privileges.'
   , created_at   timestamptz not null default now()
   , updated_at   timestamptz not null default now()
   , unique (app_id, name)
   , constraint authz_schemes_type_chk
        check (scheme_type in ('exists_sql','not_exists_sql','fn_boolean','group_member'))
   , constraint authz_schemes_eval_chk
        check (evaluation in ('once_per_session','once_per_page_view','always'))
);

create table rpx.lovs (
     id           uuid        primary key default gen_random_uuid()
   , app_id       uuid        not null references rpx.applications (id) on delete cascade
   , name         text        not null
   , lov_type     text        not null
   , source       text                                 -- sql for lov_type = 'sql'
   , return_col   text
   , display_col  text
   , created_at   timestamptz not null default now()
   , updated_at   timestamptz not null default now()
   , unique (app_id, name)
   , constraint lovs_type_chk check (lov_type in ('static','sql'))
   , constraint lovs_sql_chk  check (lov_type = 'static' or source is not null)
);

create table rpx.lov_entries (
     id            uuid primary key default gen_random_uuid()
   , lov_id        uuid not null references rpx.lovs (id) on delete cascade
   , display_value text not null
   , return_value  text not null
   , seq           int  not null default 10
   , unique (lov_id, return_value)
);
create index on rpx.lov_entries (lov_id, seq);

create table rpx.nav_lists (
     id           uuid        primary key default gen_random_uuid()
   , app_id       uuid        not null references rpx.applications (id) on delete cascade
   , name         text        not null
   , created_at   timestamptz not null default now()
   , updated_at   timestamptz not null default now()
   , unique (app_id, name)
);

create table rpx.nav_entries (
     id              uuid primary key default gen_random_uuid()
   , list_id         uuid not null references rpx.nav_lists (id) on delete cascade
   , parent_id       uuid references rpx.nav_entries (id) on delete cascade
   , label           text not null
   , icon            text
   , target          jsonb not null                   -- {"page": 2} | {"url": "..."}
   , condition       jsonb
   , authz_scheme_id uuid references rpx.authz_schemes (id) on delete set null
   , seq             int  not null default 10
);
create index on rpx.nav_entries (list_id, parent_id, seq);
create index on rpx.nav_entries (authz_scheme_id);

-- =============================================================================
-- 3. PAGE & COMPONENTS
-- =============================================================================
create table rpx.pages (
     id              uuid        primary key default gen_random_uuid()
   , app_id          uuid        not null references rpx.applications (id) on delete cascade
   , page_no         int         not null
   , alias           citext
   , name            text        not null
   , page_mode       text        not null default 'normal'
   , requires_auth   boolean     not null default true
   , authz_scheme_id uuid        references rpx.authz_schemes (id) on delete set null
   , protection      text        not null default 'arguments_checksum'
   , template        text        not null default 'standard'
   , js_code         text
   , css_code        text
   , locked_by       uuid        references rpx.dev_users (id) on delete set null
   , created_at      timestamptz not null default now()
   , updated_at      timestamptz not null default now()
   , unique (app_id, page_no)
   , unique (app_id, alias)
   , constraint pages_mode_chk check (page_mode in ('normal','modal','non_modal'))
   , constraint pages_prot_chk check (protection in ('unrestricted','arguments_checksum','no_arguments','no_url_access'))
   , constraint pages_no_chk   check (page_no >= 0)
);
create index on rpx.pages (authz_scheme_id);

create table rpx.regions (
     id               uuid        primary key default gen_random_uuid()
   , page_id          uuid        not null references rpx.pages (id) on delete cascade
   , parent_region_id uuid        references rpx.regions (id) on delete cascade
   , name             text        not null
   , static_id        text        not null
   , region_type      text        not null
   , source_type      text
   , source           text                             -- table name | sql | plpgsql
   , slot             text        not null default 'body'
   , seq              int         not null default 10
   , grid             jsonb       not null default '{}' -- {"new_row":true,"col_span":12}
   , template         text        not null default 'standard'
   , attributes       jsonb       not null default '{}' -- per region_type
   , condition        jsonb
   , authz_scheme_id  uuid        references rpx.authz_schemes (id) on delete set null
   , created_at       timestamptz not null default now()
   , updated_at       timestamptz not null default now()
   , unique (page_id, static_id)
   , constraint regions_type_chk
        check (region_type in ('static','classic_report','interactive_report','interactive_grid'
                              ,'form','cards','chart','faceted_search','plsql_dynamic','breadcrumb','list'))
   , constraint regions_src_chk
        check (source_type is null or source_type in ('table','sql','plpgsql_fn'))
);
create index on rpx.regions (page_id, slot, seq);
create index on rpx.regions (parent_region_id);
create index on rpx.regions (authz_scheme_id);

create table rpx.region_columns (
     id            uuid  primary key default gen_random_uuid()
   , region_id     uuid  not null references rpx.regions (id) on delete cascade
   , name          text  not null                       -- column alias in the query
   , label         text  not null
   , data_type     text  not null default 'text'
   , format_mask   text
   , is_pk         boolean not null default false
   , hidden        boolean not null default false
   , sortable      boolean not null default true
   , searchable    boolean not null default true
   , link          jsonb                                -- {"page":3,"items":{"P3_ID":"#ID#"},"clear_cache":"3"}
   , escape_mode   text  not null default 'html'
   , seq           int   not null default 10
   , unique (region_id, name)
   , constraint region_columns_type_chk check (data_type in ('text','number','date','timestamp','boolean','clob','blob'))
   , constraint region_columns_esc_chk  check (escape_mode in ('html','none'))
);
create index on rpx.region_columns (region_id, seq);

-- items: page items (page_id not null) and application items (page_id null)
create table rpx.items (
     id               uuid        primary key default gen_random_uuid()
   , app_id           uuid        not null references rpx.applications (id) on delete cascade
   , page_id          uuid        references rpx.pages (id) on delete cascade
   , region_id        uuid        references rpx.regions (id) on delete cascade
   , name             text        not null
   , item_type        text        not null
   , label            text
   , seq              int         not null default 10
   , grid             jsonb       not null default '{}'
   , source           jsonb                             -- {"type":"db_column","column":"ENAME"} | {"type":"sql",...}
   , default_value    jsonb
   , lov_id           uuid        references rpx.lovs (id) on delete restrict
   , inline_lov       jsonb                             -- alternative to lov_id
   , cascade_parents  text[]      not null default '{}'
   , is_required      boolean     not null default false
   , format_mask      text
   , protection       text        not null default 'checksum_session'
   , attributes       jsonb       not null default '{}'
   , condition        jsonb
   , authz_scheme_id  uuid        references rpx.authz_schemes (id) on delete set null
   , created_at       timestamptz not null default now()
   , updated_at       timestamptz not null default now()
   , unique (app_id, name)                              -- item names are unique per app (like APEX)
   , constraint items_name_chk check (name ~ '^[A-Z][A-Z0-9_]{0,59}$')
   , constraint items_app_item_chk check (page_id is not null or region_id is null)
   , constraint items_type_chk
        check (item_type in ('text','number','textarea','date','datetime','select','popup_lov','radio'
                            ,'checkbox','switch','hidden','display_only','password','file','app_item'))
   , constraint items_prot_chk
        check (protection in ('unrestricted','checksum_app','checksum_user','checksum_session','restricted'))
);
create index on rpx.items (page_id, seq);
create index on rpx.items (region_id);
create index on rpx.items (lov_id);
create index on rpx.items (authz_scheme_id);

create table rpx.buttons (
     id              uuid        primary key default gen_random_uuid()
   , page_id         uuid        not null references rpx.pages (id) on delete cascade
   , region_id       uuid        references rpx.regions (id) on delete cascade
   , name            text        not null               -- becomes :REQUEST on submit
   , label           text        not null
   , action          text        not null default 'submit'
   , target          jsonb                             -- for redirect
   , is_hot          boolean     not null default false
   , position        text        not null default 'next'
   , confirm_msg     text
   , seq             int         not null default 10
   , condition       jsonb
   , authz_scheme_id uuid        references rpx.authz_schemes (id) on delete set null
   , unique (page_id, name)
   , constraint buttons_action_chk check (action in ('submit','redirect','defined_by_da','close_dialog'))
);
create index on rpx.buttons (region_id);
create index on rpx.buttons (authz_scheme_id);

-- processing points shared by computations / processes
create table rpx.computations (
     id           uuid primary key default gen_random_uuid()
   , app_id       uuid not null references rpx.applications (id) on delete cascade
   , page_id      uuid references rpx.pages (id) on delete cascade   -- null = application computation
   , item_name    text not null
   , point        text not null
   , comp_type    text not null
   , expression   text not null
   , seq          int  not null default 10
   , condition    jsonb
   , constraint computations_point_chk check (point in ('before_header','after_submit','on_new_session','after_authentication'))
   , constraint computations_type_chk  check (comp_type in ('static','item','sql_query','sql_expression','plpgsql_fn'))
);
create index on rpx.computations (app_id, page_id, point, seq);

create table rpx.validations (
     id               uuid primary key default gen_random_uuid()
   , page_id          uuid not null references rpx.pages (id) on delete cascade
   , region_id        uuid references rpx.regions (id) on delete cascade -- set for IG row validations
   , name             text not null
   , val_type         text not null
   , expression       text
   , error_msg        text not null
   , associated_item  text
   , when_button      text
   , seq              int  not null default 10
   , condition        jsonb
   , constraint validations_type_chk
        check (val_type in ('not_null','sql_exists','sql_not_exists','sql_expression','fn_returns_error','regex'))
);
create index on rpx.validations (page_id, seq);
create index on rpx.validations (region_id);

create table rpx.processes (
     id           uuid primary key default gen_random_uuid()
   , app_id       uuid not null references rpx.applications (id) on delete cascade
   , page_id      uuid references rpx.pages (id) on delete cascade        -- null = application process
   , region_id    uuid references rpx.regions (id) on delete cascade      -- form/ig dml target
   , name         text not null
   , point        text not null
   , proc_type    text not null
   , code         text
   , when_button  text
   , success_msg  text
   , error_msg    text
   , seq          int  not null default 10
   , condition    jsonb
   , constraint processes_point_chk
        check (point in ('before_header','after_submit','ajax_callback','on_new_session','after_authentication'))
   , constraint processes_type_chk
        check (proc_type in ('form_init','form_dml','ig_dml','plpgsql','clear_cache','close_dialog','send_mail'))
   , constraint processes_code_chk check (proc_type <> 'plpgsql' or code is not null)
);
create index on rpx.processes (app_id, page_id, point, seq);
create index on rpx.processes (region_id);

create table rpx.branches (
     id           uuid  primary key default gen_random_uuid()
   , page_id      uuid  not null references rpx.pages (id) on delete cascade
   , point        text  not null default 'after_submit'
   , target       jsonb not null                        -- {"page":1,"items":{...},"clear_cache":"2"}
   , when_button  text
   , seq          int   not null default 10
   , condition    jsonb
   , constraint branches_point_chk check (point in ('before_header','after_submit','after_processing'))
);
create index on rpx.branches (page_id, point, seq);

-- dynamic actions (Phase 2, modelled now so the spec format is stable)
create table rpx.dynamic_actions (
     id               uuid primary key default gen_random_uuid()
   , page_id          uuid not null references rpx.pages (id) on delete cascade
   , name             text not null
   , event            text not null
   , selection        jsonb not null                    -- {"items":["P2_DEPT"]} | {"button":"SAVE"} | {"region":"emp"}
   , client_condition jsonb
   , seq              int  not null default 10
   , constraint dynamic_actions_event_chk
        check (event in ('change','click','page_load','dialog_closed','key_release','custom'))
);
create index on rpx.dynamic_actions (page_id, seq);

create table rpx.da_actions (
     id              uuid    primary key default gen_random_uuid()
   , da_id           uuid    not null references rpx.dynamic_actions (id) on delete cascade
   , fire_when       boolean not null default true      -- true / false branch
   , action_type     text    not null
   , affected        jsonb
   , attributes      jsonb   not null default '{}'
   , items_to_submit text[]  not null default '{}'
   , items_to_return text[]  not null default '{}'
   , seq             int     not null default 10
   , constraint da_actions_type_chk
        check (action_type in ('set_value','show','hide','enable','disable','refresh','submit_page'
                              ,'execute_server_code','execute_js','confirm','clear','close_dialog'))
);
create index on rpx.da_actions (da_id, fire_when, seq);

-- spec import history (the YAML spec is the source of truth in Phase 1)
create table rpx.app_versions (
     id             uuid        primary key default gen_random_uuid()
   , app_id         uuid        not null references rpx.applications (id) on delete cascade
   , spec           text        not null
   , spec_hash      text        not null
   , engine_version text        not null
   , imported_by    text        not null
   , imported_at    timestamptz not null default now()
);
create index on rpx.app_versions (app_id, imported_at desc);

-- =============================================================================
-- 4. RUNTIME
-- =============================================================================
create table rpx.sessions (
     id             uuid        primary key default gen_random_uuid()
   , app_id         uuid        not null references rpx.applications (id) on delete cascade
   , app_user_id    uuid        references rpx.app_users (id) on delete cascade   -- null = public/guest session
   , username       text        not null default 'nobody'
   , csrf_token     text        not null default encode(gen_random_bytes(32), 'hex')
   , checksum_salt  bytea       not null default gen_random_bytes(32)
   , debug_level    smallint    not null default 0
   , authz_cache    jsonb       not null default '{}'   -- once_per_session results
   , created_at     timestamptz not null default now()
   , last_seen_at   timestamptz not null default now()
   , expires_at     timestamptz not null
   , constraint sessions_debug_chk check (debug_level between 0 and 9)
);
create index on rpx.sessions (app_user_id);
create index on rpx.sessions (expires_at);

create table rpx.session_state (
     session_id  uuid        not null references rpx.sessions (id) on delete cascade
   , item_name   text        not null
   , value       text
   , updated_at  timestamptz not null default now()
   , primary key (session_id, item_name)
);

create table rpx.collections (
     session_id      uuid  not null references rpx.sessions (id) on delete cascade
   , collection_name text  not null
   , seq             int   not null
   , data            jsonb not null default '{}'
   , primary key (session_id, collection_name, seq)
);

create table rpx.ir_saved_reports (
     id           uuid        primary key default gen_random_uuid()
   , region_id    uuid        not null references rpx.regions (id) on delete cascade
   , app_user_id  uuid        references rpx.app_users (id) on delete cascade    -- null = public report
   , name         text        not null
   , is_default   boolean     not null default false
   , settings     jsonb       not null default '{}'   -- filters, sorts, breaks, highlights, aggregates, visible columns
   , created_at   timestamptz not null default now()
   , updated_at   timestamptz not null default now()
);
create unique index ir_saved_reports_name_uq
   on rpx.ir_saved_reports (region_id, coalesce(app_user_id, '00000000-0000-0000-0000-000000000000'::uuid), name);
create unique index ir_saved_reports_default_uq
   on rpx.ir_saved_reports (region_id, coalesce(app_user_id, '00000000-0000-0000-0000-000000000000'::uuid)) where is_default;
create index on rpx.ir_saved_reports (app_user_id);

create table rpx.debug_messages (
     id           bigint      generated always as identity primary key
   , session_id   uuid        not null references rpx.sessions (id) on delete cascade
   , page_view_id uuid        not null
   , ts           timestamptz not null default clock_timestamp()
   , elapsed_ms   numeric(10,3)
   , level        smallint    not null default 4
   , component    text
   , message      text        not null
);
create index on rpx.debug_messages (page_view_id, id);
create index on rpx.debug_messages (session_id);
create index on rpx.debug_messages (ts);

create table rpx.activity_log (
     id           bigint      generated always as identity primary key
   , ts           timestamptz not null default now()
   , app_id       uuid        not null references rpx.applications (id) on delete cascade
   , page_no      int
   , request      text
   , session_id   uuid                                 -- no FK: log outlives the session
   , username     text
   , elapsed_ms   numeric(10,3)
   , error        text
);
create index on rpx.activity_log (app_id, ts desc);
create index on rpx.activity_log (ts);

-- updated_at triggers
do $$
declare
   l_tab text;
begin
   foreach l_tab in array array['workspaces','dev_users','app_users','applications','auth_schemes'
                               ,'authz_schemes','lovs','nav_lists','pages','regions','items','ir_saved_reports']
   loop
      execute format('create trigger %I_upd before update on rpx.%I for each row execute function rpx.set_updated_at()'
                    , l_tab, l_tab);
   end loop;
end;
$$;

-- =============================================================================
-- 5. RUNTIME CONTEXT FOR USER CODE (rpx_rt)
--    The engine runs every user SQL / PL/pgSQL block inside a transaction that
--    (1) SET LOCAL ROLE <workspace db_role>, (2) SET LOCAL search_path = <parsing schema>,
--    (3) rpx_rt.ctx_init(items, app_user, app_id, session) -> transaction-local GUCs.
--    User code reads items with v('P1_X') and writes with set_item('P1_X', val).
--    After the block the engine reads back rpx_rt.ctx_items() and stores changed items.
-- =============================================================================
create or replace function rpx_rt.ctx_init(
     p_items    jsonb
   , p_app_user text
   , p_app_id   text
   , p_session  text
)
returns void
language sql
as $$
   select set_config('rpx.items'   , coalesce(p_items, '{}'::jsonb)::text, true)
        , set_config('rpx.app_user', coalesce(p_app_user, 'nobody')     , true)
        , set_config('rpx.app_id'  , p_app_id                            , true)
        , set_config('rpx.session' , p_session                           , true);
$$;

create or replace function rpx_rt.ctx_items()
returns jsonb
language sql stable
as $$ select coalesce(nullif(current_setting('rpx.items', true), ''), '{}')::jsonb $$;

create or replace function rpx_rt.v(p_name text)
returns text
language sql stable
as $$ select rpx_rt.ctx_items() ->> upper(p_name) $$;

create or replace function rpx_rt.nv(p_name text)
returns numeric
language sql stable
as $$ select (rpx_rt.ctx_items() ->> upper(p_name))::numeric $$;

create or replace function rpx_rt.set_item(p_name text, p_value text)
returns void
language sql
as $$
   select set_config('rpx.items'
                    , jsonb_set(rpx_rt.ctx_items(), array[upper(p_name)], to_jsonb(p_value), true)::text
                    , true);
$$;

create or replace function rpx_rt.app_user()
returns text
language sql stable
as $$ select coalesce(nullif(current_setting('rpx.app_user', true), ''), 'nobody') $$;

create or replace function rpx_rt.app_id()
returns text
language sql stable
as $$ select current_setting('rpx.app_id', true) $$;

-- =============================================================================
-- 6. ROLES & GRANTS (data-layer access model)
--    rpx_engine   : the Node runtime connects as this; owns rpx.*
--    ws_<name>    : one NOLOGIN role per workspace; engine does SET LOCAL ROLE to it
--                   before running user code. It can use rpx_rt.* but never rpx.*.
-- =============================================================================
do $$
begin
   if not exists (select 1 from pg_roles where rolname = 'rpx_engine') then
      create role rpx_engine login;
   end if;
   if not exists (select 1 from pg_roles where rolname = 'rpx_user_code') then
      create role rpx_user_code nologin;   -- parent role for every ws_* role
   end if;
end;
$$;

revoke all on schema rpx from public;
grant usage on schema rpx to rpx_engine;
grant select, insert, update, delete on all tables in schema rpx to rpx_engine;
grant usage on all sequences in schema rpx to rpx_engine;

revoke all on schema rpx_rt from public;
grant usage on schema rpx_rt to rpx_engine, rpx_user_code;
grant execute on all functions in schema rpx_rt to rpx_engine, rpx_user_code;
-- per workspace (done by the engine's "create workspace" admin command):
--   create role ws_kdk nologin in role rpx_user_code;
--   grant ws_kdk to rpx_engine;            -- allows SET ROLE ws_kdk
--   grant usage on schema kdk_app to ws_kdk; grant select, insert, update, delete on all tables in schema kdk_app to ws_kdk;
