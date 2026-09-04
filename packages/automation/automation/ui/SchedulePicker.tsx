import React, { useState } from 'react'
import { TaskScheduleType } from '../src/types'

export interface SchedulePickerValue {
  scheduleType: TaskScheduleType
  scheduleExpr: string
  timezone: string
  maxRuns: number | null
  endAt: Date | null
}

export interface SchedulePickerProps {
  initialValue?: Partial<SchedulePickerValue>
  onChange: (value: SchedulePickerValue) => void
}

export const SchedulePicker: React.FC<SchedulePickerProps> = ({ initialValue, onChange }) => {
  const [mode, setMode] = useState<'ONCE' | 'DAILY' | 'WEEKLY' | 'INTERVAL' | 'EXPERT'>('WEEKLY')
  const [time, setTime] = useState('09:00')
  const [selectedDays, setSelectedDays] = useState<number[]>([1]) // 1 = Monday
  const [intervalHours, setIntervalHours] = useState(2)
  const [singleDate, setSingleDate] = useState('')
  const [cronInput, setCronInput] = useState('0 9 * * 1')
  const [isIndefinite, setIsIndefinite] = useState(true)
  const [maxRunsCount, setMaxRunsCount] = useState<number | ''>('')

  const weekDays = [
    { label: 'Seg', val: 1 },
    { label: 'Ter', val: 2 },
    { label: 'Qua', val: 3 },
    { label: 'Qui', val: 4 },
    { label: 'Sex', val: 5 },
    { label: 'Sáb', val: 6 },
    { label: 'Dom', val: 0 },
  ]

  const emitChange = (type: TaskScheduleType, expr: string) => {
    onChange({
      scheduleType: type,
      scheduleExpr: expr,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
      maxRuns: isIndefinite ? null : Number(maxRunsCount) || null,
      endAt: null,
    })
  }

  const handleDayToggle = (day: number) => {
    const updated = selectedDays.includes(day)
      ? selectedDays.filter(d => d !== day)
      : [...selectedDays, day]
    setSelectedDays(updated)

    const [hour, minute] = time.split(':')
    const cron = `${minute} ${hour} * * ${updated.join(',')}`
    emitChange('CRON', cron)
  }

  return (
    <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-5 text-slate-100 font-sans">
      <div className="border-b border-slate-800 pb-3">
        <h3 className="text-base font-semibold text-slate-100">Regra de Agendamento e Frequência</h3>
        <p className="text-xs text-slate-400 mt-0.5">
          Configure a periodicidade de execução da sua tarefa automatizada.
        </p>
      </div>

      {/* Mode Switcher */}
      <div className="flex flex-wrap gap-2">
        {(['ONCE', 'DAILY', 'WEEKLY', 'INTERVAL', 'EXPERT'] as const).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m)
              if (m === 'DAILY') {
                const [h, min] = time.split(':')
                emitChange('CRON', `${min} ${h} * * *`)
              } else if (m === 'INTERVAL') {
                emitChange('INTERVAL', (intervalHours * 3600).toString())
              }
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              mode === m
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
            }`}
          >
            {m === 'ONCE' && 'Execução Única'}
            {m === 'DAILY' && 'Diariamente'}
            {m === 'WEEKLY' && 'Dias da Semana'}
            {m === 'INTERVAL' && 'Por Intervalo'}
            {m === 'EXPERT' && 'Expressão Cron'}
          </button>
        ))}
      </div>

      {/* Mode-specific Fields */}
      {mode === 'ONCE' && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-slate-300">Data e Horário do Disparo</label>
          <input
            type="datetime-local"
            value={singleDate}
            onChange={(e) => {
              setSingleDate(e.target.value)
              if (e.target.value) {
                emitChange('ONCE', new Date(e.target.value).toISOString())
              }
            }}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
          />
        </div>
      )}

      {mode === 'DAILY' && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-slate-300">Horário de Execução Diária</label>
          <input
            type="time"
            value={time}
            onChange={(e) => {
              setTime(e.target.value)
              const [h, m] = e.target.value.split(':')
              emitChange('CRON', `${m} ${h} * * *`)
            }}
            className="bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
          />
        </div>
      )}

      {mode === 'WEEKLY' && (
        <div className="space-y-3">
          <label className="text-xs font-medium text-slate-300">Dias da Semana</label>
          <div className="flex gap-2">
            {weekDays.map(d => (
              <button
                key={d.val}
                type="button"
                onClick={() => handleDayToggle(d.val)}
                className={`w-10 h-10 rounded-lg text-xs font-semibold transition ${
                  selectedDays.includes(d.val)
                    ? 'bg-blue-600 text-white shadow'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>

          <div className="space-y-1 pt-2">
            <label className="text-xs font-medium text-slate-300">Horário</label>
            <input
              type="time"
              value={time}
              onChange={(e) => {
                setTime(e.target.value)
                const [h, m] = e.target.value.split(':')
                emitChange('CRON', `${m} ${h} * * ${selectedDays.join(',')}`)
              }}
              className="bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      )}

      {mode === 'INTERVAL' && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-slate-300">Repetir a cada (horas)</label>
          <input
            type="number"
            min="1"
            value={intervalHours}
            onChange={(e) => {
              const val = Number(e.target.value) || 1
              setIntervalHours(val)
              emitChange('INTERVAL', (val * 3600).toString())
            }}
            className="w-32 bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
          />
        </div>
      )}

      {mode === 'EXPERT' && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-slate-300">Expressão Cron Padrão</label>
          <input
            type="text"
            value={cronInput}
            placeholder="* * * * *"
            onChange={(e) => {
              setCronInput(e.target.value)
              emitChange('CRON', e.target.value)
            }}
            className="w-full font-mono bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
          />
        </div>
      )}

      {/* Recurrence Termination Controls */}
      <div className="pt-4 border-t border-slate-800 space-y-3">
        <label className="text-xs font-medium text-slate-300">Condição de Término</label>
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="radio"
              name="term_condition"
              checked={isIndefinite}
              onChange={() => setIsIndefinite(true)}
              className="accent-blue-600"
            />
            Por período indeterminado
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="radio"
              name="term_condition"
              checked={!isIndefinite}
              onChange={() => setIsIndefinite(false)}
              className="accent-blue-600"
            />
            Limitar a N execuções
          </label>
        </div>

        {!isIndefinite && (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              placeholder="Ex: 5"
              value={maxRunsCount}
              onChange={e => setMaxRunsCount(e.target.value ? Number(e.target.value) : '')}
              className="w-28 bg-slate-950 border border-slate-700 rounded-lg p-2 text-sm text-slate-100"
            />
            <span className="text-xs text-slate-400">execuções totais</span>
          </div>
        )}
      </div>
    </div>
  )
}
