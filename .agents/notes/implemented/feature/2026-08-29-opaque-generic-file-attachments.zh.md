# Agent Note: Opaque generic file attachments

Status: implemented

[English](2026-08-29-opaque-generic-file-attachments.md) | 中文

## Problem

附件能力此前只接受光栅图片，别无其他。输入框会拒绝类型不属于 PNG、JPEG、WebP、GIF 的任何文件；存储会把每一份被接纳的字节按光栅解码、纠正方向并归一化；模型内容词汇只携带一个 `ImageBlock`；命令信封声明的是 `input.images`。用户若想把任务真正围绕的那件产物交给 agent（智能体）——一份 CSV、一份构建日志、一个 zip、一个 `.docx`、一块固件镜像——根本没有任何路径，也不存在对应的持久表示。

拓宽这条路径并不是放宽媒体类型清单那么简单。用户附加的字节是任意且不受信任的，harness 可能围绕它们提供的每一项便利，都是在执行上传方的意图而非用户的意图。看起来像路径的名称并不是路径。在 GUI 中渲染的 HTML 或 SVG 载荷会在产品自身的源里执行脚本，而承载该页面的正是持有会话的页面。被解包的归档文件就是一次等待遍历条目的 zip-slip。声明的 MIME 类型是上传产出方的一句主张，而非关于字节本身的证据。

路由问题同样是承重的。当前注册的多数模型路由只接受文本与图片，而确实接受文件的第三方路由是按它自己的条款接受的。把用户明确附加的文件静默丢弃，正是图片工作已经排除的那种失败：用户的意图被改变，而用户和模型都不会被告知。

## Decision

通用文件按不可变的不透明字节被接纳。harness 存储它们、寻址它们、授权它们，并把它们交给声明接受文件的路由。harness 不解释它们。

### 持久词汇

附件 seam 在图片一半之外新增文件一半，模型内容词汇为其新增一个块。

| 类型 | 归属 | 角色 |
| --- | --- | --- |
| `FileAttachmentRef` | [`packages/attachment/attachment/src/types.ts`](../../../../packages/attachment/attachment/src/types.ts) | 持久引用：内容寻址的 `attachmentId`、归一化的 `mediaType`、精确的 `bytes`、可选的净化展示 `name`。 |
| `EncodedFileAttachment` | [`packages/attachment/attachment/src/types.ts`](../../../../packages/attachment/attachment/src/types.ts) | 协议格式（wire format）形态：规范 base64 的 `data`、可选的声明 `mediaType`、可选的 `name`。 |
| `FileBlock` | [`packages/llm/llm/src/types.ts`](../../../../packages/llm/llm/src/types.ts) | 角色无关的 `ContentBlockMap` 成员 `file`，只携带一个 `FileAttachmentRef`。 |
| `ModelModality` 的 `file` | [`packages/llm/llm/src/types.ts`](../../../../packages/llm/llm/src/types.ts) | 路由在原生接受文件输入时所作的声明。 |

`FileAttachmentRef` 绝不携带文件系统路径、bearer URL 或字节本身。因此会话日志只保存引用，与图片完全一致，持久会话事件加上不可变对象仍然共同足以重建模型所见之物。

字节与图片存放在同一个内容寻址存储下，位于 `$DSH_HOME/attachments/v1/objects/<prefix>/<sha256>`，具有相同的仅属主权限、相同的先准备再原子发布的提交流程、以及每次读取时相同的摘要与长度校验。文件走存储的不透明路径：不解码、不纠正方向、不生成归一化母版、不派生请求版本。一份文件的身份就是它精确的原始字节。

### 校验归 Host 所有

准入在 Host 侧是权威的，且仅在此处。served Web 把通用文件字节流式写入 `AttachmentStore.saveFileStream`，随后 prompt 与命令提交会为确切会话验证返回的 `UploadedFileAttachment` receipt，并校验完整引用批次。兼容 carrier 使用 `admitEncodedFiles`，在解码前拒绝非规范 base64，再委派给 `saveFiles`。两条路径都只发布持久引用；准入拒绝不会追加会话消息。

声明的媒体类型会被归一化，绝不作为证据被信任：缺失、为空或格式错误的值一律变为 `application/octet-stream`。提供的名称被削减为经过净化、去除控制字符的展示基名；存储绝不解析它、拼接它或把它当作位置读取。读取会校验记录的摘要与精确字节长度，因此被损坏或被替换的对象会响亮失败，而不会抵达模型或浏览器。

调用方可纠正的文件失败自成一个封闭集合——`TOO_MANY_FILES`、`FILES_TOO_LARGE`、`FILE_TOO_LARGE`、`INVALID_FILE_BASE64`——可通过 `isFileAdmissionError` 与存储故障区分开，因此输入框能指名用户触碰的那条限制，而 I/O 故障仍属运维范畴。附件提供方仅支持图片的部署会让 `fileLimits` 保持 undefined，其上的每一项文件操作都回答 `FILE_ATTACHMENTS_UNSUPPORTED`，而不是半接受。

### harness 不会对这些字节做的事

以下是本功能的否定性保证，而非偶然的遗漏：

- 任何名称都不会被解释为路径，也不会从用户提供的元数据派生出路径。
- 任何被接纳的文件都不会被执行、spawn 或交给解释器。
- 任何归档文件都不会被解包、枚举或检视其成员。
- 任何文件内容都不会被主动渲染。HTML、SVG 以及浏览器会执行的任何其他标记，都是待存储与下载的字节，绝不是要挂载进产品源的标记。
- 任何内容嗅探都不会把文件升格为更丰富的类型。只有本就属于受支持光栅格式的媒体类型才进入图片流水线；其余在整个生命周期内保持不透明。

### 限制与传输容量

通用文件在 `LocalAttachmentStore` 中拥有自己受校验的部署策略，与继续管辖光栅的图片策略相互独立。

| 边界 | 默认值 | 含义 |
| --- | --- | --- |
| `maxFilesPerMessage` | 20 | 单条消息接受的通用文件数量，与图片分开计数。 |
| `maxFileBytes` | 1 GiB | 单个通用文件接受的精确字节数。 |
| `maxMessageFileBytes` | 1 GiB | 单次提交接受的通用文件总字节数。 |
| `maxRequestBodyBytes` | 600 MiB | 缓冲的 JSON RPC 请求体；served Web 的通用文件不走此路径。 |

served Web 经 [Raw streaming generic-file transfer](2026-08-29-raw-streaming-generic-file-transfer.zh.md) 记录的原始流式传输发送通用文件。图片与兼容 carrier 继续使用有界 base64 JSON 路径。输入框依据 `fileLimits` 投影预检数量、单文件字节与总字节以提供即时反馈；Host 对每个调用方独立执行相同上限。

### 输入框、历史与下载

输入框的选择器、拖放与粘贴路径都在图片之外接受通用文件，并在混合批次中保持提交顺序：一条「文本＋图片＋文件」的提示词抵达模型时，其内容块仍处在用户构建的位置上。草稿文件与草稿图片一样，保持浏览器所有的临时状态，仅在消息被接受时才成为持久数据。

在历史中，只有受支持的光栅图片使用图片流水线、内联画廊几何与灯箱。通用文件渲染为惰性卡片，展示名称、媒体类型与字节数，并只提供下载动作。served Web 跟随经过会话授权的原始 URL；Host 强制使用 `application/octet-stream`、attachment disposition、`nosniff` 与 `private, no-store`，因此浏览器无需构建完整 Blob，也不会渲染声明的类型，而是流式保存文件。

读取授权是一项证明义务，而非令牌检查。原始 GET 只认可被请求会话权威 `user/message.content` 中的文件引用；工具元数据与任意日志 JSON 均不构成授权。因此，持有内容寻址标识并不足以从一个从未把该文件接纳为用户内容的会话中读取它。

### 模型路由与元数据回退

路由通过 `inputModalities` 声明自己接受什么。当一次请求的历史包含 `FileBlock` 而解析出的路由未声明 `file` 时，共享的 LLM（大语言模型）运行时经由 `textOnlyFileText` 把该块投影为确定性文本：附件标识、展示名称、媒体类型与精确字节数。该块绝不会被静默移除，且该投影是请求期的临时视图——持久历史原封不动地保留引用，因此同一会话稍后发往具备文件能力的路由时会送达真实字节。

该投影是每个需要文本替身的消费方的唯一来源：ACP 的协议格式上没有通用文件块，发出同一段文本；提供方无关的 token 用量估算按同一段文本计费；session-query 抽取索引同一段文本。同一个占位文本意味着这些面不会与模型实际所见发生漂移。

内置的 DeepSeek 路由被刻意保持不变：其 Files API 路径仍仅限图片，其目录条目声明 `text` 与 `image`，其按模型的 modality 类型排除 `file`。因此携带文件的 DeepSeek 请求会收到元数据回退。具备文件能力的路由是那些声明了该 modality 的第三方路由，对这些路由而言，实际文件内容会离开本部署。

### 命令信封的泛化

此前只建模图片的命令提交信封，现在承载整个混合批次。`CommandDefinition.input.attachments` 取代 `input.images` 成为声明字段；协议格式类型是 `EncodedCommandAttachment`，即已编码图片与已编码文件的带标签联合类型；执行器接纳这两组，然后在把块冻结到 invocation 之前还原提交时的混合顺序。执行位置未变，仍是执行器：发往未声明命令的附件、缺失的附件存储、超出的批次限制，都会在 handler 运行之前结算为一条被记录的 `command/done` 错误；无法消费该信封的输入框路径则可见地拒绝它，并保留草稿及其附件。

### 与图片专属注记的关系

本决策部分取代两篇已实现注记，两篇均保持活跃，作为各自图片专属部分的权威。

[Web multimodal image input and durable attachments](2026-07-22-web-multimodal-image-input-and-durable-attachments.zh.md) 仍是图片归一化、提供方无关母版、图片接纳限制、图片灯箱与提供方图片转换的权威。其中被取代的是：附件路径仅支持图片的表述、把通用非图片附件列为后续工作的否决，以及把 `session.attachment` 与接纳协议格式描述为图片形态的框定。它当初否决的那个联合类型——为所有 modality 使用一个不加区分的 `AttachmentBlock`——并不是最终交付的形态；`FileBlock` 是第二个显式块，因此每个消费方仍按名称处理或拒绝各个 modality。

[Command image-attachment envelope](2026-08-17-command-image-attachment-envelope.zh.md) 仍是整信封消费、生产方所有的模型可见性、输入框拒绝横幅与执行器执行规则的权威。其中被取代的是：仅图片的声明字段与仅图片的协议格式类型。它自身的 alternatives 一节写明了确切的重新引入条件——「第二种受支持的附件种类即重新引入条件；届时命令信封拓宽为带标签的附件联合类型，命令声明所接受的种类」——本决策正是这次拓宽。

[Unified image masters, request versions, and provider files](2026-08-20-unified-image-request-pipeline.zh.md) 记录的图片请求流水线，以及 [Whole-page image drop, projected intake limits, and thumbnail tiling](2026-08-12-web-image-intake-and-limits-alignment.zh.md) 记录的接纳对齐，均未受影响：通用文件从不进入其中任何一条。

## Alternatives considered

**把附加的文件重新解释为工作区路径，交由既有文件工具读取。** 这看似免费——harness 已经有 read、glob、grep——但它是一个带安全后果的范畴错误。附件名称是上传方提供的文本，可能在本主机上什么都不指向、可能指向完全另一样东西、也可能被构造用于遍历；用户从手机或另一台机器附加的字节根本没有路径。把展示名称变成文件系统操作，等于让不受信任的元数据寻址主机磁盘。名称只作展示之用。

**在会话事件中内联持久 base64，而不存储对象。** 这一步就能去掉存储、摘要与读取授权。它同时把每一个附加字节重复到事件日志、历史分页、fork、压缩（compaction）输入与导出中；把完整文件塞进一行 JSONL；并诱使 token 用量核算把编码文本当作模型文本。一个不可变对象加一个小引用使持久表示保持有界，而内容寻址会对同一文件的两次附加去重。

**假定每个适配器都能接收文件，交由提供方自行处理。** 统一性会消除 modality 声明与回退路径。它同时会把不受支持的输入转化成请求深处的提供方错误，更糟则是静默丢弃的块，并使用户的意图取决于恰好选中了哪条路由。已声明的 modality 加上一次确定性的元数据投影，既让模型知情，也让失败可见。

**主动渲染声明的 MIME 类型——预览 HTML、显示 SVG、内联展示 PDF。** 这是显而易见的产品功能，也正是文件一半存在的理由。它同时是唯一一项会把上传转化为在产品源内执行的改动：SVG 或 HTML 附件是一种脚本投递手段，而它将要运行于其中的页面持有着实时会话。惰性卡片加强制下载放弃了预览便利，以换取不受信任的字节绝不被客户端解释这一保证。

**继续把通用文件放在整体缓冲的 base64 JSON carrier 中。** 该路径仍服务 fixture 与自定义传输的兼容需求，但无法实现 1 GiB 约定：base64 会放大载荷，浏览器与 bridge 会物化完整字符串和 buffer，甚至可能在准入前超过 V8 字符串上限。因此 served Web 使用 [Raw streaming generic-file transfer](2026-08-29-raw-streaming-generic-file-transfer.zh.md) 持有的原始 route；图片因既有限额适合该 carrier，继续使用 JSON。

## Testing

存储与准入测试覆盖不透明流式发布、摘要与长度校验、用小型配置上限验证精确边界与超限、暂存清理、去重、取消、HMAC receipt 的 scope 与元数据完整性、规范 base64 兼容路径，以及仅支持图片的提供方。Host 与命令测试覆盖 legacy／receipt 混合顺序、错误会话拒绝、上传不发布事件，以及只有 `user/message.content` 落账后才授权下载。连接与客户端测试证明原始 `File` 上传、带背压的 route 复制、业务拒绝后复用 receipt、legacy 回退与直接强制下载 URL。LLM 测试覆盖确定性元数据投影及 ACP、token 估算和 session-query 抽取对它的复用。

## Consequences

- harness 接受任务通常真正围绕的那些产物，而不只是它们的照片，并由一种持久表示同时服务输入框、会话日志、命令、ACP 与每个提供方适配器。
- 持久存储增长更快，且仍没有引用感知的垃圾回收。一次被接纳的提交可保留 1 GiB，这抬高了推迟该回收策略的代价，但没有改变其设计。
- **对具备文件能力的第三方路由而言，文件内容会离开本部署。** 用户把合同、数据库转储或私钥附加到路由至此类提供方的会话时，正是这些精确字节按该厂商的保留条款发送给该厂商。harness 让 modality 声明与路由选择可见，但它不对内容分类，产品中也没有任何环节判断某份文件是否应当被传输。无法接受这一点的部署应把会话路由到文本与图片模型，那里的元数据回退只发送标识、名称、媒体类型与大小。
- served Web 文件在 JSON carrier 之外使用第二条 HTTP route。该 route 增加生命周期与授权工作，但在文件上限达到 1 GiB 时仍保持有界驻留内存；兼容 carrier 继续受其整体缓冲 base64 路径限制。
- 用户会期待产品刻意不提供的预览。惰性卡片是为「任何附加字节都绝不被客户端解释」这一保证长期支付的产品代价。
- 通用文件与图片共享持久内容寻址和混合顺序语义，但在 served Web 使用独立传输 route；对引用身份或消息重建的改动必须同时保留两种 modality，不能假定它们使用同一传输。
