# Reroll README 演示素材

> 历史 HTML 概念草稿。账号、快速工具与资源库片段已由 [真实页面录屏](../real-recordings/README.md) 替代。此处保留旧素材供开场与历史版本参考，不作为本次新录屏交付。

关联 [#10：修改 README](https://github.com/lazyq666/reroll-ai-canvas/issues/10)。此目录完成演示素材准备，不代表 README 改写已经完成；未发布媒体或修改 Issue 状态。

## 预览

在仓库根目录运行：

```sh
python3 docs/demos/readme-showcase/serve.py --port 8796
```

打开 [HTML 演示](http://127.0.0.1:8796/docs/demos/readme-showcase/)。顶部可播放、切换章节和中英文；时间轴数值是 10 fps 的帧编号（0–599），便于精确剪辑。`?lang=en&time=30` 可以打开英文版的指定时间点。初始暂停。

## 复用范围

演示直接加载生产环境的 `design-tokens.css`、`smart-canvas.css` 和 Infinite Canvas UI `core.js`，没有重绘另一套按钮、节点、工具栏或库界面。

- 画布：`ic-canvas-grid`、`ic-canvas-node`、`renderCanvasNodeMarkup`、`renderReadOnlyPromptNodeBodyMarkup`、`ic-prompt-composer`。
- 导航与操作：`ic-smart-canvas-dock`、`ic-smart-node-toolbar`、`ic-button`、`ic-icon-button`、`ic-icon`。
- 多人指针：实际页面的 `.realtime-pointer`、`.realtime-pointer-label` 和协作者语义颜色。
- 模板：直接实例化 `ic-prompt-template-library`，通过公开属性传入演示模板。
- 资产：直接实例化 `ic-workspace-asset-library`，通过独立本地服务器的只读 fixture 接口供给数据。
- 账号与工具的简化呈现：复用 `ic-card`、`ic-badge`、`ic-divider`、`ic-number-input`、`ic-slider`、`ic-segmented-control`、`ic-textarea`。工具面板是基于现有组件的精简演示，不是完整的 `ic-ai-processor-dialog` 页面复刻。

`showcase.css` 负责演示布局、镜头位置和动作，不修改生产组件内部实现。中英文文案放在共享资源 `static/js/i18n/showcase.js`，仅由演示页面加载；校验器也包含该资源。

所有片段都保留“概念演示 / Concept film”标注。指针运动、工具结果及模板/资产转移由脚本编排，不应当作为真实多人会话或真实模型调用的证明。金属造型是原创程序绘制的统一演示素材；分层、深度和角度效果是示意。账号动画遵循 `CONTEXT.md` 中的角色和权限规则。没有改动画布 `81e968f6dee74fd3a741b9512b5c2fce`，没有调用生产接口或生成服务。

## 剪辑表与输出

| 时间 | 内容 | 文件前缀 |
| --- | --- | --- |
| 00–12 秒 | 多人指针与画布节点 | `01-collaboration` |
| 12–24 秒 | 账号、授权项目、只读分享 | `02-accounts-access` |
| 24–48 秒 | 六种工具，每种 4 秒 | `03-quick-tools` |
| 48–60 秒 | 提示词模板库与资产库 | `04-libraries` |

`exports/` 中提供中文 `-zh` 与英文 `-en` 两套输出：

- 60 秒完整 MP4。
- 4 段独立 MP4、4 段 GIF、4 张 PNG。
- 六种工具的独立 4 秒 MP4。
- 文件大小清单，以及中文总览图。

视频：1280 × 720，H.264，30 fps 容器；动画按 10 fps 采样，因此没有宣称原生 30 fps 动作。GIF：960 × 540，10 fps，循环播放。无音轨。MP4 使用 fast-start，适合网页播放。各章节末尾重启，不保证无缝循环。

## 重新导出

已交付的媒体可直接使用，无需重新录制。需要重录时，在支持的 Browser 技能环境中：

1. 将视口设为 1280 × 820，打开对应语言的演示，确认组件和素材加载完成。
2. 通过可见的时间轴输入框依次设置 0–599。
3. 每次输入后捕获完整视口，顺序保存为 `/tmp/reroll-component-frames/zh/0000.jpg` 至 `0599.jpg`；英文使用 `en` 目录。捕获实际 DOM 和 Shadow DOM 渲染结果，不用 Canvas 重画 UI。
4. 在仓库根目录运行：

```sh
python3 docs/demos/readme-showcase/export.py zh
python3 docs/demos/readme-showcase/export.py en
```

脚本会裁去顶部 64 px 的录制控制区，保留 1280 × 720 影片画面，然后生成 MP4/GIF/PNG。原始帧是临时文件，不纳入仓库。导出前检查帧完整性与分辨率；重新运行会覆盖同名媒体。

## 已验证

- `node static/js/i18n/validate-i18n.js`：通过。
- `node --check docs/demos/readme-showcase/showcase.js`：通过。
- `python3 -m unittest tests.test_core_creation_i18n tests.test_canvas_management_i18n tests.test_i18n_cache_versions`：18 项通过。
- `python3 scripts/sync_infinite_canvas_ui_version.py --check`：通过；生成器运行后无需变更版本。
- 浏览器检查：实际组件加载、中文/英文切换、各章节、时间轴、播放/暂停和导出关键帧。
- FFprobe：视频编码、尺寸、帧率和时长；导出画面已作目视检查。

此变更不增加生产功能、领域术语或架构责任，因此没有修改 Current 文档。公开 README 的最终编排和媒体发布仍属于 #10 的后续工作。
