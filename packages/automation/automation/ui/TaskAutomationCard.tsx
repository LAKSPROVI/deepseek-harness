import React, { useState } from 'react'
import { AutomationTask, TaskRun, TaskNotification } from '../src/types'

export interface TaskAutomationCardProps {
  task: AutomationTask
  latestNotification?: TaskNotification
  runs: TaskRun[]
  onTriggerNow?: (taskId: string) => void
  onTogglePause?: (taskId: string) => void
  onNotificationDismiss?: (notificationId: string) => void
}

export const TaskAutomationCard: React.FC<TaskAutomationCardProps> = ({
  task,
  latestNotification,
  runs,
  onTriggerNow,
  onTogglePause,
  onNotificationDismiss,
}) => {
  const [showRuns, setShowRuns] = useState(false)

  const isPaused = task.status === 'PAUSED'
  const isCompleted = task.status === 'COMPLETED'

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 text-slate-100 font-sans shadow-lg">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h4 className="text-base font-bold text-white">{task.title}</h4>
          {task.description && (
            <p className="text-xs text-slate-400 mt-0.5">{task.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
            <span>
              Tipo: <strong className="text-slate-200">{task.scheduleType}</strong>
            </span>
            <span>•</span>
            <span>
              Próxima execução:{' '}
              <strong className="text-blue-400 font-mono">
                {task.nextRunAt ? new Date(task.nextRunAt).toLocaleString() : 'Nenhuma (Finalizado)'}
              </strong>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${
              task.status === 'ACTIVE'
                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                : isPaused
                  ? 'bg-amber-950 text-amber-400 border border-amber-800'
                  : isCompleted
                    ? 'bg-blue-950 text-blue-400 border border-blue-800'
                    : 'bg-slate-800 text-slate-400'
            }`}
          >
            {task.status}
          </span>
        </div>
      </div>

      {/* Latest Notification Context Banner */}
      {latestNotification && (
        <div
          className={`p-3.5 rounded-lg border text-xs flex items-start gap-3 transition ${
            latestNotification.level === 'SUCCESS'
              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
              : latestNotification.level === 'ERROR'
                ? 'bg-rose-950/40 border-rose-800/60 text-rose-200'
                : 'bg-blue-950/40 border-blue-800/60 text-blue-200'
          }`}
        >
          <div
            className={`w-2.5 h-2.5 rounded-full mt-1 shrink-0 ${
              latestNotification.level === 'SUCCESS'
                ? 'bg-emerald-400 animate-pulse'
                : latestNotification.level === 'ERROR'
                  ? 'bg-rose-400'
                  : 'bg-blue-400'
            }`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white">{latestNotification.title}</span>
              <span className="text-[10px] text-slate-400">
                {new Date(latestNotification.createdAt).toLocaleTimeString()}
              </span>
            </div>
            <p className="mt-1 text-slate-300 leading-relaxed">{latestNotification.message}</p>
          </div>
          {onNotificationDismiss && (
            <button
              onClick={() => onNotificationDismiss(latestNotification.id)}
              className="text-slate-400 hover:text-white text-xs px-1"
              title="Marcar como lida"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* Actions and Summary Bar */}
      <div className="flex items-center justify-between pt-3 border-t border-slate-800 text-xs text-slate-400">
        <div className="flex items-center gap-4">
          <span>
            Total Concluído: <strong className="text-slate-200">{task.totalRunsCompleted}</strong>
            {task.maxRuns ? ` / ${task.maxRuns}` : ' (Indeterminado)'}
          </span>
          <button
            type="button"
            onClick={() => setShowRuns(!showRuns)}
            className="text-blue-400 hover:underline font-medium"
          >
            {showRuns ? 'Ocultar Histórico' : `Histórico (${runs.length} execuções)`}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {onTogglePause && !isCompleted && (
            <button
              type="button"
              onClick={() => onTogglePause(task.id)}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs transition"
            >
              {isPaused ? 'Retomar' : 'Pausar'}
            </button>
          )}
          {onTriggerNow && (
            <button
              type="button"
              onClick={() => onTriggerNow(task.id)}
              className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium transition"
            >
              Executar Agora
            </button>
          )}
        </div>
      </div>

      {/* Expanded Runs History */}
      {showRuns && (
        <div className="space-y-2 mt-3 pt-3 border-t border-slate-800/80">
          <h5 className="text-xs font-semibold text-slate-300">Histórico de Execuções</h5>
          {runs.length === 0 ? (
            <p className="text-xs text-slate-500 italic py-2">Nenhuma execução registrada ainda.</p>
          ) : (
            <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
              {runs.map(r => (
                <div
                  key={r.id}
                  className="p-2.5 bg-slate-950/80 rounded-lg border border-slate-800/80 flex flex-col gap-1.5 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-blue-400 font-bold">#{r.runNumber}</span>
                      <span className="text-slate-400">
                        {new Date(r.scheduledFor).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.durationMs !== undefined && (
                        <span className="text-slate-400 font-mono">
                          {(r.durationMs / 1000).toFixed(2)}s
                        </span>
                      )}
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          r.status === 'SUCCESS'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : r.status === 'FAILED'
                              ? 'bg-rose-950 text-rose-300 border border-rose-800'
                              : r.status === 'RUNNING'
                                ? 'bg-amber-950 text-amber-300 border border-amber-800 animate-pulse'
                                : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {r.status}
                      </span>
                    </div>
                  </div>

                  {/* Error display if failed */}
                  {r.errorMessage && (
                    <div className="text-[11px] text-rose-400 bg-rose-950/30 p-1.5 rounded border border-rose-900/50">
                      {r.errorMessage}
                    </div>
                  )}

                  {/* Logs snippet */}
                  {r.executionLogs && r.executionLogs.length > 0 && (
                    <div className="text-[10px] text-slate-500 font-mono line-clamp-2">
                      {r.executionLogs[r.executionLogs.length - 1].message}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
