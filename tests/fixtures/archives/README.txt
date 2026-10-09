# Archive read-format fixtures

The manifest pins libarchive fixtures to commit `7f53fce04e4e672230f4eb80b219af17975e4f83` (v3.8.2), under `libarchive/test/`. `source` is the original uuencoded filename in [libarchive](https://github.com/libarchive/libarchive/tree/7f53fce04e4e672230f4eb80b219af17975e4f83/libarchive/test). License notices are retained in `LICENSE.libarchive.txt`.

UU decoding preserves the original bytes. The Nero Joliet ISO was independently decompressed from `.Z` using 7-Zip and stored as gzip to keep the repository small. SHA-256 and byte lengths describe the actual archive, after gzip decompression. Expected extracted file hashes were independently obtained using the installed 7-Zip command-line tool; TAR.ZST expectations refer to the inner TAR contents.

`payload.txt.bz2` and `payload.tar.bz2` are One-generated fixtures using Python's bz2/tarfile libraries; `payload.wim` was created with `7z a -twim`. All contain the same UTF-8 `payload.txt` with Chinese text. These fixtures are original test data for this repository.

LHA header levels 0, 1 and 2 contain symbolic links and are retained as safe-browser/extraction refusal cases; integrity testing can still check their bytes. The ordinary `bugfix_0` sample is a positive case. The CP932 fixture checks the current engine's byte-preserving extraction against the independent oracle, without claiming the original Japanese names decode correctly under every system code page. Level 3 is deliberately retained as an unsupported-format rejection case. The ZIPX corpus covers BZIP2, LZMA, PPMd8, XZ and ZSTD methods. This small corpus does not claim support for every variant, encrypted ZIPX, multi-volume CAB/WIM, Rock Ridge links or all UDF versions.

Run `npm run test:archive-formats` after building the native helper. Tests require no network, Python or system-installed 7-Zip.
