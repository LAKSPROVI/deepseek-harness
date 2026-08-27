# transcription/ — transcription capability family

English | [中文](README.zh.md)

This family turns one recorded audio utterance into text, and exposes that operation to the browser's microphone button.

| Package | Role | ctx key |
|---|---|---|
| [`transcription/`](transcription/README.md) | Defines provider registration, selection, the audio-byte ceiling, and shared errors | `ctx.transcription` |
| [`transcription-groq/`](transcription-groq/README.md) | Provides transcription through Groq's Whisper endpoint | registers on `ctx.transcription` |
| [`voice-input/`](voice-input/README.md) | Exposes one transcription call to the browser over Typert Remote | `ctx.voiceInput` |

Audio is transient throughout the family: the bytes exist for the duration of one call, and no package writes them to the session log or to durable storage. Only the transcript becomes model-visible, and only once the human sends the composer draft it was written into — which the ordinary user-message path already logs.

Transcription runs on the Host because the provider credential lives there. The browser captures the utterance and uploads it base64-encoded over the existing RPC gateway, so a headless deployment reaches the same seam with the same ceiling and the same provider selection.
