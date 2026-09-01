# 功能规格模板

复制本模板到 `docs/active/YYYY-MM-DD-<feature>-spec.md`。删除所有提示文字，并使用 [`CONTEXT.md`](../CONTEXT.md) 中的标准领域词汇。

---

# <功能名称>

- **Status**：Draft | Approved | Implementing | Implemented | Verified | Current | Superseded
- **Feature ID**：Fxx（来自[项目地图](PROJECT-MAP.md#功能规格注册表)）
- **Owners**：产品 / UI / 交互 / 前端 / 后端 / 测试
- **Last verified**：YYYY-MM-DD
- **Applies to**：版本或里程碑
- **Supersedes**：无，或旧规格链接
- **Superseded by**：无，或新规格链接
- **Related ADRs**：无，或 ADR 链接
- **Domain terms**：本规格使用的 CONTEXT 词汇

## 1. 一页摘要

用非技术语言说明：谁遇到什么问题、产品提供什么能力、最重要的边界是什么。UI、交互和产品读完本节应能复述功能。

## 2. Problem Statement

从用户视角描述问题，不写实现方案。

## 3. Goals / Non-goals

### Goals

- 可验证的用户结果。

### Non-goals

- 明确排除的相邻能力和原因。

## 4. Actors and permissions

| Actor | Preconditions | Can | Cannot |
| --- | --- | --- | --- |
| <角色> | <前提> | <允许动作> | <禁止动作> |

必须区分管理员、设计师、访客账号、匿名分享访问者和本机操作者（只保留与本功能相关者）。

## 5. User stories

1. As a <actor>, I want <feature>, so that <benefit>.

覆盖正常路径、空状态、权限变化、失败、重试、恢复、并发、撤销/删除及辅助功能。

## 6. User journey and interaction contract

### Entry and exit

- 从哪里进入、完成后去哪里、取消后回哪里。

### Happy path

1. 用户动作。
2. 系统反馈。

### Observable states

| State | Trigger | User sees | Allowed actions | Exit condition |
| --- | --- | --- | --- | --- |
| idle |  |  |  |  |
| loading/pending |  |  |  |  |
| empty |  |  |  |  |
| success |  |  |  |  |
| partial |  |  |  |  |
| failure |  |  |  |  |
| offline/recovering |  |  |  |  |
| forbidden |  |  |  |  |

### Input, pointer and keyboard

- Pointer/Touch/Keyboard 的行为、焦点顺序、快捷键与冲突优先级。

### Responsive and themes

- Desktop/Narrow 的承诺；Light/Dark；不支持的视口明确写出。

### Copy and internationalization

- 关键文案、动态值、错误信息、不可翻译标识。

## 7. Functional rules

按编号写不可歧义的规则。每条规则应能被外部行为测试或人工验收观察到。

1. ...

## 8. Domain and state model

说明涉及的领域对象、身份、生命周期、幂等键、所有权和并发关系。必要时使用小型状态图；不要复制完整实现类型。

## 9. Data and persistence

| Data | Authority | Boundary | Retention | Migration/recovery |
| --- | --- | --- | --- | --- |
|  |  | Workspace / Instance / Device / Cache |  |  |

说明敏感信息、相对/绝对引用、跨 Workspace 行为、删除和备份。

## 10. API / WebSocket / Provider contracts

只记录稳定的外部合同：请求意图、响应类别、错误语义、授权、幂等和兼容性。实现函数名不属于规格。

| Contract | Caller | Observable result | Errors/recovery |
| --- | --- | --- | --- |
|  |  |  |  |

## 11. Security and privacy

- 权限检查发生在哪些用户可观察边界；秘密和诊断信息如何脱敏；外部 URL/文件如何校验。

## 12. Performance and reliability constraints

- 并发上限、时延/资源 Gate、超时、重试、恢复、一致性和降级策略。

## 13. Design system contract

- 使用哪些 `ic-*` 公共组件、Token、Focus Policy 和合法组合。
- 新增视觉/交互模式前先说明为什么现有组件不足。
- 机器视觉证据与人工视觉验收分别列出。

## 14. Implementation decisions

记录模块边界、接口和技术决定，不写逐文件改动清单或大段代码。难以逆转且具有真实权衡的决定另写 ADR。

## 15. Acceptance and testing

### Highest test seam

选择能够一次覆盖最多外部行为的最高接缝，优先复用现有应用工厂、HTTP/WebSocket、浏览器或真实验收入口。

### Automated acceptance

| Scenario | Seam | Expected external behavior |
| --- | --- | --- |
|  |  |  |

### Human acceptance

| Role | Scene | Evidence / confirmation |
| --- | --- | --- |
| UI | Light/Dark × Desktop/Narrow |  |
| Interaction | pointer/keyboard/recovery |  |
| Product | user outcome and boundaries |  |

### Regression neighbors

列出可能被本功能影响的相邻能力，不断言内部实现细节。

## 16. Rollout, migration and rollback

- 兼容旧数据/旧页面、发布 Gate、失败回退、遥测或验证窗口。

## 17. Traceability

| Kind | Reference |
| --- | --- |
| Product map |  |
| UI surfaces |  |
| Implementation seams |  |
| Automated tests |  |
| Browser/manual evidence |  |
| ADRs |  |
| Replaced historical docs |  |

## 18. Open questions

只保留会改变用户承诺、数据边界或验收方式的问题。问题解决后把决定移回正文，不在这里保存永久答案。

## 19. Change log

| Date | Status | Change | Evidence/decision |
| --- | --- | --- | --- |
| YYYY-MM-DD | Draft | 初稿 |  |
