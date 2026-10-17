// casc-extract: list or extract files from the local Warcraft III CASC storage (read-only).
//
//   casc-extract <wc3-install-dir> --list <substring>
//   casc-extract <wc3-install-dir> <out-dir> <name>...
//
// Names are CASC paths such as "war3.w3mod:units\unitbalance.slk"; substring matching is
// case-insensitive. Built against upstream CascLib in the container from Containerfile.
#include <CascLib.h>

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

static std::string lower(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return std::tolower(c); });
  return s;
}

static bool extract(HANDLE storage, const std::string& name, const std::string& outDir) {
  HANDLE file = nullptr;
  if (!CascOpenFile(storage, name.c_str(), 0, CASC_OPEN_BY_NAME, &file)) {
    std::fprintf(stderr, "not found: %s (error %u)\n", name.c_str(), GetCascError());
    return false;
  }
  std::string base = name.substr(name.find_last_of(":\\/") + 1);
  std::string outPath = outDir + "/" + base;
  FILE* out = std::fopen(outPath.c_str(), "wb");
  if (!out) {
    CascCloseFile(file);
    std::perror(outPath.c_str());
    return false;
  }
  std::vector<char> buf(1 << 16);
  DWORD read = 0;
  size_t total = 0;
  while (CascReadFile(file, buf.data(), (DWORD)buf.size(), &read) && read > 0) {
    std::fwrite(buf.data(), 1, read, out);
    total += read;
  }
  std::fclose(out);
  CascCloseFile(file);
  std::printf("%s -> %s (%zu bytes)\n", name.c_str(), outPath.c_str(), total);
  return total > 0;
}

int main(int argc, char** argv) {
  if (argc < 4) {
    std::fprintf(stderr, "usage: %s <wc3-dir> --list <substring> | <wc3-dir> <out-dir> <name>...\n", argv[0]);
    return 2;
  }
  CASC_OPEN_STORAGE_ARGS args = {};
  args.Size = sizeof(args);
  args.szLocalPath = argv[1];
  args.szCodeName = "w3";
  HANDLE storage = nullptr;
  if (!CascOpenStorageEx(nullptr, &args, false, &storage)) {
    std::fprintf(stderr, "cannot open CASC storage at %s (error %u)\n", argv[1], GetCascError());
    return 1;
  }

  int status = 0;
  if (std::strcmp(argv[2], "--list") == 0) {
    std::string needle = lower(argv[3]);
    CASC_FIND_DATA fd;
    HANDLE find = CascFindFirstFile(storage, "*", &fd, nullptr);
    if (find) {
      do {
        if (lower(fd.szFileName).find(needle) != std::string::npos) std::printf("%s\n", fd.szFileName);
      } while (CascFindNextFile(find, &fd));
      CascFindClose(find);
    }
  } else {
    for (int i = 3; i < argc; i++) {
      if (!extract(storage, argv[i], argv[2])) status = 1;
    }
  }
  CascCloseStorage(storage);
  return status;
}
