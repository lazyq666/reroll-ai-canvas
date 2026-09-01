# ADR-0004：工作区资产库使用发布目录，而不是复制媒体

- 状态：已接受
- 日期：2026-08-24
- 来源：Issue #128

## 背景

团队需要在不同 Project 和 Smart Canvas 之间发现并复用一组精选图片。Managed Media 已经拥有 Workspace 相对 URL、内容摘要和搬迁语义；如果资产库再复制一份文件，会产生重复字节、删除含义不清、来源路径泄露和两套生命周期。

同时，资产库的“取消共享”是撤销发现能力，不应破坏 Canvas、Reference Input Instance 或 Generation Run 已经保存的引用。Project Access Grant 只授权来源 Canvas 的读取，不应通过资产库列表反向暴露 Project、Canvas 或 Node 身份。

## 决策

Workspace Asset Library 是 Workspace Data 中的发布目录。每个 Asset Library Entry 引用一个既有 Managed Media，并保存用户可见名称、可选共享文件夹标识、首位 Publisher、发布时间和可选的来源快照；它不复制或删除媒体字节。文件夹也是目录内的 Workspace Data 元数据；删除文件夹只清空条目的分类标识，不删除条目或媒体。外部批量导入先把经过图片内容验证的文件纳入 Managed Media，再创建没有 Canvas 来源快照的条目。

发布使用媒体内容 SHA-256 作为幂等键。同一内容在一个 Workspace 中最多有一个素材条目，首次成功发布者拥有管理权；后续成员发布同一内容只得到已存在结果，不转移管理权。Administrator 始终可以管理。

从 Canvas 添加时，服务端必须重新读取来源 Smart Canvas、执行现有 Project / Canvas 权限校验，并确认目标仍是可读图片；从外部文件导入时，服务端必须要求 Workspace 编辑权限、限制批次数量与单文件大小，并验证每个文件确为可读取图片。列表只返回条目标识、媒体标识、Workspace URL、名称、文件夹标识、Publisher、时间和当前用户是否可管理；来源 Project、Canvas、Node 永不进入公共响应。

取消共享只移除 Asset Library Entry。Managed Media 的清理仍由媒体生命周期负责；本决定不引入引用计数或垃圾回收。

目录最多 5,000 条，发布批次执行全有或全无容量判断。目录以原子替换写入，并在产品支持的单进程、单 Worker 服务中用进程锁串行化；本 ADR 不宣称多 Worker 或跨服务器写入安全。

## 影响

- Workspace 搬家、复制和备份会连同发布目录与媒体一起移动。
- 一张图片取消共享后，已经插入的引用和历史 Generation Run 继续工作。
- 素材名称是发布时快照，可独立改名，不反向修改来源 Node 或文件名。
- 资产库不能成为绕过 Project Access Grant 的来源信息查询接口。
- 若未来需要自动清理无引用 Managed Media，必须另立生命周期决定，不能把“取消共享”等同于“删除文件”。
- 未来支持多 Worker 或多个服务写同一 Workspace 前，必须把串行化升级为跨进程事务或独立存储权威。

## 不采用的方案

- **复制媒体到专用资产目录**：增加存储、同步和删除冲突，没有带来新的稳定身份。
- **把全部 Managed Media 自动列为资产库**：失去成员精选与显式发布语义，也会暴露临时或历史文件。
- **按 URL 去重**：同一内容可能有兼容 URL 或搬迁后的表示差异，不能稳定表达媒体身份。
- **取消共享时删除媒体**：会破坏 Canvas 和运行快照，且目录不知道全部引用者。
- **公开来源 Project / Canvas / Node**：会让工作区级发现接口泄露用户未获授权的内容结构。
