import { describe, expect, it } from 'vitest'
import { normalizeAria } from './scaffold.ts'

describe('Web ARIA workspace paths', () => {
  it('preserves closing JSON quote escapes after a known native path', () => {
    const cwd = 'C:\\tmp\\dsh-web-ws-unique'
    const snapshot = String.raw`- cell "{\"file_path\":\"C:\\tmp\\dsh-web-ws-unique\\a.txt\"}"`
    expect(normalizeAria(snapshot, cwd, false))
      .toBe(String.raw`- cell "{\"file_path\":\"{{cwd}}/a.txt\"}"`)
  })
  it('normalizes a Windows workspace basename and native file preview root', () => {
    expect(normalizeAria('- text: C:\\tmp\\dsh-web-ws-unique\\a.txt\n- treeitem "Untitled dsh-web-ws-unique"', 'C:\\tmp\\dsh-web-ws-unique', false))
      .toBe('- text: {{cwd}}/a.txt\n- treeitem "Untitled {{workspace}}"')
  })

  it('normalizes the exact JSON-escaped Windows root while preserving tool content', () => {
    const cwd = 'C:\\tmp\\dsh-web-ws-unique'
    const snapshot = `- cell 'read{"file_path":"nav-a.md"} → <path>${cwd.replaceAll('\\', '\\\\')}/workspace/nav-a.md</path> <content> 1: alpha </content>'`
    expect(normalizeAria(snapshot, cwd, false))
      .toBe('- cell \'read{"file_path":"nav-a.md"} → <path>{{cwd}}/workspace/nav-a.md</path> <content> 1: alpha </content>\'')
  })

  it('keeps POSIX file names, tool arguments and unrelated host paths intact', () => {
    const snapshot = '- cell "<path>/tmp/dsh-web-ws-unique/workspace/nav-a.md</path> {\\"file_path\\":\\"nav-a.md\\"} C:\\other\\a.txt"'
    expect(normalizeAria(snapshot, '/tmp/dsh-web-ws-unique', false))
      .toBe('- cell "<path>{{cwd}}/workspace/nav-a.md</path> {\\"file_path\\":\\"nav-a.md\\"} C:\\other\\a.txt"')
  })

  it('resolves explicit escaped home and fixture roots before the enclosing workspace', () => {
    const cwd = 'C:\\tmp\\dsh-web-ws-unique'
    const home = `${cwd}\\.dsh-home`
    const fixtures = `${cwd}\\fixture-packages`
    const snapshot = `- status: ${`${home}\\profiles\\scaffold`.replaceAll('\\', '\\\\')}\n- code: file:${fixtures}\\fixture-bundle`
    expect(normalizeAria(snapshot, cwd, false, [[home, '{{home}}'], [fixtures, '{{fixtures}}']]))
      .toBe('- status: {{home}}/profiles/scaffold\n- code: file:{{fixtures}}/fixture-bundle')
  })

  it('preserves escaped arguments and unrelated native paths while aliasing explicit roots', () => {
    const cwd = 'C:\\tmp\\dsh-web-ws-unique'
    const home = `${cwd}\\.dsh-home`
    const snapshot = `- cell: {"command":"echo \\\\n","file_path":"C:\\\\other\\\\a.txt"}\n- text: ${home}\\profiles\\scaffold`
    expect(normalizeAria(snapshot, cwd, false, [[home, '{{home}}']]))
      .toBe('- cell: {"command":"echo \\\\n","file_path":"C:\\\\other\\\\a.txt"}\n- text: {{home}}/profiles/scaffold')
  })
})
