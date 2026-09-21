# HomeworkShower

StickyHomeworks2 的网页端：同学打开网页就能看到作业。后端用 Supabase（免费计划），前端是纯静态页面，部署在 GitHub Pages。

- 站点目录：`docs/`（GitHub Pages 从这里发布）
- 数据库脚本：`supabase/schema.sql`
- 手机端：把 `docs/` 里的页面用 WebView 内置一份即可（不依赖网络加载静态资源，页面自带依赖）

## 功能

| 页面 | 说明 |
| --- | --- |
| `docs/index.html` | 作业看板。顶部只有日期选择与个人中心，没有应用栏和编辑按钮；按「发布日期」查看每天的作业 |
| `docs/login.html` | 登录 / 注册（邮箱 + 密码，注册后需点开验证邮件） |
| `docs/publish.html` | 发布作业（仅发布者 / 管理员）。导入桌面端导出的 JSON，选择归属日期；同一天重复发布会覆盖 |

作业只有登录用户可见（后端 RLS 控制，匿名密钥读不到任何数据）。

## 角色

三种角色存在 `public.profiles.role`：

- `user`：只能看（注册后的默认角色）
- `publisher`：可以发布作业
- `admin`：可以发布作业，并且能改别人的角色

注册后角色是 `user`。要给某人升权，用 SQL 改一行即可：

```sql
update public.profiles set role = 'publisher' where email = 'someone@example.com';
update public.profiles set role = 'admin'     where email = 'someone@example.com';
```

## 数据是怎么进后端的

1. 桌面端 StickyHomeworks2：右下角编辑按钮 → **保存作业** → 选 **JSON 数据**，得到形如 `作业-20260921-2027.json` 的文件；
2. 打开 `publish.html`，选择这份 JSON，选好它归属的日期，点发布；
3. 后端把这份 JSON 整份写进那一天（同一天重复发布会先删掉当天的旧记录）。

JSON 里每条作业都会被保存：科目、正文（纯文本 + 富文本）、标签、期限、是否过期。

## 存储超限怎么办

免费计划的数据库容量有限。`publish_homeworks()` 每次发布会调用 `prune_old_homeworks()`：当本应用的数据量超过预算（默认 300 MB）时，**按日期从最旧的一天开始整天删除**，直到降回预算以内。

预算在 `supabase/schema.sql` 的函数默认值里，改这个数字即可：

```sql
create or replace function public.prune_old_homeworks(p_max_bytes bigint default 314572800)
```

想手动清理或查看当前占用：

```sql
select public.prune_old_homeworks();          -- 按默认预算清理
select sum(row_bytes) from public.homeworks;  -- 当前占用（字节）
```

## 部署

### 1. 数据库

在 Supabase 项目的 SQL Editor 里整段执行 `supabase/schema.sql`（幂等，可重复执行）。

### 2. 登录与邮件

- Authentication → Providers → Email：开启，并保持 **Confirm email** 打开（这样注册后必须验证邮箱）；
- Authentication → URL Configuration：`Site URL` 填 Pages 地址（例如 `https://dogofurina114514.github.io/HomeworkShower/`），`Redirect URLs` 加入同一个地址；
- 想用自己的发信人（而不是 Supabase 内置发信服务，它每小时只能发几封）：Authentication → Emails → SMTP Settings 填自己的 SMTP，并把 Sender name 设成 `HomeworkShower`；
- 邮件模板：把 `supabase/email-templates/` 下的内容分别贴进 Authentication → Emails 对应的模板里。模板里 `<!--PLAINTEXT-->` 标记的那一段是给不支持 HTML 的客户端看的纯文本版，正常客户端会把它隐藏掉。

### 3. 前端

仓库 Settings → Pages → Source 选 `Deploy from a branch`，分支 `main`、目录 **`/docs`**。

前端配置在 `docs/assets/config.js`：只有 Supabase 项目地址和 **publishable key**（可公开的密钥）。**不要把 service_role / secret key 放进去**——真正的权限控制在后端 RLS。

## 本地预览

```bash
cd docs && python -m http.server 8080
```

然后打开 http://localhost:8080/ 。直接双击 `index.html` 用 `file://` 打开会因为没有 http 源而无法登录，请用上面的方式起一个本地服务。
