#pragma once
#include <json-c/json.h>

// Opaque implementation: HTTP library, pool synchronization and libpq polling
// are private. Carbon owns routing, validation, SQL selection and response data.
struct ServiceRequest;
struct ServiceResult;
using CarbonHandler = int (*)(ServiceRequest*);
int service_run(CarbonHandler);
bool service_path(ServiceRequest*, const char*);
bool service_method(ServiceRequest*, const char*);
bool service_is_json(ServiceRequest*);
json_object* service_parse(ServiceRequest*);
const char* service_string(json_object*, const char*);
int service_number(json_object*, const char*, int fallback);
bool service_valid_id(ServiceRequest*);
void service_reply(ServiceRequest*, int, const char*);
void service_stats(ServiceRequest*);
void service_issue(ServiceRequest*);
bool service_cancel(const char*);
ServiceResult* service_query(ServiceRequest*, const char* sql, const char* value,
                             int sleep_ms, int timeout_ms);
int service_status(ServiceResult*);
const char* service_column(ServiceResult*, int);
void service_result_free(ServiceResult*);
