# 任务自动化

[English](automation.md) | 中文

Automation 子系统负责在任何实时对话轮次之外运行的持久化计划任务：基于文件的存储、周期调度器、执行 worker、崩溃恢复 reaper，以及让 Web 面板保持最新的 Server-Sent Events 流。一个由 Host 持有的引擎（`ctx.automation`）持有存储并发布 `automations` Typert Remote 命名空间，因此所有界面读取的是同一份任务记录。[包 README](../../packages/automation/automation/README.zh.md) 负责周期语法、worker 语义、持久化布局与通知行为；[已实现的 Agent Note](../../.agents/notes/implemented/feature/2026-09-10-automation-remote-panel.zh.md) 记录了为何将独立引擎并入 Host。

## 持久化记录

任务包含稳定 id、所有者、显示名、动作描述、可选周期以及生命周期状态（`ACTIVE`、`PAUSED`、`COMPLETED`、`ERROR`、`ARCHIVED`）。每次执行追加一条带日志的 `TaskRun` 记录；reaper 扫描因 Host 崩溃而滞留在 `RUNNING` 的运行并标记为 `TIMED_OUT` 或 `FAILED`，因此重启永远不会继承幽灵锁。所有权在接缝处强制执行：存在但属于其他所有者的任务 id 以 `automation/not-found` 呈现，绝不会出现部分读取。

## Remote 与 Chat 界面

`automations` Remote 命名空间暴露 `list`、`trigger`、`pause` 与 `resume`；`pause` 与 `resume` 返回投影后的 `AutomationTaskView`，`trigger` 返回 `AutomationTriggerReceipt`，使 [`packages/experimental/client-ui-automation`](../../packages/experimental/client-ui-automation/README.zh.md) 中的浏览器面板无需二次读取即可重绘。Cordis 服务不暴露创建与删除任务：`AutomationApiRouter` 与 `AutomationSseStreamer` 是嵌入方挂到自己 HTTP 服务器上的库导出，Chat 工具尚不存在。经任一路径加入的任务落到同一份存储，并在面板下次重载时出现。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxautomation--automationservice"></a>

### `ctx.automation` — `AutomationService`

One Host-owned engine that keeps its store, scheduler, and controls together.

```ts cordis-catalog
/**
 * List the deployment owner's persisted tasks without modifying the store.
 *
 * @returns Persisted automation tasks projected for the browser client.
 */
@Remote('list') async list(): Promise<readonly { readonly id: string readonly title: string readonly description?: string readonly scheduleType: 'ONCE' | 'INTERVAL' | 'CRON' | 'RRULE' readonly status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ERROR' | 'ARCHIVED' readonly nextRunAt: string | null readonly lastRunAt: string | null readonly totalRunsCompleted: number readonly maxRuns: number | null readonly createdAt: string readonly updatedAt: string }[]>

/**
 * Queue one owned task immediately while leaving its recurrence unchanged.
 *
 * @param taskId Persisted automation task identifier.
 * @returns Identifier of the queued automation run.
 */
@Remote('trigger') async trigger(taskId: string): Promise<{ readonly runId: string }>

/**
 * Pause one owned task.
 *
 * @param taskId Persisted automation task identifier.
 * @returns Updated task projected for the browser client.
 */
@Remote('pause') async pause(taskId: string): Promise<{ readonly id: string readonly title: string readonly description?: string readonly scheduleType: 'ONCE' | 'INTERVAL' | 'CRON' | 'RRULE' readonly status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ERROR' | 'ARCHIVED' readonly nextRunAt: string | null readonly lastRunAt: string | null readonly totalRunsCompleted: number readonly maxRuns: number | null readonly createdAt: string readonly updatedAt: string }>

/**
 * Resume one owned task and calculate its next run.
 *
 * @param taskId Persisted automation task identifier.
 * @returns Updated task projected for the browser client.
 */
@Remote('resume') async resume(taskId: string): Promise<{ readonly id: string readonly title: string readonly description?: string readonly scheduleType: 'ONCE' | 'INTERVAL' | 'CRON' | 'RRULE' readonly status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ERROR' | 'ARCHIVED' readonly nextRunAt: string | null readonly lastRunAt: string | null readonly totalRunsCompleted: number readonly maxRuns: number | null readonly createdAt: string readonly updatedAt: string }>

/**
 * Existing Chat-tool entrypoint for a manual run.
 *
 * @param taskId Persisted automation task identifier.
 * @returns Receipt identifying the queued automation run.
 */
async triggerNow(taskId: string): Promise<AutomationTriggerReceipt>

/**
 * Existing Chat-tool entrypoint for a resumed schedule.
 *
 * @param taskId Persisted automation task identifier.
 * @returns Updated automation task view.
 */
async resumeTask(taskId: string): Promise<AutomationTaskView>
```

Source: [`packages/automation/automation/src/service.ts`](../../packages/automation/automation/src/service.ts)
<!-- END GENERATED cordis-surface -->
