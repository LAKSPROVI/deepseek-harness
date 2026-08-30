# Use the Web UI

English | [中文](index.zh.md)

Start the Web UI through the [root README](../../../README.md#run); the command prints its URL. This guide begins after that server is running. The `dsh` process uses its invoking directory as the default filesystem location, but a fresh Web UI has no selected workspace until you add one.

## Configure a model

Open **Settings → Models**, enter a [DeepSeek API key](https://platform.deepseek.com/), and save it. The model route becomes usable immediately without restarting the server.

The [model configuration guide](./providers.md) covers other providers and custom OpenAI-compatible endpoints.

## Choose a workspace

Click **Choose workspace**, add the project directory where you started `dsh`, and select it. The session composer remains unavailable until a workspace is selected.

## Run a task

Start a session and send:

> Summarize this repository and identify its main packages.

The agent can read and edit workspace files, run commands, delegate work, and maintain a plan. The Web UI asks before operations that require approval under the active permission policy.

## Reuse saved prompts

Open **Settings → Prompt library** to create, edit, or delete reusable prompts. In a session, open the prompt-library button beside the composer and search by title or body. Selecting a prompt inserts it into the draft; it never sends automatically. If the draft already contains text, the saved body is appended after a blank line.

## Attach files

Use **Add attachments**, paste files, or drag them anywhere over the page. PNG, JPEG, WebP, and GIF use image previews; every other type, including SVG, PDF, HTML, and archives, stays an inert file card. A default deployment accepts up to 20 generic files, 1 GiB per file and 1 GiB total per submission. The Harness stores exact opaque bytes and forces historical files to download instead of rendering them in the page.

The attachment limit is a transport and storage limit, not a promise that the selected model understands a file format. Routes without generic-file input receive a deterministic metadata description instead of the bytes. Removing a draft before submission discards it from the composer; selecting a saved prompt or attaching a file never sends the message by itself.

## Continue

- [Configure models](./providers.md)
- [Understand the prompt library](../../../packages/client/ui-prompt-library/README.md)
- [Read the attachment reference](../../subsystems/attachment.md)
- [Use the Python SDK](./python-sdk.md)
- [Use other CLI modes](../../../apps/cli/README.md)
- [Develop a plugin](../develop/basic/index.md)
