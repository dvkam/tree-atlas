import Cpp library "<thread>";
import Cpp inline '''
#include <thread>
#include <atomic>
#include <chrono>
inline std::atomic<int> callback_entries{0};
inline int overlap_gate() {
  callback_entries.fetch_add(1);
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
  while (callback_entries.load() < 2) {
    if (std::chrono::steady_clock::now() >= deadline) return 0;
    std::this_thread::yield();
  }
  return 1;
}
template<typename F> int invoke_threads(F callback) {
  int a = 0;
  int b = 0;
  std::thread first([&]{ a = callback(4); });
  std::thread second([&]{ b = callback(9); });
  first.join();
  second.join();
  return a + b;
}
''';

fn Handler(value: i32) -> i32 {
  if (Cpp.overlap_gate() != 1) { return -1000; }
  return value + 7;
}

fn Run() -> i32 {
  let n: i32 = Cpp.invoke_threads(Handler);
  return if n == 27 then 0 else 1;
}
