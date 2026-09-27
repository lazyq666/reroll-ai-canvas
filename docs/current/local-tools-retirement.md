# 本地工具退役边界

- Status: Current
- Date: 2026-09-26
- Tracking: [LAZ-68](https://linear.app/lazyq/issue/LAZ-68)

## 产品边界

首页主导航只提供「画布」和「在线生成」。原「本地功能」分组及文生图、细节增强、图片编辑、角度控制四个独立页面已移除。账号、设置、主题和语言入口沿用原权限及交互。

画布 ComfyUI 只提供 `text`（文生图）和 `custom`（自定义工作流）；不再提供 `enhance`（细节增强）和 `edit`（Klein 图片编辑）。ModelScope 内置选项保留 Z-Image、Qwen Edit 和自定义模型，移除 Klein 快捷选项、默认 Klein 模型和默认 Klein enhance LoRA。通用 ModelScope 请求必须显式指定模型，不再默认调用 Klein。

画布角度控制、其他模型的图生图、Image Studio、局部修复、自定义工作流及公共 Provider 能力继续提供。退役的是产品内置路径，不建立针对用户自定义模型或工作流内容的黑名单。

## 页面与接口

- `/static/zimage.html`、`/static/enhance.html`、`/static/klein.html`、`/static/angle.html` 返回不缓存的 307 跳转至 `/`，不保留工具页实现。
- 首页遇到无效的已保存页面 ID 时回到画布，并更新当前页面记忆。
- 删除专属 `/api/generate`、`/api/queue_status` 和 `/api/angle/poll_status` 路由。
- 保留画布使用的 `/generate`、`/api/ms/generate`、`/api/angle/generate`、`/api/canvas-comfy-tasks`、后台 Run 查询与恢复，以及工作流管理接口。
- 不再随产品分发 `Z-Image-Enhance.json`、`Flux2-Klein.json` 及原独立工具专属的 `2511.json`、`upscale.json`。缺失工作流在创建画布任务前返回 404，不创建 Generation Run，也不联系 ComfyUI。
- 前端生成提交拒绝非 `text` / `custom` 的 ComfyUI 模式，不能落入自定义工作流执行分支；不存在的 ModelScope 快捷选项同样不能提交。

## 数据与失败边界

本次实施前用户确认没有旧数据和在途任务，因此不增加退役数据迁移、旧节点保留模式或任务排空层。删除版本控制内的专属代码和内置资源，不删除 Workspace 内容、用户工作流或 Provider 凭据。无效工作流沿用现有不可用提示和失败反馈，中英文文案来自共享 i18n。

## 验证入口

- `tests/test_local_tools_retirement.py`：旧地址跳转、生产导航、专属接口不存在、共享接口保留、默认配置和缺失工作流不创建任务。
- `tests/local_tools_retirement_contract.cjs`：退役模式不发送请求，ComfyUI 文生图和自定义工作流继续提交。
- `tests/local_tools_retirement_browser.cjs`：真实画布页面中的剩余模式、ModelScope 选项、中英文动态文案及 Light/Dark。
- `tests/t30_studio_shell_browser_smoke.cjs`：首页折叠/展开、导航、权限、菜单、主题及画布编辑器往返。
- `tests/test_smart_canvas_generation_provider_pending.py`、`tests/test_generation_recovery_routes.py`、`tests/test_remote_generation_contracts.py`：保留的提交和任务恢复合同。

完成时同时执行 i18n 校验、文档知识地图测试，以及 `scripts/sync_frontend_assets.py --check`。外部 Provider 采用确定性替身，不以本次退役声明真实服务可用性。
