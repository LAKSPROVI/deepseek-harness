// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutorouterBadge, isAutoRouterModel, getAutoRouterProfile } from '../src/client/AutorouterBadge.tsx'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('AutorouterBadge', () => {
  it('correctly identifies auto router models', () => {
    expect(isAutoRouterModel('9r/auto')).toBe(true)
    expect(isAutoRouterModel('9r/auto-quality')).toBe(true)
    expect(isAutoRouterModel('9r/auto-agentic')).toBe(true)
    expect(isAutoRouterModel('9r/auto-fast')).toBe(true)
    expect(isAutoRouterModel('9r/auto-economy')).toBe(true)
    expect(isAutoRouterModel('deepseek-chat')).toBe(false)
    expect(isAutoRouterModel(undefined)).toBe(false)
  })

  it('maps profile metadata accurately', () => {
    const quality = getAutoRouterProfile('9r/auto-quality')
    expect(quality).not.toBeNull()
    expect(quality?.targetModel).toBe('ag/gemini-3.7-flash-high')
    expect(quality?.name).toBe('Auto · Qualidade Máxima')

    const fast = getAutoRouterProfile('9r/auto-fast')
    expect(fast).not.toBeNull()
    expect(fast?.targetModel).toBe('ag/gemini-3-flash')
  })

  it('renders badge for auto router model and toggles popover details on click', () => {
    const { container } = render(<AutorouterBadge currentModel="9r/auto-quality" />)

    // Check badge label
    const button = screen.getByRole('button', { name: /Ativo:.*gemini-3.7-flash-high/i })
    expect(button).toBeDefined()
    expect(container.textContent).toContain('gemini-3.7-flash-high')

    // Click to open popover
    fireEvent.click(button)
    expect(screen.getByRole('dialog', { name: /9Router Autorouter Status/i })).toBeDefined()
    expect(container.textContent).toContain('Google Gemini 3.7 Flash (Thinking)')
    expect(container.textContent).toContain('Matriz de Failover')

    // Close button
    const closeBtn = screen.getByRole('button', { name: /Fechar/i })
    fireEvent.click(closeBtn)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders nothing for non-auto models', () => {
    const { container } = render(<AutorouterBadge currentModel="deepseek-chat" />)
    expect(container.firstChild).toBeNull()
  })
})
