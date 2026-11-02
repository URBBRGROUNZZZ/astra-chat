# Astra

一个仅保留当前会话的极简聊天网页，适配手机和桌面。纯静态前端，浏览器直接连接你配置的 API 服务。

公网地址：**https://urbbrgrounzzz.github.io/astra-chat/**

网页由 GitHub Pages 托管，电脑关机后仍可访问。向 `main` 分支推送会自动构建和发布。

## 本地运行

需要 Node.js 22.12+（或 20.19+）。

```sh
npm install
npm run dev
```

电脑访问终端显示的本地网址。手机与电脑连接同一 Wi-Fi 后，可访问终端显示的 Network 地址。开发服务器需要保持运行。

## 使用

1. 直接输入消息即可聊天，GPT / Claude 默认连接和密钥已内置，无需手动输入。
2. 在顶部选择 GPT 或 Claude，开始聊天。支持流式回复、停止、复制、Markdown、失败重试。

网页不提供连接配置、密钥输入或密钥查看功能。连接地址和模型由维护者在 `src/config.ts` 中管理。

模型切换保留当前上下文，点击「+」开启新会话。刷新或重新打开网页会清空聊天，并自动恢复内置连接。不读取旧版本的浏览器连接设置，不在浏览器存储中保存聊天或密钥，不使用 Cookie、IndexedDB 或服务端会话。OpenAI Responses 请求设置 `store: false`；中转服务自身的数据保留策略由服务方决定。

桌面使用 Enter 发送、Shift + Enter 换行；手机使用发送按钮，回车换行。复制需要 HTTPS 或 localhost；局域网 HTTP 环境可以长按选择文字复制。

## 接口兼容

| 格式 | 请求路径 | 认证 |
| --- | --- | --- |
| Responses | `/v1/responses` | `Authorization: Bearer …` |
| Anthropic Messages | `/v1/messages` | `x-api-key` |
| Chat Completions | `/v1/chat/completions` | `Authorization: Bearer …` |

地址支持域名、带 `/v1` 的基础地址和完整接口路径；自定义前缀请填写完整基础地址。GPT、Claude 均可独立改用 Chat Completions 以适配兼容中转。Messages 的默认最大输出为 8192 tokens。

服务需允许网页来源跨域请求，以及对应认证请求头。网络错误会提示检查 CORS；前端无法绕过服务端跨域限制。未添加后端或 Worker。

## 静态部署

```sh
npm run build
```

将 `dist/` 部署至 Cloudflare Pages、Netlify 或其他 HTTPS 静态托管。Cloudflare Pages 构建命令为 `npm run build`，输出目录为 `dist`。部署后，手机直接访问托管网址，不需要电脑持续运行。

若部署在 GitHub Pages 项目子路径，构建时指定对应路径，例如：

```sh
npm run build -- --base=/astra-chat/
```

按站点所有者要求，默认 API Key 使用 AES-256-GCM 加密后内置在前端，浏览器自动解密。解密材料也随网页发布，因此访问者仍可提取密钥；这只避免源码中的明文展示，不构成访问控制。

显式运行 `node scripts/embed-credentials.mjs` 可从本机 Codex / Claude 配置重新生成 `src/embedded-credentials.json`，然后提交并推送以更新线上版本。生成器不会打印或落盘明文密钥，普通构建不会读取本机配置。自动解密需要 HTTPS 或 localhost；换用其他接口地址时需要自行配置密钥。

## 验证

```sh
npx playwright install chromium webkit
npm test
npm run build
```

浏览器测试覆盖 Chromium 桌面、Android 尺寸和 iPhone WebKit，包括接口格式、上下文、刷新清空、密钥不落盘、断流、重试与停止。测试使用模拟接口，不会调用收费模型。字体随构建本地托管，不依赖 Google Fonts 在线服务。

界面使用纯黑白灰配色，字体为 Inter 与系统中文字体。首页只保留模型选择、必要操作和输入框，没有欢迎文案或推荐问题。字体授权随 `public/font-licenses/` 一并部署。

页面固定在可视区域内，仅消息区滚动。监听 Visual Viewport 的高度与偏移变化，处理手机键盘和 Safari 视口平移；输入框始终使用 16px 字号避免聚焦缩放。自动测试模拟键盘展开、收起、视口平移和多行输入；真实设备键盘仍需实机确认。
