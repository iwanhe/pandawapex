-- 0004: an authorization scheme for the whole application, checked on every page
-- (in addition to page / region / item / button / menu schemes).
alter table rpx.applications add column authz_scheme_id uuid references rpx.authz_schemes (id) on delete set null;
create index on rpx.applications (authz_scheme_id);
