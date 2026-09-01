# 工作区资产库与 Smart Canvas 本地引用

> Status: Current
> Feature: F10 · GitHub Issues #128, #177, #223
> Last verified: 2026-08-31

## 目标与范围

Workspace Asset Library（工作区资产库）是成员把已有 Managed Media 显式发布后形成的共享精选集合。产品界面统一称“资产库”，成员使用“添加”和“移除”管理其中的图片；“发布”“取消共享”和 Publisher 只描述内部领域与技术语义。它不是 Workspace 中所有媒体的自动索引，也不复制、移动或取得底层媒体文件的所有权。

当前版本提供：

- Smart Canvas 的 `@` 媒体选择器，在“当前画布”和“资产库”之间切换；
- 从 Composer、Prompt Node 与 Prompt Generation Node 上传 TXT、图片、视频和音频作为本地引用；
- 从单张图片或多选图片添加到资产库；
- 独立 X-Large 管理弹窗中的文件夹分类、搜索、外部图片批量导入、单项插入、改名和移除；
- 生成提交前的 TXT 与 Model Capability 校验。

非目标：资产库的外部导入不接受视频或音频，不删除 Managed Media，不绕过 Workspace 权限，也不承担 Provider 自有远端素材库的职责。

## 参与者与权限

- Administrator 和 Designer 可以查看资产库、添加图片，并从中插入 Image Node 或素材引用。
- 添加时服务端重新读取来源 Smart Canvas，并按现有 Project Access Grant、Canvas Visibility 和所有者规则鉴权；客户端提交的来源信息不是权限证明。
- 只有素材条目的首位 Publisher（界面称“添加者”）或 Administrator 可以改名、移除。相同媒体的后续添加是幂等命中，不转移管理权。
- Administrator 和 Designer 都可以创建、重命名、删除共享文件夹，并把素材拖入文件夹；删除文件夹只清除分类，不移除其中素材。
- Guest Account 与 Anonymous Share Visitor 不进入这些编辑或管理入口。
- 列表响应不暴露来源 Project、Canvas 或 Node；引用快照只保留媒体稳定标识、素材条目标识与用户可见名称。

## `@` 媒体选择器

### 当前画布

候选来源是当前 Smart Canvas 的全部图片、视频和音频，包括锁定、离屏以及位于 Smart Group 中的成员。媒体以 `media_id` 为首选身份、URL 为兼容身份去重；同一媒体出现多次时，保留离本次触发目标最近的实例。

排序依次使用距离、纵坐标、横坐标、创建时间、Node ID 和原始位置。打开选择器时冻结目标中心点，后续滚动或分页不因目标 Node 被移动而重排。不可读取但仍有失败记录的媒体显示不可选择占位。

### 资产库

搜索词在服务端以 Unicode NFKC + case-fold 归一化并执行名称包含匹配。列表按发布时间倒序、每页最多 60 条，Cursor 冻结首次请求的快照；弹窗或选择器已经打开后，新发布条目不会插入当前分页序列。

媒体模式使用约 120px 宽的 Masonry Card，并保持自然比例；极端长宽比用 `contain` 完整展示。视频只加载约 0.5 秒位置的 Poster，不创建逐卡 Video Player；音频只在用户点击试听动作后创建一个共享 Player，移出卡片、切换 Tab 或关闭选择器立即停止。方向键按视觉位置选择最近 Card，Enter 插入，Escape 关闭；到达窗口末尾时请求下一页。选择器最多渲染 60 个候选 DOM Node。

两个 Tab 共享搜索词，各自保存活动项和滚动位置。Loading、Empty、Error 与 Retry 都在当前 Tab 内反馈，不以另一个 Tab 的结果替代失败状态。

每个 Tab 当前已加载的候选中，已经属于当前 Composer、Prompt Node 或 Prompt Generation Node 的媒体按其现有引用槽位顺序排在最前，并在置顶区域内以固定尺寸（`4.0625rem × 4.0625rem` / 65px × 65px）按从左到右、再从上到下排列，从而显示更多置顶项并减少高度占用。已引用 Card 复用 `ic-reference-thumbnail` 的方形封面、Border、圆角与底部通栏 Label 视觉，底部 Label 直接显示引用槽位名称（如“图片1”“图片2”），不再显示“已引用”；Hover Mask 使用相同的“媒体类型 + 序号”而不是素材原名。再次选择同一候选不会新增 Reference Input Instance 或 Undo 历史，但通过 `@` Picker 选择时会复用原引用实例，在当前光标位置插入新的 Mention Token。引用状态优先以 `media_id`、兼容以 URL 对齐，未引用候选继续保持各来源原有排序。

## 本地引用与 TXT

一次可以选择最多 20 个 TXT、图片、视频或音频文件。目标 Node 在打开系统文件选择器时冻结；上传结束时若目标已删除，结果不会改投当前选中的其他 Node。

服务端逐文件导入 Managed Media，相同内容复用已有文件。单文件默认上限 500MB，由 `INFINITE_CANVAS_MAX_UPLOAD_BYTES` 配置并在重启服务后生效。一个文件失败不会回滚同批次已成功文件；界面汇总成功数、失败数和逐文件原因。

TXT 在导入时保存不可变文本快照，依次尝试 UTF-8 BOM、UTF-16 BOM、UTF-8 和 GB18030。单个 TXT 超过 1MB 或无法解码时保留引用并记录明确错误；一次 Generation Run 的 TXT 总量超过 2MB 时同样阻止提交。TXT 缩略项可以删除、预览和拖拽排序。

模型最终收到的 Prompt 顺序固定为：

1. Smart Group Prompt；
2. 上游 Prompt Node 文本；
3. 按缩略项顺序排列的本地 TXT 快照；
4. 当前 Composer 正文。

各段只用两个换行连接，不自动增加文件名或标题。TXT 内容进入 `generationInputSnapshot.prompt`；后续修改或删除本地引用不改变已经提交的 Generation Run。

## 生成前校验

媒体引用在选择和上传阶段不按当前 Model 过滤，因为用户可能随后切换 Model。点击生成时，Generation Run 才以最终 Generation Settings 和确切 Model Capability 检查 image / video / audio 输入。

图片输出当前只接受图片引用。视频输出根据最终 Reference Mode 和视频能力表判断：首尾帧与 image-to-video 只接受图片，多模态模式按该 Model 的 image / video / audio 数量上限判断。不支持的引用会按“名称（类型）”列出；校验失败不创建 Pending Node、不提交 Provider。

## 添加、容量与管理

添加只接受来源 Smart Canvas Node 中仍存在、可读取且确认为图片的 Workspace URL。内部发布目录使用内容 SHA-256 作为幂等键：同一图片只产生一个 Asset Library Entry。多选中混入无图片 Node 时只添加图片并反馈跳过数量。

资产库最多保存 5,000 个素材条目，单个添加请求最多 200 项。一次添加要么完整创建全部新条目，要么在容量不足、任一来源失效或保存失败时一个都不创建；已存在的幂等命中不占用新容量。

管理弹窗每页 60 条、可见窗口最多 120 个 Card，Card 目标宽度约 180px，并使用 Lazy Image。整体复用提示词模板库的双栏信息架构：左侧 Small 搜索框下方依次显示“全部”、共享子文件夹和“新建文件夹”，右侧是批量导入 Toolbar 与素材结果；窄屏时 Sidebar 移到结果上方。文件夹显示素材数，支持就地新建、重命名、危险确认删除；素材 Card 可拖入任一文件夹，拖回“全部”则清除分类。删除文件夹后，其中素材继续保留在“全部”，底层 Managed Media 与既有引用均不受影响。

“批量导入”按钮打开原生文件选择器，允许从外部文件夹一次多选最多 200 张图片；导入目标是打开选择器时所在的当前资产库文件夹，在“全部”中导入则不设置文件夹。服务端逐文件验证图片内容并导入 Managed Media，再按内容 SHA-256 幂等添加 Asset Library Entry。单文件沿用 Workspace 媒体的 500MB 默认上限；无效图片不会进入目录，同批其他有效图片继续导入，完成后在 Toolbar 汇总新增、已存在和失败数量。导入不要求图片先进入 Smart Canvas，也不创建 Canvas Node。

素材名称默认显示在图片下方，与图片间隔一个 `--ui-space-1`；图片使用 `--ui-radius-xs`。Pointer 点击 Card 或聚焦后按 Enter，会在当前 Canvas Viewport 中心附近插入一个自动避让的 Image Node；插入后关闭 Dialog、选中并 Reveal 新节点。插入复用素材现有 Managed Media，并快照 `url`、名称、`media_id` 与 `assetLibraryEntryId`，不复制媒体字节。快速重复激活只接受第一次。

只有可管理条目在 Card Hover 或键盘 Focus 时，于名称行末端显示编辑和移除图标按钮，这些管理动作不得触发插入；行内编辑沿用提示词模板库分类名称的 Small 输入样式，并支持 Enter 提交、Escape 取消和失焦提交。从资产库移除复用与提示词模板库分类删除相同的危险确认浮层，明确说明该图片将不再出现在资产库中，但不会删除画布图片或已插入引用。外部文件选择只由“批量导入”按钮触发；搜索、Loading、Empty、Error 与 Retry 均在当前文件夹内就地完成。

从资产库移除只删除内部发布记录。底层 Managed Media、Canvas 中已有图片、Reference Input Instance 和 Generation Run 快照都保持不变。

## 数据与 API

- 发布目录：`<workspace>/data/workspace_asset_library.json`；属于 Workspace Data，随 Workspace 搬家。
- 媒体字节：继续位于 `<workspace>/assets/` 的 Managed Media 区域。
- `GET /api/workspace-assets`：名称搜索、文件夹筛选、文件夹计数和 Cursor 分页。
- `POST /api/workspace-assets/publish`：原子、幂等地添加图片。
- `POST /api/workspace-assets/import`：从外部多选图片导入 Managed Media，并添加到当前文件夹。
- `PATCH /api/workspace-assets/{entry_id}`：添加者或管理员改名；Administrator 或 Designer 可更新文件夹分类。
- `DELETE /api/workspace-assets/{entry_id}`：添加者或管理员从资产库移除图片。
- `POST /api/workspace-assets/folders`：创建共享文件夹。
- `PATCH /api/workspace-assets/folders/{folder_id}`：重命名共享文件夹。
- `DELETE /api/workspace-assets/folders/{folder_id}`：删除文件夹并保留其中素材。
- `GET /api/ai/upload-limits`：本地引用公开限制。
- `POST /api/ai/upload`：逐文件导入并返回部分成功结果。

目录通过临时文件与原子替换保存，并在当前单进程、单 Uvicorn Worker 运行合同下使用进程内锁串行化。多 Worker 或多实例写同一 Workspace 不属于支持范围。

## 验证入口

- `tests/test_workspace_asset_library.py`：内容幂等、容量原子性、Unicode 搜索、Cursor 快照、文件夹迁移兼容、分类 CRUD、管理权限和移除不删媒体。
- `tests/test_workspace_media_integration.py`：媒体复用、部分成功、TXT 编码与大小错误。
- `tests/test_issue_128_workspace_asset_ui.py`：双 Tab、DOM 上限、单 Audio Player、冻结目标、TXT 顺序、管理弹窗和运行快照合同。
- `tests/workspace_asset_library_browser_smoke.cjs`：管理弹窗的 Sidebar、文件夹筛选和新建、外部文件多选导入及目标文件夹、名称布局与 Token、Card 插入意图、Hover 动作、行内改名、危险确认、焦点返回及请求去重。
- `tests/workspace_asset_library_insert_browser_smoke.cjs`：真实 Smart Canvas 中的单击插入、重复激活隔离、素材身份快照、Viewport 落位、Dialog 关闭、选择、Focus 与实时持久化；通用 Mutation 回归另行覆盖 Undo。
- 真实 Smart Canvas 页面已验证资产库入口组件合同、X-Large Dialog、搜索/错误/重试/Focus，以及 `@` 双 Tab 的可访问结构。

相关决定见 [ADR-0004：工作区资产库的发布目录边界](../adr/0004-workspace-asset-library-publication-boundary.md)。
