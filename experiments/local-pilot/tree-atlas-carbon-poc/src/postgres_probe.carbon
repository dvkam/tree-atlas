import Cpp library "<libpq-fe.h>";
import Cpp library "<stdlib.h>";
import Cpp library "<stdio.h>";
import Cpp library "<string_view>";

// Adapt only libpq's nullable pointer-array parameter. SQL stays in Carbon.
import Cpp inline '''
inline PGresult* poc_parameter(PGconn* connection, const char* sql,
                               const char* value) {
  const char* values[] = {value};
  return PQexecParams(connection, sql, 1, nullptr, values, nullptr, nullptr, 0);
}
inline int poc_connection_status(PGconn* connection) { return PQstatus(connection); }
inline int poc_result_status(PGresult* result) { return PQresultStatus(result); }
''';

fn Run() -> i32 {
  let config: Core.Optional(const char*) =
      Cpp.getenv(Cpp.std.data("TREE_ATLAS_PG\0"));
  if (not config.HasValue()) { return 1; }
  let connection: Core.Optional(Cpp.PGconn*) = Cpp.PQconnectdb(config);
  if (not connection.HasValue()) { return 2; }
  if (Cpp.poc_connection_status(connection) != 0) {
    Cpp.PQfinish(connection);
    return 3;
  }
  let result: Core.Optional(Cpp.PGresult*) = Cpp.poc_parameter(
      connection, Cpp.std.data("SELECT $1::text AS echo\0"),
      Cpp.std.data("0007 – Zürich 🌳 '; DROP TABLE poc_probe; --\0"));
  if (not result.HasValue()) { Cpp.PQfinish(connection); return 4; }
  if (Cpp.poc_result_status(result) != 2) {
    Cpp.PQclear(result); Cpp.PQfinish(connection); return 5;
  }
  Cpp.puts(Cpp.PQgetvalue(result, 0, 0));
  Cpp.PQclear(result);
  Cpp.PQfinish(connection);
  return 0;
}
