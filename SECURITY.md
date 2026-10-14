# 安全策略

## 支持的版本

| 版本                         | 支持状态        |
| ---------------------------- | --------------- |
| 2.x（当前主线，`main` 分支） | ✅ 接受安全修复 |
| 1.x（早期原型）              | ❌ 不再维护     |

## 报告漏洞

**请不要在公开 Issue 中披露安全问题。** 请通过以下方式私下联系维护者：

- 使用 GitHub 的 [私下漏洞报告](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)（仓库 → Security → Report a vulnerability）

请在报告中尽量包含：

1. 受影响的版本 / 提交哈希
2. 复现步骤或最小 PoC（含请求与响应）
3. 影响评估（越权读写、数据泄漏、拒绝服务等）
4. 你已知的缓解方式（如有）

我们会在 7 天内确认收到，并在修复发布后于 `CHANGELOG.md` 中致谢（如你希望匿名请注明）。

## 部署方须知

本项目是**自托管**系统，安全性也取决于部署方式：

- 上线前务必修改 `MC_ADMIN_PASS`，并为 `MC_SESSION_SECRET` 配置足够长的随机值
- 建议置于反向代理之后启用 HTTPS，并设置 `MC_TRUST_PROXY=true`
- `MC_ALLOW_REGISTER` 开放注册时，请配合限流与审核流程
- 按 [docs/ops-runbook.md](ops-runbook.md) 定期备份 `MC_DATA_DIR`

设计层面的安全措施（鉴权守卫清单、schema 校验、审计、限流、CSP、会话签名等）见 [docs/security.md](security.md)。
