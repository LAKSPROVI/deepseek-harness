---
description: "Model-facing jev_decide tool: typed decisions with calibrated confidence from the TypeSafe AI System One API"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-jev

English | [中文](README.zh.md)

## Summary

`jev_decide` asks the TypeSafe AI (Jev) System One API to evaluate typed questions about a state and returns structured answers with probabilities and calibrated confidence. Each question is one well-scoped judgment — a `choice` from named options, a `score` on a rubric, or a `noul` truth assessment; several questions are evaluated in parallel in one call. Combine factors in code instead of writing one compound question.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

Compose the tool when the model should make or consult machine-native decisions: routing, ranking, extraction, verification, and any step where an LLM prompt-and-parse round could become one structured decision. The tool is concurrency-safe (API reads never mutate agent state) and carries a cooperative per-call timeout budget.

### Configuration

```yaml
- id: tool-jev
  name: '@deepseek-ai/dsh-tool-jev'
  config:
    enabled: true
    apiUrl: 'https://api.typesafe.ai/v1/systemone'
    model: 'jev-latest'
    timeoutMs: 15000
```

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Register the tool. |
| `apiUrl` | `https://api.typesafe.ai/v1/systemone` | System One endpoint. |
| `model` | `jev-latest` | System One model id. |
| `timeoutMs` | `15000` | Cooperative timeout budget per call. |

The API key is read from the `TYPESAFE_API_KEY` environment variable at execution time; it never rides config, tool arguments, or logs. A missing key fails the call with a structured error instead of silently disabling the tool.

## Further Exploration

- [TypeSafe AI docs](https://docs.typesafe.ai/) — primitives, confidence semantics, and patterns.
- [`packages/web/tool-web`](../tool-web/README.md) — the sibling HTTP tool whose schema and presentation conventions this package follows.

## Model Experience

### jev_decide description

#### What the model sees

The `jev_decide` tool description teaches the one-judgment-per-question rule and parallel evaluation: the model sends a state plus atomic questions (`choice` from named options, `score` on a rubric, `noul` truth assessment) and weighs the returned probabilities and confidence. Answers arrive as one JSON object with per-question probabilities and calibrated confidence; the model is expected to treat low-confidence answers as uncertain rather than act on them blindly.

#### Token effect

One tool call carries the state and the question list; the answer set arrives as one fenced JSON block inside the tool result. Question text lives in the tool-call arguments, never in a prompt prefix.

#### KV Cache effect

Tool calls and results are session events outside any model request prefix; nothing this package emits builds or invalidates a reusable provider prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Per-key map schemas are outside the value-schema DSL** — `questions` arrives as an array of `{ name, type, instructions, criteria }` rows and `parseJevArgs` enforces the constraints the DSL cannot express: non-blank state, unique names, primitive-specific criteria, and a non-empty question list. The response `answers` object is returned as `answersJson` — lossless stringified JSON — so the tool's canonical value stays inside the lossless JSON subset the output DSL enforces.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

No runtime invariant companion is published because each `jev_decide` call is a self-contained HTTP round trip to the TypeSafe AI service: the tool owns no durable event stream and no package-local mutable runtime data, and its argument validation, timeout, and error-mapping behavior is pinned by the package spec.
