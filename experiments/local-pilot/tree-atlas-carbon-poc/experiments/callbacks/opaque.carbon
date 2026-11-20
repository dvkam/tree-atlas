import Cpp library "opaque.h";

fn Handle(request: Core.Optional(Cpp.Request*)) -> i32 {
  if (not request.HasValue()) { return -1; }
  return Cpp.request_value(request) + 7;
}

fn Run() -> i32 {
  let n: i32 = Cpp.invoke_opaque(Handle);
  return if n == 12 then 0 else 1;
}
