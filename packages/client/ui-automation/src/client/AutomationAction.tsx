/** Native browser panel for persistent Host automations. */

import { useCallback, useState } from 'react'
import type { AutomationActionProps, AutomationTaskView } from './types.ts'

export type { AutomationActionProps } from './types.ts'

/** Render a Host-owned task list and its existing safe controls. */
export function AutomationAction({ list, trigger, pause, resume }: AutomationActionProps) {
  const [open, setOpen] = useState(false)
  const [tasks, setTasks] = useState<readonly AutomationTaskView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setTasks(await list())
      setError(null)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [list])

  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    try {
      await operation()
      await refresh()
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <div data-automation-action>
      <button type="button" aria-expanded={open} onClick={() => {
        const next = !open
        setOpen(next)
        if (next) void refresh()
      }}>Automações</button>
      {open && (
        <section role="dialog" aria-label="Automações">
          <button type="button" aria-label="Atualizar automações" onClick={() => { void refresh() }}>Atualizar</button>
          {error !== null && <p role="alert">{error}</p>}
          {loading && tasks.length === 0 && <p>Carregando automações…</p>}
          {!loading && tasks.length === 0 && <p>Nenhuma automação encontrada.</p>}
          <ul>
            {tasks.map(task => (
              <li key={task.id}>
                <strong>{task.title}</strong>
                <span>{task.status}</span>
                <span>{task.nextRunAt ?? 'Sem próxima execução'}</span>
                <button type="button" aria-label={`Executar agora: ${task.title}`} onClick={() => { void run(() => trigger(task.id)) }}>Executar agora</button>
                {task.status === 'PAUSED'
                  ? <button type="button" aria-label={`Retomar: ${task.title}`} onClick={() => { void run(() => resume(task.id)) }}>Retomar</button>
                  : <button type="button" aria-label={`Pausar: ${task.title}`} onClick={() => { void run(() => pause(task.id)) }}>Pausar</button>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
