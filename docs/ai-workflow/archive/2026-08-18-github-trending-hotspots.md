# Active Plan：GitHub Trending 热点模块

- 状态：Completed
- 计划编号：2026-08-18-github-trending-hotspots
- 创建日期：2026-08-18
- 最后更新：2026-08-18
- Owner：主线程
- 关联需求：新增完整历史增量版 GitHub Trending，并将其与 RSS 组成“热点”二级菜单
- Report：`docs/ai-workflow/reports/2026-08-18-github-trending-hotspots.md`
- 基线：`master@19da4abb5a979e90c74aca3b9e3e2a34eb1df0be`

> 执行期间本文件是任务状态的 canonical source。当前未跟踪的 `docs/LingerZen_部署链路优化与目标架构设计.md` 属于用户既有文件，明确排除在本任务写集与最终 diff 之外。

## 1. 目标与成功标准

### 用户目标

- G1：新增仿 HotGit 信息架构的 GitHub Trending 模块，展示 Star/Fork 总榜、日增、周增、月增和历史趋势。
- G2：把 GitHub Trending 与现有 RSS 订阅统一放入“热点”二级菜单。
- G3：在当前腾讯云 Node/Docker 生产环境中可靠保存每日历史数据并自动采集。

### 成功标准

- [x] `/hotspots/github/` 支持分类、搜索、语言、日期、每页数量与分页，历史不足和 stale 状态可判定。
- [x] `/hotspots/github/[owner]/[repo]/` 展示仓库指标与 30/90/365 天趋势。
- [x] 每日采集只使用 GitHub 官方 API，SQLite 写入幂等，重复/并发触发不产生重复数据。
- [x] GitHub Token 与采集 Secret 仅服务端读取；查询参数、SQL、外链和内部端点通过安全检查。
- [x] “热点”桌面和移动二级菜单包含 GitHub Trending 与 RSS；`/feeds/` 兼容跳转到 `/hotspots/rss/`。
- [x] SQLite 数据位于 release 目录之外，发布、清理和回滚不删除历史。
- [x] Node 构建与 `CF_WORKERS=1` 构建均通过；Workers 下模块明确禁用。
- [x] 新增核心模块测试覆盖率达到 80% 以上，完整 check/type-check/lint/build/smoke 通过或披露真实阻塞。

## 2. 已确认事实与证据

| ID | 事实 | 证据路径/命令 | 当前性 |
|---|---|---|---|
| F1 | 导航类型与桌面/移动组件已支持 `children` 二级菜单 | `src/types/navBarConfig.ts`、`src/components/layout/DropdownMenu.astro`、`src/components/layout/NavMenuPanel.astro` | Current |
| F2 | RSS 已有服务端 allowlist、超时、内存缓存与 stale 回退 | `src/config/feedsConfig.ts`、`src/pages/api/feeds.json.ts` | Current |
| F3 | Astro 使用 Node standalone SSR，生产为单 Docker 服务 | `astro.config.mjs`、`Dockerfile`、`docker-compose.yml` | Current |
| F4 | 发布采用 release/current，清理只针对 `releases/*` | `scripts/deploy-release.sh` | Current |
| F5 | GitHub Search 可按 stars/forks/updated 排序但不提供历史 delta | GitHub REST 官方文档 | Current |
| F6 | HotGit 的增量榜依赖每日持久化历史，不是单次 GitHub 请求字段 | `https://hotgit.org/about` 公开说明 | Current |
| F7 | 基线工作树仅有一个用户未跟踪文档 | `git status --short` | Current |

### 已确认决策

- D1：选择完整历史增量版，而非轻量实时榜单或直接抓取 GitHub Trending HTML。
- D2：腾讯云 Node/SQLite 优先，不实现 Cloudflare D1 双后端。
- D3：不访问 HotGit 私有 API，不复制其品牌、广告或 AI 项目观察文案。
- D4：使用 Node 22 内置 `node:sqlite`，不引入原生 SQLite 依赖。
- D5：使用 GitHub Actions 定时任务经 SSH 触发容器 loopback 内部端点，不在 Astro 进程中使用常驻定时器。

## 3. 范围与非目标

### 范围内

- GitHub 官方 REST Search + GraphQL 候选发现和滚动跟踪。
- SQLite schema、迁移/备份、lease、快照、榜单物化、查询层。
- Star/Fork 总榜、日/周/月增、历史日期、仓库详情和 SVG 趋势图。
- 热点二级菜单、RSS canonical 路由迁移与旧地址兼容。
- Docker 持久卷、内部采集端点、每日 workflow、Cloudflare 禁用分支。
- 自动测试、Review、运维文档、Report 和归档。

### 非目标

- HotGit 品牌/广告、AI 项目观察、README 自动摘要、同语言推荐。
- 用户关注列表、GitHub 登录、评论、D1/外部数据库双后端。
- 访问或依赖 HotGit 私有 `/api/`。
- 自动 commit、push、部署生产或写入真实 Secrets。

## 4. 约束、依赖、风险与回滚

- 约束：Node 22.13+；pnpm；Biome tab/double quotes；新增行为测试优先；外部输入全部校验。
- 依赖：GitHub 官方 Search/GraphQL；生产 `/data/LingerZen/.env`；宿主持久目录。
- 风险：候选池并非 GitHub 全量，页面必须披露口径；GitHub 限流/中断须保留最近成功数据；schema 迁移失败不得破坏旧库。
- 回滚：代码回退至前一 release；SQLite 独立持久卷不随 release 回滚。schema 仅做向后兼容增量，迁移前备份；旧代码遇到新 schema 时只读禁用，不继续写入。

## 5. 目标映射与执行顺序

| 目标 | 任务项 | 验收证据 |
|---|---|---|
| G1 | P1, P2, P3 | 单元/集成测试、页面 smoke、截图/DOM 检查 |
| G2 | P4 | 桌面/移动/键盘验证、路由响应 |
| G3 | P1, P2, P5 | SQLite/lease 测试、Compose 配置、workflow 与持久化 smoke |

| ID | 状态 | 依赖 | Owner | 读写范围 | 单一交付物 |
|---|---|---|---|---|---|
| P0 | completed | - | main | `docs/ai-workflow/plans/` | 本 Active Plan |
| P1 | completed | P0 | main | `src/lib/github-trending/`, `tests/`, package scripts | 经测试验证的数据核心 |
| P2 | completed | P1 | main | GitHub client/collector 与 fixtures | 幂等每日采集器 |
| P3 | completed | P1,P2 | main | GitHub Trending pages/components | 可用榜单与详情 UI |
| P4 | completed | P3 | main | nav/RSS routes | 热点二级菜单与兼容路由 |
| P5 | completed | P2 | main | compose/deploy/workflow/internal route/env/docs | 持久化与自动调度 |
| P6 | completed | P3,P4,P5 | main | review/verification/report/archive | 对账、Report 与归档 |

## 6. 分步任务

### P0：建立 canonical Active Plan

- 状态：completed
- 涉及文件/写集：`docs/ai-workflow/plans/2026-08-18-github-trending-hotspots.md`
- 验收条件：
  - [x] 目标、非目标、基线、依赖、风险、写集、验证和 Report 路径完整。
  - [x] 用户未跟踪文档明确排除。
- 完成证据：本文件。

### P1：实现并测试 SQLite 数据核心

- 状态：completed
- 依赖：P0
- 涉及文件/写集：`src/lib/github-trending/`、`tests/github-trending/`、`package.json`、`pnpm-lock.yaml`
- 实施动作：
  1. 配置 `node:test` + `tsx` 和覆盖率命令，先写 migration、事务、lease、参数解析、排名纯函数失败测试。
  2. 实现 schema、迁移备份、预编译 SQL、快照/榜单仓储和查询参数白名单。
- 验收条件：核心测试通过；参数化 SQL；并发 lease 和同日幂等可复现；新增核心行覆盖率 ≥80%。
- 验证：`pnpm test`、`pnpm test:coverage`、`pnpm type-check`。
- 完成证据：14/14 测试通过；核心行覆盖率 98.44%、函数 100%；`pnpm type-check` 与 scoped Biome CI 通过；独立代码/安全审查无 CRITICAL，修复 failed recovery、路径/schema 校验、page/limit 上限。

### P2：实现并测试 GitHub 采集

- 状态：completed
- 依赖：P1
- 涉及文件/写集：GitHub client、collector、fixtures/tests。
- 实施动作：
  1. 先测试分页、候选合并/去重、GraphQL 批量刷新、限流、退避、partial errors、改名/删除、失败回滚。
  2. 实现滚动候选池、每日快照、五类榜单物化和 stale 状态。
- 验收条件：重复/并发采集无重复；部分失败不写半套数据；日志和错误脱敏。
- 验证：定向测试、覆盖率、类型检查。
- 完成证据：23/23 测试通过；核心行覆盖率 97.77%、函数 96.43%；类型与 scoped Biome CI 通过；独立代码/安全审查无 CRITICAL，修复 GraphQL soft-failure 误标 unavailable、403/HTTP-date Retry-After、瞬时网络错误重试与错误脱敏。

### P3：实现榜单与仓库详情页面

- 状态：completed
- 依赖：P1、P2
- 涉及文件/写集：`src/pages/hotspots/github/`、`src/components/pages/github-trending/`。
- 实施动作：
  1. 先测试筛选/分页/历史查询和安全默认值。
  2. 实现 SSR tabs、筛选表单、卡片、状态提示、详情和 30/90/365 天 SVG 图表。
- 验收条件：五类榜单、历史日期和详情可用；历史不足/stale/空库/Workers 禁用均有明确状态；外链安全。
- 验证：测试、`pnpm check`、本地浏览器桌面/移动 smoke。
- 完成证据：26/26 测试通过；核心行覆盖率 98.33%；type-check/Astro check 0 错误/警告/提示；真实 fixture 列表/详情 200、page=999 回落 3/3、键盘 tooltip/表格/移动视觉通过；图表调色板亮暗模式全部 PASS；Lighthouse 两页 Accessibility 93、Best Practices/SEO/Agentic 100，失败项均为既有侧栏/页脚；独立双审查无 CRITICAL/HIGH，并修复 URL 回读纵深、真实 404、禁用分页语义、live tooltip、窄屏定位与 Swup 监听器累积。

### P4：重组热点菜单与 RSS 路由

- 状态：completed
- 依赖：P3
- 涉及文件/写集：`src/config/navBarConfig.ts`、`src/pages/hotspots/rss/index.astro`、`src/pages/feeds/index.astro`。
- 实施动作：复用现有 children 菜单；迁移 RSS 页面；保留 `/api/feeds.json`；旧路由 301。
- 验收条件：桌面 hover/focus/键盘、移动展开均可达；RSS 内容不回归；旧 URL 正确跳转。
- 验证：`pnpm check`、浏览器交互、HTTP 状态检查。
- 完成证据：type-check/Astro check 0；桌面热点为 expandable menu，移动菜单含 GitHub Trending 与 RSS 订阅；无库 GitHub 页显示首次采集状态；`/feeds/` 301 到 `/hotspots/rss/`，新 RSS 路由 200。

### P5：接入持久化与自动调度

- 状态：completed
- 依赖：P2
- 涉及文件/写集：`docker-compose.yml`、`scripts/deploy-release.sh`、`.github/workflows/trending.yml`、内部 API、`.env.local.example`、运维文档。
- 实施动作：
  1. bind mount release 外目录，创建持久目录但不在部署中迁移/采集。
  2. 实现 loopback + constant-time Bearer 校验的 POST 内部端点。
  3. 新增每日/手动 workflow 经 SSH 触发容器内部采集；添加 Workers 501/禁用分支。
- 验收条件：compose 有效；Secret 不泄露；同日/并发工作流安全；release 模拟切换后数据仍可读；Workers build 通过。
- 验证：端点测试、`docker compose config --quiet`、`pnpm build`、`CF_WORKERS=1 pnpm build`。
- 完成证据：28/28 测试；核心行覆盖率 98.36%、函数 97.20%；type/Astro/Biome 通过；Compose/YAML/bash/secret scan 通过；Node 与 Workers build 最新源码均成功；修复 Satteri WASM 可选包安装；真实 Node 产物 endpoint smoke：正确 socket+Origin+secret 返回 503（缺 Token且未触网），错误 secret/XFF 均 404；P5 双审查无剩余 CRITICAL/HIGH，Host spoofing 已改为 socket clientAddress + no-XFF + constant-time Bearer。

### P6：Review、完整验证、Report 与归档

- 状态：completed
- 依赖：P3、P4、P5
- 涉及文件/写集：代码修复、`docs/ai-workflow/reports/`、Active Plan、索引/归档。
- 实施动作：Standards Review、Spec Review、安全审查；修复 CRITICAL/HIGH；完整验证和 diff 对账；更新运维文档与 Report；归档 Plan。
- 验收条件：所有目标有新鲜证据；无未解释范围偏差、秘密、临时文件或调试代码；失败/未验证项如实披露。
- 验证：`pnpm test`、coverage、check、type-check、Biome CI、Node/Workers build、compose、浏览器 smoke、`git diff --check`、最终 diff 审查。
- 完成证据：Standards/Spec/Security 三轴 Review 均无残留阻塞项；28/28 tests、98.36% lines、97.20% funcs；Node/Workers build 均 Complete；Report 已生成；用户未跟踪文档和临时构建产物均排除。

## 7. 执行记录

| 时间 | 任务项 | 动作与结果 | 证据 | 下一步 |
|---|---|---|---|---|
| 2026-08-18 | P0 | 建立 Active Plan，基线工作树仅有用户未跟踪部署设计文档 | `master@19da4ab`、`git status --short` | P1 |
| 2026-08-18 | P1 | 验证 Node 22.20 可直接加载 `node:sqlite`，内置 test runner 支持覆盖率门禁 | `node --version`、`node:sqlite` 内存查询、`node --test --help` | 写 RED 测试 |
| 2026-08-18 | P1 | 完成 schema/PRAGMA/lease、参数化查询和历史排名核心；审查后补 recovery、路径/schema 与边界上限 | 14/14 tests；98.44% lines；100% funcs；type-check/Biome 通过 | P2 |
| 2026-08-18 | P2 | 完成四类 GitHub 发现、GraphQL 滚动刷新、事务采集和榜单物化；审查后修复 GraphQL soft failure 与限流重试 | 23/23 tests；97.77% lines；96.43% funcs；type-check/Biome 通过 | P3 |
| 2026-08-18 | P3 | 完成查询 DTO、SSR 榜单/详情与可访问 small-multiple 趋势图；真实 fixture 浏览器验证并修复分页/URL/404/Swup 边界 | 26/26 tests；98.33% lines；Astro check 0；desktop/mobile smoke；Lighthouse 93/100/100/100 | P4 |
| 2026-08-18 | P4 | 复用现有 desktop/mobile children 菜单，将热点拆为 GitHub Trending 与 RSS；迁移 canonical RSS 并保留 301 | type-check/Astro check 0；菜单 DOM 验证；`/feeds/` 301；`/hotspots/rss/` 200 | P5 |
| 2026-08-18 | P5 | 接入 release 外 SQLite bind mount、socket-loopback 内部采集端点、每日 workflow 与 CI；修复 Satteri Workers WASM 构建依赖 | 28/28 tests；98.36% lines；Node/Workers build；Compose/YAML/bash；真实 endpoint 503/404/404 smoke | P6 |
| 2026-08-18 | P6 | 完成 Standards/Spec/Security Review、最终全量门禁、Report 和归档对账 | `docs/ai-workflow/reports/2026-08-18-github-trending-hotspots.md`；全门禁通过 | 归档 |

## 8. 偏差与重新规划

| 时间 | 任务项 | 原计划/假设 | 新事实或偏差 | 影响 | 决策及依据 |
|---|---|---|---|---|---|
| 2026-08-18 | Design | 仅保存 Star/Fork 总榜前 100 即可计算增量榜 | 爆发中的小仓库可能从未进入总榜 | 日/周/月榜会系统性漏项 | 增加近期创建/活跃搜索与 90 天滚动候选池 |
| 2026-08-18 | Design | Astro 进程内定时器 | 当前无稳定应用启动 hook，发布切换可能重复调度 | 调度可靠性不足 | 改为 GitHub Actions 定时，经 SSH 触发容器 loopback 端点 |

## 9. 最终计划对账

| 用户目标/任务项 | 状态 | 实际 Diff/Artifact | 验证证据 | 偏差或遗留 |
|---|---|---|---|---|
| G1 / P1-P3 | completed | `src/lib/github-trending/`、`src/pages/hotspots/github/`、`src/components/pages/github-trending/`、tests | 28 tests、coverage、desktop/mobile smoke、Node/Workers build | 增量榜按候选池口径，已页面披露 |
| G2 / P4 | completed | `src/config/navBarConfig.ts`、`src/pages/hotspots/rss/`、`src/pages/feeds/` | desktop/mobile menu DOM、301/200 smoke | 无 |
| G3 / P1,P2,P5 | completed | SQLite schema/collector、compose/deploy/workflow/internal endpoint | lease/rollback tests、Compose/YAML/bash、503/404/404 endpoint smoke | 生产 Secrets/首次采集未执行，见 Report rollout |

### 完成检查

- [x] 每个用户目标都映射到任务项并满足成功标准
- [x] 每个 `completed` 任务项都有新鲜验证证据
- [x] 实际 diff 与范围一致，代码、测试、配置和文档同步
- [x] Standards Review 已完成
- [x] Spec Review 已完成
- [x] Security Review 已完成
- [x] 未验证项、偏差、阻塞和遗留风险已披露
- [x] Report 已生成并链接本 Plan
- [x] 文档/链接检查和 `git diff --check` 已通过
- [x] 归档后 Plan、Report 和路径已复验

## 10. Report 与归档

- Report 路径：`docs/ai-workflow/reports/2026-08-18-github-trending-hotspots.md`
- 最终状态：Completed
- 归档路径：`docs/ai-workflow/archive/2026-08-18-github-trending-hotspots.md`
- 归档验证：Plan/Report/索引相互链接可读；active plans 目录无已完成计划。
