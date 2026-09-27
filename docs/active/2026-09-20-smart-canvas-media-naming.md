# Smart Canvas 媒体命名与重命名

- **Status**：Implemented（本地自动化与真实页面浏览器回归通过，等待合并）
- **Feature ID**：F05 / F09 / F10
- **Issue**：[GitHub #29](https://github.com/lazyq666/reroll-ai-canvas/issues/29) / [GitHub #137](https://github.com/lazyq666/reroll-ai-canvas/issues/137) / Linear LAZ-10 / LAZ-56 / [LAZ-67](https://linear.app/lazyq/issue/LAZ-67)
- **Last verified**：2026-09-26
- **Applies to**：Smart Canvas 的 Image Node、Generation Output Node 与 Smart Group 直接媒体
- **Related ADRs**：[Workspace Asset Library 发布边界](../adr/0004-workspace-asset-library-publication-boundary.md) / [Canvas 媒体编号分配](../adr/0016-canvas-media-name-allocation.md)

## 1. 用户合同

用户可双击画布上的媒体文件名 Badge，或在单个媒体的右键菜单选择“重命名”。右键入口只作用于当次命中的图片、视频或音频；多选 Node 不显示媒体重命名。编辑时保留 Badge 左侧的媒体图标和“已导入 / AI 生成 ·”身份文字，仅将名称主体在原位切换为无描边的白色输入区，开始时全选正文；Enter 或单击画布其他非输入区域提交，Escape 放弃，输入法组合期间的 Enter 不提交。Frame 标题使用相同的全选、提交和取消手势。单媒体 Badge 进入编辑时保持原有位置；输入区不得覆盖图片，浮动节点工具栏应位于 Badge 上方并留有间距。

名称不能为空，最多 180 个字符，不接受文件系统非法字符。用户可以省略真实扩展名或重复输入同一个扩展名；系统统一只保留一个真实扩展名。若输入另一种已知媒体扩展名，例如 PNG 素材输入 `.mp3`，编辑保持打开并提示与真实扩展名一致的错误。

编辑权限由既有 Canvas 权限决定。只读页面不提供入口，提交前再次检查可编辑状态。

## 2. 身份、并发与持久化

开始编辑时冻结媒体定位器，按 `outputId`、`media_id`、`inputInstanceId`、对象引用以及唯一的 URL + kind 逐级重新定位。编辑期间即使媒体列表重排，确认仍修改原媒体；目标已删除或匹配不唯一时不猜测，保留画布并提示重新操作。

成功提交只修改目标媒体既有的 `name`，沿用 Canvas History、保存与 Realtime 同步，不新增改名 API 或历史迁移。一次确认产生一次可撤销变更；名称未变化不产生 History。生成恢复或相同输出的后续合并不得覆盖用户已经保存的非空名称。

## 3. 默认名与下载名

新媒体采用“功能前缀-画布内序号.真实扩展名”。同一 Canvas 同一前缀独立递增，至少两位；扫描画布内既有媒体（包括编组成员）与已分配高水位，取最大值加一。删除、撤销、刷新和服务重启不回收编号；重做、相同输出重放、复制和移动保留原名。每次批量结果先命名再拆分。独立任务按结果成功提交顺序分配，不按任务开始时间承诺编号。

| 实际功能 | 前缀 / 规则 |
| --- | --- |
| 文生图 / 图生图与多图参考编辑 | `t2i` / `i2i` |
| 扩图 / 角度控制 / 局部修复 | `outpaint` / `angle` / `repair` |
| 智能抠图 / 深度图 | `cutout` / `depth` |
| 智能分层 | 外层媒体 `layers-01.png`，内部底图和图层语义名保持不变；PSD 使用外层结果名 |
| 明确通过灯光参考创建的生成节点 | 后续真正生成时使用 `lighting`；只编辑灯光不分配媒体名称 |
| ComfyUI 自定义、RunningHub 工作流或应用 | `workflow-image` / `workflow-video` / `workflow-audio` / `workflow-text`；RunningHub 官方模型按普通生成分类 |
| 文生视频 / 图生视频 / 首尾帧 / 全能参考 | `txt2video` / `img2video` / `frames2video` / `multi2video`；按提交前解析的命令冻结 |
| 裁剪 / 蒙版 / 涂绘与文字合成 / 缩放 | `crop` / `mask` / `paint` / `resize` |
| 宫格拆分 / 拼接 | `split-01-r1-c1.png`（一次拆分共享组号）/ `join` |
| 宫格 GIF / 视频 GIF | `grid-gif` / `video-gif`，保持 `.gif` |
| 视频首帧 / 尾帧 / 当前帧 | `frame-first` / `frame-last` / `frame-current` |
| 全景视图导出 | `panorama` |
| 无法确定功能的输出 | `image` / `video` / `audio` / `text` |

ComfyUI 内置细节增强和 Klein 图片编辑已按[本地工具退役边界](../current/local-tools-retirement.md)移除。批量运行、级联和重新生成沿用实际功能前缀；提示词生成、反推与优化不占图片编号。分区 PNG 保持分区标题，局部修复 PSD 保持结果名；导出本身不分配新编号。独立工作台和旧画布中的已有名称不批量迁移。

本地裁剪、蒙版、涂绘、缩放、拆分、抽帧和全景导出遇到用户或导入文件的语义名称时保留来源，例如 `角色正面-crop-01.png`；自动默认名不反复串接。来源前缀不改变对应功能的画布级计数范围。

服务端在既有 Generation Output Commit / Canvas Mutation 事务内分配最终名称，客户端只做即时预测。私有高水位和分配回执不参与撤销，随完整备份/导入保留。并发端即使都预测 `t2i-01.png`，服务端确认后也是不同编号；失败事务不消耗编号。新媒体保存 `autoName` 溯源信息以复用分配，手动改名继续只改 `name`。详见 [ADR-0016](../adr/0016-canvas-media-name-allocation.md)。

真实扩展名从媒体 URL / MIME / kind 解析；修改名称不改变媒体格式。下载优先使用持久化的 `item.name`，没有名称时才回退 URL 文件名，并去重、补齐真实扩展名。Badge、预览下载、单媒体下载与批量下载均使用同一名称。前缀作为稳定文件名标记不随语言切换，名称模板在共享中英文 i18n 中维护。序号只保证新自动分配不冲突，用户手动同名和复制素材仍可同名，ZIP 继续按既有规则处理碰撞。

## 4. 文案与可访问性

新增可见文案全部位于共享 i18n，中文使用“素材名称”，英文使用“Media name”。输入框以双语可访问名称标识；输入无效时保留编辑状态并显示错误提示。

## 5. 验证

- `tests/test_issue_29_generation_output_naming.py`：服务端短名称、真实扩展名、批量连续编号和手动名称恢复保护。
- `tests/test_issue_29_media_naming.py`：前端命名、下载、格式校验、精确媒体定位、菜单与双语合同。
- `tests/test_issue_71_generation_output.py`：浏览器端生成输出规范化和恢复路径。
- `tests/issue_29_media_naming_browser_smoke.cjs`：生产 Smart Canvas 页面中的右键入口、原位编辑、错误、列表重排、下载名和动态语言切换。
- `node static/js/i18n/validate-i18n.js`：中英文键集合与绑定校验。

LAZ-67 增加自动命名溯源和私有序列状态，不新增数据库表或改名 API，旧数据按需初始化，无需历史迁移；持久化边界记录于 ADR-0016。合并前保持 Active，合并并确认主分支回归后可毕业为 Current。

新增验证：`tests/test_canvas_media_sequences.py` 覆盖跨任务、跨前后端、真实 SQLite 并发、幂等、删除/撤销/重做、编组、拆分、导出/导入和前后端分类一致性；`tests/canvas_media_naming_browser.cjs` 在隔离的生产页面验证生成结果、手动名称、实际裁剪、下载名和语言切换。

2026-09-26 本地验证结果：生成、存储、同步与 Realtime 相关组合回归 233 项通过；最终命名、模块、文档与 i18n 组合回归 58 项通过；分层导出、扩图、深度图与抠图相关回归 28 项通过（组合间存在重叠，不累计计数）。`node tests/canvas_media_naming_browser.cjs` 通过，确认 `t2i-02.png` 连号、手动名称重放保护、`角色正面-crop-01.png` 来源保留、下载和中英文切换。`node static/js/i18n/validate-i18n.js`、`python3 scripts/sync_frontend_assets.py --check` 与 `git diff --check` 通过。未调用付费 Provider；提交、合并及主分支验证仍待后续执行。
