#pragma once
#include <fstream>
#include <unordered_map>
namespace one_video {
// Cursor sampling is independent of input hooks and never changes the OS cursor.
class CursorTracker {
    bool enabled, fixture, first = true, fixtureFixed = false;
    int width, height, segment = 0, lastButtons = 0, fixtureX = -1, fixtureY = -1, fixtureShape = 1, fixtureButtons = 0;
    int lastX = -1, lastY = -1, lastShape = -1, lastSegment = -1;
    unsigned count = 0;
    size_t shapeBytes = 0;
    std::wstring path;
    std::ofstream journal;
    std::unordered_map<uintptr_t, int> ids;
    // Optional user32 export: no SDK contract. Missing support retains the static first frame.
    // Signature independently checked against Wine's user32 ABI, not its implementation.
    using FrameInfo = HCURSOR (WINAPI*)(HCURSOR, DWORD, DWORD, DWORD*, DWORD*);
    FrameInfo frameInfo = reinterpret_cast<FrameInfo>(GetProcAddress(GetModuleHandleW(L"user32.dll"), "GetCursorFrameInfo"));
    struct Bitmap {
        HDC dc = CreateCompatibleDC(nullptr); HBITMAP image = nullptr; HGDIOBJ previous = nullptr; uint8_t* pixels = nullptr;
        Bitmap(int w, int h, bool white) {
            BITMAPINFO info{}; info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
            info.bmiHeader.biWidth = w; info.bmiHeader.biHeight = -h; info.bmiHeader.biPlanes = 1; info.bmiHeader.biBitCount = 32;
            image = CreateDIBSection(dc, &info, DIB_RGB_COLORS, reinterpret_cast<void**>(&pixels), nullptr, 0);
            if (!dc || !image || !pixels) { if(image) DeleteObject(image); if(dc) DeleteDC(dc); throw_last_error(); }
            previous = SelectObject(dc, image); memset(pixels, white ? 255 : 0, size_t(w)*h*4);
        }
        ~Bitmap() { if(previous) SelectObject(dc, previous); if(image) DeleteObject(image); if(dc) DeleteDC(dc); }
    };
    void writeShape(int id, int w, int h, int hx, int hy, const std::vector<uint8_t>& pixels) {
        if(shapeBytes + pixels.size() > 8*1024*1024) throw hresult_error(E_FAIL,L"光标素材容量达到上限，已保留录制");
        const uint32_t header[]{uint32_t(w),uint32_t(h),uint32_t(hx),uint32_t(hy)};
        std::ofstream file(std::filesystem::path(path + L".cursor-" + std::to_wstring(id) + L".bin"), std::ios::binary | std::ios::out | std::ios::trunc);
        file.write(reinterpret_cast<const char*>(header), sizeof(header));
        file.write(reinterpret_cast<const char*>(pixels.data()), pixels.size()); file.flush();
        if (!file) throw hresult_error(E_FAIL, L"无法保存光标图形");
        shapeBytes += pixels.size();
    }
    int shape(HCURSOR cursor, int testShape, bool animated = true) {
        const uintptr_t key = fixture ? uintptr_t(testShape) : reinterpret_cast<uintptr_t>(cursor);
        if (const auto found = ids.find(key); found != ids.end()) return found->second;
        if (ids.size() >= 64) throw hresult_error(E_FAIL, L"光标图形数量达到上限，已保留录制");
        const int id = int(ids.size()) + 1;
        ids.emplace(key,id);
        if (fixture) {
            const int w = 16, h = 20; std::vector<uint8_t> pixels(size_t(w)*h*5, 0);
            for(int y=1;y<17;y++) for(int x=1;x<=std::min(10,y/2+1);x++) {
                auto p=pixels.data()+(y*w+x)*5;
                p[0]=testShape==1?255:40; p[1]=testShape==1?60:200; p[2]=100; p[3]=255;
            }
            // A separate inverse-mask pixel exercises legacy XOR cursor rendering.
            pixels[(18*w+14)*5+4]=255;
            writeShape(id,w,h,2,3,pixels);
        } else {
            ICONINFO icon{}; check_bool(GetIconInfo(cursor,&icon));
            const auto release = [&] { if(icon.hbmColor) DeleteObject(icon.hbmColor); if(icon.hbmMask) DeleteObject(icon.hbmMask); };
            try {
                BITMAP info{}; check_bool(GetObject(icon.hbmColor?icon.hbmColor:icon.hbmMask,sizeof(info),&info));
                const int w=info.bmWidth,h=icon.hbmColor?info.bmHeight:info.bmHeight/2;
                if(w<1||h<1||w>256||h>256||icon.xHotspot>=UINT(w)||icon.yHotspot>=UINT(h)) throw hresult_error(E_FAIL,L"光标图形尺寸无效");
                Bitmap black(w,h,false),white(w,h,true);
                check_bool(DrawIconEx(black.dc,0,0,cursor,w,h,0,nullptr,DI_NORMAL|DI_NOMIRROR));
                check_bool(DrawIconEx(white.dc,0,0,cursor,w,h,0,nullptr,DI_NORMAL|DI_NOMIRROR));
                GdiFlush();
                std::vector<uint8_t> color(size_t(w)*h*4,0);bool alphaImage=false;
                if(icon.hbmColor) {
                    BITMAPINFO format{};format.bmiHeader.biSize=sizeof(BITMAPINFOHEADER);format.bmiHeader.biWidth=w;format.bmiHeader.biHeight=-h;
                    format.bmiHeader.biPlanes=1;format.bmiHeader.biBitCount=32;
                    check_bool(GetDIBits(black.dc,icon.hbmColor,0,h,color.data(),&format,DIB_RGB_COLORS));
                    for(int i=0;i<w*h;i++)alphaImage|=color[i*4+3]!=0;
                }
                std::vector<uint8_t> pixels(size_t(w)*h*5,0);
                for(int i=0;i<w*h;i++) {
                    const auto b=black.pixels+i*4, a=white.pixels+i*4; auto p=pixels.data()+i*5;
                    if(alphaImage) {
                        const auto source=color.data()+i*4;const int alpha=source[3];p[3]=uint8_t(alpha);
                        if(alpha)for(int c=0;c<3;c++)p[c]=uint8_t(std::min(255,(int(source[2-c])*255+alpha/2)/alpha));
                        continue;
                    }
                    if(b[0]>250&&b[1]>250&&b[2]>250&&a[0]<5&&a[1]<5&&a[2]<5) { p[4]=255; continue; }
                    const int alpha=std::clamp(255-(int(a[0])+a[1]+a[2]-b[0]-b[1]-b[2])/3,0,255);
                    p[3]=uint8_t(alpha);
                    if(alpha) for(int c=0;c<3;c++) p[c]=uint8_t(std::min(255,(int(b[2-c])*255+alpha/2)/alpha));
                }
                writeShape(id,w,h,int(icon.xHotspot),int(icon.yHotspot),pixels);
            } catch(...) { release(); throw; }
            release();
        }
        if (!fixture && animated && frameInfo) {
            DWORD rate=0,steps=0;
            const HCURSOR firstFrame=frameInfo(cursor,0,0,&rate,&steps);
            if (firstFrame && steps>1) {
                if(steps>256) throw hresult_error(E_FAIL,L"光标动画步数达到上限，已保留录制");
                std::vector<std::pair<int,DWORD>> animation;
                uint64_t duration=0;
                for(DWORD step=0;step<steps;step++) {
                    DWORD delay=0,total=0;
                    HCURSOR frame=frameInfo(cursor,0,step,&delay,&total);
                    if(!frame||total!=steps||delay<1||delay>3600||(duration+=uint64_t(delay)*800)>48000ull*600)
                        throw hresult_error(E_FAIL,L"光标动画时长无效，已保留录制");
                    // Returned frame handles belong to user32; never destroy or install them.
                    animation.emplace_back(frame==firstFrame?id:shape(frame,0,false),delay*800);
                }
                std::ofstream file(std::filesystem::path(path+L".cursor-"+std::to_wstring(id)+L".animation.json"),std::ios::binary|std::ios::trunc);
                file<<"[";
                for(size_t i=0;i<animation.size();i++) {
                    if(i) file<<",";
                    file<<"{\"shape\":"<<animation[i].first<<",\"samples\":"<<animation[i].second<<"}";
                }
                file<<"]";file.flush();
                if(!file) throw hresult_error(E_FAIL,L"无法保存光标动画");
            }
        }
        return id;
    }
public:
    CursorTracker(bool enabled, bool fixture, int width, int height, const std::wstring& path)
        : enabled(enabled), fixture(fixture), width(width), height(height), path(path) {
        if(enabled) { journal.open(std::filesystem::path(path+L".cursor.jsonl"),std::ios::binary|std::ios::out|std::ios::trunc); if(!journal) throw hresult_error(E_FAIL,L"无法创建光标时间轴"); }
    }
    void split() { first=true; segment++; }
    void configureFixture(int x,int y,int shape,int buttons) {
        if(!fixture||shape<0||shape>2||buttons<0||buttons>7) throw hresult_invalid_argument();
        fixtureX=x;fixtureY=y;fixtureShape=shape;fixtureButtons=buttons;fixtureFixed=true;
    }
    void sample(int64_t sample, uint64_t frame, RECT bounds, RECT crop, HWND target, DWORD owner) {
        if(!enabled) return;
        POINT point{}; HCURSOR cursor=nullptr; bool visible=false; int buttons=0;
        if(fixture) {
            point={!fixtureFixed?bounds.left+crop.left+LONG(frame*3%uint64_t(crop.right-crop.left)):fixtureX,
                !fixtureFixed?bounds.top+crop.top+LONG(frame*2%uint64_t(crop.bottom-crop.top)):fixtureY};
            visible=fixtureShape!=0;buttons=fixtureButtons;
        } else {
            CURSORINFO info{sizeof(info)}; check_bool(GetCursorInfo(&info)); point=info.ptScreenPos;cursor=info.hCursor;
            visible=(info.flags&CURSOR_SHOWING)!=0;
            buttons=(GetAsyncKeyState(VK_LBUTTON)&0x8000?1:0)|(GetAsyncKeyState(VK_RBUTTON)&0x8000?2:0)|(GetAsyncKeyState(VK_MBUTTON)&0x8000?4:0);
            if(target) { const auto window=WindowFromPoint(point);DWORD pid=0;GetWindowThreadProcessId(window,&pid);visible &= GetAncestor(window,GA_ROOT)==target||pid==owner; }
        }
        const int px=point.x-bounds.left-crop.left,py=point.y-bounds.top-crop.top,
            cw=crop.right-crop.left,ch=crop.bottom-crop.top;
        visible &= px>=0&&py>=0&&px<cw&&py<ch;
        const int x=visible?int(int64_t(px)*width/cw):0,y=visible?int(int64_t(py)*height/ch):0,
            id=visible?shape(cursor,fixtureShape):0,down=first?0:buttons&~lastButtons;
        lastButtons=buttons; first=false;
        if(x==lastX&&y==lastY&&id==lastShape&&segment==lastSegment&&!down) return;
        if(count>=220000) throw hresult_error(E_FAIL,L"光标时间轴达到上限，已保留录制");
        journal<<"{\"sample\":"<<sample<<",\"x\":"<<x<<",\"y\":"<<y<<",\"shape\":"<<id
            <<",\"scale\":"<<double(width)/cw<<",\"segment\":"<<segment<<",\"click\":"<<(visible?down:0)<<"}\n";
        if(!journal) throw hresult_error(E_FAIL,L"光标时间轴写入失败");
        lastX=x;lastY=y;lastShape=id;lastSegment=segment;
        if(++count%64==0) journal.flush();
    }
    void finish() { if(enabled) { journal.flush(); if(!journal) throw hresult_error(E_FAIL,L"光标时间轴保存失败"); } }
    static bool animationTest(const std::wstring& path,const std::wstring& file,bool fallback) {
        CursorTracker tracker(true,false,8,8,path);
        if(fallback) tracker.frameInfo=nullptr;
        HCURSOR cursor=reinterpret_cast<HCURSOR>(LoadImageW(nullptr,file.c_str(),IMAGE_CURSOR,0,0,LR_LOADFROMFILE));
        check_bool(cursor);
        try {
            const int id=tracker.shape(cursor,0);
            tracker.journal<<"{\"sample\":0,\"x\":4,\"y\":4,\"shape\":"<<id<<",\"scale\":1,\"segment\":0,\"click\":0}\n";
            tracker.finish();
        } catch(...) {DestroyCursor(cursor);throw;}
        DestroyCursor(cursor);return tracker.frameInfo!=nullptr;
    }
    static void selfTest(const std::wstring& path) {
        // Construct private icons; no global cursor or desktop state is read.
        CursorTracker tracker(true,false,8,8,path); Bitmap color(8,8,false);
        for(int i=0;i<64;i++){color.pixels[i*4+2]=128;color.pixels[i*4+3]=128;}
        uint8_t zero[16]{},ones[32];memset(ones,255,sizeof(ones));
        HBITMAP mask=CreateBitmap(8,8,1,1,zero),inverse=CreateBitmap(8,16,1,1,ones);
        ICONINFO a{};a.xHotspot=2;a.yHotspot=3;a.hbmColor=color.image;a.hbmMask=mask;
        ICONINFO b{};b.hbmMask=inverse;
        HICON first=CreateIconIndirect(&a),second=CreateIconIndirect(&b);
        const auto release=[&]{if(first)DestroyIcon(first);if(second)DestroyIcon(second);if(mask)DeleteObject(mask);if(inverse)DeleteObject(inverse);};
        try {check_bool(first&&second);tracker.shape(reinterpret_cast<HCURSOR>(first),0);tracker.shape(reinterpret_cast<HCURSOR>(second),0);tracker.finish();}
        catch(...){release();throw;}release();
    }
};
}
