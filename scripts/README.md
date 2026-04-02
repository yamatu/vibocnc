# FANUC Website SEO优化系统

这是一个完整的SEO优化系统，旨在将你的FANUC零件网站提升到与fanucworld.com相同的收录水平。

## 🚀 功能特性

### 1. 数据库结构优化
- 添加了20+个新字段来匹配fanucworld.com的数据结构
- 增强的产品信息：保修期、原产地、制造商、交货时间等
- 新增表格：产品评论、FAQ、标签、交叉引用等
- 性能索引优化，提升搜索和SEO性能

### 2. 自动内容优化
- 从fanucworld.com自动抓取对应产品信息
- 智能生成SEO友好的产品描述
- 自动优化meta标签（title, description, keywords）
- 基于产品型号模式生成技术规格

### 3. SEO结构增强
- XML sitemap优化（以 `/sitemap.xml` 为主入口）
- 产品URL SEO友好化：`/products/[sku]-[slug]`
- 结构化数据（Schema.org）增强
- robots.txt优化

### 4. 智能SEO评分系统
- 10维度SEO评分算法
- 内容质量自动评估
- 优化建议和自动修复

## 📁 文件结构

```
scripts/
├── run_optimization.py          # 主执行脚本
├── analyze_database.py          # 数据库分析工具
├── database_schema_optimizer.py # 数据库结构优化
├── fanuc_content_optimizer.py   # 内容优化爬虫
└── README.md                   # 说明文档

backend/
├── models/models.go            # 更新的数据模型
├── controllers/
│   ├── sitemap.go             # 优化的sitemap控制器
│   └── product_optimization.go # 产品优化API控制器

frontend/
├── src/app/
│   ├── products/[sku]-[slug]/  # SEO友好产品页面
│   ├── faq/                   # FAQ页面
│   └── robots.ts              # robots.txt优化
└── src/lib/structured-data.ts  # 结构化数据工具
```

## 🛠️ 安装和使用

### 前提条件
- Python 3.7+
- MySQL 8.0+
- Go 1.21+
- Node.js 18+

### 步骤1：运行主优化脚本

```bash
cd scripts
python run_optimization.py
```

这个脚本会自动：
1. 安装所需的Python依赖包
2. 分析当前数据库结构
3. 优化数据库schema
4. 从fanucworld.com抓取内容优化产品信息

### 步骤2：重启后端服务

```bash
cd backend
go run main.go
```

### 步骤3：重启前端开发服务器

```bash
cd frontend
npm run dev
```

## 📊 优化内容详解

### 数据库新增字段

**products表新增字段：**
- `warranty_period` - 保修期
- `condition_type` - 产品状态（新品/翻新/二手）
- `origin_country` - 原产地
- `manufacturer` - 制造商
- `lead_time` - 交货时间
- `minimum_order_quantity` - 最小订购量
- `packaging_info` - 包装信息
- `certifications` - 认证信息
- `technical_specs` - 技术规格（JSON）
- `compatibility_info` - 兼容性信息
- `installation_guide` - 安装指南
- `maintenance_tips` - 维护建议
- `related_products` - 相关产品（JSON）
- `video_urls` - 视频链接（JSON）
- `datasheet_url` - 数据表链接
- `manual_url` - 说明书链接
- `view_count` - 浏览次数
- `popularity_score` - 热度评分
- `seo_score` - SEO评分
- `last_optimized_at` - 最后优化时间

**新增表格：**
- `product_reviews` - 产品评论
- `product_faqs` - 产品FAQ
- `product_tags` - 产品标签
- `product_cross_references` - 产品交叉引用
- `seo_analytics` - SEO分析数据

### SEO优化算法

**SEO评分计算（满分5.0）：**
1. 产品名称质量 (1.0分)
2. 产品描述完整性 (2.0分)
3. Meta标题优化 (1.0分)
4. Meta描述优化 (1.0分)
5. 关键词设置 (0.5分)
6. 简短描述 (0.5分)
7. 产品图片 (1.0分)
8. 品牌型号信息 (1.0分)
9. 技术规格 (1.0分)
10. 附加内容 (1.0分)

### 内容抓取策略

**从fanucworld.com抓取的信息：**
- 产品标题和描述
- 技术规格和参数
- 产品分类信息
- SEO关键词
- 产品图片链接
- 兼容性信息

**智能内容生成：**
- 基于产品型号前缀自动识别产品类型
- 生成标准化的技术描述
- 自动添加应用场景说明
- 优化关键词密度

## 🎯 使用效果

### 预期SEO改进：
1. **搜索排名提升** - 更丰富的内容和更好的结构化数据
2. **收录数量增加** - 优化的sitemap和URL结构
3. **点击率提升** - 更好的meta标题和描述
4. **用户体验改善** - 更详细的产品信息和FAQ

### 性能优化：
1. **数据库查询优化** - 新增索引提升搜索性能
2. **Sitemap性能** - 分页和缓存优化
3. **内容加载优化** - 结构化数据提升爬虫效率

## 🔧 API端点

### 产品优化API

**单个产品优化：**
```
POST /api/v1/admin/products/optimize
{
  "product_id": 123,
  "force_update": false
}
```

**批量产品优化：**
```
POST /api/v1/admin/products/bulk-optimize
{
  "product_ids": [1, 2, 3],
  "category_id": 1,
  "limit": 50,
  "force_update": false
}
```

**优化状态查询：**
```
GET /api/v1/admin/products/optimization-status
```

## 📈 监控和维护

### 定期维护任务：
1. **每周运行内容优化** - 更新产品信息
2. **每月检查SEO评分** - 识别需要改进的产品
3. **季度性能分析** - 评估优化效果

### 监控指标：
- SEO评分平均值
- 优化产品数量
- 搜索引擎收录页面数
- 搜索流量增长

## 🚨 注意事项

1. **爬虫频率控制** - 已设置随机延迟避免被封IP
2. **数据库备份** - 运行优化前请备份数据库
3. **测试环境** - 建议先在测试环境运行
4. **内容版权** - 抓取的内容会进行重新整理，避免版权问题

## 🤝 技术支持

如果在使用过程中遇到问题：

1. 检查数据库连接配置
2. 确认Python依赖包已正确安装
3. 查看控制台输出的错误信息
4. 检查网络连接（用于内容抓取）

## 🎉 预期结果

使用这套优化系统后，你的网站将具备：

- ✅ 与fanucworld.com相同的数据结构
- ✅ 自动化的SEO内容优化
- ✅ 智能的产品信息管理
- ✅ 完善的搜索引擎支持
- ✅ 优秀的用户体验

通过这些改进，你的FANUC零件网站将在搜索引擎中获得更好的排名和更多的流量！