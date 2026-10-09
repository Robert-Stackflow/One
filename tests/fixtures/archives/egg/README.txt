# EGG native-implementation reference corpus

The source and binary fixtures are pinned to EggDotNet commit
78b64f54026a8687dac1cdd4c86eb5fe5abf04ae:
https://github.com/akolman/EggDotNet/tree/78b64f54026a8687dac1cdd4c86eb5fe5abf04ae
The author's MIT license is retained in LICENSE.EggDotNet.txt. Every archive,
volume and reference source file is hashed in manifest.json. The compressed
source capsule contains the exact C# library files and original license. It is
used only as an independent test oracle, not linked or shipped in One.

Run: npm run test:archive-egg-reference
Requires the existing Windows tar and .NET 6 SDK; it introduces no .NET runtime
dependency into One. The runner extracts/builds under work/archive-build,
verifies source/fixture hashes and hashes streams without publishing files
using archive names. Public fixture passwords are recorded in the manifest.
The modified test harness registers CP932/949 encoding providers, records full
entry paths and actual decoded byte counts, checks the EGG CRC independently
(combined contents for the corpus's single-block solid archive), and caps each
output at 64 MiB. The original library sources remain unchanged.

22 positive datasets decode with valid CRC through this independent oracle,
covering Store,
raw Deflate, BZip2, LZMA and AZO; AES128/256, ZipCrypto and LEA128/256; Korean and
Japanese filenames; prefix content-encryption metadata, solid contents and a real two-volume
archive. Expected hashes refer to decoded bytes, not source code assertions.
number.vol2.egg is an additional volume, not a separate first-volume case.

Four outcomes are explicitly not positive product or oracle coverage:
- extattr.egg triggers a NullReferenceException in the pinned reference run.
  Preserve it for independent header analysis and the future native parser.
- zeros.egg reports 197540460 expanded bytes from 338 compressed payload bytes
  in the upstream test. The oracle stops after 64 MiB; no complete-output hash
  is claimed. Preserve it for future EGG resource/risk refusal checks.
- test_lea128_store.egg and test_lea256_store.egg each return 15 zero bytes from
  the pinned upstream LeaStream; that matches the advertised length but fails
  the actual EGG CRC. The original incorrect hashes are retained separately
  as upstreamResult, not used as expected plaintext. Larger LEA128/256 files
  decode correctly and pass CRC. Native LEA must verify short/partial blocks
  independently, rather than copy this upstream bug.

The reference parser is not the production parser: its source acknowledges a
one-block-per-entry assumption. The C++ implementation must support multiple
blocks, check per-block CRC/exact sizes, reject malformed/unbounded metadata,
and use One's existing budgets, path preflight and staged publication. Review
actual samples for parent-path flags; published descriptive material and the
reference implementation disagree about the meaning of flag 0x10.

This corpus prepares and verifies the native implementation path. EGG is not
yet exposed as a supported One archive format.

Run: npm run test:archive-egg-azo
The C++ AZO codec is independently checked against five decoded file hashes in
azoshort_txt.egg, azonumbers.egg (6,999,999 output bytes) and azomulti.egg.
These are real upstream archives, with unchanged compressed streams; expected
contents come from the pinned .NET oracle. Additional codec checks cover model
reset across inner blocks, stored blocks, CC0 x86-filter vectors, all truncated
prefixes of the short stream, invalid framing, memory limits and cancellation.
The x86 vectors are synthetic: the reference oracle ignores the filter flag,
so no independent real filtered-executable coverage is claimed yet.
AZO itself has no content checksum. Product integration must also verify the
enclosing EGG block's CRC, exact output length and packed-byte consumption.

Run: npm run test:archive-egg-container
The C++ bounded directory parser matches 24 reference metadata datasets (the
two CRC-invalid short LEA files are metadata coverage only). It also reads all
five attribute entries and the 197,540,460-byte output-limit entry without
allocating their expanded contents. 374 checks cover multiple blocks, solid
file maps, arbitrary cross-volume header/payload boundaries, reversed input
volume order, missing/duplicate/unrelated/cyclic volumes, truncated archives,
metadata memory/name/count limits and cancellation. Both native suites support
--asan. The container records raw name encoding and parent IDs; production path
preflight and product entry points are still pending. Payload decoding and
authentication are checked independently below.

Run: npm run test:archive-egg-codecs
Requires the existing native archive dependency build (zlib/liblzma libraries
under work/archive-build); no new runtime or downloaded dependency is needed.
The C++ core decodes 25 datasets with valid per-block CRC and exact packed/output
counts. 22 match the independent oracle's file hashes; attributes are checked
against Node's raw Deflate decoder. The two short LEA fixtures decode to the
same CRC-correct plaintext hash, a8a2f6ebe286697c527eb35a58b5539532e9b3ae3b64d4eb0a46fb657b41562c,
instead of the reference's incorrect all-zero data. Larger LEA128/256 hashes
also match the independently decoded AES/ZipCrypto versions of that content.

195 checks cover all five codecs and AES128/256, LEA128/256 and ZipCrypto;
independently generated AES/ZipCrypto multi-block data with continuous cipher
state; AES-wrapped unchanged external AZO streams; every MAC byte, password
verifiers/salts, sticky authentication failures, ciphertext and CRC tampering;
native allocation limits, decoded
output limits and cancellation. Synthetic Unicode-password archives use UTF-8;
other real-writer password encodings are not claimed. --asan instruments the
new native modules and BZip2; zlib/liblzma remain the existing release libraries.
Framing/crypto completion does not expose EGG in One until the product adapter,
staging/path/risk checks, revisions, browser/extraction/drag/CLI are integrated.
An Encrypt Info field preceding a File Header applies to that following entry
only, including when it occurs between completed files. Tests use distinct
AES128/256 keys and MACs in two consecutive prefix-header entries. This does
not claim support for encrypted filenames or the separate unused Global Encrypt
signature; the core explicitly rejects encrypted names and encrypted solid data.
