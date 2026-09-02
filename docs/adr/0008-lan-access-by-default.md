# ADR-0008: 默认允许局域网访问

- Status: Accepted
- Date: 2026-09-02

## Context

Reroll 是面向可信小团队的本地优先视觉创作工作台，实时协作和跨设备使用要求同一局域网内的浏览器能够连接服务机。此前服务默认只监听 `127.0.0.1`，操作人必须先创建项目 `.env` 并了解 `INFINITE_CANVAS_HOST`，导致平台启动入口成功运行后，其他设备仍无法访问。

把服务暴露给局域网会扩大网络可达范围。该变化不能绕过已有 Account、Role、Project Access Grant、Canvas Visibility 或 Share Link 权限，也不能被描述为适合公网直接部署。

## Decision

未显式配置 `INFINITE_CANVAS_HOST` 时，启动器和实际 Uvicorn 服务都使用 `0.0.0.0`。平台启动入口在能够识别服务机局域网 IP 时显示局域网访问 URL，同时始终保留 `127.0.0.1` 本机入口。

操作人可以在项目 `.env` 或进程环境中显式设置 `INFINITE_CANVAS_HOST=127.0.0.1`，恢复仅本机监听。进程环境优先于 `.env`；监听配置只在完整重启后生效。

默认局域网模式只面向可信网络。公网部署仍需要 HTTPS 反向代理、安全 Cookie、可信访问边界、备份和独立的运维判断。

## Alternatives considered

- **继续默认仅本机**：网络暴露最小，但无法满足双击启动后直接进行同网协作的产品目标，且把必要配置知识转嫁给操作人。
- **新增第二个“局域网启动”脚本**：显式但会增加平台入口、安装说明和支持分支；现有 `.env` 已足以承担仅本机覆盖。
- **启动时交互询问网络模式**：每次启动都会增加阻塞步骤，不适合双击入口和无人值守恢复。

## Consequences

- 同一局域网内的设备默认可尝试连接 Reroll；产品认证和授权继续决定连接后的可见与可操作范围。
- 防火墙拒绝传入连接时，本机访问仍可能成功，局域网访问会失败；运行说明必须保留排查方式。
- 在不可信网络使用时，操作人必须显式切回 `127.0.0.1` 或提供更强的网络边界。
- 默认值在启动器和实际服务入口都有回归测试，避免只修改其中一层形成假开放。

## References

- [Issue #17](https://github.com/lazyq666/reroll-ai-canvas/issues/17)
- [本机与局域网访问](../current/local-network-access.md)
- `backend/launcher.py`
- `backend/infinite_canvas/__main__.py`
- `tests/test_launcher.py`
- `tests/test_application_factory.py`

