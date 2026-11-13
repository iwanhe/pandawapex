-- 0003: an OIDC identity (issuer + subject) is unique per workspace, not globally:
-- the same KCSI employee may use apps in several workspaces.
alter table rpx.app_users drop constraint app_users_oidc_issuer_oidc_subject_key;
create unique index app_users_oidc_uq on rpx.app_users (workspace_id, oidc_issuer, oidc_subject)
   where oidc_subject is not null;
