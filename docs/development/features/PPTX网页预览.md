# PPTX 网页预览

2026-10-11 开发中。PPTX 使用免费开源 `@aiden0z/pptx-renderer@1.3.0`，替换 One 的手工 OOXML 绘制，不依赖安装 Office。选型依据见 [Office 预览库选型](../../research/Office预览库选型.md)。旧二进制 PPT 仍须独立验证。

## 实现

- 沿用 50 MB 文件上限、归档预检和本地文件协议；库内再次限制条目数量与展开大小。禁用远程 PDF.js 后备资源，字体和资源从文件或本地依赖加载。外部链接受预览窗口策略限制。
- 独立 worker 按 presentation 关系顺序提取标题与备注，不修改原文件。目录、概览和上一张/下一张均直接定位目标页，不扫描已渲染文字。隐藏页面保留并标记。
- 连续页面按需挂载，解析形状和媒体也按需进行；首屏只预先绘制第 1 页，其余页交给可见范围观察器加载，避免打开时同步测量前 4 页的离屏文字。支持库覆盖的母版、组合文字、图片、表格与图表。正文使用库的 DOM/Canvas 渲染，页面纸张阴影已去掉，保留文档内容自带的形状效果。
- “备注”展开当前幻灯片的备注，随翻页更新，支持多行中文、选择和复制；空页显示“此页没有备注”。排除备注页里的幻灯片图片、页码、日期、页眉和页脚占位符。文字运行的粗体、斜体、下划线、字号、直接 RGB 与母版主题色会显示；按备注页关系读取母版 `p:notesStyle`、`p:clrMap` 与关联主题，合并母版级别、备注形状 `a:lstStyle`、段落 `a:pPr` 与文字运行的直接属性，近处属性覆盖默认值。颜色按 XML 顺序应用 tint、shade、lumMod、lumOff 和 alpha，覆盖主题色与直接 RGB；其余颜色变换仍待实现。字符项目符号和阿拉伯、英文字母、罗马数字的句点及括号编号会显示并进入复制文本，显式 `buNone` 会取消继承项目符号。逐个用文本节点构建，不执行备注内容。东亚数字等其他编号类型、图片和手写批注尚未还原；级别优先级参见 [Open XML 级别段落属性说明](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.level1paragraphproperties?view=openxml-3.0.1)，编号名称参见 [Open XML 编号类型](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.textautonumberschemevalues?view=openxml-3.0.1)，颜色计算依据 [亮度调制](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.luminancemodulation?view=openxml-3.0.1)与 [Tint](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.tint?view=openxml-3.0.1)。
- 加载可取消、重试或用默认程序打开；解析阶段使用 AbortSignal，目录准备可终止 worker。库主线程同步解析工作不能被事件同步打断，超时和取消在事件循环恢复后处理。页面或节点异常分别显示错误或部分内容提示。
- 缩略图先挂入概览，再完成图表等异步绘制；概览与当前页联动。概览缓存最多 40 张，淘汰、换文件和关闭均释放缩略图句柄；关闭同时销毁查看器、图表与媒体 Blob URL。

## 验证与边界

`npm run test:pptx-preview` 覆盖目录/备注提取规则与隔离完整 One 窗口。自有样本包括 10 页组合图文、图片、表格、柱状图及 150 页长演示文稿；检查直接导航、缩略图、备注、窗口缩放、提示层、错误恢复、准备中取消与换文件释放。证据位于 `work/current/office-preview/pptx-integration/results.json`。

2026-10-11 使用用户提供的约 16 MB、27 页答辩演示文稿做实际文件核验：逐页目录跳转、每页最多五段来源文本比对、图片加载与备注正文比对均通过，16 页非空备注正确显示；未报告节点或页面渲染错误。另一个 4 页流程图文件同样通过。预览前后源文件 SHA-256 一致，未发起外网请求；封面人工检查未发现明显布局异常。此检查不等于逐像素保真或全部内容验收。隔离生产构建的证据保存在 `work/current/office-preview/real-documents/results.json`，用户文件与截图不纳入版本库。

实际答辩文件的隐藏窗口自动化曾报告约 1008 ms 长任务；分阶段 CPU 采样与浏览器时间线没有稳定重现该停顿，不能据此认定实际打开或跳页会冻结 1 秒。时间线中首屏绘制帧约 86 ms，主要 CPU 样本落在库的 DOM 文字测量；减少预先挂载页数后，同一文件的一次隔离生产构建采样中最大绘制帧约 26 ms，未报告超过 50 ms 的主线程长任务。采样摘要分别保存在 `work/current/office-preview/real-documents/profile-before.json` 与 `profile-summary.json`。这不代表所有机器或文档的性能；前台交互延迟仍需单独验收，隐藏窗口帧调度和自动化等待不作性能承诺。

已有公开复杂文件对照表明字体、换行和留白可能与 PowerPoint 有差异。自有样本不能证明真实文件全部保真；复杂图表、SmartArt、嵌入对象、动画/切换、备注富文本和旧 PPT 仍未完成体验验收。隐藏测试窗口的自动化帧等待不代表前台跳页耗时。
