--------------------------------------------------------------------------------
-- Data dummy untuk sandbox (port dari database/seed/01_demo_data.sql). Jangan dipakai di produksi.
-- Aman dijalankan ulang: hanya mengisi bila tabel masih kosong.
--------------------------------------------------------------------------------
set search_path = apx_demo, public;

insert into apx_demo_departments (dept_code, dept_name) values
     ('FIN', 'Finance')
   , ('OPS', 'Operations')
   , ('IT' , 'Information Technology')
on conflict (dept_code) do nothing;

insert into apx_demo_items (item_code, item_name, category, uom, std_price) values
     ('ATK-001', 'Kertas A4 80gsm', 'ATK'       , 'RIM' , 55000)
   , ('ATK-002', 'Pulpen Hitam'   , 'ATK'       , 'BOX' , 30000)
   , ('IT-001' , 'Laptop 14 inch' , 'IT'        , 'UNIT', 12500000)
   , ('IT-002' , 'Mouse Wireless' , 'IT'        , 'UNIT', 150000)
   , ('CON-001', 'Toner Printer'  , 'CONSUMABLE', 'PCS' , 450000)
on conflict (item_code) do nothing;

do $$
declare
   l_ops bigint;
   l_it  bigint;
   l_req bigint;
begin
   if exists (select 1 from apx_demo_requests) then
      return;
   end if;
   select department_id into l_ops from apx_demo_departments where dept_code = 'OPS';
   select department_id into l_it  from apx_demo_departments where dept_code = 'IT';

   -- Draft kecil (< 10 jt): approval Manager saja
   insert into apx_demo_requests (department_id, request_date, need_date, purpose)
   values (l_ops, current_date, current_date + 7, 'ATK kantor bulan ini')
   returning request_id into l_req;
   insert into apx_demo_request_lines (request_id, item_id, qty, unit_price)
   select l_req, item_id, v.qty, std_price
     from (values ('ATK-001', 20), ('ATK-002', 5)) as v(code, qty)
     join apx_demo_items on item_code = v.code;

   -- Draft besar (> 10 jt): approval Manager lalu Director
   insert into apx_demo_requests (department_id, request_date, need_date, purpose)
   values (l_it, current_date, current_date + 14, 'Laptop karyawan baru')
   returning request_id into l_req;
   insert into apx_demo_request_lines (request_id, item_id, qty, unit_price)
   select l_req, item_id, v.qty, std_price
     from (values ('IT-001', 2), ('IT-002', 2)) as v(code, qty)
     join apx_demo_items on item_code = v.code;
end $$;

-- User aplikasi dan role-nya (username = akun login pandawapex, huruf besar).
-- Dengan baris ADMIN di sini mode bootstrap mati: user tanpa role tidak bisa masuk.
insert into apx_demo_user_roles (username, role_code) values
     ('ADMIN', 'ADMIN')
   , ('BUDI' , 'REQUESTER')
   , ('SARI' , 'MANAGER')
   , ('DODI' , 'DIRECTOR')
   , ('GUDANG', 'WAREHOUSE')
on conflict (username, role_code) do nothing;
