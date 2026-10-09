#pragma once
#include "zip-common.h"
#include <optional>
#include <cstdio>

// Details are read only for the requested entry, never attached to every
// directory row or collected during extraction/drag preflight.
inline std::string entry_crc(uint32_t value){char text[9]{};std::snprintf(text,sizeof(text),"%08X",value);return text;}
inline void emit_details(const Entry &entry,bool packed_known,const std::optional<int64_t> &modified={},const std::string &crc={},const std::string &method={},bool shared=false){
    auto value="{\"type\":\"details\",\"entry\":{\"index\":"+std::to_string(entry.index)+",\"name\":"+json(entry.name)+",\"directory\":"+(entry.directory?"true":"false")+",\"size\":"+std::to_string(entry.size)+",\"compressed\":"+std::to_string(entry.compressed)+",\"encrypted\":"+(entry.encrypted?"true":"false")+(entry.size_known?"":",\"sizeKnown\":false")+"},\"packedKnown\":"+(packed_known?"true":"false");
    if(modified)value+=",\"modified\":"+std::to_string(*modified);
    if(!crc.empty())value+=",\"crc32\":"+json(crc);
    if(!method.empty())value+=",\"method\":"+json(method);
    emit(value+",\"packedShared\":"+(shared?"true":"false")+"}");
}
