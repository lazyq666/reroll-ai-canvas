# ADR-0007：Prompt Library 专属目录拥有数据与封面媒体

- 状态：已接受
- 日期：2026-08-31
- 来源：Issue #225
- 局部取代：ADR-0001 中“所有新导入图片统一进入通用 Managed Media”的规则；仅 Prompt Template 封面采用本文的专属所有权

## 背景

Prompt Library 的权威 JSON 原本位于 `data/prompt_libraries.json`，Prompt Template 封面则借用普通参考媒体上传，保存在 `assets/input/imported/`。这两类内容具有同一个业务生命周期，却分散在不同目录；人工备份、检查和恢复 Prompt Library 时，无法只搬动一个自包含目录。

普通参考媒体还可能同时被 Canvas、Workflow 或 Generation Run 引用。直接移动现有文件会让其他引用失效，而把 Prompt Library JSON 放入公开挂载的 `assets/` 又会扩大数据暴露面。

## 决策

Prompt Library 模块拥有一个 Workspace Data 专属目录：

```text
<workspace>/data/prompt-libraries/
├── prompt_libraries.json
├── covers/
├── recovery/
└── migration-v1.json
```

目录名使用领域术语的正确英文复数 `prompt-libraries`。`prompt_libraries.json` 是通用 Prompt Template 与 Category 的唯一权威；当前画布 Prompt Template 仍由所属 Canvas 权威拥有，但它使用的封面字节也可以在 `covers/` 中按内容摘要复用。

新封面直接写入 `covers/`，文件名使用 SHA-256 内容摘要和经验证的图片扩展名。相同内容幂等复用。浏览器只通过需要 Administrator 或 Designer 身份的同源封面路由读取文件；不得把整个 `data/prompt-libraries/` 目录静态公开。

旧 Workspace 在首次读取 Prompt Library 时执行一次受控目录迁移：

1. 完整读取并验证旧 `data/prompt_libraries.json`，验证失败时不发布新权威；
2. 对仍可解析的 `/assets/input/imported/...` 封面复制字节到 `covers/`，不移动或删除通用 Managed Media 原件；
3. 准备把成功复制的封面引用改写为专属封面路由的新数据；缺失或外部引用保持原值并记录；
4. 在 `recovery/` 保存旧 JSON 的内容校验副本，并在 `migration-v1.json` 记录来源摘要、目标、备份、迁移数量与缺失引用；
5. 上述恢复内容持久化后，最后原子发布新 JSON，再移除旧 JSON。移除失败允许旧文件保留，但调用方只读取新权威。

回退时使用 manifest 指向的恢复副本还原旧 `data/prompt_libraries.json`，并停用或移走新目录。迁移不删除 `assets/input/imported/` 原图，因此旧封面引用仍可恢复。

## 不采用的方案

- **继续使用 `data/prompt_libraries.json` + `assets/input/imported/`**：没有形成自包含的 Prompt Library 备份边界。
- **把 JSON 与封面都放进 `assets/prompt-libraries/`**：现有 `/assets` 是静态媒体入口，会让 Prompt Library 权威数据进入公开媒体面。
- **迁移时移动旧封面而非复制**：同一内容可能被 Canvas 或其他功能引用，移动会造成静默破坏。
- **在 JSON 中保存 Base64 图片**：放大每次读写与冲突范围，无法按内容摘要独立复用或缓存。
- **让前端分别管理 JSON 与封面路径**：把迁移、校验和目录知识扩散到调用方，降低 Prompt Library 模块的深度与可测试性。

## 影响

- Prompt Library 的备份、检查和恢复可以以一个目录为入口。
- Prompt Library 模块成为 JSON、封面导入、封面解析和旧布局迁移的唯一实现位置；HTTP 与 UI 只依赖其小接口。
- 旧通用 Managed Media 封面副本暂不自动清理，因为垃圾回收必须先证明没有其他引用。
- 新生产模块必须进入更新文件白名单，迁移、路径穿越、权限与内容摘要复用必须由自动化测试覆盖。
- Workspace 搬家仍复制整个 Workspace，因此无需新增搬家协议；存储 Current 文档必须展示新目录和回退方式。

## 参考

- Issue #225
- [ADR-0001：Workspace Data、Instance State、Device State 与 Device Cache 的边界](0001-workspace-data-boundary.md)
- [存储路径与旧数据迁移](../current/storage-layout-and-migration.md)
- [提示词库的通用与当前画布范围](../active/2026-08-21-prompt-library-common-and-canvas-scope.md)
