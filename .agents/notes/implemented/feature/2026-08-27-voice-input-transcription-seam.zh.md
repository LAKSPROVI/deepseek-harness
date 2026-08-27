# Agent Note: Voice input as a transcription capability seam

Status: implemented

[English](2026-08-27-voice-input-transcription-seam.md) | 中文

## Problem

本 harness 目前只接受键入的文本。口述一项任务比键入更快，而语音正是人们表达冗长、非结构化指令时已经在用的输入方式——也正是今天以大段键入形式到达的那类请求。

语音转文本也无法按添加一个 UI 部件的方式添加。转写凭据属于部署方，而不属于某个浏览器标签页；音频是二进制大块数据，而 harness 的 RPC 线路承载 JSON；并且人的录音是本产品搬运过的最敏感载荷。一个直接连到厂商端点的麦克风按钮会把密钥放进浏览器，把产品绑死在单一厂商上，并让无界面部署完全得不到转写能力。

## Decision

转写是一个具备全部三种角色的能力 seam，浏览器是它的一个 Consumer，而不是该操作的所有者。

| 包 | 角色 | 注册内容 |
|---|---|---|
| `dsh-transcription` | Service Definition | `ctx.transcription` |
| `dsh-transcription-groq` | Service Provider | 注册到 `ctx.transcription` 的提供方 |
| `dsh-voice-input` | Consumer（Host 侧） | `voiceInput` Typert Remote 命名空间 |
| `dsh-client-ui-voice-input` | Consumer（浏览器侧） | `conversation.input.left` 中的一个条目 |

### 转写策略全部归 seam 所有

`ctx.transcription` 拥有提供方注册、运行时提供方选择、音频字节上限和转写文本裁剪。Consumer 只补充自身传输方式强加给它的那一点。正是这一点让无界面部署与浏览器获得完全一致的行为：任何一方都无法放宽另一方执行的边界，因为边界不在任何一方手里。

上限是一个受校验的 `maxAudioBytes` 配置字段，默认取 Groq 端点接受的 25 MiB。边界在任何提供方派发之前按解码后的字节长度检查，因此超限上传绝不会触达网络。

### 音频在 Host 侧处理，且始终是临时数据

提供方凭据位于 Host 侧，因此转写请求在该侧发出。浏览器采集一段语音并上传；Host 回以文本。

音频字节仅在一次调用期间存在，且不会在任何位置成为持久数据：没有会话事件、没有日志行、没有缓存、没有 spill 文件、没有回显该载荷的诊断信息。只有转写文本会进入会话，且仅当人类发送了写入该文本的输入框草稿之后——这条路径由既有的用户消息流程负责记录。这也正是本功能无需新增会话事件即可满足「模型可见即已记录」规则的原因：在转写文本成为一条普通的键入消息之前，它并非模型可见；而到那一刻，既有事件已经承载了它。

`packages/transcription/AGENTS.md` 为该家族写明了临时性规则与重定向规则，因为这两者都是该家族未来的包可能在无声无息中破坏的性质。

### 音频以 base64 走既有 RPC

Typert RPC 线路只走 JSON：每次调用一个普通对象 `args` 字段，没有二进制通道。因此音频以 base64 编码置于普通请求内传输，与图片附件抵达 Host 的既有方式一致。代价是 4/3 的体积膨胀，在配置的上限下由 300 MiB 的默认请求体预算吸收。

浏览器按 0x8000 字节分块编码。把音频大小的缓冲区展开进 `String.fromCharCode` 会超出参数个数上限并抛错，因此分块循环是必需的，而非防御性的。Host 在解码前按规范 base64 模式校验上传内容，因为 `Buffer.from` 会静默跳过字母表之外的字符——否则损坏的上传会解码成看似合理的音频，并在提供方深处以一条不透明的消息失败。

### 失败是值，故障是异常

`voiceInput/transcribe` 回以一个封闭的业务联合类型：`audio-empty`、`audio-undecodable`、`audio-too-large`、`provider-unavailable`、`provider-unconfigured`、`provider-failed`、`aborted`。其中每一项都是用户可据以行动的结果，因此各自是一个值，并在浏览器侧拥有各自的文案。基础设施故障则被重新抛出，因为它是缺陷而非结果。

浏览器读取两层信封：生成的 Remote 面为每次调用包裹的承载层 `RemoteResult`，以及其中的业务联合类型。承载层失败被折叠进该信封而不是拒绝 promise，因此调用方无需包裹调用来恢复传输错误。承载层自身的失败码是开放字符串且面向运维；用户则对所有传输结果读到同一条连接提示。

### 提供方拒绝重定向

Groq 请求设置 `redirect: 'error'`。携带凭据的请求若跟随重定向，就会把音频交给响应所指定的任意源，而这里的音频是一个人的录音。Node 的 `fetch` 会在跨源时剥离 `authorization`，但会转发请求体，因此泄漏的是载荷；回归测试对全部五种重定向状态码证明重定向目标绝不会被联系。

## Alternatives considered

**用 Web Speech API 在浏览器内转写。** 它不需要密钥、不需要上传、不需要 Host 侧工作。它同时也因浏览器而异地不可用或被静默路由至厂商，对带口音的语音和技术术语产出明显更差的文本，并且对无界面部署毫无帮助。seam 为每种客户端形态保留同一条转写路径。

**从浏览器直接把音频发给厂商。** 这样可以省掉 base64 环节和 Host 往返。它同时把转写凭据放进浏览器标签页——任何页面脚本和任何扩展都能读到它——并使该厂商成为浏览器包的硬依赖。凭据留在 Host 侧。

**为音频新增一条二进制 RPC 通道。** 专用上传路径可以避开 4/3 膨胀。它同时为一个功能引入第二种传输方式，带来各自的分帧、信任边界和请求体限制规则，而既有的 JSON 路径已经在承载同等大小的图片附件。膨胀是负担得起的；第二条线路不是。

**记录音频，或将其作为附件存储。** 这会带来可重放性，并让用户重新收听。它同时把产品中最敏感的载荷变成持久数据，而当前没有任何需求提出该要求，也没有任何保留策略覆盖它。只有转写文本会持久化。

**把转写文本作为已发送消息插入。** 那样说话本身就构成完整一轮。它同时剥夺了人类纠正误转写的机会，并会在没有普通用户手势的情况下使转写结果成为模型可见内容。转写文本落入草稿，由人类发送。

**把上限和提供方选择放在浏览器 Consumer 里。** 浏览器本可以在上传前拒绝超限录音，并给出更友好的错误。但那样它就拥有了一条 Host 同样执行的边界，两者会逐渐漂移。边界归 seam；浏览器只报告 Host 的裁决。

## Consequences

harness 在 web GUI 上获得语音输入，而无界面或 ACP 部署则经由 `ctx.transcription` 获得同一转写操作，完全不涉及浏览器。新增第二个提供方是一个注册到该 seam 的新包，两个 Consumer 都无需改动。

4/3 的 base64 膨胀是长期成本：提高 `maxAudioBytes` 的部署必须确认其请求体预算仍能覆盖膨胀后的上传，否则请求会在触达 seam 之前即被拒绝。

没有流式转写。一次调用承载一段完整语音，因此长录音在结束前不会产出部分文本，也不会有任何反馈。中间结果需要一个 RPC 层尚不具备的流式 Remote 操作。

口语语言未被声明。seam 接受语言提示而浏览器不发送，因为 UI 语言不能作为说话人所用语言的证据；改由提供方自动检测。

ACP 保持无音频：它拒绝音频提示内容，并声明 `promptCapabilities.audio: false`。本功能是构造上仅限 web，而非因遗漏而如此。

组装后的行为由 [`packages/transcription/voice-input/tests/loader-composition.spec.ts`](../../../../packages/transcription/voice-input/tests/loader-composition.spec.ts) 证明：它经由 Loader 从一份仅用于测试的 `cordis.yml` 启动全部三个 Host 包，且只替换 Groq 的 HTTP 端点。有两个行为只在那里显现：在 `provider` 中指名却从未挂载的提供方不构成加载失败，因为选择是按调用解析的；而已挂载但不持有凭据的提供方回答 `provider-unconfigured` 而非 `provider-unavailable`，因为 `available()` 报告的是凭据引用。释放提供方的 fiber 会清空注册表，而 seam 仍继续服务。
