# 部署与运维手册（Docker Compose）

本文覆盖首次部署、日常更新、凭据漂移修复、备份回滚，以及安全加固相关的必读项。
所有命令都在仓库根目录执行（即包含 `docker-compose.yml` 的目录）。

---

## 1. 拓扑

生产推荐拓扑（与 `nginx/nginx.conf` 的 upstream 默认值一致）：

```
Internet → CDN/Cloudflare → 宿主机 Nginx :443 (:80 → 301)
                              ├── /            → 127.0.0.1:3000 (frontend 容器)
                              ├── /api/        → 127.0.0.1:8080 (backend 容器)
                              └── /uploads/    → 127.0.0.1:8080 (backend 容器)
```

要点：

- 容器端口只绑定到宿主机回环（`127.0.0.1:3000` / `127.0.0.1:8080`），
  由 `.env` 的 `FRONTEND_PORT` / `BACKEND_PORT` 控制。
- 因为反向代理在宿主机上，后端只需要信任回环地址：
  `TRUSTED_PROXIES=127.0.0.1,::1`。
- 宿主机 Nginx 已用 `real_ip_header CF-Connecting-IP` 把 CDN 的真实客户端 IP 写回
  `$remote_addr`，再用 `proxy_set_header X-Forwarded-For $remote_addr;` 覆盖转发头，
  所以后端**不需要**设置 `TRUSTED_PLATFORM`（留空即可）。
- 若改用 compose 内置 Nginx（`--profile internal-nginx`，见 `docker/nginx.conf`），
  后端对端变成 docker 网桥地址，此时 `TRUSTED_PROXIES` 必须包含该网段
  （例如 `172.16.0.0/12`），否则 `ClientIP()` 会把所有请求算作同一个 IP，
  限流会误伤全部用户。

---

## 2. 首次部署

```bash
git clone https://github.com/yamatu/vibocnc.git && cd vibocnc
cp .env.docker.example .env
```

### 2.1 必须填写的项

| 变量 | 要求 |
| --- | --- |
| `MYSQL_ROOT_PASSWORD` / `MYSQL_PASSWORD` | 强随机值，且**不要与卷初始化时不同**（见第 4 节） |
| `JWT_SECRET` | ≥ 32 字符强随机值（`openssl rand -base64 48`） |
| `SETTINGS_ENCRYPTION_KEY` | 32 字节 base64（`openssl rand -base64 32`），用于加密 PayPal / AI 凭据 |
| `REVALIDATE_SECRET` | 强随机值，否则 ISR 刷新接口等于对外开放 |
| `CORS_ORIGINS` | 精确的站点 Origin，逗号分隔，禁止 `*` |
| `AUTH_COOKIE_SECURE` | 生产必须 `true` |
| `API_VERBOSE_ERRORS` | 生产必须 `false` |
| `TRUSTED_PROXIES` | 按第 1 节拓扑填写，例如 `127.0.0.1,::1` |
| `NEXT_PUBLIC_SITE_URL` / `SITE_URL` | 真实域名（canonical / sitemap 依赖它） |
| `SEED_DEFAULT_ADMIN` / `DEFAULT_ADMIN_PASSWORD` | 只有**全新数据库首次启动**才设为 `true`，登录后立刻改回 `false` |

### 2.2 部署前自检（必跑）

```bash
bash scripts/preflight-env.sh .env     # 退出码非 0 表示存在阻断性问题
docker compose config >/dev/null       # YAML / 变量插值检查
```

`preflight-env.sh` 会拒绝：短 `JWT_SECRET`、占位符密码、`AUTH_COOKIE_SECURE!=true`、
`API_VERBOSE_ERRORS=true`、通配 `CORS_ORIGINS`、`TRUSTED_PROXIES` 过度宽松、
空 `REVALIDATE_SECRET` / `SETTINGS_ENCRYPTION_KEY`、以及
`RESET_DEFAULT_ADMIN_PASSWORD=true`。这些检查同时作为 CI 的 `infra-lint` 任务运行，
所以脚本本身不会被改坏。

### 2.3 启动

```bash
docker compose up -d --build
docker compose ps                     # mysql 应为 healthy
curl -fsS http://127.0.0.1:8080/health
```

`DB_AUTO_MIGRATE=true` 会在启动时补齐表结构（首次部署保留该值）。
上线稳定后建议改为 `false`，迁移改为显式执行。

---

## 3. 日常更新

```bash
bash scripts/preflight-env.sh .env     # 只在 .env 变更时需要
git pull --ff-only
docker compose up -d --build
docker compose logs --tail=100 backend
curl -fsS http://127.0.0.1:8080/health
```

- 先 `git pull` 再 `up -d --build`：`--build` 会用新代码重新构建镜像，
  不会动数据卷。
- 数据库结构变更由后端启动时的 auto-migrate 处理（`DB_AUTO_MIGRATE=true` 时）。
- 前端镜像重新构建后，Next.js 的 ISR 缓存位于容器内，重建会冷启动一次页面缓存。

### 回滚

```bash
git log --oneline -5
git checkout <上一个正常提交>
docker compose up -d --build
```

镜像与容器都按代码重建，数据卷不受影响。若某次发布包含不可逆的表结构变更，
请先从备份恢复（见第 5 节）再回滚代码。

---

## 4. 数据库凭据漂移（重要）

MySQL 官方镜像只在**数据目录为空**时应用 `MYSQL_ROOT_PASSWORD` / `MYSQL_USER` /
`MYSQL_PASSWORD`。卷一旦初始化完成，之后修改 `.env` 里的密码**不会**改变
数据库中已存在的账号，表现是后端/`mysqladmin` 报：

```
ERROR 1045 (28000): Access denied for user 'vibocnc'@'...'
```

常见于：本地先起过一次容器，后来改了 `.env` 密码；或把本地卷迁移到新环境。

**不要**用 `docker compose down -v` 解决（会删除全部数据）。用修复脚本：

```bash
bash scripts/repair-mysql-credentials.sh .env
```

它会：

1. 停止 `vibocnc_mysql`（数据卷保留）；
2. 用 `--skip-grant-tables --skip-networking` 临时启动一个 mysqld 挂载同一个卷；
3. 按 `.env` 重设 `root@%` / `root@localhost` / `<MYSQL_USER>@%` / `<MYSQL_USER>@localhost`
   的密码，并补齐库权限；
4. 删除临时容器并重新启动 `vibocnc_mysql`。

脚本不会删除任何表或数据，可重复执行（幂等）。
可用环境变量覆盖 `MYSQL_IMAGE` / `MYSQL_CONTAINER` / `MYSQL_VOLUME`。

> 生产建议：一开始就用强随机密码，并把 `.env` 与数据卷一起纳入备份管理，
> 避免“卷在、密码丢了”的局面。

---

## 5. 备份与恢复

```bash
# 备份（在宿主机执行）
docker exec vibocnc_mysql sh -c \
  'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers "$MYSQL_DATABASE"' \
  > backup-$(date +%F).sql

# 恢复
docker exec -i vibocnc_mysql sh -c \
  'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < backup-2026-01-01.sql
```

同时备份 `uploads` 卷（商品图片）与 `.env`（凭据）：

```bash
docker run --rm -v vibocnc_uploads:/data -v "$PWD:/backup" alpine \
  tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

---

## 6. HTTPS、Cookie 与客户端 IP

- 站点必须全程 HTTPS；宿主机 Nginx 负责 80 → 443 跳转与 HSTS。
- `AUTH_COOKIE_SECURE=true` 时管理端会话 Cookie 始终带 `Secure`。
  本地用 `http://localhost` 做容器联调时浏览器仍会接受（localhost 属于安全上下文）；
  若用 `http://<局域网IP>` 访问，则需临时设为 `false`。
- `utils/auth_cookie.go` 的判定顺序：请求本身是 TLS → 直接 `Secure`；
  否则看 `AUTH_COOKIE_SECURE`；否则仅在**可信代理**（`TRUSTED_PROXIES`）发来的
  `X-Forwarded-Proto` 为 https 时启用；最后回落到 `GO_ENV=production`。
  因此伪造 `X-Forwarded-Proto` 无法影响 Cookie 安全属性。
- 限流与审计日志使用 `c.ClientIP()`，其可信度完全取决于 `TRUSTED_PROXIES`。
  任何位于可信网段内的对端都能伪造 `X-Forwarded-For`，这是必须收窄该变量的原因。

---

## 7. AI 助手（agent）部署注意

- `AI_AGENT_TOOLS` 默认 `true`：助手会带上只读工具（`search_products` /
  `get_product` / `list_categories` / `count_products` / `seo_gap_report`）访问商品库。
  若 provider 不支持 `tools` 字段，后端会自动降级为单次请求并按 `baseURL|model` 记忆，
  不会反复失败。
- 上线前在后台 **AI 助手 → 检测工具调用**（`POST /api/v1/admin/ai-agent/test-tools`）
  跑一次，直接得到结论：支持 / 接口接受但模型未调用 / 不支持（会自动降级）/ 已关闭。
- 出站请求走 SSRF 防护客户端：`base_url` 必须解析到**公网**地址。
  `localhost`、`10.0.0.0/8`、`192.168.0.0/16`、`172.16.0.0/12`、链路本地地址、
  云元数据地址、保留网段（`198.18.0.0/15` 等）以及内网域名后缀
  （`.local` / `.internal`）都会被拒绝；端口只允许 80/443。

  该防护会误伤两类真实场景，两者都会报 `resolved to a private address`：

  1. 自建模型服务（Ollama / vLLM / LiteLLM）在内网或本机；
  2. **本机或服务器上有代理软件劫持 DNS**：Clash / Surge / WARP 一类工具的
     fake-IP 模式会把域名解析成 `198.18.x.x`，而这属于保留网段。

  排查方式：

  ```bash
  docker exec vibocnc_backend nslookup api.openai.com     # 看返回的 IP
  ```

  如果返回的是内网/保留地址，说明 DNS 被代理接管（而不是平台配置错误）。
  确认端点可信后可以显式放开（默认关闭）：

  ```bash
  AI_PROVIDER_ALLOW_PRIVATE_ADDRESSES=true
  ```

  开启后 AI 请求可访问私网地址与任意端口，风险由该 URL 的可信度承担，
  因此只在完全掌控该地址时启用；`scripts/preflight-env.sh` 会给出告警。
- 分类置信度阈值 `AI_CLASSIFICATION_MIN_CONFIDENCE` 默认 `0.9`；
  低于阈值的候选不会直接发布，而是进入后台复核队列（Admin → AI 助手）。

---

## 8. 已知的可选优化

- **FULLTEXT 搜索**（可选，默认关闭）
  先执行 `backend/migrations/20260910_add_product_search_fulltext.sql`，
  再设置 `PRODUCT_SEARCH_MODE=fulltext`。中文关键词需要 `ngram` 解析器，
  上线前用真实关键词验证召回效果，不满意就回退到 `like`。
- **复合索引**：商品表与 AI 任务表的复合索引通过 `AutoMigrate` 添加，
  数据量大时会在启动阶段执行 DDL，建议在低峰期完成首次启动。
- **CDN 回源**：若 Cloudflare 走橙色云朵，务必确认源站只允许 Cloudflare IP
  访问 443，否则 `TRUSTED_PLATFORM` 的“对端校验”前提就不成立（当前默认留空，
  由宿主机 Nginx 完成头转换，风险更低）。

---

## 9. 发布后自检清单

```bash
docker compose ps                                  # 全部 Up，mysql healthy
curl -fsS http://127.0.0.1:8080/health             # {"status":"ok"...}
curl -fsS http://127.0.0.1:3000/ -o /dev/null -w '%{http_code}\n'
```

- 浏览器登录管理后台成功，且 DevTools → Application → Cookies 中
  `admin_token` 带 `Secure` / `HttpOnly`。
- `https://<域名>/sitemap.xml`、`/robots.txt` 正常返回。
- 后台 AI 助手能发一条消息并返回建议；如提示不支持工具，按第 7 节复核。
- `docker compose logs backend | grep -i error` 没有新的 5xx / 迁移错误。
