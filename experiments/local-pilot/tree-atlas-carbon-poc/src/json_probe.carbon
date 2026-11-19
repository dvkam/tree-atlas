import Cpp library "<json-c/json.h>";
import Cpp library "<stdio.h>";
import Cpp library "<string_view>";

fn Run() -> i32 {
  let document: Core.Optional(Cpp.json_object*) = Cpp.json_tokener_parse(
      Cpp.std.data("{\"q\":\"Platane – Zürich 🌳\",\"id\":\"0007\"}\0"));
  if (not document.HasValue()) {
    return 1;
  }
  Cpp.puts(Cpp.json_object_to_json_string(document));
  Cpp.json_object_put(document);
  return 0;
}

