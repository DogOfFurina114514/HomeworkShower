-- 放开读取：未登录也能看作业看板
--
--   读取（homeworks / publish_batches）：anon + authenticated 都可以
--   写入：仍然严格受限（发布=发布者，修改=发布者/管理员且仅当天）
--
-- 注意：这意味着拿到站点地址的人都能看到作业内容，属于有意为之的产品决定。

drop policy if exists homeworks_select on public.homeworks;
create policy homeworks_select on public.homeworks
  for select to anon, authenticated using (true);

drop policy if exists batches_select on public.publish_batches;
create policy batches_select on public.publish_batches
  for select to anon, authenticated using (true);
