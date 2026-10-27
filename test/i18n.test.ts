import { describe, expect, it } from 'vitest'
import { availableLocales, initSystemLocale, knownLocales, locale, missingKeys, permissionDisplayName, resolveSystemLocale, setLocale, t } from '../src/i18n.ts'

describe('i18n', () => {
  it('interpolates params and leaves unknown placeholders intact', () => {
    expect(t('notice.todos', { done: '2', total: '5' })).toBe('· todos 2/5 done (/todo)')
    expect(t('welcome.title', { version: '9.9.9' })).toContain('v9.9.9')
    expect(t('notice.cwdChange')).toBe('· cwd → {cwd}')
    expect(t('notice.presetChange', { preset: 'ptc' })).toContain('ptc')
  })

  it('falls back to the key for unknown ids', () => {
    expect(t('not.a.key')).toBe('not.a.key')
  })

  it('switches between shipped tables and rejects unknown codes', () => {
    expect(setLocale('zh')).toBe(true)
    expect(locale()).toBe('zh')
    expect(setLocale('xx')).toBe(false)
    expect(setLocale('en')).toBe(true)
    expect(locale()).toBe('en')
  })

  it('resolves the system locale to a shipped table', () => {
    const resolved = resolveSystemLocale()
    expect(['en', 'zh']).toContain(resolved)
    expect(initSystemLocale()).toBe(resolveSystemLocale())
  })

  it('exposes selectable locales with labels', () => {
    const locales = availableLocales()
    expect(locales.map(entry => entry.id)).toEqual(['en', 'zh'])
    expect(locales.map(entry => entry.label)).toEqual(['English', '中文'])
  })

  it('lists every known locale with availability flags', () => {
    const known = knownLocales()
    expect(known.map(entry => entry.id)).toEqual(['en', 'zh', 'ja'])
    expect(known.find(entry => entry.id === 'en')!.available).toBe(true)
    expect(known.find(entry => entry.id === 'zh')!.available).toBe(true)
  })

  it('ships a complete zh table (no key drift against en)', () => {
    expect(missingKeys('zh')).toEqual([])
    setLocale('zh')
    expect(t('notice.compacted')).toBe('· 上下文已压缩')
    expect(t('approval.title', { tool: 'bash' })).toBe('⚠ 批准 bash')
    setLocale('en')
    expect(t('notice.compacted')).toBe('· context compacted')
  })

  it('labels well-known permission presets with the web-parity names', () => {
    expect(setLocale('en')).toBe(true)
    expect(permissionDisplayName('read-only')).toBe('Read Only')
    expect(permissionDisplayName('workspace-write')).toBe('Workspace Write')
    expect(permissionDisplayName('danger-full-access')).toBe('Full access')
    expect(permissionDisplayName('auto')).toBe('Auto review')
    expect(setLocale('zh')).toBe(true)
    expect(permissionDisplayName('read-only')).toBe('仅可查看')
    expect(permissionDisplayName('workspace-write')).toBe('工作区内修改')
    expect(permissionDisplayName('danger-full-access')).toBe('完全权限')
    expect(permissionDisplayName('auto')).toBe('自动审查')
    setLocale('en')
  })

  it('falls back to the catalog name for unknown permission values', () => {
    expect(permissionDisplayName('my-profile-preset', 'My Preset')).toBe('My Preset')
    expect(permissionDisplayName('my-profile-preset')).toBe('my-profile-preset')
  })
})
