# File-type icons

Colored per-extension SVG icons shown in the file row of a file ping. Each file
is named by extension or category (`pdf.svg`, `mp4.svg`, `archive.svg`, …).

`file.svg` is the **required fallback** — it's shown for any extension without a
more specific match. Keep it.

## How they're wired (Ping has no build step)

These are mapped at runtime by `fileTypeIcon(name)` in
[../../app.js](../../app.js). That function:

1. takes the file's extension,
2. resolves it through an alias map to a key that has an SVG here
   (e.g. `jpeg → jpg`, `docx → doc`, `xlsx → xls`, `webm → mp4`,
   `rar/tar/gz → archive`),
3. returns `/icons/filetypes/<key>.svg`, or `/icons/filetypes/file.svg` if there
   is no match.

`renderPing()` renders that path as an `<img>` with a JS-attached error handler
that falls back to `file.svg` if the path 404s.

## Adding or changing an icon

- **New exact type:** drop `<ext>.svg` here. If the file extension matches the
  SVG name directly, it works with no code change.
- **Alias an extension to an existing icon:** add it to the alias map in
  `fileTypeIcon()` (there is no build-time globbing — the mapping is explicit).

Icons render at ~20px in the file row and full-size in the image lightbox is a
separate path (image *previews* fetch the actual file, not these type icons).
