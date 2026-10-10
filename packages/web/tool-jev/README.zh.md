---
description: "面向模型的 jev_decide 工具：通过 TypeSafe AI System One API 返回带校准置信度的类型化决策"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-jev

[English](README.md) | 中文

## 概述

`jev_decide` 调用 TypeSafe AI（Jev）System One API，针对一个 state 评估一组类型化问题，并返回带概率分布与校准置信度的结构化答案。每个问题只做一次边界清晰的判断——从命名选项中 `choice`、按评分标准 `score`、或对命题真伪做 `noul` 判定；多个问题在同一次调用中并行评估。请在代码中组合各因子，而不是把多个因素挤进一个问题。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用本包

当模型需要做出或查询机器原生决策时组合本工具：路由、排序、抽取、核验，以及任何原本要用“LLM 提示词+解析”往返完成的步骤。工具并发安全（API 读取不改变 agent 状态），并为每次调用附带协作式超时预算。

### 配置

```yaml
- id: tool-jev
  name: '@deepseek-ai/dsh-tool-jev'
  config:
    enabled: true
    apiUrl: 'https://api.typesafe.ai/v1/systemone'
    model: 'jev-latest'
    timeoutMs: 15000
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 注册工具。 |
| `apiUrl` | `https://api.typesafe.ai/v1/systemone` | System One 端点。 |
| `model` | `jev-latest` | 调用没有非空白覆盖值时使用的备用 API 模型。 |
| `timeoutMs` | `15000` | 单次调用的协作式超时预算。 |

API 密钥在执行时从 `TYPESAFE_API_KEY` 环境变量读取；绝不进入 config、工具参数或日志。密钥缺失会让调用以结构化错误失败，而不是悄悄禁用工具。

<a id="understand-the-implementation"></a>

## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

值 schema DSL 支持属性映射与类型化取值，但不支持按键映射 schema，因此 `questions` 以 `{ name, type, instructions, criteria }` 数组形式传入，由 `parseJevArgs` 补足 DSL 无法表达的约束：非空 state、名称唯一、按原语校验 criteria、问题列表非空。响应的 `answers` 对象以 `answersJson`（无损字符串化 JSON）返回，使工具的规范化取值保持在输出 DSL 要求的无损 JSON 子集之内。

</details>

<a id="further-exploration"></a>

## 延伸阅读

- [TypeSafe AI 文档](https://docs.typesafe.ai/) — 原语、置信度语义与模式。
- [`packages/web/tool-web`](../tool-web/README.zh.md) — 本包遵循其 schema 与呈现约定的姊妹 HTTP 工具。

<a id="model-experience"></a>

## 模型体验

### 工具 schema

#### 模型看到什么

生成的 [`jev_decide` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-jev) 暴露 `state`、`questions` 和可选的 `model`。工具描述要求每个问题只做一次判断，并允许在一次调用中提交多个问题。

#### Token 影响

工具启用时，注册的 schema 会增加固定的请求开销。禁用工具会移除该 schema。

#### KV Cache 影响

定义与可见性不变时，schema 前缀保持稳定。改变可见性会从 schema 区段开始改变请求。

### 调用参数

#### 模型看到什么

模型提供 `state` 和具名的 `choice`、`score` 或 `noul` 问题。非空白的 `model` 参数经去除首尾空白后选择 API 模型。否则请求使用去除首尾空白后的配置 `model`；该配置为空白时使用 `jev-latest`。

#### Token 影响

调用会在工具调用历史中保留 state 与问题文本。独立的 HTTP 请求不会在模型上下文中增加第二份副本。

#### KV Cache 影响

调用把参数追加在现有请求前缀之后，不会改写更早的上下文。

### 工具结果

#### 模型看到什么

工具渲染包含 `model`、`answersJson` 和 `usage` 的 JSON 围栏文本。`answersJson` 的值是一个 JSON 字符串，包含 API 的答案映射及其概率与置信度值。

#### Token 影响

保留的结果会把序列化答案映射和用量元数据加入后续请求，直到压缩移除它们。

#### KV Cache 影响

结果追加在前面的上下文之后，并保留该前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

这些约束说明调用者何时需要部署配置或自己的决策策略。

- 调用需要 `TYPESAFE_API_KEY` 和可用的外部 System One 端点。本包不提供重试或替代 API 提供者。
- 超时采用协作式取消：执行把 abort signal 传给 `fetch`，由工具注册表决定何时请求取消。
- 工具拒绝 HTTP 重定向，包括同源重定向。请配置最终端点 URL，因为本包不会跟随重定向。
- 概率与置信度值来自 API 响应。本包不会独立核验决策，也不会选择接受阈值。

<a id="dev-note"></a>

### 开发备注

无。
