# Encrypted ZIP / ZIPX compatibility fixtures

manifest.json pins three original WinZip AES fixtures from libarchive v3.8.2,
commit 7f53fce04e4e672230f4eb80b219af17975e4f83, libarchive/test/*.zip.uu.
UU decoding preserves their original bytes. The original license notices are
retained in ../LICENSE.libarchive.txt. The public test password is "password".
These are AE-2 files without data descriptors, covering AES128/Deflate,
AES256/Deflate and AES256/Store. The expected README hashes were independently
obtained with 7-Zip 25.01 Windows x64, rather than One's ZIP decoder.

sevenzip-manifest.json describes four original One test payloads archived by
7-Zip 25.01 Windows x64 using:
  7z a -tzip -mem=AES256 -psecret -mm=<method> <output.zipx> payload.txt
Methods are bzip2, lzma, ppmd and xz. payload.txt is the ASCII line
"Independent encrypted ZIPX method fixture" followed by LF, repeated 64 times.
The public test password is "secret". Archive bytes include random salt;
the manifest pins the committed bytes and independently extracted content.
These fixtures exercise the 7-Zip ZIPX reader, including methods unavailable
in the minizip ZIP reader; copying to .zip is deliberately not a claimed flow.
The installed generator did not support ZIP ZSTD creation, so encrypted ZSTD
remains unverified. Non-ASCII passwords also remain a separate compatibility task.

tests/archive-authentication.cjs checks archive hashes and AES metadata, valid
extraction hashes, wrong passwords and damaged authentication footers for both
WinZip fixtures (.zip/.zipx) and advanced ZIPX fixtures. The generated runtime
matrix additionally checks AE-1/AE-2, ZipCrypto, CRC, empty files, descriptor
outputs, and refusal to publish, drag or save damaged contents.
