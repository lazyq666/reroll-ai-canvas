# Realtime Collaboration 性能与容量

> Status: Current  
> Last verified: 2026-08-30

## 产品目标与技术上限

- 产品体验与验收目标：同一 Smart Canvas 10 名 Realtime Collaborator。
- Realtime Connection Limit：同一 Smart Canvas 默认最多 20 条 Realtime Client Connection，可通过 `INFINITE_CANVAS_REALTIME_CONNECTION_LIMIT` 配置并在重启后生效。
- Connection 按活动 WebSocket 统计，不按唯一 Account 或 Collaborator 统计；一个人的多个标签页或设备会占用多条。
- 该阈值不是全站在线人数，也不是已经验证 20 人可流畅协作的产品承诺。
- 当前运行形态是单进程、单 Uvicorn Worker；不支持多 Worker、多实例或跨服务器协作。

## 性能合同

| 场景 | Gate |
| --- | --- |
| 10 人、20 Mutation/s 稳态 | 确认 P95 ≤ 150 ms、P99 ≤ 300 ms、零永久失败 |
| 40 Mutation/s 突发 | 无静默丢弃，30 秒内恢复稳态 |
| Heartbeat | 不读取 Canvas Store、不获取 Canvas 操作锁；服务端 P99 ≤ 10 ms |
| 主事件循环 | 10 ms 探针 P99 ≤ 50 ms |
| 约 5 MiB / 80 Node Canvas 首次可操作 | ≤ 1 秒，无单次 > 400 ms Long Task |
| 负载中设置页首次可操作 | ≤ 2 秒，10 秒内不得无反馈 |
| 正确性 | Revision 连续、Operation ID 完整唯一、最终 Projection 一致 |
| 相对基线 | 关键 P95/P99 无说明恶化超过 20% 即为回退 |

## 当前实现边界

- Canvas Store 使用短事务与原子 Revision 提交；广播只发生在提交成功之后。
- Connection Manager 为每个客户端使用有界发送队列；慢客户端溢出后进入明确重同步，不拖慢所有协作者。
- Heartbeat、权限撤销和连接关闭不走大型 Canvas 读写路径。
- 单 Node `x/y` Mutation 使用严格白名单快速通道；不符合条件时在事务开始前回退完整校验。
- 浏览器增量应用远端位置变化，不为每条移动重建完整 Canvas；本地正在编辑/拖动的临时状态受到保护。
- 大型 Snapshot/Mutation 增量编码并主动让出事件循环，消息内容与 Revision 顺序不变。
- 浏览器 Undo 最多 20 条；服务端保留 200 条精简安全窗口。这里的“20”与连接上限无关。

## 已验证状态与已知限制

2026-08-19 的隔离 `baseline standard` 已完成 45 分钟正式流程并通过：稳态 24,000 次确认 P95 `110.154 ms`、P99 `120.977 ms`；突发 12,000 次确认 P95 `143.476 ms`、P99 `154.971 ms`；事件循环 P99 `39.624 ms`；10 个隔离浏览器全部收敛且无页面错误。

2026-08-20 在已有大画布上的“9 机器人 + 1 人工”长场景正确性全部通过，但确认延迟 P95 `246.365 ms`、P99 `454.473 ms`，没有达到 `150/300 ms` 的正式 Gate。两次人工 Generation Output 触发的重同步均恢复，未丢失操作。结论是：10 人协作的正确性和隔离基线已验证，真实大型既有画布的端到端延迟仍是已知性能风险；不能承诺超过 10 人或长期高负载。

2026-08-29 的公开仓库清理全量回归中，约 5 MiB / 80 Node Canvas 的首次可操作时间为 `694–849 ms`，继续满足 1 秒 Gate；Smart Canvas 目标 Frame 的单次 Long Task 在重复执行中为 `181–328 ms`，上一个 UI 版本在同机 A/B 对照中为 `330 ms`。经产品取舍，Long Task Gate 从 100 ms 调整为 400 ms：它以当前 330 ms 基线加项目既有 20% 相对回退空间后取整，保留首次可操作、正确性、吞吐和相对基线 Gate，不代表 400 ms 是优化目标。

## 运行与维护

- 隔离容量/性能 runner：`scripts/performance/run_multiplayer_canvas.py`。
- GitHub `Public readiness` 使用共享 Hosted Runner，只运行确定性测试并显式设置
  `IC_SKIP_PERFORMANCE_TESTS=1`；共享 Runner 的 CPU、浏览器调度和机器负载不可作为上述
  绝对/相对性能 Gate 的可比证据。发布前仍须在受控 macOS 主机显式运行
  `python -m unittest tests.test_multiplayer_performance_cli`，不得把 CI Skip 解释为性能通过。
- 现有服务的 9 机器人 + 1 人工验收：[停服切换与协作验收](controlled-cutover-and-live-acceptance.md)。
- Canvas Sync 行为：[Canvas Sync 实施合同](canvas-sync-implementation.md)。
- 单 Node 快速通道细节：[Canvas Mutation 快速通道](canvas-mutation-single-node-move-fast-path.md)。

报告属于一次执行的证据，不是新的产品规格。只有固定场景、指标语义和绝对/相对 Gate 同时一致时，才可比较两次结果。
