/** Automation panel dictionaries (the conversation-header automations action). */

/** Locale namespace owned by the automation panel. */
export const NS = 'automation'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  trigger: '自动化',
  'dialog.aria': '自动化',
  'refresh.aria': '刷新自动化列表',
  refresh: '刷新',
  loading: '正在加载自动化…',
  empty: '没有找到自动化任务。',
  'next.none': '没有下一次执行',
  'run.aria': '立即执行：{title}',
  run: '立即执行',
  'resume.aria': '恢复：{title}',
  resume: '恢复',
  'pause.aria': '暂停：{title}',
  pause: '暂停',
} satisfies Record<string, string>

/** The automation namespace key union. */
export type AutomationKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The automation panel's copy. */
    automation: AutomationKey
  }
}

/**
 * Deployment dictionary for the `en` seat. This fork ships the Lakatoss
 * interface in Brazilian Portuguese under `en`, like the other Lakatoss
 * header plugins (ui-workspace), so the strings here are pt-BR on purpose.
 * Checked complete against the zh key set.
 */
export const en = {
  trigger: 'Automações',
  'dialog.aria': 'Automações',
  'refresh.aria': 'Atualizar automações',
  refresh: 'Atualizar',
  loading: 'Carregando automações…',
  empty: 'Nenhuma automação encontrada.',
  'next.none': 'Sem próxima execução',
  'run.aria': 'Executar agora: {title}',
  run: 'Executar agora',
  'resume.aria': 'Retomar: {title}',
  resume: 'Retomar',
  'pause.aria': 'Pausar: {title}',
  pause: 'Pausar',
} satisfies Record<AutomationKey, string>
