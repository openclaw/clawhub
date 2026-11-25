# Plugin icon presentation

Plugin artwork fills its existing rounded tile edge to edge, without UI-added padding or stretching. Keep the outer tile and surrounding layout dimensions unchanged. The tile clips the artwork to its shape; the image preserves its aspect ratio. Do not inset artwork by publisher, official status, or asset digest.

Only supported bundled artwork represents a plugin. If it is absent, unsupported, or fails to load, render the standard plugin plug glyph rather than substituting the publisher avatar or a category glyph. Publisher identity and category badges are separate from the icon tile. Keep the existing trusted image sources and raster-to-hosted retry, and do not rewrite hosted assets or package metadata for presentation changes.
