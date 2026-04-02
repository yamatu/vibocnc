# 后端（Go / Gin）

该目录为后端 API 服务（Gin + GORM），提供：
- 鉴权（管理员/编辑/客户）
- 产品/分类/横幅/首页内容/公司信息等管理接口
- 订单/支付/优惠券/联系表单/工单/上传
- SEO：依赖前端提供的 `/sitemap.xml` 及其子 sitemap 入口

## ✅ 环境变量

1. 复制 `backend/.env.example` 为 `backend/.env`
2. 按需配置：
   - `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`（MySQL）
   - `JWT_SECRET`（生产环境务必替换强随机值）

## 🚀 本地启动

```bash
go run .
```

默认监听 `http://127.0.0.1:8080`（可通过 `HOST/PORT` 修改）。

## ⚠️ 默认管理员（重要）

- 开发环境：未配置 `SEED_DEFAULT_ADMIN` 时会自动创建默认管理员（密码兜底为 `admin123`，不会在日志输出明文）
- 生产环境：需要显式设置 `SEED_DEFAULT_ADMIN=true` 且提供 `DEFAULT_ADMIN_PASSWORD`
- 已存在管理员时默认不会重置密码；如需重置，设置 `RESET_DEFAULT_ADMIN_PASSWORD=true`
