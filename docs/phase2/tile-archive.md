# Single-file tilesets

Build a directory with `city tiles build`, then package it. Serve the directory containing the archive.

```sh
node bin/city.js tiles pack ./out/beijing --output ./out/beijing.archive --json
node bin/city.js tiles serve ./out --port 4181
```

Use `http://127.0.0.1:4181/beijing.archive` as the `tiles` URL in `createMap` or `createMapLibreLayer`. Both accept relative URLs and signed URL query strings. For a different suffix, pass the options returned by `await openTileArchive(url)` from `@city-ink/map`. The server must honor single byte ranges with HTTP 206 on the original representation. Disable HTTP compression on archives and expose Content-Range for cross-origin reads.

The file is an uncompressed POSIX USTAR. Extract with `tar -xf beijing.archive` to recover the manifest, coverage, report and original tiles. The first member, `city-ink-index-v1.json`, is a UTF-8 JSON array of ordered `[relativeName, byteLength]` pairs describing all following regular files. A header occupies 512 bytes, followed by the data padded to a multiple of 512. Two zero blocks terminate the archive. The SDK reads the first header and index once per opening and fetches each requested member separately. The 16 MiB index limit applies to both packing and reading. Build caches and source PBFs stay outside the archive.

Reproduce the CLI and range-reader checks with `npm run build:packages && node --test test/phase2-archive.test.js`.
