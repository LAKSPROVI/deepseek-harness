import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { AttachmentRailLabels } from '../AttachmentRail.tsx'
import type { DropOverlayLabels } from '../DropOverlay.tsx'
import type { ImageLightboxLabels } from '../ImageLightbox.tsx'
import type { MessageImageLabels } from '../MessageImage.tsx'

/**
 * Resolve original-image lightbox strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @returns translated lightbox labels.
 */
export function lightboxLabels(t: TranslateNS<'conversation'>): ImageLightboxLabels {
  return { dialog: t('image.preview'), close: t('image.closePreview') }
}

/**
 * Resolve historical message-image strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @returns translated message-image labels.
 */
export function messageImageLabels(t: TranslateNS<'conversation'>): MessageImageLabels {
  return {
    image: t('image.label'),
    open: t('image.openOriginal'),
    openNamed: label => t('image.openOriginalLabel', { label }),
    loading: t('image.loading'),
    loadFailed: t('image.loadFailed'),
    lightbox: lightboxLabels(t),
  }
}

/**
 * Resolve the document-level drop invitation and its optional limits line.
 * @param t - conversation namespace translator.
 * @param accepting - whether the composer can accept dropped files.
 * @param limits - optional translated count and size values.
 * @returns translated drop-overlay labels.
 */
export function dropOverlayLabels(
  t: TranslateNS<'conversation'>,
  accepting: boolean,
  limits?: {
    readonly images?: { readonly count: number; readonly size: string } | undefined
    readonly files?: { readonly count: number; readonly size: string } | undefined
    readonly combined?: number | undefined
  },
): DropOverlayLabels {
  if (!accepting) return { title: t('attachment.dropBlocked') }
  const images = limits?.images
  const files = limits?.files
  const desc = images !== undefined && files !== undefined
    ? t('attachment.dropDescMixed', {
      imageCount: images.count,
      imageSize: images.size,
      fileCount: files.count,
      fileSize: files.size,
    })
    : images !== undefined
      ? t('attachment.dropDescImages', { count: images.count, size: images.size })
      : files !== undefined
        ? t('attachment.dropDescFiles', { count: files.count, size: files.size })
        : limits?.combined === undefined
          ? undefined
          : t('attachment.dropDesc', { count: limits.combined })
  return { title: t('attachment.dropTitle'), desc }
}

/**
 * Resolve draft-image rail strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @returns translated attachment-rail labels.
 */
export function attachmentRailLabels(t: TranslateNS<'conversation'>): AttachmentRailLabels {
  return {
    group: t('image.pending'),
    open: t('image.openOriginal'),
    scrollLeft: t('image.scrollLeft'),
    scrollRight: t('image.scrollRight'),
  }
}
