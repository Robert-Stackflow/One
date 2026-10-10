# Office 预览库选型：免费开源优先

2026-10-10。用户反馈 Windows 原生预览及目录跳转卡顿，要求先调研替代库；本轮只做官方文档、源码入口与发布元数据核验，不安装新引擎、不上传用户文件，不把宣传中的“高性能”视为实测结果。

## 选型结论

当前核验的候选里，没有可直接认定满足“免费开源、轻量离线、完整覆盖 DOC/DOCX、XLS/XLSX、PPT/PPTX、Office 保真”的单一 npm 库。应区分文件解析器、网页排版器、电子表格组件和完整 Office 引擎；能读取文件不等于能忠实展示。

建议先分格式验证，顺序仍是 XLSX → DOCX → PPT：

1. **XLSX：首先验证 `@vue-office/excel`。** 它提供现成展示组件及 ArrayBuffer/Blob 输入，接入量较小；使用库内渲染器，不再由 One 绘制表格。先检查样式、数字、图片、图表和大表响应，再决定是否采用。官方宣称支持 XLS，但底层采用 ExcelJS；真实旧二进制 XLS 必须单独验证，不能仅改后缀测试。
2. **DOC/DOCX、PPT/PPTX：并行比较轻量浏览器渲染与 LibreOffice 本地转换 + 现有 PDF.js。** 前者便于直接点击目录，但复杂版式有边界；后者可利用 PDF 书签/页码导航，需测转换冷启动和字体差异。这里的转换是后台处理，正文由 PDF.js 展示，不嵌入 Office 的 HWND，也不经 UI Automation 定位。
3. **ZetaOffice/ZetaJS 作为统一引擎备选。** 它在浏览器内提供 LibreOffice 能力，方向符合无需安装 Office，但整套引擎的冷启动、内存、资源体积和 Electron 离线集成尚未测量，不能预先承诺比原生快。

## 候选比较

| 候选 | 已核验能力与授权 | 对 One 的判断 |
| --- | --- | --- |
| `@vue-office/excel` | MIT；官方组件支持本地二进制输入；底层 ExcelJS + x-data-spreadsheet | XLSX 第一轮候选。属于现成表格展示，不是完整 Excel 排版引擎；图表、复杂图片、条件格式及真实 XLS 待测。支持非 Vue 接入，无需迁移整个应用框架。 |
| Univer | 核心 Apache-2.0；Sheets/Docs/Slides；官方将 Office 导入/导出归入 Pro，当前导入 API 明确需要转换后端 | 适合作为能力较全的长期选项，但不是免费核心包直接打开所有 Office 文件。不能为“免费开源”目标偷偷改为维护自有 OOXML 转换器。 |
| FortuneSheet | MIT；现成电子表格组件，支持格式、合并、冻结、图片等 | 可作 XLSX 备选。README 提到导入插件，但本轮只确认官方 packages 中 core/formula-parser/react，尚未确认可直接采用的完整导入包；图表/透视表保真不能按 README 泛称保证。 |
| SheetJS CE / ExcelJS | 读取、处理或生成表格数据的工具 | 不是 Office 展示引擎。把它们接到自绘 HTML 网格会回到原先问题；SheetJS CE 的数据 interchange 示例也不能视为完整样式、图片、图表预览。 |
| docx-preview | Apache-2.0；项目已经使用 0.4.1，生成 HTML | 可保留为轻量 DOCX 候选，但没有 Word 的实时自动分页。vue-office/docx 同样基于它，换包装不能消除已知分页边界。可继续核验字体和分页标记，但不承诺完整 Word 保真。 |
| Mammoth | DOCX 转语义 HTML，优先标题/结构而非原版式 | 适合阅读模式或提取目录，不适合作为本次高保真预览主引擎。 |
| PPTXjs | MIT；纯 JS 将 PPTX 转 HTML，包含形状、表格、图表等处理 | 可作对照候选；官方仓库最后推送为 2022-03-26，示例仍依赖旧 jQuery/JSZip 2。不能直接带入现有安全隔离，也不支持旧 PPT。需先验证复杂组合、母版与中文字体。 |
| vue-office/pptx / pptx-preview | 发布包声明许可与“可获得完整引擎源码”是两回事；vue-office README 明示其 PPTX 自研引擎源码需向作者付费索取 | 不把它列为已确认的完整开源引擎；需先澄清源码及维护范围。 |
| ZetaOffice + ZetaJS | LibreOffice 浏览器引擎与 UNO 接口；ZetaJS 包装层 MIT，LibreOffice 本体 MPL-2.0 及所含第三方许可 | 能统一处理文档/表格/幻灯片，是值得验证的整套引擎。官方服务仍标 open beta；可再分发本地构建的取得方式、自托管离线资源、跨源隔离、启动与内存待测。不能把包装层 MIT 扩大为整套引擎 MIT。 |
| LibreOffice 后台转换 + PDF.js | 免费开源；官方支持旧版/新版 MS Office 文件，并提供 PDF 导出与书签参数 | Word/PPT 的可行对照方案。转换后目录/切页由 PDF.js 接管；它仍需整套本地程序或引擎，不是轻量 npm 包。冷转换可能仍慢，需缓存和受控复用，分发体积待测。XLSX 转 PDF 会改变交互、缩放与分页，不作为主表格方案。 |
| ONLYOFFICE Docs Community | AGPL-3.0；需部署 DocumentServer，再嵌入网页 | 能统一 Office，但包含本地服务/转换链及整套编辑器，和轻量快速预览不匹配，暂不首选。不能按“前端组件”估算接入成本。 |

Luckysheet 官方仓库已在 2025-10-30 归档，不作为新增依赖。商业备选 Apryse WebViewer 提供客户端 Office 展示，SpreadJS 提供 Excel 展示/导入；按用户偏好仅保留备选，不采购、不接入。它们也需要样本验证，不代表付费就自动解决性能。

## 目录与性能应如何验收

- **表格：** 库负责单元格显示、滚动、冻结和工作表切换；One 仅保留统一标题栏/侧栏，关闭编辑入口。先验证多工作表、合并、金额/百分比/1904 日期/前导零、缓存公式、图片、图表、大范围空白和真实 XLS。
- **Word：** HTML 路线通过已渲染标题节点直接定位；PDF 路线读取导出的书签/命名目标。页码、缩略图和自动分页必须来自实际展示结果，不能以 XML 里的静态分页标记假装精确页码。
- **PPT：** HTML 路线按幻灯片节点定位；PDF 路线按页定位。组合形状、母版/主题、裁剪图片、表格、中文和嵌入对象必须做内容完整性对照。
- **实际测量：** 同一设备、同一批自有样本，分别记录冷启动、热启动、第一屏、目录点击、滚动掉帧、主线程长任务、峰值内存、资源体积、失败恢复和连续切文件。先测再选，不用一个标题的约 90 ms 原生调用推导整个预览已经流畅。
- **建议通过条件：** 日常文件热打开第一屏目标 500 ms 内、目录响应目标 100 ms 左右，较大文件应能显示进度并取消；这是待测目标。保真必须同时通过，不能靠丢图片/图表换速度。旧格式与新版格式分别记录。
- **离线与隔离：** 只读本地文件；组件静态资源本地打包，禁用外链获取。保持统一 tooltip/toast、缩放、主题、侧栏与文件切换；每个候选均要验收。未对新库做实际安装/性能测试，也尚未决定最终引擎。

## 一手资料与复现

- [vue-office 官方源码与引擎说明](https://github.com/501351981/vue-office)、[组件输入及 Excel 配置](https://501351981.github.io/vue-office/examples/docs/config/)。
- [Univer 官方 OSS/Pro 能力表](https://github.com/dream-num/univer#-what-you-can-build)、[当前 Sheets 导入与转换后端要求](https://docs.univer.ai/guides/sheets/features/import-export)。
- [FortuneSheet 官方仓库](https://github.com/ruilisi/fortune-sheet)、[官方包目录](https://github.com/ruilisi/fortune-sheet/tree/master/packages)。
- [SheetJS CE 数据网格说明](https://docs.sheetjs.com/docs/demos/grid/)、[docx-preview 分页边界](https://github.com/VolodymyrBaydalka/docxjs#breaks)、[Mammoth 的语义 HTML 定位](https://github.com/mwilliamson/mammoth.js)。
- [PPTXjs 官方源码](https://github.com/meshesha/PPTXjs)、[Luckysheet 官方归档状态](https://github.com/dream-num/Luckysheet)。
- [ZetaOffice 状态与自托管](https://zetaoffice.net/)、[ZetaJS 接口与示例](https://github.com/allotropia/zetajs)、[示例跨源隔离要求](https://github.com/allotropia/zetajs/blob/main/examples/web-office/README.md)。
- [LibreOffice 支持的 Office 格式](https://help.libreoffice.org/latest/en-GB/text/shared/guide/ms_user.html?DbPAR=CALC&System=WIN)、[PDF 导出参数/书签](https://help.libreoffice.org/latest/en-US/text/shared/guide/pdf_params.html)、[LibreOffice 许可](https://www.libreoffice.org/licenses/)。
- [ONLYOFFICE 自托管接入](https://api.onlyoffice.com/docs/docs-api/get-started/installation/self-hosted)、[Community 许可说明](https://helpcenter.onlyoffice.com/docs/faq/docs-community.aspx)。
- [Apryse 支持格式](https://docs.apryse.com/web/guides/file-format-support)、[SpreadJS 支持格式](https://developer.mescius.com/spreadjs/docs/features/spreadjs-file-format)。

2026-10-10 只读查询 GitHub/npm：vue-office/excel 1.7.14（MIT）、vue-office/pptx 1.0.1（MIT）、FortuneSheet/react 1.0.4（MIT）、pptx-preview 1.0.7（ISC）、docx-preview 0.4.1（Apache-2.0）。声明许可不等于全部上游源码/兼容性已经核验。元数据与必要源码片段保存在 work/current/office-preview/research/；不下载完整 SDK、引擎或用户文档。

当前事项见 [TODO](../development/TODO.md)，原格式问题见 [预览格式支持与体验调研](预览格式支持与体验调研.md)。
