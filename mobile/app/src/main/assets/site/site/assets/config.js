/**
 * HomeworkShower 前端配置
 *
 * supabaseKey 用的是「可发布密钥」（publishable key），它只能做匿名/登录用户能做的事，
 * 真正的权限控制在后端 RLS 里，所以放在公开的 GitHub Pages 上是安全的。
 * 绝对不要把 service_role / secret key 放进这个文件。
 */
window.HOMEWORK_SHOWER_CONFIG = {
  supabaseUrl: "https://kmzcebxhewlihgqzfaqw.supabase.co",
  supabaseKey: "sb_publishable_woB0DFosxaxHE1101sjfHA_Bt0SJMxG",
  authStorageKey: "homeworkshower.auth.v1",
  siteName: "作业",
  // 申请管理员时邮件的收件人
  adminEmail: "wu__20111229@outlook.com",
};

