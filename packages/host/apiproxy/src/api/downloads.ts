/**
 * downloads domain contract: host-only download surfaces — the GET-download
 * channel family, the mirror of the SSE-stream `events` domain. No wire
 * envelope: the carrier's GET routes answer these directly, and the browser
 * `IApiClient` never exposes them.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Host-only download surfaces (no wire envelope; absent from IApiClient). */
export interface DownloadsApi {
  /**
   * Persist one raw generic-file body and bind its receipt to a session.
   * @param request - session identity, bounded metadata, exact expected bytes, and raw body.
   * @param signal - cancellation propagated from the HTTP connection.
   * @returns a small JSON response containing the session-scoped receipt.
   */
  fileUpload(
    request: {
      sessionId: SessionId
      body: AsyncIterable<Uint8Array>
      expectedBytes: number
      mediaType?: string
      name?: string
    },
    signal: AbortSignal,
  ): Promise<Response>
  /**
   * Stream one generic file referenced by the target session's user-message log.
   * @param request - session identity and opaque content-addressed id.
   * @param signal - cancellation propagated from the HTTP connection.
   * @returns a forced-download binary response, or a denial before bytes are emitted.
   */
  fileDownload(
    request: { sessionId: SessionId; attachmentId: string },
    signal: AbortSignal,
  ): Promise<Response>
  /**
   * Stream one session-log ZIP — the root artifact verbatim plus each subagent
   * descendant's — as an attachment response. The carrier's GET route answers
   * this directly; the browser never calls it.
   * @param request - the root session id and whether to include descendants.
   * @param signal - cancellation for the underlying reads.
   * @returns the ZIP attachment response; missing services answer 500 and a
   * missing root session 404 before any byte is produced.
   */
  sessionLog(
    request: { sessionId: SessionId; includeDescendants?: boolean },
    signal: AbortSignal,
  ): Promise<Response>
}
