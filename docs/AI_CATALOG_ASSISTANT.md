# AI 商品分类与 SEO 助手

后台右下角的「AI 优化」按钮提供受控的目录优化对话：它可以分析商品归类、修正错误分类，并生成商品或分类的多语言 SEO 内容。分类建议只能指向现有启用分类。

## 配置

不需要把 AI Provider、API Key 或模型写进 `.env`。登录管理员后台后，进入左侧 **AI 助手** 页面，依次设置并保存：

1. 是否启用 AI 助手；
2. API Base URL（默认 `https://api.openai.com/v1`）；
3. API Key；
4. 模型预设（GPT-5.6 Sol / Terra / Luna）或自定义兼容模型；
5. 推理强度（`none`、`low`、`medium`、`high`、`xhigh`、`max`），或兼容模式。

设置写入数据库。API Key 使用项目已有 AES-GCM 加密机制保存，任何 API 和浏览器页面只返回“是否已保存”，从不返回 Key 内容。生产 Docker 部署仍需要保持已有的 `SETTINGS_ENCRYPTION_KEY`，它是用于加密后台所有敏感设置的主密钥，不是 AI 配置。

接口使用标准的 OpenAI-compatible **Chat Completions** 形状：`POST {base_url}/chat/completions`，携带 Bearer Key。因此，如果供应商兼容该接口，只需在后台页面修改 Base URL 和模型名。

GPT-5.6 在 Chat Completions 中使用 `reasoning_effort`。兼容 Provider 如不支持该参数，请选择“兼容模式”，后端不会发送该字段。这里没有把 Pro 模式伪装成一个下拉选项：GPT-5.6 Pro 需要 Responses API，不能安全地通过当前 Chat Completions 接口实现。

没有配置时，点击窗口会引导管理员前往 AI 助手配置页面，但不会尝试从浏览器访问任何 AI 服务。

## 使用方式

1. 登录后台（admin 或 editor），点击右下角 **AI 优化**。
2. 输入 SKU、商品名称或分类目标。例如：
   - `检查 SKU A06B-XXXX 的分类是否正确，并优化英文、中文 SEO`
   - `为 FANUC 伺服驱动分类生成中文、德语 SEO 内容`
   - `检查这类 I/O 模块是否有合适的现有分类；没有则不要创建分类，返回待人工审核`
3. AI 会列出可展开的建议卡，卡内可查看目标分类、分类匹配依据、meta title、meta description、keywords 和语言版本内容。
4. 逐项点 **应用**，或在同一轮建议中点 **确认并应用本轮全部建议**。

如果现有分类树没有能够同时证明品牌和产品类型的节点，AI 会返回待人工审核；自动流程不会新建分类或把商品移入通用兜底分类。

## 按型号填写售价并修改价格

AI 不会估算、联网查询、换算或自行修改产品价格。若需要通过助手批量匹配改价，请在右下角 AI 对话中明确填写 **型号 = 售价**，例如：

```text
请按以下管理员价格表生成改价建议，只能使用我提供的售价：
A06B-6114-H209 = 1280.00 USD
A06B-6079-H206 = 960.50 USD
```

系统会为每一条返回可审核的“商品售价修改”卡片，显示商品编号、匹配型号、当前售价和新售价。点击 **应用** 或 **确认并应用本轮全部建议** 后才会真正写入数据库。

后端会再次验证：

1. `matching_model` 必须与当前商品的型号、料号或 SKU 精确匹配（忽略大小写和普通空格）；
2. `sale_price` 必须由管理员输入，且为非负、最多两位小数、在数据库价格范围内的金额；
3. 不匹配、缺少售价、格式不合法或 AI 自行推测的价格都会被拒绝。

价格更新成功后会刷新商品缓存、触发前端重新验证；若已启用 IndexNow 自动提交，也会把已修改的商品 URL 合并提交。

单轮对话最多返回并可在一个事务中应用 30 条建议；价格表超过 30 个型号时，请分批粘贴，便于逐批核对。

## 当前页 AI SEO 批量优化

当目录有几万条商品时，不应把全部商品一次性交给模型。产品列表现在提供单独的紫色 **AI SEO 优化（当前页已选）** 操作：

1. 在 `/admin/products` 的当前页手动勾选需要处理的商品；
2. 每个任务最多选择 **30,000** 条，输入本次自定义 SEO 提示词；
3. 系统为每个商品分别请求 AI，异步校正默认产品名称，并更新原创的产品长描述、`short description`、`meta title`、`meta description` 和 `meta keywords`；
4. AI 会收到完整的现有启用分类目录：必须优先按已核实的品牌、产品类型和型号族选择现有叶子分类。没有同时满足这些条件的现有分类时，返回待人工审核，不能创建分类，也不能把商品移入通用兜底分类。名称、描述和分类只能依据商品已有的 SKU、名称、品牌、型号、料号、分类与原始资料生成；不会编造规格、兼容性、认证、库存、质保或性能，也不会修改价格、库存、商品图片或其他字段；
5. 不能使用“选择全部结果”创建 AI SEO 任务；需要大批量时请使用下方的自动候选队列，避免数万商品的误操作和不可控成本。

产品表新增 **AI SEO** 一列，并可按“未 AI 优化 / AI 已优化 / AI 处理中 / AI 优化失败”筛选。后台左侧 **AI SEO 优化记录** 页面（`/admin/ai-seo`）提供总数统计、最近 50 个任务、逐 SKU 进度、成功状态和失败原因。

### 自动候选优化（最多 30,000 个）

在 **产品管理** 中点击 **AI 自动候选优化（最多 30,000）**，可不必手动逐页勾选。系统只会从启用商品中选择候选，并按以下顺序优先处理：

1. 从未由 AI SEO 优化过的商品；
2. 长描述、Meta Title 或 Meta Description 缺失的商品；
3. 较久未更新的商品。

当前的分类、品牌和搜索词会作为候选范围；已经在其他 AI SEO 任务中排队或处理的商品会自动排除。默认最多 30,000 个，管理员可在 **AI 助手** 配置页调整候选上限（1–30,000）与每个任务的并行请求数（1–50）。容器重启后未完成任务会从队列继续运行。

在 **AI SEO 优化记录** 中可以暂停排队或执行中的任务。暂停会阻止领取新的 SKU，已发出的少量请求允许完成当前商品；所有未处理 SKU 仍保留在队列，点击“继续”即可从原处恢复。暂停的任务不会因容器重启自动启动。对已暂停任务还可以点击“结束”：已成功优化的产品保留结果，剩余 SKU 会从队列释放，后续可重新加入新的优化任务。

每个任务完成后，系统会刷新产品/站点地图相关缓存；如果后台 **IndexNow** 已启用且允许自动提交产品更新，会把该批已优化 URL 合并为一次 IndexNow 提交，从而帮助 Bing 等支持 IndexNow 的搜索引擎更快发现更新。Google 仍应在 Google Search Console 中提交 `https://www.vibocnc.com/sitemap.xml`。

## 写入边界与安全性

- AI 对话接口只生成建议，绝不直接改数据库。
- 点击应用时，后端会重新验证商品 ID、分类 ID、语言代码及允许写入的字段。
- 自动流程只允许选择现有启用分类、修改商品分类/默认语言 SEO、写入商品翻译、写入分类翻译；不会自动创建分类。品牌、型号、类型无法确认时，产品保持未启用。
- 不允许 AI 变更价格、库存、订单、用户、权限或任意数据库列。
- 同一轮分类移动和翻译写入在数据库事务中完成；失败时整轮回滚。分类树只能由管理员在分类管理页维护。
- 后端只使用受限的公共出站 HTTP 客户端调用配置的第三方服务，避免把 Provider URL 变成 SSRF 通道。
- 应用完成后会调用项目现有缓存失效逻辑，使分类和商品页面可刷新到最新内容。

## API（供二次集成）

所有接口都在 `/api/v1/admin/ai-agent` 下，并要求 admin/editor JWT：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/status` | 返回是否已配置、模型名、推理强度和 Provider 主机名；不返回 Key。 |
| `POST` | `/chat` | 请求 AI 生成结构化、可审阅的优化建议。 |
| `POST` | `/apply` | 显式应用一条或一组建议。 |
| `POST` | `/seo/jobs` | 创建一个仅含显式 `product_ids`（1–30,000 条）的异步 AI SEO 任务。 |
| `POST` | `/seo/candidates` | 在当前分类/品牌/搜索范围内自动选择最多 30,000 个高优先级候选，创建异步 AI SEO 任务。 |
| `POST` | `/seo/jobs/:id/pause` | 暂停 queued/running 任务，未处理 SKU 保留队列。 |
| `POST` | `/seo/jobs/:id/resume` | 继续 paused 任务。 |
| `POST` | `/seo/jobs/:id/end` | 结束 paused 任务，保留已优化结果并释放未处理 SKU。 |
| `GET` | `/seo/jobs` | 读取最近 50 个 AI SEO 任务。 |
| `GET` | `/seo/jobs/:id` | 读取任务以及每个 SKU 的处理状态。 |
| `GET` | `/seo/stats` | 返回 AI 已优化、未优化、失败和处理中产品的计数。 |
| `GET` / `PUT` | `/settings` | 仅管理员：读取或保存 AI Provider、Key、模型与推理强度。 |
| `GET` | `/classification/review` | 仅管理员：分页读取待复核的分类候选（`status`/`job_id`/`search` 过滤）。 |
| `POST` | `/classification/review/:id/approve` | 仅管理员：采纳候选（可带 `allow_new_product_types`、`activate_product`），并记为已验证规则。 |
| `POST` | `/classification/review/:id/dismiss` | 仅管理员：丢弃候选并写入审核记录，产品保持不变。 |

## 分类学习与复核队列

分类判定按固定顺序进行，先便宜后昂贵，**任何一步确认即停**：

1. **学习型规则**：同一品牌 + 型号（或型号族）此前已被人工/流程确认过的分类，直接复用；
   只有 `completed`（已实际写入并验证）且规则来源可信的记录才会成为规则，
   `unresolved` / 被拒的记录永远不会被学习。规则索引在进程内缓存 60 秒；
   多实例部署时同一份快照通过 Redis 共享（`REDIS_ADDR` 未配置时自动退回单机缓存）。
2. **确定性规则**：代码内经过单测的型号规则（FANUC、ABB、Siemens、Mitsubishi、Omron、SICK、
   Heidenhain、Lenze、Danfoss、Yaskawa、Schneider 等）。
3. **联网证据**：受超时限制的公开检索，只有明确指出完整型号的证据才可用于确认；
   检索失败会被记录但不会改变判定结果。
4. **管理员命名线索**：商品名中重复出现完整型号时作为提示，优先级低于以上来源。
5. **AI 分类器**：复用上面已取得的证据，返回品牌、产品类型、型号族与置信度。

判定结果只有两种去路：

- **达到阈值**（默认 0.9，可用 `AI_CLASSIFICATION_MIN_CONFIDENCE` 调整，取值 `(0,1]`）：
  直接写入分类并按任务配置上架。
- **未达到阈值、与已验证来源冲突、或完全无法判定**：写入 **分类复核队列**，
  保存候选品牌/类型/置信度、理由与证据，**绝不发布**。低置信候选（`needs_review`）、
  双来源矛盾（`conflict`）和无候选（`unresolved`）三种状态在队列中分别展示。

复核队列位于 **AI 助手** 配置页底部，可搜索、按状态筛选、查看证据链接，并：

- **采纳**：走与自动流程相同的写入路径，随后记录一条 `completed` 审核记录，
  使该型号成为学习型规则（因此下一次会直接沿用）。
- **丢弃**：写入 `rejected` 审核记录并关闭该条目，产品保持不变，同一候选不会再次出现。

自动创建分类仍然受词汇表门禁：产品类型若不在内置类型词典、且分类树中不存在同名节点，
默认拒绝创建，错误信息会要求管理员批准；批量任务需显式传 `allow_new_product_types`，
复核队列的“允许新建分类类型”也需要管理员逐次勾选。

## eBay 证据驱动的产品画像

后台 **eBay Market** 页面提供独立的“AI 产品画像”流程，用于处理数据库里只有型号、无法判断产品类型的记录。

### 数据与审核流

```text
eBay 精确型号 listing
  → AI 识别 brand / part_type / what_it_is / functions / applications / cited specs
  → ProductProfileDraft（pending）
  → 管理员审核标题、分类、描述和 SEO 预览
  → 批准后写产品字段
  → 引用规格转 ProductSpecDraft（仍为 pending）
  → Spec Research 再次逐条审核后才写 technical_specs
```

关键约束：

- `POST /admin/ebay-market/identify` 默认只创建画像草稿，不修改产品。
- 型号唯一匹配本地产品时自动关联；同型号对应多个产品时保持未关联，不猜测。
- 同一产品/型号的新草稿会把旧 pending 草稿标为 `superseded`。
- 批准前保存产品 `updated_at` 快照；产品在识别后被编辑时返回 `stale_profile_draft`，除非管理员显式强制。
- 标题格式固定为 `Brand Model Product Type`，不会保留 eBay 的 `Used`、`Fast delivery`、`Quality Guaranteed` 等噪音。
- 描述和 SEO 使用结构化画像生成，商业承诺读取 `CommercePolicySetting`，不硬编码时效/质保/退货条件。
- 默认只填充空白或过短文案；覆盖成熟文案必须勾选 `overwrite_existing`。
- 外来品牌词通过 `ForeignBrandMentions` 检查；含其他制造商品牌的公开文案不会进入草稿。
- AI 返回的规格必须有 `source_url`；批准画像也不会直接发布规格，而是生成 `ProductSpecDraft`。
- 分类通过现有 taxonomy gate。新产品类型默认禁止创建，只有管理员勾选后才能增加分类节点。

### 画像接口

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `POST` | `/api/v1/admin/ebay-market/identify` | 读取型号的 eBay 证据、调用 AI、默认创建 pending 画像草稿 |
| `POST` | `/api/v1/admin/ebay-market/identify/jobs` | 批量识别：为有精确型号证据、尚无待审画像的产品排队（`202`） |
| `GET` | `/api/v1/admin/ebay-market/profile-drafts` | 按状态列出画像审核队列 |
| `GET` | `/api/v1/admin/ebay-market/profile-drafts/:id` | 查看产品当前值、建议内容和 listing 证据 |
| `POST` | `/api/v1/admin/ebay-market/profile-drafts/:id/approve` | 管理员显式应用标题/分类/内容；规格仅转审核草稿 |
| `POST` | `/api/v1/admin/ebay-market/profile-drafts/:id/reject` | 拒绝，不修改产品 |

`ebay_ingest` API Token 无权访问画像审核或批准接口；它只能上传证据和草稿。

### 批量识别任务

单型号 `identify` 是同步调用；批量识别走 AI 任务队列
（`selection_mode = product_identification`），避免长请求超时并可在重启后恢复：

- 候选选择复用 `MatchProductsForMarketQuotes`，因此型号冲突与品牌前缀规则
  不会与报价页漂移。
- 只选**精确型号**有 eBay 证据、`is_active`、且有可用型号标识的产品。
- 已有 pending 画像草稿、或已在其他 AI 任务 `queued/running` 的产品自动跳过，
  防止重复审核行与重复 AI 消耗。
- 任务在创建时固定 AI profile（`pinAIAgentSEOJobProfile`），沿用现有暂停/恢复；
  与规格调研一样属于 draft-only 任务，恢复时会重新入队 `running` 项。
- 每一项只调用 `StoreProductProfileDraft`，不写任何商品字段。
- `ebay_ingest` 令牌无权调用该接口。

### 采集草稿自动审核（采集 → 上架）

上面的画像接口作用于**已有产品**。把**抓取草稿**变成可上架产品的是另一条流水线，
入口在 `Admin → eBay Drafts → 采集草稿`：

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/ebay-import-drafts/ai-review/summary` | 各审核状态计数 |
| `GET` | `/api/v1/admin/ebay-import-drafts/ai-review/latest` | 最近一次任务，刷新后可续接 |
| `POST` | `/api/v1/admin/ebay-import-drafts/ai-review` | 发起审核（`{ids}` 或 `{all_filtered, ...filters}`） |
| `GET` | `/api/v1/admin/ebay-import-drafts/ai-review/:jobId` | 任务快照 + 逐项结果 |
| `POST` | `/api/v1/admin/ebay-import-drafts/ai-review/:jobId/{pause,resume,cancel}` | 暂停 / 继续 / 取消 |
| `POST` | `/api/v1/admin/ebay-import-drafts/ai-review/approve` | **上架**选中的待批准草稿 |
| `POST` | `/api/v1/admin/ebay-import-drafts/ai-review/reject` | 丢弃提案，草稿保留 |

关键约束：

- **审核不发布。** 审核只把提案写回草稿（`ai_review_status = ready`），生成
  产品只发生在 `approve`，且复用 `confirmDraftImport`，与人工确认走完全相同的
  校验、去重与 upsert。**没有自动发布开关**。
- **分类按「品牌 > 类型」创建。** 先复用已确认分类，再复用推断命中的现有分支，
  最后才 `ResolveOrCreateCategoryForAdministrator`（父节点=品牌，子节点=类型，
  如 `Fanuc > Fanuc Drive`）。创建需同时满足 `IsConfirmedProductCategory` 且
  `!IsGenericProductType`，泛化的 “Spare Part” 永远不会建节点。
- **价格直接用采集价**（`NormalizedPrice`）。市场 `price_sync` 系数是另一套
  面向已有产品的可选机制，这里不套用。
- 列表支持 `ai_review_status` 筛选（`ready` = 待批准，`unreviewed` = 未审核），
  草稿表格直接显示待批准徽标、AI 建议分类和失败原因。

完整说明（数据模型、状态机、为何不复用 `AIAgentSEOJob`）：`docs/EBAY_DRAFT_REVIEW.md`。

### 页面结构

`/admin/ebay-import-drafts` 是采集链路的唯一 hub，两个页签：

- **采集草稿** —— 草稿队列、批量确认/删除、JSON 导入任务日志、上述 AI 审核面板。
- **市场调研 / 价格** —— 原 `/admin/ebay-market` 的内容（报价、价格建议、画像审核、
  插件令牌设置）。旧地址 `/admin/ebay-market` 会重定向到 `?tab=market`。

`Admin → Spec Research`（`/admin/spec-drafts`）页面已移除；相关
`/admin/products/spec-drafts` 接口保留，仍服务于产品编辑页与画像审核面板。
