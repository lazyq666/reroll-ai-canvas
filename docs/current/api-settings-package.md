# API Settings Package

> Status: Current  
> Last verified: 2026-09-07
> File extension: `.icapi`; encrypted envelope v1, settings content v2; imports v1 and v2

API Settings Package 在 API 设置页的「API 与模型备份」中统一导出和导入，用于备份及跨设备、跨环境迁移。只有 Administrator 可以使用。它不替代 Workspace 内容或账号备份。

## 名称的保存

当前 Workspace 的 `data/api_providers.json` 中，每个平台的 `model_names` 保存「Model ID → 显示名称」。稳定身份仍是 Provider ID 与 Model ID；改名不改变请求路由。同一个模型在不同 Provider 下可以有不同显示名称。

「可用模型」拥有名称编辑。API 设置页保存连接或重新选择模型时，服务端保留现存名称，只从提交内容补充尚无名称的 ID，防止早先打开的页面将新名称覆盖为旧名称或 Model ID。暂时移出清单的名称保留，重新加入相同 ID 时可以恢复。备份导入属于显式恢复操作，允许覆盖包内平台的名称。

模型排序与显隐保存在同一工作区的 `data/available_models.json`；管理员维护的能力详情保存在安装级 `model-capability-workbench.json`。这三个位置通过同一个备份入口收集。

API 设置保存模型清单或导入备份后，已打开的可用模型页通过页面通知和跨标签页通知重新读取最新清单；返回浏览器页面也会重试同步，无需手动刷新。页面有未保存的名称、显隐或排序时先保留编辑，保存结束后同步；迟到的旧响应不能覆盖新编辑或恢复已移除的条目。保存期间已从 API 清单移除的模型以服务端清单为准，不保留幽灵行。

## 导出范围

- API 平台的名称、连接地址、连接类型、启用／首选状态、模型清单、模型显示名称、模型协议、工作流配置和现有 API 密钥。
- CLI 平台的共享模型设置；不包含 CLI 可执行文件路径、连接、登录状态或 Session。目标设备须安装 CLI 并重新登录。
- 所有配置模型的分类、排序和显隐，包括停用平台及隐藏模型。
- 图片、视频和文字模型的能力合同，包括图片编辑与图层拆分。保存当前基线与已发布配置；已配置上限不会因源设备的运行限制而被截短。目标设备仍执行自己的运行上限。
- RunningHub 用户工作流和相应凭据。未发布能力草稿、审核历史、Account、其他 Instance State、Workspace 媒体、其他设备设置及缓存不进入包。

导出前等待当前页面待保存设置完成；保存失败时不下载旧状态。密码至少 8 个字符，最长 256 个字符，不写入包。包沿用 scrypt 与 AES-256-GCM 认证加密，单包最大 16 MiB，超限在下载前失败。

## 导入与冲突

流程为：选文件 → 输入密码 → 解密并完整校验 → 显示平台名称、新增／更新平台数、模型条目数和覆盖范围 → 确认 → 原子合并。

- 预览只校验，不应用包内设置；取消或关闭弹窗不导入。
- 按稳定 Provider ID 更新或新增，不按显示名称合并。包内平台的模型配置覆盖目标同 ID 平台，其他平台保留。
- 相同 Provider ID 的连接类型不同，整个导入拒绝；先调整冲突 ID 后重试。不会把本机 CLI 身份静默转换成 API 平台。
- 包内非空 API 密钥替换对应密钥；没有携带的密钥不清空目标值。CLI 凭据不导入、不清空。
- 包内排序和显隐优先恢复，目标其他平台的模型追加在后，保留其显隐。包内首选平台优先，保证最多一个首选。
- 能力按 Provider ID、Model ID 和 Operation 校验并一次发布，记录备份恢复操作；目标其他模型的能力与历史保留。
- 完整性校验包括模型清单、名称映射、排序／显隐、能力身份及合同。密码错误、损坏、不支持的版本、冲突或非法内容均不写入。
- 导入失败回滚平台、连接、密钥文件及进程环境、工作流、排序／显隐和能力文件；重新激活回滚后的目录。写入期间与其他配置及能力编辑互斥，不留下半套设置。
- 导入不切换 Workspace，不更改账号、权限或 CLI 登录状态。成功反馈仅显示平台名称及计数，不回显密钥。

旧版 v1 内容继续使用原先的非 CLI 平台合并规则，不恢复 CLI 配置、能力详情或源端显隐；确认弹窗明确提示旧版范围。新导出使用 v2 内容，但保持 v1 加密封装。旧应用会拒绝 v2 内容，须更新后再导入，避免旧应用静默丢弃新增字段。

## 验收

- `tests/available_model_management_sync_test.cjs`：变更通知、跨标签页、待保存编辑、并发移除、迟到响应和失败重试；`tests/model_settings_sync_browser_harness.html` 在两个持续打开的实际设置页验证删除后列表和计数同步。
- `tests/test_available_model_management.py`：改名后旧 API 页面再保存，名称不回退。
- `tests/api_settings_backup_state_test.cjs`：密码表单关闭后再进入下一步，提交与取消都清理密码。
- `tests/test_complete_api_settings_backup.py`：真实存储适配器跨环境往返、停用与隐藏模型、CLI 模型、能力详情、预览无写入、旧包兼容、非法内容与启用失败回滚。
- `tests/test_api_settings_transfer.py`、`tests/test_api_settings_transfer_transaction.py`、`tests/test_api_settings_transfer_integration.py`：加密、防篡改、密钥边界、事务及 HTTP 兼容。
- 实际 API 设置页检查中文／英文、Light／Dark、默认／密码弹窗／预览／取消／错误与成功反馈、Pointer／Keyboard；测试使用隔离服务和合成配置，不请求真实 Provider。
