-- M3: item types and validations added in the spec (checkbox group; function-body and type-check validations).
alter table rpx.items drop constraint items_type_chk;
alter table rpx.items add constraint items_type_chk
   check (item_type in ('text','number','textarea','date','datetime','select','popup_lov','radio'
                       ,'checkbox','checkbox_group','switch','hidden','display_only','password','file','app_item'));

alter table rpx.validations drop constraint validations_type_chk;
alter table rpx.validations add constraint validations_type_chk
   check (val_type in ('not_null','sql_exists','sql_not_exists','sql_expression','fn_boolean','fn_returns_error'
                      ,'regex','is_numeric','is_date','is_timestamp'));

-- shared LOV options (null display text)
alter table rpx.lovs add column attributes jsonb not null default '{}';
