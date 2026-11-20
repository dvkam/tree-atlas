// Private native adaptation. Carbon selects operation/SQL; PostgreSQL owns queries.
#include "../unicode/normalizer.h"
#include <openssl/sha.h>
#include <algorithm>
#include <cmath>
#include <functional>
#include <limits>
#include <stdexcept>
#include <unordered_set>

bool inventory_json_escapes_valid(const std::string& text) {
  bool string=false;
  auto hex=[](char c)->int {if(c>='0'&&c<='9')return c-'0';if(c>='A'&&c<='F')return c-'A'+10;if(c>='a'&&c<='f')return c-'a'+10;return -1;};
  auto code=[&](size_t at)->int {if(at+4>text.size())return -1;int n=0;for(size_t k=0;k<4;k++){int h=hex(text[at+k]);if(h<0)return -1;n=n*16+h;}return n;};
  for(size_t i=0;i<text.size();i++) {
    if(!string) {if(text[i]=='"')string=true;continue;}
    if(text[i]=='"'){string=false;continue;}
    if(text[i]!='\\')continue;
    if(++i>=text.size())return false;
    if(text[i]!='u')continue;
    int value=code(i+1);if(value<0)return false;i+=4;
    if(value>=0xdc00&&value<=0xdfff)return false;
    if(value>=0xd800&&value<=0xdbff) {
      if(i+6>=text.size()||text[i+1]!='\\'||text[i+2]!='u')return false;
      int low=code(i+3);if(low<0xdc00||low>0xdfff)return false;i+=6;
    }
  }
  return !string;
}
namespace inventory {
using Json=std::unique_ptr<json_object,decltype(&json_object_put)>;
Json own(json_object* value){return Json(value,&json_object_put);}
std::atomic<uint64_t> query_summary_calls{0},query_page_calls{0},query_summary_us{0},query_page_us{0},sql_pool_wait_us{0};
struct PhaseTimer {
  std::atomic<uint64_t>& micros;Clock::time_point started{Clock::now()};
  PhaseTimer(std::atomic<uint64_t>& calls,std::atomic<uint64_t>& time):micros(time){calls.fetch_add(1,std::memory_order_relaxed);}
  ~PhaseTimer(){micros.fetch_add(std::chrono::duration_cast<std::chrono::microseconds>(Clock::now()-started).count(),std::memory_order_relaxed);}
};
struct Failure:std::runtime_error {int status;Failure(int s,const char* e):runtime_error(e),status(s){}};
void require(bool value){if(!value)throw Failure(400,"invalid_input");}
json_object* field(json_object* doc,const char* name){json_object* value=nullptr;json_object_object_get_ex(doc,name,&value);return value;}
std::string text(json_object* doc,const char* name,bool required=true){
  auto* value=field(doc,name);if(!required&&!value)return {};
  require(value&&json_object_is_type(value,json_type_string));
  std::string result(json_object_get_string(value),json_object_get_string_len(value));
  atlas_unicode::utf16_length(result);return result;
}
bool identifier(const std::string& value){return !value.empty()&&value.size()<=200&&std::all_of(value.begin(),value.end(),[](unsigned char c){return (c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='-';});}
double number(json_object* value){require(value&&(json_object_is_type(value,json_type_int)||json_object_is_type(value,json_type_double)));double n=json_object_get_double(value);require(std::isfinite(n));return n;}
void bounds(json_object* value){require(value&&json_object_is_type(value,json_type_array)&&json_object_array_length(value)==4);double n[4];for(int i=0;i<4;i++)n[i]=number(json_object_array_get_idx(value,i));require(n[0]>=-180&&n[2]<=180&&n[1]>=-90&&n[3]<=90&&n[0]<n[2]&&n[1]<n[3]);}
std::string decimal(double value){
  if(value==0)return "0";
  bool negative=value<0;if(negative)value=-value;
  char buffer[128];auto out=std::to_chars(buffer,buffer+sizeof(buffer),value,std::chars_format::general);
  if(out.ec!=std::errc{})throw Failure(503,"serialization");
  std::string raw(buffer,out.ptr),digits;
  auto exponent=raw.find('e');int power=0;
  if(exponent!=std::string::npos)power=std::stoi(raw.substr(exponent+1));else exponent=raw.size();
  auto dot=raw.find('.');int point=static_cast<int>(dot<exponent?dot:exponent)+power;
  for(size_t i=0;i<exponent;i++)if(raw[i]!='.')digits+=raw[i];
  while(digits.size()>1&&digits[0]=='0'){digits.erase(0,1);point--;}
  while(digits.size()>1&&digits.back()=='0')digits.pop_back();
  std::string result;
  if(point>0&&point<=21) {
    if(static_cast<size_t>(point)>=digits.size())result=digits+std::string(point-digits.size(),'0');
    else result=digits.substr(0,point)+"."+digits.substr(point);
  } else if(point<=0&&point>-6)result="0."+std::string(-point,'0')+digits;
  else {int e=point-1;result=digits.substr(0,1)+(digits.size()>1?"."+digits.substr(1):"")+"e"+(e>=0?"+":"")+std::to_string(e);}
  return negative?"-"+result:result;
}
std::string encode(json_object* value){
  if(!value)return "null";
  if(json_object_is_type(value,json_type_int)||json_object_is_type(value,json_type_double))return decimal(number(value));
  if(json_object_is_type(value,json_type_array)){std::string result="[";for(size_t i=0;i<json_object_array_length(value);i++){if(i)result+=",";result+=encode(json_object_array_get_idx(value,i));}return result+"]";}
  require(json_object_is_type(value,json_type_string)||json_object_is_type(value,json_type_boolean)||json_object_is_type(value,json_type_null));
  return json_object_to_json_string_ext(value,JSON_C_TO_STRING_PLAIN|JSON_C_TO_STRING_NOSLASHESCAPE);
}
std::string string_json(const std::string& value){auto item=own(json_object_new_string_len(value.data(),value.size()));if(!item)throw Failure(503,"runtime");return encode(item.get());}
std::string sha(const std::string& value){unsigned char bytes[SHA256_DIGEST_LENGTH];SHA256(reinterpret_cast<const unsigned char*>(value.data()),value.size(),bytes);const char* hex="0123456789abcdef";std::string out;for(auto b:bytes){out+=hex[b>>4];out+=hex[b&15];}return out;}
bool aborted(ServiceRequest* request,const std::shared_ptr<QueryState>& state){return stopping||state->cancelled||request->transport->abandoned;}
void check(ServiceRequest* request,const std::shared_ptr<QueryState>& state,Clock::time_point deadline){if(aborted(request,state))throw Failure(409,"cancelled");if(Clock::now()>=deadline)throw Failure(504,"timeout");}
Json sql(ServiceRequest* request,const std::shared_ptr<QueryState>& state,const char* command,
         const std::string& parameters,const std::string& term,Clock::time_point deadline){
  check(request,state,deadline);
  auto waiting=Clock::now();
  int index=pool->acquire(state,deadline,request->transport.get());
  sql_pool_wait_us.fetch_add(std::chrono::duration_cast<std::chrono::microseconds>(Clock::now()-waiting).count(),std::memory_order_relaxed);
  if(index<0){check(request,state,deadline);throw Failure(503,"busy");}
  Lease lease{index};
  auto* connection=pool->connection(index,deadline,request->transport.get());
  if(!connection){lease.discard=true;check(request,state,deadline);throw Failure(503,"database");}
  check(request,state,deadline);
  const char* values[]={parameters.c_str(),term.c_str()};
  if(!PQsendQueryParams(connection,command,2,nullptr,values,nullptr,nullptr,0)){lease.discard=true;throw Failure(503,"database");}
  std::unique_ptr<PGresult,decltype(&PQclear)> result(nullptr,&PQclear);
  while(true){
    if(aborted(request,state)||Clock::now()>=deadline){lease.discard=true;cancel_and_retire(connection);check(request,state,deadline);}
    int flush=PQflush(connection);
    if(flush<0||!PQconsumeInput(connection)){lease.discard=true;throw Failure(503,"database");}
    if(!PQisBusy(connection)){
      auto* next=PQgetResult(connection);
      if(!next)break;
      result.reset(next);
    } else if(wait_socket(PQsocket(connection),POLLIN|(flush?POLLOUT:0),deadline)<0){
      if(Clock::now()>=deadline)continue;
      lease.discard=true;throw Failure(503,"database");
    }
  }
  if(!result||PQresultStatus(result.get())!=PGRES_TUPLES_OK||PQntuples(result.get())!=1||PQnfields(result.get())!=1){
    lease.discard=true;
    const char* error=result?PQresultErrorField(result.get(),PG_DIAG_SQLSTATE):nullptr;
    if(error&&std::strcmp(error,"P0002")==0)throw Failure(404,"release_unavailable");
    if(error&&std::strcmp(error,"22023")==0)throw Failure(400,"invalid_input");
    if(error&&std::strcmp(error,"57014")==0)throw Failure(504,"timeout");
    throw Failure(503,"database");
  }
  if(PQtransactionStatus(connection)!=PQTRANS_IDLE){lease.discard=true;throw Failure(503,"database");}
  auto output=own(json_tokener_parse(PQgetvalue(result.get(),0,0)));
  if(!output||!json_object_is_type(output.get(),json_type_object))throw Failure(503,"database");
  check(request,state,deadline);return output;
}
struct Entry{std::string value;uint64_t stamp;};
std::mutex cache_mutex;
std::condition_variable cache_changed;
std::unordered_map<std::string,Entry> cache;
std::unordered_set<std::string> building;
size_t cache_bytes=0;
uint64_t stamp=0;
constexpr size_t CacheBytes=32*1024*1024,CacheEntries=64;
Json summary(ServiceRequest* request,const std::shared_ptr<QueryState>& state,const std::string& key,
             Clock::time_point deadline,const std::function<Json()>& build){
  {
    std::unique_lock lock(cache_mutex);
    while(true){
      check(request,state,deadline);
      auto found=cache.find(key);
      if(found!=cache.end()){found->second.stamp=++stamp;auto value=own(json_tokener_parse(found->second.value.c_str()));if(!value)throw Failure(503,"runtime");return value;}
      if(!building.count(key)){building.insert(key);break;}
      cache_changed.wait_for(lock,Millis(10));
    }
  }
  try{
    auto value=build();
    std::string stored=json_object_to_json_string_ext(value.get(),JSON_C_TO_STRING_PLAIN|JSON_C_TO_STRING_NOSLASHESCAPE);
    {
      std::lock_guard lock(cache_mutex);
      if(stored.size()+key.size()<=CacheBytes){
        while(!cache.empty()&&(cache.size()>=CacheEntries||cache_bytes+stored.size()+key.size()>CacheBytes)){
          auto oldest=std::min_element(cache.begin(),cache.end(),[](const auto&a,const auto&b){return a.second.stamp<b.second.stamp;});
          cache_bytes-=oldest->first.size()+oldest->second.value.size();cache.erase(oldest);
        }
        cache_bytes+=key.size()+stored.size();cache.emplace(key,Entry{stored,++stamp});
      }
      building.erase(key);
    }
    cache_changed.notify_all();return value;
  }catch(...){std::lock_guard lock(cache_mutex);building.erase(key);cache_changed.notify_all();throw;}
}
void put(json_object* object,const char* name,const std::string& value){if(!object)throw Failure(503,"runtime");auto* encoded=json_object_new_string_len(value.data(),value.size());if(!encoded)throw Failure(503,"runtime");json_object_object_add(object,name,encoded);}
}

ServiceResult* inventory_execute(ServiceRequest* request,const char* primary,const char* secondary,json_object* doc,const char* operation){
  using namespace inventory;
  auto output=std::make_unique<ServiceResult>();
  try{
    atlas_unicode::assert_version();
    require(doc&&json_object_is_type(doc,json_type_object));
    json_object* version=nullptr;
    if(json_object_object_get_ex(doc,"contractVersion",&version)&&text(doc,"contractVersion")!="1.0.0")throw Failure(400,"unsupported_contract");
    const std::string op=operation;
    std::string caller=text(doc,"requestKey");require(!caller.empty());
    bool catalogue=op=="catalogue";
    std::string dataset=catalogue?"":text(doc,"dataset"),release=catalogue?"":text(doc,"release");
    require(catalogue||(identifier(dataset)&&identifier(release)));
    bool query=op=="query"||op=="viewport-page"||op=="cluster-members";
    std::string raw=(query||op=="suggest")?text(doc,"q"):"";
    std::string term=atlas_unicode::normalize(raw);
    auto safe=own(json_object_new_object());
    put(safe.get(),"dataset",dataset);put(safe.get(),"release",release);
    bool nul=term.find('\0')!=std::string::npos;
    if(op=="detail") {auto id=text(doc,"sourceId");nul=id.find('\0')!=std::string::npos;put(safe.get(),"sourceId",nul?"":id);}
    json_object_object_add(safe.get(),"containsNul",json_object_new_boolean(nul));
    auto* area=field(doc,"area");auto* viewport=field(doc,"viewport");
    double zoom=0,offset=0,limit=100;
    if(query){
      require(json_object_object_get_ex(doc,"area",&area));if(area)bounds(area);bounds(viewport);
      zoom=number(field(doc,"zoom"));offset=number(field(doc,"offset"));limit=number(field(doc,"limit"));
      require(zoom>=0&&zoom<=24&&offset>=0&&offset<=9007199254740991.0&&std::floor(offset)==offset&&limit>=1&&limit<=100&&std::floor(limit)==limit);
      json_object_object_add(safe.get(),"area",json_object_get(area));
      json_object_object_add(safe.get(),"viewport",json_object_get(viewport));
      json_object_object_add(safe.get(),"zoom",json_object_new_double(zoom));
      json_object_object_add(safe.get(),"offset",json_object_new_int64(static_cast<int64_t>(offset)));
      json_object_object_add(safe.get(),"limit",json_object_new_int64(static_cast<int64_t>(limit)));
    }
    std::string prefix="[\"tree-atlas-search-release-v1\","+string_json(dataset)+","+string_json(release)+","+string_json(term)+","+encode(area)+","+(query?encode(viewport):"[-180,-90,180,90]")+","+decimal(zoom);
    std::string key=sha(prefix+","+decimal(offset)+","+decimal(limit)+"]");
    std::string cluster_scope=sha(prefix+"]");
    if(op=="cluster-members"){
      auto id=text(doc,"clusterId");require(id.rfind(cluster_scope+":",0)==0);
      std::string cell=id.substr(cluster_scope.size()+1);size_t split=cell.find(':');require(split!=std::string::npos);
      auto part=[&](const std::string& item){int value=-1;auto result=std::from_chars(item.data(),item.data()+item.size(),value);require(result.ec==std::errc{}&&result.ptr==item.data()+item.size()&&value>=0&&value<30);return value;};
      int x=part(cell.substr(0,split)),y=part(cell.substr(split+1));
      json_object_object_add(safe.get(),"cellX",json_object_new_int(x));json_object_object_add(safe.get(),"cellY",json_object_new_int(y));
    }
    if(!service_valid_id(request))throw Failure(400,"invalid_input");
    Registration registration(registry,request->id);if(!registration.inserted)throw Failure(409,"conflict");
    auto deadline=request->started+Millis(2500);
    const std::string parameters=json_object_to_json_string_ext(safe.get(),JSON_C_TO_STRING_PLAIN|JSON_C_TO_STRING_NOSLASHESCAPE);
    const std::string bound_term=nul?"":term;
    auto run=[&](const char* sql){return inventory::sql(request,registration.state,sql,parameters,bound_term,deadline);};
    Json result=own(nullptr);
    if(op=="query"){
      result=summary(request,registration.state,cluster_scope,deadline,[&]{PhaseTimer timer(query_summary_calls,query_summary_us);return run(primary);});
      auto* total=field(result.get(),"total");
      if(!total||!json_object_is_type(total,json_type_int)||json_object_get_int64(total)<0)throw Failure(503,"database");
      // The immutable exact summary already proves an empty/out-of-range page.
      // Avoid another full filtered scan without changing paging semantics.
      if(offset>=json_object_get_int64(total))json_object_object_add(result.get(),"items",json_object_new_array());
      else {
        PhaseTimer timer(query_page_calls,query_page_us);
        auto page=run(secondary);
        auto* items=field(page.get(),"items");if(!items||!json_object_is_type(items,json_type_array))throw Failure(503,"database");
        json_object_object_add(result.get(),"items",json_object_get(items));
      }
      auto* markers=field(result.get(),"markers");
      if(markers)for(size_t i=0;i<json_object_array_length(markers);i++){
        auto* marker=json_object_array_get_idx(markers,i);
        if(field(marker,"kind")&&text(marker,"kind")=="cluster"){
          put(marker,"id",cluster_scope+":"+text(marker,"cell"));json_object_object_del(marker,"cell");
        }
      }
    }else result=run(primary);
    check(request,registration.state,deadline);
    put(result.get(),"contractVersion","1.0.0");put(result.get(),"requestKey",caller);
    if(!catalogue){put(result.get(),"dataset",dataset);put(result.get(),"release",release);put(result.get(),"queryKey",key);}
    output->payload=json_object_to_json_string_ext(result.get(),JSON_C_TO_STRING_PLAIN|JSON_C_TO_STRING_NOSLASHESCAPE);
    output->status=200;output->error.clear();
  }catch(const Failure& error){output->status=error.status;output->error=error.what();}
  catch(const std::invalid_argument&){output->status=400;output->error="invalid_input";}
  catch(...){output->status=503;output->error="runtime";}
  if(output->status!=200)output->payload="{\"error\":"+inventory::string_json(output->error)+"}";
  return output.release();
}
void inventory_add_stats(json_object* value){
  json_object_object_add(value,"querySummarySqlCalls",json_object_new_int64(inventory::query_summary_calls.load(std::memory_order_relaxed)));
  json_object_object_add(value,"queryPageSqlCalls",json_object_new_int64(inventory::query_page_calls.load(std::memory_order_relaxed)));
  json_object_object_add(value,"querySummarySqlUs",json_object_new_int64(inventory::query_summary_us.load(std::memory_order_relaxed)));
  json_object_object_add(value,"queryPageSqlUs",json_object_new_int64(inventory::query_page_us.load(std::memory_order_relaxed)));
  json_object_object_add(value,"sqlPoolWaitUs",json_object_new_int64(inventory::sql_pool_wait_us.load(std::memory_order_relaxed)));
  std::lock_guard lock(inventory::cache_mutex);
  json_object_object_add(value,"cacheEntries",json_object_new_int64(inventory::cache.size()));
  json_object_object_add(value,"cacheBytes",json_object_new_int64(inventory::cache_bytes));
  json_object_object_add(value,"cacheLimitBytes",json_object_new_int64(inventory::CacheBytes));
  json_object_object_add(value,"cacheEntryLimit",json_object_new_int64(inventory::CacheEntries));
}
const char* inventory_payload(ServiceResult* result){return result->payload.c_str();}
const char* inventory_error(ServiceResult* result){return result->error.c_str();}
void inventory_startup_check(){atlas_unicode::assert_version();}
