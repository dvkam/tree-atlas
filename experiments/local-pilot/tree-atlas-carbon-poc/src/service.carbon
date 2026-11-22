import Cpp library "service_runtime.h";
import Cpp library "<string_view>";

fn Error(request: Cpp.ServiceRequest*, status: i32, body: str) -> i32 {
  Cpp.service_reply(request, status, Cpp.std.data(body));
  return status;
}

fn Handle(optional: Core.Optional(Cpp.ServiceRequest*)) -> i32 {
  if (not optional.HasValue()) { return 500; }
  let request: Cpp.ServiceRequest* = optional.Get();
  if (Cpp.service_path(request, Cpp.std.data("/attempt\0"))) {
    if (not Cpp.service_method(request, Cpp.std.data("POST\0"))) {
      return Error(request, 405, "{\"error\":\"method\"}\0");
    }
    Cpp.service_issue(request);
    return 200;
  }
  if (Cpp.service_path(request, Cpp.std.data("/health\0"))) {
    if (not Cpp.service_method(request, Cpp.std.data("GET\0"))) {
      return Error(request, 405, "{\"error\":\"method\"}\0");
    }
    return Error(request, 200, "{\"ok\":true}\0");
  }
  if (Cpp.service_path(request, Cpp.std.data("/stats\0"))) {
    if (not Cpp.service_method(request, Cpp.std.data("GET\0"))) {
      return Error(request, 405, "{\"error\":\"method\"}\0");
    }
    Cpp.service_stats(request);
    return 200;
  }
  let cancelling: bool = Cpp.service_path(request, Cpp.std.data("/cancel\0"));
  if (not cancelling and not Cpp.service_path(request, Cpp.std.data("/probe\0"))) {
    return Error(request, 404, "{\"error\":\"not_found\"}\0");
  }
  if (not Cpp.service_method(request, Cpp.std.data("POST\0"))) {
    return Error(request, 405, "{\"error\":\"method\"}\0");
  }
  if (not Cpp.service_is_json(request)) {
    return Error(request, 415, "{\"error\":\"content_type\"}\0");
  }
  let document: Core.Optional(Cpp.json_object*) = Cpp.service_parse(request);
  if (not document.HasValue()) {
    return Error(request, 400, "{\"error\":\"invalid\"}\0");
  }
  if (cancelling) {
    let id: Core.Optional(const char*) = Cpp.service_string(document, Cpp.std.data("id\0"));
    if (not id.HasValue()) {
      Cpp.json_object_put(document);
      return Error(request, 400, "{\"error\":\"invalid\"}\0");
    }
    let found: bool = Cpp.service_cancel(id);
    Cpp.json_object_put(document);
    if (found) { return Error(request, 200, "{\"cancelled\":true}\0"); }
    return Error(request, 404, "{\"cancelled\":false}\0");
  }
  let value: Core.Optional(const char*) = Cpp.service_string(document, Cpp.std.data("value\0"));
  let sleep_ms: i32 = Cpp.service_number(document, Cpp.std.data("sleep_ms\0"), 0);
  let timeout_ms: i32 = Cpp.service_number(document, Cpp.std.data("timeout_ms\0"), 1200);
  if (not value.HasValue() or sleep_ms < 0 or sleep_ms > 1500 or timeout_ms < 100 or timeout_ms > 1500 or not Cpp.service_valid_id(request)) {
    Cpp.json_object_put(document);
    return Error(request, 400, "{\"error\":\"invalid\"}\0");
  }
  let result: Core.Optional(Cpp.ServiceResult*) = Cpp.service_query(request,
      Cpp.std.data("SELECT $1::text, pg_backend_pid()::text, (SELECT label FROM public.poc_probe WHERE id='0007'), pg_sleep($2::int / 1000.0)\0"), value, sleep_ms, timeout_ms);
  Cpp.json_object_put(document);
  if (not result.HasValue()) { return Error(request, 503, "{\"error\":\"database\"}\0"); }
  let status: i32 = Cpp.service_status(result);
  if (status != 200) {
    Cpp.service_result_free(result);
    if (status == 504) { return Error(request, 504, "{\"error\":\"timeout\"}\0"); }
    if (status == 409) { return Error(request, 409, "{\"error\":\"cancelled\"}\0"); }
    if (status == 429) { return Error(request, 409, "{\"error\":\"conflict\"}\0"); }
    if (status == 502) { return Error(request, 503, "{\"error\":\"busy\"}\0"); }
    return Error(request, 503, "{\"error\":\"database\"}\0");
  }
  let response: Core.Optional(Cpp.json_object*) = Cpp.json_object_new_object();
  if (not response.HasValue()) {
    Cpp.service_result_free(result);
    return Error(request, 503, "{\"error\":\"database\"}\0");
  }
  Cpp.json_object_object_add(response, Cpp.std.data("echo\0"), Cpp.json_object_new_string(Cpp.service_column(result, 0)));
  Cpp.json_object_object_add(response, Cpp.std.data("pid\0"), Cpp.json_object_new_string(Cpp.service_column(result, 1)));
  Cpp.json_object_object_add(response, Cpp.std.data("fixture\0"), Cpp.json_object_new_string(Cpp.service_column(result, 2)));
  Cpp.service_reply(request, 200, Cpp.json_object_to_json_string(response));
  Cpp.json_object_put(response);
  Cpp.service_result_free(result);
  return 200;
}

fn Run() -> i32 {
  return Cpp.service_run(Handle);
}
