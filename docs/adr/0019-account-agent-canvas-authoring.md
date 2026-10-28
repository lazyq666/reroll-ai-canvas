# ADR-0019: 外部 Agent 以 Account 身份编排 Canvas，由编辑端执行

- Status: Accepted
- Date: 2026-10-17
- Source: [F17 规格](../active/2026-10-17-agent-mcp-canvas-authoring-spec.md)、[LAZ-88](https://linear.app/lazyq/issue/LAZ-88)

## Decision

外部 Agent 通过随仓库发布的 Python stdio MCP 桥接访问版本化 `/api/agent/v1/`。
桥接只读取用户配置的本地目录，令牌属于 Account，服务端每次重新验证账号与画布权限。
令牌哈希、总开关和账号偏好属于 Instance State，不随 Workspace 搬迁；Bearer 不产生 Session。
本地路径不发往服务器，导入后只使用 Managed Media 身份。

首次连接采用 Agent Pairing：桥接本机生成随机凭证，只登记哈希；已登录的 Designer 或 Administrator
在网页明确同意后，以批准者账号原子签发 `authoring` + `run` 不过期令牌。没有已批准的凭证就不能
执行原始工具动作。总开关关闭时仅 Administrator 可批准并同时开启，弹窗明确说明此效果。
请求向当前 Instance 的合资格登录账号显示；账号、来源 IP、请求方自报名称与随机识别码一起展示，
用户只应批准自己刚发起且识别码一致的请求。名字不是可信身份。并发批准只允许一个账号成功。
拒绝、10 分钟过期和速率限制不会授予权限；跨站网页不能发起或批准配对，Bearer 不能批准配对。

长期凭证由桥接按服务地址和 MCP 客户端名隔离，写入 Agent 设备的私有文件；网页不显示也不复制
配对凭证。短期请求记录属于 Instance State；审批后仍逐次执行既有 Account、Role 与资源授权。
手动令牌仅保留后台兼容接口与已有配置支持，连接弹窗不再提供创建、展示或撤销入口；权限检查不变。

“应用连接”弹窗按客户端与操作系统生成无凭证安装包，携带浏览器访问的服务地址和明确白名单内的
桥接源码。设备端安装器在用户目录准备独立 Python 环境，合并目标应用的 MCP 配置并备份旧文件；
不在服务器上修改客户端配置，不借安装动作授予账号权限。新环境验证成功后才替换配置，保留旧环境
以支持备份回滚；配置损坏、符号链接或检测到并发变化时停止。网页下载与首次网页授权是两个边界。
该决定避免依赖全局 Python/PATH 或尚未发布的 npm/PyPI 桥接包，代价是首次安装需要联网下载运行时，
用户仍须解压运行并重启应用；安装器当前支持 macOS 与 Windows，不宣称浏览器可直接执行安装。

所有创作写入继续由 Canvas Sync 执行。服务端持有同一画布操作锁完成引用解析、能力预检、
固定网格布局与提交；新分区以已解析的现存参考节点包围盒为锚点，无参考节点时以私有视口中心、
无视口时以画布原点为锚点，在二维空间确定性避让。提交用 `exact` 位置意图，不重排既有节点。
创建与详情投影公开最终画布几何，不公开私有视口。Submission 身份和请求摘要随
既有 Mutation 回执中的变更保留，重试回读原回执，不新建第二条画布写入路径。

单媒体引用通过 Connection 和来源身份绑定的 @ 标记共享；连接标记在编写与运行时重新读取
实时输入，不可退化为旧媒体 URL。无法精确表达的普通多媒体部分引用按规格显式返回快照警告。
Editor Context 仅存在进程内存，按账号隔离；它不是协作在场广播，也不进入 Canvas 内容。

Agent Run Request 保存在 Workspace 的 Canvas SQLite authority，由同账号页面以租约领取。
页面通过既有 Generation Run 入口运行，使用节点草稿解析器，防止批量运行串用当前 Composer
中的另一条草稿。Generation Run 仍独占提交、恢复和写回状态；Agent 请求只保留领取意图。

## Alternatives and consequences

远程 HTTP MCP 无法读取另一台电脑的本地目录，故第一、二阶段只提供本地 stdio。
服务端另写提示词整理和 Provider 转换会形成第二套生成语义，故执行依赖打开的编辑端。
第三阶段若引入无浏览器执行，必须先提炼同一生成编译合同并另立规格，不能直接在 Agent API
中调用 Provider。可信局域网边界继续遵守 ADR-0008。

手动复制令牌作为默认接入步骤让本地 Agent 配置过于繁琐；网页批准保留了主动授权边界，也省去
复制秘密。相比无需确认的 localhost 信任，配对不会把网络可达性当作账号权限；相比每次弹窗，
长期可撤销凭证符合日常使用预期。该方案沿用可信 LAN 假设，不承诺公网设备授权协议。

本功能增加 Instance 配对、令牌表及 Workspace 的运行意图、上传授权与非画布调用回执。
画布内容、Mutation 历史和输出依旧由原有权威负责；上传授权不能成为绕过 Private Canvas 的入口。

## 2026-10-22：持久化节点读取与修改闭环

[LAZ-89](https://linear.app/lazyq/issue/LAZ-89) 的 P0 通过同一 Agent API 增加
完整节点详情和原生 MCP 图片预览，并扩展原更新入口。读取投影解析已保存的
Prompt Authoring / Smart Group / Reference Input Instance 状态，与编辑器现有函数
使用相同 fixture 对照；它不编译 Provider 请求，不承担运行时 Loop/Splitter 求值。
因此浏览器关闭时可以读、看图和保存，执行仍保持上述编辑端边界。

节点版本使用目标节点与有效输入依赖的内容指纹，避免其他节点更新造成无谓冲突。
Canvas Sync 在同一操作锁内检查版本、原子保存并读取存储结果；原 Mutation 回执
保留完整结果快照，使断线重试和后续节点编辑并存。没有第二个 Canvas 写入者或
独立编辑日志。直接附带的旧素材经当前 Canvas 授权后才可预览；服务端只读取现有
Managed Media resolver 返回的受控路径，桥接不接收服务器任意路径。

与新增后端生成编译器相比，这个选择保持当前生成责任不变；代价是读取投影必须
随 JS 引用合同同步演进，使用同数据对照测试防止漂移。接口、兼容策略与限制以
[节点修改 Current 合同](../current/agent-task-editing.md)为准。

## 2026-10-23：以持久对象身份交接给 Agent

[LAZ-90](https://linear.app/lazyq/issue/LAZ-90) 的节点引用携带 Workspace、Canvas 和明确的 Node ID。
编辑器通过现有 Canvas Sync 确认保存后，再由同账号只读检查全部目标，才完成复制。Agent 读取
使用当前 Workspace 与既有 Account 授权，整份验证后读取一个持久快照；直接路由不改变 MCP
已锁定的 Canvas。与依赖短期 Editor Context 或复制内容快照相比，这让选区变化和编辑器关闭
不影响定位，代价是失效对象必须明确失败；后续修改仍需独立的权限和版本检查。协议、容量、
错误与交互见[节点引用合同](../current/node-references.md)，不新增授权能力或跨节点编辑事务。

## 2026-10-28：无画布目标的 CLI 图片生成

[LAZ-106](https://linear.app/lazyq/issue/LAZ-106/reroll-cli) 及其[独立规格](../active/2026-10-28-reroll-cli.md)
定义第三阶段的窄入口：`reroll generate` 在完成相同网页配对后，以 Account 身份提交单张图片任务，
不创建 Canvas 或 Node，也不需要打开的编辑端。画布 `run_tasks` 仍使用原有编辑端执行合同。

后台入口与既有平面图片入口共用请求编译合同，模型能力预检、Provider 参数转换和图片输出物化
继续复用原权威。Agent API 只负责精确输入、Account 权限与 Run 归属，不直接调用 Provider；
GenerationRuns 继续拥有幂等、持久化、执行、恢复和发布，不新增任务数据库。

凭证继续按服务地址和客户端身份隔离；每次生成、查询和下载重新校验 Account、Role、scope 和接入设置。
逐条确认开启时拒绝自动运行，不由 CLI 调整偏好。请求身份与输入摘要保存在既有 Run 中，
同输入重试回读冻结设置，不因后续目录变化而生成第二个任务。下载只解析所属 Run 的指定输出，
Bridge 不接受任意远端 URL 或服务器路径。

与 CLI 直接调用 Provider 相比，这保留统一运行与数据边界；与复用编辑端租约相比，这允许
后台自动化且不制造隐形画布。代价是必须维护共享编译接缝和新旧入口对照回归。
本节仅扩展已授权的平面图片执行，不能据此将 Canvas 图求值、视频或 Workflow 搬到另一条运行链。
