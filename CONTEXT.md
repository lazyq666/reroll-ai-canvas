# Reroll

Reroll 是一个视觉创作工作区，人们在持久 Canvas 中组织媒体、提示词与生成逻辑。本文只定义领域语言，不定义文件、API、实现或开发计划。

## Language

### 产品、身份与权限

**Canvas（画布）**:
一个持久的视觉创作空间；每个 Canvas 是 Classic Canvas 或 Smart Canvas。
_Avoid_: Board, Document, 白板

**Classic Canvas（普通画布）**:
使用原始直接媒体编辑体验、而非 Node 与 Connection 生成图结构的 Canvas。
_Avoid_: Smart Canvas, Legacy Document, 经典画布

**Smart Canvas（智能画布）**:
由可识别 Node 及其 Connection 组成的持久空间创作文档。
_Avoid_: Board, Classic Canvas, 白板

**Workspace（工作区）**:
用户选择的可搬迁内容边界，拥有稳定身份并包含相关 Workspace Data。
_Avoid_: Folder, Instance, Device State

**Workspace Data（工作区数据）**:
由一个 Workspace 拥有并随它一起移动的创作内容、Managed Media、历史、Workflow、Prompt Library 和共享非秘密设置。
_Avoid_: Account, API Key, Device State, Device Cache

**Project（项目）**:
Workspace 内用于组织 Canvas 和划分 Designer 访问范围的集合。
_Avoid_: Workspace, Folder, Team

**Account（账号）**:
一个 Reroll 安装中用于认证人员的稳定身份。
_Avoid_: Workspace Member, Session, Anonymous Share Visitor

**Account Avatar（账号头像）**:
代表 Account 的全产品视觉身份；即使没有用户上传的图片，也具有稳定的默认外观。
_Avoid_: Presence Color, Realtime Pointer, Session Avatar

**Role（角色）**:
赋予 Account 的安装级权限类别，对所有 Workspace 保持一致。
_Avoid_: Workspace Role, Project Role, Membership

**Administrator（管理员）**:
可以管理安装、Account、Project、Workspace 和 Provider 配置的 Role。
_Avoid_: Project Owner, Workspace Admin

**Designer（设计师）**:
可以在获授权 Project 中查看和编辑 Canvas、执行 Generation Run 的 Role。
_Avoid_: Editor Role, Project Member

**Guest Account（访客账号）**:
可以登录但不能进入 Canvas 编辑或管理通道的受限 Account。
_Avoid_: Anonymous Share Visitor, Designer

**Anonymous Share Visitor（匿名分享访问者）**:
通过 Share Link 查看一个 Canvas、但不拥有登录 Account 或编辑权限的人。
_Avoid_: Guest Account, Anonymous User

**Project Access Grant（项目访问授权）**:
Administrator 为一个 Designer 指定的、按 Workspace 隔离的可访问 Project 集合。
_Avoid_: Workspace Role, Project Ownership, Membership

**Canvas Visibility（画布可见性）**:
Canvas 的访问模式；Shared Canvas 对获授权 Project 用户可见，Private Canvas 仅对所有者可见。
_Avoid_: Share Link, Project Access Grant

**Share Link（分享链接）**:
可撤销的访问能力，允许 Anonymous Share Visitor 只读查看一个 Shared Canvas。
_Avoid_: Guest Account, Public Canvas, Edit Link

### 实时协作与画布状态

**Realtime Collaborator（实时协作者）**:
正在参与同一 Smart Canvas 并发编辑的获授权人员，与其打开多少标签页或设备无关。
_Avoid_: Realtime Client Connection, Online Socket

**Realtime Client Connection（实时客户端连接）**:
一个浏览器标签页或设备为某个 Smart Canvas 打开的活动编辑通道；一个 Realtime Collaborator 可以拥有多条。
_Avoid_: Realtime Collaborator, Online User

**Realtime Presence（实时在场状态）**:
Realtime Collaborator 参与某个 Smart Canvas 时短暂共享的在线成员与指向状态；它不属于 Canvas 的持久创作内容。
_Avoid_: Canvas Mutation, Canvas Snapshot, Audit Log

**Realtime Pointer（实时指针）**:
Realtime Presence 中代表一个 Realtime Collaborator 当前鼠标所指 Canvas 世界位置的瞬时状态；同一协作者的多条连接共同呈现一个公开指针。
_Avoid_: Mouse Event Log, Canvas Selection, Realtime Client Connection

**Realtime Connection Limit（实时连接上限）**:
同一 Smart Canvas 可同时容纳的活动 Realtime Client Connection 上界，用于区分运行容量保护与 Realtime Collaborator 产品目标。
_Avoid_: Technical Protection Threshold, Collaborator Limit, Online User Limit, Site Capacity

**Canvas Revision（画布版本）**:
Smart Canvas 当前共享状态的顺序身份，用于判断一次编辑基于哪个已知状态。
_Avoid_: Save Timestamp, File Version

**Canvas Sync（画布同步）**:
将一个编辑端尚未完成的 Canvas Mutation 与较新 Canvas Revision 协调为一致状态的领域过程。
_Avoid_: Autosave, Refresh, Full Overwrite

**Canvas Mutation（画布变更）**:
对 Smart Canvas 中 Node 或 Connection 的一次原子、可识别的已提交变化。
_Avoid_: Gesture, Draft, Full Save

**Canvas Edit（画布编辑）**:
对 Canvas 的持久创作内容或身份完成的一次已提交改变；纯访问、个人查看状态、内容管理动作和被放弃的手势都不是 Canvas Edit。
_Avoid_: Canvas Interaction, Canvas Access, Touch, Browse

**Canvas Updated Time（画布更新时间）**:
Canvas 最近一次 Canvas Edit 完成的时间，并在 Canvas 创建时初始化；它不表达最近打开、浏览、访问、存储维护或底层文件变化。
_Avoid_: Last Opened Time, Access Time, File Modification Time

**Operation ID（操作标识）**:
一次用户意图的稳定身份，使重复提交可以被识别为同一 Canvas Mutation 或 Generation Run。
_Avoid_: Request ID, Timestamp

**Canvas Selection（画布选择）**:
一个编辑端当前选择的 Node 或媒体集合，不属于 Smart Canvas 的共享内容。
_Avoid_: Shared Selection, Document Selection

**Selection Arrangement（选区整理）**:
Designer 对当前 Canvas Selection 中多个 Node 主动执行的空间重排；它提交共享的 Canvas Mutation，但不属于新 Node 的自动落位。
_Avoid_: Node Placement, Auto Placement, Canvas Migration

**Canvas Viewport（画布视口）**:
一个编辑端查看 Smart Canvas 的位置和缩放范围，不属于 Smart Canvas 的共享内容。
_Avoid_: Canvas Position, Shared Camera

**Canvas Interaction（画布交互）**:
一次连续的本地用户手势，可以提交一个 Canvas Mutation，也可以在结束时放弃。
_Avoid_: Canvas Mutation, Partial Save

### Node 与空间结构

**Node（节点）**:
放置在 Smart Canvas 中、具有独立身份的创作单元。
_Avoid_: Card, Block

**Image Node（图像节点）**:
持有用户媒体或 Generation Output 的 Node；普通多媒体集合与历史生成画廊不是同一概念。
_Avoid_: Smart Group, Generation Output Gallery

**Layer Decomposition Node（智能分层节点）**:
持有一份 Layer Decomposition Manifest、合成底图与有序透明图层的单一 Node；Canvas 把它作为一张合成图预览，不把内部图层建模为 Image Node 或 Smart Group Member。
_Avoid_: Smart Group, Multi-image Node, Layer Folder

**Prompt Node（提示词节点）**:
持有人工编写 Prompt、并可参与 Connection 和 Generation Run 的 Node。
_Avoid_: Prompt Generation Node, Text Annotation Node

**Prompt Generation Node（提示词生成节点）**:
使用文本 Model 将指令和 Reference Input Instance 转换为生成 Prompt 的 Node。
_Avoid_: Prompt Node, Text Annotation Node, LLM Node

**Text Annotation Node（文本标注节点）**:
只用于解释或标记 Canvas 内容、不参与 Connection 或 Generation Run 的展示 Node。
_Avoid_: Prompt Node, Prompt Generation Node

**Batch Run Node（批量运行节点，界面简称“批量运行”）**:
按任务序号依次或并发替换参考图与提示词变量，并重复执行相邻生成逻辑的 Node；它不创建持久的 Generation Batch。
_Avoid_: Loop Node, 循环节点, Generation Batch, Batch Generation, Smart Cascade

**Splitter Node（拆分节点）**:
将一个结构化 Prompt 或输入集合拆成可分别传递内容的 Node。
_Avoid_: Smart Group, Batch Run Node

**Brush Stroke Node（画笔标注节点）**:
保存自由绘制视觉标注的展示 Node。
_Avoid_: Smart Matting, Image Node

**Connection（连接）**:
两个 Node 之间传递 Prompt、媒体或执行关系的有向联系。
_Avoid_: Edge, Wire, Share Link

**Smart Group（编组，中文界面名称）**:
显式拥有一组有序 Node 或媒体成员的 Node。
_Avoid_: 智能分组（中文界面名称）, Frame, Folder, Multi-image Node

**Smart Group Node Member（编组节点成员）**:
进入 Smart Group 前已经具有独立 Node 身份、并在离开时保持该身份与创作状态的成员。
_Avoid_: Smart Group Media Member, Thumbnail, Copied Media

**Smart Group Media Member（编组媒体成员）**:
直接加入 Smart Group、此前没有独立 Node 身份，并在离开时成为新 Image Node 的媒体成员。
_Avoid_: Smart Group Node Member, Image Node, Reference Input Instance

**Node Rest Geometry（节点还原几何）**:
Smart Group Node Member 离开 Smart Group 后应恢复的普通画布尺寸、比例与位置关系；Smart Group 的整体移动可以平移该关系，Group Presentation 的整理或缩放不能改写它。
_Avoid_: Group Presentation, Thumbnail Size, Current DOM Rect

**Group Presentation（编组展示）**:
Smart Group 内部用于紧凑排列和呈现成员的视觉状态，不改变 Smart Group Node Member 的身份、创作状态或 Node Rest Geometry。
_Avoid_: Node Rest Geometry, Canvas Viewport, Media Mutation

**Frame（分区，中文界面名称）**:
按空间包含关系组织 Node、但不拥有其内容的有标题区域。
_Avoid_: 画布、画布框、框架（中文界面名称）, Smart Group, Section, Artboard

**Node Package（节点包）**:
可在 Smart Canvas 之间移动的一组 Node、其内部 Connection 和相关资源。
_Avoid_: Workflow, Smart Cascade, Clipboard

**Reference Input Instance（参考输入实例）**:
某个媒体在 Prompt Authoring 或 Generation Run 输入中的一次独立出现；同一媒体重复引用时，每次出现仍保持独立身份。
_Avoid_: Media URL, Generation Output, Source File

### Prompt、Provider 与生成

**Prompt Authoring（提示词编写）**:
为 Generation Run 组合 Prompt、Prompt Template 和 Reference Input Instance 的创作活动。
_Avoid_: Composer, Prompt Box

**Prompt Template（提示词模板）**:
可以被选择、复用和编辑的 Prompt 起点。
_Avoid_: Prompt Node, System Message

**Prompt Library（提示词库）**:
Workspace 中组织 Prompt Template 的命名集合。
_Avoid_: Asset Library, Workflow Library

**Provider（生成提供方）**:
执行一种或多种 Generation Run 的外部或本地生成来源。
_Avoid_: Model, Workflow, API Key

**Model（模型）**:
Provider 提供的一个具名生成能力版本。
_Avoid_: Provider, Workflow, Preset

**Model Profile（模型档案）**:
Administrator 按稳定 Model ID 和输出媒体查看、维护的模型详情；同一 Model ID 由多个 Provider 提供时仍是同一个 Model Profile，各 Provider 的可用模型条目都指向它。Model Operation 的运行差异不自然成为并列档案，可编辑显示名称也不是身份。
_Avoid_: Provider Model, Model Capability, Display Name

**Model Discovery Snapshot（模型发现快照）**:
API 设置页一次模型拉取过程中，从同一 Provider 响应或本地 CLI 帮助取得并脱敏后的有界事实快照；其中明确字段可以转成 Model Capability Evidence 和待审核 Draft，但快照本身不证明支持、不会进入运行目录，也不能改变 Generation Run 的约束。
_Avoid_: Model Capability, Runtime Availability, Published Catalog

**Model Capability Matrix（模型能力表）**:
按稳定 Model ID 汇总 Model Profile 输入、输出与参数范围的管理员产品投影；Administrator 通过可用模型中的模型详情维护它，也可以导入外部研究结果。它不是另一份 Model List，并隐藏 Provider 路由、内部 JSON 合同、逐字段 Evidence 和 Catalog Revision。
_Avoid_: Model List, Capability JSON Editor, Provider Capability Table

**Model Capability（模型能力）**:
一个确切 Model 在一种 Model Operation 下支持的输入、输出和参数边界。
_Avoid_: Provider Default, UI Guess

**Model Operation（模型操作）**:
Model 执行的一种明确生成意图，例如文字生成、图片生成、图片编辑或视频生成；同一 Model 的不同 Model Operation 可以具有不同能力。
_Avoid_: Generation Run, Provider Endpoint, UI Mode

**Layer Decomposition（图层拆分）**:
把一个源图像转换为一个底图 Generation Output 和一组透明图层 Generation Output，并保留重建原构图所需空间关系的 Model Operation。
_Avoid_: Smart Matting, Image Edit, PSD Export

**Layer Decomposition Manifest（图层拆分清单）**:
把 Layer Decomposition 的源媒体、Generation Run、底图、各图层及其层级与空间关系关联起来的版本化结构。
_Avoid_: Provider Response, Temporary Result, PSD File

**Model Capability State（模型能力状态）**:
目录对某项 Model Capability 的确认程度，仅分为已确认支持或未确认；它不表达实时可用性、功能成熟度或账号资格。
_Avoid_: UI Status, Runtime Availability, Account Eligibility

**Model Capability Evidence（模型能力证据）**:
能够支持一项 Model Capability 判断的可追溯资料，包含资料来源、取得时间、适用版本和具体内容位置；没有 Evidence 的空白不能由推测补全。
_Avoid_: AI Guess, Model Capability Draft, Provider Availability

**Model Capability Draft（模型能力草稿）**:
根据 Model Capability Evidence 由外部研究包或人工录入形成、尚未进入 Model Capability Catalog 的候选能力；它可以编辑和退回，但不能约束 Generation Run。
_Avoid_: Model Capability, Published Capability, Runtime Contract

**Model Capability Review（模型能力审核）**:
Administrator 对 Model Capability Draft 及其 Evidence 进行核对、修改并决定是否发布的过程；审核完成不必然意味着能力已确认支持。
_Avoid_: Model Capability State, Automatic Publication, Provider Health Check

**Model Capability Review State（模型能力审核状态）**:
Model Capability Draft 在内部维护流程中的进度，分为草稿、待审核、已发布或已退回；它不属于 Model Capability State，也不面向生成用户。
_Avoid_: Model Capability State, UI Status, Runtime Availability

**Model Capability Catalog（模型能力目录）**:
按 Provider、Model 和 Model Operation 识别并带版本身份的一组 Model Capability，是 Generation Settings 展示与 Generation Run 前置校验的共同依据。
_Avoid_: Model List, Provider Config, Pricing Catalog

**Image Model Capability（图像模型能力）**:
图像 Model 在一种图像 Model Operation 下支持的输入、输出结构、Output Aspect Ratio、Resolution Tier 与数量边界。
_Avoid_: Video Model Capability, Shared Image Default

**Video Model Capability（视频模型能力）**:
视频 Model 支持的参考输入数量、组合与时长，Video Generation Mode，以及输出时长、帧率、画幅和清晰度边界。
_Avoid_: Image Model Capability, Shared Video Default

**First-and-Last-Frame Video（首尾帧视频）**:
用一到两张有顺序角色的图片约束视频首帧和尾帧的 Video Generation Mode；该模式中的帧图片不与视频或音频参考混用。
_Avoid_: Image-to-Video, All-around Reference Video, Unordered Reference Images

**All-around Reference Video（全能参考视频）**:
允许图片、视频与音频按 Model 合同混合参与生成的 Video Generation Mode；各类数量、合计数量、单个与合计时长及纯音频可用性都是该模式的能力边界。
_Avoid_: First-and-Last-Frame Video, Generic Video Generation

**Workflow（工作流）**:
可以复用的生成图或执行配置，其身份独立于 Smart Canvas 上的 Node Package 和 Smart Cascade。
_Avoid_: Node Package, Smart Cascade, Prompt Template

**Generation Settings（生成设置）**:
一次 Generation Run 使用的 Provider、Model、输出和 Workflow 选择。
_Avoid_: API Key, Device State, Generic Config

**Lighting Intent（灯光意图）**:
以相机相对坐标、颜色、相对曝光、表观光源尺寸和阴影开关表达目标照明关系的版本化结构化状态；它可以编译为 Prompt 或参考媒体，但本身不是 Model、Generation Settings 或通用 Lightmap。
_Avoid_: Lightmap, Lighting Prompt, Generation Settings, 灯光球图片

**Generation Run（生成运行）**:
解析一组输入和 Generation Settings 后执行一次生成意图的领域记录。
_Avoid_: HTTP Request, Provider Job, Generation Batch

**Generation Output（生成输出）**:
一个 Generation Run 产生并交付给产品的媒体或文本。
_Avoid_: Provider Response, Result Item

**Pending Node（待完成节点）**:
Generation Run 排队、提交或恢复期间，为未来 Generation Output 保留目标身份的 Node。
_Avoid_: Placeholder, Loading Card

**Generation Recovery（生成恢复）**:
继续处理已经离开初始请求、但尚未形成最终状态的 Generation Run。
_Avoid_: Retry, Polling, New Run

**Generation History（生成历史）**:
面向用户发布的已结束生成记录，与 Generation Run 的执行权威状态相区分。
_Avoid_: Run Store, Undo History, Audit Log

**Generation Batch（生成批次）**:
由一次确认创建、包含多个 Generation Run 或任务的持久集合。
_Avoid_: Smart Cascade, Batch Run Node, Generation Run

**Batch Generation（批量生成）**:
预览、确认并执行一个 Generation Batch 的用户工作流。
_Avoid_: Smart Cascade, Batch Run Node, Multi-output Node

**Smart Cascade（智能级联）**:
沿 Smart Canvas 的 Connection 顺序执行一个或多个 Generation Run 的过程。
_Avoid_: Workflow, Generation Batch, Chain Run

**Output Aspect Ratio（输出画幅比例）**:
Generated Image 承诺的宽高关系，不等于精确像素尺寸或 Canvas 显示比例。
_Avoid_: Pixel Size, Display Ratio

**Automatic Aspect Ratio（自动画幅比例）**:
从恰好一个 Reference Input Instance 推导并规范到 Model Capability 支持范围的 Output Aspect Ratio。
_Avoid_: Provider-decided Ratio, Freeform Ratio

**Resolution Tier（分辨率档位）**:
Model 原生的图像尺寸级别，例如 1K、2K 或 4K，不承诺精确宽高像素。
_Avoid_: Export Size, Custom Width and Height

### 媒体与编辑

**Managed Media（托管媒体）**:
由 Workspace 拥有并以可搬迁身份引用的媒体内容。
_Avoid_: Source Device File, Device Cache, Asset Library

**Workspace Asset Library（工作区资产库）**:
由 Workspace 拥有、收录成员显式发布的 Managed Media、供 Workspace 内共同发现和引用的精选集合；产品界面统一称“资产库”，使用“添加”和“移除”表达成员动作，但它不是所有 Managed Media 的自动清单。
_Avoid_: Project Asset Library, Shared Media Library, Volcengine Asset Library, 工作区资产库（界面名称）, 发布、取消共享（界面动作）

**Asset Library Entry（素材条目）**:
一个 Managed Media 在 Workspace Asset Library 中的可撤销发布，其身份独立于媒体本身和既有 Reference Input Instance。
_Avoid_: Managed Media, Reference Input Instance, Asset File

**Image Studio（图像工作室）**:
围绕一个 Node 媒体进行预览和变换的专注编辑空间。
_Avoid_: Preview Modal, Asset Library

**Smart Matting（智能抠图）**:
从一个图像中分离前景并产生新 Generation Output 的 Canvas 操作。
_Avoid_: Brush Stroke, Manual Crop

**Volcengine Asset Library（火山引擎素材库）**:
由 Volcengine Provider 拥有的远端媒体集合，不是 Workspace Asset Library 或 Managed Media。
_Avoid_: Asset Library, Workspace Asset Library, Internal Asset Library, Prompt Library

### 安装与设备边界

**Instance State（实例状态）**:
一个 Reroll 安装拥有的 Account、认证、Session、全局 Role、Project Access Grant 和账号关联记录。
_Avoid_: Workspace Data, Workspace Membership, Device State

**Device State（设备状态）**:
一个设备拥有的秘密、Provider 连接、硬件选择、启动身份和当前 Workspace 选择。
_Avoid_: Workspace Data, Instance State, Device Cache

**Device Cache（设备缓存）**:
一个设备拥有、可以删除并重新生成或下载的派生内容。
_Avoid_: Managed Media, Device State, Workspace Data

**API Settings Package（API 设置包）**:
用于在设备之间转移非 CLI Provider 设置和秘密、但不转移 Account 或其他设备配置的加密产物。
_Avoid_: Raw Environment Backup, CLI Session Backup, Workspace Export
