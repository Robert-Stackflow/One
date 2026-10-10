# Office 预览库选型：免费开源优先

2026-10-10。用户反馈 Windows 原生预览及目录跳转卡顿，要求先调研替代库，优先免费开源。本轮核验官方文档、源码入口与发布元数据，并在独立窗口中测试 XLSX、DOCX 和 PPTX 候选；不改主程序依赖、不上传用户文件，不把宣传中的“高性能”视为实测结果。

## 选型结论

已发现同时提供 DOCX/XLSX/PPTX 查看器的 MIT 候选 `@silurus/ooxml`，其中 XLSX 日常格式、DOCX 自动分页和书签定位已有隔离实测证据，其 PPTX 尚未实测。当前仍没有可直接认定满足“免费开源、轻量离线、完整覆盖 DOC/DOCX、XLS/XLSX、PPT/PPTX、Office 保真”的单一 npm 库。旧格式与现代格式必须分别验证，文件解析能力也不能替代渲染保真验收。

继续按格式验证，不因 XLSX 首个候选失利而停止其他格式的筛选：

1. **XLSX：优先候选为 `@silurus/ooxml@0.88.0` 的现成 `XlsxViewer`。** 同组样本的前导零、公式金额、错误值、1904 日期、图片、柱状图、工作表切换和末行定位已通过，Electron 下也能显示。由库负责表格画布与交互，One 不重写网格。worker 绘制与主模式的日常样本截图逐像素一致，但大表仍有主线程长任务，不能据后台绘制承诺不卡顿。首个 `@js-preview/excel` 候选不采用；真实旧二进制 XLS 尚未验证。
2. **PPTX：新增优先候选 `@aiden0z/pptx-renderer@1.3.0`。** 新一轮检索发现了持续维护的浏览器渲染项目，不能只依据旧 PPTXjs 判断免费方案。自有样本的组合文字、母版/布局装饰、表格、图片、柱状图和目录 API 已通过隔离验证；列表模式需要稳定滚动条布局。尚未完整对照真实 PowerPoint 输出，也未完成 One 内集成与可见窗口验收，不宣称全格式保真。
3. **DOCX：优先候选为统一库的 `DocxDocument` + `DocxScrollViewer`，重点评估 worker 排版。** 无手动分页符的 120 段文字自动分为多页且没有丢段，书签映射到实际渲染页；主模式与 worker 模式的目标页截图一致。本轮 worker 样本未出现 ≥50 ms 主线程长任务，但这不是复杂文档保真或大文件性能承诺。worker 不暴露原始文档模型，目录需单独提取结构并映射到书签/源段落；不能只按重复标题文字搜索。LibreOffice 本地转换 + PDF.js 保留作对照；本机未发现完整引擎，未安装。旧 DOC/PPT 独立验证。
4. **ZetaOffice/ZetaJS 作为统一引擎备选。** 它在浏览器内提供 LibreOffice 能力，方向符合无需安装 Office，但整套引擎的冷启动、内存、资源体积和 Electron 离线集成尚未测量，不能预先承诺比原生快。

## 候选比较

| 候选 | 已核验能力与授权 | 对 One 的判断 |
| --- | --- | --- |
| `@silurus/ooxml` | 主项目 MIT，提供第三方声明；Rust/WASM 解析与现成 Canvas 查看器，独立 DOCX/XLSX/PPTX 入口 | XLSX/DOCX 优先候选，已实测日常表格、自动分页、书签和两种绘制路径。无需 Vue/React 或 Office 安装；复杂文件、PPTX 和旧格式仍需分别验证，不能据统一 API 宣称全部格式已通过。 |
| `@vue-office/excel` / `@js-preview/excel` | 发布包 MIT；支持本地二进制输入；底层 ExcelJS + x-data-spreadsheet，同项目提供纯 JavaScript 入口 | 已隔离测试 JS 入口；基础展示可用，但前导零、公式数字格式、错误值、图表与快速销毁存在问题。暂不接入主程序，不能把“可打开”当作保真通过。 |
| `@extend-ai/react-xlsx` | 仓库 MIT；React 查看器，使用 `@dukelib/sheets-wasm` 解析/计算，官方说明图片与图表展示及部分旧格式边界 | 新增备选，当前只核验 README/源码入口，未实测；上游 WASM 对应源码、许可和 React 引入成本需进一步核验。优先验证无需 React 的上述查看器。 |
| SheetXL | 官方模块表区分 MIT UI/IO 与商业 `@sheetxl/sdk` 核心 | UI 开源不等于整个 Excel 引擎免费开源，不作为当前优先方案。 |
| Univer | 核心 Apache-2.0；Sheets/Docs/Slides；官方将 Office 导入/导出归入 Pro，当前导入 API 明确需要转换后端 | 适合作为能力较全的长期选项，但不是免费核心包直接打开所有 Office 文件。不能为“免费开源”目标偷偷改为维护自有 OOXML 转换器。 |
| FortuneSheet | MIT；现成电子表格组件，支持格式、合并、冻结、图片等 | 可作 XLSX 备选。README 提到导入插件，但本轮只确认官方 packages 中 core/formula-parser/react，尚未确认可直接采用的完整导入包；图表/透视表保真不能按 README 泛称保证。 |
| SheetJS CE / ExcelJS | 读取、处理或生成表格数据的工具 | 不是 Office 展示引擎。把它们接到自绘 HTML 网格会回到原先问题；SheetJS CE 的数据 interchange 示例也不能视为完整样式、图片、图表预览。 |
| docx-preview | Apache-2.0；项目已经使用 0.4.1，生成 HTML | 可保留为轻量 DOCX 候选，但没有 Word 的实时自动分页。vue-office/docx 同样基于它，换包装不能消除已知分页边界。可继续核验字体和分页标记，但不承诺完整 Word 保真。 |
| Mammoth | DOCX 转语义 HTML，优先标题/结构而非原版式 | 适合阅读模式或提取目录，不适合作为本次高保真预览主引擎。 |
| `@aiden0z/pptx-renderer` | 主项目 Apache-2.0；独立浏览器 ESM，HTML/SVG 及图表渲染；发布包包含 MPL-2.0 的 mtx-decompressor 声明与来源 | 新增 PPTX 优先候选，已做下方隔离实测。无需 Vue/React 或服务端；不支持旧 PPT、动画/转场和任意 EMF/WMF。不能把主项目许可扩展成整个包只有 Apache-2.0。 |
| `@extend-ai/react-pptx` | 仓库 MIT；自有 Rust/WASM 解析器与 React 渲染器，官方明确区分 PPTX 与旧 OLE/PPT 解析链 | 新增旧 PPT 候选，核验到源码与格式边界，未下载或实测发布包。需评估 WASM 分发、React 引入及旧格式保真；不能据 README 当作旧 PPT 已通过。 |
| `@office-kit/pptx` / `@office-kit/xlsx` | MIT；读写与编辑模型；PPTX 渲染属于单独的 preview 包，XLSX 官方标 pre-1.0 alpha | 有持续维护，但 XLSX 读写与图表保留不等于提供现成工作表展示。未实测单独 preview 包，不为使用解析器而重建 One 自绘表格。 |
| PPTXjs | MIT；纯 JS 将 PPTX 转 HTML，包含形状、表格、图表等处理 | 保留对照，优先级低于新发现候选；官方仓库最后推送为 2022-03-26，示例仍依赖旧 jQuery/JSZip 2，不支持旧 PPT。 |
| vue-office/pptx / pptx-preview | 发布包声明许可与“可获得完整引擎源码”是两回事；vue-office README 明示其 PPTX 自研引擎源码需向作者付费索取 | 不把它列为已确认的完整开源引擎；需先澄清源码及维护范围。 |
| ZetaOffice + ZetaJS | LibreOffice 浏览器引擎与 UNO 接口；ZetaJS 包装层 MIT，LibreOffice 本体 MPL-2.0 及所含第三方许可 | 能统一处理文档/表格/幻灯片，是值得验证的整套引擎。官方服务仍标 open beta；可再分发本地构建的取得方式、自托管离线资源、跨源隔离、启动与内存待测。不能把包装层 MIT 扩大为整套引擎 MIT。 |
| LibreOffice 后台转换 + PDF.js | 免费开源；官方支持旧版/新版 MS Office 文件，并提供 PDF 导出与书签参数 | Word/PPT 的可行对照方案。转换后目录/切页由 PDF.js 接管；它仍需整套本地程序或引擎，不是轻量 npm 包。冷转换可能仍慢，需缓存和受控复用，分发体积待测。XLSX 转 PDF 会改变交互、缩放与分页，不作为主表格方案。 |
| ONLYOFFICE Docs Community | AGPL-3.0；需部署 DocumentServer，再嵌入网页 | 能统一 Office，但包含本地服务/转换链及整套编辑器，和轻量快速预览不匹配，暂不首选。不能按“前端组件”估算接入成本。 |

Luckysheet 官方仓库已在 2025-10-30 归档，不作为新增依赖。商业备选 Apryse WebViewer 提供客户端 Office 展示，SpreadJS 提供 Excel 展示/导入；按用户偏好仅保留备选，不采购、不接入。它们也需要样本验证，不代表付费就自动解决性能。

## XLSX 隔离样本核验

测试 `@js-preview/excel@1.7.14`：下载发布包并核对 npm SHA-512，压缩包约 972 KB，实际使用的 ESM 与 CSS 合计约 1.78 MB（未压缩）。未运行安装脚本，未修改项目清单或锁文件。测试窗口独立、隐藏、无 Node 集成，拒绝权限和外部网络，使用自行生成的报表、图片、图表和大表；内部关系目标检查通过，但未做完整 OOXML 模式或真实 Office 保真对照。

| 样本项目 | 实际结果 |
| --- | --- |
| 合并表头、字体/背景、金额、百分比、普通日期、多工作表 | 本样本显示正确；工作表切换能绘制目标标记。未据此推导所有样式都支持。 |
| 图片与隐藏行 | 自有 PNG 绘制可见，隐藏行内容不显示。图片画在 Canvas 上，不能用 DOM 图片数量判断丢图。 |
| 编号 `000000`，原值 123 | 显示 `123`，预期 `000123`。 |
| 带金额格式的缓存公式 | 显示 `1235.5`，预期 `$1,235.50`。 |
| 错误单元格 `#DIV/0!` | 显示 `[object Object]`。 |
| 1904 日期系统 | `date1904="1"` 时序号 0 正确显示 `1904-01-01`；合法布尔写法 `date1904="true"` 却显示 `1899-12-30`。已在源码定位到仅比较字符串 `"1"`，不能概括为全部 1904 日期都错误。 |
| 图表 | 样本图表未显示；源码的媒体绘制分支仅处理图片，未确认可用图表渲染链。完整图表 OOXML 未经 Office 对照，因此该项记为未通过，不作为全格式结论。 |
| 只读和外链 | 默认无编辑工具栏，显式关闭右键菜单；测试未发起外部 HTTP 请求，但尚未完整验证键盘编辑、外链点击与所有只读入口。 |
| 当前安全策略 | 原样 `connect-src 'self'` 会阻止内部 Blob 请求，导致加载失败。仅在研究窗口增加 `blob:` 后可显示，无需 `unsafe-eval`；主程序安全策略未改变。 |
| 关闭/连续切换 | 最终 DOM 与 Canvas 清空。第一轮切换工作表后立即销毁曾出现 `_worksheets` / `reRender` 空对象异常；源码有未在销毁时取消的延迟回调。每次操作留 400 ms 间隔的后续轮未出现异常，不能把等待当作产品修复。 |

可比的一轮测量：引擎模块已加载后，日常样本首个内容绘制约 **107 ms**，再次打开约 **49 ms**；10,000 行 × 12 列（120,000 单元格，压缩约 710 KB）约 **466 ms**，但产生 **200/246 ms** 两个主线程长任务，JS 堆采样约 **72 MB**。直接派发工作表点击到目标文字绘制约 **0.7–1.5 ms**。这些是单设备、隐藏窗口、合成样本的渲染测量，不含应用/模块冷启动，不代表屏幕呈现延迟、滚动帧率、峰值内存，也没有和原生方案做等条件对比。首轮等待两次动画帧出现约两秒的隐藏窗口调度干扰，未采用该值作为库响应结论。

**决策：暂不替换 XLSX 引擎。** 速度数据说明该方向值得继续比较，保真和生命周期问题说明它尚不能满足日常预览。后续候选仍应沿用同组样本，补真实 XLS、冻结/滚动、输入隔离和大文件取消；不要为了接入而在 One 内重写完整数字格式器、图表和网格。

复现材料位于 `work/current/office-preview/research/excel/`：`package-metadata.json`、`make-fixtures.cjs` + `validate-fixtures.cjs`、`run-probe.cjs`、`probe-baseline-csp.json`、`probe-first-pass.json`、`probe-results.json` 和 `daily-render.png`。研究目录不参与应用打包；原始文件未离开本机。运行方式为先生成并校验样本，再运行隔离探针；需要已核对的发布包文件和项目既有 Electron/Playwright/JSZip。

## 统一候选的 XLSX 隔离核验

新增下载并校验 `@silurus/ooxml@0.88.0`：npm SHA-512 通过，压缩包约 5.56 MB、全部解包约 16.78 MB；本轮实际读取的 XLSX 静态资源去重约 3.15 MB，其中解析 WASM 约 1.73 MB。未执行安装脚本、未修改应用依赖或 CSP。官方项目创建于 2026-04-18，尚需评估成熟度；MIT 主项目和第三方声明不等于已完成独立的全部依赖审计。

| 检查项 | 实测结果 |
| --- | --- |
| 同组日常样本 | 合并表头、中文、金额、百分比、日期、隐藏行、`000123`、公式缓存 `$1,235.50`、错误值 `#DIV/0!` 正确显示。`date1904="1"` 与 `"true"` 均显示 `1904-01-01`。选区上下文中的 `displayText` 与画布文字一致。 |
| 图片/图表 | ImageBitmap 绘制为 96×64 的自有 PNG，柱状图及标题/轴标签可见；已进行一次画面检查。不是任意图表、锚点、裁剪或条件格式的完整保真结论。 |
| 大表与切换 | 10,000 行×12 列可显示；两个工作表切换成功，定位 A10000 后确实绘制 `ROW_10000`。冻结、隐藏工作表、滚动和只读键盘已补隔离核验，见下方；筛选与主程序集成交互仍待验证。 |
| Electron 与安全策略 | 本机 Electron 的 Chromium 152 能加载、显示并切换日常样本；Chrome 154 无界面测试也通过。脚本使用原有 `wasm-unsafe-eval`，无须普通 `unsafe-eval` 或放宽 `connect-src`；关闭 Google Fonts 与外链点击，本轮无外部请求。 |
| 关闭与替换 | 加载大表约 10 ms 后销毁，加载请求结束并拒绝，DOM 清空；大表加载中改为日常表，最终仅绘制日常表标记，旧请求可正常 fulfilled 但失效结果被忽略。不能把所有取消都等同 `AbortError`。各轮观察到的 worker 创建/终止数量相等。 |
| 损坏与限额 | 资源条目限额会拒绝为 `OoxmlResourceLimitError`。非 ZIP 和损坏 ZIP 的 `load()` 却正常 fulfilled，画布显示 `ZIP central directory preflight failed` 诊断页；并非有效工作表，也不是静默成功。集成时不能只据 Promise 完成或 sheetCount 判定有效预览，需统一诊断提示。 |
| Blob 生命周期观察 | 主页面看到每次加载创建一个脚本 Blob URL，但撤销发生在 worker 内的首句 `URL.revokeObjectURL(import.meta.url)`，主页面钩子不会收到。已定位源码与 worker 创建/终止；不能把主页面未观察到 revoke 的计数当作已确认泄漏，也未据此宣称完整内存回收审计通过。 |

一轮 Chrome 154 测量中，模块加载后日常样本 `load()` 约 **287 ms**、首次文字绘制约 **212 ms**、包含图表的检查点约 **296 ms**；再次打开约 **85 ms**。12 万单元格约 **960 ms**，有 **123/101 ms** 两个主线程长任务，JS 堆采样约 **33 MB**；工作表切换约 **3–12 ms**，末行定位 API 约 **3.5 ms**。独立隐藏 Electron 的日常样本加载约 **263 ms**、图表检查点约 **280 ms**。均非应用冷启动、峰值内存或真实前台点击延迟；两个浏览器版本不混作一次公平性能对比。默认路径为 worker 解析、主线程绘制，完整 worker 绘制结果见下段。

完整 `mode: 'worker'` 路径也已测试：日常样本约 **446 ms**，12 万单元格约 **1,185 ms**，后者仍出现 **119/73 ms** 主线程长任务；两个工作表与末行定位、加载中销毁、连续替换及资源限额均有效，8 个 worker 全部终止。日常截图 1100×750、825,000 像素与主模式 **零差异**。这轮 worker 样本加载更慢，不能默认选择 worker 或宣称卡顿已解决。

**决策：XLSX 进入优先集成评估，保真优先于单项速度。** 当前结果比首个候选更接近日常需求；仍需大表进度/中止、真实文件、冻结和统一错误提示。DOCX 已补自动分页/目录试验，PPTX 尚未测试统一库；XLSX 已开始源码接入，范围与验证见 [XLSX 网页预览](../development/features/XLSX网页预览.md)。

材料位于 `work/current/office-preview/research/unified/`：`package-metadata.json`、`probe-results.json`、`probe-electron-results.json`、`probe-lifecycle-results.json`、`probe-worker-results.json`、`pixel-comparison.json`、`daily-render.png`、`worker-daily-render.png` 与探针源码。沿用自有 XLSX，并只派生合法布尔标记的 1904 样本；用户文件未参与，测试进程已退出。

## XLSX 日常交互隔离核验

同一 `@silurus/ooxml@0.88.0` 发布包，新增自产 120 行×30 列、4 个工作表的样本：冻结前 2 行与第 1 列，第 3 行/C 列隐藏，另有 hidden 与 veryHidden 工作表。8 个内部关系目标存在；这是关系完整性检查，不是完整 OOXML Schema 或 Excel 对照验证。Chrome 154、1100×750 视口、原有安全策略下进行实际鼠标和键盘操作。

| 检查项 | 实测结果及接入要求 |
| --- | --- |
| 冻结与双向滚动 | 定位 J80 后，横/纵偏移为 771/1202，目标单元格在视口内；A1 仍位于 x=50/y=22，行/列冻结标记实际绘制。鼠标滚轮再横移 500、纵移 300，偏移变为 1271/1502，A1 位置不变；已检查画面。 |
| 隐藏行列 | 第 3 行高度为 0、C 列宽度为 0，隐藏格不占显示空间；直接程序选取仍能读取它们，不能把显示隐藏当成数据访问限制。 |
| 隐藏工作表 | 默认 `hiddenSheetMode: 'show'` 会显示全部 4 张表，集成时应显式设为 `'skip'`。skip 只显示两张可见表，前后切换从索引 0 到 3；dim/show 则依序经过 0/1/2/3。实际点击最后一张可见表也定位到索引 3。 |
| 隐藏表 API 边界 | skip 模式仍允许直接 `goToSheet(1)`，不会拒绝隐藏表索引。后续 One 自有目录/搜索/跳表入口需遵循所选显示策略，不能只凭库标签隐藏推断所有程序入口均过滤。 |
| 只读与复制 | 实际点击网格后焦点为可聚焦的 region，方向键可将 B4 选区移到 B5。返回 B4 后输入字符、Delete 与粘贴均未改变原值，未出现单元格编辑输入框；现成复制 API 得到 `CELL_4_2`。剪贴板在探针内替身截获，未写入系统剪贴板。 |
| 释放 | 无页面/控制台异常、无外部请求；销毁后 DOM 清空，1 个 worker 创建并终止。此前仅尝试 Canvas.focus 时焦点留在按钮，该次键盘检查不作通过证据，以上结果来自真实网格点击后的重验。 |

**结论：日常冻结、滚动、隐藏与只读交互没有阻止采用现成查看器。** 主程序接入仍需显式设置隐藏表策略，并验证自有导航入口、主题、筛选、复杂文件和大表响应；XLSX 源码接入已另做协议与组件验证，尚不代表完整 One 界面及全部 Excel 交互通过。

复现材料：`work/current/office-preview/research/unified/run-xlsx-interactions.cjs`、`xlsx-interaction-probe.js`、`interactions.xlsx`、`probe-xlsx-interactions.json`、`xlsx-freeze.png`。研究进程已退出，主程序依赖与 dev 未变更。

## 统一候选的 DOCX 隔离核验

使用同一发布包的 `DocxDocument` 与 `DocxScrollViewer.fromDocument`，只解析一次，再由现成滚动查看器挂载页面。维持原有安全策略，禁用在线字体与外链点击；Chrome 154 中无页面异常、无外部请求。主模式实际加载的静态资源去重约 4.10 MB，worker 模式约 5.84 MB；这是探针请求的资源图，不是整个安装包体积。

| 检查项 | 实测结果 |
| --- | --- |
| 自动分页与完整性 | 120 段、没有手动分页符的旧复现样本自动分为 2 页。派生样本显式设置 12 pt 后分为 3 页；各模式均从页面文字运行结果收集到 1–120 全部标记，各出现一次。页数来自实际排版，不能用它推断与 Word 分页完全一致。 |
| 书签与目录 | 派生样本第 1/60/120 段的书签分别映射到实际第 1/2/3 页。另一个 4 节样本可提取 Heading1 并跳至最后一节，画面确认中文、emoji 和正文可见。搜索有重复标题时会返回多个匹配，产品目录应使用书签或源段落映射。 |
| 主模式 | 三个样本完整排版约 315–395 ms，出现 189–256 ms 主线程长任务；最后段落/标题搜索约 1.8–2.6 ms，跳到目标页并等待两次动画帧约 11–19 ms，内部滚动位置与可见页索引一致。 |
| worker 模式 | 12 pt 派生样本完整排版约 439 ms，收集全部页面文字后约 482 ms；本轮没有 ≥50 ms 主线程长任务。最后段落搜索约 5.8 ms，目标页跳转检查点约 4.9 ms，主模式与 worker 目标页截图 825,000 像素零差异。不能将这次小样本扩大为全部文档响应承诺。 |
| 模型边界 | worker 模式访问 `document` 会按设计抛错，原始模型留在后台。`collectPageRuns`、`getBookmarkPage` 与文本搜索仍可用；探针对派生样本使用已知的书签名，尚未实现产品目录自动提取链。 |
| 错误与释放 | 非 ZIP 被拒绝，但错误是通用 `RangeError: Error page size must be positive`，需要产品统一提示。主/worker 轮次分别创建并终止 4/2 个 worker，销毁后 DOM 清空。加载中关闭与连续换文件还需集成验收，不能以加载后销毁代替。 |

**决策：DOCX 与 XLSX 可以优先评估共用该库；DOCX 的 worker 路径值得采用。** 这次证据解决了“库是否支持自动分页和直接目录定位”，没有解决复杂 Word 排版保真。表格跨页、页眉页脚、图片浮动、脚注、公式、中文字体替代及真实文件仍需验证；不再依靠 Windows UI Automation 搜索标题。上述时间不含应用/模块冷启动、峰值内存或真实用户点击，也未与原生方案做等条件性能对比。

复现文件：`work/current/office-preview/research/unified/docx-probe.js`、`run-docx-probe.cjs`、`probe-docx-results.json`、`probe-docx-worker-results.json`、`flow-bookmarks.docx`、`docx-navigation.png`、`docx-flow.png`、`docx-worker-flow.png`。两种 DOCX 模式截图差异统计另存 `docx-pixel-comparison.json`；样本均由项目自产，用户文档未参与。

## PPTX 隔离样本核验

新增实测 `@aiden0z/pptx-renderer@1.3.0`。官方仓库创建于 2026-02-12、最近推送为 2026-10-08；核对了源码、类型接口、Apache-2.0 许可与 `THIRD_PARTY_NOTICES.md`。发布包 SHA-512 校验通过，下载约 839 KB，独立浏览器入口约 1.83 MB（未压缩），包含图表所需代码。传递许可仍需在正式分发时完整保留。新仓库的持续更新不等于长期稳定性已经得到证明。

| 验证项 | 结果与边界 |
| --- | --- |
| 内容完整性 | 10 页自有导航文件、2 页组合/布局文件，以及加入组合文字、图片、表格和柱状图的自有文件均能打开。组合/嵌套文字与母版/布局装饰进入 DOM；日常样本的图片解码为 96×64，表格文字、图表标题和轴标签均可见。没有做完整 Office 像素对照。 |
| 图表就绪 | `open()` 返回时不保证 Canvas 图表已绘制。探针额外等待实际图表标题绘制，避免用 Promise 完成误报内容齐全。HTML/SVG DOM 与图表 Canvas 的存在也不能证明任意图表都保真。 |
| 目录跳转 | `goToSlide(index)` 可直接按页定位，无需 UI Automation。独立 Chrome 154 无界面测试中，150 页样本跳到第 150 页约 4.4 ms，目标文字出现且目标页位于可视区域。该数值为 API/布局测量，不是用户点击到屏幕呈现的端到端延迟。 |
| 首屏与列表 | 独立 Chrome 中，日常样本 `open()` 约 62 ms，等待图表后的资源就绪约 106 ms；150 页简单样本约 71 ms，起初只挂载 4 页，JS 堆采样约 12 MB，未观察到 ≥50 ms 主线程长任务。不含模块/应用冷启动，也不代表复杂 150 页文件。 |
| 列表首次空白 | 隐藏 Electron 初测中，滚动条出现导致宽度变化、重复布局，`open()` 返回时尚未挂载内容。研究页固定预留纵向滚动条空间后可挂载首屏与末页。列表仍受隐藏窗口约一秒一次的动画帧调度影响，故未把隐藏窗口 3.6 秒首屏/约 1 秒跳页当作库的前台性能结论。One 内还须验证自适应宽度和真实窗口缩放。 |
| 错误与恢复 | 损坏 ZIP、超过条目限制、开始前已取消三种输入均拒绝，随后可再次打开正常文件。未验证解析过程中的及时中止，不把开始前取消算作中途取消。 |
| 销毁与离线 | 本轮顺序打开/切页/销毁后 DOM 与 Canvas 清空，观察到的 Blob URL 全部回收，无页面异常、无外部请求；保持原脚本 CSP，无需放宽 `connect-src`。未据此推导所有资源或所有并发竞态都已验证。 |

**决策：PPTX 优先推进这个现成库的集成评估，旧 PPT 独立验证。** 与 XLSX 首个候选不同，该库已提供可用的内容渲染与导航接口；下一步重点是真实复杂文件、字体、缩略图/目录、异步图表就绪、窗口缩放、解析中取消和统一提示层。动画、任意 EMF/WMF、可执行 OLE、备注及完整数学排版不在已证明的能力内。继续保留失败后的默认应用打开入口，不能用静默漏内容掩盖不支持。

材料位于 `work/current/office-preview/research/pptx/`：校验后的包、`make-fixtures.cjs`、`run-probe.cjs`、`probe-first-pass.json`、`probe-results.json`、`probe-chrome-results.json` 和 `daily-render.png`。前述基础数据为自有样本，不涉及用户文档；测试进程已退出。Chrome 仅用于区分隐藏 Electron 调度干扰，两种运行环境的数据分别记录，不混成一次对比。

补充对照作者公开的 `docs/example/1-chart-and-complex/source.pptx` 及 `slides/Slide1.png`（各自 Git blob 校验通过）：两页可打开，第一页的 OpenTelemetry 组合示意图、中文说明和图片可见；对照页面显示字形、换行与留白有差异，不宣称像素一致。比较页容器与参考图的边距尚未完全归一化，不能把所有差异都归因于解析器；第二页只核验到跳页与文字，不算整页表格/图表保真通过。结果与来源保存在 `probe-oracle-results.json`、`oracle-provenance.json` 和 `oracle-comparison.png`，均为上游公开资料，不涉及用户文档。

## 目录与性能应如何验收

- **表格：** 库负责单元格显示、滚动、冻结和工作表切换；One 仅保留统一标题栏/侧栏，关闭编辑入口。先验证多工作表、合并、金额/百分比/1904 日期/前导零、缓存公式、图片、图表、大范围空白和真实 XLS。
- **Word：** Canvas 路线从实际排版读取书签/源段落到页码的映射，复用查看器直接跳页；HTML 路线定位已渲染标题节点，PDF 路线读取导出书签/命名目标。不能用重复标题搜索或 XML 静态分页标记假装精确目录定位。
- **PPT：** HTML 路线按幻灯片节点定位；PDF 路线按页定位。组合形状、母版/主题、裁剪图片、表格、中文和嵌入对象必须做内容完整性对照。
- **实际测量：** 同一设备、同一批自有样本，分别记录冷启动、热启动、第一屏、目录点击、滚动掉帧、主线程长任务、峰值内存、资源体积、失败恢复和连续切文件。先测再选，不用一个标题的约 90 ms 原生调用推导整个预览已经流畅。
- **建议通过条件：** 日常文件热打开第一屏目标 500 ms 内、目录响应目标 100 ms 左右，较大文件应能显示进度并取消；这是待测目标。保真必须同时通过，不能靠丢图片/图表换速度。旧格式与新版格式分别记录。
- **离线与隔离：** 只读本地文件；组件静态资源本地打包，禁用外链获取。保持统一 tooltip/toast、缩放、主题、侧栏与文件切换；每个候选均要验收。当前 DOCX、XLSX、PPTX 已接入网页预览；旧 DOC/XLS/PPT 仍须独立验证。

## 公开业务样本交叉核验

2026-10-11 从 [office2pdf 公开业务样本及清单](https://github.com/developer0hye/office2pdf/tree/main/tests/golden_mocks/business) 选取三份文件与对应 PDF。六份下载文件的 SHA-256 均与上游清单一致，在 One Windows 目录包中打开，原件保留在忽略目录 `work/current/office-business-probe/`。

| 样本 | 本轮观察 |
| --- | --- |
| `05_technical_manual_en.docx` | 预览生成 2 页画布，符合对照 PDF 页数；目录 6 项，第一页标题、代码底色及页脚位置与 PDF 接近。直接导出画布对照发现末段比 PDF 早换行，不能宣称逐像素一致。 |
| `01_startup_pitch_en.pptx` | 3 张幻灯片均可导航，目录 3 项；节点异常提示保持隐藏。 |
| `02_financial_model_en.xlsx` | 2 个工作表列入目录，切换到 `Projections` 后仍为就绪状态；本轮尚未逐项核对公式缓存与打印分页。 |

三份样本均无页面脚本错误或外网请求。它们是公开构造的业务场景文件，只补充交叉覆盖，不替代用户实际 Office 文档、字体和跨显示器验收。当前环境仅有一个活动显示器；库的 XLSX `load` 类型仍不提供进度回调或 AbortSignal，大表解析同步中止仍待方案。

## 一手资料与复现

- [vue-office 官方源码与引擎说明](https://github.com/501351981/vue-office)、[组件输入及 Excel 配置](https://501351981.github.io/vue-office/examples/docs/config/)、[纯 JavaScript 入口](https://501351981.github.io/vue-office/examples/docs/guide/js-preview.html)。
- [统一查看器源码、只读边界与 API](https://github.com/yukiyokotani/office-open-xml-viewer)、[统一查看器第三方声明](https://github.com/yukiyokotani/office-open-xml-viewer/blob/main/THIRD_PARTY_NOTICES.md)、[react-xlsx 上游与格式边界](https://github.com/extend-hq/react-xlsx)、[SheetXL 模块许可表](https://github.com/sheetxl/sheetxl)。
- [Univer 官方 OSS/Pro 能力表](https://github.com/dream-num/univer#-what-you-can-build)、[当前 Sheets 导入与转换后端要求](https://docs.univer.ai/guides/sheets/features/import-export)。
- [FortuneSheet 官方仓库](https://github.com/ruilisi/fortune-sheet)、[官方包目录](https://github.com/ruilisi/fortune-sheet/tree/master/packages)。
- [SheetJS CE 数据网格说明](https://docs.sheetjs.com/docs/demos/grid/)、[docx-preview 分页边界](https://github.com/VolodymyrBaydalka/docxjs#breaks)、[Mammoth 的语义 HTML 定位](https://github.com/mwilliamson/mammoth.js)。
- [PPTXjs 官方源码](https://github.com/meshesha/PPTXjs)、[Luckysheet 官方归档状态](https://github.com/dream-num/Luckysheet)。
- [aiden0z/pptx-renderer 官方源码与 API](https://github.com/aiden0z/pptx-renderer)、[第三方许可声明](https://github.com/aiden0z/pptx-renderer/blob/main/THIRD_PARTY_NOTICES.md)、[react-pptx 格式边界](https://github.com/extend-hq/react-pptx)、[office-kit/pptx](https://github.com/office-kit/pptx)、[office-kit/xlsx](https://github.com/office-kit/xlsx)。
- [ZetaOffice 状态与自托管](https://zetaoffice.net/)、[ZetaJS 接口与示例](https://github.com/allotropia/zetajs)、[示例跨源隔离要求](https://github.com/allotropia/zetajs/blob/main/examples/web-office/README.md)。
- [LibreOffice 支持的 Office 格式](https://help.libreoffice.org/latest/en-GB/text/shared/guide/ms_user.html?DbPAR=CALC&System=WIN)、[PDF 导出参数/书签](https://help.libreoffice.org/latest/en-US/text/shared/guide/pdf_params.html)、[LibreOffice 许可](https://www.libreoffice.org/licenses/)。
- [ONLYOFFICE 自托管接入](https://api.onlyoffice.com/docs/docs-api/get-started/installation/self-hosted)、[Community 许可说明](https://helpcenter.onlyoffice.com/docs/faq/docs-community.aspx)。
- [Apryse 支持格式](https://docs.apryse.com/web/guides/file-format-support)、[SpreadJS 支持格式](https://developer.mescius.com/spreadjs/docs/features/spreadjs-file-format)。

2026-10-10 查询 GitHub/npm：vue-office/excel 与 js-preview/excel 1.7.14（MIT）、vue-office/pptx 1.0.1（MIT）、FortuneSheet/react 1.0.4（MIT）、pptx-preview 1.0.7（ISC）、docx-preview 0.4.1（Apache-2.0）、aiden0z/pptx-renderer 1.3.0（主项目 Apache-2.0）、office-kit/pptx 0.24.0 与 office-kit/xlsx 0.24.1（MIT）、silurus/ooxml 0.88.0（主项目 MIT）。声明许可不等于全部上游源码及传递许可/兼容性已经核验。元数据与必要源码片段保存在 work/current/office-preview/research/；仅下载并隔离测试上述 js-preview/excel、aiden0z/pptx-renderer、silurus/ooxml 发布包，未下载完整 Office 引擎或用户文档。

当前事项见 [TODO](../development/TODO.md)，原格式问题见 [预览格式支持与体验调研](预览格式支持与体验调研.md)。
