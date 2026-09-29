---
description: "面向模型的 jev_decide 工具：通过 TypeSafe AI System One API 返回带校准置信度的类型化决策"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-jev

[English](README.md) | 中文

## 摘要

`jev_decide` 调用 TypeSafe AI（Jev）System One API，针对一个 state 评估一组类型化问题，并返回带概率分布与校准置信度的结构化答案。每个问题只做一次边界清晰的判断——从命名选项中 `choice`、按评分标准 `score`、或对命题真伪做 `noul` 判定；多个问题在同一次调用中并行评估。请在代码中组合各因子，而不是把多个因素挤进一个问题。

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
| `model` | `jev-latest` | System One 模型 id。 |
| `timeoutMs` | `15000` | 单次调用的协作式超时预算。 |

API 密钥在执行时从 `TYPESAFE_API_KEY` 环境变量读取；绝不进入 config、工具参数或日志。密钥缺失会让调用以结构化错误失败，而不是悄悄禁用工具。

## 模型体验

工具描述教给模型“一问一判”的规则与并行评估方式。答案以单个 JSON 对象返回，包含每个问题的概率与置信度；模型应把低置信度答案视为不确定，而不是盲目执行。

## 延伸阅读

- [TypeSafe AI 文档](https://docs.typesafe.ai/) — 原语、置信度语义与模式。
- [`packages/web/tool-web`](../tool-web/README.zh.md) — 本包遵循其 schema 与呈现约定的姊妹 HTTP 工具。

## 开发说明

值 schema DSL 支持属性映射与类型化取值，但不支持按键映射 schema，因此 `questions` 以 `{ name, type, instructions, criteria }` 数组形式传入，由 `parseJevArgs` 补足 DSL 无法表达的约束：非空 state、名称唯一、按原语校验 criteria、问题列表非空。响应的 `answers` 对象以 `answersJson`（无损字符串化 JSON）返回，使工具的规范化取值保持在输出 DSL 要求的无损 JSON 子集之内。
