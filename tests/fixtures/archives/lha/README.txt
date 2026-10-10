LHA level-3 regression data

Four unchanged archives from fragglet/lhasa's test/archives/lha_os2_208/,
pinned to the commit and download hash in manifest.json. The upstream writer
notes are preserved in SOURCE.lha-os2.txt and the ISC license in
LICENSE.lhasa.txt. They were created with LHA for OS/2 v2.08, "lha a -arde":
stored/compressed data, long filename and nested directories. The GPL-2 and
GPL-2.gz payloads are GNU license texts used by the upstream test corpus.

Expected names, sizes, SHA-256 and modification times were independently
extracted with Windows bsdtar/libarchive 3.8.8; its actual binary hash and
version are recorded. The CP932 case references the unchanged libarchive
fixture in the parent directory. The independent oracle used
"tar --options lha:hdrcharset=CP932 -xf ...". Its two names are "漢字.txt"
and "表.txt"; the latter's CP932 bytes include a trail 0x5c, not a separator.

The product test uses these fixed expectations without needing the oracle,
network, Python or an external LHA program. Additional original generated
level-3 cases in tests/archive-lha.cjs cover >64KiB extensions, header CRC,
length/count bounds, automatic declared code pages versus manual overrides,
all six selectable encodings, unsafe paths and Unix link modes. Synthetic cases do
not replace the four real writer samples.
