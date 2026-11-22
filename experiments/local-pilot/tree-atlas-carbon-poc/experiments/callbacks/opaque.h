#pragma once
struct Request;
using RequestHandler = int (*)(Request*);
int invoke_opaque(RequestHandler handler);
int request_value(Request* request);
