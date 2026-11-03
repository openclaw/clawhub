# Staged ClawPack preparation

For a storage-backed package publish, the HTTP action authenticates the publisher and consumes the upload ticket for the exact archive storage id before dispatching preparation. An internal Node action reads the stored archive, checks its size, parses it, validates Template identity and expected digest, and stores extracted files in the existing bounded batches. The 64 MiB HTTP action must receive only the prepared publication metadata and new storage ids, never compressed or expanded archive bytes.

The internal action removes newly extracted blobs if preparation fails, waiting for all in-flight stores first. It preserves the existing staged archive. On success, the HTTP action adds the returned ids to its request cleanup set and transfers cleanup ownership to the publication action at the existing dispatch boundary. An ambiguous publication RPC failure never authorizes HTTP deletion of potentially adopted files.

Inline small uploads, public request/response schemas, archive limits, security checks, and publication authorization retain their existing behavior. This change addresses the reproducible archive-preparation memory failure; it does not establish the cause or deployed resolution of the historical production request ids in #3888.

Archive parsing is shared with the runtime-neutral parser in `packages/clawhub/src/clawpack.ts`. That leaf depends only on the existing compression and Template path helpers; it must not import Node-only or CLI command code. The backend wrapper computes archive hashes before parsing and adds npm metadata and size/count summaries. Keep archive validation, byte limits, entry ordering, errors, and CLI synchronous/backend asynchronous contracts unchanged.
