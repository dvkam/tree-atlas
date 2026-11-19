#include "opaque.h"
struct Request { int value; };
int invoke_opaque(RequestHandler handler) {
  Request request{5};
  return handler(&request);
}
int request_value(Request* request) { return request->value; }
