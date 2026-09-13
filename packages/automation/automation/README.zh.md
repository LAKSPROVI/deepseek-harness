---
description: "任务自动化引擎：周期调度器、执行 worker、崩溃恢复 reaper、原子文件存储、SSE 流与 Web GUI 集成。"
kind: "package-reference"
---

# @deepseek-ai/dsh-automation

[English](README.md) | 中文

## 概述

企业级任务自动化引擎、复杂周期调度器、并发执行监督器、崩溃恢复守护进程、实时 Server-Sent Events（SSE）通知流，以及 Cordis Web GUI 动态集成。

-----

## 目录

- [架构概览](#architecture-overview)
- [核心能力](#core-capabilities)
- [DeepSeek Harness Cordis 集成](#deepseek-harness-dynamic-cordis-integration)
- [验证与测试](#verification-tests)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="architecture-overview"></a>
## 架构概览

`@deepseek-ai/dsh-automation` 提供一条健壮、零依赖的任务调度与执行流水线，面向关键例行任务设计：

```
                  ┌────────────────────────────────────────────────────────┐
                  │                 User / Chat / Web GUI                  │
                  └───────────┬────────────────────────────────┬───────────┘
                              │                                │
                [Natural Language via Tools]        [REST API / Web UI]
                              │                                │
                              ▼                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           Automation Engine                              │
│                                                                          │
│  ┌──────────────────────┐   ┌───────────────────┐   ┌─────────────────┐  │
│  │   RecurrenceEngine   │   │  AutomationStore  │   │ StaleTaskReaper │  │
│  │ (SimpleCron / RRULE) │   │ (Atomic Disk/Mem) │   │ (Crash Recovery)│  │
│  └──────────┬───────────┘   └─────────┬─────────┘   └────────┬────────┘  │
│             │                         │                      │           │
│             └────────────────┐        │        ┌─────────────┘           │
│                              ▼        ▼        ▼                         │
│                     ┌─────────────────────────────────┐                  │
│                     │       AutomationScheduler       │                  │
│                     │    (Atomic polling & locking)   │                  │
│                     └────────────────┬────────────────┘                  │
│                                      │                                   │
│                                      ▼                                   │
│                     ┌─────────────────────────────────┐                  │
│                     │           TaskWorker            │                  │
│                     │  (Run isolation, timeout guard) │                  │
│                     └────────────────┬────────────────┘                  │
│                                      │                                   │
│                                      ▼                                   │
│                     ┌─────────────────────────────────┐                  │
│                     │       NotificationService       │                  │
│                     │    (Pub/Sub, Run context, SSE)  │                  │
│                     └────────────────┬────────────────┘                  │
└──────────────────────────────────────┼───────────────────────────────────┘
                                       │
                                       ▼
                       [Real-Time SSE Stream & Web UI]
```


-----

<a id="core-capabilities"></a>
## 核心能力

### 2.1 调度与周期引擎（`src/recurrence.ts`、`src/cron.ts`）
- **`ONCE`**：在指定的未来 ISO-8601 时间戳单次执行。
- **`INTERVAL`**：每 $N$ 秒周期执行（例如 `3600` 表示 1 小时，`300` 表示 5 分钟）。
- **`CRON`**：纯 UTC、零依赖的 5 段 cron 解析器（`SimpleCron`），支持标准范围、列表、步长与通配符（`min hour dom month dow`）。
- **`RRULE`**：带完整 IANA 时区转换的周期规则（`America/Sao_Paulo`、`UTC` 等）。
- **终止边界**：通过 `maxRuns` 限定次数，或通过 `endAt` 设定过期；省略时为无限周期。

### 2.2 执行监督与韧性（`src/worker.ts`、`src/reaper.ts`）
- **执行生命周期**：离散的 `TaskRun` 实体，跟踪 `QUEUED` $	o$ `RUNNING` $	o$ `SUCCESS` / `FAILED` / `TIMED_OUT`。
- **重叠保护**：可配置的重叠策略（`SKIP` 阻止重叠运行、`ALLOW` 或 `QUEUE`）。
- **超时守卫**：按任务的执行超时，例行任务挂起时强制取消并记录失败。
- **结构化执行日志**：内存与持久化环形缓冲区，记录日志级别（`info`、`warn`、`error`）及 ISO 时间戳。
- **崩溃恢复守护进程（`StaleTaskReaper`）**：周期性扫描因 Host 崩溃而滞留在 `RUNNING` 状态的任务，释放锁，将运行标记为 `TIMED_OUT`/`FAILED`，并提醒用户。

### 2.3 持久化层（`src/persistence.ts`、`src/store.ts`）
- **原子文件存储（`FileAutomationStore`）**：
  - 线程安全的写队列锁（`writeLock`）。
  - 通过临时文件（`.tmp`）暂存，再以原子文件系统重命名（`fs.rename`）落盘。
  - 意外断电或进程被杀时，JSON 文件零损坏风险。

### 2.4 通知与实时传输（`src/notifier.ts`、`src/sse.ts`、`src/api.ts`）
- **任务运行上下文**：每条通知携带 `taskId`、`runId`、时间戳、已读状态与结构化元数据。
- **SSE 流（`AutomationSseStreamer`）**：原生 Server-Sent Events 传输，向活跃浏览器客户端即时广播运行事件与告警。
- **REST API 路由（`AutomationApiRouter`）**：
  - `GET /tasks`：列出所有任务及其状态与周期详情。
  - `POST /tasks`：创建/调度新任务。
  - `DELETE /tasks/:id`：删除现有任务。
  - `POST /tasks/:id/trigger`：立即按需触发执行。
  - `POST /tasks/:id/pause` / `POST /tasks/:id/resume`：暂停或恢复调度。
  - `GET /tasks/:id/runs`：查看历史执行运行与日志。
  - `GET /notifications`：获取未读/全部通知。
  - `POST /notifications/read-all`：将所有通知标记为已读。
  - `GET /sse`：将浏览器客户端连接到实时事件流。

-----

<a id="deepseek-harness-dynamic-cordis-integration"></a>
## DeepSeek Harness Cordis 集成

`AutomationService`（`ctx.automation`，[`src/service.ts`](src/service.ts)）是 Web profile 加载的 Cordis 入口。它根据配置中的 `storePath`（相对路径或 `~` 路径解析到 Harness home 即 `DSH_HOME` 之下，绝不解析到进程 cwd）组合存储、通知器、worker、调度器与 reaper，在 `enabled` 为 true 时把调度和滞留运行恢复作为一个 effect 启动，并发布 `automations` Typert Remote 命名空间，含四个方法：`list`、`trigger`、`pause`、`resume`。所有权在启动时固定（`userId`，默认 `host`）；浏览器从不提供身份，存在但属于其他所有者的任务以 `automation/not-found` 应答。

[`@deepseek-ai/dsh-experimental-client-ui-automation`](../../experimental/client-ui-automation/README.zh.md) 挂载该命名空间，并把列表与控件渲染为会话 header 动作。`AutomationApiRouter` 与 `AutomationSseStreamer` 仍是库导出：Cordis 服务不会把它们挂到 `ctx.webServer`，需要 REST 路由或实时流的嵌入方自行接到自己的 HTTP 服务器。面向模型的一侧位于两个同级包：[`tool-automation`](../tool-automation/README.zh.md)（preset 挂载的 `automation_*` 工具）与 [`automation-prompt-action`](../automation-prompt-action/README.zh.md)（host 平面的 `CUSTOM_PROMPT` 执行器）。

-----

<a id="verification-tests"></a>
## 验证与测试

运行本包的测试套件：

```bash
npx vitest run packages/automation/automation/tests
```

包含的套件：
- `tests/recurrence.spec.ts`：cron 表达式、间隔与最大运行次数计算的单元测试。
- `tests/automation.spec.ts`：端到端任务执行、调度周期与通知投递。
- `tests/advanced.spec.ts`：超时守卫、重叠跳过策略与滞留任务 reaper 恢复。
- `tests/persistence_api.spec.ts`：原子磁盘持久化、REST API 路由处理器与 SSE 流。
- `tests/remote-service.spec.ts`：Cordis 服务、其 `automations` Remote 命名空间与所有权失败。

<a id="model-experience"></a>
## 模型体验

无：引擎不注册任何 tool、prompt 段或会话事件；运行输出只有通过部署方注册的动作处理器才会到达模型。

#### KV Cache 影响

与任何模型请求无关：本包不会把任务记录或运行日志放入请求，因此既不构建也不失效任何可复用前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **没有创建/删除的 Remote 方法** — `automations` 命名空间只暴露 `list`、`trigger`、`pause` 与 `resume`；任务通过 [`@deepseek-ai/dsh-tool-automation`](../tool-automation/README.zh.md) 的 `automation_*` 工具、嵌入方挂载的 `AutomationApiRouter`，或直接经存储 API 进入存储。
- **REST 路由与 SSE 流不由 Cordis 服务挂载** — 它们是库导出；Web profile 只暴露 Remote 命名空间。
- **只随附一个执行器** — [`@deepseek-ai/dsh-automation-prompt-action`](../automation-prompt-action/README.zh.md) 处理 `CUSTOM_PROMPT`；其他 `actionType` 需要部署方通过 `TaskWorker.registerHandler` 注册处理器，没有处理器的运行会被记录为失败。
- **只有一个配置所有者** — `AutomationController` 只服务 Host 配置的 `userId`；多用户隔离尚未实现。
- **`RRULE` 支持限于引擎解析的子集** — 不是完整的 RFC 5545 解析器；不支持的规则在计算下次运行时会失败而不是静默近似。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

不发布运行时不变量伴生包：引擎的持久状态位于 `$DSH_HOME/data/automation` 下的文件存储中，调度器、worker 与 reaper 仅通过持久化测试覆盖的 `IAutomationStore` 契约修改它；Cordis 接缝不发布任何可供宿主侧安装器观察的会话事件流。
