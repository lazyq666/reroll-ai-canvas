# Issue #196 Presence 验证与毕业记录

> Status: Active verification  
> Approved authority: [Smart Canvas 实时在场状态、指针与账号头像](2026-08-29-smart-canvas-realtime-presence.md)  
> Tracked work: GitHub Issue #196

本文只记录验证事实和待执行 Gate，不扩大 Approved Feature Spec。自动化、双机 LAN 人工验收和 30 分钟目标负载全部通过之前，规格保持 Approved/Active，README 与 `docs/current/` 不宣称该能力已经毕业。正式机器负载由 Issue #215 跟踪，双机 LAN 人工验收由 Issue #216 跟踪。

## 自动化证据

| Gate | Command / seam | Current result |
| --- | --- | --- |
| 账号迁移与所有新账号路径 | `python -m unittest tests.test_account_avatar` | Passed，旧表随机回填且二次启动稳定；初始管理员、CLI 创建和审批路径均分配 1–10 |
| Presence 状态、配置与静默非法包 | `python -m unittest tests.test_realtime_presence` | Passed，包含 50/100/500、无效启动失败、账号级多连接、控制权、Resync 边界 |
| 可靠文档优先与有界折叠 | `python -m unittest tests.test_connection_manager` | Passed，Pointer latest-wins；成员积压折叠为个性化 Snapshot；文档 FIFO 优先 |
| 已认证真实应用 WebSocket | `python -m unittest tests.test_canvas_realtime_websocket` | Passed，管理员/设计师、多 Tab、Guest 拒绝、权限撤销、Revision/Updated Time 不变 |
| 真实 Smart Canvas 页面 | `NODE_PATH=<playwright> node tests/realtime_presence_browser_smoke.cjs` | Passed，Light、Dark/Reduced Motion、成员几何、阈值、投影、离屏、固定 UI 和版本缺口 |
| 目标负载计划合同 | `python -m unittest tests.test_realtime_presence_load_cli` | Passed；受控无 Pointer baseline 与 30 分钟正式 Presence Gate 均 Passed |

聚合复跑覆盖上述测试及相关 Canvas Sync、认证、更新包清单和 Workspace Artifact 接缝，共执行 106 项；其中 103 项通过。剩余 3 项全部来自基线已不自洽的 `tests.test_update_sources`：当前 `HEAD` 的 `backend/main.py` 不定义测试要求的 `GITHUB_UPDATE_OWNER` / `MODELSCOPE_UPDATE_ENABLED`，当前 `HEAD` 的 `static/index.html` 也不包含该测试要求的仓库回退文案。Issue #196 只在该文件的更新包 allowlist 增加 `realtime_presence.py`，该相关断言已通过；本分支没有顺带恢复或改写无关更新源能力。

浏览器脚本可通过 `PRESENCE_SCREENSHOT_DIR=<directory>` 同时保存 `presence-light.png` 与 `presence-dark-reduced.png`。截图是视觉证据，不替代下列双机交互验收。

### 本机 10 账号性能侦察（2026-08-29）

在隔离 Instance State / Workspace 上以生产 Runtime Gateway 启动单进程服务，Presence 间隔为 100ms；10 个不同账号各自保持一条 Canvas WebSocket 并以 10Hz 发送 Pointer，第 10 个连接每 5 秒暂停读取 400ms。结果如下：

| Duration | Aggregate Mutation load | Pointer P95 | Mutation P95 / P99 | Event Loop Probe P99 | RSS growth | Correctness |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 30s | 1/s | 59.582ms | 92.439ms / 93.370ms | 17ms | 受限进程视图未采集 | 10 个客户端各收 3100 次 Pointer；Revision 31 次连续；无协议错误 |
| 60s | 20/s，由 10 个协作者轮询承担 | 93.719ms | 92.785ms / 96.559ms | 21ms | +3,424,256 bytes | 10 个客户端各收 6100 次 Pointer；Revision 1220 次连续；慢客户端最终一致；无 Reject、Resync、关闭或协议错误 |

侦察过程中发现负载器原先把总计 20 Mutation/s 全部集中在单一 WebSocket；这测量的是单连接逐消息接收串行化，并产生持续积压，不符合“10 个协作者的房间总负载”形状。负载器已改为在 10 个账号连接间轮询发送总计 20/s，在进程查看受限时继续采集 Event Loop 而不是让资源探针退出，并把发送停止与 1 秒接收收敛窗口分开。修复后的 15 秒形状复核精确收到 1500 个 Pointer 样本和 300 个 Mutation，Revision 从 2417 连续到 2717。上述数字低于 30 分钟正式时长且没有无 Presence 基线，因此只证明短时目标形状健康，**不构成正式负载 Gate 通过**。

### 本机 9 机器人 + 1 真人现场验收（2026-08-29）

复用既有 `scripts/performance/run_live_collaboration_acceptance.py` 的“9 个机器人 + 1 个真人”路径，在同一 Smart Canvas 上为每个机器人增加 10Hz 临时 Pointer，同时保持每秒一轮、每轮 9 次可靠节点 Mutation。两次不改写机器人验收节点的 60 秒执行均通过完整 Gate：每次 540 次 Mutation，Pointer 分别发送 5220 / 5265 次且无发送错误；Mutation ACK P95 分别为 145.212ms / 158.925ms，P99 分别为 157.750ms / 163.397ms；Revision 无缺口、乱序或 Resync，最终节点投影一致。临时机器人账号和 Session 在每轮结束后按 allowlist 自动清理。

现场还验证了真人账号展开 10 人成员组、切换抓手/指针、移动 Pointer、点选和拖动节点；当真人主动改写机器人验收节点时，脚本按设计以 `robot_final_node_projection_mismatch` 拒绝把该轮标为纯机器人投影通过，而 ACK 与 Presence 指标仍单独保留。此路径用于交互体验和短时回归，负载形状不是 20 Mutation/s 且时长不足 30 分钟，**不替代正式负载 Gate**。

## 双浏览器 / 双机 LAN 验收准备

### 环境

1. 在同一局域网的服务机 `.env` 设置 `INFINITE_CANVAS_HOST=0.0.0.0`，保留 `INFINITE_CANVAS_PRESENCE_UPDATE_INTERVAL_MS=100` 并重启。
2. 准备至少两个不同的 Admin/Designer 账号和一个 Guest 账号；用服务机显示的 LAN URL 进入同一个 Smart Canvas。
3. 设备 A、B 分别开启浏览器录屏；开发者工具保留 WebSocket Frames。另开同账号第二个标签页验证账号级聚合。
4. 每个场景记录服务版本/commit、设备、浏览器版本、主题、窗口尺寸、账号角色、起止时间和证据路径。

### 人工场景

| Role | Scene | Pass condition | Status |
| --- | --- | --- | --- |
| UI | Light/Dark × Desktop/Narrow；1、6、10 人；长中英文姓名；`+N` | 头像 28px、右/上 22px、重叠 6px、自身最右；Token 可读，列表可聚焦 | Pending |
| UI | 错误通知、Menu、Dialog 与成员组/Pointer 同时出现 | Pointer 在 Canvas 之上但不遮挡固定 UI；Toast/Dialog 在其上 | Pending |
| Interaction | 两机移动、静止、离开、Blur、隐藏 Tab | 最近移动连接控制；隐藏清空；旧坐标不复活；最后连接离开才 Leave | Pending |
| Interaction | Zoom/Pan、离屏、Reduced Motion | 两端以本机 Viewport 正确投影；离屏隐藏；Reduced Motion 跳转且标签立即淡出 | Pending |
| Product | Admin/Designer/Guest、运行中撤权 | Guest 不加入；撤权后连接关闭；Presence 失败不阻断 Canvas 编辑 | Pending |
| Recovery | 断网后恢复、成员版本缺口、服务端无 Presence 能力 | 只替换 Presence Snapshot；不出现 Canvas Resync；旧服务端仍可编辑 | Pending |

人工验收完成后，把录像/截图的仓库内相对路径或受控证据位置填入本表；不要把账号、Cookie、LAN 私网地址或设备标识写入仓库。

## 30 分钟负载 Gate

`scripts/performance/run_realtime_presence_load.py` 只接受已存在服务、已认证账号和 Smart Canvas。正式 baseline 模式强制 10 个不同账号、零 Pointer、持续 1800 秒和 20 Mutation/s；正式 Presence 模式强制同一账号集合、同一服务 PID、每账号 10Hz Pointer、持续 1800 秒和 20 Mutation/s。Presence 模式只接受已通过且账号摘要、PID、时长和速率完全匹配的 baseline summary。

先生成可审计计划：

```bash
python scripts/performance/run_realtime_presence_load.py \
  --plan-only \
  --report-directory /tmp/issue-196-presence-plan
```

账号凭据文件只放在仓库外，形状为 `[{"username":"...","password":"..."}]`，共 10 项。正式执行示例：

```bash
python scripts/performance/run_realtime_presence_load.py \
  --mode baseline \
  --base-url http://127.0.0.1:3000 \
  --canvas-id <smart-canvas-id> \
  --accounts-json /secure/path/issue-196-accounts.json \
  --server-pid <uvicorn-pid> \
  --report-directory /evidence/no-presence-baseline \
  --confirm-formal-baseline

python scripts/performance/run_realtime_presence_load.py \
  --mode presence \
  --base-url http://127.0.0.1:3000 \
  --canvas-id <smart-canvas-id> \
  --accounts-json /secure/path/issue-196-accounts.json \
  --server-pid <uvicorn-pid> \
  --baseline-summary /evidence/no-presence-baseline/summary.json \
  --report-directory /evidence/issue-196-presence-formal \
  --confirm-formal-load
```

报告输出 `summary.json` 和 `metrics.csv`。只有以下项目同时为真才可通过：Pointer P95 ≤ 250ms；Mutation P95/P99 相对基线均不劣化超过 20%；10ms Event Loop Probe P99 ≤ 50ms；Revision 连续且最终投影 Revision 一致；无 Canvas Resync、Mutation Reject、永久发送失败；服务 RSS 无无界增长；慢客户端仍收到完整文档序列；所有接收端最终收到每个参与者的最新 Pointer。

### 2026-08-30 正式结果

在隔离 Instance State、临时 Workspace、专用 Smart Canvas 和 10 个临时账号上，以同一服务 PID 依次完成 1800 秒 baseline 与 1800 秒 Presence 正式运行。脱敏报告位于受控本机位置 `.scratch/issue215-presence-gate-20260830/`；该目录被版本控制忽略，只在本文保留稳定摘要。

| Run | Samples | Pointer P95 | Mutation P95 / P99 | Relative degradation P95 / P99 | Event Loop P99 | RSS peak growth | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| No Pointer baseline | 35,999 Mutation | — | 27.433ms / 30.248ms | — | 13.047ms | 5,160,960 bytes | Passed |
| Presence 10 × 10Hz | 179,979 Pointer；35,986 Mutation | 53.120ms | 30.223ms / 35.799ms | 10.170% / 18.352% | 22.190ms | 1,097,728 bytes | Passed |

Presence 正式运行中，10 个发送端各完成 18,000 次 Pointer 更新；全部 10 个接收端最终观测到每个发送端的第 18,000 次更新，最终 lag 全为 0。Baseline Revision 从 700 连续到 36,699，Presence Revision 从 36,699 连续到 72,685；所有客户端最终 Revision 与服务端一致。两轮均无 Canvas Resync、Mutation Reject、协议错误或意外连接关闭，慢客户端保持完整文档序列。

执行后按创建响应 allowlist purge 专用 Canvas，并通过管理 API 删除 9 个临时 Designer Account；停止隔离服务后删除专用 Instance State、临时管理员、全部 Session、凭据文件、Workspace 和 Cache。清理未尝试删除 allowlist 外资源。正式结果为 **Passed**。

## 毕业检查

- [x] Approved Spec 与相关调研在当前分支可追踪。
- [x] 领域词汇、实现、配置、迁移和自动化相互一致。
- [x] 真实浏览器自动化通过。
- [ ] Issue #216：双浏览器或双机 LAN 人工验收通过并附证据。
- [x] Issue #215：无 Pointer 基线与 30 分钟 Presence 正式负载均通过。
- [ ] 将 Approved Spec 状态改为 Implemented/Verified，并填写实际证据。
- [ ] 按 `docs/agents/change-documentation.md` 更新 README、`docs/current/`、相关 ADR 与 `docs/PROJECT-MAP.md`，再移动/毕业 Active 文档。
- [ ] 毕业时在 GitHub Issue #196 补充 #215 / #216 的最终验证摘要，并核对 Project 状态。
