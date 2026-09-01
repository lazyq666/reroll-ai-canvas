# ADR-0006：恢复阶段允许用户明确创建新的 Workspace

- 状态：已接受
- 日期：2026-08-28
- 来源：Issue #182
- 局部取代：ADR-0001 中“恢复页不提供新空 Workspace”的决定

## 背景

ADR-0001 为避免磁盘暂时断开时出现误导性的空白内容，规定恢复阶段只能重试原位置、
重新连接被移动的 Workspace，或打开另一个已有 Workspace。这个默认保护仍然正确，但当
原 Workspace 永久不可用、用户又没有第二个已有 Workspace 时，它会让安装无法继续使用。

账号、有效 Session 和全局 Role 已由 Instance State 持有，不再随 Workspace 切换。新
Workspace 也已经具备 manifest-last 的 SQLite 初始化能力，因此可以在不伪造原内容、
不重建账号域的前提下，为用户提供一个明确且非自动的退出路径。

## 决策

- 恢复页增加独立的“创建新的工作区”动作。应用永远不会因为原 Workspace 不可用而自动
  创建空白替代；只有本机用户主动选择、检查并确认后才执行。
- 目标必须是可访问、可写且受支持的空目录。完整已有 Workspace 引导到“打开另一个已有
  工作区”；普通非空目录、不完整目录、不可读目录和含未知文件的创建中间目录一律拒绝。
- 用户确认后，恢复模块先取得目标的唯一写入权，并在 Device State 写入带操作 ID、目标
  路径、原选择和计划 Workspace identity 的创建记录。该记录只用于中断恢复，不属于
  Workspace Data。
- 创建过程不调用首次账号设置，也不修改 Instance State。账号、有效 Session 和全局 Role
  在切换前后保持不变，新 Workspace 内不得建立活动 `auth.db`。
- 新 Workspace 先建立必需目录与稳定 identity，再创建并验证 Canvas 和 Generation Run
  两个 SQLite Store；`storage-authority.json` 是 Workspace 内部存储发布的最后提交点。
- 只有 identity、双库完整性、外键、manifest 和必需目录全部通过真实运行时组合验证后，
  才允许替换 Device State 中的当前 Workspace 选择，然后请求受控重启。
- 初始化或校验失败时，当前 Workspace 选择保持原值，目标中的 manifest-less 中间结果不
  会成为活动 Workspace。与创建记录和 identity 完全匹配、且只包含本操作已知文件的目录
  可以续跑；出现未知文件或身份不一致时停止，不猜测、不合并。
- 启动器拒绝重启时恢复原 Workspace 选择，并恢复同一次创建记录；用户可以继续相同的
  “创建新的工作区”意图。进程在选择提交后意外退出时，新目录已经是完整 SQLite authority，
  下一次启动可以直接使用。
- 应用不自动删除创建失败留下的目录或文件。自动清理无法证明期间没有用户或同步软件写入，
  因而误删风险高于保留可诊断中间状态。

## 考虑过的替代方案

- **继续禁止恢复阶段创建**：会让永久失联且没有其他 Workspace 的安装无产品内出口。
- **复用首次设置接口**：该接口会同时编排账号设置，并较早保存 Workspace 选择，不满足恢复
  阶段的账号连续性和失败回滚要求。
- **选择空目录后立即切换，再由启动过程补齐内容**：中断时可能激活半初始化目录，拒绝。
- **失败时自动删除目标**：无法安全区分应用文件与确认后由用户或同步软件加入的文件，拒绝。
- **把完整已有 Workspace 重置为空 Workspace**：会覆盖或混淆已有内容，拒绝；必须走打开流程。

## 后果

- “不自动创建空白替代 Workspace”继续成立；被取代的只是“即使用户明确确认也不能创建”这
  一限制。
- Device State 新增一份短期创建恢复记录；Workspace 仍只保存内容身份、正式存储和恢复报告。
- 恢复创建与首次 Setup 共享 SQLite bootstrap，但使用不同的选择提交编排，避免出现两套存储格式。
- 恢复页需要呈现四种意图，并在确认时明确说明：成功会替换本机当前连接，旧目录及内容不会
  被修改或删除。

## 参考

- [ADR-0001](0001-workspace-data-boundary.md)
- [存储路径与旧数据迁移](../current/storage-layout-and-migration.md)
- Issue #18
- Issue #74
- Issue #179
- Issue #182
