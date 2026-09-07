# ADR-0013: 固定提交与远端 Public readiness 门槛

- Status: Accepted
- Date: 2026-09-07

## Context

本地未提交修复曾掩盖发布提交缺陷；串行审计失败又遮挡后续测试。单人维护需要可重复的机器验收和可核查的 main 合入约束。

## Decision

本地验收固定 commit 的独立源码、完整历史和干净依赖。五组共享检查清单分别运行，严格汇总只接受本轮五项 success。Linux PR 试合并检查和 main 合并后检查分别保留身份。

main 使用空 bypass 的 active Ruleset，要求 PR、最新基线和绑定 GitHub Actions 来源的 Public readiness gate，禁止删除与强推，人工批准数为零。先验证检查，再启用规则；只读对照不能修改远端配置。依赖兼容组合重解锁并验证安装，不将兼容故障误标为漏洞。本决策仅适用于公开仓库。

## Alternatives considered

- 本地 hook：可绕过、无法代表 Linux，不能作为最终门槛。
- 单个串行 job：节省安装但首个失败会遮挡其他问题。
- 必需双人批准：不符合独立维护方式。
- 永久 bypass：会重现漏验发布通道。

## Consequences

共享清单和真实子进程测试需要持续维护；每组独立安装增加 Actions 用量。main 前进需重验；平台故障保持未完成状态。生产规则已启用并回读核对；PR #61 与合并后的 main 已通过全部检查。今后的发布仍须完成最终 main 验证与规则回读。

## References

- [Issue #59](https://github.com/lazyq666/reroll-ai-canvas/issues/59)
- [Public readiness 当前合同](../current/public-readiness.md)
