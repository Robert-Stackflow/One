ALZ v10 flag and empty-file variants

External source: https://github.com/alkegi/unalz/tree/30b4ad40c5452c686df69b3b45554de3073e57a1/tests/data
Pinned commit: 30b4ad40c5452c686df69b3b45554de3073e57a1
License: LICENSE.unalz-rust.txt (MIT), test data only, not shipped in One.
Twelve unchanged external samples cover Store/Deflate/DLZ, empty files,
old stored layouts, directories, CP949 names and ZipCrypto. enc_* and zip20
use test1234. Exact writer versions are not asserted. bzip2.alz and split
sets are maintained separately.

Seven original generated cases reuse independently verified encoded streams
from ../alz/encrypted.alz, or Python's empty Deflate/standard BZh:
date-all: date-mode Store/BZip2/Deflate; mixed: CRC-mode, date-mode, CRC-mode
and unencrypted date-mode members; empty-crc/date: zero-width encrypted
stored entries; empty-deflate/bzh: compressed encrypted empty entries.
These use secret. date-korean uses CP949 password 비밀. Empty date cases
carry full DOS date 0x56a51234; only the low byte of time >> 8 is checked.
Flag bit 3 is covered by generated/reference cases; no real writer-produced
bit-3 sample is claimed. All cases have known sizes, including size zero.

manifest.json pins bytes/SHA256, per-member metadata, decoded SHA256/CRC32
and decrypted encoded-stream SHA256: 19 archives, 73 entries. Independent
validate-reference.py checks framing, 23 encrypted headers and 70 stdlib
decoded outputs (Store/Deflate/BZh). Three DLZ output hashes were separately
verified with UnAlz 0.65. All twelve external archives plus date-all,
empty-crc and date-korean were extracted with UnAlz 0.65; length/CRC/hash
matched. Its four other generated cases fail the reference password check:
it stores bit 3 globally (mixed fails) and its active CryptCheck compares
the full time >> 8 against one byte (three full-date empty cases fail).
The older commented implementation truncates correctly. Unchanged Rust
src/crypto.rs at the pinned revision independently checked all 23 encrypted
headers and decrypted payloads, including these four cases. Its per-entry
extraction call and explicit u8 date cast confirm the intended behavior.
Python also independently decodes all empty outputs.

UnAlz 0.65 reference archive:
https://deb.debian.org/debian/pool/main/u/unalz/unalz_0.65.orig.tar.gz
SHA256: 4c26699eb7545072de2ef7de79b4fff1f01c4db09cebff2d8d50ec03d5d74db0
Reference source is not a new product dependency. Existing reference setup:
../alz/README.txt and vendor/archive/alz-bzip2/.

python tests/fixtures/archives/alz-variants/validate-reference.py
python tests/fixtures/archives/alz-variants/generate-fixtures.py
npm run test:archive-alz-variants

Product checks cover exact hashes, read-only browse/details/test/extract,
per-member date/CRC, encrypted empty files, CP949 passwords, check-mode,
header/time/body tampering without fallback, directory/truncation/extra
payload rejection, preserved destinations, split cipher boundaries and
drag. Nested samples exercise existing risk confirmation. Unknown sizes,
additional trailing descriptors, other versions and unknown flags remain
unsupported. This corpus does not claim every ALZ variant.
