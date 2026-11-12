# 数据库迁移

生产环境使用 `DB_AUTO_MIGRATE=false`，后端启动时不会改表结构。本目录的 SQL 由
`scripts/apply-migrations.sh` 执行（`scripts/docker-up.sh` 每次发布都会调用）。

## 执行方式

- 按文件名排序（`LC_ALL=C`）执行本目录顶层的 `*.sql`，每个文件成功后写入 `schema_migrations` 表，之后不再执行。
- 文件内容与执行记录写在同一个 mysql 会话里，任一语句失败则该文件不记录、后续文件不执行，脚本以非 0 退出。
- `optional/` 子目录里的文件不会自动执行（例如会改变搜索语义的 FULLTEXT 索引）。
- 发布前 `schema-check` 会用新后端镜像核对模型需要的表和列，缺了就中止发布。

```bash
bash scripts/apply-migrations.sh --status    # 已执行 / 待执行
bash scripts/apply-migrations.sh --dry-run   # 只列出将要执行的文件
bash scripts/apply-migrations.sh             # 执行
```

## 新增迁移的规则

1. **新建文件，不改旧文件。** 文件名 `YYYYMMDD_说明.sql`。已执行过的文件被修改只会告警，不会重新执行。
2. **必须幂等。** MySQL DDL 会自动提交，失败后需要能整份重跑；而且线上可能已经手工执行过部分语句。
   - 建表用 `CREATE TABLE IF NOT EXISTS`。
   - MySQL 8 没有 `ADD COLUMN IF NOT EXISTS`，加列/加索引按下面的写法判断：

     ```sql
     SET @ddl = (SELECT IF(COUNT(*) = 0,
       'ALTER TABLE orders ADD COLUMN note VARCHAR(255) NULL', 'DO 0')
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'note');
     PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
     ```

     加索引时把 `information_schema.COLUMNS` 换成 `information_schema.STATISTICS`，按 `INDEX_NAME` 判断。
3. **不要写 `USE 数据库名`**，脚本会拒绝执行；迁移总是作用于当前配置的数据库。
4. 最后一条语句必须以 `;` 结尾（使用 `DELIMITER $$` 的文件最后要恢复 `DELIMITER ;`）。
5. 列名、索引名与 GORM 模型一致（GORM 默认把 `LinkedInURL` 映射为 `linked_in_url`，索引名为 `idx_表名_列名`）。
   改了 `backend/models` 却忘了写迁移，`schema-check` 会在发布时指出缺少的表或列。
