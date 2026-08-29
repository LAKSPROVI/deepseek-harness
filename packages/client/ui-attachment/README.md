# @deepseek-ai/dsh-client-ui-attachment

English | [中文](README.zh.md)

Dynamic attachment presentation plugin for the conversation UI. It waits for the conversation package's `conversation.input.attachments` and `conversation.message.attachments` declarations through `ctx.slots.inject`, then registers the composer draft rail and its draft file cards, the document drop target, the chat-history attachment groups, and the original-image lightbox. The conversation slot owner supplies attachment data, the session-authorized loader, callbacks, and its namespace translator; presentation components remain pure props and are not exported from the package entry.

## Composer rail and draft file cards

`AttachmentRail` renders pending draft images as fixed 64px thumbnails (16px radius) in one horizontally scrolling row whose scrollbar stays hidden. Overflow is announced by circular edge arrows instead: each pages one viewport (minus one card of context, floored at 200px) with smooth scrolling (instant under `prefers-reduced-motion: reduce`), and arrow visibility is recomputed from scroll geometry on scroll, item-count changes, and rail size changes (a ResizeObserver on the rail element, so sidebar and panel resizes count, not only window resizes). The rail scrolls horizontally only: a non-passive listener consumes every wheel tick with a vertical component — nothing scrolls the conversation behind the composer — converting a pure vertical wheel to a horizontal step (LINE/PAGE deltas normalized to pixels, per-tick travel clamped to 60px) and keeping a diagonal pan's horizontal intent, while purely horizontal pans stay native. A newly added item is revealed at the rail's end; removal keeps the scroll position, and a rail that mounts over an already-populated draft keeps its start position. Each thumbnail opens its original through `onOpen` on a single click, and its remove control sits inside the card's top-right corner, hidden until the card is hovered or the control keyboard-focused; coarse-pointer (touch) surfaces show it permanently because they have no hover. The owner decides mounting and renders the rail only while items exist.

`ComposerAttachments` splits the owner's draft list by kind: the rail carries only attachments the composer classified as supported raster images (PNG, JPEG, WebP, GIF), and every other draft — SVG, HTML, PDF, archives, and any other declared or undeclared type — renders below the rail as an inert generic file card carrying the document glyph, the file name (`file.unnamed` when the browser reports none), and its own remove control. A file card renders no `img` element and opens no lightbox, so a draft that merely claims an image media type cannot reach an image decoder or a preview surface through this plugin. The rail and the file group mount independently: either one alone renders, and both render together while a draft mixes kinds.

## Message attachments and the lightbox

`MessageAttachments` walks one message's durable attachment blocks in source order, grouping each consecutive run of images into an `ImageGallery` and rendering each file block as its own download card, so a mixed message keeps the author's original ordering rather than sorting images ahead of files. A file card names the attachment (`file.unnamed` as fallback), shows its media type and byte count, and downloads on click: it resolves the durable bytes through the owner's session-authorized loader and clicks a synthesized anchor carrying the reference's name. The card disables itself while that load is pending, so a second click cannot start a duplicate download, and re-enables when the load settles either way. The URL the owner's loader returns for a file block is backed by a browser Blob typed `application/octet-stream` regardless of the durable reference's declared media type, so following it saves bytes instead of letting the browser render or execute them. Nothing in this group renders a non-image attachment through `img` or the lightbox.

`MessageImage` renders one durable history image, loading a session-authorized URL through the owner's `ImageLoader`; a failed load renders an explicit retry control, and a settled load answers a single click by opening `ImageLightbox` (clicks during loading are ignored). Sizing follows DeepSeek Chat: a message's lone image (`variant="single"`) renders at 240px on its longer edge with the displayed aspect ratio clamped to [0.25, 4] — the overflow is cropped by `object-fit: cover`, anchored to the top of very tall images and the left of very wide ones — and never upscales past its natural size; an image among several (`variant="tile"`) is a fixed 64px square. `ImageGallery` wraps a message's images in one aligned wrapping flex group (`end` for user messages, `start` for assistant messages), picks the variant from the image count, and renders nothing for an empty list. `ImageLightbox` is a document-level modal preview over the shared dialog mask (`--dsw-alias-bg-mask-1` + `--dsw-mask-blur`, painted on its own layer so the blur never touches the previewed image) that closes on Escape, a mask press, or its close control, and restores focus to its opener on unmount.

## Drop overlay

`DropOverlay` is the full-viewport invitation shown while a file drag is over the page: illustration, title, and a limits line while drops are accepted (`disabled` swaps the blocked illustration and hides the limits line). The invitation is generic — any file kind may be dropped, and the drop path forwards the whole batch to the owner without filtering by media type. The limits line follows whichever limits the owner supplied: image and file limits together render the mixed line, either alone renders its own count-and-size line, and a bare combined count renders the plain attachment-count line. The layer is pointer-inert — the owner's document-level drag listeners keep the enter/leave count and decide accept/reject; the overlay only shows state. It portals to the body like the lightbox.

## Model Experience

None, as the plugin only renders attachment state supplied by the conversation UI and contributes no model-visible input.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Generic file cards carry no type identity or transfer progress** — a draft or historical file renders one document glyph regardless of its media type, and neither card shows upload or download progress; a large historical download only disables its card until the bytes resolve.
- **No zoom or download in the lightbox** — the preview renders the original at fit-to-viewport size only.
- **The lightbox does not trap focus** — it sets `aria-modal` and restores focus on close, but Tab can reach the page behind it.
