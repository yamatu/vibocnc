# PayPal 沙箱环境对接指南

## 📌 概述
本指南将帮助你完成 FANUC Parts Store 的 PayPal 沙箱支付集成测试。

---

## 🚀 第一步：创建 PayPal 开发者账号

### 1. 访问 PayPal 开发者网站
🔗 访问：https://developer.paypal.com/

### 2. 登录或注册
- **有 PayPal 账号**：直接使用现有账号登录
- **没有账号**：点击 "Sign Up" 注册新的 PayPal 账号

---

## 🔑 第二步：获取沙箱 API 凭证

### 1. 创建沙箱应用

1. 登录后，点击顶部的 **"Dashboard"**
2. 左侧菜单选择 **"Apps & Credentials"**
3. **重要**：确保顶部切换到 **"Sandbox"** 标签页（不是 Live）
4. 点击蓝色按钮 **"Create App"**

### 2. 填写应用信息

- **App Name**: `FANUC Parts Store Sandbox`
- **App Type**: 选择 **Merchant**
- 点击 **"Create App"**

### 3. 复制 API 凭证

应用创建后，你会看到以下信息：

```
┌─────────────────────────────────────────────┐
│ Client ID                                   │
│ AXXXXXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx        │  ← 复制这个
│                                             │
│ Secret                          [Show]      │  ← 点击 Show 后复制
│ EXXXXXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx        │
└─────────────────────────────────────────────┘
```

**保存这两个值！稍后需要用到。**

---

## 👥 第三步：获取沙箱测试账号

### 1. 查看测试账号

1. 左侧菜单点击 **"Sandbox" > "Accounts"**
2. PayPal 自动创建了两个测试账号：

| 类型 | 用途 | 邮箱格式 |
|------|------|----------|
| **Business** | 商家账号（接收付款） | `sb-xxxxx@business.example.com` |
| **Personal** | 买家账号（测试支付） | `sb-xxxxx@personal.example.com` |

### 2. 查看账号密码

1. 点击账号后面的 **"..."** 按钮
2. 选择 **"View/Edit Account"**
3. 记录以下信息：
   - **Email Address**（登录邮箱）
   - **System Generated Password**（密码）

---

## ⚙️ 第四步：配置项目环境变量

### 1. 配置前端

打开 `frontend/.env.local` 文件，替换以下内容：

```bash
# PayPal Configuration (for testing)
NEXT_PUBLIC_PAYPAL_CLIENT_ID=YOUR_SANDBOX_CLIENT_ID_HERE  # ← 替换为你的 Client ID
NEXT_PUBLIC_PAYPAL_ENVIRONMENT=sandbox

# Basic configuration
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8080
```

**示例（实际的 Client ID）：**
```bash
NEXT_PUBLIC_PAYPAL_CLIENT_ID=AZXvP0Ia1Yv6hHxy9mJKsW8rz7...
NEXT_PUBLIC_PAYPAL_ENVIRONMENT=sandbox
```

### 2. 重启前端服务器

```bash
cd frontend
npm run dev
```

---

## 🧪 第五步：测试 PayPal 支付流程

### 1. 启动项目

确保前后端都已启动：

```bash
# 终端 1：启动后端
cd backend
go run main.go
# 或
./fanuc-backend

# 终端 2：启动前端
cd frontend
npm run dev
```

### 2. 测试支付流程

#### Step 1: 添加商品到购物车
1. 访问 http://localhost:3000
2. 浏览产品并添加到购物车
3. 点击购物车图标

#### Step 2: 进入结账页面
1. 点击 "Checkout" 按钮
2. 填写配送信息：
   - **姓名**: Test User
   - **邮箱**: test@example.com
   - **地址**: 123 Test St
   - **城市**: Test City
   - **国家**: United States
   - **邮编**: 12345

#### Step 3: 使用 PayPal 沙箱支付
1. 点击 PayPal 支付按钮（黄色按钮）
2. 会弹出 PayPal 沙箱登录窗口
3. 使用**买家测试账号**登录：
   - **Email**: `sb-xxxxx@personal.example.com`（你的 Personal 测试账号）
   - **Password**: 系统生成的密码
4. 确认支付信息
5. 点击 "Complete Purchase" 或 "Pay Now"

#### Step 4: 验证支付成功
- 支付完成后会跳转回你的网站
- 应该看到订单确认页面
- 订单状态应为 "Confirmed" 或 "Paid"

---

## 🔍 第六步：验证沙箱交易

### 在 PayPal 开发者网站查看交易

1. 访问 https://developer.paypal.com/
2. 点击 **"Sandbox" > "Accounts"**
3. 点击 **Business 账号**后面的 **"..."**
4. 选择 **"View Sandbox Dashboard"**
5. 你会看到测试交易记录

---

## 🧰 常见问题排查

### 问题 1：PayPal 按钮不显示

**原因**：Client ID 未配置或无效

**解决方案**：
1. 检查 `.env.local` 中的 `NEXT_PUBLIC_PAYPAL_CLIENT_ID`
2. 确保已重启前端服务器
3. 打开浏览器控制台，查看是否有 PayPal SDK 加载错误

### 问题 2：支付后跳转失败

**原因**：回调 URL 配置问题

**解决方案**：
检查代码中的 `onSuccess` 和 `onError` 回调函数是否正确处理。

### 问题 3：支付金额不正确

**原因**：金额格式问题

**解决方案**：
确保传递给 PayPal 的金额是正确的格式（字符串，保留两位小数）。

### 问题 4："Instrument declined" 错误

**原因**：沙箱测试账号余额不足

**解决方案**：
1. 访问 **Sandbox > Accounts**
2. 点击买家账号的 **"..."** > **"View/Edit Account"**
3. 在 **"Funding"** 部分增加余额

---

## 📝 沙箱测试卡信息

如果需要测试信用卡支付（虽然当前配置禁用了卡支付），可以使用：

| 卡类型 | 卡号 | 过期日期 | CVV |
|--------|------|----------|-----|
| Visa | 4032 0339 7146 3150 | 任意未来日期 | 任意3位数 |
| MasterCard | 5425 2334 3010 9903 | 任意未来日期 | 任意3位数 |

---

## 🎯 测试检查清单

使用此清单确保 PayPal 集成正常：

- [ ] ✅ 已创建 PayPal 开发者账号
- [ ] ✅ 已创建沙箱应用并获取 Client ID
- [ ] ✅ 已记录沙箱测试账号的邮箱和密码
- [ ] ✅ 已在 `.env.local` 配置 Client ID
- [ ] ✅ 已重启前端服务器
- [ ] ✅ PayPal 按钮在结账页面正常显示
- [ ] ✅ 可以使用测试账号登录 PayPal
- [ ] ✅ 可以完成测试支付
- [ ] ✅ 支付成功后正确跳转
- [ ] ✅ 订单状态正确更新
- [ ] ✅ 可以在 PayPal Dashboard 看到交易记录

---

## 🚀 从沙箱切换到生产环境

当你准备上线时，需要：

1. **获取生产环境凭证**：
   - 在 PayPal Developer Dashboard 切换到 **"Live"** 标签
   - 创建生产应用
   - 获取生产环境的 Client ID 和 Secret

2. **更新环境变量**（`.env.production`）：
   ```bash
   NEXT_PUBLIC_PAYPAL_CLIENT_ID=YOUR_LIVE_CLIENT_ID
   NEXT_PUBLIC_PAYPAL_ENVIRONMENT=production
   ```

3. **完成商家账号审核**：
   - PayPal 需要审核你的商家账号
   - 提供必要的业务信息和文档

4. **测试生产环境**：
   - 使用小额真实交易测试
   - 确认资金正确到账

---

## 📞 获取帮助

- **PayPal 开发者文档**: https://developer.paypal.com/docs/
- **PayPal 技术支持**: https://developer.paypal.com/support/
- **项目相关问题**: 查看项目的 GitHub Issues

---

## 📄 相关文件

- **前端配置**: `frontend/.env.local`
- **PayPal 组件**: `frontend/src/components/checkout/PayPalCheckout.tsx`
- **结账页面**: `frontend/src/app/checkout/page.tsx`
- **订单模型**: `backend/models/order.go`

---

**祝测试顺利！** 🎉
