# Issue #196：实时指针与在线头像 Presence / Awareness 调研

> Status: Draft Research；不是已批准规格，也不定义 Current 行为
> Date: 2026-08-29
> Source: GitHub Issue #196
> Scope: WebSocket Presence / Awareness 消息模型、更新频率、带宽与单后端成本、断线清理、隐私与安全
> Out of scope: 业务代码实现、Issue 状态变更、正式容量承诺、账号头像资料功能

> 后续产品决定：本调研给出的是工程建议，不是批准规格。2026-08-29 的产品访谈进一步选择了 Account 级单 Pointer、多 Connection 聚合、全产品默认 Account Avatar、右上成员组、5px Movement Threshold、可配置更新间隔与 Server Batch；权威目标见 [Smart Canvas 实时在场状态、指针与账号头像](2026-08-29-smart-canvas-realtime-presence.md)。

## 结论摘要

在当前“单进程、单 Uvicorn Worker、同一 Smart Canvas 以 10 名 Realtime Collaborator 为产品目标”的边界内，实时指针与在线成员标识可以做，且**不需要把整个 Canvas Sync 改成 CRDT**。更合适的方案是借鉴 Yjs Awareness 的语义，在现有 Canvas WebSocket 上增加一条独立、内存态、可过期、latest-wins 的 Presence 通道：

1. Presence 不写 SQLite、Canvas Snapshot、Canvas Revision、Mutation History、Undo 或 Canvas Updated Time。
2. Presence 以 **Realtime Client Connection** 为状态主体；同一 Account 的不同标签页可以有不同指针。在线头像列表可以按 Account 聚合，但不能用 Account ID 替代指针的连接身份。
3. 首版以 `100 ms` 节流，即每个活动指针最高 `10 Hz`。客户端在两次远端更新之间用插值或短过渡平滑显示，不把每个 `pointermove` 或每一帧都送到服务端。
4. 服务端只转发最新坐标，不向发送者回显；慢客户端的旧坐标应覆盖或丢弃，不能挤占必须有序送达的 Canvas Mutation，也不能因 Presence 积压触发 Canvas Resync。
5. 在“10 个连接全部持续移动、每条下行 Presence 约 117 B”的保守估算下，`10 Hz` 约产生 `100` 条入站和 `900` 条下行消息每秒，WebSocket 应用数据加基础帧头约 `0.93 Mbit/s`；`20 Hz` 约 `1.87 Mbit/s`；`60 Hz` 约 `5.60 Mbit/s`。这些是计算模型，不是实测容量结论，且未包含 TLS、TCP/IP、代理和重传开销。
6. 当前账号公共资料只有 `id`、`username`、`display_name`、`role`、`status`，没有头像 URL 或头像资产字段。Issue 的第一阶段可显示服务端生成的颜色圆形与首字母；真正的图片头像会扩大到账号资料、上传/存储、默认图、删除与隐私合同，应单独立项。
7. 服务端必须从已认证 Session 派生 `user_id`、显示名和颜色，不能接受客户端自报的名字、角色或头像。Yjs Awareness 协议也明确说明 Awareness Payload 本身不负责认证，权威身份必须由更高层保证。

## 一、证据分类

本文刻意区分三类内容：

- **来源事实**：由官方规范、官方文档、项目源码或仓库 Current 文档直接支持。
- **估算**：按明确公式和假设计算，只用于判断量级。
- **建议**：针对本仓库边界提出，仍需产品评审、实现与负载测试验证。

## 二、仓库当前边界

### 2.1 来源事实：现有实时通道

- 同一 Smart Canvas 默认最多 `20` 条 Realtime Client Connection；Connection Manager 为每条连接创建独立发送队列。证据：`backend/infinite_canvas/connection_manager.py:14-18`、`:208-235`。
- 当前发送队列最多 `64` 条或 `16 MiB`；超过上限会关闭该 Canvas Socket 并要求重新同步。Canvas Mutation 还会检查每条连接看到的 Revision 是否连续。证据：`backend/infinite_canvas/connection_manager.py:347-397`。
- 广播会先把同一个 JSON 编码一次，再依次加入 Canvas 上每条连接的发送队列；当前实现也会向发送者自身广播。证据：`backend/infinite_canvas/connection_manager.py:426-444`。
- Realtime Socket 在打开时验证 Canvas 写权限，后续每条消息重新读取当前 Session Actor，并核对 Actor、状态、访问 Epoch 和写权限。证据：`backend/main.py:420-466`、`backend/infinite_canvas/canvas_sync.py:389-406`。
- 当前入站消息只允许 `ping` 与 `canvas_mutation`；Mutation 会进入 Canvas Operation Lock 和 Store Commit，再广播带 Revision 的结果。证据：`backend/infinite_canvas/canvas_sync.py:1081-1174`。
- 浏览器当前每 `15 s` 发送一次应用层 Ping；连续 `35 s` 没有 Pong 就请求 Resync。证据：`static/js/smart-canvas/canvas-persistence.js:1604-1618`。
- 当前公共账号资料不包含图片头像。用户表只有 `id`、`username`、`display_name`、密码、角色、状态和时间字段；`public_user` 也没有 avatar 字段。证据：`backend/infinite_canvas/auth_system.py:244-258`、`:504-512`。

### 2.2 建议：Presence 不能复用 Mutation 语义

Presence 可以复用**同一条物理 WebSocket**和已有 Session/Canvas 授权，但不能被建模成 Canvas Mutation：

- 指针是短命的观察状态，不需要 Revision、幂等 Operation ID、持久化或 Undo。
- Mutation 必须完整、有序；指针中间帧可以任意丢弃，只保留最新值。
- 当前队列的“积压即关闭并 Resync”适合保护共享文档一致性，不适合 Presence。若直接复用，鼠标洪泛或一个慢客户端可能让正常 Canvas Mutation 被旧坐标挡住，甚至造成无必要的重连与大 Snapshot。

建议给每个下行连接增加两个逻辑优先级：

1. `control/document`：Snapshot、Mutation、Reject、Pong，继续保持严格 FIFO 和现有 Revision 保护。
2. `presence`：每个 `presence_id` 最多保留一个待发送最新值；新值覆盖旧值。没有 document/control 待发时再发送 Presence。

底层仍只能串行调用同一 Socket 的 `send`，但排队语义应分开。浏览器端也只为每个远端 `presence_id` 保存最新目标坐标，不建立无限事件队列。

## 三、一手资料中的通用模型

### 3.1 Yjs Awareness：独立、短命、按客户端、有时钟

**来源事实：**

- Yjs 官方文档明确说 Awareness 不存入 Yjs Document；它使用一个小型 State-based CRDT 传播 JSON Object，客户端离线时其 Awareness 会被删除，并通知其他用户。[Yjs Awareness & Presence](https://docs.yjs.dev/getting-started/adding-awareness)
- Yjs `y-protocols` 规范把每个客户端的记录定义为 `(state, clock, lastUpdated)`。客户端只能修改自己的条目；只有更大的 Clock 才能覆盖已知值；`state = null` 表示离线。[Yjs Awareness Protocol §4](https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md#4-awareness-protocol)
- 同一规范要求超过 `30 s` 没刷新的客户端被移除，因此建议至少每 `15 s` 重发自身状态；正常断开前应发送 Clock 递增的 `state = null`。[Yjs Awareness Protocol §4.1](https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md#41-semantics)
- Awareness Wire Format 可以只包含已知条目的任意子集，而不是每次发送完整房间状态。[Yjs Awareness Protocol §4.2](https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md#42-encoding)
- 规范明确警告 Awareness Payload 没有内置认证，恶意 Peer 可以伪造任意 Cursor 或 Presence 数据；权威身份必须由更高层执行。[Yjs Read-only Enforcement](https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md#6-read-only-enforcement)

**对本项目的含义（建议）：**

本项目不需要引入 Yjs Awareness CRDT 库，因为现有拓扑已有单一权威 Server，且 Canvas Mutation 也不是 Yjs 文档。应借用它的四条语义：连接级身份、单调 `seq`、`null/leave` 离线、TTL 兜底。由服务端替换客户端自报身份，广播时附上权威 `presence_id` 与 Account 投影。

### 3.2 Liveblocks：Presence 是临时状态，默认 100 ms 节流

**来源事实：**

- Liveblocks 官方 API 把 Presence 定义为每个在线用户可被其他连接读取的 JSON-serializable 临时数据；Presence 在断线时重置，而 Storage 用于永久数据。[Liveblocks Client API — Presence](https://liveblocks.io/docs/api-reference/liveblocks-client)
- 官方实时指针教程使用 `connectionId` 作为每个在线连接的渲染 Key，并用 `cursor: null` 表示指针不在页面内。[Liveblocks Live Cursors](https://liveblocks.io/docs/tutorial/react/getting-started/live-cursors)
- 教程给出的默认 WebSocket Message Throttle 是 `100 ms`，即约 `10 Hz`；将它降到 `16 ms` 才接近 `60 fps`。[Liveblocks Live Cursors — Throttle rate](https://liveblocks.io/docs/tutorial/react/getting-started/live-cursors#throttle-rate)

**对本项目的含义（建议）：**

`100 ms` 是更适合单后端第一阶段的起点。UI 平滑不等于服务端必须收到 60 fps：远端 Cursor 可以对最近两个目标坐标做 80–120 ms 插值，并在一段时间没有更新时停止外推。只有真实 10 人负载测试证明 Mutation 延迟、事件循环和发送队列无明显回退后，才评估 `50 ms / 20 Hz`。

### 3.3 WebSocket：帧很小，但 API 没有自动背压

**来源事实：**

- RFC 6455 的基础帧包含 2 B Header；Payload 为 `0–125 B` 时不需要 Extended Length。浏览器发往服务端的帧还必须带 4 B Masking Key，因此该范围内基础帧开销为 Client→Server `6 B`、Server→Client `2 B`，不含扩展、TLS 和 TCP/IP。[RFC 6455 §5.2](https://www.rfc-editor.org/rfc/rfc6455.html#section-5.2)
- RFC 定义 Ping/Pong，可用作 Keepalive 和验证远端是否仍响应。[RFC 6455 §5.5.2](https://www.rfc-editor.org/rfc/rfc6455.html#section-5.5.2)
- MDN 明确指出传统浏览器 `WebSocket` API 没有应用背压；若消息到达速度超过应用处理速度，会缓冲占用内存、耗尽 CPU，或两者同时发生。[MDN WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)

**对本项目的含义（建议）：**

不能把“单条消息只有百余字节”误解成“可以无限提高频率”。单后端的主要成本是 `N` 个发送者向 `N-1` 个接收者扇出，Socket Write 次数按 `N(N-1)r` 增长；背压设计和丢弃旧坐标比是否使用 JSON 更先决定系统稳定性。

## 四、建议的消息与状态合同

### 4.1 服务端内存状态

按 `canvas_id` 保存一个内存 Map：

```text
presence_id -> {
  connection,          # 只在服务端持有
  actor_id,            # 来自已认证 Session
  display_name,        # 来自服务端用户资料
  color,               # 服务端确定性分配或会话分配
  seq,                  # 当前连接内单调递增
  cursor: {x, y}|null, # Canvas/World 坐标；null 只隐藏指针
  last_seen_monotonic  # 服务端时间；不信任客户端时间
}
```

- `presence_id` 必须是本次 Realtime Client Connection 的不可猜测或无业务含义 ID；重连产生新 ID，旧 ID 进入 Leave/TTL 清理。
- `cursor` 使用 Canvas/World Coordinate，接收端再经过自己的 Canvas Viewport 变换渲染。不得同步发送者的屏幕坐标、Viewport 或缩放，否则不同用户视图下会错位，也会越过现有本地 Viewport 边界。
- `cursor: null` 表示鼠标离开 Canvas 或标签页隐藏，但连接仍可出现在在线成员列表；`presence_leave` 才表示该连接离线。
- 名字、角色、颜色和未来的 Avatar URL 由服务端生成一次，在 Snapshot/Join 时发送；Pointer Update 不重复携带 Account Profile。

### 4.2 建议消息

连接建立并发送 Canvas Snapshot 后，单独发送：

```json
{
  "type": "presence_snapshot",
  "members": [
    {
      "presence_id": "p_fa31c0de",
      "user": {"id": "u_123", "display_name": "Luo", "color": "#6C5CE7"},
      "cursor": null
    }
  ]
}
```

服务端通知 Join/Leave：

```json
{
  "type": "presence_join",
  "presence_id": "p_fa31c0de",
  "user": {"id": "u_123", "display_name": "Luo", "color": "#6C5CE7"}
}
```

```json
{"type":"presence_leave","presence_id":"p_fa31c0de"}
```

客户端只提交可变的 Cursor 字段，不提交身份：

```json
{"type":"presence_update","seq":123456,"cursor":{"x":12345.67,"y":-890.12},"visible":true}
```

服务端验证并补充权威 Presence ID 后转发给其他连接：

```json
{"type":"presence_update","presence_id":"p_fa31c0de","seq":123456,"cursor":{"x":12345.67,"y":-890.12},"visible":true}
```

`visible` 与 `cursor: null` 可以在正式规格中二选一，避免长期维护两个表达同一状态的字段。上面的较完整 JSON 只用于给带宽估算一个保守 Payload；首版 Wire Contract 应再收敛。

### 4.3 更新规则（建议）

1. `pointermove` 只更新本地 Pending Coordinate；最多每 `100 ms` 发送一次最新值。
2. 没有坐标变化不发送；可按约 `1` 个屏幕像素的位移阈值过滤抖动。
3. `pointerleave`、Canvas 失焦或 `visibilitychange` 时尽力发送 `cursor: null`，随后停止 Cursor Update；这不是离线信号。
4. 服务端拒绝非有限数、异常大坐标、额外字段和过大消息。Presence Update 可限制为约 `1 KiB`，远小于通用 WebSocket Payload 上限。
5. 服务端只接受严格递增 `seq`；相同或更小的值忽略。重连使用新 `presence_id`，不延续旧序号。
6. 客户端收到远端更新时替换目标坐标并做短插值；如果新更新在发送前到达，覆盖旧 Pending Value。
7. 服务端对每连接设置 Presence 专用 Rate Limit。建议允许正常 `10–20 Hz` 和短 Burst，但对持续高于合同的流量丢弃/合并，严重超限再关闭连接；不能直接照搬通用 HTTP 限流值。

## 五、带宽与单后端成本估算

### 5.1 估算假设

- `N`：同一 Canvas 活动 Realtime Client Connection 数，不是唯一 Account 数。
- `r`：每个连接每秒提交的 Pointer Update 数；假设所有连接一直移动，是偏保守场景。
- 服务端不向发送者回显，所以入站消息数为 `N × r`，下行 Socket Delivery 数为 `N × (N-1) × r`。
- 上述示例 Client Payload 实测 JSON UTF-8 为 `90 B`；Server Payload 为 `117 B`。
- 两者均不超过 125 B，因此按 RFC 6455 基础帧头计 Client→Server `96 B`、Server→Client `119 B`。
- 不计 Presence Snapshot/Join/Leave，因为它们是低频控制消息；不计 TLS Record、TCP/IP、代理、网络重传与 WebSocket Extension。
- 不计应用压缩；小消息启用压缩未必划算，还会引入额外 CPU 与安全评估。

### 5.2 估算结果

| 连接数 N | 频率 r | 入站消息/s | 下行发送/s | 应用 Payload + WebSocket 基础帧头 | 判断 |
| ---: | ---: | ---: | ---: | ---: | --- |
| 10 | 10 Hz | 100 | 900 | 约 0.93 Mbit/s | 建议首版起点 |
| 10 | 20 Hz | 200 | 1,800 | 约 1.87 Mbit/s | 需真实负载验证后开放 |
| 10 | 60 Hz | 600 | 5,400 | 约 5.60 Mbit/s | 单后端首版没有必要 |
| 20 | 10 Hz | 200 | 3,800 | 约 3.77 Mbit/s | 已到运行连接上限的压力场景 |
| 20 | 20 Hz | 400 | 7,600 | 约 7.54 Mbit/s | 高压场景 |
| 20 | 60 Hz | 1,200 | 22,800 | 约 22.63 Mbit/s | 不建议 |

计算示例（10 连接、10 Hz）：

```text
inbound  = 10 × 10 × 96 B     = 9,600 B/s
outbound = 10 × 9 × 10 × 119 B = 107,100 B/s
total    = 116,700 B/s × 8     = 0.9336 Mbit/s
```

如果直接使用当前会向发送者自身广播的函数，下行会从 `N(N-1)r` 变成 `N²r`。Cursor 已经在发送者本地即时渲染，这个 Echo 没有产品价值，应避免。

### 5.3 CPU、内存与延迟成本（估算与建议）

- **内存状态本身很小**：即使每个 Presence Record 按 `1 KiB` 粗略预算，20 条连接也只有约 `20 KiB` 的房间状态；真正风险在 Pending Queue 和 Socket Buffer 无界增长。
- **JSON CPU 不是首要问题，但要编码一次**：每个入站 Update 解析一次、服务端补充 `presence_id` 后编码一次，再把同一个已编码 Payload 引用加入多个下行队列。不要为每个接收者重复 `json.dumps`。
- **Socket Write 和调度按二次方增长**：单房间所有人持续移动时，下行次数是 `N(N-1)r`。10 人 10 Hz 是 900 次/s；20 人 10 Hz 已是 3,800 次/s。
- **Presence 不能占 Canvas Operation Lock 或 Store Thread**：否则即使带宽不高，也会把高频 Pointer 与 Mutation Commit 串在同一临界区，放大当前大型 Canvas 已知的端到端延迟风险。
- **慢客户端只损失轨迹细节**：其 Pending Presence 必须保持有界且 latest-wins；Document Queue 仍按当前合同要求完整、有序。Presence Drop Counter 应进入 Metrics，但不应直接触发 Resync。

因此，“性能占用大不大”的准确答案是：在 10 人、10 Hz、紧凑消息和正确背压下量级可控；若直接转发 60 fps、重复携带头像资料或复用当前不可丢弃队列，成本和故障半径会迅速放大。只有实测才能证明当前单 Worker 是否达到最终 Gate。

## 六、断线、超时和清理

### 6.1 建议生命周期

1. **正常打开**：授权、注册连接、发送 Canvas Snapshot，再发送 Presence Snapshot，最后向其他连接广播 Join。必须避免 Snapshot/Join 竞态造成幽灵成员或遗漏成员。
2. **活动维持**：沿用现有 `15 s` 应用 Ping；任意合法 Ping、Mutation 或 Presence Update 都可刷新服务端 `last_seen_monotonic`，但 Cursor Update 不能替代 Heartbeat，因为静止用户仍然在线。
3. **干净关闭**：在现有 `WebSocketDisconnect` / `finally` 中同步移除该连接 Presence，并向其他连接广播 Leave。
4. **异常断网兜底**：参考 Yjs 的 `15 s` Refresh / `30 s` Expiry，并与本仓库现有 `15 s` Ping / `35 s` Client Timeout 对齐。建议服务端 TTL 初值为 `35–45 s`，从服务端单调时钟计算；到期即移除并广播 Leave。
5. **重连**：创建新 `presence_id`。旧状态通过原 Socket Close 或 TTL 清理；不能仅凭客户端传入的 `client_id` 驱逐旧状态。若以后需要无闪烁接管，应使用服务端签发且绑定 Actor 的恢复 Token，而不是把可自报的 Client ID 当授权凭证。
6. **进程重启**：所有 Presence 自然清空。因为它不是共享文档，这属于正确行为；客户端重连后重新 Join。

### 6.2 需要避免的幽灵在线

- 只在浏览器 `beforeunload` 发送 Leave 不可靠；必须以 Server Socket Close 和 TTL 为权威。
- 只在 Cursor Update 上刷新 TTL 会把静止用户误判离线。
- 只依赖 TCP Close 可能长时间保留半开连接；RFC Ping/Pong 或现有应用 Ping/Pong 都可作为活性探针。
- TTL 清理必须同时删除服务端 Map、每个接收者尚未发送的 Pending Presence，以及 UI 中的 Cursor/Avatar。

## 七、隐私与安全

### 7.1 来源事实

OWASP WebSocket Security Cheat Sheet 建议生产使用 WSS；浏览器 Cookie 会随 WebSocket Handshake 发送，因此要校验 `Origin` Allowlist，防止 Cross-Site WebSocket Hijacking；长连接需要处理 Session 过期；每种消息都要做授权和结构验证；还应限制连接数、消息大小和频率，使用 Heartbeat 清理死连接并实施 Backpressure。[OWASP WebSocket Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)

OWASP 也建议记录连接、认证、授权、限流和异常关闭等安全事件，但不要记录完整消息、Token、Session ID 或个人资料。[OWASP — Security Monitoring and Logging](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html#security-monitoring-and-logging)

### 7.2 本项目建议

- Presence 仅向当前已授权进入同一 Smart Canvas Realtime Room 的连接发送。首版沿用当前编辑权限；不要自动把实名在线信息暴露给匿名或只读分享页。
- 每条 Presence Update 继续执行当前 Session Actor 与 Canvas Access Epoch 检查；账号被禁用、权限撤销、Session 失效或 Workspace Move 时立即 Close 并清理 Presence。
- 客户端只能提供 `seq` 和 Cursor。服务端忽略/拒绝客户端传入的 `user_id`、`display_name`、`role`、`color`、`avatar_url`、`canvas_id`。
- Cursor 只允许有限数值与合理范围；禁止 NaN、Infinity、超深对象、未知字段和超大 JSON。显示名必须作为 Text 渲染，不能进入 `innerHTML`。
- 不在普通日志记录连续坐标或完整 Presence Payload。Metrics 只记房间连接数、Accepted/Dropped Update 数、Fan-out 数、Payload Byte、Queue Depth、TTL Cleanup 和 Rate-limit Event。
- 默认不持久化谁在何时位于画布何处，也不把轨迹送入 Analytics。若未来要做审计或使用分析，应单独取得产品与隐私批准，并定义保留期和访问权限。
- 真图片头像应来自受控的用户资料资产。不要允许 Presence Message 临时塞任意外站 URL；这会引入跟踪像素、内容安全策略、恶意 SVG 和失效资源等额外风险；如果服务端还会代理抓取或缓存该 URL，则必须额外处理 SSRF / 内网请求边界。
- 支持“隐藏我的实时指针”会改善隐私，但产品要明确它是否仍显示在线头像；这是产品选择，不应由协议字段含糊推断。

## 八、建议的验证计划与 Gate 候选

以下均是**建议**，不是当前承诺：

### 8.1 协议正确性

- 同一 Account 双标签页得到两个 `presence_id` 和两个 Cursor；头像列表是否聚合符合批准的产品合同。
- Cursor 使用 Canvas Coordinate，在不同缩放和 Viewport 下落点一致。
- `seq` 相同/倒退被忽略；重连的新 Presence 不被旧 Update 覆盖。
- Pointer Leave 只隐藏 Cursor，不删除在线成员；Socket Close/TTL 同时删除 Cursor 和成员。
- Presence 不改变 Canvas Revision、Updated Time、最近编辑人、Undo 或 SQLite。
- 权限撤销、账号禁用、Workspace Move 和服务端重启无幽灵在线。

### 8.2 单后端容量

把现有多人 Runner 扩展为 Presence 场景，至少测试：

- 10 连接 × 10 Hz，持续 30 分钟；
- 10 连接 × 20 Hz，持续 5 分钟；
- 20 连接 × 10 Hz，作为 Connection Limit 压力场景；
- 一个慢接收端与一个恶意 `60–200 Hz` 发送端；
- Presence 负载期间叠加现有 `20 Mutation/s` 稳态与 `40 Mutation/s` Burst。

建议记录：Presence E2E P50/P95/P99、Server Receive/Encode/Fan-out/Queue 时间、事件循环延迟、每连接 Document Queue/Presence Pending 数、Drop/Coalesce、Process CPU/RSS、Network Byte，以及 Canvas Mutation P95/P99。首要 Gate 是现有 Mutation 正确性不回退，且关键延迟相对无 Presence 基线没有未解释的 `>20%` 恶化；这个 `20%` 沿用 `docs/current/realtime-collaboration-performance.md` 的相对基线规则。

候选体验 Gate：

- 10 人 10 Hz 时远端 Cursor Update P95 ≤ `250 ms`，没有持续停顿；视觉层通过插值保持连续。
- 干净断开后成员在 `1 s` 内消失；异常断网不晚于批准的 TTL（建议 `35–45 s`）清理。
- 慢客户端只丢失旧 Presence，不丢 Canvas Mutation、不造成其他连接 Resync。
- 超频发送者被合并或限流，其他用户的 Mutation 与 Heartbeat Gate 仍通过。

## 九、推荐实施分期

### Phase 1：连接级 Presence + 首字母头像

- 同一 Canvas WebSocket 上新增独立 Presence Message Type。
- 服务端内存 Map、Join/Snapshot/Update/Leave、15 s Heartbeat 与 TTL。
- `100 ms / 10 Hz` Client Throttle、Canvas Coordinate、远端插值。
- 使用服务端 `display_name`、确定性颜色和首字母圆形，不改账号表。
- Presence 独立 latest-wins Queue、Rate Limit、Metrics 与 10/20 连接负载 Gate。

### Phase 2：真实用户头像（独立需求）

- 明确头像上传/删除/默认图、资产存储、尺寸与格式、权限、CSP、缓存和迁移。
- Profile 只在 Presence Snapshot/Join 发送；Pointer Update 仍保持紧凑。
- 明确同一 Account 多连接的头像聚合、Overflow UI 和无障碍文本。

### Phase 3：可选的协作 Awareness

在 Cursor 与在线成员稳定后，再独立考虑远端 Selection、跟随他人 Viewport、Typing/Editing Indicator。它们的数据敏感度、消息频率和 UI 干扰不同，不应一次性塞进一个无边界的 Presence Object。

## 十、最终建议

Issue #196 可以进入一个边界清晰的 Feature Spec，推荐批准以下技术方向：

- **复用连接，不复用持久化语义**：在现有 Canvas WebSocket 内多路复用 Presence，但与 Canvas Mutation 的 Revision/Store/Queue 分离。
- **先 10 Hz，不做 60 fps 网络广播**：平滑交给渲染层；真实负载证明后再考虑 20 Hz。
- **连接级 Cursor、账号级展示**：Cursor 以 Realtime Client Connection 为主体，头像列表可以按 Actor 聚合。
- **身份由服务端权威提供**：客户端永远不能自报姓名、角色或 Avatar。
- **即时 Leave + TTL 兜底**：沿用 15 s Heartbeat，服务端设置 35–45 s Presence TTL。
- **首版首字母头像**：当前账号模型没有 Avatar 字段；图片头像独立立项。
- **先补队列和压测再承诺性能**：10 人 10 Hz 的估算量级可控，但单 Worker 是否通过 Mutation 延迟与事件循环 Gate，必须由组合负载测试证明。

## 参考资料

全部为一手规范、官方文档或项目源码，访问日期 2026-08-29：

1. [Yjs Docs — Awareness & Presence](https://docs.yjs.dev/getting-started/adding-awareness)
2. [Yjs y-protocols — Protocol Specification](https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md)
3. [Liveblocks — Live cursors using presence](https://liveblocks.io/docs/tutorial/react/getting-started/live-cursors)
4. [Liveblocks — Client API Reference](https://liveblocks.io/docs/api-reference/liveblocks-client)
5. [RFC 6455 — The WebSocket Protocol](https://www.rfc-editor.org/rfc/rfc6455.html)
6. [MDN — WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
7. [OWASP — WebSocket Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)
