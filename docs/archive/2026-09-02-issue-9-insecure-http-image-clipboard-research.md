# Issue #9：局域网 HTTP 下图片剪贴板与无证书方案调研

- Status: Archived research
- Date: 2026-09-02
- Source: [GitHub Issue #9](https://github.com/lazyq666/reroll-ai-canvas/issues/9)
- Scope: Windows Chrome 通过普通局域网 HTTP 打开 Smart Canvas 时，“复制为图片”失败；重点回答能否不部署 HTTPS 证书仍写入系统图片剪贴板
- Authority: 本文是规范、Chrome 官方资料与源码级调研，不是已批准 Feature Spec；所有可行路线仍需 Windows 真机复制、粘贴与权限验收

## 结论摘要

1. **如果条件限定为“普通、未受管理的 Chrome + 局域网 HTTP + 不安装任何客户端能力”，无法把当前一键 `PNG Blob → 系统图片剪贴板` 做成可靠产品能力。** Clipboard API 把 `Navigator.clipboard`、`Clipboard` 与 `ClipboardItem` 标记为 `SecureContext`；普通局域网 IP 的 HTTP Origin 不在 Secure Contexts 规范列出的默认可信来源中，而 `127.0.0.0/8`、`::1` 和符合要求的 `localhost` 属于例外。[Clipboard API 规范](https://www.w3.org/TR/clipboard-apis/#navigator-interface)；[Secure Contexts：Potentially Trustworthy Origin](https://www.w3.org/TR/secure-contexts/#is-origin-trustworthy)
2. **可以不部署证书，但必须把信任或剪贴板能力移到浏览器网页之外。** 可行路线有：Chrome 企业策略/启动参数把精确 HTTP Origin 视为可信、Chrome 扩展、每台客户端的 Loopback Relay/SSH Tunnel、桌面壳或本地助手。它们不是网页“绕过”了安全边界，而是管理员、扩展 Origin、Loopback 例外或原生程序承担了信任。
3. **受控 Windows 小团队的最低改动短期方案是 Chrome 策略。** Chrome 官方 `OverrideSecurityRestrictionsOnInsecureOrigin` 策略允许为旧式内网应用或测试环境指定免除不安全 Origin 限制的 URL；官方说明它等价于 `--unsafely-treat-insecure-origin-as-secure`。配置精确的 `http://<LAN-IP>:<port>/`、重启 Chrome 后，当前 `navigator.clipboard.write(new ClipboardItem({'image/png': ...}))` 路径理论上可继续工作，但仍要通过权限、用户激活及 Windows 真机验收。[Chrome Enterprise Policy](https://chromeenterprise.google/policies/override-security-restrictions-on-insecure-origin/)
4. **该策略不适合 Reroll 自动开启或作为默认公开支持。** Secure Contexts 规范明确指出：对未认证 Origin 授予强能力，在存在网络攻击者时等价于把能力授予任意能篡改该连接的来源。HTTP 页面脚本、图片和 Session 都可被同网段中间人观察或替换；策略只是让 Chrome 放行能力，不会加密或认证连接。[Secure Contexts Threat Model](https://www.w3.org/TR/secure-contexts/#threat-models-risks)
5. **`copy` 事件 / `document.execCommand('copy')` 不是当前 Windows Chrome 的可信替代。** Clipboard Event API 是同步路径，规范明确说它不支持图片转码等可能阻塞的操作；更关键的是，当前 Chromium 的 `SystemClipboard::WriteDataObject` 只把 `StringItem` 写成文本、HTML 或自定义字符串，没有把事件 `DataTransferItemList` 中的 `FileItem` 写成位图。Chromium 的位图写入有另一条内部 `WriteImage` 路径，适合浏览器原生“复制图片”或 Async Clipboard，而不是普通 HTTP 页面用事件数据稳定调用。[Clipboard API：同步事件限制](https://www.w3.org/TR/clipboard-apis/#clipboard-event-api)；[Chromium `SystemClipboard::WriteDataObject`](https://chromium.googlesource.com/chromium/src.git/+/1c3b4697164454c74430bd50a530202f5d05a719/third_party/blink/renderer/core/clipboard/system_clipboard.cc)；[Chromium Clipboard Host `WriteImage`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/renderer_host/clipboard_host_impl.cc)
6. **建议产品决策分两层。** 内部临时使用可支持“管理员配置精确 Chrome 策略”，并明确标记为受控环境方案；普通用户仍以 HTTPS 为首选。若产品坚持“无证书、仍一键复制”，Chrome-only 可评估扩展，跨浏览器/更强系统集成可评估本地助手或桌面壳。无安装、无策略时，应提供“下载 PNG / 新标签页打开并使用浏览器原生复制图片”的诚实降级，而不是显示通用失败。

## 一、Issue 与仓库当前实现

### 1.1 Issue 的真实边界

Issue #9 已明确区分两类访问：

- 本机回环地址成功，不能证明局域网访问成功；
- Windows Chrome 通过普通局域网 HTTP 打开 Smart Canvas 时，二进制图片剪贴板可能不可用；
- 待评估方向包括 HTTPS、桌面壳和浏览器扩展，并要求 Windows 真机复制与粘贴验收。

这不是图片 URL、PNG 编码或右键菜单单点故障，而是部署 Origin 与浏览器能力边界。[Issue #9](https://github.com/lazyq666/reroll-ai-canvas/issues/9)

### 1.2 当前代码已经完成 PNG 兼容处理

当前 `smartClipboardPngBlob()` 会：

1. 对外部媒体通过同源 `/api/download-output` 获取；
2. 已是 `image/png` 时直接返回 Blob；
3. 其他图片经 `createImageBitmap` / `Image`、Canvas、`toBlob('image/png')` 转码；
4. `copySmartImageToClipboard()` 先尝试 Promise-backed `ClipboardItem`，失败后等待 PNG 完成并重试 resolved Blob。

最终系统写入只有一条：`navigator.clipboard.write([new ClipboardItem({'image/png': png})])`。当 `navigator.clipboard.write` 或 `ClipboardItem` 不存在时，代码立即返回“当前浏览器无法复制此图片”。因此继续修改 PNG Blob 形态不会解除普通 LAN HTTP 的 Secure Context Gate。[Smart Canvas 剪贴板实现](../../static/js/smart-canvas.js#L11143-L11231)；[双语失败提示](../../static/js/i18n/smart-canvas.js#L404-L406)

### 1.3 当前部署为什么出现“本机能用、局域网不能用”

启动器默认监听 `127.0.0.1`，本机 URL 也是 `http://127.0.0.1:<port>/`；显式设置 `INFINITE_CANVAS_HOST=0.0.0.0` 后才输出 `http://<LAN-IP>:<port>/`。[Launcher](../../backend/launcher.py#L274-L294)；[LAN 输出](../../backend/launcher.py#L1001-L1014)

Secure Contexts 规范把 `http://127.0.0.1`、`http://[::1]` 和满足本地解析要求的 `http://localhost` 视为 Potentially Trustworthy，但没有把 `http://192.168.x.x`、`http://10.x.x.x` 等普通私网地址列为默认可信。因此同一份代码在本机 HTTP 和 LAN HTTP 上能力不同是标准设计，不是 Chrome 偶发现象。[Secure Contexts](https://www.w3.org/TR/secure-contexts/#is-origin-trustworthy)

仓库自己的安全边界也说明：默认只监听回环地址；仅改变 Bind Address 不会自动获得 HTTPS、Secure Cookie、Trusted Origin 或访问控制。[Security Policy](../../SECURITY.md#L8-L12)

### 1.4 本次 Chrome 机制实测

2026-09-02 使用 macOS Google Chrome `152.0.7977.75`、独立无头 Profile 和临时 HTTP 页面做了三组机制探针；该结果用于证明 Chrome Gate 与候选路径，**不能代替 Issue 要求的 Windows 真机验收**：

| 场景 | `isSecureContext` | Clipboard API Surface | 系统剪贴板读回 |
| --- | --- | --- | --- |
| `http://127.0.0.1:<port>/` | `true` | `navigator.clipboard` 与 `ClipboardItem` 存在 | Async Clipboard 成功写入 `image/png` |
| `http://<LAN-IP>:<port>/` | `false` | 两者均不暴露 | 无法调用当前实现 |
| LAN HTTP + 精确 `--unsafely-treat-insecure-origin-as-secure=<origin>` | `true` | 两者均存在 | 当前同形的 `ClipboardItem({'image/png': Blob})` 成功写入，并以 `image/png` 读回 |

另行探测了两种旧路径：在 `copy` 事件的 `DataTransferItemList` 中加入 PNG File，以及选中真实 `<img>` 后执行 `document.execCommand('copy')`。命令本身返回成功，但从系统剪贴板读回时分别只有文本或 `text/html`，没有 `image/png`。这与下文 Chromium 源码路径分析一致，也说明不能用“`execCommand` 返回 `true`”当作图片复制成功证据。

## 二、为什么网页内“换 API”不能可靠解决

### 2.1 Async Clipboard 的对象本身受 Secure Context 限制

Clipboard API WebIDL 对三个关键入口都声明了 Secure Context：

- `Navigator.clipboard`；
- `Clipboard` 接口及 `write()`；
- `ClipboardItem` 构造与图片 MIME 表示。

规范将 `image/png` 定义为强制支持的数据类型之一，但“支持 PNG”与“允许任意 HTTP Origin 调用”是两件事；前者不取消 Secure Context 与权限检查。[Clipboard API：Navigator](https://www.w3.org/TR/clipboard-apis/#navigator-interface)；[Clipboard API：ClipboardItem](https://www.w3.org/TR/clipboard-apis/#clipboarditem-interface)；[Clipboard API：Clipboard](https://www.w3.org/TR/clipboard-apis/#clipboard-interface)

服务端无法通过响应 JSON、CORS Header、Content-Security-Policy 或 JavaScript Feature Detection 把自己的 HTTP Origin 变成 Secure Context。规范只认协议、回环 Host、浏览器认定的认证 Scheme，或浏览器/管理员显式配置的可信 Origin。[Secure Contexts Algorithm](https://www.w3.org/TR/secure-contexts/#is-origin-trustworthy)

### 2.2 `execCommand('copy')` / Clipboard Event 的 Chromium 限制

Clipboard Event API 可以在用户的 Copy Action 中同步修改 `event.clipboardData`，但规范明确指出同步 API 不支持请求权限、图片转码等可能阻塞的工作，复杂能力应使用 Async Clipboard。[Clipboard Event API](https://www.w3.org/TR/clipboard-apis/#clipboard-event-api)

即使在用户点击前预先生成 PNG，并在 `copy` 事件里向 `DataTransferItemList` 加入 File，当前 Chromium 的事件写入实现仍不会把这个 File Item 走位图写入：

- `ClipboardCommands` 在事件被 `preventDefault()` 后调用 `SystemClipboard::WriteDataObject()`；[Chromium Clipboard Commands](https://chromium.googlesource.com/chromium/src/+/ed24ed8d5d252861027896878fceecb5a453183b/third_party/blink/renderer/core/editing/commands/clipboard_commands.cc)
- `WriteDataObject()` 遍历对象时只处理 `WebDragData::StringItem`，写 Text、HTML 与 Custom String；[Chromium System Clipboard](https://chromium.googlesource.com/chromium/src.git/+/1c3b4697164454c74430bd50a530202f5d05a719/third_party/blink/renderer/core/clipboard/system_clipboard.cc)
- 真正位图写入由独立的 `WriteImage()` 进入浏览器进程剪贴板实现。[Chromium Clipboard Host](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/renderer_host/clipboard_host_impl.cc)

因此可以把“选择一个真实 `<img>`，再触发浏览器默认 Copy”做成探索性原型，但不能把它当作稳定合同：结果可能是 HTML/URL 而不是 Windows 位图，也受选区、焦点、Chrome 版本和粘贴目标影响。原生浏览器菜单“复制图片”可用，是浏览器自身调用内部图片路径，不证明页面脚本拥有同等能力。

### 2.3 不能靠 iframe 或另一个 HTTPS 页面代写

Secure Contexts 会检查祖先链：不安全顶层页面嵌入 HTTPS iframe 时，内嵌 Document 也不因此成为 Secure Context。这阻止 HTTP 页面用一个“隐藏 HTTPS 剪贴板 iframe”洗白来源。[Secure Contexts：Framed Documents](https://www.w3.org/TR/secure-contexts/#framed-documents)

把图片 POST 给另一个 HTTPS 页面并跳转过去可以在新页面完成复制，但这已经要求一个 HTTPS Origin，而且会引入跨 Origin Session、用户激活和返回体验，不属于无证书方案。

## 三、无证书可行路线

### 3.1 Chrome 管理策略：最小代码改动，适合受控内网

Chrome 官方策略 `OverrideSecurityRestrictionsOnInsecureOrigin`：

- 支持 Windows、macOS、Linux 与 Android；
- 接受精确 Origin URL 或 Hostname Pattern；带 Scheme 的 URL 必须精确匹配；
- 官方用途包括无法部署 TLS 的旧式应用和内部开发测试；
- 等价于 `--unsafely-treat-insecure-origin-as-secure=<origins>`；
- Windows Registry 路径是 `Software\Policies\Google\Chrome\OverrideSecurityRestrictionsOnInsecureOrigin`；
- 修改后需重启浏览器。[Chrome Enterprise Policy](https://chromeenterprise.google/policies/override-security-restrictions-on-insecure-origin/)

对本项目的含义：管理员可在每台受控 Windows 机器上只加入当前 Reroll 的精确 Origin，例如 `http://192.168.1.23:3000/`，然后复用现有 Clipboard API 代码。不要使用 `*.local`、整个私网段或宽泛 Hostname Pattern；服务 IP/端口变化也需要同步策略。

**仍需验证：**

- `window.isSecureContext === true`；
- `navigator.clipboard.write` 与 `ClipboardItem` 存在；
- 用户点击菜单和快捷键两条路径都保留 Transient Activation；
- Windows 剪贴板目标至少覆盖画图、微信/企业微信、Photoshop/Figma 或项目实际支持矩阵；
- 浏览器重启、策略撤回、Origin 变化后反馈正确；
- 图片较大、透明 PNG、非 PNG 源图和远端媒体都能完成。

**风险：**策略只是命令 Chrome 信任 HTTP Origin，不会给 HTTP 增加加密和服务身份认证。同网段可篡改流量的人可以替换应用脚本，在受信任 Origin 权限内调用更多 Secure Context 能力；图片、Prompt、Session Cookie 也仍通过明文网络。仓库不应静默写注册表、为用户自动启动带该 Flag 的日常 Chrome，或把这条路线描述为“安全等同 HTTPS”。

### 3.2 独立 Chrome 启动参数：只适合开发/现场验证

Chrome 官方策略文档确认同名策略与命令行 `--unsafely-treat-insecure-origin-as-secure` 等价。因此可以用独立测试 Profile 启动 Chrome，把一个精确 Origin 临时视为可信，快速证明 Issue 的失败确实来自 Secure Context Gate。[Chrome Enterprise Policy](https://chromeenterprise.google/policies/override-security-restrictions-on-insecure-origin/)

这不适合普通用户：

- 用户必须从特定入口启动独立 Chrome 实例；
- 容易误用到日常 Profile；
- Origin 变化需更新启动参数；
- 仍承受上一节全部 HTTP 网络风险。

建议把它定位为 Windows QA 诊断工具，不是产品交付机制。

### 3.3 Chrome 扩展：可做一键复制，代价是安装与权限

Chrome Extension 可以把剪贴板写入放在扩展 Origin，而非不安全网页 Origin：

1. Content Script 在 Reroll 页面接收“复制当前图片”的明确用户动作；
2. 取得项目已经转换好的 PNG Bytes，或访问同源下载接口；
3. 通过 `chrome.runtime` 消息发送到扩展的 Offscreen Document；
4. Offscreen Document 以 `CLIPBOARD` Reason 使用 DOM Clipboard API 写入 `image/png`。

Chrome 官方资料确认：

- Manifest 的 `clipboardWrite` 允许扩展用 Web Platform Clipboard API 修改剪贴板，并显示“修改您复制和粘贴的数据”权限警告；[Extension Permissions](https://developer.chrome.com/docs/extensions/reference/permissions-list#clipboardWrite)
- Manifest V3 的 `chrome.offscreen` 在 Chrome 109+ 可创建隐藏 Document，`CLIPBOARD` 是专门的使用 Reason；Offscreen Document 只开放有限 Extension API，需要用 `runtime` 消息通信。[Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- 扩展访问指定 LAN Origin 还需精确的 Content Script Match/Host Permission；Host Permission 可用于向匹配 Origin 发起 Fetch 或注入脚本。[Declare Permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions#host-permissions)

优势是普通 LAN HTTP 页面不再需要 Secure Context；缺点是 Chrome-only、需要安装/更新/权限提示、要维护扩展与网页协议版本，并防止任意网页或任意图片触发扩展写剪贴板。扩展必须校验发送者 Tab 的精确 Origin、仅响应显式用户动作、限制 PNG 尺寸，并避免通配所有内网 Host。

### 3.4 Loopback Relay / SSH Tunnel：利用规范的本机例外

Secure Contexts 规范明确把 `127.0.0.0/8`、`::1` 与合规 `localhost` 视为 Potentially Trustworthy。因此每台 Windows 客户端若通过本机端口访问完整 Reroll Origin，例如 `http://127.0.0.1:3000/`，Clipboard API 可继续工作而无需证书。[Secure Contexts](https://www.w3.org/TR/secure-contexts/#is-origin-trustworthy)

远端服务可通过两种方式映射成本机 Origin：

- 用户手工建立 SSH Local Port Forward；
- 安装一个 Reroll Local Relay，代理 HTTP、WebSocket、Cookie 与媒体请求到 LAN 服务。

这不是把远端 IP 命名成 `localhost`；规范要求 `localhost` 不得解析到非回环地址。简单改 Hosts 文件让 `reroll.localhost` 指向另一台机器不应被视为合规方案。[Secure Contexts：localhost](https://www.w3.org/TR/secure-contexts/#localhost)

SSH Tunnel 的远端链路有加密和主机认证，安全性优于裸 HTTP Relay；但两者都有每台客户端安装/连接、端口冲突、WebSocket 代理、Session Origin 与自动重连成本。若已经接受本地安装，Chrome 扩展或桌面壳通常有更清晰的产品入口。

### 3.5 桌面壳 / 本地助手：最稳的系统剪贴板，工程成本最高

桌面程序可以直接调用操作系统剪贴板，不受网页 Secure Context Gate。以 Electron 为例，官方 `clipboard` Main Process API 支持包含 `image/png` Blob 的 `ClipboardItem` 并原子写入系统剪贴板。[Electron Clipboard](https://www.electronjs.org/docs/latest/api/clipboard)

可选形态：

- 整个 Reroll 作为桌面壳加载本地/远端服务；
- 网页通过自定义协议或本地 Loopback API 把 PNG 交给轻量助手；
- 扩展通过 Native Messaging 交给助手。

这条路线能提供最确定的 Windows 图片剪贴板格式控制，但要新增安装包、签名、更新、进程生命周期、端口/协议认证和恶意网页调用防护。若只为一个 Copy Action 引入整套桌面 Runtime，成本明显高于 HTTPS 或 Chrome 扩展。

### 3.6 无安装降级：下载或使用浏览器原生“复制图片”

普通 LAN HTTP 仍可：

- 下载标准 PNG；
- 在新标签页打开同源图片，再让用户用 Chrome 原生右键“复制图片”；
- 显示可操作的说明和“为什么不可用”，而不是泛化为图片本身失败。

这不满足“一键复制”，但不会要求用户降低浏览器安全，也不会虚假报告复制成功。Chromium 内部有专门的 Bitmap `WriteImage` 路径，浏览器原生图片菜单可以使用该路径；网页自定义菜单不自动获得同等权限。[Chromium Clipboard Host](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/renderer_host/clipboard_host_impl.cc)

## 四、方案比较

| 路线 | 无 HTTPS 证书 | 保留一键复制 | 用户/管理员成本 | 安全边界 | 跨浏览器 | 本项目判断 |
| --- | --- | --- | --- | --- | --- | --- |
| 普通 LAN HTTP 网页改 JS | 是 | **否，不能可靠实现** | 低 | 不可信 HTTP Origin | 理论上广，但能力被拒绝 | 排除 |
| Chrome 管理策略 | 是 | 是，复用当前代码 | 每台设备或 GPO 配置、重启 | 主动信任指定 HTTP Origin | Chrome/Chromium 管理环境 | **内部短期首选** |
| Chrome 独立启动 Flag | 是 | 是，复用当前代码 | 每次从专用入口启动 | 同上，且易误用 | Chrome | 仅 QA / 诊断 |
| Chrome 扩展 | 是 | 是 | 安装、权限、发布与更新 | 扩展承担剪贴板权限 | Chrome 为主 | **Chrome-only 产品候选** |
| Loopback Relay / SSH Tunnel | 是 | 是，网页仍走当前代码 | 每台客户端建立本地入口 | Loopback 可信；远端链路另行保证 | 支持 Loopback Secure Context 的浏览器 | 技术团队候选 |
| 桌面壳 / 本地助手 | 是 | 是 | 安装包、签名、更新、原生协议 | 原生应用能力 | 取决于壳 | 跨系统集成候选 |
| 下载 PNG / 新标签页原生复制 | 是 | 否，多一步 | 低 | 不降低浏览器安全 | 广 | **默认降级** |
| HTTPS + 受信任证书 | 否 | 是，复用当前代码 | 部署证书与续期 | 标准加密、认证 Origin | 最广 | **普通产品首选** |

## 五、推荐决策

### 5.1 若当前只服务受控 Windows 内网设备

建议先做一个不改业务代码的 Windows 真机 Spike：

1. 管理员只为一个固定 Reroll Origin 配置 `OverrideSecurityRestrictionsOnInsecureOrigin`；
2. 重启 Chrome，确认 `window.isSecureContext`、Clipboard API Surface 与权限状态；
3. 使用现有 Smart Canvas Copy Action，向至少三个真实 Windows 目标程序粘贴；
4. 验证透明 PNG、大图、JPG/WebP 转 PNG、快捷键与右键菜单；
5. 撤回策略再验证产品显示精确降级反馈；
6. 记录 Chrome 版本、Windows 版本、策略值、目标程序和粘贴结果。

若 Spike 通过，可以把它文档化为“受控内网管理员方案”，不是默认安装行为。支持条件必须写明固定 Origin、Chrome 受管理、浏览器重启和风险接受人。

### 5.2 若要面向普通用户

优先级建议：

1. **HTTPS**：唯一无需安装浏览器扩展/本地助手、又能保留标准网页体验的通用路线；
2. **诚实降级**：检测 `!window.isSecureContext || !navigator.clipboard?.write || !window.ClipboardItem` 时，显示“当前为局域网 HTTP，Chrome 不允许网页直接复制图片”，提供下载 PNG / 新标签页打开；
3. **Chrome 扩展**：只有在用户群明确集中于 Chrome、且一键复制价值足以覆盖安装权限成本时立项；
4. **桌面壳/本地助手**：只在还需要文件系统、快捷键、后台任务等多项原生能力时一起论证，不为单个剪贴板动作单独引入。

### 5.3 不建议

- 静默修改 Windows Registry 或默认 Chrome 安全策略；
- 启动日常 Chrome 时使用宽泛 `--unsafely-treat-insecure-origin-as-secure`；
- 把整个私网、通配域名或不固定端口加入可信列表；
- 依赖 `document.execCommand('copy')` + Blob/File 作为 Windows 图片剪贴板合同；
- 用 Hosts 把远端服务器伪装成 `localhost`；
- 使用用户忽略证书错误的自签名 HTTPS，并把它描述为可信 Secure Context；
- 在失败时仍显示“图片已复制”，或只给“当前浏览器无法复制此图片”而不说明 LAN HTTP 原因和下一步。

## 六、建议的 Windows 验收矩阵

| 变量 | 至少覆盖 |
| --- | --- |
| Origin | `http://127.0.0.1`；普通 LAN HTTP；LAN HTTP + 精确 Chrome Policy；最终 HTTPS |
| Chrome 状态 | 新 Profile；已有 Profile；策略刚应用未重启；重启后；策略撤回 |
| 入口 | Node 右键菜单；`Ctrl+Shift+C`；多图中的指定图片 |
| 图片 | 透明 PNG；JPG；WebP；较大分辨率；外部媒体经下载代理；Workspace Managed Media |
| 粘贴目标 | Windows 画图；至少一个聊天工具；至少一个设计/图像工具 |
| 失败 | API Surface 缺失；权限拒绝；用户激活丢失；媒体下载失败；PNG 转码失败；剪贴板被系统策略拦截 |
| 反馈 | 中文/英文；失败原因可区分；下载/打开图片降级可操作；不得假成功 |

## 七、最终回答

**有可能不部署安全证书实现，但不能只靠普通网页代码绕过。**

- 对受控 Windows 内网：可以用 Chrome 企业策略把**一个精确 LAN HTTP Origin**视为可信，最有机会零改动复用现有 PNG Clipboard API；它是管理员承担风险的临时/内部方案。
- 对 Chrome-only 产品：可以做扩展，把系统剪贴板权限放在扩展 Offscreen Document。
- 对需要更稳定原生能力的产品：可以做 Loopback Relay、桌面壳或本地助手。
- 对普通未管理 Chrome、无扩展、无本地程序、无 HTTPS：不能可靠保留“一键复制为图片”；应降级为下载或浏览器原生复制。

所以 Issue #9 不应继续寻找“另一个 Blob 写法”，而应由产品先选择访问边界：**标准 HTTPS、受控 Chrome 策略、扩展/桌面端，或接受多一步降级。**
