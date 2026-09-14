/** `voiceInput` namespace dictionaries (the push-to-talk composer control's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'button.idle': '按住说话',
  'button.recording': '松开发送',
  'button.uploading': '正在转写',
  'action.cancel': '取消转写',
  'status.recording': '正在录音，松开按钮结束。',
  'status.uploading': '正在转写录音。',
  'status.inserted': '转写完成，已写入输入框。',
  'status.silent': '没有听到语音，输入框未改动。',
  'status.cancelled': '已取消转写。',
  'error.unsupported': '此浏览器不支持录音。',
  'error.permission': '麦克风被拒绝。请在浏览器的站点权限里允许麦克风，然后重试。',
  'error.recorder': '录音失败，未采集到音频。',
  'error.format': '此浏览器录制的音频格式（{mediaType}）不受支持，未上传。',
  'error.carrier': '转写请求没有完成，请检查连接后重试。',
  'error.audio-empty': '录音为空，请再说一次。',
  'error.audio-undecodable': '音频在上传途中损坏，请重试。',
  'error.audio-too-large': '录音太长（{bytes} 字节），请分成几段较短的录音。',
  'error.provider-unavailable': '转写服务当前不可用，请稍后重试。',
  'error.provider-unconfigured': '本部署尚未配置转写服务的凭据。请先在设置中填入密钥，再使用语音输入。',
  'error.provider-failed': '转写服务拒绝了这次请求，请重试。',
  'error.aborted': '转写在产生结果前中断了。',
} satisfies Record<string, string>

/** The voiceInput namespace key union. */
export type VoiceInputKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The push-to-talk composer control's copy. */
    voiceInput: VoiceInputKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'button.idle': 'Hold to talk',
  'button.recording': 'Release to send',
  'button.uploading': 'Transcribing',
  'action.cancel': 'Cancel transcription',
  'status.recording': 'Recording. Release the button to finish.',
  'status.uploading': 'Transcribing the recording.',
  'status.inserted': 'Transcribed and added to the composer.',
  'status.silent': 'No speech was heard; the composer is unchanged.',
  'status.cancelled': 'Transcription cancelled.',
  'error.unsupported': 'This browser cannot record audio.',
  'error.permission': 'Microphone access was denied. Allow the microphone in your site permissions, then try again.',
  'error.recorder': 'Recording failed; no audio was captured.',
  'error.format': 'This browser recorded an unsupported audio format ({mediaType}); nothing was uploaded.',
  'error.carrier': 'The transcription request did not complete. Check the connection and try again.',
  'error.audio-empty': 'The recording carried no audio. Please say it again.',
  'error.audio-undecodable': 'The audio was corrupted in transit. Please try again.',
  'error.audio-too-large': 'The recording is too long ({bytes} bytes). Please split it into shorter takes.',
  'error.provider-unavailable': 'Transcription is unavailable right now. Please try again later.',
  'error.provider-unconfigured': 'This deployment has no credential configured for transcription. Add the key in settings before using voice input.',
  'error.provider-failed': 'The transcription service refused this request. Please try again.',
  'error.aborted': 'Transcription stopped before it produced a transcript.',
} satisfies Record<VoiceInputKey, string>
