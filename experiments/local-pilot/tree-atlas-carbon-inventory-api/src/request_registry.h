#pragma once

#include <array>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <cstdio>
#include <cstdint>
#include <limits>
#include <memory>
#include <mutex>
#include <string>
#include <sys/random.h>
#include <unordered_map>
#include <utility>

// Tokens are issued by this process, not supplied by clients. Removing a spent
// token never permits its reuse: claim() requires a live, unclaimed reservation,
// and the process counter never goes backwards or wraps. Only live reservations
// and active attempts consume memory; no tombstones accumulate over uptime.
namespace attempts {
struct QueryState { std::atomic<bool> cancelled{false}; };

class Registry {
  using Clock = std::chrono::steady_clock;
  struct Entry {
    Clock::time_point expires;
    std::shared_ptr<QueryState> state;
  };
  std::mutex mutex_;
  std::unordered_map<std::string, Entry> entries_;
  std::uint64_t counter_ = 0;

  static std::string random_nonce() {
    std::array<unsigned char, 16> entropy{};
    size_t filled = 0;
    while (filled < entropy.size()) {
      ssize_t received = getrandom(entropy.data() + filled, entropy.size() - filled, GRND_NONBLOCK);
      if (received < 0 && errno == EINTR) continue;
      if (received <= 0) return {};
      filled += static_cast<size_t>(received);
    }
    std::string nonce;
    for (unsigned char byte : entropy) {
      char encoded[3];
      std::snprintf(encoded, sizeof(encoded), "%02x", static_cast<unsigned>(byte));
      nonce += encoded;
    }
    return nonce;
  }

  void purge_expired(Clock::time_point now) {
    for (auto it = entries_.begin(); it != entries_.end();) {
      if (!it->second.state && now >= it->second.expires) it = entries_.erase(it);
      else ++it;
    }
  }

 public:
  static constexpr size_t Limit = 4096;
  static constexpr int PendingTtlSeconds = 30;

  std::string issue() {
    std::lock_guard lock(mutex_);
    const auto now = Clock::now();
    purge_expired(now);
    if (entries_.size() >= Limit || counter_ == std::numeric_limits<std::uint64_t>::max()) return {};
    // A shared public process prefix would make adjacent cancellation tokens
    // predictable. Each reservation gets its own checked cryptographic nonce.
    std::string nonce = random_nonce();
    if (nonce.empty()) return {};
    char suffix[18];
    std::snprintf(suffix, sizeof(suffix), "-%016llx", static_cast<unsigned long long>(++counter_));
    std::string id = nonce + suffix;
    entries_.emplace(id, Entry{now + std::chrono::seconds(PendingTtlSeconds), nullptr});
    return id;
  }

  std::shared_ptr<QueryState> claim(const std::string& id) {
    std::lock_guard lock(mutex_);
    auto it = entries_.find(id);
    if (it == entries_.end() || it->second.state) return nullptr;
    if (Clock::now() >= it->second.expires) { entries_.erase(it); return nullptr; }
    auto state = std::make_shared<QueryState>();
    it->second.state = state;
    return state;
  }

  bool cancel(const std::string& id) {
    std::lock_guard lock(mutex_);
    auto it = entries_.find(id);
    if (it == entries_.end()) return false;
    if (!it->second.state) {
      // A pre-submit cancel consumes the reservation so a delayed HTTP request
      // cannot subsequently start work with it. Expired reservations are unknown.
      bool live = Clock::now() < it->second.expires;
      entries_.erase(it);
      return live;
    }
    it->second.state->cancelled = true;
    return true;
  }

  void release(const std::string& id, const std::shared_ptr<QueryState>& state) {
    std::lock_guard lock(mutex_);
    auto it = entries_.find(id);
    if (it != entries_.end() && it->second.state == state) entries_.erase(it);
  }

  size_t size() {
    std::lock_guard lock(mutex_);
    purge_expired(Clock::now());
    return entries_.size();
  }

  size_t pending() {
    std::lock_guard lock(mutex_);
    purge_expired(Clock::now());
    size_t count = 0;
    for (const auto& entry : entries_) if (!entry.second.state) ++count;
    return count;
  }
};

class Registration {
  Registry& registry_;
  std::string id_;
 public:
  std::shared_ptr<QueryState> state;
  bool inserted;
  Registration(Registry& registry, std::string id)
      : registry_(registry), id_(std::move(id)), state(registry_.claim(id_)), inserted(state != nullptr) {}
  ~Registration() { if (inserted) registry_.release(id_, state); }
  Registration(const Registration&) = delete;
  Registration& operator=(const Registration&) = delete;
};
}  // namespace attempts
