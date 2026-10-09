ALZ read-only fixtures (2026-10-10)

manifest.json pins archive byte sizes/SHA256 and expected decoded file hashes.
Tests need no network, Python, external unalz, or external 7z.

Generated for One:
- methods.alz: explicit zero-width directory, Store/Deflate/DLZ/standard BZh,
  width 1/2/4/8 fields and CP949 Korean filename.
- dlz-multiblock.alz: 416000 deterministic SHA256-derived bytes, five 100k
  bzip2 blocks transformed to ALZ DLZ framing; crosses input/output buffers.
- encrypted.alz: ZipCrypto Store/DLZ/Deflate, password "secret".
- korean-password.alz: CP949 Korean filename/password, password "비밀".
- utf8.alz: explicit UTF-8 filename selection.

DLZ generation removes BZh, replaces each 48-bit block marker with DLZ01,
removes the 32-bit block CRC/randomisation bit, replaces the end marker with
DLZ02, removes combined CRC, then pads the bitstream. The outer entry CRC32
is unchanged. Large DLZ and all three encrypted methods were independently
decoded and byte-hashed with compiled UnAlz 0.65, three repetitions each.
The test-only reference initialises its otherwise uninitialised DLZ
blockRandomised field to false; its original codec/framing is retained.
Oracle results are local at work/current/archive-alz/oracle-results.json.
Standard BZh and the real fixtures below have independent Python bz2/zlib
expected hashes. Standard BZh is not supported by the old UnAlz DLZ codec.

Real small text fixtures:
- bzip2.alz, deflate.alz, uncompressed.alz from Cisco-Talos/clamav,
  commit 72cd48c9faed4fa4afc22bc4ed0b9b19f8d3f8f7,
  unit_tests/input/other_scanfiles/alz/. Contents are ordinary test text;
  no executable or malware fixtures are included. GPL-2.0 license retained
  as CLAMAV-COPYING.txt. Used only as test data, never in the application.
- patool.alz from wummel/patool, commit
  eb8185c6ef6e5fc0ed22a495d0c7bf18bb7d8c58, tests/data/t.alz.
  GPL-3.0 license retained as PATOOL-COPYING.txt. Test data only.

Runtime supports verified single-volume ALZ v10 headers and methods 0/1/2.
Split volumes, data descriptors, unknown flag combinations and other
versions fail explicitly. No ALZ creation or editing is enabled.
