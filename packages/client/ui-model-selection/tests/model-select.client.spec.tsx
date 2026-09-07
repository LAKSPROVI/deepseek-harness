// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ComponentProps } from 'react'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import { zh } from '../src/client/locales.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { recordModelUsage } from '../src/client/usage.ts'

// The seat's key domain is model ∪ common; the stub mirrors the real lookup
// chain: package dictionary, then common vocabulary, then the key.
const t: ComponentProps<typeof ModelSelect>['t'] = (key, params) => {
  const template = (zh as Record<string, string>)[key]
    ?? (commonZh as Record<string, string>)[key]
    ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const reasoning = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max', description: 'Largest budget' },
  ],
  defaultEffort: 'high',
}

function state(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  const current = overrides.current === undefined
    ? { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
    : overrides.current
  const groups = overrides.groups ?? [{
    id: 'deepseek-official',
    name: 'DeepSeek',
    models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning }],
  }]
  const currentModel = overrides.currentModel !== undefined
    ? overrides.currentModel
    : current === null
      ? null
      : groups.find(group => group.id === current.provider)?.models.find(model => model.id === current.model) ?? null
  return {
    current,
    currentModel,
    routable: true,
    groups,
    failures: [],
    status: 'ready',
    error: null,
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('ModelSelect reasoning effort', () => {
  it('renders adapter metadata and submits the effort as part of the session selection', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection }))
      return true
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', {
      name: '选择模型，当前 DeepSeek-V4-Flash，推理等级 High',
    })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['Off', 'High', 'MaxLargest budget'])

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Max/ }))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'max',
      })
      expect(trigger.getAttribute('aria-label')).toBe('选择模型，当前 DeepSeek-V4-Flash，推理等级 Max')
    })
  })

  it('offers provider default only when the adapter does not configure a model default', () => {
    const directory = createSnapshotStore(state({
      groups: [{
        id: 'provider',
        name: 'Provider',
        models: [{
          id: 'model',
          name: 'Model',
          reasoning: { efforts: [{ id: 'standard', name: 'Standard' }] },
        }],
      }],
      current: { provider: 'provider', model: 'model' },
    }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', {
      name: '选择模型，当前 Model，推理等级 Default',
    }))
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['Default', 'Standard'])
  })

  it('prompts for a selection when the current model is no longer advertised', () => {
    const directory = createSnapshotStore(state({
      current: { provider: 'deepseek-official', model: 'removed-model' },
    }))
    const select = vi.fn().mockResolvedValue(true)
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: '选择模型' })
    expect(trigger.textContent).toContain('选择模型')
    fireEvent.click(trigger)
    expect(screen.queryByRole('menuitem', { name: /推理等级/ })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    expect(screen.queryByText('removed-model')).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })).toBeTruthy()
  })

  it('announces a rejected selection as a transient toast and keeps the in-menu strip for loads', async () => {
    const groups = [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      ],
    }]
    const directory = createSnapshotStore<ModelDirectoryState>(state({ groups }))
    const select = vi.fn(async () => {
      directory.set(state({ groups, status: 'error', error: 'model-unavailable: session already contains images' }))
      return false
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /选择模型|当前/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ }))
    const toast = await screen.findByRole('alert')
    expect(toast.textContent).toContain('模型操作失败：model-unavailable: session already contains images')
    // The selection failure does not render the in-menu load strip (no Retry).
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })

  it('renders no Agent-bound control for an addressed subagent session', () => {
    const load = vi.fn()
    render(<ModelSelect
      locked={false}
      available={false}
      directory={createSnapshotStore(state())}
      load={load}
      select={vi.fn().mockResolvedValue(false)}
      t={t}
    />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('filters models dynamically based on search query', () => {
    const groups = [
      {
        id: 'deepseek-official',
        name: 'DeepSeek',
        models: [
          { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' },
          { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', description: 'Advanced coding model' },
        ],
      },
      {
        id: 'openai',
        name: 'OpenAI',
        models: [
          { id: 'gpt-5', name: 'GPT-5', description: 'Flagship reasoning' },
          { id: 'gpt-5-mini', name: 'GPT-5-Mini' },
        ],
      },
    ]
    const directory = createSnapshotStore(state({ groups }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))

    const searchInput = screen.getByRole('textbox', { name: '搜索模型…' })
    expect(searchInput).toBeTruthy()

    // Initially all 4 models are visible
    expect(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Flash/ })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: /^GPT-5(?!-Mini)/ })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: /GPT-5-Mini/ })).toBeTruthy()

    // Filter by "coding" (matches description of DeepSeek-V4-Pro)
    fireEvent.change(searchInput, { target: { value: 'coding' } })
    expect(screen.queryByRole('menuitemradio', { name: /DeepSeek-V4-Flash/ })).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ })).toBeTruthy()
    expect(screen.queryByRole('menuitemradio', { name: /^GPT-5(?!-Mini)/ })).toBeNull()

    // Filter by "gpt"
    fireEvent.change(searchInput, { target: { value: 'gpt' } })
    expect(screen.queryByRole('menuitemradio', { name: /DeepSeek-V4-Flash/ })).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: /^GPT-5(?!-Mini)/ })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: /GPT-5-Mini/ })).toBeTruthy()

    // Filter with no match
    fireEvent.change(searchInput, { target: { value: 'nonexistent-xyz' } })
    expect(screen.getByText('未找到匹配的模型。')).toBeTruthy()

    // Clear search with clear button
    const clearBtn = screen.getByRole('button', { name: '清除搜索' })
    fireEvent.click(clearBtn)
    expect(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Flash/ })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: /^GPT-5(?!-Mini)/ })).toBeTruthy()
  })

  it('selects top matching model on Enter key in search box', async () => {
    const groups = [
      {
        id: 'deepseek-official',
        name: 'DeepSeek',
        models: [
          { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' },
          { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
        ],
      },
    ]
    const select = vi.fn().mockResolvedValue(true)
    const directory = createSnapshotStore(state({ groups }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))

    const searchInput = screen.getByRole('textbox', { name: '搜索模型…' })
    fireEvent.change(searchInput, { target: { value: 'pro' } })
    fireEvent.keyDown(searchInput, { key: 'Enter' })

    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({
        provider: 'deepseek-official',
        model: 'deepseek-v4-pro',
      })
    })
  })

  it('renders frequently used models section at the beginning', async () => {
    recordModelUsage('openai', 'gpt-5')
    recordModelUsage('openai', 'gpt-5')

    const groups = [
      {
        id: 'deepseek-official',
        name: 'DeepSeek',
        models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' }],
      },
      {
        id: 'openai',
        name: 'OpenAI',
        models: [{ id: 'gpt-5', name: 'GPT-5' }],
      },
    ]
    const select = vi.fn().mockResolvedValue(true)
    const directory = createSnapshotStore(state({ groups }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))

    // Frequent models group is visible
    expect(screen.getByText('常用模型')).toBeTruthy()

    // Clicking the frequent model triggers select
    const frequentOption = screen.getByTitle('GPT-5 (OpenAI)')
    fireEvent.click(frequentOption)

    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({
        provider: 'openai',
        model: 'gpt-5',
      })
    })
  })
})
