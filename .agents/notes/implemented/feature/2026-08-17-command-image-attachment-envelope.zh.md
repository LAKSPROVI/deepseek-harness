# Agent Note: Command image-attachment envelope

Status: implemented

[English](2026-08-17-command-image-attachment-envelope.md) | 中文

## Problem

Web composer 的一次提交是一个信封——草稿文本、已附加图片、投递模式——但两条提交平面对它的消费是不对称的。普通消息走 `defaultSink → conversation.sendSession`，图片被序列化进 prompt 内容并在成功后清除。被 claim 的斜杠命令走 `claim.submit(args, actx)`，一个纯文本事务：`/goal rebuild the cathedral` 带四张参考照片时，命令执行、草稿清空，图片却静默滞留在 composer 附件栏。模型从未看到它们，也没有任何界面提示。这个缺陷在契约层面而非某个漏掉的调用点：claim、裁决、宿主执行器都没有建模附件，因此任何命令都可能消费提交的文本一半而丢弃其余部分。

合并两个平面从未在考虑范围内——[插件命令注册 Agent Note](2026-07-19-plugin-command-registration.zh.md)刻意让人类命令留在模型平面之外，这个分离是正确的。问题在于信封在平面分叉处被拆散了。

## Decision

提交信封被端到端建模，每条命令路径要么整体消费它，要么响亮拒绝。

**声明。**`CommandDefinition.input.attachments: boolean`（缺省为 false）声明 composer 附件是否可以随调用提交。该标志随冻结的 `CommandDescriptor` 经 `commands/list` 到达每个客户端，进入铸造出的 `CommandClaim`（`attachments: true`），再进入输入状态机发布的 claim 快照。

**通用标识与带标签载荷。**浏览器草稿与持久化引用使用 `DraftAttachmentId` 和 `AttachmentId`；命令 RPC 传输编码字节而非标识。公开的 `@deepseek-ai/dsh-commands/types` 中 `EncodedCommandAttachment` 是按 `type` 区分的联合类型，可表示一张编码图片或一个编码不透明文件。该扩展由[不透明通用文件决策](2026-08-29-opaque-generic-file-attachments.zh.md)负责；本注记中图片专属的生产方行为仍然有效。

**执行器强制。**`CommandRuntime.execute(agent, line, encodedAttachments, signal)` 携带本次提交的 base64 附件。强制执行声明的是执行器而非 composer：把附件发给未声明的命令、附件存储缺失、图片或文件组被拒绝，都会在处理器运行前以记录在案的 `command/done` 错误结算。准入按标签拆分提交向量，把完整批次交给 `admitEncodedImages` 与 `admitEncodedFiles`，再恢复精确混合顺序，处理器最终在 `invocation.attachments` 收到冻结且有序的 `ImageBlock` 和 `FileBlock`。因此 prompt RPC 与命令执行共享同一套 Host 权威准入，被拒绝的批量不会发布持久化对象。

**模型可见性由生产方负责。**注册表自身绝不调度附件。`/goal` 在 create 或 edit 成功后通过 `agent.followup` 提交一条包含已接纳块和固定说明文本的用户消息，后续 Goal Round 从普通会话历史读取它们，goal 领域不存储附件状态。`/plan <message>` 把附件并入 steer 的文本消息；不带参数的 `/plan` 可以 steer 一条仅含附件的用户消息，因为附件可能包含全部任务内容。不会发送模型输入的控制形式（`/goal pause`、`/plan off`）会直接返回错误，composer 的附件原地保留。plan 投影会把 `command/run` 视为候选选择，并在配对的 `command/done` 报错时丢弃它，因此被拒绝的带附件 `/plan off` 不会留下待退出状态。

**composer 的拒绝是可见横幅，一切保留。**ui-commands 从裁决收到附件数量，对每条无法消费该信封的回车路径执行拒绝：contribution 弹窗、decoration 弹窗、未声明的 claim 与 bare 分离执行。输入状态机发布一条错误通知，composer 通过瞬态 Toast 横幅呈现它，草稿与附件不动。已 claim 状态下的提交由 facade 使用 `conversation` 命名空间的同款文案把关。接受路径上，facade 经 `commandAttachments` 序列化有序草稿附件、传给 `claim.submit`，仅在成功 outcome 后清除并释放；错误结果（包括生产方语法拒绝）保留它们。

## Testing

注册表执行器强制、准入失败结算、冻结的调用附件由 `packages/interaction/commands/tests/commands.spec.ts` 覆盖；批量准入顺序与限额在 `packages/attachment/attachment/tests/admission.spec.ts`；生产方行为在 `packages/goal/command-goal/tests/command-goal.spec.ts` 与 `packages/plan/plan-mode/tests/plan-mode.spec.ts`；客户端拒绝与消费路径在 ui-commands、ui-conversation、ui-input-trigger 客户端套件；组装后应用流程在 apps/web 的 keyless 通道。

## Alternatives considered

- **附加图片时一律拦截命令（没有接受路径）**——被拒绝：可预测，但带参考图的 `/goal` 正是驱动这次修复的用例，用户的图片将完全没有通往模型的路径。
- **任何命令后把滞留图片自动作为后续用户消息发送**——被拒绝：对宿主状态命令（`/model`、`/compact`）令人意外，且把消息契约从生产方挪到 composer，违反命令注册表「生产方负责模型可见工作」的规则。
- **在 goal 领域存储附件引用并渲染进 Round 提示词**——被拒绝：需要持久化 goal schema 变更，且要么把图片块复制进每轮提示词，要么引入仅首轮的提示词形态；round 提示词不变量将需要附件状态。一条普通的已记录用户消息达到同样的模型可见性。
- **只要命令成功就消费附件，不管语法**——被拒绝：`/goal pause` 带附件会将其静默丢弃，在更深一层重演原始缺陷。消费与生产方的显式成功绑定，语法不匹配返回错误。
- **只在客户端强制**——被拒绝：schema 省略不是强制执行；直接 RPC 调用方可以绕过 composer。执行器自己结算声明。
- **使用不带标签的多媒体标识**——被拒绝：两个标识已经是附件通用类型，wire 传输的是字节，而各模态具有不同的准入与模型可见语义。交付的 `EncodedCommandAttachment` 联合类型携带显式 `type`，执行器因此能分别接纳或拒绝各组，而无需根据 MIME 猜测。

## Consequences

- 任何命令路径都不可能消费提交的文本而滞留附件：契约强制整信封消费或可见拒绝，对现有与未来命令一体适用。
- commands 包依赖 `dsh-attachment` 与 `dsh-llm`，`commands/execute` 携带必填的 `encodedAttachments` wire 参数——每个调用方都显式陈述其信封。
- `/goal` 与 `/plan` 接受参考附件，代价是一条额外的已记录用户消息（goal）与 steer 消息中的附件块（plan），其中不带参数的 `/plan` 会产生仅含附件的消息；原生支持的路由接收受支持内容，其他路由接收确定性模态回退。
- 菜单点选的弹窗流程不查询信封：存在附件时点选弹窗命令，附件会可见地留在 composer，而不是拒绝该交互。回车提交是被强制执行的信封边界。
- 「被拒绝的批量不发布任何持久化对象」只覆盖准入前的三种结算（声明、存储缺失、批量超限）。handler 级语法拒绝（如 `/goal pause` 带附件）与准入后取消发生在批量已提交之后，会留下没有会话事件引用的内容寻址对象——在 sha256 去重与附件存储延后的引用感知 GC 下无害，但并非「未写入任何对象」。
