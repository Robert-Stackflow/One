# CAB 分卷实现与验收

2026-10-10，开发版接通 CAB 关联分卷读取；原有单卷及其他只读格式入口保持适用。全部卷放在同目录，可从任一 `.cab` 打开、测试、完整或选择解压，整组卷参与版本检测。创建、修改 CAB 及分割 WIM 不在本次完成范围。

原实现拒绝 CAB 请求续卷。接通后发现 7-Zip 26.04 的 CAB 处理器可能在拒收后续卷或遇到自引用卷名时，返回成功及部分目录，且没有完整诊断。本次补丁把拒收的关联卷及边界仍声明前/后卷的卷组标记为头部错误；产品在展示目录及解压前检查该错误，拒绝把残缺卷组作为完整结果。保持现有同目录卷名限制及回调数量上限。补丁、固定原始源码和重建顺序见 `vendor/archive/7zip/SOURCE.json`、`one-cab-volumes.patch` 和 `MODIFICATIONS.txt`，第三方声明已同步。

`tests/archive-cab-volumes.cjs` 使用本机 Windows MakeCAB 独立生成 MSZIP、LZX、Store 三组四卷归档，包含开头小文件、跨卷的大文件及最后一卷才出现的文件。从 12 个卷入口分别浏览、测试、完整解压及只选末尾文件；通过 171 项检查、57 次 SHA-256 输出对照。独立解码使用 Windows Cabinet.dll 的 FDICopy，测试入口为 `tests/archive-cab-oracle.cpp`，不复用产品解码器。FDI 自动续读跨卷文件后，还需分别访问后续柜中的新文件；Windows `expand.exe` 在本机不支持这组跨卷文件，未作为通过依据。

异常矩阵共 30 组：每种方法的缺中卷/末卷/首卷、截断末卷头、错卷组、错序、危险续卷路径及自引用续卷。浏览、测试和解压均拒绝，目标已有文件保留；另有六组卷体损坏/截断，测试和解压均拒绝且保留目标。修改非首卷后旧选择被拒绝，恢复卷后重新测试通过；该流程也覆盖含中文及 emoji 的外部路径。未声称浏览阶段扫描全部内容 CRC；卷体损坏仍须完整性检查或解压检测。

桌面回归在八类已有格式基础上，新增从 CAB 第二卷打开、测试、仅解压末尾文件，以及删除第三卷后重新打开清空目录和禁用选择解压。只读编辑控件保持隐藏，未出现页面错误。服务检查和桌面检查均使用本次构建的原生程序与 DLL。当前安装版、第三方桌面拖出和其他 CAB 写入器仍待验收。

复现入口：`npm run test:archive-cab-volumes -- --windows-reader <编译后的 archive-cab-oracle.exe>`；未指定独立 Windows 读取器时使用外部 `7z`。原生程序可用 `--native` 指定隔离构建。桌面测试支持 `node tests/archive-formats-ui.cjs --cab-volumes <含 part1.cab 至 part4.cab 的两条目样本目录>`。详细测量摘要见[结构化记录](measurements/archive-cab-volumes.json)，当前任务见[TODO](../../development/TODO.md)。

格式依据来自 [7-Zip 固定 CAB 源码](https://github.com/ip7z/7zip/blob/9128b80e3a471108678e2b3ec3c985861c8d7b0f/CPP/7zip/Archive/Cab/CabHandler.cpp)；独立 Windows 读取接口按 [FDICopy 文档](https://learn.microsoft.com/en-us/windows/win32/api/fdi/nf-fdi-fdicopy)调用。
