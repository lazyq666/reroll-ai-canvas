# APIMart 图片质量与 GIF / SVG

- Status: Implemented locally; live Provider samples passed 2026-11-08; full delivery and final user acceptance pending
- Tracked by: [LAZ-135](https://linear.app/lazyq/issue/LAZ-135)
- Approved source: Linear 文档 `9d153fee1588`，2026-11-08 合并规格
- Scope: 精确 APIMart GPT Image 2.5 / 2.6 Flare、Sunburst；不扩展 Ext 或其他 Provider

## 能力与参数

沿用 [ADR-0009](../adr/0009-unified-model-capability-catalog.md) 的 Evidence → Draft → 管理员保存并应用边界。代码提供候选选项，不自动修改工作区已发布能力；提交冻结同一 Catalog Revision。管理员为 `image.generate` / `image.edit` 发布六档 `auto / low / medium / high / xhigh / max`，2.6 可发布输出格式。SVG 只属于 `image.generate`。旧设置缺质量时使用 auto；失效的显式选择应提示并阻止提交，不静默降档。

Composer、批量、Agent 画布编排和后台 CLI 最终使用公共图片请求编译器及相同 Provider 映射。图像质量不控制文本模型推理等级，不新增 complexity 或 reasoning UI。

| 格式 | 请求合同 |
| --- | --- |
| PNG | 缺省格式；支持已发布的透明能力 |
| JPEG / WebP | 可选 0–100 压缩质量；透明只允许 PNG / WebP |
| GIF | 文本或 1–16 个静态图片输入；n 为 1–4 份动画；省略静态比例、Resolution Tier、透明、压缩、mask、markup |
| SVG | 文本输入、n=1；`svg.model` 必须属于该 APIMart Provider 的已配置文本模型；省略 background、帧参数和压缩 |

GIF 默认每帧 `512x512`、9 帧、200 ms。帧数为 2–16；时长至少 20 ms 且是 10 的倍数。帧宽高为 16 的倍数。完整拼帧表为 2–8 帧 `4×2`、9 帧 `3×3`、10–12 帧 `4×3`、13–16 帧 `4×4`，允许交换行列。整表每边不超过 3840、总像素不超过 8,294,400、长短边比不超过 3；任一合法布局即可。512 方形适用于全部帧数；768 方形的 13 帧和 1024 方形的 2 帧非法。

2026-11-08 用户确认 Composer 以单一 Small、quiet 下拉菜单替代原透明 PNG 开关，放在生成张数之后。仅当已发布能力支持透明 PNG、GIF、SVG 中至少一项时显示，未选择时显示“选择格式”，菜单首项是“默认格式”，其后按能力提供透明 PNG、GIF、SVG；不在该入口新增普通 PNG/JPEG/WebP 选项。选择默认格式恢复未选中状态。批量和 Agent/CLI 的完整格式合同不变。

格式切换保留参考输入和帧设置，选择默认格式、透明 PNG、GIF、SVG 时清除不兼容的压缩设置；透明 PNG 与 GIF/SVG 互斥。非法输入组合在收费提交前失败。SVG 缺文本模型时提供模型管理入口；有参考图时报告冲突。GIF 不从参考图自动继承尺寸。显式选择 SVG 将份数设为 1。历史 JPEG/WebP 等显式格式保留回读，不静默改写；菜单存在时可选择默认格式恢复提交。本轮不实现自然语言格式识别。

### GIF 参数菜单调整（已接入 Composer，待用户验收）

2026-11-08，用户最初要求 GIF 的分辨率、帧率与每帧毫秒收进现有质量菜单，帧数参照视频时长使用拖动滑块；先提供 HTML 原型。同日评审后确认只保留一个 FPS 设置，移除每帧毫秒输入，内部换算为每帧毫秒作为最终格式参数。2026-11-09，用户进一步要求帧率改为拖动，并明确授权将 demo 效果写入正式 UI。

Composer 的 GIF 模式复用 `ic-generation-settings-picker`，菜单依次显示分辨率、质量、帧率与帧数，隐藏静态画幅、自定义像素和 Resolution Tier。分辨率预设为 256×256、512×512、768×768；当前历史尺寸不在预设中时追加原值。FPS 与帧数沿用视频时长滑块的视觉，拖动时实时显示数值，释放后持久化，方向键及 Home / End 同样可用。菜单重绘保留滑块焦点和滚动位置。

默认 5 fps、9 帧。FPS 基础档位覆盖 1–50 fps，内部对应 `[1000,500,250,200,160,120,100,80,60,50,40,30,20]` 毫秒；与已发布模型范围取交集，并纳入模型显式档位及当前合法历史值。帧数范围与已发布合同及 2–16 取交集。界面不提供毫秒输入，不新增 FPS 持久化字段；继续使用 `frameSize / frameCount / frameDurationMs`，历史 70 ms 显示为 14.29 fps 且保持原值。选择其他质量、切换格式和重新打开画布不会静默量化帧参数。

尺寸与帧数组合复用统一能力校验。非法尺寸选项禁用；调整帧数使当前尺寸失效时保留原选择，显示原因并禁用生成，用户改为合法尺寸后恢复。没有合法 FPS 档位时禁用该滑块。能力加载失败或未知时保留参数并阻止无效提交，不自动发布模型能力。HTML 原型 `static/prototypes/laz135-gif-settings-prototype.html` 保留为设计参考；批量和 Agent/CLI 参数界面不在本次 Composer 调整范围内。

## 原件与生命周期

生成结果按真实内容检查格式、MIME、扩展名、尺寸和有限资源消耗。GIF 保留完整字节、帧时长和循环信息；SVG 保存安全验证后的原字节及 viewBox，不转 PNG，不经过静态 cover 物化。

SVG 采用保守元素白名单，禁止实体、脚本、事件、外部 URL、嵌入位图、foreignObject、样式元素和不安全 CSS；仅允许局部片段引用。以独立图片资源展示，响应带 `sandbox` CSP 和 `nosniff`。导入与生成共用验证边界，伪扩展名不能绕过 SVG 验证。

GIF 列表和远景使用静态封面；选中且可见时播放，取消选择或移出视口后恢复封面。预览使用原件。下载、ZIP、节点包、资产库、分享和工作区搬迁引用同一托管原件。裁剪、绘制、缩放和局部修复需要位图时先确认创建 PNG 副本，后续修改该副本，保留原件。

Generation Run 保留 Operation ID、远端任务身份、幂等与 Target Guard。可下载的远端输出在保存前建立检查点；下载或验证失败不发布成功，恢复重存原结果，不重新收费生成。远端返回内联字节时不把字节存入运行 JSON，必要时查询同一任务重新取得输出。无远端任务身份的同步 400 保持失败。

## Agent / CLI

`reroll generate` 新增 `--quality`、`--output-format`、`--frame-size`、`--frame-count`、`--frame-duration-ms`、`--output-compression`、`--svg-model`、`--n`。帧尺寸只适用于 GIF；原有 `--size / --width / --height` 仍不受支持。新增 MCP `generate_image / get_image_run / download_image_run` 复用同一后台接口与账号授权。

结果回读有效格式设置，按输出索引下载全部原件；`reroll result` 继续读取同一 Run。原件格式由内容决定，本机文件不覆盖已有同名文件。账号权限、逐条确认偏好与下载归属不变。

## 验证与毕业门槛

代表性确定性入口：

- `tests/test_apimart_image_formats.py`：公共请求→真实适配器的 48 个质量组合、精确身份/发布门禁、GIF 布局、SVG 冲突、原件与安全、保存失败重启后不重复生成。
- `tests/test_reroll_cli.py`：质量/格式参数、GIF 与 SVG 原字节下载、原身份恢复。
- `tests/laz_135_image_formats_browser_smoke.cjs`：真实 Chrome Composer、六档质量、格式提交、双语/主题/窄屏、GIF 播放和显式静态副本。
- 相邻 GenerationRuns、模型目录、Agent、批量、托管媒体及 i18n 回归。

2026-11-08 格式入口迭代：Chrome 已验证 10 组能力组合、未选择/默认恢复、透明与 GIF/SVG 互斥、实际下拉点击和键盘选择、请求参数及节点设置回读，覆盖 1440/768/390 宽度、中英文与明暗主题；透明 PNG 兼容测试、尺寸设置 8 项及格式/文档/i18n 24 项 Python 测试通过。3000 端口实际页面已验证“选择格式”及按当前已启用能力显示选项。未自动发布模型能力，未新增付费生成。独立 Composer 样板的字数区不重叠断言仍失败，使用 Git 原有样板和原有测试对照同样复现，不属于本次菜单回归。

2026-11-09 GIF 菜单接入：`tests/laz_135_image_formats_browser_smoke.cjs` 通过真实 Chrome 鼠标拖动、连续方向键、Home / End、节点持久化及整页重载、70 ms 历史值、768×768 与 16 帧冲突及恢复、模型限定 FPS 和空档位、缺少格式能力提示、实际请求参数及原视频时长事件回归。覆盖 1440/768/390、中英文、明暗与菜单视口边距，生成请求全部由隔离夹具截获。透明 PNG 浏览器兼容测试、8 项自定义尺寸测试、25 项格式/文档/i18n Python 测试、4847 个翻译键及 465 项资源同步检查通过。3000 正式服务的独立 Chrome 标签已确认新菜单及能力缺失提示，未修改现有节点参数或模型配置，未新增付费生成。

旧 `tests/t35_generation_settings_browser_smoke.cjs` 在不存在的 `MOD · RAT` 样板标题处停止，Git 原有样板也已无此标题；临时适配定位后，其旧 8 选项断言与当前样板 4 选项仍不一致。未修改该旧测试，未将其计为通过；共享视频时长控件的事件兼容由本次正式页面回归单独覆盖。

2026-11-08 用户授权使用现有 APIMart 凭证，最多 20 次小样本、总预算 50 元。实际执行两个 2.6 模型各 PNG 参考图、纯文本 GIF、单参考 GIF、SVG，共 **8 次提交，8 次成功**，均 n=1 / low。使用隔离目录，经现有管理员发布边界应用测试能力；未修改正式工作区配置。SVG 明确选择账号模型列表中的 `gpt-5.4-mini`，返回版本为 `gpt-5.4-mini-2026-03-17`。完整脱敏参数、任务身份、原件哈希、计费与验收边界见[实测记录](../../resources/image-capability-audits/apimart-gpt-image-2.6-formats-2026-11-08.json)。

| 场景 | Flare | Sunburst |
| --- | --- | --- |
| PNG 单参考图 | 1024×1024 原件通过 | 1024×1024 原件通过 |
| 纯文本 GIF | 512×512，4 帧，200 ms/帧，循环 | 同左 |
| 单静态参考 GIF | 512×512，4 帧，200 ms/帧，循环 | 同左 |
| 文生 SVG | 安全矢量，1024×1024 viewBox | 同左 |

8 份结果均通过内容验证，再次查询同一 task 并下载后的 SHA-256 与托管原件相同。真实 `/api/download-output` 经过隔离账号认证，8 份文件的字节、MIME、附件头通过，SVG 同时带 sandbox CSP / nosniff。8 份文件的托管导入与隔离工作区 `copy_and_verify` 搬迁后字节一致。Flare GIF / SVG 各注入一次本地保存中断，重新创建 GenerationRuns 后恢复同一远端任务，新增付费提交为 0。

Chrome 的真实画布页面已加载全部 8 份原件，检查了 SVG 预览、选中 GIF 使用原件、取消选择后 4 个 GIF 回到静态封面。浏览器下载最终落盘未作为通过项：首次隔离夹具遗漏下载路由，补齐后自动化未确认最终落盘；浏览器内部下载管理页受工具策略限制，未绕过。下载完整性以真实 HTTP 接口及哈希校验为准。图片和浏览器截图保存在本地 `.scratch/laz135-live/`，不包含在长期能力证据 JSON 中。

最终 `GET /v1/usage` 的 8 次记录合计 **US$0.14686 / 1.4686 Credits**，与 token 已用额度差一致，包含 SVG 转换。按本轮预算预留值 10 元/美元保守折算为 1.4686 元；此值不是市场汇率。逐次瞬时额度可能含预留，结算总额优先。

2026-11-05 Flare 单参考 GIF 同步 400 保留为历史失败证据；本次成功只证明当前账号、路由和小样本组合。未用付费请求穷举六档质量、16 张参考图或所有帧数。

完整分享/协作、节点包/ZIP、操作员工作区搬迁与最终用户验收门槛仍待完成，不能把隔离原件复制验证等同于完整人工搬迁验收。本扩展整体继续保留 Active。当前能力目录必须继续区分已发布合同与真实账户证据。
