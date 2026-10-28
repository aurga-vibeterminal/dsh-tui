import { describe, expect, it } from 'vitest'
import { detectImagePaths, mediaTypeFor } from '../src/images.ts'

describe('image path detection', () => {
  it('maps extensions to media types case-insensitively', () => {
    expect(mediaTypeFor('a.PNG')).toBe('image/png')
    expect(mediaTypeFor('b.JPG')).toBe('image/jpeg')
    expect(mediaTypeFor('c.jpeg')).toBe('image/jpeg')
    expect(mediaTypeFor('d.webp')).toBe('image/webp')
    expect(mediaTypeFor('e.gif')).toBe('image/gif')
    expect(mediaTypeFor('f.txt')).toBeUndefined()
    expect(mediaTypeFor('noext')).toBeUndefined()
  })

  it('detects quoted paths with spaces and bare windows paths', () => {
    const text = '参考 "C:\\Users\\me\\shot 2026.png" 和 C:\\temp\\ref.jpg 创建页面'
    expect(detectImagePaths(text)).toEqual(['C:\\Users\\me\\shot 2026.png', 'C:\\temp\\ref.jpg'])
  })

  it('ignores urls and non-image tokens, dedupes, strips trailing punctuation', () => {
    const text = 'see https://x.com/a.png and readme.md, then run a.jpg. also a.jpg again'
    expect(detectImagePaths(text)).toEqual(['a.jpg'])
  })

  it('keeps detection order and handles multiple quoted paths', () => {
    expect(detectImagePaths('"b.png" then "a.png"')).toEqual(['b.png', 'a.png'])
  })
})
