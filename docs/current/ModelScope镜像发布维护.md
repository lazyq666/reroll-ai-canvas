# ModelScope 镜像发布维护

> Status: Current
> Last verified: 2026-09-01

ModelScope 只作为 Reroll AI Canvas 的可选国内代码镜像。GitHub 公开仓库
`lazyq666/reroll-ai-canvas` 是唯一发布权威；两端必须发布同一个已验证
commit，不得分别维护代码或版本。

项目已移除应用内一键更新功能。ModelScope 不是运行时更新源，不需要在
`backend/main.py`、设置页或 `INFINITE_CANVAS_*` 环境变量中配置它。

## 当前状态

- GitHub 主仓库：`https://github.com/lazyq666/reroll-ai-canvas`
- 稳定分支：`main`
- ModelScope 创空间：尚未创建
- 镜像名称：建议使用 `reroll-ai-canvas`
- 可见性：公开
- 许可：与仓库 `LICENSE` 完全一致，并保留原项目与原作者声明

## 首次建立镜像

1. 在 ModelScope 创建名为 `reroll-ai-canvas` 的公开创空间。
2. 将 Git Access Token 只保存在密码管理器或系统钥匙串，不得写入源码、
   环境变量示例、文档或提交信息。
3. 只在 GitHub 公开准备检查全部通过后添加 `modelscope` 远程。
4. 首次推送前确认 ModelScope 端没有需要保留的文件，然后推送与 GitHub
   `main` 相同的 commit。

```bash
git remote add modelscope https://www.modelscope.cn/studios/<owner>/reroll-ai-canvas.git
git push modelscope main:master
```

如创空间默认分支不是 `master`，以 ModelScope 实际分支为准；文档与发布
脚本必须使用同一分支名。首次以外不使用强制推送。

## 每次镜像发布

1. 确认工作区干净，全量测试、公开准备审计和人工 Gate 通过。
2. 按 `YYYY.MM.DD.daily-sequence` 更新 `VERSION`，并确保
   `static/update-notes.json` 的 `version` 完全相同。
3. 先发布 GitHub `main`，记录其 commit SHA。
4. 把这一个 SHA 推送到 ModelScope，不在镜像分支上直接修改。
5. 在两端核对 `VERSION`、`LICENSE`、`README.md` 和 commit SHA。

任一端的版本、文件树或许可声明不一致时，停止宣布镜像可用，直到两端
重新对齐。
