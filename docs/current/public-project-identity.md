# 公开项目身份与兼容边界

> Status: Current
> Last verified: 2026-09-01

## 公开身份

| 字段 | 权威值 |
| --- | --- |
| 产品名 | Reroll AI Canvas |
| GitHub 仓库 | `lazyq666/reroll-ai-canvas` |
| 英文简介 | A local-first AI canvas for image and video generation, visual workflows, asset management, and small-team collaboration. |
| 中文简介 | 面向图片与视频生成的本地优先 AI 无限画布工作台，支持可视化工作流、素材管理与小团队协作。 |
| 许可定位 | 带非商业限制的源码公开项目（source-available），不是 OSI 定义的开源软件 |
| README 截图 | `docs/assets/reroll-ai-canvas-overview.png` |
| 社交分享图 | `docs/assets/reroll-ai-canvas-social-preview.png`（1280×640） |

README、GitHub About、社交分享图和可选的 ModelScope 镜像必须使用这组
身份。项目继续明确保留原作者 `hero8152`、原项目链接和现行 `LICENSE`。

## 不随品牌改名的兼容标识

下列名称已被部署脚本、用户数据或外部集成依赖，本次公开发布只改品牌，
不做全局重命名：

- `INFINITE_CANVAS_*` 环境变量；
- Python 包、模块和导入路径中的 `infinite_canvas`；
- Workspace 目录、标记文件、导入/导出格式、MIME 类型和数据库字段；
- 浏览器本地存储 key、URL 路径、公共 `ic-*` 组件名和 CSS Token；
- 用于安装、备份、迁移或第三方自动化的旧脚本接口。

未来如需改这些标识，必须作为独立的兼容性迁移：提供双读/双写或显式
迁移器、回退路径和升级测试，不得与视觉品牌替换混在同一次改动中。

## 仓库与 Issue 历史

公开仓库使用经过审计的全新 Git 根提交，旧仓库保留为私有开发档案。
旧 Issue 编号只作历史追溯，不在公开文档中伪造同编号链接。公开仓库从新的
Issue 序列继续跟踪未完成工作。
