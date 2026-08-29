import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ComposerAttachment, ComposerAttachmentsProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AttachmentRail } from '../AttachmentRail.tsx'
import type { AttachmentRailItem } from '../AttachmentRail.tsx'
import { DropOverlay } from '../DropOverlay.tsx'
import { ImageLightbox } from '../ImageLightbox.tsx'
import { attachmentRailLabels, dropOverlayLabels, lightboxLabels } from './labels.ts'
import css from './ComposerAttachments.module.css'

interface ComposerRailItem extends AttachmentRailItem {
  attachment: Extract<ComposerAttachment, { kind: 'image' }>
}

/** Draft attachment rail, document drop target, and image preview slot entry. */
export function ComposerAttachments({
  attachments, canAcceptDrop, intakeAttachments, onRemoveAttachment, dropLimits, t,
}: ComposerAttachmentsProps) {
  const images = useMemo(
    () => attachments.filter((item): item is Extract<ComposerAttachment, { kind: 'image' }> => item.kind === 'image'),
    [attachments],
  )
  const files = useMemo(
    () => attachments.filter((item): item is Extract<ComposerAttachment, { kind: 'file' }> => item.kind === 'file'),
    [attachments],
  )
  const [preview, setPreview] = useState<Extract<ComposerAttachment, { kind: 'image' }> | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)
  const closePreview = useCallback(() => { setPreview(null) }, [])

  useEffect(() => {
    if (preview !== null && !images.some(image => image.id === preview.id)) setPreview(null)
  }, [images, preview])

  useEffect(() => {
    const fileTransfer = (event: globalThis.DragEvent): DataTransfer | null => {
      const transfer = event.dataTransfer
      return transfer !== null && transfer.types.includes('Files') ? transfer : null
    }
    const reset = (): void => {
      dragDepth.current = 0
      setDragActive(false)
    }
    const onDragEnter = (event: globalThis.DragEvent): void => {
      if (fileTransfer(event) === null) return
      event.preventDefault()
      dragDepth.current += 1
      setDragActive(true)
    }
    const onDragOver = (event: globalThis.DragEvent): void => {
      const transfer = fileTransfer(event)
      if (transfer === null) return
      event.preventDefault()
      transfer.dropEffect = canAcceptDrop ? 'copy' : 'none'
    }
    const onDragLeave = (event: globalThis.DragEvent): void => {
      if (fileTransfer(event) === null) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragActive(false)
    }
    const onDrop = (event: globalThis.DragEvent): void => {
      const transfer = fileTransfer(event)
      if (transfer === null) return
      event.preventDefault()
      reset()
      if (canAcceptDrop) intakeAttachments([...transfer.files])
    }
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    window.addEventListener('dragend', reset)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', reset)
    }
  }, [canAcceptDrop, intakeAttachments])

  const railItems = useMemo<ComposerRailItem[]>(() => images.map(attachment => ({
    id: attachment.id,
    previewUrl: attachment.previewUrl,
    alt: attachment.file.name || t('image.pending'),
    removeLabel: t('image.remove', { name: attachment.file.name }),
    attachment,
  })), [images, t])

  return (
    <>
      {dragActive && <DropOverlay disabled={!canAcceptDrop} labels={dropOverlayLabels(t, canAcceptDrop, dropLimits)} />}
      {(railItems.length > 0 || files.length > 0) && (
        <div className={css.rail}>
          {railItems.length > 0 && (
            <AttachmentRail
              items={railItems}
              labels={attachmentRailLabels(t)}
              onOpen={(item) => { setPreview(item.attachment) }}
              onRemove={(item) => { onRemoveAttachment(item.attachment.id) }}
            />
          )}
          {files.length > 0 && (
            <div className={css.files} role="group" aria-label={t('file.pending')}>
              {files.map(file => (
                <div key={file.id} className={css.fileCard}>
                  <span className={css.fileIcon} aria-hidden>📄</span>
                  <span className={css.fileName} title={file.file.name}>{file.file.name || t('file.unnamed')}</span>
                  <button
                    type="button"
                    className={css.fileRemove}
                    aria-label={t('file.remove', { name: file.file.name || t('file.unnamed') })}
                    onClick={() => { onRemoveAttachment(file.id) }}
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {preview !== null && (
        <ImageLightbox
          src={preview.previewUrl}
          alt={preview.file.name || t('image.original')}
          labels={lightboxLabels(t)}
          onClose={closePreview}
        />
      )}
    </>
  )
}
