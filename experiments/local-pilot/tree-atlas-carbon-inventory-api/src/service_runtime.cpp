#include "service_runtime.h"
#include "request_registry.h"
#include <microhttpd.h>
#include <libpq-fe.h>
#include <arpa/inet.h>
#include <array>
#include <atomic>
#include <chrono>
#include <charconv>
#include <condition_variable>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <mutex>
#include <poll.h>
#include <string>
#include <thread>
#include <unordered_map>
#include <unistd.h>

using Clock = std::chrono::steady_clock;
using Millis = std::chrono::milliseconds;
struct Transport {
  int fd;
  explicit Transport(int socket): fd(socket) {}
  Clock::time_point deadline = Clock::now() + Millis(1500);
  std::atomic<bool> abandoned{false};
};
struct ServiceRequest {
  MHD_Connection* connection;
  std::string path, method, body, id;
  std::shared_ptr<Transport> transport;
  Clock::time_point started = Clock::now();
  bool replied = false;
};
struct ServiceResult {
  int status = 503;
  std::string payload, error = "database";
  PGresult* result = nullptr;
  ~ServiceResult() { if (result) PQclear(result); }
};
namespace {
constexpr int Capacity = 2;
constexpr int Waiters = 16;
CarbonHandler handler;
std::atomic<bool> stopping{false};
static_assert(std::atomic<bool>::is_always_lock_free);
void stop(int) { stopping.store(true, std::memory_order_relaxed); }
std::mutex transports_mutex;
std::unordered_map<MHD_Connection*, std::shared_ptr<Transport>> transports;
void connection_notify(void*, MHD_Connection* connection, void**, MHD_ConnectionNotificationCode event) {
  std::lock_guard lock(transports_mutex);
  if (event == MHD_CONNECTION_NOTIFY_STARTED) {
    const auto* info = MHD_get_connection_info(connection, MHD_CONNECTION_INFO_CONNECTION_FD);
    if (info) transports.emplace(connection, std::make_shared<Transport>(info->connect_fd));
  } else {
    // MHD calls CLOSED before closing its fd. Removal under this lock prevents
    // the watchdog from shutting down a descriptor after the OS has reused it.
    auto found = transports.find(connection);
    if (found != transports.end()) {
      found->second->abandoned = true;
      transports.erase(found);
    }
  }
}
void transport_deadline(MHD_Connection* connection, Clock::time_point deadline) {
  std::lock_guard lock(transports_mutex);
  auto found = transports.find(connection);
  if (found != transports.end()) found->second->deadline = deadline;
}
void inspect_transports() {
  std::lock_guard lock(transports_mutex);
  for (auto& entry : transports) {
    auto& transport = *entry.second;
    if (transport.abandoned) continue;
    pollfd descriptor{transport.fd, 0, 0};
    int ready = poll(&descriptor, 1, 0);
    bool failed = ready > 0 && (descriptor.revents & (POLLERR | POLLHUP | POLLNVAL));
    // Do not use POLLIN/EOF/RDHUP: a legitimate write-half-close is ambiguous.
    if (failed || Clock::now() >= transport.deadline) {
      transport.abandoned = true;
      shutdown(transport.fd, SHUT_RDWR); // MHD remains the sole owner of close().
    }
  }
}
using attempts::QueryState;
using attempts::Registration;
attempts::Registry registry;
int wait_socket(int fd, short events, Clock::time_point deadline) {
  if (Clock::now() >= deadline || fd < 0) return -1;
  auto left = std::chrono::duration_cast<Millis>(deadline - Clock::now()).count() + 1;
  pollfd poller{fd, events, 0};
  int result = poll(&poller, 1, static_cast<int>(std::min<long long>(left, 10)));
  if (result < 0 && errno == EINTR) return 0;
  if (result > 0 && (poller.revents & (POLLERR | POLLHUP | POLLNVAL))) return -1;
  return result;
}
PGconn* connect_database(const std::string& config, Clock::time_point deadline, Transport* transport = nullptr) {
  PGconn* connection = PQconnectStart(config.c_str());
  if (!connection) return nullptr;
  while (Clock::now() < deadline && !stopping && !(transport && transport->abandoned)) {
    auto status = PQconnectPoll(connection);
    if (status == PGRES_POLLING_OK) {
      if (PQsetnonblocking(connection, 1) == 0) return connection;
      break;
    }
    if (status == PGRES_POLLING_FAILED) break;
    short events = status == PGRES_POLLING_READING ? POLLIN : POLLOUT;
    if (wait_socket(PQsocket(connection), events, deadline) < 0) break;
  }
  PQfinish(connection);
  return nullptr;
}
struct Pool {
  struct Slot { PGconn* connection = nullptr; bool busy = false; };
  std::array<Slot, Capacity> slots;
  std::mutex mutex;
  std::condition_variable changed;
  std::string config;
  int waiting = 0, active = 0, max_active = 0;
  std::atomic<int> cancellations{0}, acknowledged{0}, reconnects{0};
  explicit Pool(std::string source): config(std::move(source)) {
    config += " application_name=tree_atlas_inventory_api";
  }
  ~Pool() { for (auto& slot : slots) if (slot.connection) PQfinish(slot.connection); }
  bool initialize() {
    for (auto& slot : slots) {
      slot.connection = connect_database(config, Clock::now() + Millis(2000));
      if (!slot.connection) return false;
    }
    return true;
  }
  int acquire(const std::shared_ptr<QueryState>& state, Clock::time_point deadline, Transport* transport) {
    auto until = std::min(deadline, Clock::now() + Millis(250));
    std::unique_lock lock(mutex);
    bool counted = false;
    while (true) {
      if (state->cancelled || stopping || transport->abandoned || Clock::now() >= deadline) {
        if (counted) --waiting;
        return -2;
      }
      for (int i = 0; i < Capacity; ++i) if (!slots[i].busy) {
        if (counted) --waiting;
        slots[i].busy = true;
        ++active;
        max_active = std::max(max_active, active);
        return i;
      }
      if (!counted) {
        if (waiting >= Waiters) return -1;
        ++waiting;
        counted = true;
      }
      if (Clock::now() >= until) { --waiting; return -1; }
      changed.wait_until(lock, std::min(until, Clock::now() + Millis(10)));
    }
  }
  PGconn* connection(int index, Clock::time_point deadline, Transport* transport) {
    PGconn* current;
    { std::lock_guard lock(mutex); current = slots[index].connection; }
    if (!current) {
      current = connect_database(config, deadline, transport);
      { std::lock_guard lock(mutex); slots[index].connection = current; }
      if (current) ++reconnects;
    }
    return current;
  }
  void release(int index, bool discard) {
    PGconn* old = nullptr;
    {
      std::lock_guard lock(mutex);
      if (discard) { old = slots[index].connection; slots[index].connection = nullptr; }
    }
    if (old) PQfinish(old);
    {
      std::lock_guard lock(mutex);
      slots[index].busy = false;
      --active;
    }
    changed.notify_all();
  }
};
std::unique_ptr<Pool> pool;
struct Lease {
  int index;
  bool discard = false;
  ~Lease() { pool->release(index, discard); }
};
void cancel_and_retire(PGconn* connection) {
  ++pool->cancellations;
  // Cancellation has its own bounded cleanup allowance after the SQL deadline.
  // Never reuse this session, including when dispatch fails or is abandoned.
  const auto cancel_deadline = Clock::now() + Millis(150);
  PGcancelConn* cancel = PQcancelCreate(connection);
  if (cancel) {
    if (PQcancelStart(cancel)) {
      auto status = PGRES_POLLING_WRITING;
      while (Clock::now() < cancel_deadline) {
        if (status == PGRES_POLLING_OK || status == PGRES_POLLING_FAILED) break;
        // libpq may replace this descriptor after each polling transition.
        int fd = PQcancelSocket(cancel);
        if (fd < 0) break;
        short events = status == PGRES_POLLING_READING ? POLLIN : POLLOUT;
        pollfd descriptor{fd, events, 0};
        auto left = std::chrono::duration_cast<Millis>(cancel_deadline - Clock::now()).count();
        int ready = poll(&descriptor, 1, static_cast<int>(std::max<long long>(0, std::min<long long>(left, 10))));
        if (ready < 0) { if (errno == EINTR) continue; break; }
        if (!ready) continue;
        if (descriptor.revents & POLLNVAL) break;
        // HUP/ERR must also reach libpq so it can consume EOF or report failure.
        status = PQcancelPoll(cancel);
      }
    }
    PQcancelFinish(cancel);
  }
  auto until = Clock::now() + Millis(300);
  while (Clock::now() < until) {
    if (!PQconsumeInput(connection)) break;
    if (!PQisBusy(connection)) {
      PGresult* result = PQgetResult(connection);
      if (!result) break;
      const char* state = PQresultErrorField(result, PG_DIAG_SQLSTATE);
      if (state && std::strcmp(state, "57014") == 0) ++pool->acknowledged;
      PQclear(result);
    } else if (wait_socket(PQsocket(connection), POLLIN, until) < 0) break;
  }
  // The caller ALWAYS discards this session, even if the command completed
  // naturally. A late cancel must never address a later borrower's query.
}
struct Headers { int lengths = 0; bool transfer = false; bool oversized = false; };
MHD_Result inspect_header(void* closure, MHD_ValueKind, const char* key, const char* value) {
  auto& headers = *static_cast<Headers*>(closure);
  if (strcasecmp(key, "Transfer-Encoding") == 0) headers.transfer = true;
  if (strcasecmp(key, "Content-Length") == 0) {
    ++headers.lengths;
    unsigned long long length = 0;
    const char* end = value + std::strlen(value);
    auto parsed = std::from_chars(value, end, length);
    headers.oversized = parsed.ec != std::errc{} || parsed.ptr != end || length > 16384;
  }
  return MHD_YES;
}
MHD_Result access(void*, MHD_Connection* connection, const char* url,
                  const char* method, const char*, const char* upload,
                  size_t* amount, void** context) {
  if (!*context) {
    std::shared_ptr<Transport> transport;
    {
      std::lock_guard lock(transports_mutex);
      auto found = transports.find(connection);
      if (found != transports.end()) transport = found->second;
    }
    if (!transport || transport->abandoned) return MHD_NO;
    auto* request = new ServiceRequest{connection, url, method, {}, {}, transport};
    transport_deadline(connection, request->started + Millis(1500));
    if (const char* id = MHD_lookup_connection_value(connection, MHD_HEADER_KIND, "X-Request-ID"))
      request->id = id;
    *context = request;
    Headers headers;
    MHD_get_connection_values(connection, MHD_HEADER_KIND, inspect_header, &headers);
    if (headers.lengths > 1 || (headers.lengths && headers.transfer))
      service_reply(request, 400, "{\"error\":\"framing\"}");
    else if (headers.oversized) service_reply(request, 413, "{\"error\":\"too_large\"}");
    return MHD_YES;
  }
  auto* request = static_cast<ServiceRequest*>(*context);
  if (request->replied) { *amount = 0; return MHD_YES; }
  if (Clock::now() - request->started > Millis(1500)) {
    service_reply(request, 504, "{\"error\":\"timeout\"}");
    *amount = 0;
    // Never wait for an untrusted stream to announce upload completion. If
    // this library state cannot queue the early response, abort the connection.
    return request->replied ? MHD_YES : MHD_NO;
  }
  if (*amount) {
    if (request->body.size() + *amount > 16384) {
      service_reply(request, 413, "{\"error\":\"too_large\"}");
      *amount = 0;
      return request->replied ? MHD_YES : MHD_NO;
    }
    request->body.append(upload, *amount);
    *amount = 0;
    return MHD_YES;
  }
  transport_deadline(connection, request->started + Millis(3100));
  try { handler(request); }
  catch (...) { service_reply(request, 503, "{\"error\":\"runtime\"}"); }
  return request->replied ? MHD_YES : MHD_NO;
}
void completed(void*, MHD_Connection* connection, void** context, MHD_RequestTerminationCode) {
  delete static_cast<ServiceRequest*>(*context);
  *context = nullptr;
  transport_deadline(connection, Clock::now() + Millis(1500));
}
}

bool service_path(ServiceRequest* request, const char* path) { return request->path == path; }
bool service_method(ServiceRequest* request, const char* method) { return request->method == method; }
bool service_is_json(ServiceRequest* request) {
  const char* raw = MHD_lookup_connection_value(request->connection, MHD_HEADER_KIND, "Content-Type");
  if (!raw) return false;
  std::string type(raw);
  type = type.substr(0, type.find(';'));
  while (!type.empty() && type.back() == ' ') type.pop_back();
  return type.size() == 16 && strcasecmp(type.c_str(), "application/json") == 0;
}
bool inventory_json_escapes_valid(const std::string&);
json_object* service_parse(ServiceRequest* request) {
  if (!inventory_json_escapes_valid(request->body)) return nullptr;
  auto* parser = json_tokener_new();
  if (!parser) return nullptr;
  json_tokener_set_flags(parser, JSON_TOKENER_STRICT | JSON_TOKENER_VALIDATE_UTF8);
  auto* object = json_tokener_parse_ex(parser, request->body.data(), request->body.size());
  bool valid = json_tokener_get_error(parser) == json_tokener_success;
  auto end = json_tokener_get_parse_end(parser);
  for (size_t i = end; i < request->body.size(); ++i)
    if (request->body[i] != ' ' && request->body[i] != '\t' && request->body[i] != '\r' && request->body[i] != '\n') valid = false;
  json_tokener_free(parser);
  if (!valid) { if (object) json_object_put(object); return nullptr; }
  return object;
}
const char* service_string(json_object* object, const char* key) {
  json_object* value = nullptr;
  if (!object || !json_object_object_get_ex(object, key, &value) ||
      !json_object_is_type(value, json_type_string)) return nullptr;
  const char* text = json_object_get_string(value);
  return std::strlen(text) == static_cast<size_t>(json_object_get_string_len(value)) ? text : nullptr;
}
int service_number(json_object* object, const char* key, int fallback) {
  json_object* value = nullptr;
  if (!json_object_object_get_ex(object, key, &value)) return fallback;
  if (!json_object_is_type(value, json_type_int)) return -1;
  auto number = json_object_get_int64(value);
  return number >= 0 && number <= 1500 ? static_cast<int>(number) : -1;
}
bool service_valid_id(ServiceRequest* request) {
  if (request->id.size() < 16 || request->id.size() > 64) return false;
  for (unsigned char c : request->id)
    if (!(c >= 'a' && c <= 'z') && !(c >= 'A' && c <= 'Z') &&
        !(c >= '0' && c <= '9') && c != '-' && c != '_') return false;
  return true;
}
void service_reply(ServiceRequest* request, int status, const char* body) {
  if (request->replied) return;
  MHD_Response* response = MHD_create_response_from_buffer(std::strlen(body),
      const_cast<char*>(body), MHD_RESPMEM_MUST_COPY);
  if (!response) return;
  MHD_add_response_header(response, "Content-Type", "application/json; charset=utf-8");
  MHD_add_response_header(response, "Cache-Control", "no-store");
  if (status >= 400) MHD_add_response_header(response, "Connection", "close");
  if (status == 405)
    MHD_add_response_header(response, "Allow", request->path.rfind("/v1/",0)==0 || request->path == "/cancel" || request->path == "/attempt" ? "POST" : "GET");
  request->replied = MHD_queue_response(request->connection, status, response) == MHD_YES;
  MHD_destroy_response(response);
}
bool service_cancel(const char* id) {
  bool found = registry.cancel(id);
  pool->changed.notify_all();
  return found;
}
void service_issue(ServiceRequest* request) {
  auto id = registry.issue();
  if (id.empty()) { service_reply(request, 503, "{\"error\":\"busy\"}"); return; }
  auto* result = json_object_new_object();
  json_object_object_add(result, "id", json_object_new_string(id.c_str()));
  service_reply(request, 200, json_object_to_json_string(result));
  json_object_put(result);
}
void inventory_add_stats(json_object*);
void service_stats(ServiceRequest* request) {
  auto* result = json_object_new_object();
  {
    std::lock_guard lock(pool->mutex);
    int available = 0, connections = 0;
    for (const auto& slot : pool->slots) {
      if (slot.connection) ++connections;
      if (!slot.busy) ++available;
    }
    json_object_object_add(result, "capacity", json_object_new_int(Capacity));
    json_object_object_add(result, "active", json_object_new_int(pool->active));
    json_object_object_add(result, "waiting", json_object_new_int(pool->waiting));
    json_object_object_add(result, "waiterLimit", json_object_new_int(Waiters));
    json_object_object_add(result, "max_active", json_object_new_int(pool->max_active));
    json_object_object_add(result, "available", json_object_new_int(available));
    json_object_object_add(result, "connections", json_object_new_int(connections));
  }
  json_object_object_add(result, "cancellations", json_object_new_int(pool->cancellations));
  json_object_object_add(result, "cancel_acknowledged", json_object_new_int(pool->acknowledged));
  json_object_object_add(result, "reconnects", json_object_new_int(pool->reconnects));
  json_object_object_add(result, "attempts_tracked", json_object_new_int64(registry.size()));
  json_object_object_add(result, "attempts_pending", json_object_new_int64(registry.pending()));
  inventory_add_stats(result);
  service_reply(request, 200, json_object_to_json_string(result));
  json_object_put(result);
}
ServiceResult* service_query(ServiceRequest* request, const char* sql,
                             const char* value, int sleep_ms, int timeout_ms) {
  auto output = std::make_unique<ServiceResult>();
  Registration registration(registry, request->id);
  if (!registration.inserted) { output->status = 429; return output.release(); }
  auto deadline = request->started + Millis(timeout_ms);
  int index = pool->acquire(registration.state, deadline, request->transport.get());
  if (index < 0) {
    output->status = registration.state->cancelled ? 409 : Clock::now() >= deadline ? 504 : 502;
    return output.release();
  }
  Lease lease{index};
  PGconn* connection = pool->connection(index, deadline, request->transport.get());
  if (!connection) { lease.discard = true; return output.release(); }
  if (registration.state->cancelled || request->transport->abandoned || Clock::now() >= deadline) {
    output->status = registration.state->cancelled ? 409 : 504;
    return output.release();
  }
  std::string sleep = std::to_string(sleep_ms);
  const char* values[] = {value, sleep.c_str()};
  if (!PQsendQueryParams(connection, sql, 2, nullptr, values, nullptr, nullptr, 0)) {
    lease.discard = true;
    return output.release();
  }
  while (true) {
    if (registration.state->cancelled || request->transport->abandoned || Clock::now() >= deadline || stopping) {
      output->status = registration.state->cancelled ? 409 : 504;
      lease.discard = true;
      cancel_and_retire(connection);
      return output.release();
    }
    int flush = PQflush(connection);
    if (flush < 0 || !PQconsumeInput(connection)) { lease.discard = true; return output.release(); }
    if (!PQisBusy(connection)) {
      PGresult* result = PQgetResult(connection);
      if (!result) {
        if (output->result && PQresultStatus(output->result) == PGRES_TUPLES_OK &&
            PQntuples(output->result) == 1 && PQtransactionStatus(connection) == PQTRANS_IDLE) output->status = 200;
        else lease.discard = true;
        return output.release();
      }
      if (output->result) PQclear(output->result);
      output->result = result;
    } else if (wait_socket(PQsocket(connection), POLLIN | (flush ? POLLOUT : 0), deadline) < 0) {
      if (Clock::now() >= deadline) continue;
      lease.discard = true;
      return output.release();
    }
  }
}
int service_status(ServiceResult* result) { return result->status; }
const char* service_column(ServiceResult* result, int column) { return PQgetvalue(result->result, 0, column); }
void service_result_free(ServiceResult* result) { delete result; }
void inventory_startup_check();
int service_run(CarbonHandler callback) {
  try { inventory_startup_check(); } catch (...) { return 5; }
  const char* config = std::getenv("TREE_ATLAS_PG");
  if (!config) return 1;
  handler = callback;
  pool = std::make_unique<Pool>(config);
  if (!pool->initialize()) { pool.reset(); return 2; }
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  auto* daemon = MHD_start_daemon(MHD_USE_INTERNAL_POLLING_THREAD | MHD_USE_THREAD_PER_CONNECTION | MHD_USE_POLL,
      0, nullptr, nullptr, &access, nullptr,
      MHD_OPTION_SOCK_ADDR, &address,
      MHD_OPTION_CONNECTION_LIMIT, static_cast<unsigned>(32),
        MHD_OPTION_CONNECTION_MEMORY_LIMIT, static_cast<size_t>(65536),
      MHD_OPTION_CONNECTION_TIMEOUT, static_cast<unsigned>(2),
      MHD_OPTION_NOTIFY_COMPLETED, &completed, nullptr,
      MHD_OPTION_NOTIFY_CONNECTION, &connection_notify, nullptr,
      MHD_OPTION_END);
  if (!daemon) { pool.reset(); return 3; }
  const auto* info = MHD_get_daemon_info(daemon, MHD_DAEMON_INFO_BIND_PORT);
  if (!info) { MHD_stop_daemon(daemon); pool.reset(); return 4; }
  std::signal(SIGINT, stop);
  std::signal(SIGTERM, stop);
  std::printf("PORT %u\n", info->port);
  std::fflush(stdout);
  while (!stopping) {
    inspect_transports();
    std::this_thread::sleep_for(Millis(10));
  }
  pool->changed.notify_all();
  MHD_stop_daemon(daemon);
  pool.reset();
  return 0;
}
#include "inventory_impl.h"
