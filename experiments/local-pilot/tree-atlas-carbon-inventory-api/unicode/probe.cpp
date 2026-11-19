#include "normalizer.h"
#include <cstdio>
#include <cstdlib>
#include <exception>
#include <string>
#include <stdexcept>
namespace {
int nibble(char c) { return c >= '0' && c <= '9' ? c-'0' : c >= 'a' && c <= 'f' ? c-'a'+10 : -1; }
}
int main() {
  atlas_unicode::assert_version();
  char* line = nullptr;
  size_t capacity = 0;
  ssize_t length;
  while ((length = getline(&line, &capacity, stdin)) >= 0) {
    if (length && line[length-1] == '\n') --length;
    try {
      if (length % 2) throw std::invalid_argument("odd hex");
      std::string input;
      for (ssize_t offset = 0; offset < length; offset += 2) {
        int high = nibble(line[offset]), low = nibble(line[offset+1]);
        if (high < 0 || low < 0) throw std::invalid_argument("bad hex");
        input.push_back(static_cast<char>(high*16+low));
      }
      const auto normalized = atlas_unicode::normalize(input);
      std::printf("OK %zu ", atlas_unicode::utf16_length(input));
      for (unsigned char c : normalized) std::printf("%02x", static_cast<unsigned>(c));
      std::printf("\n");
    } catch (const std::exception&) { std::printf("ERROR\n"); }
  }
  std::free(line);
}
