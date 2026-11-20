#pragma once
#include <arpa/inet.h>
#include <cerrno>
#include <charconv>
#include <cstdio>
#include <cstring>
#include <json-c/json.h>
#include <libpq-fe.h>
#include <netinet/in.h>
#include <poll.h>
#include <string_view>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

// ABI adaptation and a bounded HTTP/1.1 probe, not a production HTTP server.
// Carbon owns request routing, status decisions, SQL and response contents.
inline int poc_listen() {
  const int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) return -1;
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  address.sin_port = 0;
  if (bind(fd, reinterpret_cast<sockaddr*>(&address), sizeof(address)) ||
      listen(fd, 1)) { close(fd); return -1; }
  socklen_t length = sizeof(address);
  if (getsockname(fd, reinterpret_cast<sockaddr*>(&address), &length)) {
    close(fd); return -1;
  }
  std::printf("PORT %u\n", ntohs(address.sin_port));
  std::fflush(stdout);
  return fd;
}
inline int poc_accept(int listener) {
  pollfd pending{listener, POLLIN, 0};
  if (poll(&pending, 1, 8000) != 1) return -1;
  int fd = accept(listener, nullptr, nullptr);
  if (fd >= 0) {
    timeval timeout{2, 0};
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
  }
  return fd;
}
inline long long poc_milliseconds() {
  timespec now{};
  clock_gettime(CLOCK_MONOTONIC, &now);
  return now.tv_sec * 1000LL + now.tv_nsec / 1000000;
}
// This one-shot process handles one client. Bound the ENTIRE receive phase,
// not each individual read, so trickled bytes cannot reset its deadline.
inline long poc_read(int fd, char* buffer, unsigned long capacity) {
  static long long deadline = 0;
  if (!deadline) deadline = poc_milliseconds() + 1500;
  while (true) {
    long long remaining = deadline - poc_milliseconds();
    if (remaining <= 0) return -1;
    pollfd pending{fd, POLLIN, 0};
    int ready = poll(&pending, 1, static_cast<int>(remaining));
    if (ready < 0 && errno == EINTR) continue;
    if (ready <= 0) return -1;
    long amount = recv(fd, buffer, capacity, MSG_DONTWAIT);
    if (amount < 0 && (errno == EINTR || errno == EAGAIN)) continue;
    return amount;
  }
}
// Positive = complete frame; 0 = incomplete; negative = explicit rejection.
inline int poc_frame(const char* bytes, int length) {
  std::string_view input(bytes, length);
  const auto boundary = input.find("\r\n\r\n");
  if (boundary == input.npos) return length >= 4096 ? -413 : 0;
  auto line = input.find("\r\n");
  if (line == input.npos) return -400;
  bool found_length = false;
  unsigned size = 0;
  while (line < boundary) {
    const auto next = input.find("\r\n", line + 2);
    if (next == input.npos) return -400;
    auto header = input.substr(line + 2, next - line - 2);
    const auto colon = header.find(':');
    if (colon == header.npos) return -400;
    auto name = header.substr(0, colon);
    auto value = header.substr(colon + 1);
    while (!value.empty() && value.front() == ' ') value.remove_prefix(1);
    if (name.size() == 17 && strncasecmp(name.data(), "Transfer-Encoding", 17) == 0) return -400;
    if (name.size() == 14 && strncasecmp(name.data(), "Content-Length", 14) == 0) {
      if (found_length) return -400;
      found_length = true;
      auto result = std::from_chars(value.data(), value.data() + value.size(), size);
      if (result.ec != std::errc{} || result.ptr != value.data() + value.size()) return -400;
      if (size > 2048) return -413;
    }
    line = next;
  }
  if (!found_length) return -400;
  const auto complete = boundary + 4 + size;
  if (input.size() < complete) return 0;
  if (input.size() != complete) return -400;
  return static_cast<int>(complete);
}
inline bool poc_route(const char* bytes) {
  return std::strncmp(bytes, "POST /probe HTTP/1.1\r\n", 22) == 0;
}
inline json_object* poc_parse_body(const char* bytes, int length) {
  const char* body = std::strstr(bytes, "\r\n\r\n");
  if (!body) return nullptr;
  body += 4;
  const int body_size = length - static_cast<int>(body - bytes);
  auto* parser = json_tokener_new();
  if (!parser) return nullptr;
  json_tokener_set_flags(parser, JSON_TOKENER_STRICT | JSON_TOKENER_VALIDATE_UTF8);
  auto* value = json_tokener_parse_ex(parser, body, body_size);
  bool valid = json_tokener_get_error(parser) == json_tokener_success;
  const auto end = json_tokener_get_parse_end(parser);
  for (size_t i = end; i < static_cast<size_t>(body_size); ++i)
    if (body[i] != ' ' && body[i] != '\t' && body[i] != '\r' && body[i] != '\n') valid = false;
  json_tokener_free(parser);
  if (!valid) { if (value) json_object_put(value); return nullptr; }
  return value;
}
inline const char* poc_string(json_object* object, const char* key) {
  json_object* value = nullptr;
  if (!object || !json_object_object_get_ex(object, key, &value) ||
      !json_object_is_type(value, json_type_string)) return nullptr;
  const char* text = json_object_get_string(value);
  if (std::strlen(text) != static_cast<size_t>(json_object_get_string_len(value))) return nullptr;
  return text;
}
inline PGresult* poc_parameter(PGconn* connection, const char* sql, const char* value) {
  const char* values[] = {value};
  return PQexecParams(connection, sql, 1, nullptr, values, nullptr, nullptr, 0);
}
inline int poc_connection_status(PGconn* connection) { return PQstatus(connection); }
inline int poc_result_status(PGresult* result) { return PQresultStatus(result); }
inline void poc_response(int fd, int status, const char* body) {
  const char* reason = status == 200 ? "OK" : status == 400 ? "Bad Request" :
      status == 404 ? "Not Found" : status == 413 ? "Content Too Large" : "Service Unavailable";
  char header[256];
  int count = std::snprintf(header, sizeof(header),
      "HTTP/1.1 %d %s\r\nContent-Type: application/json; charset=utf-8\r\n"
      "Content-Length: %zu\r\nConnection: close\r\n\r\n", status, reason, std::strlen(body));
  const long long deadline = poc_milliseconds() + 1500;
  for (auto part : {std::string_view(header, count), std::string_view(body)}) {
    size_t sent = 0;
    while (sent < part.size()) {
      long long remaining = deadline - poc_milliseconds();
      if (remaining <= 0) return;
      pollfd pending{fd, POLLOUT, 0};
      if (poll(&pending, 1, static_cast<int>(remaining)) <= 0) return;
      auto n = send(fd, part.data() + sent, part.size() - sent, MSG_NOSIGNAL | MSG_DONTWAIT);
      if (n < 0 && (errno == EINTR || errno == EAGAIN)) continue;
      if (n <= 0) return;
      sent += n;
    }
  }
}
