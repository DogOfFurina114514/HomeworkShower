-- 作业附件（每条作业最多 2 个）
--
-- 为什么用独立的 attachments 表 + 数组列，而不是只往 content_html 里塞 <a>：
--   · 附件需要"下载/在线播放"这类语义，塞进富文本会跟正文混在一起；
--   · 删除作业时要连带删文件（存储桶里的对象），需要按 id 精确找到；
--   · 最多 2 个是硬约束，用数组长度约束在数据库层挡掉最省事。
--
-- 文件本体存 Supabase Storage 的 homework-attachments 桶（不占数据库额度），
-- 这里只存元数据：路径、文件名、MIME、字节数、时长（音频才有）。

-- ---------- 元数据表 ----------

create table if not exists public.homework_attachments (
  id bigserial primary key,
  homework_id bigint not null
    references public.homeworks (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  byte_size bigint not null default 0,
  -- 音频显示时长用（秒）；非音频为 null
  duration_seconds numeric(10, 2),
  slot_index smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint homework_attachments_slot_check check (slot_index >= 0 and slot_index < 2)
);

create index if not exists homework_attachments_homework_idx
  on public.homework_attachments (homework_id, slot_index);

comment on table public.homework_attachments is '作业附件元数据；文件本体在 Storage 的 homework-attachments 桶，每条作业最多 2 个';

-- ---------- 最多 2 个的硬约束 ----------
--
-- 用触发器而不是 check 约束：check 看不到"同组共几条"。
create or replace function public.homework_attachments_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  used integer;
begin
  select count(*) into used
  from public.homework_attachments
  where homework_id = new.homework_id
    and id is distinct from new.id;

  if used >= 2 then
    raise exception '每条作业最多 2 个附件'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists homework_attachments_limit on public.homework_attachments;
create trigger homework_attachments_limit
  before insert on public.homework_attachments
  for each row execute function public.homework_attachments_limit();

-- ---------- 行级安全 ----------

alter table public.homework_attachments enable row level security;

-- 读：与作业一致（能看作业就能看它的附件清单）
drop policy if exists homework_attachments_select on public.homework_attachments;
create policy homework_attachments_select on public.homework_attachments
  for select to anon, authenticated
  using (true);

-- 写：只有能改这条作业的人（发布者/管理员，且作业未过期）
drop policy if exists homework_attachments_insert on public.homework_attachments;
create policy homework_attachments_insert on public.homework_attachments
  for insert to authenticated
  with check (
    exists (
      select 1 from public.homeworks h
      where h.id = homework_id
        and public.can_edit_homework(h.expired, h.due_date)
    )
  );

drop policy if exists homework_attachments_update on public.homework_attachments;
create policy homework_attachments_update on public.homework_attachments
  for update to authenticated
  using (
    exists (
      select 1 from public.homeworks h
      where h.id = homework_id
        and public.can_edit_homework(h.expired, h.due_date)
    )
  );

drop policy if exists homework_attachments_delete on public.homework_attachments;
create policy homework_attachments_delete on public.homework_attachments
  for delete to authenticated
  using (
    exists (
      select 1 from public.homeworks h
      where h.id = homework_id
        and public.can_edit_homework(h.expired, h.due_date)
    )
  );

-- ---------- 取附件清单（前端只调这个） ----------

create or replace function public.list_attachments(p_ids bigint[])
returns table (
  id bigint,
  homework_id bigint,
  storage_path text,
  file_name text,
  mime_type text,
  byte_size bigint,
  duration_seconds numeric,
  slot_index smallint
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.homework_id, a.storage_path, a.file_name,
         a.mime_type, a.byte_size, a.duration_seconds, a.slot_index
  from public.homework_attachments a
  where a.homework_id = any(p_ids)
  order by a.homework_id, a.slot_index, a.id;
$$;

grant execute on function public.list_attachments(bigint[]) to anon, authenticated;

-- ---------- 附件桶 ----------
--
-- 与 homework-images 分开：附件的 MIME 范围大得多（音频/PDF/压缩包…），
-- 混在一个桶里不好单独设大小上限与清理策略。
insert into storage.buckets (id, name, public, file_size_limit)
values ('homework-attachments', 'homework-attachments', true, 26214400)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- 公开读；写要登录（细粒度限制交给表上的 RLS 与前端，桶这一层只挡匿名写）
drop policy if exists homework_attachments_read on storage.objects;
create policy homework_attachments_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'homework-attachments');

drop policy if exists homework_attachments_write on storage.objects;
create policy homework_attachments_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'homework-attachments');

drop policy if exists homework_attachments_remove on storage.objects;
create policy homework_attachments_remove on storage.objects
  for delete to authenticated
  using (bucket_id = 'homework-attachments');
