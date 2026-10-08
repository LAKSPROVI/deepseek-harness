---
kind: upgrade-guide
description: "Local SenseVoice overrides use a separate row id from the shipped voice input."
---

# Local voice input row renamed

English | [中文](guide.zh.md)

## Change

The optional `@deepseek-ai/dsh-experimental-voice-input-bundle` now declares its browser row as `ui-sensevoice-input`. Its previous `ui-voice-input` id belongs to the shipped Web voice input, which uses Groq transcription. Overrides targeting the local browser row must use its new id; the speech provider ids, settings and cached models remain unchanged.

The local bundle is available through explicit installation and keeps its own Remote namespace and composer slot. Shipped profile defaults continue to use the native voice input.

## Migration

1. In `$DSH_HOME/profiles/<name>/cordis.patch.yml` and any `--patch` overlays, change `id: ui-voice-input` to `id: ui-sensevoice-input` only for overrides intended for the experimental local browser plugin. Keep overrides for the shipped native plugin on `ui-voice-input`.
2. If this profile needs local recognition, install the bundle explicitly with `dsh plugin --profile <name> add @deepseek-ai/dsh-experimental-voice-input-bundle`.
3. Confirm that the Plugins page lists the local bundle with its components and preparation controls. Local provider overrides still target `speech-to-text-sensevoice`.
