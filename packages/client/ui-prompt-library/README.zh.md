# @deepseek-ai/dsh-client-ui-prompt-library

[English](README.md) | 中文

Web 客户端的持久化提示词库。Host 注册 `prompt-library` 设置命名空间，其中包含一个有序的 `prompts` 数组；浏览器通过 `ctx.settingsScope` 绑定该命名空间，并向 `settings.section` 提供完整 CRUD 页面、向 `conversation.input.left` 提供紧凑启动按钮、向 `conversation.input.overlay` 提供可搜索的选择器。

每条提示词为 `{ id, title, body }`。Host 最多接受 100 条提示词、120 个标题字符、12,000 个正文字代码单元，以及整个列表 200,000 个标题和正文字符；ID 必须唯一。Client 仅为即时表单反馈重复这些限制，Host 注册仍是权威校验方。

三个浏览器条目共享一个由 `apply` 创建的可观察 store。设置 scope 是唯一持久化来源；本包不使用 `localStorage`。远程或内存设置会显示明确的不可用状态并禁用 CRUD。选择提示词只调用 `inputActions.setDraft`：空草稿直接变为正文；非空草稿变为原文、两个换行符和正文。选择绝不调用 `submit`。`trimStart()` 后以 `/` 开头的正文会在设置页和选择器中显示警告。

## 模型体验

无直接影响，因为本包只修改浏览器中的未发送草稿。只有用户随后通过会话输入另行提交草稿时，保存的提示词才会对模型可见。

#### KV Cache 影响

无直接影响。插入文本只改变未发送的浏览器草稿；后续提交请求及其缓存行为归会话和模型提供方所有。

## 已知限制与延后工作

- 提示词顺序遵循数组顺序，但本包只提供创建、编辑和删除，尚不提供拖放排序。
- 搜索仅在有界内存列表中执行不区分大小写的标题／正文子串匹配，不提供模糊排序或标签。
