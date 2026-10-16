# Frame 迁入 One：代码调研与迁移计划

日期：2026-10-13。状态：**方案已按 One 原生功能、统一命名及无历史兼容要求修订，迁移已开始；实施进度见 [当前功能 TODO](TODO.md)**。

本方案针对 `D:\Repositories\Frame` 与 `D:\Repositories\One` 当前源码。以最新版 Frame 的功能、页面与业务模型为来源，最终完整归入 One；不迁入历史版本、旧文件/数据兼容或 Clip 联动。文档中的阶段验收用于发现迁移引入的差异，不重新评判用户已经测试通过的功能是否完成，也不把历史待办自动扩大为本轮实施范围。

## 1. 已确认的目标与实施结论

1. 在 **One 主窗口侧栏**新增“**截图与录制**”分组，按顺序放入“**截图、录制、素材、贴图**”四个入口。
2. 去掉 Frame 自己的应用标题栏、品牌与侧栏；保留四个页面内部的布局、按钮、菜单、属性面板、提示、快捷操作及状态行为。独立截图层、图片编辑器、识别窗口、播放器、贴图和录制浮层保持现有 UI 与功能。
3. **录制页直接渲染在 One 主窗口当前 renderer 内**。这里指顶部可切换屏幕、窗口、区域、摄像头、录音，右侧有基本、画质、键鼠、画中画分段页签的完整页面。
4. 四个主页面都采用直接挂载；不使用 HTML iframe、`<webview>`，也不以 `WebContentsView` 承载主窗口的录制设置页或替代 iframe。
5. 重叠能力优先使用 One 的实现。One 只有部分能力时，先补齐 One 共用实现，以原页面布局和行为验收；功能含义不同的组件不强行替换。
6. 保留最新版的截图、向量标注、工程数据能力、录制时序、合成导出等业务核心，避免在迁移时同时重写已验收算法；工程的产品标识、扩展名和版本体系重新归 One 定义。
7. **原生整合到 One，而不是嵌入 Frame 子应用**：不用 ShadowRoot 隔离页面，不保留 Frame workspace 外壳、独立主题或通用样式副本。页面走 One 路由与 controller，控件走 One 共用实现，必要样式并入 One 的公共组件或对应功能页。
8. **不保留产品兼容层**：新代码、API、handler、设置、数据目录、工程格式、URI、session 与打包身份使用 One 或功能名称；不读取旧工程，不迁移旧数据，不兼容旧版本，不迁入 Clip 的票据、管道、回传或协议接管逻辑。

**推荐实施路线：迁入 Frame 已验收的业务能力和页面布局，拆除应用外壳与独立 UI 基础层；四个页面直接按 One 的原生页面模式实现接入，重叠组件与样式归并到 One；由 One 统一管理设置、权限、窗口、快捷键和退出。**

主要工作量集中在录制页从独立 renderer 改为 One 原生页面、组件及样式归并，以及主进程生命周期整合。“页面原样”约束布局、信息层级、尺寸、交互和功能验收，不要求继续运行原 Frame 页面壳或保留原 CSS 文件；合并后仍须对照已验收界面检查差异。

### 1.1 One 原生命名与归属约定

以下为实施约定，而非先保留旧名字、以后再清理的可选项：

| 对象 | One 中的约定 |
| --- | --- |
| 主页面路由 | `capture`、`recording`、`materials`、`pins`，标题为截图、录制、素材、贴图 |
| 代码与服务 | 按功能命名，例如 `CaptureService`、`RecordingService`、`ImageProjectService`；不建立 FrameService、FrameModule 或 frame-handler |
| preload / IPC | 接入 One 既有桥接对象；类型按功能拆分，通道采用 `one:capture-*`、`one:recording-*`、`one:materials-*`、`one:pins-*`、`one:recognition-*`、`one:image-project-*`；不提供旧通道别名 |
| 设置 / 存储 | 使用 `capture`、`recording`、`materials`、`pins`、`recognition` 等功能字段/目录；不增加 `settings.frame` 或用户目录下的 `frame` 层级 |
| 编辑工程 | 新格式 `.oneimage`、`.onerec`，新格式标识及独立的初始版本 1；数据能力覆盖最新版模型，详见第 9 节 |
| 资源 URI / session | 扩展 One 现有 `one` / `one-file` 的受控资源路由；独立 partition 如确有需要，采用 `one-recording` 等功能名 |
| 窗口 / 任务 / 日志 / 原生资源 | 使用 One 身份和具体功能名；窗口角色、菜单命令、任务类型、日志类别与 helper 资源名同步更新 |
| 系统入口 | 搜索、快捷键、托盘、启动文件参数和新工程关联统一接入 One；不注册或接管旧产品协议 |

文件扩展名、容器 magic/manifest、IPC 双端、资源生产者/消费者、HTML 属性、CSS 类、测试 fixture 和打包脚本须成组改造，避免只换界面名字。Frame 名称仅作为调研来源、提交说明或必要版权归属保留；`requestAnimationFrame`、视频 `frame`、Electron `mainFrame` 等技术词义不属于产品品牌，不做机械替换。迁入源码时保留适用的许可证与署名。

## 2. 调研基线与范围

### 2.1 源码基线

| 项目 | 当前版本 | 调研提交 | 已跟踪 src 文件 | native 文件 | tests 文件 |
| --- | --- | --- | ---: | ---: | ---: |
| Frame | 0.1.0 | `3b6db75883c2fa49ea9a9fe62dd97e8f630dce51` | 340 | 19 | 67 |
| One | 0.16.23 | `587b8cd59d69f61e3ffae0e45ab0eff40e974350` | 468 | 111 | 671 |

数量来自 Git 跟踪文件清单，不代表测试用例数或本轮执行结果。调研开始时两个工作区均无待提交修改。本次未运行 Frame 的功能回归、未安装依赖、未构建或安装新版本。

本次命名与范围修订时已核对两库 HEAD，仍为上表提交。正式实施开始时再确认来源是否更新；如有更新，只对变化的功能补充调研，以届时最新版为实施基线，不保留历史实现分支。

本地辅助证据位于 `work/frame-migration-research/source-baseline.json`，包含两库提交、文件路径、大小与 SHA-256；属于可重建调研产物，不作为发布资源。

### 2.2 已检查的主要链路

- 两库应用入口、preload、导航、页面挂载与 IPC 权限检查。
- Frame 截图、长截图、图片编辑、OCR、翻译、表格、公式、贴图、素材、录屏录音、播放与导出模块。
- One 外观、字体、控件、分段页签、弹窗、提示、取色、条码框选、AI 服务、图片工具及设置备份。
- 两库原生辅助程序、资源路径、构建入口、打包配置、工程与数据路径。
- One 的启动参数、系统入口和退出流程；已检查来源项目的 Clip 交接代码，按用户要求明确排除。
- 两库现有测试组织与 Frame 可迁移的回归入口。

本方案以源码调用链为依据。README、旧阶段记录和需求候选仅提供背景；范围以用户最新要求为准，功能实现以最新版源码及用户验收为准。来源中存在的旧格式读取、旧版升级、产品启动壳与 Clip 交接均不因“原样迁移”而进入目标范围。

## 3. 两库架构差异与迁移影响

| 对比项 | Frame 当前实现 | One 当前实现 | 迁移处理 |
| --- | --- | --- | --- |
| 桌面运行时 | Electron 44.5.1 | Electron 44.5.1 | 无需先升级 Electron |
| 界面技术 | TypeScript、原生 DOM、独立 HTML 页面 | TypeScript、原生 DOM、按需导入视图 | 无需引入 React/Vue 等新界面框架 |
| renderer 构建 | esbuild 多入口；页面清单集中维护 | Vite 主入口，根据 `view` 分发 | 主页面进入 One 按需导入；独立窗口继续保留各自文档入口 |
| preload | 各功能 preload 与共享外观/chrome preload | 统一 `src/preload/index.ts` | 主页面接入 One API；独立窗口保留受限的功能 preload |
| 主工作台 | `app/app.ts` 自己管理侧栏、标题、页面与状态 | `main-view.ts` 管理 One 侧栏、挂载与激活 | 拆出四页内容与业务逻辑，分别进入 One 页面，不迁入 Frame workspace controller |
| 录制设置页 | `RecordingService.embed()` 创建 `WebContentsView` | 主窗口视图直接挂载 | 删除这条嵌入链路，抽出 `mountRecorder()` |
| IPC 权限 | 应用入口、各独立窗口及特定 URL 分别校验 | `roles` 与 `handle()` 允许列表 | 明确注册 One 主页面宿主与各独立窗口角色，不靠放宽 URL 正则放行 |
| 设置 | Frame 自己的 settings、主题、托盘、快捷键 | One 集中设置、自动主题、备份与冲突处理 | One 管全局；截图录制专属设置进入命名空间 |
| 媒体 session | 录制、编辑等采用独立 partition 与协议处理 | 主窗口使用 One 自己的 session | 主页面资源/权限集中调度；独立播放器等仍可保留隔离 session |
| 应用身份 | Frame 的 appName、appId、单实例、托盘与退出 | One 已拥有这些流程 | 不复制 Frame 应用 bootstrap，不启动第二套应用身份 |

证据入口：Frame `scripts/renderer-entries.mjs`、`scripts/bundles.mjs`、`src/main/index.ts`；One [构建脚本](../../scripts/build.mjs)、[主视图](../../src/renderer/main-view.ts)、[renderer 分发](../../src/renderer/app.ts)。

### 3.1 为什么不能直接复制 Frame 的 index.ts

Frame `src/main/index.ts` 不只是业务入口，还会：

- 调用 `app.setName('Frame')`、设置 Frame AppUserModelId。
- 设置 `%APPDATA%\Frame` 与 sessionData，注册协议和单实例。
- 创建 Frame 主窗口、托盘，直接修改 `nativeTheme.themeSource`。
- 在退出时调用 `globalShortcut.unregisterAll()`，销毁自己的服务并 `app.quit()`。

原封不动接入会改变 One 的数据根目录、主题、托盘与快捷键，产生两套退出拦截。应从该文件提取业务服务，接入 One 的服务装配与生命周期，而不是作为第二个入口执行。

## 4. 页面与功能的迁移映射

以下 One 路由名是实施建议，尚未写入代码。

| One 入口 | 建议路由 | Frame 来源 | 必须保留的页面内容 |
| --- | --- | --- | --- |
| 截图 | `capture` | `app/app.ts` 的 `capturePage()`、`custom-capture.ts`、`capture-window-picker.ts` | 模式分段、来源卡片、单屏/全屏区分、窗口列表、多窗口组合、隐藏主窗口的分栏动作、自定义位置/尺寸/延迟、长截图入口 |
| 录制 | `recording` | `app/app.ts` 的 `recordPage()`、`recording/recorder.html` 与 `recorder.ts` | 原来源切换、左右布局、右侧设置页签、设备列表、声音测试、电平、摄像头预览、开始按钮和全部状态 |
| 素材 | `materials` | `app/app.ts` 的 `assetsPage()`、`recording-previews.ts` | 图片/录制分段、搜索、卡片、导入图片/视频/工程、继续编辑、删除、打开素材目录 |
| 贴图 | `pins` | `app/pins-page.ts`、`pins/pin.ts` 及操作面板 | 搜索、分组、状态筛选、多选与批量操作；桌面贴图变换、穿透和恢复交互 |

### 4.1 原样保留的业务范围

| 功能链 | 应迁入的主要代码 | 迁移原则 |
| --- | --- | --- |
| 截图与选区 | `main/capture*`、`shared/capture-*`、`renderer/capture/*` | 保留矩形、自由、折线、单窗、多窗、单屏、联合全屏及原始像素/透明区域规则 |
| 长截图 | `main/scroll-*`、`shared/scroll-*`、`renderer/capture/scroll-capture*` | 保留采集、稳定判断、拼接、取消、输出与会话恢复行为 |
| 标注与图片工程 | `renderer/editor/*`、`shared/image-*`、`main/image-editor.ts`、`image-project.ts` | 保留向量模型、选中编辑、历史、效果与原图；保存为 One 的 `.oneimage` 新工程 |
| 文字及敏感内容识别 | `main/ocr-*`、`sensitive-scanner.ts`、`shared/ocr.ts`、`shared/sensitive*` | 保留本地 OCR、语言包、候选预览、取消与一次撤销遮盖 |
| 翻译、表格与公式 | `renderer/recognition/*`、`main/translation-*`、`formula-client.ts`、`table-export.ts` | 保留现有服务选择、编辑/校正与复制/导出语义，不改成 AI 聊天窗口 |
| 输出流程 | `shared/capture-workflow.ts`、`main/capture-delivery.ts`、`capture-translation.ts`、`image-export.ts` | 保留步骤顺序、取消后继续、已完成步骤不重复及失败恢复 |
| 贴图与持久化 | `main/pins.ts`、`pin-store.ts`、`shared/pins.ts`、`renderer/pins/*` | 保留原内容、分组、窗口表现、穿透与恢复方式 |
| 音视频采集 | `main/recording.ts`、`native-audio.ts`、`native-video.ts`、`audio-test.ts` 等 | 改 UI 宿主，保留原生 MP4/录音与原有 WebM 业务分支 |
| 录制叠加层 | `recording-{camera,input,annotation,region}-overlay*`、`recording-toolbar*` 等 | 保留独立窗口、时间元数据、透明/置顶/不抢焦点行为 |
| 播放、工程和导出 | `recording-player*`、`recording-project*`、`recording-export*`、`recording-encoder.ts`、`recording-gif-worker.ts` | 按最新模型实现 `.onerec`，保留独立轨道、剪裁/倍速、GIF 帧编辑及三格式导出，删除历史版本转换分支 |

### 4.2 任务中心与设置的安置

源码中还存在 `tasksPage()` 和 `settingsPage()` 两个辅助页面。用户指定四个主入口，不应因此删除这两类能力，也不新增第五、第六个顶级入口。

- **任务状态**：保留任务模型、状态筛选和任务详情；在 One 概览增加截图录制任务摘要，提供“查看截图与录制任务”的入口，进入 One 的对应任务详情视图。失败/取消/完成状态不压缩为一句临时 toast。One 当前概览聚合的是文件、索引、磁盘、归档等任务，尚不能直接当作新任务类型的存储。
- **专属设置**：在 One 设置中增加“截图与录制”分类，直接复用 Frame 的截图输出流程、自定义截屏、远程控制兼容和八类快捷键表单内容。
- **全局外观/关闭/托盘**：并入 One 已有分类，不再保留一份 Frame 全局开关。Frame 字体缩放和模块语言等 One 缺少的能力保留在模块专属设置中。

## 5. 原生页面、组件与样式整合方案

### 5.1 页面使用 One 既有模式

四个页面直接加入 One `main-view.ts` 的页面列表、按需导入与 `activate()` 分发，使用普通 HTMLElement 和同一个 document。分别提供与 One 既有视图一致的页面内容函数和 setup/controller，不额外维护 Frame 的路由器、workspace 根、内层主题或导航状态。

建议页面入口为 `capture-view.ts`、`recording-view.ts`、`materials-view.ts`、`pins-view.ts`；内部较大的编辑和媒体逻辑按功能放入子目录。模板来自 Frame 已验收页面内容，业务逻辑从原大文件提取，不重新设计页面。

实施规则：

- 侧栏、页面标题和标题右侧动作使用 One 现有结构；把 Frame 对应标题和动作接入 One 的 heading actions，不再显示一层 Frame page-heading。
- 保持 Frame 内容区的来源卡片、左右布局、设置分段、工具条、属性面板、控件顺序与滚动关系。需要全宽或固定高度工作区时，在 One 页面布局中增加真实用途的公共布局能力，不强套普通表单页宽度。
- 使用 One 的组件初始化、外观广播、提示、弹窗、关闭控件和生命周期机制；业务服务为 One 持有的单例，页面各自有 controller。
- DOM ID 使用功能语义的唯一名称，例如 `recording-config-tabs`、`capture-mode`，同步修改 label/ARIA/测试引用；不依赖隔离树容纳重复 ID。
- 页面查询优先从自己的 HTMLElement 开始；订阅、observer、计时器有明确释放路径。这是正常页面生命周期，不引入 ShadowRoot 或另一套 scope/portal 框架。
- 独立截图层、图片编辑器、播放器、识别、贴图和录制浮层仍保留独立窗口，但其公共控件和基础样式同样使用 One 的共享源文件。

### 5.2 样式按职责归并，只维护 One 一套基础

不能直接加载整份 Frame `one-ui.css`、`design.css`、`one-components.css` 等副本，也不能给全部 Frame CSS 加前缀后继续长期维护。每一类样式必须归入以下三类之一：

| 原 Frame 样式类别 | 迁入后的归属 | 处理方式 |
| --- | --- | --- |
| 主题变量、基础字体、按钮/输入框、通用页签、弹窗、tooltip、滚动条 | One `styles.css`、`components.css` 及既有组件样式 | 已有等价规则直接复用；Frame 必需但 One 缺少的状态/尺寸能力合入 One 共用规则，删除重复定义 |
| 内联拾色器、音频电平、来源卡片等 One 新增共用能力 | One 对应共用组件与唯一样式文件 | 从 Frame 抽出为 One 正式组件；同一组件在主页面和独立窗口共用，不带 Frame 专属主题或皮肤 |
| 截图选区、标注画布、录制左右栏、素材网格、贴图布局等功能特有规则 | One 对应功能页样式，如 `capture.css`、`recording.css`、`materials.css`、`pins.css` | 保留必要布局、画布和状态规则，调整为 One 功能命名与变量；不夹带另一份按钮/弹窗/主题基础样式 |

原 Frame 应用标题栏、侧栏、workspace 外壳和全局 reset 规则不迁入。原 `:root/html/body` 中的通用内容归并到 One；录制等业务状态改为页面/工作区容器属性。独立窗口只组合 One 共用基础与各自功能 CSS，不保留第二套 Frame 基础。

归并前建立逐文件处置表，记录“复用 One、补齐 One、迁为功能样式、删除应用外壳”。归并后用 Frame 已验收界面检查布局与行为，并回归 One 原页面。不能靠追加越来越多的覆盖规则掩盖冲突，也不以“已经换用 One CSS”为理由接受功能页变样。

如果公共组件需要参数化，参数必须表达实际能力，例如紧凑尺寸、可搜索、异步加载、运行中锁定关闭；不增加只为维持另一套皮肤的 `variant: 'frame'`。

### 5.3 页面生命周期与 One API

页面采用 One 已有 `page()/setup()/activate()` 模式，新增 controller 只负责本页。共享组件沿用 One API，仅补齐业务需要的 loader、状态同步、动态移除清理、尺寸能力等，不为隔离页面重构全部组件。

业务 API 按截图、录制、素材、贴图和工程操作接入 One preload；页面从接入时就使用 One 的功能接口，不建立 `window.frame` facade、旧通道别名或双实现切换。保留业务数据含义，调用方与受限 preload 同步改造，移除原导航事件和自动启动脚本。

页面切换只激活/停用对应 controller，不重复创建服务。主窗口只有一个 One 标题、导航、外观源、提示入口和设置系统。

### 5.4 录制页取消嵌入：具体改造清单

当前事实：

- Frame `app/app.ts:491` 的 `updateEmbed()` 读取 `record-embed` 的矩形，调用 `recordEmbed(bounds)`。
- `main/recording.ts:1006` 的 `embed()` 创建 recorder `WebContentsView` 并加入宿主窗口。
- 同文件 `layout()` 以宿主 zoomFactor 将矩形转换为视图边界。
- `renderer/recording/recorder.ts` 在模块加载时查询整个 document、订阅事件并立即 `refresh()`。
- `recorder-audio-test.ts` 依赖全局元素 ID 和 `pagehide` 释放设备。
- 录制 IPC 还要求 sender 等于 recorder contents，且 URL 精确等于 recorder 页面；迁后 sender 将是 One 主 renderer。

需要做的改变：

1. 将 `recorder.html` 的设置内容抽成 One `recordingPage()` 模板，将 `recorder.ts` 转为 One `setupRecording(root)` controller；来源卡片、设置页签、表单、设备列表与状态渲染保留，通用组件与样式使用 One。
2. 用直接挂载的 recorder controller 替换 `record-embed` 占位、`ResizeObserver/updateEmbed()` 和 `recordEmbed(bounds)`。录制页不再计算原生子视图位置。
3. 删除主窗口设置页使用的 `RecordingService.embed()/layout()`、相关 `WebContentsView` 字段及 `recording-embed.ts` 契约；独立播放器/浮层仍保留。
4. 将 `contents/host` 拆成明确的 UI 客户端与窗口 owner。由服务绑定经校验的 One 主 webContents，向该客户端发送录制状态、开始/停止、设备和电平事件。
5. 主页面的 `RecordingAPI` 从 One preload 功能 API 获取；不要在同一 renderer 再运行一个自动初始化的 `recorder.ts` 单例或伪造 `recorder.html` URL。
6. 将 document 全局查询改为页面查询，统一功能 ID。原 `recordingEmbedded` 的布局结果并入 One 录制页的正常布局，不保留嵌入开关或 Frame 专属皮肤。
7. 将 module 顶层订阅、`visibilitychange/pagehide/beforeunload` 改为 controller 生命周期。订阅返回值、定时器、来源预览、AudioContext/MediaStream、DOM 监听和 observer 均登记在 controller 中。
8. **切走录制页与停止录制分开**：离开页面时停止闲置的声音测试和摄像头设置预览；已经开始的采集继续运行，返回页面继续显示当前状态。销毁和退出才进入对应的停止/保存/放弃流程。
9. 保留一个有效的 renderer 采集客户端，覆盖当前 WebM 分支。One 隐藏到托盘、主页面切换或开发刷新不能把它当作普通无状态页面销毁。
10. One Header 的开始动作只触发同一个 controller/服务，不同时触发原 `recordPage()` 与新 recorder 按钮，避免一次点击发起两次录制。

这一阶段必须验证“页面确实同 renderer 直接挂载”，不能只验证画面看起来相同。

## 6. 共用组件逐项比较与取舍

### 6.1 直接复用或小幅适配 One

| 能力 | Frame 来源 | One 来源 | 已发现的差异 | 采用方案 |
| --- | --- | --- | --- | --- |
| 选项键盘导航 | `renderer/ui/option-list.ts` | `renderer/option-list.ts` | 跳过禁用项、焦点切换和列表内滚动逻辑一致，主要是排版差异 | 直接使用 One，不保留第二份 |
| 字体类型与校验 | `shared/fonts.ts` | `shared/fonts.ts` | 字体值均为 system/sans/mono/installed；Frame 带翻译包装 | 使用 One 类型、校验与 fontStack，标签接入 One 对应功能的语言词条 |
| 原生字体枚举 | `main/fonts.ts`、`native/FontHost.cpp`、`font-list.h` | `main/fonts.ts`、`native/font-list.h`、`One.Native.exe` | 两库 `font-list.h` 字节完全相同，外层 helper 名不同 | 使用 One 字体服务，不迁入重复 FontHost.exe |
| 字体加载缓存 | `renderer/ui/font-runtime.ts` | `renderer/font-runtime.ts` | 两边都有 FontFace 缓存、约六项保留与刷新，不是 One 完全缺少缓存 | 使用 One runtime 与字体服务，补齐必要资源释放能力，不保留 Frame 字体加载副本 |
| 窗口按钮 | Frame chrome preload/renderer | `renderer/chrome.ts`、One window action/state | 主窗口外壳归属不同，独立窗口按钮和关闭守卫需要保留 | 主窗口完全使用 One；独立窗口使用 One chrome 的适配接口与原按钮尺寸 |
| 图标 | Frame `ui/ui.ts`、lucide | One `ui.ts`、lucide | 同为 lucide，图标注册和名称表不同 | 使用 One 注册机制，补齐 Frame 图标映射，不改图标形状与尺寸 |
| 文件/图片基础元信息 | image-size、剪贴板/文件入口 | image-size、Electron 剪贴板及既有工具 | One 的业务入口不是 Frame 输出流程 | 复用基础库/安全文件操作，截图录制专属容量及输出规则继续由最新模型校验 |

### 6.2 必须先补齐 One，再复用

| 组件 | 代码对照 | One 当前缺口或差异 | 必须补齐的能力与 UI 保留方式 |
| --- | --- | --- | --- |
| 下拉与数字控件 | Frame `ui/controls.ts`；One `controls.ts` | Frame 有 `setSelectLoader()`、选项 MutationObserver、来源图标、加载失败事件、`onRemoval()`；One 公共 API 和更新路径不完全相同 | 给 One 加可选异步 loader、取消/失败/重试、选项变化同步、图标/显示标签与移除清理；保留 Frame 字段标记与原布局，数字输入事件/min/max/step 不变 |
| 弹层定位 | Frame `ui/anchored-popover.ts`；One `anchored-popover.ts` | Frame 提供 open/close 生命周期、宽高约束与动画；One 提供 position/track API | 使用 One 定位/跟踪核心，补齐宽高约束、打开关闭状态和 detach 清理；页面改用 One API，不长期保留 Frame 弹层适配层 |
| 分段页签 SegmentTab | Frame `ui/segments.ts`；One `segments.ts` | 两边都有 observer、尺寸更新和键盘操作；初始化与动态页面生命周期有差异 | 使用 One 实现，补齐激活/隐藏后的测量和移除清理；在 One 共用页签样式中承接必要尺寸/状态，保持来源与设置页签的顺序和交互 |
| 字体选择器 | Frame `ui/font-picker.ts`；One `font-picker.ts` | 两边都有搜索/预览/刷新；Frame 有移除清理和自身弹层管理；One 服务对非 main 窗口字体来源有额外限制 | 使用 One picker 与其唯一样式，补齐动态移除与资源释放；授权编辑器读取经过校验的选中字体，不限于全局 UI 字体 |
| 快捷键录入 | Frame `ui/shortcut.ts`、`main/shortcut-recorder.ts`；One `shortcut.ts`、`main/shortcut-capture.ts` | One 有冲突检测及占用定位；Frame 有自己的反馈、事件和编辑暂停逻辑 | 使用 One 捕获与冲突服务，统一全局暂停/恢复，保留 Frame 字段与错误反馈；兼容单功能键、清除、取消与失败回滚，不再构建 ShortcutHost.exe |
| 主题与外观 | Frame `shared/appearance.ts`、`ui/appearance.ts`；One `appearance.ts` 与主题调度 | 字段大多一致；Frame 有 100/110/125/150% scale，主题另存于 settings.theme；One 有自己的自动主题与弹窗位置 | One 为唯一外观源，迁入样式改用 One 变量；保留功能缩放能力，不擅自缩放 One 其他页面，不运行第二套 Frame appearance 引擎 |
| 弹窗 | Frame `ui/dialog-shell.ts`、`dialog-motion.ts`；One `dialog.ts` | Frame 有 dismiss lock 与运行中表单保护；One 有通用确认、焦点恢复和动画 | 给 One dialog 增加可选 dismiss lock 与受控 close，使用同一公共样式；保留业务表单与必要尺寸，不用原生 messageBox 替换页内表单 |
| Tooltip | Frame `ui/tooltip.ts`、`main/native-tooltip.ts`；One `tooltip.ts`、`main/native-tooltip.ts` | Frame 有 `data-tooltip-occlusion` 与原生浮层回退；两边 tooltip 数据结构不同；主页面不再有 recorder 原生视图 | 统一使用 One tooltip 与边界定位。独立窗口确需越过原生遮挡时补齐 One NativeTooltipService；不保留 Frame tooltip 副本或已失去用途的遮挡回退 |
| 状态反馈 | Frame `ui/feedback.ts`、`notice.ts`；One `ui.ts` 的 toast | Frame 支持持续反馈、取消/操作按钮、内容驱动布局和主动收起；One 简单 toast 不等价 | 在 One 抽出共用 feedback controller，吸收 Frame 所需能力；Frame 原 snackbar 的位置、可取消和失败恢复不退化 |

**归并原则**：共用组件的逻辑和基础样式都只有一份，归 One 维护。保留必要业务布局并不等于保留 Frame 皮肤；One 缺少能力时增加真实用途的参数/状态，不建立 Frame 专用通用组件、样式副本或长期兼容外壳。归并过程仍对照原布局与交互验收。

### 6.3 功能不等价，保留 Frame 并作为 One 新能力

| 能力 | 容易误判为同类的 One 功能 | 本次取舍 |
| --- | --- | --- |
| 内联颜色拾取器 | `ColorPalette`、独立颜色编辑窗、屏幕取色 | One 的色板/结果窗不能代替 Frame HSV 平面、HEX/RGB、预设色及可内联的拾色器。将 Frame picker 整理为 One 新共用组件，尽可能复用 `shared/colors.ts` 的格式工具；不把点击颜色改为弹出独立窗口 |
| 截图与多窗组合 | One 条码截图框选、屏幕尺、取色 | One 条码框选只做特定显示器采集和裁切，不包含 Frame 的标注、透明轮廓、多窗布局和输出工作流。保留 Frame 采集与选区链路 |
| 图片向量编辑 | One 图片裁剪、缩放、转换、压缩 | One 工具是批处理或单项图像操作，不等价于 Frame 可编辑标注与工程。并列保留现有工具，不替换其算法或入口 |
| 表格识别与编辑 | One `table-view.ts`、XLSX 预览 | One 预览不是 OCR 表格重建、合并拆分和校正编辑器。保留 Frame 识别/编辑/Excel 导出 |
| 录音电平与设备来源 | One 音量、按键回显、HUD | 系统控制/提示不等价于录制音轨、采样测试或带时间元数据的回显轨道。保留 Frame 模型和 UI |
| 摄像头/窗口来源卡片 | One 文件列表、预览卡片 | 来源选择、实时缩略图与生命周期不同。将来源卡片、预览调度与音频电平控件归入 One 对应功能 |
| 分栏动作按钮与特殊属性栏 | One 各页面局部菜单 | split-button 整理成 One 新共用组件；标注属性、笔刷光标、序号、聚光灯、水印作为 One 图片编辑功能保留，不随其迁入第二套通用按钮样式 |
| OCR 与语言包 | One 条码解码、图像 AI | 不用条码或图像推理服务替换文字识别；迁入原 Tesseract 工作线程及语言包管理 |
| 功能语言切换 | One 当前中文主界面、安装器语言 | 将来源 `shared/language.ts` 的语言能力、i18n 和英文词条归入 One 功能域；删除旧产品品牌、全局对象与词条前缀；不把安装器语言当作主界面语言支持，也不扩展为整款 One 国际化工程 |

### 6.4 AI/翻译服务的特殊取舍

One 已有 AI profiles、系统加密密钥、模型与取消管理；Frame 则有分别配置的翻译/公式连接，支持完整 Chat Completions endpoint，翻译还支持 Azure Translator。

推荐拆成两层：

- 复用 One 的密钥存储与服务配置基础设施，提供 **不建立聊天会话、不写聊天历史** 的请求接口。
- 保留 Frame 的文字/图片发送时机、目的、输出校验、超时、取消和结果模型。表单继续显示实际发送地址及内容信息；截图输出流程仍按用户配置执行。
- 为 One 补充 Azure Translator 连接类型，或在同一凭据设施上实现 Azure Translator 请求能力；不能因 One AI 当前没有 Azure 类型就删掉该选项。
- 不能盲目把 Frame 完整 endpoint 交给 One 的 baseUrl 拼接逻辑。建立明确的 endpoint/baseUrl 适配，保持原 URL 路径。
- 图像公式识别继续只在原主动动作时发送当前图片，不因复用 AI 服务而后台上传、加入会话或改变结果格式。

## 7. 主进程、IPC 与 session 整合

### 7.1 模块装配与归属

由 One 主入口持有截图、录制、素材、贴图、识别与工程服务，复用 One 的目录、主题、日志、快捷键、字体、文件对话框和后台任务接口。装配较大时可抽成 `capture-recording-services.ts`，但它只集合功能服务，不形成带自身路由、设置、外观和窗口身份的 Frame 子应用。

迁入的功能服务不得自行设置 appName/appId/userData/sessionData，不自行建立托盘和单实例，也不调用 `globalShortcut.unregisterAll()` 或直接决定整款 One 退出。

业务模型与服务按截图、录制、图片编辑、识别、素材、贴图分到 One 对应功能目录。迁移过程中可以保留源文件对应关系帮助核对，但最终不保留 `renderer/frame/workspace` 或 Frame 通用 UI 基础目录。同名 `native.ts`、`types.ts`、`clipboard.ts`、`appearance.ts` 先按能力拆分再合并，不能覆盖 One 文件或留下两套同类服务。

### 7.2 IPC 权限

- 主窗口增加 One 截图、录制、素材、贴图等功能 API，页面直接调用 One 接口。统一定义类型、请求/事件名称和错误结构，不引入 FrameAPI 或旧全局对象。
- 独立窗口使用对应功能的受限 preload；请求、响应、订阅和取消端同步采用 `one:<功能>-<动作>` 通道。删除旧 `frame:*` 注册、别名与 fallback，不在主进程保留独立 Frame handler 层。
- `CaptureAPI`、`RecordingAPI` 等按功能组织的接口绑定 One 注册的客户端；主页面录制不再要求 URL 是 `recorder.html`，而是验证实际注册的主 webContents、主 frame、服务会话和有效操作状态。
- 其他窗口继续做角色、owner、token、资源范围检查。One 现有 `handle()` 默认只允许 main，按截图层、编辑器、播放器、贴图等角色逐项授权，不能把全部新增 IPC 开放给所有窗口。
- 字体、外观、chrome、错误反馈复用 One API 时只暴露需要的接口；不把 One 完整管理 API 暴露给截图层或贴图窗口。

### 7.3 session 与权限：直接挂载后必须改变的地方

Frame 录制 session 当前安装了资源协议、媒体权限 handler、display media handler，以及对 http/https/file 的请求阻断。原录制页面存在独立 partition 中，这些限制不会作用到 Frame 的其他页面。

迁后录制 UI 位于 One 主 renderer：

1. **不能把这些 session handler 原样安装到 One defaultSession**，否则可能阻断 One AI、其他网络请求或覆盖 One 权限规则。
2. 建立 One 集中的权限与媒体请求调度，按请求 webContents、来源、录制活动 token 和当前选择判断；handler 每个 session 只装配一次，由 One 服务注册与释放。
3. 原生 MP4/录音尽量沿用 native helper 和主进程调度；WebM 等现有 renderer 媒体分支保留请求能力并受同一宿主授权校验。
4. 摄像头设置预览、录制素材流、独立音轨需要在 One 主 session 可用。扩展 One 现有 `one` / `one-file` 资源调度，通过会话 token、资源 ID 与 owner 限制读取范围；保留媒体 Range/流式读取能力，不暴露任意本地路径。
5. 独立播放器、编辑器、导出页可按必要权限边界使用隔离 partition，统一命名为 One 功能域并由 One 注册资源与权限。删除旧产品 scheme、partition、URL 生成器与协议 handler，不保留协议转发别名。
6. CSP 分别配置：One 主页面需要新增的媒体/图像/字体资源来源，独立窗口保留各自白名单；不通过全局 `unsafe-eval`、`nodeIntegration` 或关闭 webSecurity 解决。

### 7.4 生命周期、快捷键与互斥

- One 统一管理“关闭到托盘”与真正退出；对应功能服务提供采集中、未保存图片/录制/长截图、待导出等状态和退出前检查。
- 将各功能服务的 dispose 加入 One 既有异步退出流程，等待工程提交/原子保存结束后再结束进程；取消退出不清空录制和编辑状态。
- 截图与录制八类快捷键加入 One 管理；捕获编辑快捷键期间暂停的动作须统一恢复，不能恢复某类功能时误触其他动作或遗漏热键清理。
- 截图、取色、屏幕尺、条码框选及区域选择等会竞争屏幕覆盖层。建立仅覆盖这些交互的协调入口，保留原停止/返回行为，不禁止无关的后台任务。
- One 自动主题是唯一主题来源。不运行 Frame appearance 引擎，也不把录制业务状态写入 One 全局 html 属性。
- 主页面切换不得结束已开始录制；One 开发刷新、退出、主 renderer 崩溃按统一恢复/停止流程处理，不以删除临时目录处理活动工程。

## 8. 构建、依赖与原生程序

### 8.1 建议目录和资源边界

```text
src/main/capture/         截图与长截图服务
src/main/recording/       采集、工程、播放器与导出服务
src/main/recognition/     OCR、表格、公式、翻译服务
src/shared/<功能>/        图片/录制/工程等模型及校验，按实际复杂度拆分
src/renderer/*-view.ts    capture / recording / materials / pins 原生页面
src/renderer/<功能>/      较大的编辑器、专属窗口与页面内部逻辑
src/renderer/*.css        对应功能样式；公共基础仍归 One 原共用文件
src/preload/<功能>.ts     独立窗口受限 preload；主页面 API 归 One preload
native/<功能>/           One 没有的截图/音视频辅助程序
tests/<功能>/            迁入的专项用例与 One 集成用例
```

在 One 资源定位机制中登记新增 renderer、preload、worker、native helper、数据和临时目录。Frame 原代码多处依赖 `join(__dirname, '../preload/...')`、`../renderer`、`../native`，不能在移动目录后假设这些相对关系仍成立。

构建产物沿用 One 的 `dist/renderer`、`dist/preload`、`dist/main` 与 `dist/native`，为新增独立页面、worker 和 helper 使用唯一功能名称。不要生成第二套 `dist/frame/renderer` 应用目录；路径清单只管理实际新增资源。

### 8.2 构建入口

- One Vite 负责四个原生功能页，使用与既有页面相同的按需导入方式，不构建 Frame workspace 入口。
- Frame 当前清单有 19 个 HTML 页面入口；迁后主 app 页面与 recorder 设置页不再作为嵌入页面加载，其他独立窗口按实际用途保留文档入口。
- 保留 formula preview、mosaic worker、录制导出 renderer 等特殊入口，不能只迁移看得见的 HTML。
- 保留 OCR runner/engine/worker、scroll worker、recording GIF worker 等 Node worker 入口。
- 独立页面可继续使用小型 esbuild 多入口任务，由 One build/dev 调用；不必为了使用 Vite 而改写已工作的独立窗口业务。
- 新功能 CSS 随 One 对应页面构建，字体资产通过 One 共用组件资源管理。独立窗口组合相同的 One 公共基础与其功能 CSS；不复制 Frame `one-ui.css`、主题或通用组件样式合集。
- One dev 监听新目录，页面/worker/原生修改各走既有重建路径；活动录制、未保存编辑时不得直接强制 reload 主 renderer。

### 8.3 依赖决策

| 依赖 | 当前情况 | 计划 |
| --- | --- | --- |
| Electron / TypeScript / esbuild | 两库版本相同或兼容范围覆盖 | 使用 One 工具链，不单独升级 |
| koffi / lucide | One 已有 | 使用 One 依赖，补图标注册与调用适配 |
| image-size 2.0.4 | Frame 运行依赖；One 当前为 devDependency | 按 Frame 主进程 external 使用情况移入 One runtime dependencies，避免目录包缺模块 |
| gifenc 1.0.3 | One 未有 | 迁入并锁定原版本，保留 GIF 编码行为 |
| tesseract.js 7.0.0 与 core | One 未有 | 迁入原 worker/core 路径及打包筛选；语言包继续按原流程管理 |
| KaTeX | Frame 0.19.0；One 0.17.x 范围 | 统一至当前公式功能使用的 0.19.0，并验证、适配 One AI/Markdown 数学渲染；维护一份依赖与字体资源，不建立另一套带产品前缀的 alias |
| FFmpeg / FFprobe | Frame 合成/导入支持查找外部工具；当前未随包提供 | 首轮保持原发现/能力校验/错误提示，保留无 FFmpeg 时的原片和工程保存；不把捆绑编码器作为迁移前提 |

KaTeX 版本统一与组件复用都需要验证 One 既有功能，不顺带升级其他无关依赖。

### 8.4 原生程序取舍

保留已工作的 `SourceHost`、`AudioHost`、`VideoHost`、`CaptureProbe`、`SingleCapture`、`ScrollCapture` 算法及对应头文件。输出资源统一采用 One 身份，建议分别为 `One.CaptureSources.exe`、`One.AudioCapture.exe`、`One.VideoCapture.exe`、`One.CaptureProbe.exe`、`One.SingleCapture.exe`、`One.ScrollCapture.exe`；同步更新构建脚本、资源解析、进程/管道名、版本信息与测试，不在首轮改写编码和采集算法。

- `FontHost`：使用 One.Native 字体命令替代，因为两边字体核心头文件一致。
- `ShortcutHost`：使用 One.Shortcut 与 One 捕获服务替代，完成原事件和编辑暂停行为适配后再移除重复 helper。
- `native.ts` 中 Win32 调用：仅合并已核实语义相同的基础能力。涉及物理坐标、窗口身份、DWM 刷新、采集保护、光标资源和进程限制的调用继续保留，不能按函数名相近直接替换。
- 沿用 One 的 Windows x64 工具链与缓存目录，构建哈希必须包含所有相关头文件和 manifest。
- 打包时把新 exe、Tesseract 及其 core/WASM 纳入明确的 asarUnpack/复制规则。不能因 dev 正常就认为安装目录也能找到 worker、字体和 native helper。

## 9. One 原生设置、数据、工程与入口

### 9.1 设置归属

| Frame 当前设置 | 迁后归属 | 处理方式 |
| --- | --- | --- |
| theme、字体、颜色、密度、圆角、toast 位置 | One 外观 | 直接使用 One 当前设置与公共样式 |
| 字体 scale | One 截图与录制专属设置 | 保留原四档，仅作用于对应功能页及窗口；不另建外观引擎 |
| closeToTray、trayAction | One 基本设置/托盘 | 使用 One 全局开关，截图动作进入 One 托盘菜单配置 |
| 八类功能快捷键 | One 设置中的截图与录制分类 | 统一占用检查，保留空值与失败回滚语义 |
| captureWorkflows、默认流程、watermark | One `settings.capture` | 使用最新版业务结构与校验，按功能重命名字段和类型 |
| customCapture、remoteCompatible | One `settings.capture` | 保留自定义截图和远程桌面采集行为；这里的 remoteCompatible 是功能选项，不是旧产品兼容 |
| 录制参数、素材目录、贴图偏好、识别配置 | One `settings.recording` / `materials` / `pins` / `recognition` | 按实际持久化职责归属，服务状态不塞入全局设置 |
| 翻译/公式密钥 | One 主进程安全存储 | 服务配置与专属用途分开，不在普通设置备份中导出明文密钥 |

`validateSettings()`、`mergeSettings()`、备份导入/导出和 reset 同步支持新增功能字段；字段缺失按 One 现有规则填默认值，维持 One 自己的设置/备份行为。重置设置与删除素材是不同动作。不添加旧产品设置读取、字段映射、密钥迁移或跨产品导入功能。

### 9.2 推荐新数据位置

所有目录通过 One 既有 userData、开发 profile 与临时目录服务解析，不硬编码用户账户路径。默认正式配置根为 `%APPDATA%\One\`，开发使用 One 开发 profile；功能目录直接放在根下，不加来源产品层级：

| 目录 / 存储 | 内容与归属 |
| --- | --- |
| `materials/images/`、`materials/recordings/` | One 图片/录制工程、原图/原片、媒体轨道与索引；索引和资源保持同一权威归属 |
| `pins/` | 贴图内容、分组、几何位置与恢复状态；引用素材使用稳定 ID |
| `recognition/` | OCR 语言包、引擎资源及需要持久化的识别配置；服务密钥使用 One 安全存储 |
| `drafts/` | 图片编辑、录制、长截图等未完成会话的恢复信息 |
| One 缓存 / 临时目录 | 可重建缩略图、预览、临时合成与导出中间文件；与不可丢弃的原片、草稿分开 |

“打开素材目录”打开实际 One 素材根。素材根若支持自定义位置，由 One 功能设置维护一个有效位置；不默认写到安装目录旁，不扫描或共用旧产品数据根。

### 9.3 新数据的生命周期

1. 由 One 服务创建、校验和分配工程/素材/会话 ID，复用最新版业务模型的关联规则，统一资源引用与索引更新。
2. 保存先写临时文件，校验成功后原子提交；工程、索引与素材引用的提交顺序覆盖失败恢复，不留下看似成功但缺原片的记录。
3. 预览、缩略图等缓存可重建；原图、原片、独立轨道、编辑历史与可恢复草稿不能按缓存清理。
4. 启动恢复只检查 One 自己的会话与草稿；取消、崩溃和重试保持最新版业务语义。
5. 素材删除、工程另存、贴图引用、素材目录配置与退出保存按同一存储契约实现；必要的关联一致性验证针对 One 新数据。
6. 不实现旧产品数据检测、复制导入、迁移日志、版本升级、双写或回退开关，也不清理旧仓库或旧数据。

### 9.4 One 工程格式

| 新格式 | 必须保存的能力 | 格式约定 |
| --- | --- | --- |
| `.oneimage` | 原图、可编辑向量标注、变换、输出效果、撤销/重做及压缩历史等最新模型字段 | One 图片工程，新的 magic/manifest 格式标识，初始版本 1 |
| `.onerec` | 原片、独立声音、摄像头、光标、标注时间轴、剪裁/倍速、GIF 帧编辑与导出设置等最新模型字段 | One 录制工程，新的 magic/manifest 格式标识，初始版本 1 |

版本 1 表示 One 格式的首版，数据能力取最新版模型，不能退回来源项目的历史 v1。可以复用最新容器编码、压缩和原子保存算法，但产品标识、schema、读写校验和错误文案须整体更新，不是仅替换后缀。

- 不支持 `.frameimage`、`.framerec`、旧 magic 或其 v1/v2/v3 读取别名/升级路径；移除对应解析、转换、文件筛选和测试分支。
- 当前读写器只识别 One 明确定义的 schema 和版本；未知或损坏文件按正常错误路径处理，不猜测旧格式。
- 原图与原始媒体无需因封装为 One 工程而重新编码；完整保留编辑与导出能力。
- 素材导入继续支持原有普通图片/视频类型及上述 One 工程；新建、另存、保存对话框、拖放、最近记录、文件图标与工程关联统一使用新格式。
- One 启动文件分发把新工程交给图片/录制工程服务；工程编辑与成品预览使用明确的处理入口。
- 从最新版数据模型生成 One 格式 fixture，验证创建→保存→重开→继续编辑→再次保存的完整往返。旧测试中与业务能力有关的断言保留，旧产品兼容断言删除。

### 9.5 One 系统入口与 URI

One 搜索命令、全局快捷键、托盘和启动文件参数直接调用对应功能服务，并接入 One 单实例和窗口唤醒。安装器只登记本次新增的 `.oneimage`、`.onerec` 工程关联，使用 One 的 ProgID、图标与打开命令。

内部 Electron 资源协议和 Windows 外部启动协议分开处理：内部扩展 One 已有资源 route；移除旧产品 URI 生产、解析和注册。当前没有必须依赖外部 URI 的已授权链路，删除 Clip 后不为替代其协议而新增一个空的外部协议系统；以后若有明确的 One 外部调用需求，再在 One 身份下定义动作与参数。

Clip 的 `image-handoff-*` 票据/队列/超时/回传、命名管道、旧产品协议接管、安装并存切换与相应用例全部排除。One 内部“打开图片编辑”“将结果交给素材/贴图”等功能通过受限的业务接口直接传递资源 ID，保留正常复制图片与通用文件导入能力。

## 10. 分阶段实施计划

阶段编号用于组织逻辑提交与验证；正式实施进度进入 One [当前功能 TODO](TODO.md)，本文件不另建第二份持续进度清单。

| 阶段 | 核心工作 | 主要修改位置 | 完成条件 |
| --- | --- | --- | --- |
| P0 最新基线与 One 契约 | 确认两库最新提交，保存用户认可的页面/行为参照；确定功能命名、设置字段、数据归属、新工程 schema 和业务 fixture 清单 | 调研证据、One 类型/格式设计、测试清单 | 最新功能范围及 One 原生契约明确；无旧格式、旧数据、旧版本或 Clip 工作项 |
| P1 One 组件与样式归并 | 对照通用组件，补齐真实缺口；完成公共/新增共用/功能特有样式的逐文件处置，不引入隔离树或 Frame 皮肤 | `renderer/controls.ts`、`segments.ts`、`dialog.ts`、font/tooltip/popover、One 公共样式 | One 原页面行为不变；新页面只使用 One 共用基础；原布局、focus/键盘/弹层可保留 |
| P2 One 功能服务与构建 | 将业务服务接入 One 装配/生命周期，统一 One IPC、资源 URI、角色和 helper 名；登记独立窗口/worker/native 资源 | One main 对应功能目录、preload、build/dev/package | 单一应用身份、设置根、托盘、快捷键和退出；无旧全局 API、handler、通道或协议别名 |
| P3 四个 One 原生页面 | 新侧栏分组，将四页内容和标题动作分别接入 One 现有 page/setup/activate 模式 | `renderer/main-view.ts`、`shared/menu-builtins.ts`、四个 `*-view.ts` 与功能 CSS | 四入口在普通 DOM 中直接挂载，切页无重复监听和状态串页；无 Frame workspace、重复 Header 或 app.html |
| P4 截图、编辑与输出 | 接通采集、长截图、标注、`.oneimage` 读写、素材、输出流程与贴图窗口 | One 截图/图片编辑/素材/贴图业务目录 | 专项业务用例与宿主链路一致；原图/标注/历史/透明输出未改变，新工程完整往返 |
| P5 识别与服务 | 迁入 OCR、敏感识别、表格、公式、翻译；统一安全配置与请求设施 | recognition、AI/凭据桥、workers | 本地/联网边界、取消恢复、结果校正和导出行为一致，Azure 保留 |
| P6 录制设置页原生整合 | 提取 One recording controller，删除 WCV embed；绑定 One 主 renderer，迁移媒体/设备预览权限与生命周期 | `recording-view.ts`、`recording.css`、One 录制服务、preload/session 调度 | SegmentTab 使用 One 共用实现、原页面布局与交互保留；无 iframe/webview/WCV/ShadowRoot；切页不停止活动录制 |
| P7 录制完整链路 | 接通原生音视频、摄像头、键鼠、标注、播放器、`.onerec` 读写、GIF 帧编辑与三格式导出 | 录制 services/shared/独立窗口/native | 原片与工程不丢；状态、独立音轨与叠加层、导入/导出/取消/重试一致，新工程完整往返 |
| P8 One 设置与数据收口 | 整合设置分类、默认值、备份/reset、素材索引、草稿恢复和缓存清理；存储契约从 P2/P4/P7 起即使用 | One settings、功能存储、备份与恢复服务 | 全部新数据归 One 功能域；保存失败、重开、恢复与清理正确，One 既有设置行为不变 |
| P9 One 系统入口 | 搜索命令、快捷键、托盘动作、文件参数、One 新工程关联 | menu-builtins、One 启动/单实例、安装器入口 | One 冷启动/单实例唤醒/工程打开正确；无旧产品协议注册、接管或 Clip 链路 |
| P10 集成验证与交付候选 | 原回归迁入、One 相邻功能回归、目录包资源和安装候选验收、文档同步 | 对应功能测试、One 既有专项测试、打包文档 | 通过下节验收；提交清晰；版本、源码/dev/目录包/安装状态分别记录 |

### 10.1 依赖与优先顺序

- P0 的命名与格式契约从后续第一处实现开始使用，不先写旧通道/旧后缀再集中替换。P1/P2 是后续页面的基础，先验证真实控件和主进程 API。
- P3 后先完成 P4，使截图、图片、素材、贴图链路可以作为第一批完整验证目标。
- **P6 是本轮最高风险的改造点**。应先验证来源切换、分段页签、设备列表/声音测试、摄像头预览和开始/停止，再接入 P7 全部效果。
- P6 在架构上可以早做小样验证，但不要在 P1/P2 未稳定时同时重构录制算法。
- 存储目录、ID、索引和工程格式在 P2/P4/P7 内随功能落地，P8 负责跨功能收口和恢复验证；P9 在工程读写稳定后验证系统入口。本计划没有旧数据导入或旧协议切换阶段。
- 每阶段保存可运行状态，禁止把失败的页面用“暂不支持”隐藏后宣布迁移完成。

### 10.2 逻辑提交边界

建议依次拆成：One 功能契约；共用组件与样式补齐；业务服务和资源构建接入；四个原生页面；截图/新图片工程/贴图；识别；录制页整合；新录制工程/完整媒体/导出；设置/数据收口；One 系统入口；验证与文档。每个提交同步更新生产者、消费者与相关 fixture，保持可运行，不引入等待后续清理的旧产品兼容层。

## 11. 验证策略：验证迁移差异，复用现有验收

### 11.1 UI 一致性

用户已经验收 Frame，因此比较基准是实施时确认的最新版原界面。保留页面布局与交互，公共控件使用 One 实现；产品名称、工程后缀、路径提示及入口说明按本计划改为 One，不要求复刻旧品牌文案。

比较时固定内容区尺寸、系统 DPI、主题、字体、模块 scale、来源样本和数据。One 外层侧栏/标题栏的变化按用户已确认范围排除；页面内部的尺寸、间距、滚动位置、图标、菜单、提示、动画和控件状态继续对照。

重点覆盖：

- 四个主页的空态、加载、正常内容和失败态；素材搜索/分段、贴图分组/筛选。
- 录制页五类来源和右栏各 SegmentTab、声音电平、设备切换、摄像头预览、开始可用/不可用状态。
- 标注属性、颜色/字体菜单、快捷键字段、运行中不可随意关闭的表单、取消反馈。
- 独立图片编辑、识别、播放器、贴图和录制浮层。
- 窄窗口、深浅色、模块缩放。复用 Frame 已有像素对照和 fixture，只有新增宿主差异才增加参照，不反复重采全部历史截图。

### 11.2 功能与数据

| 验收范围 | 可复用的 Frame 测试入口/文件 | 新增集成检查 |
| --- | --- | --- |
| 截图模式、原始像素与透明 | `capture-selection.ts`、`capture-desktop.ts`、`capture-rendering.ts` | One 外壳是否正确保留/隐藏；显示器/窗口入口路由 |
| 长截图 | `scroll-service.ts`、`scroll-session.cjs` | One 任务/取消/退出与长截图会话的关系 |
| 图片编辑和工程 | `editor-parity-cases.ts`、`image-project*.ts`、`annotation-editing-rendering.ts` | 从 One 素材/参数打开、保存重开、历史和文件关联 |
| OCR、翻译、表格、公式 | `ocr*`、`translation*`、`table*`、`formula*`、`sensitive*` | One 安全配置桥、资源路由和同主 session 的权限不相互覆盖 |
| 贴图 | `pins-rendering.ts`、`pins-session.cjs` | One 托盘/快捷键恢复穿透、主页面切换与批量操作 |
| 录制设置 UI | `audio-rendering.ts`、`camera-source-rendering.ts`、`recording-previews-rendering.ts` | One 原生 DOM 与公共组件/样式、页面 controller、activate/dispose、订阅只一份 |
| 原生音视频与合成 | `native-audio.ts`、`native-video.ts`、`recording-compositor.ts`、`recording-export.ts` | One 隐藏/恢复、退出守卫、设备切换、声音测试释放 |
| 视频导入与 GIF 编辑 | `recording-import.ts`、`video-import-rendering.ts`、`recording-gif.ts` | 从 One 素材入口进入，错误/取消后参数保留 |
| One 新工程与存储 | `image-project*.ts`、`recording-project.ts` 中最新版模型断言 | One 格式往返、标注/历史/轨道/时间轴完整性，损坏输入、原子保存、草稿恢复与引用一致性 |
| One 系统入口 | One 现有启动参数、单实例和菜单测试方式 | 新工程冷启动/唤醒打开、搜索/托盘/快捷键路由，新文件筛选和关联 |

迁移测试脚本时同步修改目录、IPC、preload、worker、资源 URI 与 One 新格式 fixture。保留最新版的像素/工程/轨道等业务断言；删除旧格式版本转换、旧产品启动与 Clip 交接用例，不把历史兼容 fixture 带入新读写器。不为了通过测试而弱化业务语义，不新增仅复述挂载函数的测试。

### 11.3 One 相邻功能回归

- 组件改动：原下拉、字体菜单、快捷键录入、确认弹窗、分段页签、tooltip。
- 原图片工具、屏幕取色、屏幕尺与条码框选：功能和外观保持原状，覆盖层互斥恢复正确。
- One AI 与 Markdown 数学渲染：不被 Frame session 网络拦截、endpoint 适配或 KaTeX 升级影响。
- One 文件/Office/音视频预览：资源协议、字体与原生 tooltip 正常。
- One 自动主题、搜索入口、设置备份、托盘和退出：不被 Frame 全局逻辑覆盖。

实施时运行与改动相称的现有检查：TypeScript、两库迁入的基础用例、专项 UI/原生用例、One 文档检查和构建；稳定后在目录包验证资源。完整硬件重验不作为本次“证明 Frame 已完成”的工作；仅对迁移改变的宿主、设备生命周期和打包路径做必要验证。

### 11.4 不能省略的迁移验收条件

1. One 侧栏仅增加指定分组与四个入口，页面内部视觉/交互满足基准。
2. 四个主页面是 One 原生页面，使用 One 路由、标题动作、公共组件和基础样式；无 Frame workspace、iframe、webview、recorder `WebContentsView` 或 ShadowRoot 隔离层。
3. 切页、隐藏到托盘、恢复窗口不导致活动录制意外停止或重复开始。
4. 网络、媒体权限、快捷键和退出统一由 One 管理，所有新增 handler 按功能/角色注册，原功能不受影响。
5. `.oneimage` / `.onerec` 能创建、保存、重开、继续编辑；最新版原图、标注、历史、独立轨道、时间轴与导出设置完整往返，只有 One 新格式标识及版本校验。
6. 导出失败/取消、保存取消和退出取消保持原恢复行为。
7. 共用组件的逻辑与基础样式已真正统一到 One；未留下 Frame 通用样式副本、Frame 专属皮肤或以接口适配为名长期运行的第二套 UI。
8. 发布资源不依赖 Frame 源码目录或其 node_modules，不依赖 dev 下偶然存在的文件。
9. One 新数据目录、设置字段、索引、草稿和缓存归属清晰；失败保存/取消/恢复不丢内容；不存在跨产品数据导入和历史版本转换代码。
10. One 搜索、快捷键、托盘、文件参数及新工程关联可用；不注册旧产品协议，不迁入 Clip 管道、票据、队列或回传链路。
11. 对源代码、构建产物、资源清单、工程样本与用户可见文案进行产品标识核对：没有来源产品的 API、目录、格式 magic、URI、partition、handler 或 helper 身份；普通视频帧/API 术语及必要版权归属不误改。

## 12. 风险与具体处理

| 风险 | 原因/证据 | 处理 |
| --- | --- | --- |
| 页面看似搬入，仍保留嵌入 renderer | 当前 recorder 依赖 embed/WCV 和独立 URL | P6 明确删除嵌入 API、view 字段和布局代码，并检查实际 webContents/DOM |
| 迁入重复样式导致 One 页面变化 | 大量同名 tag/class/ID 选择器，整包复制会保留两套基础 | 逐类归并到 One 公共组件/功能样式，删除重复规则和 Frame 外壳；回归双方布局与状态 |
| 弹层在错误位置或没有样式 | 迁入代码仍假定 Frame 文档结构，或缺少 One 共用规则 | 使用 One 弹层/对话框机制与同一份组件 CSS，检查顶层、焦点和页面激活清理 |
| 切页后设备泄漏或录制停止 | 原 recorder 用 pagehide/beforeunload 清理 | 显式区分 deactivate、dispose、stop，保留活动采集客户端 |
| One AI/网络请求被禁止 | Frame 私有 recording session 的 webRequest 封禁 | 不复制到 One defaultSession；由 One 统一权限/资源调度 |
| 标注字体无法加载 | One 非 main 窗口字体服务只允许当前 UI 字体 | 按角色和选中字体范围授权，不放开任意文件读取 |
| 复用后功能退化 | One controls、feedback、颜色面板与 Frame 并不等价 | 按组件矩阵补齐 One，共用实现满足原布局与行为验收 |
| One 自动主题/快捷键失效 | 来源应用直接设置 nativeTheme 或注销所有快捷键 | 全局归 One，各功能服务只通过统一接口注册与释放自身动作 |
| dev 能用、安装包缺资源 | 多入口、WASM、worker、native、asar 相对路径 | 路径清单与运行依赖分类；目录包专项检查 |
| 新工程仅改后缀或丢失编辑能力 | 容器标识、版本分支、轨道与历史处理分散在多处 | 明确 One schema、删除历史分支，以最新模型生成 fixture 并验证完整往返 |
| 工程/贴图索引或草稿不一致 | 素材、资源与窗口恢复状态跨服务关联 | One 功能存储统一 ID/引用/提交规则，验证保存失败、恢复与删除行为 |
| 产品身份残留 | 通道、资源 URL、partition、管道、helper、打包注册存在字符串耦合 | 生产者/消费者成组改造，逐类检查源码与目录包，不机械替换技术术语 frame |
| 主 renderer 重载影响 WebM | 采集从独立 recorder renderer 移到 One 主 renderer | 开发刷新和退出守卫保护活动会话，失效时走原停止/恢复流程 |

## 13. 调研依据索引

Frame 路径均相对于 `D:\Repositories\Frame`；One 路径均相对于 `D:\Repositories\One`。本节列的是已查阅源码，不是要求整体重写的文件列表。

| 结论 | Frame 精确入口 | One 精确入口 |
| --- | --- | --- |
| 页面分组/工作台 | `src/renderer/app/app.ts:91,139,204,227,389,511,533,602`；`app/index.html` | `src/renderer/main-view.ts:43,74,98,111` |
| 录制页面原为 WCV | `src/main/recording.ts:1006,1078`；`src/renderer/app/app.ts:491` | 主视图直接挂载模式见 `src/renderer/main-view.ts:74` |
| recorder 自动初始化与释放 | `src/renderer/recording/recorder.ts:56,1390,1407`；`recorder-audio-test.ts:53` | `src/renderer/app.ts:14`、各视图 controller 激活模式 |
| 录制 URL/sender 校验与 session | `src/main/recording.ts:372,408,412,455,536` | `src/main/index.ts:313,429` |
| 应用身份与退出不能复制 | `src/main/index.ts:62,71,79,1120,1135` | `src/main/index.ts:120,312,490,1182,1205` |
| 字体核心可复用 | `native/font-list.h`；`src/main/fonts.ts` | `native/font-list.h`；`src/main/fonts.ts:10,27` |
| 字体 IPC 范围不同 | `src/main/index.ts:660,664` | `src/main/index.ts:887,889,894` |
| 组件差异 | `src/renderer/ui/{controls,segments,font-picker,font-runtime,anchored-popover,shortcut,tooltip,dialog-shell,feedback,color-picker}.ts` | `src/renderer/{controls,segments,font-picker,font-runtime,anchored-popover,shortcut,tooltip,dialog,ui,color-palette}.ts` |
| 外观字段差异 | `src/shared/appearance.ts:3,4`；`shared/frame.ts:22` | `src/shared/types.ts:16`；`src/shared/settings.ts:27` |
| 翻译/公式与 One AI 不完全等价 | `src/shared/translation.ts:16,19`；`main/translation-client.ts`、`formula-client.ts` | `src/shared/ai.ts:1,3,24`；`src/main/ai-service.ts` |
| 原材料目录与索引 | `src/main/index.ts:812,820`；`materials.ts`、`assets.ts`、`pin-store.ts` | `src/main/index.ts:312,521`；`src/shared/settings.ts:14,30` |
| 最新工程模型与 One 入口 | `src/main/image-project.ts`、`recording-project.ts`（只取最新模型与保存算法） | `src/shared/menu-builtins.ts`；`src/main/index.ts` 启动分发 |
| 构建与打包 | `scripts/{renderer-entries,bundles,native,build}.mjs`；`package.json` | `scripts/{build,bundle-options,build-renderer,build-native,package}.mjs`；`package.json` |
| 已有回归入口 | `tests/`、`scripts/test*.mjs` | `tests/`、`scripts/test.mjs`、`scripts/verify.mjs` |

后续实施只需基于此基线检查相关差异；如果两库提交发生变化，先比较影响文件，不重新扫描所有历史日志或截图。
