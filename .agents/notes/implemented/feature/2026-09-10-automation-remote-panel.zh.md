# Agent Note: Persistent automation Remote panel

Status: implemented

[English](2026-09-10-automation-remote-panel.md) | 中文

## 问题

持久化自动化引擎在 Host 中拥有 `store.json`，而浏览器不能直接读取 Host 服务或文件。聊天工具可以控制引擎，但原生界面无法检查计划任务或调用相同控制。

## 决策

`@deepseek-ai/dsh-automation` 提供 Host `automation` 服务和 Typert Remote `automations` 命名空间。生成的 Client contribution 公开列表、触发、暂停和恢复方法。私有 `client-ui-automation` 包挂载该 contribution，并在会话标题栏注册面板。面板在每次操作后重新加载 Host 状态且仅发送任务标识符；所有者选择保留在 Host 配置中。

服务直接打开现有配置路径，不迁移数据。列表操作只读。触发、暂停和恢复复用同一个 store、worker、scheduler 和 reaper 实例；配置必须替换 user-space 中原有的引擎 row，不能运行第二个 store 所有者。

## 考虑过的替代方案

**浏览器 REST 端点。** 拒绝，因为它会重复 Typert 传输，并绕过生成的 Remote 授权和编解码路径。

**在浏览器中读取 `store.json`。** 拒绝，因为浏览器无法安全访问 Host 文件，并会形成过期的第二状态源。

## 后果

生成的 Remote 返回按所有者限定的 JSON 任务视图。原生面板列出任务并调用现有的触发、暂停和恢复控制。列表操作不写入 store。Web 配置挂载一个 Host 引擎和一个 Client 面板 contribution。

个人 Web composition 还在自动化面板旁保留 Agent Teams Host 服务和浏览器面板。会话历史、workspace 状态控制、备注、品牌和语音输入继续作为独立 Client contribution，并使用规范会话存储。

## 风险

该包不能与 user-space Host 引擎同时组合，因为独立的内存 store 可能互相覆盖写入。部署会禁用重复 row，同时保留其文件用于回滚。
