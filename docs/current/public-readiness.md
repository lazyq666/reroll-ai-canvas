# Public readiness：发布验收

> Status: Current  
> Last verified: 2026-09-07；适用版本：2026.09.07.20 起  
> Owners: 仓库维护者 / 测试与发布  
> Feature: F14（发布维护中的验收与合入部分）  
> Tracked by: [Issue #59](https://github.com/lazyq666/reroll-ai-canvas/issues/59)

## 适用范围

本合同管理 `lazyq666/reroll-ai-canvas` 的发布候选与 main 合入。其他仓库的通知、归档和历史治理单独处理。本机制不替代功能规格要求的真实 Provider、迁移、多人、性能和人工体验验收。

## 开发、提交与发布

开发仍默认使用当前本地目录和分支。先完成实现、测试、双语和资源生成，再审查并提交完整候选；共享工作区只提交自己的改动。提交前运行 `scripts/readiness_version.py --prepare YYYY.MM.DD.N`，采用当前上海日期及高于已发布版本的序号。它同步 VERSION、更新说明及现有分享页缓存合同；快照入口不自动修复文件。

只验收、暂不推送时：

```bash
python3.12 scripts/public_readiness.py snapshot HEAD --base origin/main --output /tmp/readiness.json
```

准备发布 PR 候选时，直接使用包含完整验收的发布入口：

```bash
python3.12 scripts/readiness_publish.py HEAD --branch codex/my-change --report /tmp/readiness.json
```

快照立即固定提交编号（commit SHA），逐组创建独立源码、索引、完整历史、锁定依赖与测试状态目录。暂存、未暂存和未跟踪的修复都不进入候选。浅历史、缺失对象、gitlink、越界符号链接和检查写回源码均失败。报告放在开发目录外，记录 candidate/tree/base/head 身份、环境、命令、耗时、测试及跳过数量、公开安全的失败测试名称和仓库内文件行号；原始输出不上传。

发布入口重新验收并检查远端 main 与目标分支版本；目标引用通过 lease 防止竞争覆盖。main 在最后一次网络推送期间前进时，候选分支可能已存在，但发布结果仍是不完整；更新版本、形成新提交并重验。任何提交内容变化都使旧验收结果失效。

检查失败时，控制台同步输出 `READINESS_FAILURE` 结构化摘要：退出码、耗时、内部失败原因（如有），以及已脱敏的测试计数、失败测试名称和仓库内文件行号。即使报告附件不可用，仍可从 job 日志定位失败；没有测试计数时保留退出码，不推断具体失败用例。原始命令输出、异常正文和绝对路径不进入该摘要。

## Linux 合入门槛

五个独立组由 [共享清单](../../scripts/readiness/manifest.json) 定义：公开及依赖审计、确定性 Python、Node 合同、核心 Chromium 浏览器、仓库资源与版本合同。前一组失败不遮挡其他组；缺少依赖的检查明确受阻。Python 默认套件跳过的浏览器合同由独立必需组实际执行，受控性能验收保留为功能规格的额外 Gate。

功能回归使用可控计时输入验证延迟超限的成功／失败路径；真实网络、超时和性能工具保留真实时钟。共享 CI 机器的偶发耗时不能代替受控环境中的性能验收。画布列表万级语料的路由、分页和解析次数始终在确定性组验证；首批小于 2 秒、后续页小于 3 秒的真实耗时门槛由 `tests.test_issue_71_canvas_list_index.CanvasListIndexContractTests.test_acceptance_corpus_grouped_project_latency` 单独验收，遵循现有 `IC_SKIP_PERFORMANCE_TESTS` 开关。后续页门槛覆盖单次后端 `list_records()` 调用，包括目录扫描、文件状态与项目归属检查、索引读取及结果过滤排序，不包含测试数据准备、此前查询、网络传输或页面渲染；3 秒上限为万级文件场景保留磁盘与调度余量，不代表交互耗时目标。

macOS 本地 Chromium 合同使用模拟钥匙串，避免隔离用户目录时等待系统凭据初始化；浏览器配置仍是临时的，不读取用户登录钥匙串。这与 Playwright 的自动化启动配置一致，页面和交互断言保持完整执行。

PR 检查使用 GitHub 试合并提交，并记录 head/base/checkout/tree；main push 验证最终提交并与旧 main 版本比较。Python 3.12、Node 24、锁定 Chromium 是 Linux 执行环境。`Public readiness gate` 只接受当前运行尝试、当前候选和完整五组的 success；失败、取消、跳过、缺组、空测试或过期证据不能通过。重新运行时选择全部 jobs，单独重跑失败组不会复用旧尝试的报告。报告保留 14 天。

main 的 active Ruleset 要求 PR、最新 main 基线，以及 GitHub Actions（App 15368）的唯一 `Public readiness gate`；禁止删除和强推，bypass 为空，人工必需批准数为 0。维护者可以独立合并绿色且最新的 PR。本地 hook 不承担远端权限约束。

## 依赖升级

Python 直接依赖统一声明在 `requirements.lock.in`，与 `requirements.lock.txt` 按同名主干配对；`requirements.txt` 仅转发到声明文件，保留原安装入口。

该配对让 Dependabot 的 pip 更新器使用 pip-tools 重新求解整套版本，直接和传递依赖均允许更新。即使生成头部改变，也必须保留文件名配对，不能把锁文件恢复成逐项升级的普通声明。Pydantic 与 pydantic-core 成组更新；维护者使用固定 uv 0.10.0 从 `requirements.lock.in` 重解并验证机器人生成的锁文件。

每次直接或传递依赖更新都要通过声明/锁一致性、哈希校验安装、安装后的依赖检查、关键导入与完整 Gate。`npm ci` 使用前端锁文件。分组不能代替兼容验证；兼容错误和漏洞审计是不同结果。常规 Dependabot 更新使用默认标签，不自动标为安全问题。

## 规则核查与失败恢复

```bash
python3.12 scripts/readiness_rules.py
```

[版本化规则声明](../../.github/rulesets/main-readiness.json)与 GitHub 实际规则是不同的权威；以上入口只读回读保存配置和 main 生效规则。启用后、规则修改后及发布完成前必须核查。规则关闭、名称或 App 改变、strict 关闭、bypass 增加等漂移均阻断完成声明。配置读取失败也不是通过。

先让新 workflow 产生可验证的正确结果，再启用新增必需项。故意失败、取消、缺失检查、配置漂移和拒绝推送实验在独立验收仓库进行。main 合并后失败时保持 Issue 开放，修复或回退继续走 PR；只有最终 main 检查和规则回读都通过，才能关闭 Issue。平台故障保持待恢复状态。紧急改规则需维护者明确决定、记录原配置和恢复办法，不能设置常驻 bypass。

## 验证入口

- [交付行为回归](../../tests/test_readiness_delivery.py)：真实 Git、副本污染、源码写回、进程终止、空证据、版本与推送竞争、规则漂移。
- [公开审计回归](../../tests/test_public_readiness_audit.py)、[文档地图](../../tests/test_documentation_knowledge_map.py)、现有产品测试与 [workflow](../../.github/workflows/public-readiness.yml)。
- 真实远端运行、拒绝和合并后的记录留在 Issue #59 及其关联 PR；它们不由本地单测代替。
- [ADR-0013](../adr/0013-public-readiness-gates.md)记录固定提交、独立检查和空 bypass 的长期取舍。

生产启用已由 [PR #61](https://github.com/lazyq666/reroll-ai-canvas/pull/61) 与 [最终 main 检查](https://github.com/lazyq666/reroll-ai-canvas/actions/runs/34111965273) 验证：五组与总门槛全部成功，active 规则回读无漂移。分阶段故障实验与恢复理由见[归档规格](../archive/2026-09-07-public-readiness-delivery-gates-spec.md)。
