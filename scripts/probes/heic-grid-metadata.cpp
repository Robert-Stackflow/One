// Research-only HEIC grid/metadata probe. Not built or shipped with One.
// Usage: heic-grid-metadata input.heic output.heic [--sdr]
// Re-encodes a static 8-bit primary image. Drops auxiliary images, motion video,
// MakerNote, and XMP blocks containing known motion-photo markers. HDR gain maps
// require the explicit --sdr option; unknown auxiliary images are rejected.
// Build separately with C++20, libheif headers/import library, and a HEVC codec.
#include <libheif/heif.h>
#include <libheif/heif_metadata.h>
#include <libheif/heif_tiling.h>
#include <libheif/heif_aux_images.h>
#include <cstdio>
#include <cstring>
#include <algorithm>
#include <cctype>
#include <string>
#include <vector>

static bool ok(heif_error error,const char* step){
 if(error.code==heif_error_Ok)return true;
 std::fprintf(stderr,"%s: %s\n",step,error.message);return false;
  }

static std::vector<unsigned char> block(heif_image_handle* image,bool exif){
 const int count=heif_image_handle_get_number_of_metadata_blocks(image,nullptr);
 if(count<0||count>256)return {};
 std::vector<heif_item_id> ids(count);
 heif_image_handle_get_list_of_metadata_block_IDs(image,nullptr,ids.data(),count);
 for(auto id:ids){
  const char* type=heif_image_handle_get_metadata_type(image,id);
  const bool isExif=type&&std::strcmp(type,"Exif")==0;
  const char* content=heif_image_handle_get_metadata_content_type(image,id);
  const bool isXmp=content&&std::strcmp(content,"application/rdf+xml")==0;
  if(exif!=isExif||(!exif&&!isXmp))continue;
  std::vector<unsigned char> data(heif_image_handle_get_metadata_size(image,id));
  if(data.empty()||!ok(heif_image_handle_get_metadata(image,id,data.data()),"read comparison block"))return {};
  if(exif){size_t offset=0;while(offset+4<=data.size()&&std::memcmp(data.data()+offset,"II*\0",4)!=0&&std::memcmp(data.data()+offset,"MM\0*",4)!=0)++offset;if(offset+4>data.size())return {};data.erase(data.begin(),data.begin()+offset);}
  return data;
 }
 return {};
}

static bool patchExif(std::vector<unsigned char>& data,unsigned width,unsigned height){
 if(data.size()<8)return false;
 const bool little=data[0]=='I'&&data[1]=='I';
 if(!little&&!(data[0]=='M'&&data[1]=='M'))return false;
 const auto get16=[&](size_t at)->unsigned{return at+2<=data.size()?(little?unsigned(data[at])|(unsigned(data[at+1])<<8):(unsigned(data[at])<<8)|unsigned(data[at+1])):0;};
 const auto get32=[&](size_t at)->unsigned{return little?get16(at)|(get16(at+2)<<16):(get16(at)<<16)|get16(at+2);};
 const auto put16=[&](size_t at,unsigned value){if(little){data[at]=value&255;data[at+1]=(value>>8)&255;}else{data[at]=(value>>8)&255;data[at+1]=value&255;}};
 const auto put32=[&](size_t at,unsigned value){if(little){put16(at,value&65535);put16(at+2,value>>16);}else{put16(at,value>>16);put16(at+2,value&65535);}};
 if(get16(2)!=42)return false;
 const auto find=[&](unsigned ifd,unsigned tag)->size_t{
  if(ifd>data.size()||ifd+2>data.size())return 0;
  const unsigned count=get16(ifd);if(count>512||size_t(ifd)+2+size_t(count)*12>data.size())return 0;
  for(unsigned i=0;i<count;i++){const size_t at=ifd+2+i*12;if(get16(at)==tag)return at;}
  return 0;
 };
 const unsigned root=get32(4);
 const size_t orientation=find(root,274),exifPointer=find(root,34665);
 if(!exifPointer||get16(exifPointer+2)!=4||get32(exifPointer+4)!=1)return false;
 const unsigned exifIfd=get32(exifPointer+8);
 const size_t widthEntry=find(exifIfd,40962),heightEntry=find(exifIfd,40963);
 if(!widthEntry||!heightEntry)return false;
 const auto patchValue=[&](size_t entry,unsigned value)->bool{
  const unsigned type=get16(entry+2),count=get32(entry+4);
  if(count!=1||!(type==3||type==4)||(type==3&&value>65535))return false;
  if(type==3)put16(entry+8,value);else put32(entry+8,value);
  return true;
 };
 if(orientation&&!patchValue(orientation,1))return false;
 if(!patchValue(widthEntry,width)||!patchValue(heightEntry,height))return false;
 const size_t makerNote=find(exifIfd,37500);
 if(makerNote){
  const unsigned bytes=get32(makerNote+4),offset=get32(makerNote+8);
  if(bytes>4){if(offset>data.size()||bytes>data.size()-offset)return false;std::fill(data.begin()+offset,data.begin()+offset+bytes,0);}
  put32(makerNote+4,0);put32(makerNote+8,0);
 }
 std::printf("patchedOrientation=%d patchedExifWidth=%u patchedExifHeight=%u droppedMakerNote=%d\n",orientation!=0,width,height,makerNote!=0);
 return true;
}

static bool hasMotionMarker(const std::vector<unsigned char>& data){
 for(const char* needle:{"MotionPhoto","MicroVideo","EmbeddedVideo"}){
  const size_t length=std::strlen(needle);
  if(std::search(data.begin(),data.end(),needle,needle+length,[](unsigned char a,char b){return std::tolower(a)==std::tolower(static_cast<unsigned char>(b));})!=data.end())return true;
 }
 return false;
}

int main(int argc,char** argv){
 if(argc!=3&&argc!=4)return 2;
 if(argc==4&&std::strcmp(argv[3],"--sdr")!=0)return 2;
 heif_context* source=heif_context_alloc();
 heif_context* target=heif_context_alloc();
 heif_image_handle* sourceImage=nullptr;
 heif_image_handle* targetImage=nullptr;
 heif_image* decoded=nullptr;
 heif_encoder* encoder=nullptr;
 if(!ok(heif_context_read_from_file(source,argv[1],nullptr),"read source")||
    !ok(heif_context_get_primary_image_handle(source,&sourceImage),"source primary")||
    !ok(heif_decode_image(sourceImage,&decoded,heif_colorspace_YCbCr,heif_chroma_420,nullptr),"decode source")||
    !ok(heif_context_get_encoder_for_format(target,heif_compression_HEVC,&encoder),"encoder")||
    !ok(heif_encoder_set_lossy_quality(encoder,100),"quality"))return 1;
 heif_image_tiling sourceTiling{};
 if(ok(heif_image_handle_get_image_tiling(sourceImage,1,&sourceTiling),"source tiling"))
  std::printf("sourceGrid=%ux%u tile=%ux%u\n",sourceTiling.num_columns,sourceTiling.num_rows,sourceTiling.tile_width,sourceTiling.tile_height);
 const int auxiliaryCount=heif_image_handle_get_number_of_auxiliary_images(sourceImage,0);
 std::printf("sourceAuxiliaryImages=%d\n",auxiliaryCount);
 if(auxiliaryCount<0||auxiliaryCount>16)return 2;
 bool hdrGainMap=false,unsupportedAuxiliary=false;
 if(auxiliaryCount>0&&auxiliaryCount<=16){
  std::vector<heif_item_id> auxiliaryIds(auxiliaryCount);
  heif_image_handle_get_list_of_auxiliary_image_IDs(sourceImage,0,auxiliaryIds.data(),auxiliaryCount);
  for(auto id:auxiliaryIds){
   heif_image_handle* auxiliary=nullptr;
   if(!ok(heif_image_handle_get_auxiliary_image_handle(sourceImage,id,&auxiliary),"auxiliary handle"))return 1;
   const char* type=nullptr;
   if(!ok(heif_image_handle_get_auxiliary_type(auxiliary,&type),"auxiliary type"))return 1;
   if(type&&std::strcmp(type,"urn:com:apple:photo:2020:aux:hdrgainmap")==0)hdrGainMap=true;
   else unsupportedAuxiliary=true;
   std::printf("auxiliaryType=%.128s dimensions=%dx%d\n",type?type:"",heif_image_handle_get_width(auxiliary),heif_image_handle_get_height(auxiliary));
   heif_image* auxiliaryPixels=nullptr;
   if(ok(heif_decode_image(auxiliary,&auxiliaryPixels,heif_colorspace_undefined,heif_chroma_undefined,nullptr),"decode auxiliary")){
    std::printf("auxiliaryPixels=%dx%d colorspace=%d chroma=%d bits=%d\n",heif_image_get_width(auxiliaryPixels,heif_channel_Y),heif_image_get_height(auxiliaryPixels,heif_channel_Y),heif_image_get_colorspace(auxiliaryPixels),heif_image_get_chroma_format(auxiliaryPixels),heif_image_get_bits_per_pixel_range(auxiliaryPixels,heif_channel_Y));
    heif_image_release(auxiliaryPixels);
   }
   const int auxiliaryMetadata=heif_image_handle_get_number_of_metadata_blocks(auxiliary,nullptr);
   std::printf("auxiliaryMetadataBlocks=%d\n",auxiliaryMetadata);
   if(auxiliaryMetadata>0&&auxiliaryMetadata<=16){
    std::vector<heif_item_id> metadataIds(auxiliaryMetadata);
    heif_image_handle_get_list_of_metadata_block_IDs(auxiliary,nullptr,metadataIds.data(),auxiliaryMetadata);
    for(auto metadataId:metadataIds){
     const char* typeValue=heif_image_handle_get_metadata_type(auxiliary,metadataId);
     const std::string metadataType=typeValue?typeValue:"";
     const char* contentValue=heif_image_handle_get_metadata_content_type(auxiliary,metadataId);
     const std::string contentType=contentValue?contentValue:"";
     std::printf("auxiliaryMetadataType=%.128s content=%.128s bytes=%zu\n",metadataType.c_str(),contentType.c_str(),heif_image_handle_get_metadata_size(auxiliary,metadataId));
    }
   }
   heif_image_handle_release_auxiliary_type(auxiliary,&type);
   heif_image_handle_release(auxiliary);
  }
 }
 if(unsupportedAuxiliary){std::fprintf(stderr,"Unknown auxiliary image; conversion refused\n");return 2;}
 if(hdrGainMap&&argc!=4){std::fprintf(stderr,"HDR gain map would be discarded; rerun with --sdr\n");return 2;}
 const size_t iccSize=heif_image_handle_get_raw_color_profile_size(sourceImage);
 if(iccSize>128*1024)return 2;
 if(iccSize>0){
  std::vector<unsigned char> icc(iccSize);
  if(!ok(heif_image_handle_get_raw_color_profile(sourceImage,icc.data()),"read ICC")||
     !ok(heif_image_set_raw_color_profile(decoded,"prof",icc.data(),icc.size()),"set ICC"))return 1;
 }
 {
  const int width=heif_image_get_width(decoded,heif_channel_Y),height=heif_image_get_height(decoded,heif_channel_Y);
  if(width<=0||height<=0||width%4||height%4||1LL*width*height>50000000||
     heif_image_get_bits_per_pixel_range(decoded,heif_channel_Y)!=8)return 2;
  heif_image* tiles[4]{};
  for(int y=0;y<2;y++)for(int x=0;x<2;x++){
   if(!ok(heif_image_extract_area(decoded,x*width/2,y*height/2,width/2,height/2,nullptr,&tiles[y*2+x]),"extract tile"))return 1;
  }
  const bool encoded=ok(heif_context_encode_grid(target,tiles,2,2,encoder,nullptr,&targetImage),"encode grid");
  for(auto* tile:tiles)heif_image_release(tile);
  if(!encoded)return 1;
 }
 const int count=heif_image_handle_get_number_of_metadata_blocks(sourceImage,nullptr);
 if(count<0||count>256)return 2;
 std::vector<heif_item_id> ids(count);
 heif_image_handle_get_list_of_metadata_block_IDs(sourceImage,nullptr,ids.data(),count);
 int exif=0,xmp=0,skipped=0;
 for(auto id:ids){
  const char* type=heif_image_handle_get_metadata_type(sourceImage,id);
  const bool isExif=type&&std::strcmp(type,"Exif")==0;
  const char* contentType=heif_image_handle_get_metadata_content_type(sourceImage,id);
  const bool isXmp=contentType&&std::strcmp(contentType,"application/rdf+xml")==0;
  if(!isExif&&!isXmp){++skipped;continue;}
  const size_t size=heif_image_handle_get_metadata_size(sourceImage,id);
  if(size==0||size>4*1024*1024){std::fprintf(stderr,"metadata size invalid\n");return 1;}
  std::vector<unsigned char> data(size);
  if(!ok(heif_image_handle_get_metadata(sourceImage,id,data.data()),"get metadata"))return 1;
  if(isExif){
   size_t offset=0;
   while(offset+4<=size&&std::memcmp(data.data()+offset,"II*\0",4)!=0&&std::memcmp(data.data()+offset,"MM\0*",4)!=0)++offset;
   if(offset+4>size){std::fprintf(stderr,"TIFF header missing\n");return 1;}
   std::vector<unsigned char> tiff(data.begin()+offset,data.end());
    if(!patchExif(tiff,heif_image_get_width(decoded,heif_channel_Y),heif_image_get_height(decoded,heif_channel_Y)))return 1;
   if(!ok(heif_context_add_exif_metadata(target,targetImage,tiff.data(),static_cast<int>(tiff.size())),"add Exif"))return 1;
   ++exif;
   }else{
    if(hasMotionMarker(data)){++skipped;continue;}
   if(!ok(heif_context_add_XMP_metadata(target,targetImage,data.data(),static_cast<int>(size)),"add XMP"))return 1;
   ++xmp;
  }
 }
 if(!ok(heif_context_write_to_file(target,argv[2]),"write output"))return 1;
 std::printf("width=%d height=%d icc=%zu sourceBlocks=%d copiedExif=%d copiedXmp=%d skipped=%d\n",heif_image_get_width(decoded,heif_channel_Y),heif_image_get_height(decoded,heif_channel_Y),iccSize,count,exif,xmp,skipped);
 heif_context* check=heif_context_alloc();heif_image_handle* checkImage=nullptr;
 if(ok(heif_context_read_from_file(check,argv[2],nullptr),"read comparison output")&&ok(heif_context_get_primary_image_handle(check,&checkImage),"comparison primary")){
  heif_image_tiling outputTiling{};
  if(ok(heif_image_handle_get_image_tiling(checkImage,1,&outputTiling),"output tiling"))
   std::printf("outputGrid=%ux%u tile=%ux%u\n",outputTiling.num_columns,outputTiling.num_rows,outputTiling.tile_width,outputTiling.tile_height);
  const auto sourceExif=block(sourceImage,true),outputExif=block(checkImage,true);
  const auto sourceXmp=block(sourceImage,false),outputXmp=block(checkImage,false);
  std::printf("exifBytes=%zu exifExact=%d xmpBytes=%zu xmpExact=%d\n",sourceExif.size(),!sourceExif.empty()&&sourceExif==outputExif,sourceXmp.size(),sourceXmp==outputXmp);
 }
 if(checkImage)heif_image_handle_release(checkImage);heif_context_free(check);
 heif_image_handle_release(targetImage);heif_image_handle_release(sourceImage);
 heif_image_release(decoded);heif_encoder_release(encoder);
 heif_context_free(target);heif_context_free(source);
 return 0;
}
