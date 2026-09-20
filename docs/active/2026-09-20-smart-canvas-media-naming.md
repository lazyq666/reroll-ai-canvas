# Smart Canvas 媒体命名与重命名

- **Status**：Implemented（本地自动化与真实页面浏览器回归通过，等待合并）
- **Feature ID**：F05 / F09 / F10
- **Issue**：[GitHub #29](https://github.com/lazyq666/reroll-ai-canvas/issues/29) / Linear LAZ-10
- **Last verified**：2026-09-20
- **Applies to**：Smart Canvas 的 Image Node、Generation Output Node 与 Smart Group 直接媒体
- **Related ADRs**：[Workspace Asset Library 发布边界](../adr/0004-workspace-asset-library-publication-boundary.md)

## 1. 用户合同

用户可双击文件名或在单个媒体的右键菜单选择“重命名”。右键入口只作用于当次命中的图片、视频或音频；多选 Node 不显示媒体重命名。操作复用 Small / Compact `ic-dialog`，输入框编辑不带真实扩展名的名称主体，打开后全选正文；Enter 提交，Escape 或“取消”放弃，输入法组合期间的 Enter 不提交。

名称不能为空，最多 180 个字符，不接受文件系统非法字符。用户可以省略真实扩展名或重复输入同一个扩展名；系统统一只保留一个真实扩展名。若输入另一种已知媒体扩展名，例如 PNG 素材输入 `.mp3`，Dialog 保持打开并显示与真实扩展名一致的错误。

编辑权限由既有 Canvas 权限决定。只读页面不提供入口，提交前再次检查可编辑状态。

## 2. 身份、并发与持久化

打开 Dialog 时冻结媒体定位器，按 `outputId`、`media_id`、`inputInstanceId`、对象引用以及唯一的 URL + kind 逐级重新定位。Dialog 打开期间即使媒体列表重排，确认仍修改原媒体；目标已删除或匹配不唯一时不猜测，保留画布并提示重新操作。

成功提交只修改目标媒体既有的 `name`，沿用 Canvas History、保存与 Realtime 同步，不新增字段、API 或迁移。一次确认产生一次可撤销变更；名称未变化不产生 History。生成恢复或相同输出的后续合并不得覆盖用户已经保存的非空名称。

## 3. 默认名与下载名

新 Generation Output 不采用 Provider 的长文件名。每次结果集合按媒体类型独立编号，并以实际媒体扩展名生成短名称：`image-01.png`、`video-01.webm`、`audio-01.mp3`。批量拆分前统一初始化名称，因此拆成独立 Node 后仍保持连续编号。

真实扩展名从媒体 URL / MIME / kind 解析，编辑后的名称不能改变媒体格式。下载优先使用持久化的 `item.name`，没有名称时才回退 URL 文件名；下载前统一去除重复的真实扩展名并补回一个真实扩展名。重命名后，Badge、预览下载、单媒体下载与批量下载均消费同一名称。

## 4. 文案与可访问性

新增可见文案全部位于共享 i18n，中文使用“重命名素材 / 素材名称”，英文使用“Rename media / Media name”。Dialog 以字段关联的内联错误解释空名称、非法字符、过长、扩展名不匹配和目标失效；不只依赖颜色或 Toast。

## 5. 验证

- `tests/test_issue_29_generation_output_naming.py`：服务端短名称、真实扩展名、批量连续编号和手动名称恢复保护。
- `tests/test_issue_29_media_naming.py`：前端命名、下载、格式校验、精确媒体定位、菜单与双语合同。
- `tests/test_issue_71_generation_output.py`：浏览器端生成输出规范化和恢复路径。
- `tests/issue_29_media_naming_browser_smoke.cjs`：生产 Smart Canvas 页面中的右键入口、Dialog、错误、列表重排、下载名和动态语言切换。
- `node static/js/i18n/validate-i18n.js`：中英文键集合与绑定校验。

本变更不修改 Workspace 数据结构，不需要迁移或 ADR。合并前保持 Active；合并并确认主分支回归后可毕业为 Current。
