
<img src="./docs/images/1131.png" width = "350" height = "500" alt="LingerZen" align=right />

<div align="center">

# LingerZen
> 基于 Astro 的个人博客站点
> 
> ![Node.js >= 22](https://img.shields.io/badge/node.js-%3E%3D22-brightgreen) 
![pnpm >= 9](https://img.shields.io/badge/pnpm-%3E%3D9-blue)
![Astro](https://img.shields.io/badge/Astro-7.1.3-orange)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9.2-blue)
>
> [![Stars](https://img.shields.io/github/stars/yutianlzq/LingerZen?style=social)](https://github.com/yutianlzq/LingerZen/stargazers)
[![Issues](https://img.shields.io/github/issues/yutianlzq/LingerZen)](https://github.com/yutianlzq/LingerZen/issues)
>
> ![GitHub License](https://img.shields.io/github/license/yutianlzq/LingerZen)

</div>


---
📖 README：
**[简体中文](README.md)** | **[繁體中文](docs/README.zh-TW.md)** | **[English](README.en.md)** | **[日本語](docs/README.ja.md)** 

🚀 项目链接：
[**🖥️在线访问**](https://lingerzen.yu-tian.net/) /
[**💻GitHub 仓库**](https://github.com/yutianlzq/LingerZen)


⚡ 静态站点生成: 基于 Astro 的超快加载速度和 SEO 优化

🎨 现代化设计: 简洁美观的界面，支持自定义主题色

📱 移动友好: 完美的响应式体验，移动端专项优化

🔧 高度可配置: 大部分功能模块均可通过配置文件自定义

<table width="100%" align="center">
  <tr>
    <td colspan="3" align="center">
      <img src="./docs/images/1.webp" >
      <br>横幅模式</td>
    </td>
  </tr>
  <tr>
    <td align="center"><img src="./docs/images/3.webp" width="300"><br>透明模式</td>
    <td align="center"><img src="./docs/images/2.webp" width="300"><br>全屏壁纸模式</td>
    <td align="center"><img src="./docs/images/4.webp" width="300"><br>纯色模式</td>
  </tr>
</table>
<img alt="Lighthouse" src="./docs/images/Lighthouse.png" />

>[!TIP]
>
>LingerZen 是一个基于 Astro 和 Svelte 构建的现代化个人博客站点，提供响应式布局、多语言支持、全文搜索和丰富的配置选项。
>
>项目基于开源模板持续演进，欢迎通过 [Issue](https://github.com/yutianlzq/LingerZen/issues) 反馈问题或提出建议。

## ✨ 功能特性

### 核心功能

- [x] **Astro + Tailwind CSS** - 基于现代技术栈的超快静态站点生成
- [x] **流畅动画** - Swup 页面过渡动画，提供丝滑的浏览体验
- [x] **响应式设计** - 完美适配桌面端、平板和移动设备
- [x] **多语言支持** - i18n 国际化，UI 支持简体中文、繁体中文、英文、日文、俄语、韩文
- [x] **全文搜索** - 基于 Pagefind 的客户端搜索，支持文章内容索引

### 个性化
- [x] **动态侧边栏** - 支持配置单侧边栏、双侧边栏
- [x] **文章布局** - 支持配置(单列)列表、网格(多列/瀑布流)布局
- [x] **字体管理** - 支持自定义字体，丰富的字体选择器
- [x] **页脚配置** - HTML 内容注入，完全自定义
- [x] **亮暗色模式** - 支持亮色/暗色/跟随系统三种模式
- [x] **导航栏自定义** - Logo、标题、链接全面自定义
- [x] **壁纸模式切换** - 横幅壁纸、全屏壁纸、全屏透明壁纸、纯色背景
- [x] **主题色自定义** - 360° 色相调节

如果你有好用的功能和优化，请提交 [Pull Request](https://github.com/yutianlzq/LingerZen/pulls)

## 🚀 快速开始

### 环境要求

- Node.js ≥ 22
- pnpm ≥ 9

### 本地开发部署

1. **克隆仓库：**
   ```bash
   git clone https://github.com/yutianlzq/LingerZen.git
   cd LingerZen
   ```
   
   **如需在自己的仓库中维护副本，可以先 [Fork](https://github.com/yutianlzq/LingerZen/fork) 再克隆。**

   ```bash
   git clone https://github.com/your-github-name/LingerZen.git
   cd LingerZen
   ```
3. **配置本地环境：**
   ```bash
   cp .env.local.example .env.local
   ```
   编辑 `.env.local`，填写本地站点地址和 GitHub OAuth App 参数：
   ```dotenv
   PUBLIC_SITE_URL=http://localhost:4321
   GITHUB_CLIENT_ID=你的本地 OAuth Client ID
   GITHUB_CLIENT_SECRET=你的本地 OAuth Client Secret
   ```
   `.env.local` 已被 Git 忽略，不要提交或公开其中的 secret。

4. **安装依赖：**
   ```bash
   pnpm install
   ```

5. **启动开发服务器：**
   ```bash
   pnpm dev
   ```
   博客将在 `http://localhost:4321` 可用，CMS 地址为 `http://localhost:4321/admin/index.html#/`。

   如果需要通过 CMS 登录，GitHub OAuth App 的回调地址必须配置为：
   `http://localhost:4321/api/callback`

6. **使用本地 Docker 环境（可选）：**
   ```bash
   docker compose --env-file .env.local -f docker-compose.local.yml up --build
   ```
   Docker 服务仅绑定到本机 `127.0.0.1:4321`。停止服务：
   ```bash
   docker compose -f docker-compose.local.yml down
   ```


### 社区教程
Cloudflare Workers 部署：[【不用服务器，无需备案，零成本搭建一个自己的个人博客】](https://www.bilibili.com/video/BV1hX9XBKEhm)

### 平台托管部署
- **参考[官方指南](https://docs.astro.build/zh-cn/guides/deploy/)将博客部署至 Vercel, Netlify, Cloudflare Pages, EdgeOne Pages 等。**
- **Vercel**、**Netlify** 等主流平台自动部署，会根据环境自动选择适配器。

   框架预设： `Astro`

   根目录： `./`

   输出目录： `dist`

   构建命令： `pnpm run build`

   安装命令： `pnpm install`

   [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yutianlzq/LingerZen&project-name=lingerzen&repository-name=LingerZen)
   [![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/yutianlzq/LingerZen)

## 📖 配置说明

配置文件位于 `src/config/` 目录中，可根据需要调整站点信息、导航、侧边栏、主题和功能开关。

### 设置网站语言

要设置博客的默认语言，请编辑 `src/config/siteConfig.ts` 文件：

```typescript
// 定义站点语言
const SITE_LANG = "zh_CN";
```

**支持的语言代码：**
- `zh_CN` - 简体中文
- `zh_TW` - 繁体中文
- `en` - 英文
- `ja` - 日文
- `ru` - 俄文
- `ko` - 韩文

### 配置文件结构

```
src/
├── config/
│   ├── index.ts                  # 配置索引文件
│   ├── siteConfig.ts             # 站点基础配置
│   ├── analyticsConfig.ts        # 统计分析配置
│   ├── announcementConfig.ts     # 公告配置
│   ├── backgroundWallpaper.ts    # 背景壁纸配置
│   ├── commentConfig.ts          # 评论系统配置
│   ├── coverImageConfig.ts       # 封面图配置
│   ├── displaySettingsConfig.ts  # 设置面板配置
│   ├── dynamicConfig.ts          # 动态页面配置
│   ├── effectsConfig.ts          # 动画特效配置（樱花等）
│   ├── expressiveCodeConfig.ts   # 代码高亮配置
│   ├── fontConfig.ts             # 字体配置
│   ├── footerConfig.ts           # 页脚配置
│   ├── friendsConfig.ts          # 友链配置
│   ├── galleryConfig.ts          # 相册配置
│   ├── licenseConfig.ts          # 许可证配置
│   ├── musicConfig.ts            # 音乐播放器配置
│   ├── navBarConfig.ts           # 导航栏配置
│   ├── pioConfig.ts              # 看板娘配置
│   ├── mermaidConfig.ts          # Mermaid 图表配置
│   ├── plantumlConfig.ts         # PlantUML 图表配置
│   ├── profileConfig.ts          # 用户资料配置
│   ├── sidebarConfig.ts          # 侧边栏布局配置
│   └── sponsorConfig.ts          # 打赏配置
```

## ⚙️ 文章 Frontmatter

```yaml
---
title: My First Blog Post
published: 2023-09-09
description: This is the first post of my new Astro blog.
image: ./cover.jpg  # 或使用 "api" 来启用随机封面图
tags: [Foo, Bar]
category: Front-end
draft: false
lang: zh-CN      # 仅当文章语言与 `siteConfig.ts` 中的网站语言不同时需要设置
pinned: false    # 置顶
comment: true    # 是否允许评论
---
```

## 动态

动态文件保存在 `src/content/dynamic/` 中，一个 Markdown 文件对应一条动态。可以使用快捷命令创建：

```bash
pnpm new-d 今天心情不错，出去吃了一顿火锅
```

`pnpm new-dynamic <content>` 也可以使用，和 `new-d` 完全等价。

```yaml
---
published: 2026-07-15 16:15:29
pinned: true  # 置顶
location: China # 位置
---

动态内容可以使用 Markdown 语法。
```

也支持对接 [Memos](https://www.usememos.com/) 作为数据源，在 `src/config/dynamicConfig.ts` 中配置 `memos` 选项即可实时获取 Memos 动态，支持置顶同步和图片附件展示。

## 🧩 Markdown 扩展语法

除了 Astro 默认支持的 [GitHub Flavored Markdown](https://github.github.com/gfm/) 之外，还包含了一些额外的 Markdown 功能：

- 提醒块（Admonitions） - 支持 GitHub, Obsidian, VitePress, Docusaurus 四种风格主题配置
- GitHub 仓库卡片
- 基于 Expressive Code 的增强代码块 ([文档](https://expressive-code.com/))

## 🧞 指令

下列指令均需要在项目根目录执行：

| Command                    | Action                                 |
| :------------------------- | :------------------------------------- |
| `pnpm install`             | 安装依赖                               |
| `pnpm dev`                 | 在 `localhost:4321` 启动本地开发服务器 |
| `pnpm build`               | 构建网站至 `./dist/`                   |
| `pnpm preview`             | 本地预览已构建的网站                   |
| `pnpm check`               | 检查代码中的错误                       |
| `pnpm format`              | 使用 Biome 格式化您的代码              |
| `pnpm new-post <filename>` | 创建新文章                             |
| `pnpm new-d <content>`     | 创建一条动态                           |
| `pnpm new-dynamic <content>` | 创建一条动态（完整命令）              |
| `pnpm astro ...`           | 执行 `astro add`, `astro check` 等指令 |
| `pnpm astro --help`        | 显示 Astro CLI 帮助                    |

## 🧰 技术栈

- [Astro](https://astro.build)
- [Tailwind CSS](https://tailwindcss.com)
- [Iconify](https://iconify.design)

## 📝 许可协议

本项目遵循 [MIT license](https://mit-license.org/) 开源协议，详细查看 [LICENSE](./LICENSE) 文件。

最初 Fork 自 [saicaca/fuwari](https://github.com/saicaca/fuwari)，相关版权声明保留如下：

- Copyright (c) 2024 [saicaca](https://github.com/saicaca) - [fuwari](https://github.com/saicaca/fuwari)
- Copyright (c) 2025 [CuteLeaf](https://github.com/CuteLeaf) - [Firefly](https://github.com/CuteLeaf/Firefly)

根据 MIT 开源协议，你可以自由使用、修改、分发代码，但需保留上述版权声明。
