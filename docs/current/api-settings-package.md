# API Settings Package

> Status: Current  
> Last verified: 2026-08-21  
> File extension: `.icapi` v1

API Settings Package 用于在设备之间搬迁允许共享的 Provider、Model、Workflow 与相关秘密配置。它不是 Workspace Data，也不是账号备份。

## 导出

- 只包含产品允许迁移的非 CLI Provider 设置、相关 Model、Workflow 和必要密钥。
- CLI 登录状态、Session、账号、Workspace 内容、本机绝对路径和可再生缓存不进入包。
- 用户必须提供导出密码；文件不保存密码或可直接恢复密码的信息。
- 包使用带认证的加密，任何内容或认证信息被修改都必须整体拒绝。
- 单包最大 16 MiB；超限在写出前失败。

## 导入

流程为：选择文件 → 校验格式和大小 → 输入密码 → 完整解密与验证 → 展示可导入摘要 → 用户确认 → 原子合并。

- 密码错误、文件损坏、版本不支持、内容非法或合并失败时，现有设置保持原样。
- 合并按稳定身份更新或新增，不因显示名称相同错误覆盖其他 Provider/Model。
- 导入不会切换 Workspace，不会更改账号、权限或 CLI 登录状态。
- 成功后只显示导入/更新/跳过数量，不回显秘密值。

## 安全与验收

- 明文秘密不写日志、URL、Issue、诊断复制或浏览器持久缓存。
- 解密与合并中间状态只存在于受控临时范围，失败后清理。
- 任一步失败都不能留下半套 Provider、Model、Workflow 或 Key。
- v1 兼容行为保持稳定；新格式必须使用新版本并提供显式迁移策略。

代表性测试：`tests/test_api_settings_transfer.py`、`tests/test_api_settings_transfer_transaction.py`、`tests/test_api_settings_transfer_integration.py`。

