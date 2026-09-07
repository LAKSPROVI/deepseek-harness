# @deepseek-ai/dsh-attachment

[English](README.md) | 中文

持久附件服务边界。`ctx.attachments` 校验并持久提交提供方无关的规范化图片以及不透明的通用文件，随后返回可序列化的 `ImageAttachmentRef` 或 `FileAttachmentRef`；消费方绝不会在会话事件中持久保存浏览器路径、对象 URL、提供方 URL 或 base64。

未发送的输入区附件仍是由浏览器持有的临时草稿。`validateImage` 运行完整准入策略但不执行持久化。`saveImages` 负责批次图片数量和总字节限制，在发布任何成员前准备全部规范化附件，然后按顺序提交，并且只在完整批次成功后返回引用。后续存储失败不会返回部分引用，但较早写入的不可变内容寻址对象可能保持不可达，直至具备按引用感知的垃圾回收。`saveImage` 会在发布任何模型可见的会话事件前提交一张已接受的图片，并直接返回 `ImageAttachmentRef`。规范化过程缩小图片时，引用会通过 `originalDimensions` 记录应用方向后的输入尺寸。`readImage` 根据已记录的元数据校验规范化附件。`readImageRequest` 确定性派生路由所需的请求版本，其身份覆盖附件 ID、变换策略版本、像素和字节预算及编码参数。调用方通过 `Promise.all(refs.map(...))` 组合有序批次，本地实现仍通过实例级限流器、缓存和 singleflight 限制压缩并发。调用方可以取消读取和投影；实现保留取消结果，不把它转换为存储失败。

通用文件走同一条持久化路径，且不解释内容。`FileAttachmentRef` 携带不透明的内容寻址 `attachmentId`、规范化后的 `mediaType`、精确 `bytes` 和可选的净化后 `name`；存储绝不会把展示名称解析为路径。提供方只支持图片时，`fileLimits` 为 `undefined`，所有文件操作以 `FILE_ATTACHMENTS_UNSUPPORTED` 拒绝。`saveFiles` 保留有界的内存兼容路径。`saveFileStream(scope, input)` 递增执行限额、摘要、暂存、同步与发布，然后返回 `UploadedFileAttachment` receipt，证明完整引用属于该 scope。prompt 与命令准入在记录引用前调用 `authorizeUploadedFiles`。`readFileStream` 在迭代期间校验摘要与长度，不物化完整对象。媒体类型缺失或格式错误时归为 `application/octet-stream`；任何方法都不会解码、解压提取、转码或执行文件字节。`AttachmentError.code` 使用封闭联合，其准入子集供协议适配器映射可由调用方修正的失败。

`admitEncodedImages` 与 `admitEncodedFiles` 仍是图片及缺少原始文件传输能力的 carrier 所用的规范 base64 入口。served Web 会先通过流式路径上传通用文件，再只提交 `UploadedFileAttachment`；prompt 与命令准入可把 receipt 与 legacy 编码文件合并，校验完整引用批次并保持提交顺序。图片继续使用 base64 路径。

## 模型体验

该包通过角色无关的核心 `ImageBlock` 与 `FileBlock`，以及解析这些持久引用的提供方适配器，间接影响模型。仅有持久存储并不赋予模型原生理解能力：适配器会把图片引用解析为确定的请求版本，其描述会公开完整附件 ID 和实际请求尺寸；而未声明 `file` 输入模态的路由收到的是核心的确定性元数据投影——以文本给出附件 ID、名称、媒体类型和字节长度——而非文件字节，只有具备文件能力的路由才能收到文件内容。

#### KV 缓存影响

添加图片或文件会改变提供方请求，因此会使受影响的请求后缀失效。

## 已知限制与待完成工作

- 图片准入仅接受 PNG、JPEG、WebP 和 GIF。
- 保留策略与垃圾回收尚未实现，因为恢复和 fork 后的会话可能共享不可变对象。
- 提交给已配置的第三方文件能力模型提供方的文件，会以字节形式发送给该提供方；harness 不限制路由可以收到哪些文件内容。
- 音频、视频和持久的未发送草稿需要单独的生命周期与提供方契约。
