import Cpp inline '''
inline int invoke_pointer(int (*callback)(int), int value) {
  return callback(value);
}
template<typename F> int invoke_generic(F callback, int value) {
  return callback(value);
}
''';

fn Handler(value: i32) -> i32 { return value + 7; }

fn Run() -> i32 {
  let n: i32 = Cpp.invoke_pointer(Handler, 5);
  return if n == 12 then 0 else 1;
}
