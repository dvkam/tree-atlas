import Cpp inline '''
struct Request { int value; };
using Handler = int (*)(Request* _Nonnull);
inline int invoke_context(Handler handler) {
  Request request{5};
  return handler(&request);
}
''';

fn Handle(request: Cpp.Request*) -> i32 {
  return request->value + 7;
}

fn Run() -> i32 {
  let n: i32 = Cpp.invoke_context(Handle);
  return if n == 12 then 0 else 1;
}
