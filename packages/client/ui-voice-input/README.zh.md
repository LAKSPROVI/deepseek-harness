# @deepseek-ai/dsh-client-ui-voice-input

[English](README.md) | 中文

Web composer 的按住说话语音输入。插件向会话 composer 的 `conversation.input.left` 工具行贡献一个麦克风条目（id `voice-input`，order 20）：浏览器用 `MediaRecorder` 录下一段话，经生成的 `voiceInput` Remote 命名空间上传到 Host，再把返回的转写文本追加到会话草稿。

这是一个**表现层**包。它不注册工具、不注册 prompt 片段、不产生 session 事件。转写本身归 [`@deepseek-ai/dsh-voice-input`](../../transcription/voice-input/README.zh.md) 及其背后的 transcription seam；本包只拥有录音手势、上传这一跳，以及失败文案。

客户端插件先依赖稳定的服务面（`slots`、`remote` 和 `locale`）启动，仅在 `remote.voiceInput` 出现后安装 composer 条目。`api-remotes` 异步挂载生成的 Remote 命名空间；把 `remote.voiceInput` 当作静态插件注入会把合法的启动顺序误判成插件加载失败。HMR 撤回命名空间时，子注入作用域也会随之释放。

## 一段录音的旅程

指针按下开始录音、松开发送；键盘激活改为切换语义——键盘无法表达「仍在按住」，因此 Enter 或 Space 开始录音，再按一次发送。两种手势落在同一对 start/stop 上，所以该控件完全可以不用指针操作。

RPC 层只走 JSON，因此录音字节以规范 base64 放在普通请求里。编码按 0x8000 字节分块循环：把音频大小的缓冲区展开传给 `String.fromCharCode` 会超出参数上限并抛错。媒体类型取自 `MediaRecorder` 实际产出的值（去掉 `;codecs=opus` 这类容器参数），再与 Host 接受的五种类型比对——`audio/webm`、`audio/ogg`、`audio/wav`、`audio/mp4`、`audio/mpeg`。落在该集合之外的浏览器专有容器由本包就地拒绝并给出自己的提示，而不是上传给 Host 去拒。

每条退出路径都会停止 `MediaStream` 的所有 track：录完一段、拒绝格式、权限被拒、取消上传，以及组件卸载——包括权限弹窗仍然打开时发生的卸载。泄漏的 track 会让浏览器的录音指示灯一直亮着，用户会把它读成「应用在我停止之后还在听」。

转写是追加而非覆盖：`inputActions.setDraft` 接收的是完整的下一份草稿，所以组件先读当前草稿，草稿非空时用一个空格把转写文本接上去。trim 后为空的转写不改动草稿，并播报「没有听到语音」。

结果分两层信封，控件两层都读。外层是 carrier：生成的 Remote 方法解析为 `RemoteResult<T>`，Remote 面会把 carrier 失败折进它的 error 分支而不是 reject，因此没人为了兜住它去包一层 try/catch。它的 `code` 是开放字符串、message 面向运维，所以既不 switch 也不展示——凡是「请求没有完成」的结果都读作同一行。内层是 Host 自己的结果，其七个失败码是闭合联合，被穷尽 switch 并以 `assertNever` 收口。只有装配层故障（arity、方法未挂载、缺少 Context binder）仍会 reject；该路径被捕获，以免在途中止变成未处理的 rejection。

取消是真取消：在途请求带网关会遵守的 `AbortSignal`，同时控件会与该请求脱钩，因此已取消上传的迟到结果不可能再写入草稿。

音频字节及其 base64 编码从不进入 console，任何录音在其调用结束后都不再保留。

## 表现层状态与文案

录音、上传、失败状态都是组件本地状态——这里没有跨条目共享、也没有需要跨重挂载存活的事实，因此不声明 store。控件带有随阶段变化的可访问名称、录音时的 `aria-pressed`、上传时的 `aria-busy`，以及一个 polite live region 播报每次阶段变化与结果；失败文本另外可见地呈现给视力用户，并置于可访问性树之外，以免被播报两次。

所有文案在 `voiceInput` 命名空间内本地化（zh 为键集事实来源，en 按其键集校验完整）。每个 Host 业务失败码都有自己的一行文案：`provider-unconfigured` 告诉用户本部署没有配置转写凭据，请去配置。文案不点名提供方——transcription seam 接受任何注册的提供方，Groq 只是随包默认的那一个。面向运维的 `detail` 字符串从不进入界面——它们是诊断信息而不是用户文案，而且长度不定的提供方消息放不进只有一行高的 composer 控件。

## Model Experience

None, as 本包只是表现层，不注册工具、prompt 片段或 session 事件；转写文本作为普通用户文本落入 composer 草稿，只有人类随后发送的那条消息才成为模型可见内容，并且走的是既有的用户消息路径，该路径已负责记录。

#### KV Cache effect

与所有模型请求相互独立：本包不向任何请求贡献 token，因此既不构建也不失效可复用前缀。人类发送的转写文本对前缀的影响，与手动键入同样的文本完全一致。

## Known Limitations and Deferred Work

- **不发送语言提示** — 请求中可选的 `language` 字段留空，由提供方自行检测语言。客户端插件的浏览器端收不到 cordis `config`（boot manifest 只携带 id、url、rev、inject、immediately 与 external），因此无法把部署选定的语言送到这里；而当前 UI 语言只是显示偏好，不能作为用户所说语言的证据。
- **过长的录音只有在上传之后才被拒绝** — 音频字节上限归 transcription seam 所有，因此本消费方不自设上限，超限录音会先被编码上传，Host 再回以 `audio-too-large`。在客户端再设一份上限会让浏览器与 headless 部署产生分歧。
- **一个条目、一段录音** — 录音或上传在途时，控件会拒绝第二次手势；没有待处理录音队列。
- **整体接管 composer 时控件不可见** — 替换整个 InputBar 的待处理交互（提问或计划待审）会占用工具行，本条目随之消失，直到该交互结束。
