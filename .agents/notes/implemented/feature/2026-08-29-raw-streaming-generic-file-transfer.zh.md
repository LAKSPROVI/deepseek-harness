# Agent Note: Raw streaming generic-file transfer

Status: implemented

[English](2026-08-29-raw-streaming-generic-file-transfer.md) | 中文

## Problem

通用文件附件路径最初与图片共用 base64 JSON carrier。该表示无法安全承载所需的 1 GiB 文件上限：base64 会放大载荷，`File.arrayBuffer()` 会物化源文件，JSON 构造会创建完整字符串，Host bridge 会拼接完整请求体，解码还会分配另一份完整 buffer。1 GiB 文件也会在 Host 准入有机会拒绝或持久化之前超过实际可用的 V8 字符串上限。

因此，上传与下载路径必须在不削弱 [Opaque generic file attachments](2026-08-29-opaque-generic-file-attachments.zh.md) 所定持久引用规则的前提下保持有界内存。仅上传字节不能发布用户消息，业务拒绝后的重试不能重新传输对象，仅持有附件 id 也不能授权下载。

## Decision

served Web 经整体缓冲 JSON bridge 之外的精确 `POST` 与 `GET /api/session.file` route 传输通用文件。图片继续使用既有 base64 RPC 路径。fixture 模式与自定义 `__DSH_TRANSPORT__` carrier 不暴露原始传输能力，继续使用有界的 legacy `EncodedFileAttachment` 路径。

通用文件默认上限为每个文件 1 GiB（`1,073,741,824` 字节），完整通用文件批次 1 GiB，文件数量最多 20。这些是存储与提交上限，并不承诺所选模型会消费文件字节。没有原生 `file` 输入的 route 会收到确定性元数据投影；内置 DeepSeek route 仍是文本与图片 route。

### Upload and receipt

浏览器直接把 `File` 对象作为请求体发送，并在有界请求元数据中声明会话 id、精确字节数、展示名称与媒体类型。原始 route 校验声明长度，再把请求作为 `AsyncIterable<Uint8Array>` 转发，不使用 `arrayBuffer()`、base64、JSON 或 `Buffer.concat`。

`AttachmentStore.saveFileStream` 递增统计并计算 chunk 摘要，在读取期间执行单文件与总量上限，写入私有暂存文件并同步，再通过排他硬链接发布到内容寻址存储；取消或失败会删除暂存状态。相同字节会去重。`expectedBytes` 同时用于早期限额检查和流结束时的精确断言。

上传成功返回 `UploadedFileAttachment { uploadId, attachment }`。本地 provider 使用随机进程本地密钥，对确切会话 scope 与完整规范化 `FileAttachmentRef` 计算 HMAC-SHA-256，并以常量时间验证。prompt 与命令准入为确切会话验证 receipt，并在发布持久消息前校验 legacy 与已上传文件引用的完整混合批次。浏览器按会话与草稿附件缓存成功 receipt 直至释放，因此被拒绝的 prompt 或命令可重试而无需重新传输对象。

### Download authorization

浏览器只向原始 GET 提供 `sessionId` 与 `attachmentId`。Host 从该会话权威 `user/message.content` 中匹配的文件块派生全部元数据；工具元数据、任意插件 JSON 与其他事件字段都不授权读取。随后它以 `application/octet-stream`、attachment disposition、`X-Content-Type-Options: nosniff` 和 `Cache-Control: private, no-store` 流式发送经过摘要与长度校验的对象。Range 请求会被拒绝，因为部分读取无法满足完整对象校验约定。

`/api` 浏览器信任栅栏同样守卫该 route。该栅栏防止 DNS rebinding 与跨站可达性；它不是用户认证，本决策也不作此声称。

## Alternatives considered

**提高整体缓冲 JSON carrier 上限。** 这会保留单一传输，但仍需要多份完整文件分配、承受 base64 膨胀，并在达到 1 GiB 前跨越运行时字符串上限。更大的常量不能让该表示具备流式能力。

**上传后立即记入日志。** 这会让上传授权状态持久化，但用户仅选择文件就会在提交 prompt 或命令之前发布模型可见历史。上传仍是暂存；只有被接纳的 prompt 或命令准入才追加引用。

**使用未签名附件 id 作为上传结果。** 内容寻址只证明字节，不能证明上传方，也不能证明获准的元数据与会话。receipt 绑定所有这些值，同时仍足够小，可进入普通 RPC 信封。

**让每个 provider 都消费通用字节。** provider 支持能力与 Harness 存储容量相互独立。元数据回退继续保持确定且显式；只有 route 声明原生文件输入时，provider 才收到字节。

## Testing

存储测试使用小型配置上限覆盖精确长度、跨 chunk 的多一字节超限、预期长度不符、取消清理、去重、经过校验的流式读取、错误会话 receipt 拒绝与元数据篡改，无需分配真实 1 GiB buffer。Host、命令、连接与对话测试覆盖 legacy／receipt 混合顺序、上传不发布事件、权威日志下载授权、原始请求体、背压、Range 拒绝、receipt 复用、回退 carrier 与直接下载 URL。

## Consequences

- served Web 可以用有界应用内存与传输背压接收和返回 1 GiB 通用文件。
- 上传 receipt 只在同一 Host 进程与确切会话内可复用。重启会使已上传但未提交的 receipt 失效；已经接纳进会话历史的引用仍然有效。
- 内容寻址存储没有逐用户 quota、上传预留账本、receipt TTL 或引用感知垃圾回收。上传后从未提交的对象可能保持孤立，直到未来保留系统将其清理。
- 原始 route 增加第二条 HTTP 传输路径，以及自身的取消、长度、授权与生命周期测试。整体缓冲 JSON carrier 继续服务图片与兼容传输。
- 通用文件卡片保持惰性，不显示传输进度。浏览器把最终流式保存交给普通下载处理。
