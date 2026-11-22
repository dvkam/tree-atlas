#include "normalizer.h"
#include <unicode/uchar.h>
#include <unicode/unorm2.h>
#include <unicode/ustring.h>
#include <unicode/utf16.h>
#include <unicode/uversion.h>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <vector>

namespace atlas_unicode {
namespace {
std::vector<UChar> from_utf8(const std::string& text) {
  if (text.size() > static_cast<std::size_t>(std::numeric_limits<int32_t>::max()))
    throw std::invalid_argument("Unicode input is too large");
  UErrorCode status = U_ZERO_ERROR;
  int32_t required = 0;
  u_strFromUTF8(nullptr, 0, &required, text.data(), static_cast<int32_t>(text.size()), &status);
  if (status != U_BUFFER_OVERFLOW_ERROR && U_FAILURE(status))
    throw std::invalid_argument("Invalid UTF-8 scalar text");
  status = U_ZERO_ERROR;
  std::vector<UChar> output(static_cast<std::size_t>(required) + 1);
  int32_t length = 0;
  u_strFromUTF8(output.data(), static_cast<int32_t>(output.size()), &length,
                text.data(), static_cast<int32_t>(text.size()), &status);
  if (U_FAILURE(status)) throw std::invalid_argument("Invalid UTF-8 scalar text");
  output.resize(length);
  return output;
}
bool ecma_trim(UChar code) {
  return code == 0x0009 || code == 0x000a || code == 0x000b || code == 0x000c ||
    code == 0x000d || code == 0x0020 || code == 0x00a0 || code == 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) || code == 0x2028 || code == 0x2029 ||
    code == 0x202f || code == 0x205f || code == 0x3000 || code == 0xfeff;
}
}
void assert_version() {
  static const bool checked = [] {
    UVersionInfo icu{}, unicode{};
    u_getVersion(icu);
    u_getUnicodeVersion(unicode);
    if (icu[0] != 78 || icu[1] != 3 || unicode[0] != 17 || unicode[1] != 0)
      throw std::runtime_error("Frozen ICU78.3 / Unicode17.0 is required");
    return true;
  }();
  (void)checked;
}
std::size_t utf16_length(const std::string& text) {
  assert_version();
  return from_utf8(text).size();
}
std::string normalize(const std::string& text) {
  assert_version();
  // At most 500 UTF-16 units can occupy 1,500 valid UTF-8 bytes. Reject huge
  // request input before allocation; utf16_length remains available separately.
  if (text.size() > 1500) throw std::invalid_argument("Query exceeds 500 UTF-16 units");
  auto input = from_utf8(text);
  if (input.size() > 500) throw std::invalid_argument("Query exceeds 500 UTF-16 units");
  UErrorCode status = U_ZERO_ERROR;
  const UNormalizer2* nfd = unorm2_getNFDInstance(&status);
  if (U_FAILURE(status)) throw std::runtime_error("NFD initialization failed");
  int32_t required = unorm2_normalize(nfd, input.data(), static_cast<int32_t>(input.size()), nullptr, 0, &status);
  if (status != U_BUFFER_OVERFLOW_ERROR && U_FAILURE(status)) throw std::runtime_error("NFD failed");
  status = U_ZERO_ERROR;
  std::vector<UChar> decomposed(static_cast<std::size_t>(required) + 1);
  int32_t length = unorm2_normalize(nfd, input.data(), static_cast<int32_t>(input.size()),
                                    decomposed.data(), static_cast<int32_t>(decomposed.size()), &status);
  if (U_FAILURE(status)) throw std::runtime_error("NFD failed");
  std::vector<UChar> filtered;
  filtered.reserve(length + 1);
  for (int32_t offset = 0; offset < length;) {
    UChar32 code;
    U16_NEXT(decomposed.data(), offset, length, code);
    if (u_hasBinaryProperty(code, UCHAR_DIACRITIC)) continue;
    if (code <= 0xffff) filtered.push_back(static_cast<UChar>(code));
    else { filtered.push_back(U16_LEAD(code)); filtered.push_back(U16_TRAIL(code)); }
  }
  // ICU's empty locale is root, whereas nullptr would use the host locale.
  status = U_ZERO_ERROR;
  required = u_strToLower(nullptr, 0, filtered.data(), static_cast<int32_t>(filtered.size()), "", &status);
  if (status != U_BUFFER_OVERFLOW_ERROR && U_FAILURE(status)) throw std::runtime_error("Root lowercase failed");
  status = U_ZERO_ERROR;
  std::vector<UChar> lower(static_cast<std::size_t>(required) + 1);
  length = u_strToLower(lower.data(), static_cast<int32_t>(lower.size()), filtered.data(),
                        static_cast<int32_t>(filtered.size()), "", &status);
  if (U_FAILURE(status)) throw std::runtime_error("Root lowercase failed");
  int32_t first = 0, end = length;
  while (first < end && ecma_trim(lower[first])) ++first;
  while (end > first && ecma_trim(lower[end-1])) --end;
  status = U_ZERO_ERROR;
  required = 0;
  u_strToUTF8(nullptr, 0, &required, lower.data()+first, end-first, &status);
  if (status != U_BUFFER_OVERFLOW_ERROR && U_FAILURE(status)) throw std::runtime_error("UTF-8 encoding failed");
  status = U_ZERO_ERROR;
  std::string output(static_cast<std::size_t>(required), '\0');
  u_strToUTF8(output.data(), required, nullptr, lower.data()+first, end-first, &status);
  if (U_FAILURE(status)) throw std::runtime_error("UTF-8 encoding failed");
  return output;
}
}
