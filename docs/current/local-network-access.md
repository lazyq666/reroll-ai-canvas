# 本机与局域网访问

> Status: Current  
> Last verified: 2026-09-02  
> Tracked by: [Issue #17](https://github.com/lazyq666/reroll-ai-canvas/issues/17)

## 当前合同

Reroll 默认以 `0.0.0.0` 监听单个本地服务进程，因此服务机自身和同一局域网内的设备都可以访问。启动器始终显示 `http://127.0.0.1:<port>/` 作为本机入口；检测到服务机的局域网 IP 时，同时显示 `http://<LAN-IP>:<port>/`。

这项默认值只改变服务监听范围，不改变 Account、Role、Project Access Grant、Canvas Visibility 或 Share Link 权限。局域网访问者仍需经过产品已有的认证与授权。

## 配置与生效

支持的常用监听配置写在项目根目录的 `.env`：

```dotenv
# 默认：允许同一局域网设备访问
INFINITE_CANVAS_HOST=0.0.0.0

# 可选：只允许服务机自身访问
INFINITE_CANVAS_HOST=127.0.0.1
```

未设置 `INFINITE_CANVAS_HOST` 时等同于 `0.0.0.0`。显式环境变量优先于 `.env`。修改后必须完全停止当前服务并重新运行平台启动入口；启动器不会把新值热更新到已经运行的进程。

`INFINITE_CANVAS_PORT` 默认是 `3000`。端口被占用时，启动器依次尝试后续端口，并将实际端口同时用于本机和局域网地址。

## 安全与失败恢复

- 默认局域网模式只适用于可信网络；它不等于安全的公网部署，也不会自动配置 HTTPS、路由器端口转发或访问边界。
- macOS 或 Windows 防火墙可能在首次监听时要求允许传入连接。拒绝后，本机入口仍可能可用，但其他设备无法连接。
- 启动器无法识别局域网 IP 时，服务仍按配置监听，只是不显示局域网 URL。操作人可从系统网络设置取得服务机 IP，并结合启动器显示的实际端口访问。
- 需要立即缩小暴露范围时，在 `.env` 设置 `INFINITE_CANVAS_HOST=127.0.0.1`，停止服务并重新启动。
- 无效或不可绑定的 Host 会使实际服务启动失败；修正 `.env` 后重新启动，不会迁移或修改 Workspace Data。

## 验证接缝

- `tests.test_launcher.LauncherPortTests.test_server_allows_lan_access_unless_loopback_is_explicit`
- `tests.test_application_factory.ApplicationFactoryTests.test_runtime_server_host_uses_the_launcher_environment_contract`
- `tests.test_launcher.LauncherPortTests.test_project_environment_does_not_override_explicit_process_values`

