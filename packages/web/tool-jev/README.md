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
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>

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
| `model` | `jev-latest` | Fallback API model when the call has no non-blank override. |
| `timeoutMs` | `15000` | Cooperative timeout budget per call. |

The API key is read from the `TYPESAFE_API_KEY` environment variable at execution time; it never rides config, tool arguments, or logs. A missing key fails the call with a structured error instead of silently disabling the tool.

<a id="understand-the-implementation"></a>

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The value-schema DSL supports property maps and typed values but not per-key map schemas, so `questions` arrives as an array of `{ name, type, instructions, criteria }` rows and `parseJevArgs` enforces the constraints the DSL cannot express: non-blank state, unique names, primitive-specific criteria, and a non-empty question list. The response `answers` object is returned as `answersJson` (lossless stringified JSON) so the tool's canonical value stays inside the lossless JSON subset the output DSL enforces.

</details>

<a id="further-exploration"></a>

## Further Exploration

- [TypeSafe AI docs](https://docs.typesafe.ai/) — primitives, confidence semantics, and patterns.
- [`packages/web/tool-web`](../tool-web/README.md) — the sibling HTTP tool whose schema and presentation conventions this package follows.

<a id="model-experience"></a>

## Model Experience

### Tool schema

#### What the model sees

The generated [`jev_decide` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-jev) exposes `state`, `questions`, and an optional `model`. Its description asks for one judgment per question and permits several questions in one call.

#### Token effect

The registered schema adds a fixed request cost while the tool is enabled. Disabling the tool removes that schema.

#### KV Cache effect

The schema remains prefix-stable while its definition and visibility are unchanged. Changing visibility changes the request from the schema section onward.

### Call arguments

#### What the model sees

The model supplies `state` and named `choice`, `score`, or `noul` questions. A non-blank `model` argument selects the API model after trimming. Otherwise the request uses the trimmed configured `model`, or `jev-latest` when that configuration is blank.

#### Token effect

The call retains the state and question text in tool-call history. The separate HTTP request does not add a second copy to the model context.

#### KV Cache effect

The call appends its arguments after the existing request prefix; it does not rewrite earlier context.

### Tool result

#### What the model sees

The tool renders JSON-fenced text containing `model`, `answersJson`, and `usage`. The `answersJson` value is a JSON string containing the API's answer map, including its probabilities and confidence values.

#### Token effect

The retained result adds the serialized answer map and usage metadata to subsequent requests until compaction removes them.

#### KV Cache effect

The result appends after the preceding context and preserves that prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These constraints define when callers need deployment configuration or their own decision policy.

- Calls require `TYPESAFE_API_KEY` and an available external System One endpoint. The package supplies no retry or alternate API provider.
- The timeout is cooperative: execution passes its abort signal to `fetch`; the tool registry owns when cancellation is requested.
- HTTP redirects are rejected, including redirects to the same origin. Configure the final endpoint URL because the package does not follow a redirect.
- Probabilities and confidence values come from the API response. The package does not independently verify a decision or choose an acceptance threshold.

<a id="dev-note"></a>

### Dev Note

None.
