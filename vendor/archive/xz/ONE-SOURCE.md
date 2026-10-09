# liblzma source

Version: XZ Utils 5.8.2, from the official release:
https://github.com/tukaani-project/xz/releases/tag/v5.8.2

Archive: `xz-5.8.2.tar.gz`
SHA-256: `ce09c50a5962786b83e5da389c90dd2c15ecd0980a258dd01f70f9e7ce58a8f1`

Includes the upstream CMake build, liblzma/common sources and the getopt
configuration files required when configuring on Windows. Source files are
unmodified. Only the static `liblzma` target is built and linked into One.Archive.
The XZ command-line tools, gettext, scripts, documentation and tests are disabled.
GNU getopt is not linked into One.Archive. liblzma is licensed under 0BSD;
COPYING and COPYING.0BSD preserve the upstream licensing information, and
COPYING.LGPLv2.1 accompanies the unused getopt source.
