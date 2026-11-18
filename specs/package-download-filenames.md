# Package download filenames

Package download responses tell the browser the file name in `Content-Disposition`.

A bundle-plugin version is not semver. The zip download and the npm tarball download used to place that version inside `filename="..."`. A quote in the version ended the name and could add `filename*`, which browsers prefer, so the saved file could be `setup.jar` instead of a `.zip` or `.tgz`.

Those two responses use `contentDispositionAttachment`. `filename*` is the encoded original name, so a quote cannot add another parameter. `filename` is a sanitized ASCII fallback that still ends in `.tgz` or `.zip` for clients that ignore `filename*`. Publish still accepts the publisher-defined bundle version, including spaces and quotes. Versions already stored stay downloadable. Code plugins and claws still have to be semver.

Plugin export zip names are built from the family and the date range. They are not package versions.

## Legacy ZIP response memory

The public package download handler sends its already-owned ZIP bytes directly
to `Response`. Do not add an archive-sized `ArrayBuffer.slice()` and `Blob`
wrapper: the two additional copies can exhaust the 64 MB HTTP-action runtime
after archive construction and hashing have succeeded. The large inert download
regression pins the historical ZIP digest and response headers as well as this
allocation boundary. This optimization does not change portable-path validation,
moderation/access checks, archive contents, or the stored-original contract.
