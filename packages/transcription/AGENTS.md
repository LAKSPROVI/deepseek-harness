# AGENTS.md — Transcription packages

These rules supplement the package conventions in [packages/AGENTS.md](../AGENTS.md).

- **Audio never becomes durable or model-visible data.** A package here may hold audio bytes only for the duration of the call that received them: no session event, no log line, no cache, no spill file, and no diagnostic that echoes the payload. Only the transcript crosses into the session, and only through the ordinary user-message path the human triggers.
- **Reject redirects on credential-bearing provider requests.** Configure the HTTP client to fail before following any redirect response. Regression coverage must prove the redirect target is not contacted and that every credentialed provider opts into the policy. The configured endpoint necessarily receives the initial request; this prevents automatic forwarding of the credential or the audio payload to another origin, not compromise of the configured endpoint.
- **The seam owns transcription policy.** The audio-byte ceiling, provider selection, and transcript trimming belong to `dsh-transcription`; a Consumer adds only what its own transport requires (an encoding check, a measured byte length). A Consumer that re-implements a seam bound lets a headless deployment and the browser diverge.
