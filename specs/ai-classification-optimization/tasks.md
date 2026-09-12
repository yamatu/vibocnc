# Implementation Plan

- [x] 1. 抽取共享型号选择器与分类流水线
- [x] 2. 重构搜索为多证据聚合、厂家核验和瞬时重试
- [x] 3. 增加 Product Type 词典并接入分类解析/创建
- [x] 4. 修正 LLM fallback 语义与候选分类上下文
- [x] 5. 区分 unresolved/failed 并持久化分类审计
- [x] 6. 增加单元测试并运行 Go/前端检查（Go 通过；前端存在仓库既有 lint 基线问题）
