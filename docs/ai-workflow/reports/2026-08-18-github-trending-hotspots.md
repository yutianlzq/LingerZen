# Report：GitHub Trending 热点模块

- 状态：Completed
- 日期：2026-08-18
- 基线：`master@19da4abb5a979e90c74aca3b9e3e2a34eb1df0be`
- Plan：[`../archive/2026-08-18-github-trending-hotspots.md`](../archive/2026-08-18-github-trending-hotspots.md)
- 范围：GitHub Trending 历史模块、热点二级菜单、RSS canonical 路由、腾讯云持久化与每日调度
- 未执行：commit、push、远程部署、生产 Secret 写入、生产首次采集

## 1. 交付结果

### GitHub Trending

- 新增 `/hotspots/github/`：Star 总榜、Fork 总榜、日增、周增、月增，支持仓库/描述/Topic 搜索、语言、历史日期、每页数量和分页。
- 新增 `/hotspots/github/[owner]/[repo]/`：仓库指标、30/90/365 天 Star 与 Fork 历史趋势、键盘/触摸 tooltip 和可访问数据表。
- 增量榜明确标注为“本站每日跟踪候选池”，不宣称覆盖 GitHub 全量仓库。
- 页面覆盖 empty、历史不足、stale、数据库不可用、Workers 禁用和真实 404 状态。

### 数据与采集

- 使用 GitHub 官方 REST Search + GraphQL；不访问 HotGit 私有 API。
- 发现源包括 Star/Fork 总榜、近期创建和近期活跃仓库，并对短期候选滚动跟踪 90 天。
- 使用 Node 22 内置 `node:sqlite`，schema 包含 repositories、tracking_sources、daily snapshots、materialized rankings、collection runs 和 migrations。
- 开启 WAL、foreign keys、busy timeout；网络请求在事务外完成，数据库在短事务中原子写入。
- collection run 使用日期唯一、lease token、过期接管和 completed 短路，支持同日幂等、失败恢复与部分写入回滚。
- 日/周/月 baseline 取目标日及之前最近快照；基线后创建的新仓库从 0 计算；只收录正增长。
- 历史保留 400 天；schema 迁移前 `VACUUM INTO` 备份，保留最近 5 份。

### 热点与 RSS

- 导航“热点”改为现有 children 模式的二级菜单：
  - `GitHub Trending` → `/hotspots/github/`
  - `RSS 订阅` → `/hotspots/rss/`
- 桌面下拉、focus/键盘导航和移动端折叠完全复用既有组件。
- 原 RSS 页面迁到 `/hotspots/rss/`；`/feeds/` 永久 301 跳转；`/api/feeds.json` 保持不变。

### 部署与调度

- 宿主 `/data/LingerZen/data/github-trending` bind mount 到容器 `/app/data/github-trending`，数据位于 `releases/` 之外。
- 发布脚本只创建/校验持久目录，不在发布事务中执行迁移或采集；release 清理与回滚不触碰历史数据。
- 新增 `.github/workflows/trending.yml`，每天 UTC 20:17（北京时间次日 04:17）及手动触发。
- workflow 经 SSH 进入生产机，再由容器内 Node 请求同源 loopback endpoint；Secret 不进入 SSH/命令行参数或日志。
- 内部 endpoint 要求真实 socket `clientAddress` 为 loopback、无 `X-Forwarded-For`、32 字节以上 Bearer Secret；配置 secret 与请求 Bearer 值使用 SHA-256 定长摘要后 `timingSafeEqual`，所有响应 `Cache-Control: no-store`。
- Workers 下 Trending runtime 返回 disabled、内部采集返回 501，SQLite/collector 通过惰性 import 隔离。
- CI 增加测试、80% 覆盖率、isolated declarations 和 Workers build 门禁；Biome 固定 2.5.5 并覆盖 `src`/`tests`。

## 2. 主要代码与配置

- `src/lib/github-trending/`：数据库、迁移、GitHub client、采集、排名、查询、运行时、鉴权和类型。
- `src/config/githubTrendingConfig.ts`：固定端点、候选池、限流、保留期和采集参数。
- `src/pages/hotspots/github/`、`src/components/pages/github-trending/`：榜单、详情、卡片与趋势图。
- `src/pages/api/internal/github-trending/collect.ts`：受保护的内部采集入口。
- `src/config/navBarConfig.ts`、`src/pages/hotspots/rss/index.astro`、`src/pages/feeds/index.astro`：热点二级菜单和 RSS 迁移。
- `docker-compose.yml`、`scripts/deploy-release.sh`、`.github/workflows/trending.yml`：持久化与调度。
- `tests/github-trending/`：7 个测试文件、28 个测试入口。
- `package.json`：Node `>=22.13.0`、test/coverage scripts、pnpm wasm32 optional architecture。

## 3. 验证证据

### 自动测试与静态检查

- `pnpm install --frozen-lockfile`：通过，lockfile 无需更新。
- `pnpm test:coverage`：28/28 通过；核心模块 lines **98.36%**、branches **86.84%**、functions **97.20%**。
- `pnpm type-check`：通过。
- `pnpm check`：Astro 208 文件，0 errors / 0 warnings / 0 hints。
- `pnpm exec biome ci src tests`：255 文件通过。
- `docker compose config --quiet`：通过，展开配置确认 bind mount 与 DB 路径。
- `bash -n scripts/deploy-release.sh`：通过。
- 4 个 workflow 通过本地 YAML parser。
- Secret pattern scan：受版本控制候选范围无匹配。
- `git diff --check`：通过。

### 生产构建

- `pnpm build`：`@astrojs/node` adapter，`Server built` / `Complete!`。
- `CF_WORKERS=1 pnpm build`：`@astrojs/cloudflare` adapter，`Server built` / `Complete!`。
- Workers 初次构建暴露既有 Satteri WASM 可选包未安装；增加 `pnpm.supportedArchitectures.cpu = ["current", "wasm32"]` 后成功，并加入 CI 门禁。

### 真实运行 smoke

使用临时 SQLite fixture 和本地 Node 站点验证，未使用真实 Token：

- 榜单页 200；25 个 fixture 仓库、分类 tabs、搜索、语言、日期、每页与分页正常。
- `page=999&per_page=10` 被夹到 3/3 页，返回 #21–#25 五张卡片。
- 详情页 200；30/90/365 范围、指标卡、2 个 SVG small multiples、12 行表格正常。
- 图表键盘左右键更新 crosshair/tooltip；tooltip 读屏 live region、生效且无控制台错误。
- `/feeds/` 返回 301，`/hotspots/rss/` 返回 200。
- 桌面“热点”为 expandable menu；移动菜单含两个子项。
- 无数据库时页面显示“等待首次数据采集”，不触发 GitHub 请求。
- Lighthouse：榜单/详情 Accessibility 93、Best Practices 100、SEO 100、Agentic Browsing 100；3 个失败项均来自既有侧栏/页脚，而非本模块。
- 内部生产产物：正确 loopback + Origin + Secret 在缺 GitHub Token 时返回 503；错误 Secret 和伪造 XFF 均返回 404，因此未调用外部 API。

### 图表验证

Dataviz palette validator：

- Light `#2a78d6,#eb6834` against `#fcfcfb`：全部 PASS。
- Dark `#3987e5,#d95926` against `#1a1a19`：全部 PASS。
- 图表使用 Star/Fork 上下 small multiples，各自单一 Y 轴；2px line、8px endpoint、固定图例、tooltip/keyboard/table、forced-colors dash 区分。

## 4. Review 结果

- Standards Review：无残留 CRITICAL/HIGH/MEDIUM 阻塞项；文件均低于 800 行，生产新增范围无 debug/TODO/console；测试和 CI 门禁满足要求。
- Spec Review：原始目标全部满足，无阻塞缺口；HotGit 品牌/广告/AI 文案、D1 双后端、用户关注等非目标未扩入。
- Security Review：最终无 CRITICAL/HIGH/MEDIUM；已修复 Host spoofing、GraphQL soft-failure、stored URL 协议纵深、LIKE/路径边界、secret 长度时序、内部响应缓存等问题。

## 5. 计划偏差与原因

1. 原计划考虑进程内调度，因 Astro 没有适合本任务的稳定应用启动 hook且发布切换可能重复计时，改为 GitHub Actions → SSH → container loopback endpoint。
2. 原计划只从 Star/Fork 总榜建立候选，发现会遗漏突然爆发的小仓库，增加近期创建/活跃发现与 90 天滚动候选池。
3. 原计划认为 runtime hostname 可辅助 loopback 判断；安全审查证明 Host 可伪造，改为 Astro Node adapter 的 socket clientAddress + 拒绝 XFF。
4. Workers 构建暴露既有 Satteri WASM optional dependency 缺口，增加 pnpm wasm32 architecture 配置并纳入 CI。
5. 本地私有 `docs/LingerZen-部署与运维记录.md` 已同步生产运维细节和 cache bypass，但该文件由 `.git/info/exclude` 排除，不属于 Git 交付物；正式审计证据以本 Report 为准。

## 6. 遗留风险与未验证项

- 未使用真实 GitHub Token 请求官方 API；真实首轮采集必须在部署后通过手动 workflow 验证速率与候选规模。
- 未操作生产 SQLite、生产 Secrets、腾讯云目录或 GitHub Actions；不存在生产数据副作用。
- 生产 compose 仍将 4321 绑定到 `0.0.0.0`，这是既有部署架构。Trending 内部 endpoint 已用真实 socket loopback + no-XFF + Bearer 保护；关闭公网 4321 需先完成 cloudflared 容器网络迁移，作为独立运维任务处理。
- Node 22 的 `node:sqlite` 仍输出 ExperimentalWarning；项目最低版本已固定为 `>=22.13.0`，测试/Node 22/23 CI 覆盖该 API。
- Lighthouse 既有侧栏/页脚的对比度、accessible name 和触控间距问题不属于本任务。
- `docs/LingerZen_部署链路优化与目标架构设计.md` 是用户既有未跟踪文档，未修改、未纳入写集。

## 7. 回滚

- 代码回滚：恢复上一 release；`current` 与 Docker image 回滚不影响持久 SQLite。
- 数据回滚：迁移前备份位于同一持久目录；恢复前停止容器、备份当前数据库，并处理 `.sqlite`、`-wal`、`-shm`。
- 路由回滚：将 navBarConfig 恢复为 `/feeds/` 单链接并恢复原 RSS 页面；`/api/feeds.json` 全程未改。
- workflow 回滚：禁用/删除 `trending.yml` 不会删除历史数据，只会停止新快照。

## 8. 生产 rollout 清单

1. 在 `/data/LingerZen/.env` 配置 `GITHUB_TRENDING_TOKEN` 和至少 32 个随机字符的 `GITHUB_TRENDING_COLLECTION_SECRET`。
2. 确认 `/data/LingerZen/data/github-trending` 对容器运行用户可读写并可备份。
3. 正常部署新 release，确认页面显示空状态且普通浏览不触发采集。
4. 手动触发 `trending.yml`；检查 workflow 结果、collection_runs、快照数和 Star/Fork 总榜。
5. 次日确认 daily delta；7/30 天后确认 weekly/monthly baseline。
6. checkpoint 并制作首份宿主备份。
7. 验证 Cloudflare 对 `/hotspots/github/*`、`/hotspots/rss/*` 与 `/api/*` 绕过强缓存。
