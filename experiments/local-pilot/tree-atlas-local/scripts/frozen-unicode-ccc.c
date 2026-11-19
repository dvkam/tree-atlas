#include <stdio.h>
#include <unicode/uchar.h>
#include <unicode/uversion.h>
int main(void) {
  UVersionInfo version;
  u_getUnicodeVersion(version);
  if (version[0] != 17 || version[1] != 0) return 1;
  printf("{");
  int first = 1;
  for (int code = 0; code < 0x110000; code++) {
    int combining = u_getCombiningClass(code);
    if (!combining) continue;
    if (!first) printf(",");
    printf("\"%d\":%d", code, combining);
    first = 0;
  }
  printf("}");
  return 0;
}
