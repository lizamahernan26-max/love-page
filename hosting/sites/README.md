# 心网网页入口

这个入口提供手机和电脑共用的 HTTPS 网址。首页自带样式、合并后的脚本、百合和数字字体，不再依赖微信另行加载这些资源。音乐及旧版资源路径仍可从 GitHub Pages 取得。`/api/` 在服务器端转发到 Neon Functions；浏览器访问同一来源，身份校验保持原样。

`worker/index.js` 只允许列出的公开资源。API 只转发心网自己的 HttpOnly Cookie，平台登录 Cookie 和身份头不会传给 Neon。API 响应不缓存；私密/共享权限由原有 Node 后端检查。已有用户身份系统保留，平台保留的登录路由不由本 Worker 实现。

运行配置 `XINWANG_API_ORIGIN` 通过 Sites 环境变量设置，不能把任何数据库连接串、恢复码或用户数据放在源码中。新建的首个身份需要本机 `hajiru/data/心网首次开通.url` 中的初始化钥匙；该文件只保留在本机。

`esbuild` 0.28.1 只用于发布时合并现有前端模块，不是服务运行依赖。`frontend/` 是从正式 hajiru 目录同步的 18 个公开文件，不能手工写入账号数据。每次发布前先执行：

```text
npm ci
node scripts/sync-frontend.mjs C:/Users/24583/Desktop/hajiru
node scripts/build.mjs
node scripts/validate-artifact.mjs
node --test tests/gateway.test.mjs
```

`tests/inline-browser-check.mjs` 在隔离数据库下故意让外部前端文件不可用，验证页面渲染和双人功能；通过 `XINWANG_SOURCE`、`PLAYWRIGHT_PATH`、`BROWSER_PATH` 指定现有测试工具。它不是在用户手机上的实测。之后可把尚未运行的检查作为官方发布 helper 的有序命令：

```json
[
  ["node", "--test", "tests/gateway.test.mjs"],
  ["node", "scripts/build.mjs"],
  ["node", "scripts/validate-artifact.mjs"]
]
```

The deterministic build produces:

```text
dist/
├── .openai/
│   └── hosting.json
└── server/
    └── index.js
```

入口在 `worker/index.js`；`scripts/inline-home.mjs` 合并前端，构建不删除原有文件。首页返回 `Cache-Control: no-store` 和 `X-Xinwang-Build`，用于核验当前构建。通过 Sites 官方 helper 同步精确源码与制品。正式前端源码仍以桌面 `hajiru` 为准，更新后必须重新同步并构建；`frontendRevision` 只影响音乐与旧资源路径。
