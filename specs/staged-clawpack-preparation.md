# Staged ClawPack preparation

For a storage-backed package publish, the HTTP action authenticates the publisher and consumes the upload ticket for the exact archive storage id before dispatching preparation. An internal Node action reads the stored archive, checks its size, parses it, validates Template identity and expected digest, and stores extracted files in the existing bounded batches. The 64 MiB HTTP action must receive only the prepared publication metadata and new storage ids, never compressed or expanded archive bytes.

The internal action removes newly extracted blobs if preparation fails, waiting for all in-flight stores first. It preserves the existing staged archive. On success, the HTTP action adds the returned ids to its request cleanup set and transfers cleanup ownership to the publication action at the existing dispatch boundary. An ambiguous publication RPC failure never authorizes HTTP deletion of potentially adopted files.

Inline small uploads, public request/response schemas, archive limits, security checks, and publication authorization retain their existing behavior. This change addresses the reproducible archive-preparation memory failure; it does not establish the cause or deployed resolution of the historical production request ids in #3888.
