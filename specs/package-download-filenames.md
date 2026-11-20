# Package download filenames

Package download responses tell the browser the file name in `Content-Disposition`.

A bundle-plugin version is not semver. The zip download and the npm tarball download used to place that version inside `filename="..."`. A quote in the version ended the name and could add `filename*`, which browsers prefer, so the saved file could be `setup.jar` instead of a `.zip` or `.tgz`.

Those two responses use `contentDispositionAttachment`. `filename*` is the encoded original name, so a quote cannot add another parameter. `filename` is a sanitized ASCII fallback that still ends in `.tgz` or `.zip` for clients that ignore `filename*`. Publish still accepts the publisher-defined bundle version, including spaces and quotes. Versions already stored stay downloadable. Code plugins and claws still have to be semver.

Plugin export zip names are built from the family and the date range. They are not package versions.

## Legacy ZIP response memory

After hashing, the public package download handler streams bounded views of
the existing ZIP and sets its known `Content-Length`. A `Response` built from
a typed array can copy the entire archive, and Convex copies each output
chunk into its HTTP transport. Neither step should require another ZIP-sized
buffer. This does not stream ZIP construction or hashing. The inert regression
pins the historical digest and checks the body through consumption; stored
originals, archive contents, path validation, and access checks are unchanged.
