import Cpp library "poc_support.h";
import Cpp library "<stdlib.h>";
import Cpp library "<string_view>";

fn Serve(fd: i32) -> i32 {
  var bytes: array(char, 4097);
  var used: i32 = 0;
  var framed: i32 = 0;
  while (framed == 0 and used < 4096) {
    let amount: Cpp.ssize_t = Cpp.poc_read(fd, &bytes[used], (4096 - used) as Cpp.size_t);
    if (amount <= 0) { return 400; }
    used += amount as i32;
    bytes[used] = '\0';
    framed = Cpp.poc_frame(&bytes[0], used);
  }
  if (framed < 0) { return -framed; }
  if (framed == 0) { return 413; }
  if (not Cpp.poc_route(&bytes[0])) { return 404; }
  let document: Core.Optional(Cpp.json_object*) = Cpp.poc_parse_body(&bytes[0], used);
  if (not document.HasValue()) { return 400; }
  let value: Core.Optional(const char*) = Cpp.poc_string(document, Cpp.std.data("value\0"));
  if (not value.HasValue()) { Cpp.json_object_put(document); return 400; }

  let config: Core.Optional(const char*) = Cpp.getenv(Cpp.std.data("TREE_ATLAS_PG\0"));
  if (not config.HasValue()) { Cpp.json_object_put(document); return 503; }
  let connection: Core.Optional(Cpp.PGconn*) = Cpp.PQconnectdb(config);
  if (not connection.HasValue()) { Cpp.json_object_put(document); return 503; }
  if (Cpp.poc_connection_status(connection) != 0) {
    Cpp.PQfinish(connection); Cpp.json_object_put(document); return 503;
  }
  let result: Core.Optional(Cpp.PGresult*) = Cpp.poc_parameter(connection,
      Cpp.std.data("SELECT $1::text, current_database(), (SELECT label FROM public.poc_probe WHERE id = '0007')\0"), value);
  if (not result.HasValue()) {
    Cpp.PQfinish(connection); Cpp.json_object_put(document); return 503;
  }
  if (Cpp.poc_result_status(result) != 2 or Cpp.PQntuples(result) != 1) {
    Cpp.PQclear(result); Cpp.PQfinish(connection);
    Cpp.json_object_put(document); return 503;
  }
  let response: Core.Optional(Cpp.json_object*) = Cpp.json_object_new_object();
  if (not response.HasValue()) {
    Cpp.PQclear(result); Cpp.PQfinish(connection);
    Cpp.json_object_put(document); return 503;
  }
  Cpp.json_object_object_add(response, Cpp.std.data("echo\0"),
      Cpp.json_object_new_string(Cpp.PQgetvalue(result, 0, 0)));
  Cpp.json_object_object_add(response, Cpp.std.data("database\0"),
      Cpp.json_object_new_string(Cpp.PQgetvalue(result, 0, 1)));
  Cpp.json_object_object_add(response, Cpp.std.data("fixture\0"),
      Cpp.json_object_new_string(Cpp.PQgetvalue(result, 0, 2)));
  Cpp.poc_response(fd, 200, Cpp.json_object_to_json_string(response));
  Cpp.json_object_put(response);
  Cpp.PQclear(result); Cpp.PQfinish(connection);
  Cpp.json_object_put(document);
  return 200;
}

fn Run() -> i32 {
  let listener: i32 = Cpp.poc_listen();
  if (listener < 0) { return 1; }
  let client: i32 = Cpp.poc_accept(listener);
  Cpp.close(listener);
  if (client < 0) { return 2; }
  let status: i32 = Serve(client);
  if (status != 200) {
    Cpp.poc_response(client, status, Cpp.std.data("{\"error\":\"probe_failed\"}\0"));
  }
  Cpp.close(client);
  return 0;
}
