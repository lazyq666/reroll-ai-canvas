# Classic Canvas 退役边界

状态：Current
来源：Linear LAZ-8

## 产品合同

Reroll 的产品运行态只提供一种 Canvas，并统一使用 Smart Canvas 数据与交互模型。新建入口不显示类型选择；未提供 `kind` 或提供 `kind=smart` 时创建 Smart Canvas，提供 `kind=classic` 时返回 HTTP 410 与稳定错误码 `classic_canvas_retired`，其他未知类型返回 `unsupported_canvas_kind`。

Canvas List、Project 计数与回收站只展示 Smart Canvas。所有正常打开路径进入 `/static/smart-canvas.html`，产品脚本不再路由到 Classic 编辑器。旧 `/static/canvas.html` 书签只显示退役说明，不加载编辑、生成或保存能力。

## 历史数据

已有 `kind=classic` 记录保持原始类型与内容，不自动转换、不覆盖、不删除。正常读取、打开、编辑、生成与新建分享入口返回 `classic_canvas_retired`；已有 Classic 分享链接也不再返回画布内容。

Workspace 搬迁、SQLite 导入、完整备份和回滚验证可以继续识别并搬运 Classic 记录。该兼容只用于保护历史数据，不构成可编辑产品能力。Classic 到 Smart 的真实内容转换必须另行设计，不能通过改写 `kind` 完成。

## 验证

- `tests.test_canvas_sync_contract.CanvasSyncContractTests.test_canvas_creation_is_smart_only`
- `tests.test_canvas_sync_contract.CanvasSyncContractTests.test_legacy_classic_is_hidden_and_product_routes_reject_without_rewriting`
- `tests.test_canvas_list_ui`
- `tests.test_canvas_list_browse_navigation_contract`
- `tests.test_canvas_management_i18n`
