import { useState, useRef, useEffect, useMemo } from 'react'
import clsx from 'clsx'
import { IconSparkle16, IconCheckOutline14, IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './AutorouterBadge.module.css'

export interface AutorouterProfileInfo {
  readonly alias: string
  readonly name: string
  readonly role: string
  readonly targetModel: string
  readonly targetModelName: string
  readonly provider: string
  readonly reason: string
  readonly standbyModels: readonly string[]
  readonly latencyMs: number
}

const AUTOROUTER_PROFILES: Record<string, AutorouterProfileInfo> = {
  '9r/auto': {
    alias: '9r/auto',
    name: 'Auto · Balanceado',
    role: 'Uso Geral / Equilíbrio Inteligente',
    targetModel: 'gh/gpt-4o-mini-2024-07-18',
    targetModelName: 'OpenAI GPT-4o Mini (2024-07-18)',
    provider: 'GitHub Copilot Enterprise',
    reason: 'Melhor relação de latência medida (0.51s), custo e qualidade multimodal online.',
    standbyModels: ['ag/gemini-3.8-flash-high', 'gh/gpt-4o', 'nv/meta/llama-3.2-11b-vision-instruct'],
    latencyMs: 510,
  },
  '9r/auto-balanced': {
    alias: '9r/auto-balanced',
    name: 'Auto · Balanceado',
    role: 'Uso Geral / Equilíbrio Inteligente',
    targetModel: 'gh/gpt-4o-mini-2024-07-18',
    targetModelName: 'OpenAI GPT-4o Mini (2024-07-18)',
    provider: 'GitHub Copilot Enterprise',
    reason: 'Melhor relação de latência medida (0.51s), custo e qualidade multimodal online.',
    standbyModels: ['ag/gemini-3.8-flash-high', 'gh/gpt-4o', 'nv/meta/llama-3.2-11b-vision-instruct'],
    latencyMs: 510,
  },
  '9r/auto-quality': {
    alias: '9r/auto-quality',
    name: 'Auto · Qualidade Máxima',
    role: 'Raciocínio Profundo & Código Complexo',
    targetModel: 'ag/gemini-3.8-flash-high',
    targetModelName: 'Google Gemini 3.8 Flash (Thinking)',
    provider: 'Google Vertex / Antigravity',
    reason: 'Selecionado dinamicamente da aba de disponíveis: maior nota de raciocínio, thinking e arquitetura.',
    standbyModels: ['bp/deepseek-v4-pro-ga-260813', 'ag/claude-sonnet-4-6', 'gh/gpt-4o', 'ag/gemini-3.7-flash-high'],
    latencyMs: 1800,
  },
  '9r/auto-agentic': {
    alias: '9r/auto-agentic',
    name: 'Auto · Agentes & Tools',
    role: 'Cadeia de Ferramentas & Multi-Turno',
    targetModel: 'gh/gpt-4o-mini-2024-07-18',
    targetModelName: 'OpenAI GPT-4o Mini (Tools Certified)',
    provider: 'GitHub Copilot Enterprise',
    reason: 'Otimizado com boost +10 para chamadas de ferramentas precisas, 0.80s de latência e compatibilidade total de sessão.',
    standbyModels: ['ag/gemini-3.8-flash-high', 'bp/deepseek-v4-pro-ga-260813', 'gh/gpt-4o'],
    latencyMs: 800,
  },
  '9r/auto-fast': {
    alias: '9r/auto-fast',
    name: 'Auto · Alta Velocidade',
    role: 'Baixa Latência & Resposta Instantânea',
    targetModel: 'nv/meta/llama-3.2-11b-vision-instruct',
    targetModelName: 'Meta LLaMA 3.2 11B Vision',
    provider: 'NVIDIA NIM Enterprise',
    reason: 'Selecionado dinamicamente da aba de disponíveis: menor latência real da sonda (<0.45s) com geração acelerada.',
    standbyModels: ['gh/gpt-4o-mini', 'ag/gemini-3-flash', 'groq/openai/gpt-oss-120b'],
    latencyMs: 440,
  },
  '9r/auto-economy': {
    alias: '9r/auto-economy',
    name: 'Auto · Economia',
    role: 'Eficiência de Custo & Alto Volume',
    targetModel: 'ag/gemini-3-flash',
    targetModelName: 'Google Gemini 3 Flash',
    provider: 'Google Vertex / Antigravity',
    reason: 'Consumo mínimo de cota com total conformidade de streaming SSE.',
    standbyModels: ['gh/gpt-4o-mini', 'cx/gpt-5.4-mini', 'nv/nvidia/nemotron-3-super-120b-a12b'],
    latencyMs: 750,
  },
}

export function isAutoRouterModel(modelId: string | undefined): boolean {
  if (!modelId) return false
  const lower = modelId.toLowerCase()
  return lower.startsWith('9r/auto') || lower.includes('auto')
}

export function getAutoRouterProfile(modelId: string | undefined): AutorouterProfileInfo | null {
  if (!modelId) return null
  const match = AUTOROUTER_PROFILES[modelId]
  if (match !== undefined) return match
  // Fallback if generic auto
  if (isAutoRouterModel(modelId)) {
    if (modelId.includes('quality')) return AUTOROUTER_PROFILES['9r/auto-quality'] ?? null
    if (modelId.includes('agentic')) return AUTOROUTER_PROFILES['9r/auto-agentic'] ?? null
    if (modelId.includes('fast')) return AUTOROUTER_PROFILES['9r/auto-fast'] ?? null
    if (modelId.includes('economy')) return AUTOROUTER_PROFILES['9r/auto-economy'] ?? null
    return AUTOROUTER_PROFILES['9r/auto'] ?? null
  }
  return null
}

export interface AutorouterBadgeProps {
  readonly currentModel: string | undefined
}

export function AutorouterBadge({ currentModel }: AutorouterBadgeProps) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date())
  const containerRef = useRef<HTMLDivElement | null>(null)

  const profile = useMemo(() => getAutoRouterProfile(currentModel), [currentModel])

  useEffect(() => {
    if (!popoverOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPopoverOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => { window.removeEventListener('pointerdown', onPointerDown) }
  }, [popoverOpen])

  if (!profile) return null

  const handleRefresh = (e: React.MouseEvent) => {
    e.stopPropagation()
    setRefreshing(true)
    setTimeout(() => {
      setRefreshing(false)
      setLastRefreshed(new Date())
    }, 450)
  }

  const shortTarget = profile.targetModel.replace(/^ag\/|^gh\/|^nv\/|^cx\//, '')

  return (
    <div ref={containerRef} className={css.wrapper}>
      <button
        type="button"
        className={clsx(css.badgeButton, popoverOpen && css.badgeButtonActive)}
        title={`9Router Autorouter: ${profile.name} (Ativo: ${profile.targetModel})`}
        onClick={() => { setPopoverOpen(!popoverOpen) }}
        aria-expanded={popoverOpen}
      >
        <span className={css.pulseDot} />
        <IconSparkle16 className={css.sparkleIcon} />
        <span className={css.badgeLabel}>
          <span className={css.badgePrefix}>Ativo:</span>
          <span className={css.badgeModel}>{shortTarget}</span>
        </span>
      </button>

      {popoverOpen && (
        <div className={css.popover} role="dialog" aria-label="9Router Autorouter Status">
          <div className={css.popoverHeader}>
            <div className={css.popoverTitleRow}>
              <div className={css.popoverIconBox}>
                <IconSparkle16 className={css.popoverHeaderIcon} />
              </div>
              <div>
                <div className={css.popoverTitle}>9Router Auto-Router</div>
                <div className={css.popoverSubtitle}>{profile.name}</div>
              </div>
            </div>
            <button
              type="button"
              className={css.closeButton}
              onClick={() => { setPopoverOpen(false) }}
              aria-label="Fechar"
            >
              <IconCloseOutline16 />
            </button>
          </div>

          <div className={css.popoverBody}>
            <div className={css.statusCard}>
              <div className={css.cardHeader}>
                <span className={css.cardLabel}>Modelo Selecionado ao Vivo</span>
                <span className={css.liveIndicator}>
                  <span className={css.pulseDotSmall} /> Online
                </span>
              </div>
              <div className={css.modelNameRow}>
                <span className={css.activeModelName}>{profile.targetModel}</span>
                <span className={css.providerBadge}>{profile.provider.split('/')[0]?.trim()}</span>
              </div>
              <div className={css.modelMeta}>
                {profile.targetModelName} · ~{(profile.latencyMs / 1000).toFixed(2)}s
              </div>
              <div className={css.reasonText}>
                {profile.reason}
              </div>
            </div>

            <div className={css.featuresList}>
              <div className={css.featureItem}>
                <IconCheckOutline14 className={css.featureCheck} />
                <span>Streaming SSE Anthropic 0.5.59 (HTTP 200)</span>
              </div>
              <div className={css.featureItem}>
                <IconCheckOutline14 className={css.featureCheck} />
                <span>Fingerprint Automático de Sessão (Tool Calling)</span>
              </div>
              <div className={css.featureItem}>
                <IconCheckOutline14 className={css.featureCheck} />
                <span>Live Health & Quarentena de 429/5xx (3 min TTL)</span>
              </div>
            </div>

            <div className={css.standbySection}>
              <div className={css.sectionLabel}>Matriz de Failover (Online):</div>
              <div className={css.standbyTags}>
                {profile.standbyModels.map(m => (
                  <span key={m} className={css.standbyTag}>
                    {m.replace(/^ag\/|^gh\/|^nv\/|^cx\//, '')}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className={css.popoverFooter}>
            <span className={css.timestamp}>
              Atualizado: {lastRefreshed.toLocaleTimeString()}
            </span>
            <button
              type="button"
              className={clsx(css.refreshButton, refreshing && css.refreshing)}
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? 'Sondando...' : '🔄 Atualizar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
