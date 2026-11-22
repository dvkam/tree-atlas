#pragma once
#include <cstddef>
#include <string>

namespace atlas_unicode {
// Strict scalar UTF-8. utf16_length does not impose a query length limit.
std::size_t utf16_length(const std::string& utf8);
// Frozen Unicode17 NFD / Diacritic removal / root lowercase / ECMAScript trim.
// Rejects invalid UTF-8 or more than 500 UTF-16 units with invalid_argument.
std::string normalize(const std::string& utf8);
// Fail closed if a different ICU/Unicode data version was linked or loaded.
void assert_version();
}
