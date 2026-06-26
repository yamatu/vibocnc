# 环境变量配置指南

## 📋 概览

项目使用 **两个主要环境文件**：

| 文件 | 用途 | Git 追踪 |
|------|------|---------|
| `.env.local` | 本地开发环境 | ❌ 不追踪（`.gitignore`） |
| `.env.production` | 生产部署环境 | ✅ 追踪（模板） |
| `.env.example` | 配置示例模板 | ✅ 追踪 |

---

## 🚀 快速开始

### 本地开发设置

1. **复制示例文件**
   ```bash
   cp .env.example .env.local
   ```

2. **配置 PayPal Sandbox**
   编辑 `.env.local`，替换：
   ```bash
   NEXT_PUBLIC_PAYPAL_CLIENT_ID=YOUR_SANDBOX_CLIENT_ID_HERE
   ```

   获取 Sandbox Client ID：
   - 访问：https://developer.paypal.com/
   - Dashboard > Apps & Credentials > **Sandbox**
   - 创建应用并复制 Client ID

3. **启动开发服务器**
   ```bash
   npm run dev
   ```

---

## 📁 文件说明

### `.env.local` - 本地开发环境

**特点：**
- ✅ 用于本地开发
- ✅ 自动被 `.gitignore` 忽略
- ✅ 包含敏感信息（如 PayPal Client ID）
- ✅ 优先级最高

**关键配置：**
```bash
# API 地址指向本地后端
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8080

# PayPal 沙箱环境
NEXT_PUBLIC_PAYPAL_CLIENT_ID=AZXvP0Ia1Yv6hHxy...  # 你的沙箱 Client ID
NEXT_PUBLIC_PAYPAL_ENVIRONMENT=sandbox
```

---

### `.env.production` - 生产环境

**特点：**
- ✅ 用于生产部署
- ✅ 提交到 Git（作为模板）
- ⚠️ 生产环境的真实凭证应通过服务器环境变量设置

**关键配置：**
```bash
# API 地址指向生产后端
NEXT_PUBLIC_API_BASE_URL=https://www.vibocnc.com

# PayPal 生产环境
NEXT_PUBLIC_PAYPAL_CLIENT_ID=YOUR_LIVE_CLIENT_ID_HERE
NEXT_PUBLIC_PAYPAL_ENVIRONMENT=production
```

**🔒 安全提示：**
在生产服务器上，应该：
1. 创建 `.env.production.local`（不会被 Git 追踪）
2. 配置真实的生产凭证
3. 或通过服务器环境变量直接设置

---

### `.env.example` - 配置模板

**特点：**
- ✅ 提供所有可用变量的示例
- ✅ 帮助新开发者快速配置
- ✅ 不包含真实凭证

**用途：**
- 作为创建 `.env.local` 的模板
- 文档化所有可用的环境变量

---

## 🔧 变量详解

### 必需变量

#### 1. API Configuration
```bash
# 后端 API 地址
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8080
```

#### 2. Site Configuration
```bash
# 网站 URL
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# 网站名称
NEXT_PUBLIC_SITE_NAME=FANUC Parts Store

# 网站描述（用于 SEO）
NEXT_PUBLIC_SITE_DESCRIPTION=Professional FANUC Parts Sales
```

#### 3. PayPal Configuration
```bash
# PayPal Client ID
NEXT_PUBLIC_PAYPAL_CLIENT_ID=YOUR_CLIENT_ID_HERE

# 环境：sandbox（测试）或 production（生产）
NEXT_PUBLIC_PAYPAL_ENVIRONMENT=sandbox
```

---

### 可选变量

#### 上传配置
```bash
# 最大文件大小（字节）
NEXT_PUBLIC_MAX_FILE_SIZE=10485760  # 10MB

# 允许的文件类型
NEXT_PUBLIC_ALLOWED_FILE_TYPES=image/jpeg,image/png,image/webp
```

#### 分析工具
```bash
# Google Analytics
NEXT_PUBLIC_GA_TRACKING_ID=G-XXXXXXXXXX

# Facebook Pixel
NEXT_PUBLIC_FACEBOOK_PIXEL_ID=

# Google Search Console 验证
NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=
```

#### 公司信息
```bash
NEXT_PUBLIC_COMPANY_STREET=
NEXT_PUBLIC_COMPANY_CITY=Kunshan
NEXT_PUBLIC_COMPANY_REGION=Jiangsu
NEXT_PUBLIC_COMPANY_POSTAL_CODE=
NEXT_PUBLIC_COMPANY_COUNTRY_CODE=CN
NEXT_PUBLIC_COMPANY_PHONE=
NEXT_PUBLIC_COMPANY_EMAIL=
```

---

## 🌍 环境切换

### 开发环境
```bash
# Next.js 自动加载 .env.local
npm run dev
```

### 生产构建
```bash
# Next.js 自动加载 .env.production
npm run build
npm run start
```

### 手动指定环境
```bash
# 使用自定义环境文件
NODE_ENV=production npm run build
```

---

## 📝 最佳实践

### ✅ 推荐做法

1. **敏感信息不提交到 Git**
   - `.env.local` 已在 `.gitignore` 中
   - 永远不要提交真实的 API 密钥

2. **使用环境变量前缀**
   - 客户端变量必须以 `NEXT_PUBLIC_` 开头
   - 服务端变量不需要前缀

3. **区分环境**
   - 开发环境使用 Sandbox
   - 生产环境使用 Live

4. **文档化所有变量**
   - 在 `.env.example` 中记录所有变量
   - 添加注释说明用途

### ❌ 避免做法

1. **不要硬编码凭证**
   ```typescript
   // ❌ 错误
   const API_KEY = "sk_live_abc123...";

   // ✅ 正确
   const API_KEY = process.env.NEXT_PUBLIC_API_KEY;
   ```

2. **不要混用环境**
   ```bash
   # ❌ 错误：生产环境使用测试凭证
   NEXT_PUBLIC_PAYPAL_CLIENT_ID=sandbox_client_id
   NEXT_PUBLIC_PAYPAL_ENVIRONMENT=production
   ```

3. **不要忽略 `.env.example`**
   - 添加新变量时，更新 `.env.example`

---

## 🔍 故障排查

### 问题 1：环境变量未生效

**症状**：代码中读取不到环境变量

**解决方案**：
1. 检查变量名是否以 `NEXT_PUBLIC_` 开头（客户端变量）
2. 重启开发服务器（环境变量在服务器启动时加载）
3. 清除构建缓存：`rm -rf .next`

### 问题 2：PayPal 按钮不显示

**症状**：结账页面没有 PayPal 按钮

**解决方案**：
1. 检查 `.env.local` 中的 `NEXT_PUBLIC_PAYPAL_CLIENT_ID`
2. 确保值不是默认的 `YOUR_CLIENT_ID_HERE`
3. 打开浏览器控制台查看错误信息

### 问题 3：API 请求失败

**症状**：前端无法连接到后端

**解决方案**：
1. 检查 `NEXT_PUBLIC_API_BASE_URL` 是否正确
2. 确认后端服务已启动
3. 检查端口是否被占用

---

## 📚 相关资源

- **Next.js 环境变量文档**：https://nextjs.org/docs/app/building-your-application/configuring/environment-variables
- **PayPal 开发者文档**：https://developer.paypal.com/docs/
- **项目配置指南**：`../PAYPAL_SANDBOX_SETUP.md`

---

## 🆘 获取帮助

遇到问题？
1. 检查此文档的故障排查部分
2. 查看 `.env.example` 中的示例配置
3. 参考 `PAYPAL_SANDBOX_SETUP.md` 了解 PayPal 配置

---

**最后更新**：2025-01-10
