-- Dynamic actions: two more browser actions, focus (move the cursor to an item) and alert (show a message).
alter table rpx.da_actions drop constraint da_actions_type_chk;
alter table rpx.da_actions add constraint da_actions_type_chk check (action_type in (
   'set_value', 'show', 'hide', 'enable', 'disable', 'refresh', 'submit_page', 'execute_server_code', 'execute_js',
   'confirm', 'clear', 'close_dialog', 'focus', 'alert'));
