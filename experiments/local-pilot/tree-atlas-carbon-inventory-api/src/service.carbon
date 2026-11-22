import Cpp library "service_runtime.h";
import Cpp library "<string_view>";

fn Reply(request: Cpp.ServiceRequest*, status: i32, body: str) -> i32 {
  Cpp.service_reply(request, status, Cpp.std.data(body));
  return status;
}
fn Execute(request: Cpp.ServiceRequest*, document: Cpp.json_object*, primary: str, secondary: str, operation: str) -> i32 {
  let result: Core.Optional(Cpp.ServiceResult*) = Cpp.inventory_execute(request,
      Cpp.std.data(primary), Cpp.std.data(secondary), document, Cpp.std.data(operation));
  Cpp.json_object_put(document);
  if (not result.HasValue()) { return Reply(request, 503, "{\"error\":\"database\"}\0"); }
  let status: i32 = Cpp.service_status(result);
  Cpp.service_reply(request, status, Cpp.inventory_payload(result));
  Cpp.service_result_free(result);
  return status;
}
fn Handle(optional: Core.Optional(Cpp.ServiceRequest*)) -> i32 {
  if (not optional.HasValue()) { return 500; }
  let request: Cpp.ServiceRequest* = optional.Get();
  if (Cpp.service_path(request, Cpp.std.data("/health\0")) or Cpp.service_path(request, Cpp.std.data("/stats\0"))) {
    if (not Cpp.service_method(request, Cpp.std.data("GET\0"))) { return Reply(request, 405, "{\"error\":\"method\"}\0"); }
    if (Cpp.service_path(request, Cpp.std.data("/stats\0"))) { Cpp.service_stats(request); return 200; }
    return Reply(request, 200, "{\"ok\":true}\0");
  }
  if (not Cpp.service_method(request, Cpp.std.data("POST\0"))) { return Reply(request, 405, "{\"error\":\"method\"}\0"); }
  if (Cpp.service_path(request, Cpp.std.data("/attempt\0"))) { Cpp.service_issue(request); return 200; }
  if (not Cpp.service_is_json(request)) { return Reply(request, 415, "{\"error\":\"content_type\"}\0"); }
  let document: Core.Optional(Cpp.json_object*) = Cpp.service_parse(request);
  if (not document.HasValue()) { return Reply(request, 400, "{\"error\":\"invalid_input\"}\0"); }
  if (Cpp.service_path(request, Cpp.std.data("/cancel\0"))) {
    let id: Core.Optional(const char*) = Cpp.service_string(document, Cpp.std.data("id\0"));
    if (not id.HasValue()) { Cpp.json_object_put(document); return Reply(request, 400, "{\"error\":\"invalid_input\"}\0"); }
    let found: bool = Cpp.service_cancel(id);
    Cpp.json_object_put(document);
    if (found) { return Reply(request, 200, "{\"cancelled\":true}\0"); }
    return Reply(request, 404, "{\"cancelled\":false}\0");
  }
  if (Cpp.service_path(request, Cpp.std.data("/v1/query\0"))) {
    return Execute(request, document.Get(), "SELECT atlas_api.summary($1::jsonb,$2::text)::text\0", "SELECT atlas_api.page($1::jsonb,$2::text)::text\0", "query\0");
  }
  if (Cpp.service_path(request, Cpp.std.data("/v1/viewport-page\0"))) {
    return Execute(request, document.Get(), "SELECT atlas_api.viewport_page($1::jsonb,$2::text)::text\0", "\0", "viewport-page\0");
  }
  if (Cpp.service_path(request, Cpp.std.data("/v1/cluster-members\0"))) {
    return Execute(request, document.Get(), "SELECT atlas_api.cluster_members($1::jsonb,$2::text)::text\0", "\0", "cluster-members\0");
  }
  if (Cpp.service_path(request, Cpp.std.data("/v1/detail\0"))) {
    return Execute(request, document.Get(), "SELECT atlas_api.detail($1::jsonb,$2::text)::text\0", "\0", "detail\0");
  }
  if (Cpp.service_path(request, Cpp.std.data("/v1/suggest\0"))) {
    return Execute(request, document.Get(), "SELECT atlas_api.suggest($1::jsonb,$2::text)::text\0", "\0", "suggest\0");
  }
  if (Cpp.service_path(request, Cpp.std.data("/v1/release\0"))) {
    return Execute(request, document.Get(), "SELECT atlas_api.release_info($1::jsonb,$2::text)::text\0", "\0", "release\0");
  }
  if (Cpp.service_path(request, Cpp.std.data("/v1/catalogue\0"))) {
    return Execute(request, document.Get(), "SELECT atlas_api.catalogue($1::jsonb,$2::text)::text\0", "\0", "catalogue\0");
  }
  Cpp.json_object_put(document);
  return Reply(request, 404, "{\"error\":\"not_found\"}\0");
}
fn Run() -> i32 { return Cpp.service_run(Handle); }
