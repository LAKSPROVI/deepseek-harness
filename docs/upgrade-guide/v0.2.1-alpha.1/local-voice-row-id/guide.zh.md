---
kind: upgrade-guide
description: "本地 SenseVoice 覆盖配置使用与默认语音输入不同的条目 id。"
---

# 本地语音输入条目重命名

[English](guide.md) | 中文

## 变更

可选的 `@deepseek-ai/dsh-experimental-voice-input-bundle` 现在将浏览器条目声明为 `ui-sensevoice-input`。之前的 `ui-voice-input` id 属于默认 Web 语音输入，使用 Groq 转录。本地浏览器条目的覆盖配置必须使用新 id；语音 Provider id、设置和缓存模型保持不变。

本地 Bundle 可通过显式安装获得，并保留自己的 Remote 命名空间和输入区插槽。默认配置继续使用原生语音输入。

## 迁移

1. 在 `$DSH_HOME/profiles/<name>/cordis.patch.yml` 和所有 `--patch` 覆盖文件中，仅将针对实验性本地浏览器插件的 `id: ui-voice-input` 改为 `id: ui-sensevoice-input`。默认原生插件的覆盖配置仍使用 `ui-voice-input`。
2. 如果该配置需要本地识别，使用 `dsh plugin --profile <name> add @deepseek-ai/dsh-experimental-voice-input-bundle` 显式安装 Bundle。
3. 确认插件管理页显示本地 Bundle、其组件和准备控件。本地 Provider 的覆盖配置仍针对 `speech-to-text-sensevoice`。
