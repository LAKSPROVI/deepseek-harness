# 运行手册：面向 agent 的模型能力变更

[English](model-capability-agent-runbook.md) | 中文

agent（智能体）添加、修改、诊断或部署模型能力元数据时使用本参考。本文把每项决策映射到所属 package，并定义 Harness 声明某种模态或推理强度前所需的证据。构建适配器请遵循 [LLM（大语言模型）适配器指南](adding-an-llm-adapter.zh.md)；本手册覆盖适配器已经能够解析确切模型元数据之后的跨 package 路径。

## 所有权映射

| 问题 | 所有者 | 权威证据 |
|---|---|---|
| 存在哪些能力字段和三态语义？ | [`@deepseek-ai/dsh-llm`](../../packages/llm/llm/README.zh.md) | 提供方无关的类型，以及 `resolveModelInfo()`、`resolveCallConfig()` 和 `prepareCall()` |
| 哪条确切路由支持某个强度或输入模态？ | 已注册适配器，例如 [`dsh-llm-pi-ai`](../../packages/llm/llm-pi-ai/README.zh.md) | 同一适配器代次的确切模型解析器与请求序列化 |
| 信任网关发现结果中的哪些声明？ | 适配器的发现实现 | 已校验的发现输出；对于 9Router 媒体，只有 `proved` 探测才提升模态 |
| 哪个模型选择处于活动状态并可持久化？ | [`dsh-host-apiproxy`](../../packages/host/apiproxy/README.zh.md) | 进程内选择，其次是最新已记录的 `request/header`，最后是共享 Agent 默认值 |
| 浏览器显示或阻断什么？ | [`dsh-client-ui-model-selection`](../../packages/client/ui-model-selection/README.zh.md) | Host 返回的 `current`、`currentModel`、`routable` 与已知模态元数据 |
| 为什么原生媒体必须跨越多层？ | [高级媒体能力决策](../../.agents/notes/implemented/architecture/2026-08-30-advanced-model-media-capability-boundaries.zh.md) | 持久存储、规范模型内容、适配器协议支持以及产品呈现／回放 |
| 如何修复过期的恢复推理强度？ | [恢复推理强度修复决策](../../.agents/notes/implemented/bug-fix/2026-08-31-restored-reasoning-effort-recovery.zh.md) | 在模型目录响应与 prompt 接纳前解析确切模型 |

Catalog 成员关系只是建议。它既不授权路由，也不证明能力。持久化身份使用提供方／模型／推理强度 id，而非展示标签。

## 1. 不靠推断陈述能力

修改代码前先对每项声明分类：

- **推理：**只列出适配器支持的推理强度 id。仅当调用方省略强度时才应用配置的 `defaultEffort`。显式但不受支持的 id 会在提供方 I/O 前失败；LLM runtime 绝不自动调整。
- **输入模态：**保留三种状态。缺少 `inputModalities` 字段表示未知；显式列表不含某模态表示已知不支持；列表包含该模态表示已知支持。不得把未知变成仅文本。
- **原生媒体：**存储、规范内容块、UI 呈现、SDK 功能或成功的 HTTP 响应，都不能单独证明提供方会解释媒体。只公布该确切路由与方向已经完整实现的交集。
- **Agent 功能：**工具、原生搜索和其他 agent 集成不是模型模态。它们留在各自所属的服务或 Agent 面上。

能力信息来自发现时，应定义何种结果构成证明。提供方声明、模型名称、HTTP 200、已接受但未证明的探测、畸形结果或 agent 功能字段都保持未知，除非适配器文档化的证明规则另有规定。

## 2. 实现适配器拥有的事实

提供方协议词汇应留在适配器内部：

1. 从 `resolveModel()` 返回确切提供方／模型身份，以及可选的上下文、输出默认值、推理和输入模态。
2. 公布有序的不透明推理强度 id，并在请求序列化时把每个 id 映射为提供方协议值。`off` 等 id 可以映射为不同的协议拼写。
3. 仅在路由具有权威默认值时设置 `defaultEffort`。用户选择和路由配置优先于内置回退值。
4. 在网络 I/O 前拒绝显式的不受支持值。绝不静默丢弃请求的模态或推理强度。
5. 将解析与分发绑定到同一份已准备适配器代次，避免 HMR（热模块替换）或 settings 变更把一条路由的元数据与另一条路由的传输组合起来。

发现候选项仍是配置期数据。采纳界面可以展示它们，但只有已注册的确切模型解析才成为活动请求元数据。

## 3. 在 Host 保持会话事实

Host 是所有调用方的最终接纳权威，不能依赖浏览器已经执行相同检查。

恢复的选择可能比最初接受它的元数据寿命更长。在返回 `session.models` 和接纳 `session.prompt` 前解析确切模型。如果已选推理强度不再公布，只把该强度替换为当前 `defaultEffort`；模型没有默认值时则省略强度。提供方与模型保持不变。如果确切模型解析失败，保留完整选择，让不可用路由路径报告用户必须修复的身份。

不得重写较早的 `request/header`：它记录真正执行过的请求。规范化选择会在后续获准请求追加普通 header 时持久化。异步恢复尚未完成时，如果另一项选择先获接受，较新的完整选择保持权威。

## 4. 在浏览器投影已知事实

浏览器消费 Host 事实；它不从 catalog 行或模型名称推导能力。

- 只根据 `currentModel.reasoning.efforts` 显示推理强度控件。
- 协议上保留确切强度 id，同时允许展示标签不同。
- 仅当存在待处理图片且 `inputModalities` 是已知但不含 `image` 的列表时阻断图片提交。
- 未知模态元数据保持允许；Host 仍执行最终接纳。
- 在编码、上传或 RPC 前运行已知不兼容预检，拒绝后保留草稿与附件。
- 阻断期间仍提供模型选择和附件移除，使用户能够恢复。

重新选择当前模型可能是空操作，不是过期状态的恢复机制。恢复属于 Host 接纳。

## 5. 诊断活动环境不一致

编辑或重启前按以下顺序收集事实：

1. **会话：**当前提供方／模型、持久化推理强度，以及它是否来自最新 `request/header`。
2. **确切元数据：**`currentModel`、已公布强度／默认值、输入模态、`routable` 和各提供方 catalog 失败。
3. **适配器：**已注册提供方所有者、确切解析结果、发现证明状态与请求映射。
4. **构建产物：**Git SHA、干净／脏状态、Host 适配器／API 构建 hash、Web 资源修订、进程命令、worktree、profile 与 `DSH_HOME`。
5. **传输：**确认拒绝是否发生在提供方 I/O 前。`UNSUPPORTED_REASONING_EFFORT` 是本地校验；提供方 HTTP/SSE 证据才证明请求越过该点。

Web shell 可以是最新的，而 Host bundle 仍然陈旧。静态资源一致或 HTTP 200 不证明 runtime 一致。Host 与 Client 必须从同一 SHA 构建并启动，再通过活动 API 或 DOM 验证行为，不能只看文件名。

## 6. 验证完整路径

对每项变更职责使用能够捕获其回归的最窄测试，然后验证组装后的应用：

| 变更职责 | 最低证据 |
|---|---|
| 能力校验／默认值 | LLM runtime 或适配器单元测试，覆盖接受、省略、零／off 和不受支持值 |
| 发现结果提升 | 覆盖已证明、未证明、失败、畸形和无证据的 fixture |
| 恢复选择修复 | Host API 测试，覆盖目录响应、prompt 接纳、不改写历史和并发较新选择 |
| 浏览器选择器／接纳 | 组件测试，覆盖确切强度行、已知不兼容阻断、草稿／附件保留和恢复 |
| 已发布 runtime | 完整受影响构建，以及针对现有部署 URL 的活动 smoke |
| 提供方身份 | 一次真实响应，记录当前 round 的 requested、routed、served 与 provider 身份 |

GUI smoke 应显式选择目标路由，除非测试本身拥有部署默认值。分别断言 id 与无障碍标签。持久化的显式强度可以合法覆盖适配器默认值；应在空白选择中测试默认值，在恢复选择中测试优先级。

## 7. 部署时不得混用构建产物代次

1. 确认目标 branch、SHA、worktree、profile、home、URL 与监听 PID。
2. 从该 SHA 构建完整的受影响 Host 与 Client 面。
3. 记录 Host 能力所有者和适配器的 hash，而不只记录 Web shell。
4. 只停止已验证的监听进程，并以相同 profile、`DSH_HOME`、URL 与端口重启。
5. 要求 HTTP readiness、注入的 boot 数据、预期 SHA、干净源码树和活动能力行为全部成立。
6. 重新运行恢复选择、推理强度菜单、已知不兼容模态和恢复 smoke。
7. 保留 rollback 构建产物，绝不从进程已启动推断成功。

只有当源码、构建产物、活动 Host 元数据、浏览器投影与提供方证据描述同一能力状态时，部署才算完成。
