# HEYDAY Demo Deployment

这个项目是浏览器端 demo，可以部署成长期 HTTPS 链接给客户查看。当前版本使用浏览器 `localStorage` 保存 demo 数据，适合演示流程，不适合作为正式生产系统保存真实客户文件。

## 推荐方式：Vercel

1. 打开 https://vercel.com 并登录。
2. 新建 Project。
3. 上传或导入这个项目文件夹。
4. Framework Preset 选择 `Other`。
5. Build Command 留空。
6. Output Directory 填 `.`。
7. Deploy。

部署完成后，Vercel 会生成类似下面的长期链接：

```text
https://heyday-workflow-demo.vercel.app
```

后续可以在 Vercel 的 Project Settings 里改项目名称，链接也会更像正式 demo。

## 备选方式：Netlify

1. 打开 https://app.netlify.com/drop。
2. 把整个 HEYDAY 项目文件夹拖进去。
3. Netlify 会生成一个 HTTPS 预览链接。
4. 登录 Netlify 后可以把站点名称改成更专业的名字。

## 给客户看的说明

建议发送链接时附上这句话：

```text
This is a workflow demo for HEYDAY. It shows the manager, employee, client upload, review, billing, and payment process. The current demo data is stored in the browser for presentation only.
```

## 正式上线前需要升级

- 登录系统和权限控制
- PostgreSQL 数据库
- 私有文件存储，例如 S3
- 真实邮件发送，例如 Resend / SendGrid
- 真实账单或付款系统，例如 QuickBooks / Stripe
