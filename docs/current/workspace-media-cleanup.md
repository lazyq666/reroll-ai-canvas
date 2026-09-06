# 工作区未使用文件清理

管理员在工作台“数据存储位置”中选择“扫描文件”，查看可清理数量和容量后点击
“清理文件”。扫描不删除内容；确认只删除该次扫描中仍无引用且身份、大小和修改时间
未变化的文件。清理永久释放原文件，不提供媒体回收站。没有候选时显示空状态，
完成后显示实际删除数量、释放字节数，以及已被引用、发生变化或删除失败而保留的数量。

## 保留边界

- 扫描整个 Workspace，包含其他用户的画布、回收站画布、有效撤销/重做记录、
  Canvas 与 Global Generation History、资产库、已保存 Composer/模板/对话/工作流、
  Generation Run 输入与输出、待发布内容和保留的恢复记录。
- JSON authority 读取 Canvas JSON 与生成 JSON；SQLite authority 读取双库及 WAL
  的已提交状态，不回退到旧 Canvas/生成 JSON。两种模式都读取其他 Workspace 内容。
- SQLite 的变更广播缓存和幂等回执不是可恢复内容；有效 `canvas_mutations` 的 changes
  与 inverse 都保护媒体。已没有 Canvas Log 引用的去重日志 payload 不单独保留媒体。
- SQLite 中待重试的写回与发布记录仍作为完整引用读取，保护其关联媒体；只有已被
  worker 领取的记录阻止扫描，避免旧的待重试记录让工作区永久无法清理。
- 本次服务运行期间创建、修改、导入或通过媒体接口读取的文件暂时保留，保护上传后
  尚未保存的输入。该保护在服务重启后结束；届时仍有持久引用的文件继续保留。
- 当前生成历史继续保留原文件。删除全局历史仅解除该条历史引用，不能直接删除
  图片、视频、音频或文本文件；其他历史或画布仍在引用时，文件不可清理。

## 执行约束与失败恢复

只考虑 `assets/input/`、`assets/output/`、`assets/uploads/` 内已支持扩展名的普通
单链接文件；隐藏文件、未知扩展名、无法无歧义识别的文件名、软链接和硬链接跳过。Prompt Library 专属封面、
Device Cache、设备秘密和外部原文件不在清理范围。兼容 URL、编码文件名、绝对路径
和内容摘要引用保守归一，歧义只会多保留。

扫描与确认短暂冻结新的 HTTP 工作和 Canvas Realtime Mutation，等待已进入的操作
完成；10 秒内未排空或存在活动生成时返回忙碌，用户完成操作后重新扫描。后台文件
检查在线程中执行；即使客户端断开，也等待操作退出后才重新开放请求。

读取失败、损坏 JSON/SQLite、未知记录类型、数据目录软链接或缺失权威数据库会使
整次引用检查失败，在删除前停止。返回可翻译的错误码，不展示内部路径。文件删除
失败不会阻止其他已批准文件处理，响应仅统计实际释放量。网络结果不确定时提示
重新扫描确认现状。支持既有单服务工作区边界，不协调外部程序直接改写工作区。

SQLite authority 下，`data/` 根目录中符合双库发布/恢复临时命名规则的 WAL/SHM
残留，只有在正式库存在、临时主库已不存在、对应 WAL 是大小为 0 的普通文件时
才跳过引用检查；这些残留文件本身不删除。非空 WAL、缺失 WAL、未知命名或仍有
临时主库均继续阻止清理，不能将恢复数据误判为空残留。

扫描令牌绑定管理员和工作区，10 分钟后、服务重启后或成功确认后失效；同一管理员
重新扫描替换旧结果。界面提供加载、空、成功、失败和重试状态，中英文动态状态
随语言切换更新，清理进行中阻止重复提交与关闭弹窗。

## API 与实现

| 接口 | 请求 | 响应 |
| --- | --- | --- |
| `POST /api/workspace-storage-settings/cleanup/scan` | 无 | `scan_id`, `file_count`, `total_bytes` |
| `POST /api/workspace-storage-settings/cleanup/confirm` | `scan_id` | `file_count`, `total_bytes`, `skipped_count`, `failed_count` |

两条接口仅管理员可用，匿名 401、非管理员 403；忙碌、过期和引用读取失败使用 409
及 `media_cleanup_busy` / `media_cleanup_expired` / `media_cleanup_unreadable`。
接口不接受客户端文件路径，不返回文件列表。

`backend/infinite_canvas/media_cleanup.py` 负责扫描、会话保护、令牌、复核与回收；
`backend/main.py` 负责权限、生成忙碌检查及 HTTP/Realtime 写入协调；
`static/js/preferences.js` 和共享 i18n 资源负责现有弹窗中的两步操作。

## 验证

`tests/test_media_cleanup.py` 覆盖 JSON/SQLite 引用、实际回收、扫描后引用变化、
文件变化、会话保护、路径边界、坏数据、确认令牌、部分失败、请求排空与两种历史
适配器保留原文件，以及空发布残留兼容、非空日志拒绝、待重试记录引用保护与已领取
记录阻止清理。`tests/test_media_cleanup_http.py` 覆盖真实应用组合中的权限、
扫描/确认、生成忙碌及错误码。页面验收使用隔离临时工作区的实际工作台入口。

`tests/preferences_media_cleanup.test.cjs` 覆盖加载和结果期间切换语言、重复操作保护、
确认令牌、过期重试、部分完成与组件就绪后的焦点恢复。2026-09-06 本地验收通过：
相关 Python 回归 161 项、上述动态 UI 回归、i18n 校验及 UI 资源版本检查；真实工作台
验证中文浅色和英文深色、扫描/键盘确认清理/再次扫描为空、损坏引用报错与修复后重试。

架构决定见 [ADR-0012](../adr/0012-manual-workspace-media-cleanup.md)。
