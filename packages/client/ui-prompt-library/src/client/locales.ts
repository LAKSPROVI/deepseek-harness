/** Prompt-library settings, launcher, and overlay copy. */

/** Client locale namespace. */
export const NS = 'promptLibrary'

/** Simplified Chinese dictionary (key-set source of truth). */
export const zh = {
  'nav': '提示词库',
  'launcher.label': '提示词库',
  'overlay.search': '搜索已保存的提示词',
  'overlay.empty': '没有匹配的提示词。',
  'overlay.unavailable': '此连接无法持久保存提示词。',
  'settings.title': '提示词库',
  'settings.description': '保存常用提示词，并在输入框中按需插入。选择提示词不会发送消息。',
  'settings.unavailable': '此浏览器正在使用远程或内存设置；提示词持久化不可用。',
  'settings.loading': '正在加载提示词…',
  'settings.empty': '还没有保存提示词。',
  'action.add': '添加提示词',
  'action.edit': '编辑',
  'action.delete': '删除',
  'action.save': '保存',
  'action.cancel': '取消',
  'field.title': '标题',
  'field.body': '提示词内容',
  'warning.slash': '此内容以“/”开头；插入后可能被识别为斜杠命令。',
  'error.count': '最多可保存 {count} 条提示词。',
  'error.title': '标题不能为空，且不能超过 {count} 个字符。',
  'error.body': '内容不能为空，且不能超过 {count} 个字符。',
  'error.aggregate': '提示词库总计不能超过 {count} 个字符。',
  'error.save': '保存失败。请重新加载设置后再试。',
  'count': '{used}/{max}',
} satisfies Record<string, string>

/** Prompt-library dictionary key union. */
export type PromptLibraryKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Prompt-library settings and composer copy. */
    promptLibrary: PromptLibraryKey
  }
}

/** English dictionary, checked complete against the Chinese key set. */
export const en = {
  'nav': 'Prompt library',
  'launcher.label': 'Prompt library',
  'overlay.search': 'Search saved prompts',
  'overlay.empty': 'No prompts match your search.',
  'overlay.unavailable': 'This connection cannot persist prompts.',
  'settings.title': 'Prompt library',
  'settings.description': 'Save reusable prompts and insert them into the composer. Selecting a prompt never sends it.',
  'settings.unavailable': 'This browser is using remote or memory settings; prompt persistence is unavailable.',
  'settings.loading': 'Loading prompts…',
  'settings.empty': 'No prompts have been saved yet.',
  'action.add': 'Add prompt',
  'action.edit': 'Edit',
  'action.delete': 'Delete',
  'action.save': 'Save',
  'action.cancel': 'Cancel',
  'field.title': 'Title',
  'field.body': 'Prompt body',
  'warning.slash': 'This body starts with “/” and may be recognized as a slash command after insertion.',
  'error.count': 'You can save at most {count} prompts.',
  'error.title': 'The title must be non-blank and no longer than {count} characters.',
  'error.body': 'The body must be non-blank and no longer than {count} characters.',
  'error.aggregate': 'The prompt library may contain at most {count} characters in total.',
  'error.save': 'The prompt could not be saved. Reload settings and try again.',
  'count': '{used}/{max}',
} satisfies Record<PromptLibraryKey, string>
