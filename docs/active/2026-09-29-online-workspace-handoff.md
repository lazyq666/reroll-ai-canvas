# Turso 工作区交接登记

- Status: Implemented locally; live Turso probe passed; real two-device OneDrive acceptance pending
- Feature: F03
- Tracked by: [LAZ-79](https://linear.app/lazyq/issue/LAZ-79)
- Decision: [ADR-0018](../adr/0018-online-workspace-handoff-register.md)

## 目标与使用流程

两台可信设备轮流使用本地 SQLite Workspace，OneDrive 继续同步数据库和媒体。
在两端一次性配对后，Administrator 在设置中点击“关闭本服务器”：当前画布先走既有
保存边界，随后进入交接页自动提交一次。其他画布连接、生成任务和待交付结果仍阻止关闭。
停写、备份和完整校验成功后上传交接登记并正常退出服务（退出码 0，启动器不重启）。
“关机”指关闭 Reroll 服务，不关闭操作系统。无需记录、复制或输入编号。

B 启动时先查询 Turso。若 A 仍使用，或 OneDrive 内容与最新交接版本不同，保持工作区
不可写，恢复页显示原因。启动恢复期间每 5 秒重试可恢复的网络、占用、文件同步状态；
接收完成后走既有受监督重启，再初始化 Store。正常编辑期间不轮询云端、不续租、不自动
抢占。Turso 登记不是 OneDrive 上传完成证明，仍需保持两端同步软件运行。

## 状态与失败恢复

`active(A) → sealed(A) → receiving(B) → active(B)`，状态变更使用主库事务和 revision
条件更新；完整文件校验在事务外执行。并发 B/C 只有一个能取得 receiving。
所有数据写入在本机 OS 锁内完成；云端判断替代易过时的同步占用元数据，不替代 OS 锁。

- 关闭前被画布/任务阻止：仍可继续编辑。
- 关闭后备份、校验、网络失败：保持维护停写，关闭按钮可重试；不得重新启动后台写入。
- 发布响应丢失：读取云端确认同一交接摘要；即使 B 已领取，也可确认 A 的关闭。
- A 中断在本地封存或云端发布后：持有 sealing 本机操作回执时完成发布并退出，不自动重开。
- B 中断在领取或激活：持有匹配 session 的本机回执才能恢复，不重新领取另一 session。
- 原 active 安装异常退出：只有匹配其本机回执才能恢复；另一设备不能按时间超时接管。
- 无凭据、绑定错误、远端登记丢失或格式异常：保持锁定，不能用手输编号绕过。
- 冲突副本需要人工处理；接收端不会自动归档/删除冲突。原设备关闭阶段的既有显式备份
  删除工具继续可用。旧版客户端、未配对全旧副本及人为删改权威登记不在保证内。

本地 API 权限沿用原有边界：关闭要求本机管理员、同源写入；恢复只允许本机操作。
`GET /api/runtime/handoff` 增加可选 `automatic: true`，保持未配对模式响应兼容。
设置 API 增加 `automatic_handoff`。在线恢复不要求 `handoff_id`；手动模式仍必须提供。
页面中文/英文动态状态、Light/Dark 和键盘操作沿用共享组件。成功页隐藏编号和复制按钮。

## 一次性配置与凭据

使用独立 Turso libSQL 库，数据库级读写令牌。Device State 外的凭据传递方式由操作者选择，
不要放入仓库或 OneDrive。默认源文件为此安装 Device State 的 `handoff-service.json`，
内容 `{"url":"libsql://…turso.io","token":"…"}`，权限 0600。令牌到期需在两端更新；
网络或认证失败会阻止启动/发布，不影响已持有使用权的当前编辑会话。

两端都升级代码，并在本机服务停止后操作；确认只有原设备拥有当前完整内容。
在项目根目录使用该安装的 Python 环境：

```sh
python scripts/configure_handoff.py --initialize
```

只在原设备执行 `--initialize`，建立首个 active 登记。若之前已手动封存，需要额外
`--handoff-id <上一台独立提供的编号>` 通过旧流程验收。第二台使用同库凭据执行：

```sh
python scripts/configure_handoff.py
```

`--state-directory` 可指定另一安装的 Device State；`--connection-file` 可指定私有
凭据源文件（只传路径，不传 token）。配对和令牌更新不领取远端使用权，且本机服务运行
时拒绝配置。配对成功会记住 Workspace identity，确保启动恢复可识别原工作区。
重复初始化只接受同一注册操作；未知首次提交结果需保留回执并核对原设备，不自动重建
缺失登记。全云端画布记录模式不能与此功能同时启用。

## 数据归属与验证

见 [存储边界](../current/storage-layout-and-migration.md)。配对后的 secret、操作回执和
备份只在本机；Workspace 仅附加不含 secret 的 `coordinator.json` 绑定标记。
删除本机凭据不会降级为离线。移动 Workspace 保留 identity 与控制文件。

自动验证入口：

- `python -m unittest tests.test_handoff_coordinator tests.test_online_handoff_runtime tests.test_workspace_handoff tests.test_workspace_handoff_http`
  覆盖往返、并发、缺文件、旧封存、网络失败、提交响应丢失、启动中断、配置锁、权限与退出码。
- `REROLL_HANDOFF_PROBE_CONFIG=<私有配置路径> python -m unittest tests.test_handoff_live`
  使用随机临时 Workspace 和生成内容；只删除其生成的行，不清空表。
- `python -m unittest tests.test_handoff_server_exit`：独立 HTTP 进程返回成功后实际退出码为 0。
- `node tests/workspace_handoff_browser.cjs`：真实页面的手动/在线流程、语言、主题、键盘和保存边界。
- i18n 校验、前端资源版本校验、文档知识地图和 Workspace/runtime 回归。

2026-09-29 已在新库通过真实 A→B→A、并发唯一领取、发布响应丢失后接收者先领取三项测试。
179 项本地后端/文档/i18n 回归和 1 项真实 HTTP 进程退出测试通过；真实页面通过 Browser 验证一键提交一次、无编号输入、中英文和主题切换。真实 Turso 另通过领取完成响应丢失后的文件再验收。浏览器脚本已扩充，整套脚本尚未独立执行；证据见 LAZ-79。尚未升级/配对第二台真实设备，现有业务服务未被停止；
需要补真实 OneDrive 的上传延迟、下载延迟、Windows/macOS 锁行为与连续往返验收后才可毕业为 Current。
