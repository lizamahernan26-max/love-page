# 心网网页入口

这个入口提供手机和电脑共用的 HTTPS 网址。静态页面取自已发布的 GitHub Pages，`/api/` 在服务器端转发到 Neon Functions。浏览器访问同一个来源，避免手机浏览器阻止跨站身份 Cookie。

`worker/index.js` 只允许列出的公开资源。API 只转发心网自己的 HttpOnly Cookie，平台登录 Cookie 和身份头不会传给 Neon。API 响应不缓存；私密/共享权限由原有 Node 后端检查。已有用户身份系统保留，平台保留的登录路由不由本 Worker 实现。

运行配置 `XINWANG_API_ORIGIN` 通过 Sites 环境变量设置，不能把任何数据库连接串、恢复码或用户数据放在源码中。新建的首个身份需要本机 `hajiru/data/心网首次开通.url` 中的初始化钥匙；该文件只保留在本机。

Pass these argument arrays as `commands`:

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

源代码在 `worker/index.js`；构建不删除原有文件。发布前运行上面的测试和构建，并通过 Sites 官方 helper 同步精确源码与制品。静态源码仍以桌面 `hajiru` 项目为准。
