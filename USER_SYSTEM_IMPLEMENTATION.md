# 用户登录注册系统实现指南

## ✅ 已完成的后端部分

### 1. 数据库模型

#### ✅ Customer Model (`backend/models/customer.go`)
- 用户注册、登录、个人资料
- 地址信息
- 账号状态管理

#### ✅ Ticket Model (`backend/models/ticket.go`)
- 工单系统（客户支持）
- 工单回复
- 工单附件

### 2. 后端控制器

#### ✅ Customer Controller (`backend/controllers/customer.go`)
- `POST /api/v1/customer/register` - 用户注册
- `POST /api/v1/customer/login` - 用户登录
- `GET /api/v1/customer/profile` - 获取个人资料
- `PUT /api/v1/customer/profile` - 更新个人资料
- `POST /api/v1/customer/change-password` - 修改密码

#### ✅ Ticket Controller (`backend/controllers/ticket.go`)
- `POST /api/v1/customer/tickets` - 创建工单
- `GET /api/v1/customer/tickets` - 获取我的工单
- `GET /api/v1/customer/tickets/:id` - 工单详情
- `POST /api/v1/customer/tickets/:id/reply` - 回复工单

#### ✅ Customer Orders (`backend/controllers/customer_orders.go`)
- `GET /api/v1/customer/orders` - 获取我的订单
- `GET /api/v1/customer/orders/:id` - 订单详情

### 3. JWT认证

#### ✅ Utils (`backend/utils/auth.go`)
- `GenerateCustomerJWT()` - 生成客户token
- `ValidateCustomerToken()` - 验证客户token

#### ✅ Middleware (`backend/middleware/auth.go`)
- `CustomerAuthMiddleware()` - 客户认证中间件

### 4. 路由配置

#### ✅ Routes (`backend/routes/routes.go`)
已添加所有客户相关路由

---

## 📋 需要完成的前端部分

### 第1步：创建前端服务层

文件位置：`frontend/src/services/customer.service.ts`

```typescript
import { apiClient } from '@/lib/api';
import { APIResponse } from '@/types';

export interface Customer {
  id: number;
  email: string;
  full_name: string;
  phone?: string;
  company?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postal_code?: string;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  full_name: string;
  phone?: string;
  company?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  customer: Customer;
}

export class CustomerService {
  // 注册
  static async register(data: RegisterRequest): Promise<LoginResponse> {
    const response = await apiClient.post<APIResponse<LoginResponse>>(
      '/customer/register',
      data
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Registration failed');
  }

  // 登录
  static async login(data: LoginRequest): Promise<LoginResponse> {
    const response = await apiClient.post<APIResponse<LoginResponse>>(
      '/customer/login',
      data
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Login failed');
  }

  // 获取个人资料
  static async getProfile(): Promise<Customer> {
    const response = await apiClient.get<APIResponse<Customer>>(
      '/customer/profile'
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error('Failed to fetch profile');
  }

  // 更新个人资料
  static async updateProfile(data: Partial<Customer>): Promise<Customer> {
    const response = await apiClient.put<APIResponse<Customer>>(
      '/customer/profile',
      data
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error('Failed to update profile');
  }

  // 修改密码
  static async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    const response = await apiClient.post<APIResponse<void>>(
      '/customer/change-password',
      { old_password: oldPassword, new_password: newPassword }
    );
    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to change password');
    }
  }

  // 获取我的订单
  static async getMyOrders(params?: { status?: string }): Promise<any[]> {
    const response = await apiClient.get<APIResponse<any[]>>(
      '/customer/orders',
      { params }
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    return [];
  }

  // 获取订单详情
  static async getOrderDetails(orderId: number): Promise<any> {
    const response = await apiClient.get<APIResponse<any>>(
      `/customer/orders/${orderId}`
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error('Order not found');
  }
}
```

### 第2步：创建用户状态管理

文件位置：`frontend/src/store/auth.store.ts`

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import Cookies from 'js-cookie';
import { Customer } from '@/services/customer.service';

interface AuthState {
  customer: Customer | null;
  token: string | null;
  isAuthenticated: boolean;
  setAuth: (customer: Customer, token: string) => void;
  clearAuth: () => void;
  updateCustomer: (customer: Customer) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      customer: null,
      token: null,
      isAuthenticated: false,

      setAuth: (customer, token) => {
        Cookies.set('customer_token', token, { expires: 7 }); // 7 days
        set({ customer, token, isAuthenticated: true });
      },

      clearAuth: () => {
        Cookies.remove('customer_token');
        set({ customer: null, token: null, isAuthenticated: false });
      },

      updateCustomer: (customer) => {
        set({ customer });
      },
    }),
    {
      name: 'auth-storage',
    }
  )
);
```

### 第3步：更新API配置添加token

文件位置：`frontend/src/lib/api.ts`（修改）

在请求拦截器中添加客户token：

```typescript
// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    // Admin token
    const adminToken = Cookies.get('auth_token');
    if (adminToken) {
      config.headers.Authorization = `Bearer ${adminToken}`;
    }

    // Customer token (优先级高于admin token)
    const customerToken = Cookies.get('customer_token');
    if (customerToken) {
      config.headers.Authorization = `Bearer ${customerToken}`;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);
```

---

## 🚀 快速启动步骤

### 1. 启动后端并运行数据库迁移

```bash
cd backend
go run main.go
```

后端会自动创建新的表：
- `customers` - 客户表
- `tickets` - 工单表
- `ticket_replies` - 工单回复表
- `ticket_attachments` - 工单附件表

### 2. 启动前端

```bash
cd frontend
npm run dev
```

### 3. 测试注册

访问：http://localhost:3000/register

填写信息并注册，后端会返回token。

---

## 📝 接下来需要创建的页面

### 1. 注册页面
`frontend/src/app/register/page.tsx`

### 2. 登录页面
`frontend/src/app/login/page.tsx`

### 3. 用户中心
`frontend/src/app/account/page.tsx`
- 个人资料
- 我的订单
- 工单管理
- 密码修改

### 4. 修改结账页面
添加登录检查，未登录用户跳转到登录页

### 5. 修改主页
添加"注册"和"登录"按钮

---

## 🔐 安全要点

1. **Token存储**：使用httpOnly cookies（生产环境）
2. **密码强度**：后端已强制最小6位
3. **邮箱验证**：可选功能，后续添加
4. **Session过期**：客户token默认7天

---

## 📞 联系方式显示

在用户中心和工单页面显示公司联系方式，从`company_profile`表获取。

---

**下一步：我将为你创建所有前端页面代码。**

准备好了吗？我可以继续创建前端文件。
