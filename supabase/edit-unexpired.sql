-- 修改权限：从「只能改当天发布的」改为「可以改未过期的」
--
-- 旧规则：published_on = current_date  —— 昨天发的但明天才交，今天就改不了了。
-- 新规则：只要这条作业还没过期，发布者/管理员就能改、能删，无论它是哪天发布的。
--
-- 「过期」怎么判定（与前端 board.js 的 isExpired 完全一致）：
--   1. 发布时被显式标记 expired = true —— 发布者自己判定作废，永久只读；
--   2. 有 due_date 且 due_date < 今天    —— 期限已过。
-- 两者取或。due_date 为 null 表示长期有效，不算过期。
--
-- 为什么不用 published_on = current_date 兜底：时光机看历史作业时，
-- 用户希望修正的是「还没交的那条」，而不是「今天发的那条」。

-- ---------- 判定函数 ----------

-- 单条作业现在可不可以改
create or replace function public.can_edit_homework(p_expired boolean, p_due_date date)
returns boolean
language sql
stable -- 用了 current_date，绝不能标 immutable（会被规划器当常量折叠掉）
as $$
  select not coalesce(p_expired, false)
     and (p_due_date is null or p_due_date >= current_date);
$$;

comment on function public.can_edit_homework(boolean, date) is
  '单条作业是否仍可修改：未被标记作废，且期限未过（与前端 isExpired 一致）';

-- ---------- 重写策略 ----------

drop policy if exists homeworks_update_today on public.homeworks;
drop policy if exists homeworks_delete_today on public.homeworks;
drop policy if exists homeworks_update_unexpired on public.homeworks;
drop policy if exists homeworks_delete_unexpired on public.homeworks;

create policy homeworks_update_unexpired on public.homeworks
  for update to authenticated
  using (public.can_edit_now() and public.can_edit_homework(expired, due_date))
  with check (public.can_edit_now() and public.can_edit_homework(expired, due_date));

create policy homeworks_delete_unexpired on public.homeworks
  for delete to authenticated
  using (public.can_edit_now() and public.can_edit_homework(expired, due_date));

-- publish_batches 没有「过期」概念，仍然只允许动当天那一批；
-- 改历史作业不需要写 batches（编辑器只 update homeworks 一行）。
drop policy if exists batches_update_today on public.publish_batches;
drop policy if exists batches_delete_today on public.publish_batches;

create policy batches_update_today on public.publish_batches
  for update to authenticated
  using (public.can_edit_now() and published_on = current_date)
  with check (public.can_edit_now() and published_on = current_date);

create policy batches_delete_today on public.publish_batches
  for delete to authenticated
  using (public.can_edit_now() and published_on = current_date);

-- ---------- 自检 ----------
select
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'homeworks'
      and policyname like 'homeworks_%unexpired') as unexpired_policies,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'homeworks'
      and policyname like '%_today') as leftover_today_policies,
  public.can_edit_homework(false, null)      as long_lived_ok,
  public.can_edit_homework(false, current_date) as due_today_ok,
  public.can_edit_homework(false, current_date - 1) as overdue_no,
  public.can_edit_homework(true, current_date + 7) as marked_expired_no;
