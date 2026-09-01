# scripts 目录说明

这里不是管理员需要逐个点击的工具箱，也不是 Reroll 页面运行时会自动加载的
功能代码。它保存的是开发、验证和运维流程使用的底层命令。

- 根目录中的 `build_*`、`audit_*`、`import_*` 等脚本用于生成或检查设计系统产物；
- `sync_infinite_canvas_ui_version.py` 根据组件库 JS、设计令牌和 WebAwesome 适配样式生成统一内容指纹，并同步所有组件库模块引用；提交相关改动前运行该脚本，CI 使用 `--check` 校验；
- `performance/` 用于可重复的性能测试和验收；
- `storage/` 用于受保护的数据迁移流程；
- 部分脚本由 `tests/` 自动调用，其余由开发者或运维人员按文档明确执行。

App 正常运行时使用的后端功能位于 `backend/infinite_canvas/`，浏览器功能位于
`static/`。面向管理员、适合直接双击的入口统一放在 `admin-tools/`；这些入口可以
调用本目录中的底层命令。
