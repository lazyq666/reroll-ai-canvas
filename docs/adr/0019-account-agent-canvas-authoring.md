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
固定网格布局与提交；提交用 `exact` 位置意图，不重排既有节点。Submission 身份和请求摘要随
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
