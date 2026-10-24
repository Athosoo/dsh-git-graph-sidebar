# Git 规范 · GitHub Flow

```yaml
status: settled
framework: github-flow
```

## 1. 提交信息 / Commit messages

- 标题一行为主：`<动词> <做了什么>`，≤ 72 字符，祈使句。
- 推荐同时遵循 Conventional Commits 的 type 前缀，便于自动发版。
- 正文说明动机、影响面、测试方式；引用 issue（`Refs #123`）。

## 2. 分支模型 / Branching

- `main` 永远可部署、永远可回滚。
- 任何改动都走分支：`<slug>` 或 `feature/<slug>`；从 `main` 切出，合并后立即删除。
- 分支存活以小时或天计，不做长期并行开发。

## 3. 评审与合并 / Review & merge

- 开 Pull Request 即请求评审；PR 描述写清「改了什么、为什么、怎么验证」。
- CI 全绿 + 至少 1 人 approve 才能合并（squash 或 rebase，保持历史线性）。
- 合并即部署；出问题先回滚，再定位。

## 4. 版本与发布 / Versioning & release

- 发布单元是合并，不是版本号；如需版本号，由部署流水线自动递增。
- 回滚点用部署记录或 tag `deploy-<yyyy.MM.dd-HHmm>` 标记。

## 5. 变更日志 / Changelog

- 面向用户的变更写进 `CHANGELOG.md`（或 Release notes），按日期倒序。
- 内部重构不必记录。

## 6. 检查清单 / Checklist

- [ ] 从最新 `main` 切出分支
- [ ] PR 描述完整、CI 全绿
- [ ] 合并后删除分支
- [ ] 需要回滚时有明确的部署记录

## 参考 / References

- GitHub Flow — https://docs.github.com/get-started/using-github/github-flow
