# Candidate 05 · Canvas Sync 实施说明

> 当前路径说明：本文中的 `main.py` 和 `infinite_canvas/` 现分别位于
> `backend/main.py` 和 `backend/infinite_canvas/`。

状态：Current；Issue #102 已于 2026-08-21 完成实现与自动化验收
外部合同：HTTP、WebSocket、Workspace Data 与现有 UI 严格兼容

## 用户可感知的保证

- Classic Canvas 仍使用 `updated_at` 检测旧页面覆盖，并继续发送
  `canvas_updated` 旧通知。
- Canvas Updated Time（`updated_at`）和最近编辑人（`updated_by`）只描述最近一次
  确实改变持久创作内容或 Canvas 标题/图标的 Canvas Edit；创建时初始化。
- 打开、读取、刷新、Realtime 连接、Touch、Selection、Prompt 滚动和个人
  Viewport 不改变 Canvas Updated Time、最近编辑人或 Revision。
- Smart Canvas 渐进式打开从一次授权读取的同一快照依次发送只含 Node 几何的
  `canvas_outline` 与完整 `canvas_document`；轮廓是 Presentation，不是 Canvas
  内容，不产生 Mutation、Undo、Realtime 或持久化写入。
- Classic Canvas 的等价快照是无写入结果；Smart Canvas 只接受非空且确实改变
  共享内容的 Mutation，等价、空、重复或被拒绝的 Mutation 不推进 Revision 或时间。
- Pin、Canvas List 位置、Project 归类、Visibility、Share、Trash、Restore、Purge
  与 owner transfer 是内容管理动作，不推进 Canvas Updated Time。
- Classic 保存不会用另一个页面提交的 Viewport 覆盖当前个人视图。
- Smart Canvas 仍使用 Revision、operation id、删除墓碑、Connection、
  Group 与安全 Undo 规则。
- 同一 Smart Canvas 的持久化与通知按同一顺序完成；重复 operation
  只返回原确认，不重复修改或广播。
- 每一次实际 REST 或 WebSocket 写入都会从持久层重新读取并检查当前权限。
- Canvas Selection、Viewport、当前工具、pointer、drag/resize/frame/brush
  preview 不进入共享 Mutation，也不会出现在 Smart Canvas 共享快照中。
- metadata、visibility、touch、trash、restore、purge、project move 与账号
  owner transfer 经过同一个 Canvas Sync 模块。

## 深模块 seam

实现位于：

- `infinite_canvas/canvas_sync.py`：读取、权限、冲突、Mutation、原子持久化、
  Revision/时间、管理写入与有序通知。
- `infinite_canvas/connection_manager.py`：WebSocket 发送序列化和每个
  Smart Canvas 实时客户端连接硬上限的 transport adapter；默认
  20 条，可通过 `INFINITE_CANVAS_REALTIME_CONNECTION_LIMIT` 调整。
- `infinite_canvas/canvas_opening.py`：把已经授权的单个 Canvas 快照投影为
  `application/x-ndjson` 打开事件；不读取存储、不决定权限，也不修改快照。

`main.py` 中的 HTTP/WebSocket 路由只负责：

1. 把 cookie/session 转成 actor；
2. 把 Pydantic/JSON 输入转成 `CanvasCommand` 或实时消息；
3. 把 `CanvasSyncError` 投影成原有 HTTP/关闭码；
4. 返回既有响应形状；渐进式打开路由只把同一次读取交给 Canvas Opening
   序列化为轮廓事件和完整文档事件。

Canvas Sync 不回调 `main.py` 的旧实现。文件系统、通知与账号分享/审计分别通过
Workspace content、Connection Manager 和 Auth System adapter 完成。

## 服务端写入清单

| 写入 | Canvas Sync 行为 |
|---|---|
| 新建 Canvas | 建立 owner、可见性、Revision 与默认内容后原子写入 |
| Classic 快照保存 | 重新读取、验权与冲突检查；只有非空内容差异才原子写入、更新时间并发送旧通知；Smart 快照一律拒绝 |
| Smart Realtime | 重新读取、验权；只有非空且产生共享内容差异的 Mutation 才推进 Revision、更新时间、原子写入并有序广播 |
| 标题 / 图标 Metadata | 值确实改变时更新 Canvas Updated Time 与最近编辑人，不推进 Smart Revision |
| Pin / Canvas List 位置 / Project / 其他 Metadata | 管理结果可以写入，但保留 Canvas Updated Time、最近编辑人与 Revision；等价值不写入 Canvas |
| Visibility / Share / Touch | Visibility 与 Share 保持权限和撤销合同，但保留编辑事实；兼容 Touch 只返回投影，不产生 Canvas 持久写入 |
| Trash / Restore / Purge | 重新验权并保持原角色限制和响应；Trash/Restore 保留编辑事实，Purge 直接删除记录 |
| 删除 Project | 先验证全部 Canvas 权限，再批量迁回默认项目；失败完整回退 |
| 删除账号 owner transfer | 批量接管 Canvas；写入失败完整回退 |
| 历史权限迁移 | 普通读取只在内存补齐旧字段；独立启动迁移继续生成 recovery copy，迁移失败阻止启动，并保留编辑事实 |

## 验证

- Interface tests 直接覆盖 Canvas Sync，不 patch `main.py`。
- HTTP tests 锁定 Classic stale 409、Viewport 保留和 legacy broadcast。
- HTTP tests 锁定渐进式打开的媒体类型、事件顺序以及 Canvas ID / Revision
  在轮廓和完整文档间一致。
- WebSocket tests 锁定 Revision、幂等、双页面顺序、断线重连，以及默认 20 条且可配置的客户端连接上限。
- Mutation engine tests 明确拒绝 Viewport、Selection 与 Interaction preview。
- 测试只使用临时 Workspace、fake notifier 和 fake administration adapter。
- 新运行模块已加入应用更新与备份白名单。
- `main.py` 从共同规格基线的 19,102 行降至 18,534 行，净减少 568 行；
  保留内容仅为 HTTP/WebSocket adapter、Canvas 列表展示投影及独立的 Project
  索引管理，不再直接写 Canvas document。
- Issue #102 回归覆盖 Canvas Store、legacy JSON Canvas Sync、HTTP、真实
  WebSocket、Connection Manager、Classic/Smart no-op、管理动作和旧数据读取。
- `tests/canvas_updated_time_browser_smoke.cjs` 使用真实 Chromium 验证 Classic/Smart
  打开、Node Selection、Prompt 滚动、Viewport 保存与未形成编辑的 Pointer 手势不产生
  Canvas 写入；个人 View State 仍可独立保存。

## 统一空间布局提交合同

Smart Canvas WebSocket 查询参数 `layout_gap` 必须等于当前代码常量；缺失或不匹配时关闭码为 4410，客户端提示刷新。G 由 `static/js/smart-canvas/layout-constants.json` 发布，前后端共同使用，不写入 Canvas Settings。内部服务端写入仍沿用可信 Canvas Intent，不要求伪造浏览器布局元数据。

正常创建支持 `node_creates: [{node, placement}]`。`placement` 包含 `mode`（`exact` / `auto`）、`gap`、可选 `collectionId` 及冻结的 `intent`（来源、视口、原直接 Frame）。允许的封装不授权提交任何 lineage 元数据；元数据不成为共享 Node 属性或广播相机。客户端将其与本地待同步操作一起保存，重载再生成差异时继续保留明确位置语义。

自动初始创建与较新节点的矩形安全区冲突才返回 `placement_conflict`，整个新增集合按最新障碍重算。明确创建接受重叠。两者的直接 Frame 在期间改变时返回 `frame_placement_conflict`：重试合并 Frame 扩容并重新投影成员，明确坐标保持。布局版本不符返回 `layout_contract_mismatch`，非法几何返回 `invalid_layout_geometry`。

Undo/Redo 使用可信 inverse 精确恢复历史位置及相应 Frame 变化，重叠不触发重新避让；旧 `placement_overrides` 不再改变恢复坐标。既有权限、节点身份、lineage 及保护后续修改的检查继续生效。详情和验收见[节点定位合同](smart-canvas-node-auto-placement.md#6-失败协作与恢复)及 [Issue #40](https://github.com/lazyq666/reroll-ai-canvas/issues/40)。
