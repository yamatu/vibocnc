# 订单邮件通知（创建/付款）配置指南

目标：当客户下单（创建订单）或完成付款时，系统自动把通知邮件发到你配置的一个或多个管理员邮箱，邮件里包含：客户信息 + 购买的产品明细 + 金额 + 地址。

## 1. 拉取并更新代码

在服务器/本地仓库执行：

```bash
git pull
```

如果你是部署环境，请确保你部署的是最新的 `main` 分支代码。

## 2. 更新后端（让数据库自动增加字段）

后端使用 GORM AutoMigrate，会自动给 `email_settings` 表新增列（如果你没有禁用自动迁移）。

确认环境变量：

- `DB_AUTO_MIGRATE` 不要设置为 `false`

然后重启后端服务：

```bash
cd backend
go run main.go
```

生产环境请按你自己的方式重启（systemd/pm2/docker 等）。

## 3. 更新前端（让后台页面出现配置项）

你在后台 Email 页面看不到配置项，最常见原因是：前端没有重新构建/重启，还在跑旧的构建产物。

开发环境：

```bash
cd frontend
npm run dev
```

生产环境（Next.js）：

```bash
cd frontend
npm install
npm run build
npm run start
```

如果你用 Docker / PM2，请按对应方式重启前端容器/进程。

## 4. 在后台开启“订单邮件通知”

进入后台：

1) `Admin -> Email -> Settings`
2) 先配置发件邮箱（SMTP 或 Resend），并打开 `Enable Email`
3) 在 “Order Notifications” 区域：
   - 打开 `Notify on create`：订单创建就通知
   - 打开 `Notify on paid`：付款成功就通知
4) 在 `Order notification emails` 填写收件邮箱（支持多个）：

示例：

```
owner@yourdomain.com, sales@yourdomain.com
finance@yourdomain.com
```

5) 点击 `Save`

说明：收件邮箱支持用逗号 / 分号 / 换行分隔；系统会自动校验、去重、标准化。

## 5. 设置 SITE_URL（可选但推荐）

后端会在通知邮件里放“后台订单链接/订单追踪链接”。为了让链接是正确域名，建议设置：

- `SITE_URL=https://www.vibocnc.com`

不设置也能发邮件，只是链接可能根据请求头推断。

## 6. 验证是否生效

1) 客户下单（不付款）
   - 如果开启了 `Notify on create`，应该马上收到一封 “New order created ...” 的邮件
2) 客户付款成功
   - 如果开启了 `Notify on paid`，应该收到一封 “Order paid ...” 的邮件

如果没收到：

- 先用 `Admin -> Email -> Settings` 的 “Send test” 测试 SMTP/Resend 是否能正常发送
- 查看后端日志，关键字：`order notification:`
