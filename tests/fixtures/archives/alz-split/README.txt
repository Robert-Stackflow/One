ALZ split-volume corpus

Source: https://github.com/alkegi/unalz/tree/30b4ad40c5452c686df69b3b45554de3073e57a1/tests/data
Pinned source revision: 30b4ad40c5452c686df69b3b45554de3073e57a1
MIT license: LICENSE.unalz-rust.txt. Test fixtures only; not shipped in One.

split.alz + split.a00..a06: eight external volumes, ten files, Store/Deflate,
10,487,896 expanded bytes, Korean CP949 names and nested paths.
split_store.alz + split_store.a00..a01: three external volumes, four stored
40,000-byte files. The upstream repository provides these as test samples;
additional writer/version provenance is not asserted.
manifest.json pins every volume's bytes/SHA256 and independent decoded hashes.

python tests/fixtures/archives/alz-split/validate-reference.py independently
checks the entire corpus using Python's standard-library struct/zlib/CRC32,
without One's C++ reader or the Rust reference. Volume headers contain ALZ v10
and a little-endian 16-bit ordinal. Every non-final volume has a 16-byte
CLZ01/zero/CLZ03 trailer; the final volume has CLZ01/zero/CLZ02. Only the first
header and final trailer belong to the logical single-volume stream.
The older fixed UnAlz 0.65 source independently confirms stripping eight
continuation-header and sixteen intermediate-trailer bytes.

npm run test:archive-alz-split verifies product browsing, integrity, extraction,
selection, preview, drag and CLI parsing from every external entry volume.
It also partitions already independently verified Store/Deflate/DLZ/standard
BZh/ZipCrypto streams at header, cipher-header and buffer boundaries, checks
a99/b00 numbering, missing/truncated/reordered volumes, resource limits,
changed-volume revisions and protection of an existing destination.
Desktop and standalone console regressions use the normal application paths.

Runtime remains read-only. ALZ v10 volume ordinals and framing are checked
before the index is exposed. The complete declared group is read-locked and
revision-bound; stale undeclared siblings are not appended. The application
accepts .alz and .a00 onward through the 1,024-volume resource limit, including
opening a later member when the first .alz and all declared members are present.
Default file association remains .alz; other members can be opened in One.
Other ALZ versions, data descriptors and unknown framing remain unsupported.
