# Public readiness：提交快照验收与 main 合入门槛

- **Status**：In Progress（用户已要求进入开发；远端启用须通过分阶段验收）
- **Feature ID**：F14
- **Tracking Issue**：[Issue #59](https://github.com/lazyq666/reroll-ai-canvas/issues/59)（实施 In Progress）
- **Owners**：仓库维护者 / 开发 / 测试与发布
- **Last verified**：2026-09-07（故障对照实验与 GitHub 配置只读核查；目标行为未验收）
- **Applies to**：`lazyq666/reroll-ai-canvas` 的 Public readiness 与 main 发布流程
- **Supersedes / Superseded by**：无
- **Related ADRs**：[ADR-0013](../adr/0013-public-readiness-gates.md)（Proposed）
- **Domain terms**：不新增产品领域概念；Workspace、Instance State、Device State 的现有边界不变

## 1. 一页摘要

每次准备发布时，验收对象必须是完整、固定的 Git 提交；本机尚未提交的修复不能帮助这份提交通过测试。main 接收变化前，GitHub 必须完成 Linux 检查；历史审计、后端、前端、浏览器和资源合同各自报告结果，任何必需项未成功都不能放行。

维护者仍可独立开发、创建 PR（合入申请）并在检查通过后自行合并。首期不要求第二个人批准，也不引入合并队列。本规格先定义规则和验收；后续实施必须完成真实 GitHub 验证，才能称为长期机制已落地。

## 2. Problem Statement

2026-09-07 的 [失败运行](https://github.com/lazyq666/reroll-ai-canvas/actions/runs/34092898740) 在 2,073 项 Python 测试中只有模型名称保留测试失败。提交 `8a79c55` 包含回归测试，却没有包含 `backend/main.py` 中的配套保存逻辑。该修复仍存在于本地未提交改动。干净提交副本连续两次复现相同断言；只补入遗漏的保存函数后，相关 8 项测试通过。

只读核查还确认：main 没有传统分支保护，规则集为空；现有工作流全部检查串行放在 `verify` 中。[9 月 4 日](https://github.com/lazyq666/reroll-ai-canvas/actions/runs/33880621097)与[9 月 6 日](https://github.com/lazyq666/reroll-ai-canvas/actions/runs/34020356229)的历史审计失败均导致后续浏览器和 Python 测试跳过。[Issue #51](https://github.com/lazyq666/reroll-ai-canvas/issues/51)记录了历史审计修复后才暴露的 Linux 参数长度故障。

因此，“本地通过”没有稳定对应到发布内容，“检查失败”不能阻止 main 更新，而前置失败会延迟暴露其他问题。

## 3. Goals / Non-goals

### Goals

- G1：同一提交在有未提交修复和没有未提交修复的开发目录中，得到相同的快照验收结果。
- G2：main 的常规更新必须关联 PR，且待合入内容通过必需的 Linux 检查。
- G3：独立检查互不遮挡；总门槛只有在固定清单全部明确成功时成功。
- G4：缺依赖、取消、跳过、过期结果、资源版本漂移和配置漂移都有明确的阻断与恢复路径。
- G5：规则可以由维护者检查、复现、迁移和恢复，不依赖某一次聊天记忆。

### Non-goals

- 本 Spec 不实施此次模型改名修复，也不打包当前工作目录中的其他改动。
- 不降低历史隐私审计、依赖审计或现有产品测试要求，不用重跑、删测试或放宽断言代替修复。
- 不承诺 CI 能发现所有产品缺陷；真实 Provider、迁移、性能、多人和人工体验 Gate 仍由对应功能规格定义。
- 不新增产品页面、接口或后台任务，不改变 Workspace / Instance / Device 数据。
- 首期不建设多操作系统全量矩阵、自动合并队列、强制双人评审或自动重写 Git 历史。

## 4. Actors and permissions

| Actor | 可以 | 边界 |
| --- | --- | --- |
| 开发者 / 开发代理 | 在现有本地目录开发；提交候选；执行快照验收；创建 PR | 未提交文件不是发布候选；不得替他人批量提交混合改动 |
| 仓库维护者 | 自行合并已满足 Gate 的 PR；实施和恢复远端规则 | 日常操作无常驻 bypass；不能把跳过检查描述为已验收 |
| GitHub Actions | 读取候选源码，安装锁定依赖，执行检查和输出结果 | 测试工作流默认 `contents: read`，不持有修改仓库规则的权限 |
| 外部 PR 作者 | 提交代码并查看检查 | 不向不受信任的代码暴露仓库管理凭据或运行环境秘密 |

产品中的 Administrator / Designer 权限不适用于仓库管理。

## 5. User stories

1. 我在本地修好了问题但漏提交实现，发布验收应明确失败并指出被测提交，而不是被本地文件掩盖。
2. 我一次改动触发历史审计和后端错误，应能在同一轮看到两者。
3. 我独立维护项目，不需要等待另一位评审人，但仍需通过机器检查才能更新 main。
4. 我修改了候选代码或 main 已前进，旧的绿色结果不能代替新组合的验收。
5. 网络、权限或 GitHub 故障应显示未完成；恢复后可以重跑同一提交。

## 6. User journey and interaction contract

### 正常路径

1. 在当前本地目录和分支开发，按仓库规则完成资源版本生成、双语和相邻功能验收。
2. 审查暂存内容，将实现、测试与必要文档形成完整提交。共享目录有其他改动时，只纳入本次内容。
3. 对明确的提交编号运行快照验收；输出提交编号、源码树编号、环境和每项结果。
4. 推送候选到用于 PR 的远端引用，创建指向 main 的 PR；GitHub 检查候选与当前 main 的组合。
5. 所有必需任务成功、分支满足最新 main 要求且远端规则有效时，允许维护者合并。
6. main 的合并后运行再次核验最终提交；完成前不标记发布验证完成或关闭实施 Issue。

本地开发目录、分支的默认规则不因本 Spec 自动改变。PR 需要独立的远端候选引用；实施时提供从当前提交发布候选的流程，不要求另建本地 worktree。冲突或多个任务共用文件时先形成可审查的完整提交，再验收。

### 可见状态

| 状态 | 含义 | 后续动作 |
| --- | --- | --- |
| 未验收 | 没有当前候选的结果 | 执行验收 |
| 进行中 | 存在尚未结束的必需检查 | 等待；可以取消，但不能合入 |
| 失败 | 任意必需项失败或缺失 | 修复并产生新提交；基础设施故障可重跑原提交 |
| 已取消 / 已跳过 | 没有完整证据 | 重新执行完整必需检查 |
| 已过期 | 候选、合入基线或规则版本已改变 | 重新验收对应内容 |
| 可合入 | 当前组合的全部必需项成功且规则有效 | 合并 PR |
| 合并后异常 | main 最终提交检查失败 | 暂停该版本发布，修复或通过 PR 回退 |

使用终端、GitHub PR 检查页及 Actions summary，不建设产品 UI。技术标识与测试输出沿用工程文案；不向产品界面新增需 i18n 的字符串。

## 7. Functional rules

### A. 提交快照验收

**A1 固定身份。** 入口接受一个可解析为 commit 的引用，立即解析为完整 SHA。记录源码 tree SHA；开始后分支移动不改变本轮对象。未提交内容、暂存但未提交内容和未跟踪文件不进入候选。发现这些内容时报告“存在未纳入的本地改动”，不清理、不 stash、不自动提交。

**A2 隔离执行。** 在临时目录物化该提交的完整源码与其可达 Git 历史，使用独立的索引和工作目录。历史审计必须针对候选祖先；不能只 `git archive` 源码后跳过历史审计。缺失历史或未支持的 gitlink 必须报错。

**A3 隔离运行环境。** 测试依赖按候选锁文件安装；不读取原开发目录的源码、`node_modules`、`.venv`、用户配置或 Workspace。使用测试专属状态目录，清除会改变导入位置和产品状态的环境变量；环境继承采用明确允许范围。可复用下载缓存，但不能借用未验证的已安装依赖。记录 Python、Node、OS 和浏览器版本。

**A4 共同清单。** 本地和 CI 通过同一版本化的验收入口定义运行组及命令，避免两份清单长期分叉。Python 3.12、Node 24 和锁定 Chromium 是远端必需环境。Mac 本地成功只证明本地快照验收成功；Linux 的远端结果仍为合入必需证据。

**A5 不自动修复候选。** 验收只能检查，资源生成发生在提交前。任一检查修改受跟踪文件、删除受跟踪文件或产生不允许的源码文件都应失败。构建缓存与测试临时输出必须限制在明确目录，不掩盖源码写入。结束时删除临时副本，只保留脱敏摘要。

**A6 内容变化使结果失效。** 添加遗漏文件、更新 VERSION、重生成资源或修改工作流后产生新提交，必须重新验收。报告不得用未提交目录的结果背书已提交候选。

**A7 版本规则保持有效。** 遵守现有“每次向项目远端 push 前更新 VERSION”的规则，同时同步 `static/update-notes.json`，使用 Asia/Shanghai 日期和递增序号。发布辅助入口读取远端 main 及目标引用的版本，候选必须更高；远端发生竞争更新时阻断并重新生成提交。PR 检查候选版本高于其 main 基线；main 的 push 检查与事件的旧 main 比较，不能与自身比较。基线无法获取时不能跳过。CI 验证配对和递增关系，但不声称能观察未经过受控入口的每一次任意分支 push。

### D. 依赖升级治理与仓库边界

**D1 兼容组合。** [PR #1](https://github.com/lazyq666/reroll-ai-canvas/pull/1) 单独升级 pydantic-core 导致与 pydantic 不兼容。这属于依赖兼容错误，不是漏洞结论。Dependabot 将 pydantic 与 pydantic-core 分组；每次更新直接依赖或传递依赖均以固定 uv 版本重解锁文件，检查声明与锁文件一致、干净安装后的依赖关系及关键模块导入，再执行全部必需组。分组本身不能保证兼容，检查失败须修复组合，不能跳过测试。

**D2 标签。** 常规版本更新不标为 security。配置仅使用已存在的标签；首期删除不存在的 dependencies/security 标签配置，使用 GitHub 默认行为，避免自动化元数据故障。

**D3 范围。** 本机制只管理上方 Applies to 的公开仓库。其他旧私有仓库的生命周期与通知另行处理；本任务不归档、改写历史或更改其设置，也不把其日志或身份信息放入公开文档。失败的 PR 检查是有用的阻断证据，目标不是零失败通知。

### B. main 合入门槛

**B1 远端执行。** 目标为精确的 `refs/heads/main`，使用 Active 的分支 Ruleset：要求关联 PR、必需状态检查、分支与 main 保持最新，禁止删除与强制推送；bypass 列表为空，维护者的日常操作也受规则限制。不启用会让正常 PR 也无法更新 main 的 blanket restrict-updates。

**B2 单人维护。** 必需批准人数设为 0，维护者可自己创建和合并 PR；不强制 CODEOWNERS 评审。不把“必须由第二人批准”作为本项目的日常前提。

**B3 必需结果。** Ruleset 绑定 §7C 的 `Public readiness gate` 检查，并绑定实际产生该检查的 GitHub Actions App。名称必须唯一、稳定，不能只要求旧 `verify` 或允许任意来源的同名状态。新增必需项必须同时更新运行清单、总门槛和回归场景。

**B4 精确的测试对象。** PR 运行保留 GitHub 的试合并提交语义，记录 PR head SHA、base SHA、实际 checkout SHA 和 tree SHA；不无条件改成只测试 PR 分支头。main 更新后，过时分支必须更新并重验；若 GitHub 需要新的试合并结果，旧结果不得人工代替。main 的 push 运行记录最终 SHA。合并生成的新 SHA 不必等于 PR SHA；不得据此声称它在合并前已被逐字节执行过，最终验证由合并后运行承担。

**B5 配置可核查。** 将预期 Ruleset 作为版本化声明保存，提供只读对照入口核查目标分支、启用状态、必需检查、来源、strict 设置与 bypass。启用后、每次修改规则后及发布验收时回读实际生效配置；偏差阻断发布完成声明。CI 的只读测试 Token 不承担管理规则的职责。

### C. 独立检查与总门槛

| 固定 job ID | 职责 | 主要检查 |
| --- | --- | --- |
| `public-audit` | 公开源码、历史与依赖合规 | 当前树审计、完整候选历史审计、现有锁定 Python 依赖审计 |
| `python-tests` | 后端和 Python 回归 | 编译；完整确定性 Python suite；`IC_SKIP_PERFORMANCE_TESTS=1` |
| `node-tests` | 前端状态与合同 | `npm ci` 与全部 Node contract tests |
| `browser-core` | 核心真实浏览器合同 | 锁定 Chromium、现有 Python core browser contract、显式启用浏览器测试 |
| `repository-contracts` | 文档、资源与发布一致性 | vendor、知识地图、i18n 验证与缓存版本、UI 资源版本 `--check`、VERSION 配对及基线比较 |
| `readiness-gate` | 汇总是否允许合入 | 检查以上五项的完整结果清单；显示名固定为 `Public readiness gate` |

**C1 互不依赖。** 前五项只依赖各自环境准备，不相互设置 `needs`；某项失败不取消其他项。共享命令或下载缓存可以复用，但不能以一个前置审计成功作为全部测试的启动条件。同组内可独立执行的检查也应收集全部结果后统一返回失败；只有真实依赖缺失时才明确报告受阻检查。

**C2 总门槛拒绝不完整证据。** 汇总任务使用 `needs` 加始终执行的条件，逐一要求固定五项的结果严格等于 `success`，并核对证据对应本轮候选。`failure`、`cancelled`、`skipped`、缺项均失败；不能用“没有 failure 就成功”。整个 workflow 被取消或根本未运行时，总结果不能提供可合入的成功证据。

**C3 不静默跳过。** PR、main push 和手动运行保持可用；必需 workflow 不加文件路径过滤。首期不启用 merge queue；未来启用前必须支持 `merge_group` 并验证。浏览器缺可执行文件、依赖安装失败或必需测试整组被 skip 都应失败；原有有依据的单项性能/真实环境 skips 保留并报告理由与数量，不固定总测试数来掩盖新增或缺失测试。

**C4 报告和权限。** 每组输出提交身份、环境、命令、结果、测试/跳过数量和耗时。失败时仍尽力保存脱敏 summary / 日志，保留 14 天；上传失败不得把测试失败变绿。缓存命中只影响下载速度，不代替执行测试。不得用 `pull_request_target` 执行不受信任的 PR 代码。

## 8. Domain and state model

这是工程交付流程，不向 `CONTEXT.md` 加入产品领域术语。候选提交 SHA 是本地验收身份；PR 的 head/base/checkout SHA 共同说明远端被测组合；tree SHA 用于核对源码内容，不能替代包含历史信息的 commit SHA。

流程为：未验收 → 验收中 → 失败或可合入 → 已合并待验证 → 已验证。任何候选或基线变化都回到相应的未验收状态。并发 push 只取消同一个 PR/ref 的旧运行，不取消其他 PR 或其他当前检查组。

## 9. Data and persistence

| 数据 | 权威 | 保留 / 恢复 |
| --- | --- | --- |
| 候选源码与历史 | Git commit 及其祖先 | 临时副本可删除，按 SHA 重新物化 |
| 验收清单与预期规则 | 仓库中的版本化文件 | 随代码评审；按提交追溯 |
| 实际合入限制 | GitHub 生效 Ruleset | API 回读；与声明比较，不能仅凭本地文件宣称启用 |
| 检查结果 | GitHub Check Run + 脱敏报告 | 报告 14 天；长期结论、链接和必要证据留在 Issue / PR |

这些数据不属于用户 Workspace；测试不使用真实创作内容或账号状态。

## 10. API / WebSocket / Provider contracts

不改变 Reroll 的任何 API、WebSocket 或 Provider 合同。工程工具提供三个意图清晰的入口：验收一个 commit、检查当前远端规则、发布已验收候选到 PR 引用。具体脚本名由实施确定，但退出语义必须稳定：0 表示该入口完整成功，非 0 表示失败或未完成，并附明确原因。

快照报告最少包含 schema version、candidate SHA、tree SHA、可用时的 base/head SHA、环境、各组结果及最终结果。Ruleset 写入是单独的维护动作；只读检查不能自动创建、修改或关闭规则。

## 11. Security and privacy

完整历史隐私审计保持不变；修最新文件无法消除祖先提交中的隐私记录。历史修复仍属于单独审查和授权的操作。报告不记录真实用户绝对路径、环境变量值、认证头或凭据。

Ruleset 防止日常误操作，不声称防御拥有仓库管理权限的人主动删除规则。修改 workflow、验收清单和规则声明时必须在 PR 中明确标注门槛变化，使用行为验收验证；单人维护模式不具备独立双人安全审查。

## 12. Performance and reliability constraints

每个执行组设 30 分钟上限，汇总设 5 分钟上限。首期不增加受硬件负载影响的毫秒级性能门槛。网络安装失败与测试断言失败分类报告；不自动反复重跑直至绿色。手动重跑同一提交允许，但保留原始失败记录。

任务独立会增加安装次数和 Actions 用量，使用锁文件缓存缓解；不能为节约用量重新让审计失败遮挡功能测试。

## 13. Design system contract

无产品 UI 变更，`ic-*`、Token、Focus、Light/Dark、移动端和产品语言切换验收不适用。已有 UI / i18n 检查仍保留在交付门槛中。

## 14. Implementation decisions

选择“本地固定提交快照 + 远端 Linux PR Gate + main 后验”，不以本地 hook 作为唯一保障：hook 可以未安装或被绕过，也不能代表 Linux。首期通过受控发布入口降低漏验风险，远端 Ruleset 承担最终合入约束。

选择五个独立执行组加一个严格汇总结果，使必需检查名称保持稳定；不让简单 job skip 的平台语义决定发布成功。选择空 bypass、0 人批准和 strict main 基线，兼顾独立维护与机器验收；代价是 main 前进时需要更新候选并重跑。

实施前以 Proposed ADR 记录这些长期取舍。发布治理 Current 只在真实验收后建立；本 Draft 不覆盖现有开发指令。实施时同步调整与 PR 发布路径有关的 AGENTS / CONTRIBUTING 规则，并保持“默认在当前本地目录开发”的约束。

## 15. Acceptance and testing

### Highest test seam

本地使用临时 Git 仓库和真实子进程验收；远端使用实际 Actions 和规则 API。只检查 YAML 是否含某个字符串不构成充分证据。

| ID | 场景 | 必须观察到的结果 |
| --- | --- | --- |
| A01 | 提交只有回归测试，本地留有未提交修复 | 快照测试失败；补交修复后成功；开发目录未被改写 |
| A02 | 存在 staged、unstaged、untracked 修复 | 三者均不能进入已提交候选，结果与干净副本一致 |
| A03 | 指定旧 SHA，运行期间本地分支移动 | 始终执行原 SHA；报告身份一致 |
| A04 | 候选缺源码文件，本机其他目录恰好有该文件 | 验收失败，不能通过本机导入或依赖泄漏补齐 |
| A05 | 祖先有隐私记录，最新树已删除 | 历史审计仍失败；历史不足时明确失败 |
| A06 | 资源生成遗漏，或测试写回源码 | 检查失败且不自动修好候选；补交后重新执行 |
| A07 | 同时制造审计和 Python 失败 | 同一轮显示两个失败；Node 和浏览器仍运行 |
| A08 | 分别注入 failure、cancelled、skipped、缺失组 | 汇总均不能成功；五组成功才成功 |
| A09 | 整个 workflow 取消、跳过或等待首次贡献者批准 | PR 不能依赖不完整结果合入 |
| A10 | 缺 Chromium、运行组依赖缺失、整组未执行 | 明确失败，不能被 unittest skip 或空结果掩盖 |
| A11 | PR 新增提交，或 main 前进 | 旧结果不能满足新候选/最新基线 Gate |
| A12 | 规则启用，普通维护者尝试提交未经 PR/检查的更新 | GitHub 拒绝；失败 PR 不能合并，绿色且最新 PR 可以合并 |
| A13 | 删除或篡改本地 hook 后重复 A12 | 远端仍阻断，证明约束不依赖 hook |
| A14 | 只改文档；只改 workflow | 必需检查仍产生；名称唯一且来源为预期 App |
| A15 | VERSION 配对错误、不递增或并发 main 版本前进 | 对应检查失败，更新版本形成新提交并重验 |
| A16 | 修改必需名称、strict、bypass 或关闭规则 | 只读规则对照报告漂移；不得宣称发布验证完成 |
| A17 | Mac 快照成功、Linux 存在真实平台差异 | Linux PR Gate 阻断；修复后两侧均通过 |
| A18 | 合并最终提交的 push 检查失败 | Issue 不关闭、发布不标记完成；修复/回退仍走 PR |
| A19 | 没有任何产品文件变化，仅执行快照验收 | 原目录的受跟踪改动、暂存内容和未跟踪内容均保持原样 |
| A20 | 单独升级不兼容的传递依赖；声明与锁不一致 | 依赖一致性或运行导入检查失败；兼容组合重解锁并重验后成功 |
| A21 | 常规 Dependabot 更新；来自范围外仓库的通知 | 不引用不存在标签、不将兼容失败当漏洞；不改动范围外仓库 |

故意失败、取消、配置漂移与拒绝推送实验先在隔离的验收仓库执行，不向公开 main 写入坏代码或真实隐私记录。模拟仓库应复制实际 workflow、预期 Ruleset 和执行者权限；生产侧仍必须回读规则并完成一个真实绿色 PR 及 main 后验，不能仅凭模拟实验毕业。拒绝推送测试先在隔离仓库进行，因为规则配置错误时尝试可能成功。

### 人工验收与回归邻居

维护者从 PR 页面可识别每组失败、当前被测提交与是否允许合入；能按文档独立完成一次候选验收、失败修复和重验。回归覆盖现有 public audit、documentation knowledge map、i18n、资源版本、更新源、Node contracts、core browser、Linux 参数边界。

**本轮验证记录**：只有 Spec 文档及链接检查；A01–A19 为后续实施的验收清单，尚未执行。上一轮故障对照实验不等于新验收工具或远端规则已实现。

## 16. Rollout, migration and rollback

1. **补齐当前基线**：只合入与失败有关的完整修复，核实已提交源码通过。不要把其他未完成任务一起发布。
2. **实现可测试入口**：落地快照隔离、共享运行清单、报告与回归；维护者审查 Proposed ADR 和规则声明。
3. **先验证新 workflow**：在 PR/验收仓库完成故障注入；正式仓库出现正确来源、正确名字且成功的 `Public readiness gate`。保留旧检查约束直到替代已验证；本次若仍无保护，记录这段启动窗口。
4. **再启用远端规则**：保存原配置与目标 diff，绑定实际 Check 名称/App；启用后立即回读。若名称或权限不符合预期，停止切换，不把本地声明当成远端生效。
5. **正式验收并毕业**：完成真实绿色 PR 与 main 最终提交检查、规则回读和维护者演练。将稳定流程提炼到 `docs/current/`，同步 CONTRIBUTING、tests/README、AGENTS 的相关条款、PROJECT-MAP 与 docs/README；Issue 由 Review 到 Done。

回退优先通过 PR 修复工作流或恢复上一版可用实现，不删除测试或永久关闭保护。平台故障只形成待恢复状态。确需紧急更改规则时，由维护者显式决定，记录原配置、原因、操作人和恢复步骤；恢复后必须回读并重验。此异常路径不预设常驻 bypass，也不授权自动改写历史。

用户于 2026-09-07 要求进入实施；按上述阶段推进，负向远端实验使用独立验收仓库。

## 17. Traceability

| Kind | Reference |
| --- | --- |
| Product map | [F14](../PROJECT-MAP.md#功能规格注册表) |
| Tracked work | [Issue #59](https://github.com/lazyq666/reroll-ai-canvas/issues/59) |
| 现有 workflow | [Public readiness](../../.github/workflows/public-readiness.yml) |
| 现有开发/验收入口 | [CONTRIBUTING](../../CONTRIBUTING.md)、[tests/README](../../tests/README.md) |
| 现有审计与地图测试 | [public audit](../../tests/test_public_readiness_audit.py)、[knowledge map](../../tests/test_documentation_knowledge_map.py) |
| 本次直接失败回归 | [模型名称保存](../../tests/test_available_model_management.py) |
| 文档毕业规则 | [change-documentation](../agents/change-documentation.md) |
| 历史问题 | [失败运行](https://github.com/lazyq666/reroll-ai-canvas/actions/runs/34092898740)、[Issue #51](https://github.com/lazyq666/reroll-ai-canvas/issues/51) |

平台行为依据（2026-09-07 核对）：[Ruleset 可用规则](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)、[必需检查的跳过与提交身份语义](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)、[PR 事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)。本 Spec 的严格汇总规则是项目自身承诺，不依赖 GitHub 把所有 skipped 检查视为失败。

## 18. Open questions

没有阻止本 Draft 评审的产品选择。实施需确认当前 GitHub 管理权限、实际 Check 来源 App 和可用的隔离验收仓库；这些是启用前置条件，未满足时保留明确的未完成 Gate，不降低验收要求。

## 19. Change log

| Date | Status | Change | Evidence/decision |
| --- | --- | --- | --- |
| 2026-09-07 | Draft | 定义快照验收、main 合入限制、独立任务和 A01–A19 验收 | 故障提交对照、历史日志、远端配置核查；尚未实施 |
