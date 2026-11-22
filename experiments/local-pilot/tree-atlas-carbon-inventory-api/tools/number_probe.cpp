#include <charconv>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <string>
namespace inventory {std::string decimal(double);}
int main(){std::string line;while(std::getline(std::cin,line)){uint64_t bits=0;auto parsed=std::from_chars(line.data(),line.data()+line.size(),bits,16);if(parsed.ec!=std::errc{})return 1;double value;std::memcpy(&value,&bits,8);std::cout<<inventory::decimal(value)<<'\n';}}
