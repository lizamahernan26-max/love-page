# 心网

当前版本 **0.5.0**，正式开发目录 `C:\Users\24583\Desktop\hajiru`。保留暗色星空、粉色粒子爱心、百合、楷体计时与《偏爱》，支持两人共享、各自私密记录，以及女朋友无需账号密码的专属邀请入口。

**免费方案：GitHub 保存代码，Sites 提供统一网页入口，Neon Free 的 Functions 与 PostgreSQL 提供双人服务和保存记录。** 不再使用要求绑卡的 Render。正式网址为 <https://xinwang-lhw-wyr-1027.lizamahernan26.chatgpt.site>；GitHub Pages 单独只能展示页面。部署与首次开通见 [免费上线](docs/免费上线.md)。

首次由你在电脑双击 `data/心网首次开通.url`，自行设置账号和密码，再生成她的专属邀请链接。首次开通文件包含私人初始化钥匙，只保留本机；不要发给她或上传。手机之后使用正式网址，你登录自己的账号，她使用一次邀请进入。已有本机账号和记录不自动上传。

## 启动与创建两个账号

需要 Node.js **24.14—24.x**。本机 SQLite 入口无需运行依赖；云端 PostgreSQL 使用锁定版本的 `pg`，先运行 `npm ci`。

1. 双击 **start.cmd**，打开 <http://127.0.0.1:8790/>；也可运行 `npm start`。
2. 进入“账号与绑定”，在电脑本机创建自己的账号，自己设置密码。
3. 登录后点击“生成她的免登录邀请链接”，私下发给女朋友。她在自己的手机点开，再点“进入我们的心网”，无需注册或输入密码。
4. 她独立保存首次显示的恢复码；同一浏览器以后自动进入。换手机、退出或清除网站数据后用恢复码进入，旧设备退出，恢复码也会更新。你不能从自己的页面取得她的恢复码。

原有密码账号和邀请码注册方式仍保留。已建立的第二个身份不能被新邀请覆盖；两人不能共用同一份身份凭证。

身份最多两个，邀请 24 小时有效且一次使用。密码账号会话 14 天；免密码身份活跃使用时续期，连续 90 天不使用需恢复码。共同姓名、纪念日也会同步；音乐音量保留为设备设置。页面展示姓名不是登录身份。

## 记录怎样可见

- **仅本人可见**：服务器只返回给作者账号，对方列表里没有这条内容；猜到编号也不能查看、修改或删除。
- **两人共享**：当前绑定双方可读，只有作者可改删；前台约每 5 秒、回到网页或手动同步时更新。
- **解除绑定**：双方各自保留自己写的内容，对方不再能读取共享记录。重新绑定不会自动重新发布旧共享记录。
- **不同设备同时修改**：拒绝旧版本覆盖，输入草稿保留。断网不会伪装保存成功，没有离线自动发送队列。

这是**账号之间的后端权限隔离**。记录正文仍存放在服务器数据库中，服务器维护者可访问；尚无正文存储加密或端到端加密。正式使用需 HTTPS，本机/局域网 HTTP 只做开发验证。

## 手机开发预览

先用电脑 8790 入口创建第一个测试账号，再双击 **start-phone.cmd** 或运行 `npm run start:phone`。脚本输出同 Wi-Fi 手机可用的 `http://局域网地址:8791/`，共用同一个后端数据库。

这个 HTTP 地址仅用于测试密码和测试文字，不适合真实私密内容。不同网络使用上面的正式 HTTPS 网址。

## 数据与备份

真实账号记录保存在 `data/xinwang.sqlite`；页面不把账号记录、密码或登录令牌写入 localStorage。会话使用 HttpOnly Cookie。退出或切换账号会清理页面里的记录和草稿，修改密码会使其他设备旧会话失效。

“备份与迁移旧记录”可导出自己写的记录；旧 JSON 文件经预览确认后导入，**全部先作为仅本人可见**，避免旧“想对你说”分类直接发布给对方。备份文件未加密，不包含未保存草稿。

旧版 localStorage 副本不归属于账号，仍未加密，不会自动读取、上传或删除。原型入口可用 `npm run preview` 打开 8787；只有该入口明确返回本地模式时才启用旧功能。后端无法连接时不会自动降级去读取旧记录。

维护者运行 `npm run backup:db` 可在线备份本机 SQLite 到 `data-backups/`；云端 Neon 需要独立的 PostgreSQL 备份，不能使用这个命令冒充云备份。这与用户“导出我的记录”不同，包含双方所有数据，应受控保管。恢复方法见部署文档；不要在运行时直接覆盖数据库。

## 检查与打包

```powershell
npm test
npm run test:browser
npm run test:pair-browser
npm run test:device-browser
npm run package:server
```

Node 内置测试覆盖计时、本地功能、真实后端权限、会话、并发、数据库备份和打包边界。浏览器检查另用当前已有的 Playwright 与 Chrome；可通过 `PLAYWRIGHT_PATH`、`BROWSER_PATH` 指定开发工具，它们不是网站运行依赖。

`deploy-output/` 是完整后端部署包，排除真实数据库、.env、测试及所有备份。`npm run build` 仍只生成 `dist/` 静态资源，**仅部署 dist 无法提供双人功能**。任何已有额外文件会使打包停止，不自动删除。

## 维护结构

```text
hajiru/
  index.html                       页面、账号面板、设置与心里话容器
  assets/                          百合与本地字体
  js/heart.js, music.js             原爱心、情话与音乐
  js/app.js                        页面计时与共同设定连接
  js/online-api.js                  同源会话与同步客户端
  js/online-space.js                双人账号、记录与备份界面
  js/whisper-store.js, whispers.js   保留的本地原型功能
  server/app.mjs                   HTTP API、会话、来源与 CSRF 检查
  server/database.mjs              SQLite、绑定与逐条记录权限
  server/security.mjs              密码摘要、输入及令牌工具
  server/start.mjs                 本机 SQLite 后端启动
  server/database-postgres.mjs     云端 PostgreSQL、事务与权限
  server/cloud.mjs, start-cloud.mjs Render HTTPS 适配及启动
  render.yaml                     仅 Free 服务的部署配置
  scripts/                         预览、构建、部署包、数据库备份
  data/                            真实数据库，忽略提交及公开构建
  tests/                           独立数据库和浏览器验证
  docs/                            需求、进展、运行部署与验证记录
```

原姓名“梁桓伟 / 王艳茹”与北京时间 `2024-05-25 00:20` 来自用户参考文件。原网页在 `reference/index.original.html` 和 `backup-before-xinwang-20261026/`，每轮修改前另存备份。音乐 `pianai.mp3` 未替换；原 SHA256 为 `AC5DF61DB6E80D3673099A7175E5C6EA7E582A82BCE27BDDA55E4EC9BBF4C464`。上线前还需确认音乐及公开展示范围。

更多说明：[需求与边界](docs/需求与边界.md)、[项目进展](docs/项目进展.md)、[验证记录](docs/验证记录.md)、[字体来源](docs/字体来源.md)。
