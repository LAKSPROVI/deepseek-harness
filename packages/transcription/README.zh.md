# transcription/：转写能力家族

[English](README.md) | 中文

本家族将一段录制的语音转为文本，并把该操作暴露给浏览器的麦克风按钮。

| 包 | 职责 | ctx key |
|---|---|---|
| [`transcription/`](transcription/README.zh.md) | 定义提供方注册、选择、音频字节上限和共享错误 | `ctx.transcription` |
| [`transcription-groq/`](transcription-groq/README.zh.md) | 通过 Groq 的 Whisper 端点提供转写 | 注册到 `ctx.transcription` |
| [`voice-input/`](voice-input/README.zh.md) | 通过 Typert Remote 向浏览器暴露一次转写调用 | `ctx.voiceInput` |

音频在本家族中始终是临时数据：字节仅在一次调用期间存在，任何包都不会将其写入会话日志或持久存储。只有转写文本会成为模型可见内容，且仅当人类发送写入了该文本的输入框草稿之后——这条路径由既有的用户消息流程负责记录。

转写在 Host 侧执行，因为提供方凭据位于该侧。浏览器采集语音并以 base64 编码通过既有的 RPC 网关上传，因此无界面部署经由同一 seam、同一上限和同一提供方选择完成转写。
