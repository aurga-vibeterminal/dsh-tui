/**
 * Image input for the composer: detect image file paths in submitted text,
 * admit them through the harness attachment service (the same
 * `admitPromptContent` pipeline the web upload flow uses), and gate sending
 * on the current model's declared vision support.
 * @module dsh-tui/images
 */

import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ImageAttachmentRef,
  ImageMediaType,
} from '@deepseek-ai/dsh-attachment/types'

/** Media type per accepted file extension (case-insensitive). */
const MEDIA_BY_EXTENSION: Record<string, ImageMediaType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

/** The image media type a path's extension declares, or undefined for non-images. */
export function mediaTypeFor(path: string): ImageMediaType | undefined {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return undefined
  return MEDIA_BY_EXTENSION[path.slice(dot + 1).toLowerCase()]
}

/** Trailing sentence punctuation stripped from bare path tokens. */
const TRAILING_PUNCTUATION = /[),.;:!?>\]}，。；：！？）》」』]+$/u

/**
 * Candidate local image paths in one composer text, in first-occurrence
 * order. Quoted spans (paths with spaces) and bare tokens both match; URLs
 * are ignored — only files on this machine can be attached.
 */
export function detectImagePaths(text: string): string[] {
  const candidates: string[] = []
  for (const match of text.matchAll(/["']([^"'\n]+)["']/g)) candidates.push(match[1]!)
  for (const token of text.split(/\s+/)) {
    const cleaned = token.replace(TRAILING_PUNCTUATION, '')
    if (cleaned !== '') candidates.push(cleaned)
  }
  const results: string[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (candidate.startsWith('http://') || candidate.startsWith('https://')) continue
    if (mediaTypeFor(candidate) === undefined) continue
    if (!seen.has(candidate)) {
      seen.add(candidate)
      results.push(candidate)
    }
  }
  return results
}

/** The attachments service surface the TUI uses (structural; see dsh-attachment). */
interface AttachmentsLike {
  admitPromptContent(content: readonly unknown[]): Promise<readonly unknown[]>
}

/** The llm service surface the vision gate uses (structural; see dsh-llm). */
interface LlmCatalogLike {
  listModels(provider: string): Promise<readonly { id: string, inputModalities?: readonly string[] }[]>
  resolveModelInfo(provider: string, model: string): Promise<{ inputModalities?: readonly string[] }>
}

/** One detected-and-admitted image ready to ride a user message. */
export interface AdmittedImagePart {
  readonly type: 'image'
  readonly attachment: ImageAttachmentRef
}

/** Outcome of admitting every detected path: stored parts plus per-path diagnostics. */
export interface ImageAdmissionResult {
  /** Admitted image content parts, in detection order. */
  readonly images: readonly AdmittedImagePart[]
  /** Paths that do not exist (or are not files); the text still names them. */
  readonly missing: readonly string[]
  /** Paths whose admission the attachment service refused. */
  readonly failed: readonly { path: string, message: string }[]
}

/**
 * Read and admit every existing image path through `ctx.attachments`
 * (`admitPromptContent`): validation, normalization, and durable storage all
 * happen inside the harness — the same pipeline the web upload flow uses.
 */
export async function admitImages(
  ctx: Context,
  paths: readonly string[],
): Promise<ImageAdmissionResult> {
  const attachments = ctx.get('attachments') as AttachmentsLike | undefined
  if (attachments === undefined) {
    return {
      images: [],
      missing: [],
      failed: paths.map(path => ({ path, message: 'attachment service unavailable' })),
    }
  }
  const images: AdmittedImagePart[] = []
  const missing: string[] = []
  const pending: { path: string, mediaType: ImageMediaType, data: string, name: string }[] = []
  for (const path of paths) {
    try {
      const info = await stat(path)
      if (!info.isFile()) {
        missing.push(path)
        continue
      }
      const data = await readFile(path)
      pending.push({
        path,
        mediaType: mediaTypeFor(path)!,
        data: data.toString('base64'),
        name: basename(path),
      })
    } catch {
      missing.push(path)
    }
  }
  if (pending.length > 0) {
    try {
      const admitted: readonly unknown[] = await attachments.admitPromptContent(
        pending.map(part => ({
          type: 'image',
          mediaType: part.mediaType,
          data: part.data,
          name: part.name,
        })),
      )
      for (const part of admitted) {
        const image = part as AdmittedImagePart
        if (image.type === 'image' && typeof image.attachment?.width === 'number') {
          images.push(image)
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return { images, missing, failed: pending.map(part => ({ path: part.path, message })) }
    }
  }
  return { images, missing, failed: [] }
}

/**
 * Whether the current model route declares image input. Mirrors the
 * harness's own route gate (`read_image`): an entry whose modalities are
 * **unknown refuses** — undefined is text-only, only an explicit
 * `inputModalities` containing `image` passes. `undefined` here means
 * resolution itself failed, in which case the send is allowed through and
 * the adapter reports a precise error.
 */
export async function modelAcceptsImages(
  ctx: Context,
  provider: string,
  model: string,
): Promise<boolean | undefined> {
  const llm = ctx.get('llm') as LlmCatalogLike | undefined
  if (llm === undefined) return undefined
  try {
    const info = await llm.resolveModelInfo(provider, model)
    if (info.inputModalities === undefined) return false
    return info.inputModalities.includes('image')
  } catch {
    return undefined
  }
}

/** Model ids under one provider that explicitly declare image input, for switch hints. */
export async function visionCapableModels(ctx: Context, provider: string): Promise<readonly string[]> {
  const llm = ctx.get('llm') as LlmCatalogLike | undefined
  if (llm === undefined) return []
  try {
    const models = await llm.listModels(provider)
    return models
      .filter(entry => entry.inputModalities?.includes('image') === true)
      .map(entry => entry.id)
  } catch {
    return []
  }
}
