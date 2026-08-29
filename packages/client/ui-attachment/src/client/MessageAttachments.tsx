import { useState } from 'react'
import type {
  MessageAttachment, MessageAttachmentsProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ImageGallery } from '../MessageImage.tsx'
import { messageImageLabels } from './labels.ts'
import css from './MessageAttachments.module.css'

function FileCard({ item, load, label }: {
  item: Extract<MessageAttachment, { kind: 'file' }>
  load: MessageAttachmentsProps['loadAttachment']
  label: string
}) {
  const [busy, setBusy] = useState(false)
  const download = (): void => {
    if (busy) return
    setBusy(true)
    void load(item.attachment).then((url) => {
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = item.attachment.name ?? 'attachment'
      anchor.rel = 'noopener'
      anchor.click()
    }).finally(() => { setBusy(false) })
  }
  return (
    <button type="button" className={css.file} disabled={busy} onClick={download}>
      <span aria-hidden>📄</span>
      <span className={css.name}>{item.attachment.name ?? label}</span>
      <span className={css.meta}>{item.attachment.mediaType} · {item.attachment.bytes} B</span>
    </button>
  )
}

/** Historical attachment slot entry with image galleries and opaque file downloads. */
export function MessageAttachments({ attachments, loadAttachment, align, t }: MessageAttachmentsProps) {
  const nodes = []
  for (let index = 0; index < attachments.length;) {
    const item = attachments[index]
    if (item === undefined) break
    if (item.kind === 'file') {
      nodes.push(<FileCard key={`${item.attachment.attachmentId}:${index}`} item={item} load={loadAttachment} label={t('file.unnamed')} />)
      index += 1
      continue
    }
    const start = index
    const images: Extract<MessageAttachment, { kind: 'image' }>[] = []
    while (index < attachments.length) {
      const next = attachments[index]
      if (next === undefined || next.kind !== 'image') break
      images.push(next)
      index += 1
    }
    nodes.push(
      <ImageGallery
        key={`images:${start}`}
        images={images.map(image => ({ attachment: image.attachment }))}
        load={loadAttachment}
        align={align}
        labels={messageImageLabels(t)}
      />,
    )
  }
  return <div className={css.group} data-align={align}>{nodes}</div>
}
