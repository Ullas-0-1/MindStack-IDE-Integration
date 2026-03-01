# MindStack API Reference

> All routes live under `/api/`. Every route requires a `Bearer <JWT>` token in the `Authorization` header (Supabase user JWT), unless noted.

---

## 🗂️ Projects

### `GET /api/projects`
Returns all projects owned by the authenticated user, ordered newest-first.

**Response `200`**
```json
{
  "projects": [
    { "id": "uuid", "name": "string", "description": "string|null", "created_at": "iso8601" }
  ]
}
```

---

### `POST /api/projects`
Creates a new project.

**Request Body**
```json
{ "name": "My Project", "description": "optional string" }
```

**Response `201`**
```json
{ "project_id": "uuid" }
```

---

### `GET /api/projects/[project_id]/captures`
Lists all captures (with their attachments) for a given project, ordered newest-first. Row-Level Security (RLS) ensures users only see their own data.

**Response `200`**
```json
{
  "captures": [
    {
      "id": "uuid",
      "session_id": "uuid",
      "project_id": "uuid",
      "capture_type": "WEB_TEXT | VIDEO_SEGMENT | ...",
      "priority": 0,
      "source_url": "string|null",
      "page_title": "string|null",
      "video_start_time": "number|null",
      "video_end_time": "number|null",
      "ide_error_log": "string|null",
      "ide_code_diff": "string|null",
      "ide_file_path": "string|null",
      "ai_markdown_summary": "string|null",
      "created_at": "iso8601",
      "capture_attachments": [
        { "id": "uuid", "s3_url": "string", "file_type": "string", "file_name": "string" }
      ]
    }
  ]
}
```

---

## ⏱️ Sessions

### `POST /api/sessions/start`
Creates a new session tied to a project. Called when a browser/IDE extension session begins.

**Request Body**
```json
{ "project_id": "uuid" }
```

**Response `201`**
```json
{ "session_id": "uuid" }
```

---

### `POST /api/sessions/heartbeat`
Keeps the session alive by updating `last_active_at`. Also updates `active_file_context`, which is later used by the RAG engine for richer retrieval context.

**Request Body**
```json
{ "session_id": "uuid", "active_file_context": "optional string — e.g. file contents or path" }
```

**Response `200`**
```json
{ "success": true }
```

---

### `POST /api/sessions/end`
Ends a session.

- **Synchronous**: stamps `end_time` on the session row.
- **Async (fire-and-forget)**: collects all AI summaries from the session's captures, sends them to Claude Haiku, and stores a concise `ai_debrief` markdown string back on the session.

**Request Body**
```json
{ "session_id": "uuid" }
```

**Response `200`**
```json
{ "success": true }
```

---

## 📥 Ingestion

### `POST /api/ingest/browser`
Ingests a capture from a browser extension.

**Capture types:** `WEB_TEXT`, `VIDEO_SEGMENT`, `USER_NOTE`, `RESOURCE_UPLOAD`

**Request Body**
```json
{
  "session_id": "uuid",
  "project_id": "uuid",
  "capture_type": "WEB_TEXT",
  "text_content": "string",
  "source_url": "https://...",
  "page_title": "string",
  "video_start_time": 120,
  "video_end_time": 180,
  "priority": 0,
  "attachments": [
    { "s3_url": "string", "file_type": "PDF|IMAGE|VIDEO_KEYFRAME|RAW_TRANSCRIPT_JSON|DOC", "file_name": "string" }
  ]
}
```

**Response `200`**
```json
{ "capture_id": "uuid" }
```

**Async pipeline (non-blocking):**
1. For `VIDEO_SEGMENT`: fetches the YouTube transcript and filters to the given time window.
2. Sends text to **Claude Haiku** for a markdown summary → stored in `ai_markdown_summary`.
3. Chunks the summary with the text chunker.
4. Embeds each chunk with **Amazon Titan** → stored in `capture_chunks`.

---

### `POST /api/ingest/ide`
Ingests a capture from an IDE extension (bug fix or progress snapshot).

**Capture types:** `IDE_BUG_FIX`, `IDE_PROGRESS_SNAPSHOT`

**Request Body**
```json
{
  "session_id": "uuid",
  "project_id": "uuid",
  "capture_type": "IDE_BUG_FIX",
  "ide_error_log": "string",
  "ide_code_diff": "diff string",
  "repo_tree": "string",
  "ide_file_path": "src/main.ts",
  "priority": 0
}
```

**Response `200`**
```json
{ "capture_id": "uuid" }
```

**Async pipeline (non-blocking):**
1. Sends the error log + diff + repo tree to **Claude Haiku** for a plain-English explanation + key learning in Markdown.
2. Chunks *both* the raw code AND the plain-English translation (labelled `[RAW]` / `[EXPLANATION]`).
3. Embeds every chunk with **Amazon Titan** → stored in `capture_chunks`.

This dual-chunk strategy means semantic queries ("how did I fix the null pointer?") match the explanation, while exact code queries match the raw diff.

---

### `POST /api/ingest/process-document`
Server-side trigger called after a PDF has been uploaded to S3. Performs the full document → embeddings pipeline.

**Request Body**
```json
{ "capture_id": "uuid", "s3_url": "https://..." }
```

**Response `200`**
```json
{ "success": true, "capture_id": "uuid" }
```

**Async pipeline (non-blocking):**
1. Downloads the PDF from S3.
2. Parses text with `pdf-parse`.
3. Chunks the text.
4. Embeds each chunk with **Amazon Titan** → stored in `capture_chunks`.

---

## 🗄️ Vault (File Storage)

### `POST /api/vault/presigned-url`
Generates a 15-minute S3 PUT pre-signed URL so the client can upload files **directly to S3** without routing data through the server.

**Request Body**
```json
{ "file_name": "report.pdf", "file_type": "application/pdf" }
```

**Response `200`**
```json
{
  "upload_url": "https://s3.amazonaws.com/...(presigned PUT URL)...",
  "s3_url": "https://s3.amazonaws.com/bucket/uploads/report.pdf"
}
```

**Typical client flow:**
1. Call this endpoint → get `upload_url` + `s3_url`.
2. `PUT` file bytes to `upload_url`.
3. Store `s3_url` as a `capture_attachment` on the relevant capture.
4. For PDFs, call `POST /api/ingest/process-document` with the `s3_url`.

---

## 💬 Chat (Multimodal RAG)

### `POST /api/chat`
The core RAG query engine. Returns a **Server-Sent Events (SSE)** stream.

**Request Body**
```json
{
  "project_id": "uuid",
  "current_query": "How did I solve that null pointer error last week?",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

**Response** — `Content-Type: text/event-stream`

| SSE Event | Payload | When |
|---|---|---|
| `sources` | `{ "type": "sources", "data": ["s3_url", ...] }` | Immediately after retrieval |
| `delta` | `{ "type": "delta", "data": "text chunk" }` | Streaming tokens from Claude |
| `done` | `{ "type": "done" }` | End of stream |
| `error` | `{ "type": "error", "data": "message" }` | On failure |

**Internal pipeline (7 steps):**
1. Embeds `current_query` with **Amazon Titan**.
2. Runs a `pgvector` cosine similarity search (`match_captures` RPC, top 5 chunks).
3. Fetches the parent captures + sessions + attachments for matched chunks.
4. Identifies image attachments and fetches them from S3 as Base64.
5. Emits the `sources` event with all related S3 URLs.
6. Builds a multimodal **Claude** message: markdown context block + the question + up to 3 inline Base64 images.
7. Streams the **Claude 3.7 Sonnet** response as `delta` SSE events.

> Up to 10 prior conversation turns are included as message history for multi-turn support.

---

## 🗑️ Captures

### `DELETE /api/captures/[id]`
Deletes a capture and all its associated data.

1. Fetches all `capture_attachments` to retrieve S3 object URLs.
2. Deletes each S3 object (best-effort; partial failures are logged but don't abort).
3. Deletes the `captures` row — DB cascade removes `capture_attachments` and `capture_chunks`.

**Response `200`**
```json
{ "success": true }
```

---

## Architecture Overview

```
Client / Extension
    │
    ├─ POST /api/sessions/start ──────────────── Creates session
    ├─ POST /api/sessions/heartbeat ─────────── Keeps alive + file context
    │
    ├─ POST /api/vault/presigned-url ────────── S3 upload URL
    │       └── PUT directly to S3
    │
    ├─ POST /api/ingest/browser │
    ├─ POST /api/ingest/ide     │──────────────  Sync: save capture row
    ├─ POST /api/ingest/process-document        Async: Haiku → chunk → Titan embed
    │
    ├─ POST /api/sessions/end ───────────────── Async: Haiku session debrief
    │
    └─ POST /api/chat ───────────────────────── Titan embed → pgvector → Claude SSE stream
```

All auth is enforced via Supabase JWT. Row-Level Security (RLS) on `projects`, `captures`, and `sessions` tables ensures data isolation per user. Background async work (embeddings, AI summaries, debriefs) uses the Supabase admin client so it isn't blocked if the user JWT expires mid-processing.
