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
entry paths and actual decoded byte counts, and caps each output at 64 MiB.

24 positive datasets decode through this independent oracle, covering Store,
raw Deflate, BZip2, LZMA and AZO; AES128/256, ZipCrypto and LEA128/256; Korean and
Japanese filenames; encrypted headers, solid contents and a real two-volume
archive. Expected hashes refer to decoded bytes, not source code assertions.
number.vol2.egg is an additional volume, not a separate first-volume case.

Two outcomes are explicitly not positive product or oracle coverage:
- extattr.egg triggers a NullReferenceException in the pinned reference parser.
  Preserve it for independent header analysis and the future native parser.
- zeros.egg reports 197540460 expanded bytes from 338 compressed payload bytes
  in the upstream test. The oracle stops after 64 MiB; no complete-output hash
  is claimed. Preserve it for future EGG resource/risk refusal checks.

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
