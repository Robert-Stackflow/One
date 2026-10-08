# Bandizip（Windows）功能与设置调研

> 调研日期：2026-10-08。对象：Bandizip Windows 版；官网当时标示最新版本为 v7.46（2026-08-21）。资料以 Bandisoft 官方[产品页](https://cn.bandisoft.com/bandizip/)、[帮助中心](https://cn.bandisoft.com/bandizip/help/)和[版本对比](https://cn.bandisoft.com/bandizip/help/edition-comparison/)为准。
>
> 范围说明：这是根据公开文档整理的**功能与可核实设置项地图**，不是安装后逐页抄录 F5 设置界面的完整控件清单。Bandizip 的“设置”既包括长期生效的偏好，也包括每次压缩、解压时选择的参数；下文分开列出。Windows 安装版、便携版、Microsoft Store 版，以及不同语言和授权版本的入口可能不同。

## 1. 产品定位与格式

Bandizip 是集压缩、解压、压缩包浏览和管理于一体的桌面工具。其设计重点是资源管理器右键入口、快速完成常见操作，以及对格式、速度和安全性的细粒度控制。[官方产品页](https://cn.bandisoft.com/bandizip/)

| 能力 | 官网明确列出的格式或范围 | 注意 |
| --- | --- | --- |
| 创建压缩包 | ZIP、7Z（LZMA2）、ZIPX（XZ）、自解压 EXE、TAR、TGZ、LZH、ISO、GZ、XZ | “能打开”和“能创建”不能混为一谈；RAR 不在创建格式中。 |
| 解压 | 40 多种，包括 ZIP/ZIPX、7Z、RAR/RAR5、TAR、ISO、WIM、ALZ/EGG、ZSTD、LZ4、ASAR 等 | 支持范围以官方实时列表为准。 |
| 大文件与分卷 | 大于 4 GB 的文件、分卷压缩与解压 | 便于传输或按介质容量拆分。 |
| 加密 | 创建带密码的压缩包，支持 AES-256；部分格式支持加密文件名 | 加密选项受目标格式约束。 |

来源：[支持格式与基本功能](https://cn.bandisoft.com/bandizip/)、[分卷压缩](https://cn.bandisoft.com/bandizip/help/how-to-split-a-large-file-into-smaller-files-with-bandizip/)、[设置密码](https://cn.bandisoft.com/bandizip/help/how-to-set-a-password-for-an-archive/)、[加密文件名](https://cn.bandisoft.com/bandizip/help/encrypt-file-names/)。

## 2. 功能清单

| 类别 | 功能与典型操作 | 边界或条件 | 官方资料 |
| --- | --- | --- | --- |
| 压缩入口 | 主窗口新建压缩包、拖入文件；右键直接压成 ZIP/7Z，或把所选文件分别压成独立 ZIP。 | 右键快捷操作与完整新建对话框适合不同场景。 | [压缩方法](https://cn.bandisoft.com/bandizip/help/how-to-zip/) |
| 解压入口 | 主窗口选择目标目录；右键“解压至此”“解压到同名文件夹”“智能解压至此”。 | 智能解压会检查包内顶层结构，避免多套一层或把杂项散落当前目录；名称冲突时自动编号。 | [解压方法](https://cn.bandisoft.com/bandizip/help/how-to-unzip/)、[智能解压](https://cn.bandisoft.com/bandizip/help/auto_dest/) |
| 压缩包浏览 | 先查看文件列表，再解压选中项；支持拖出指定文件、查看 ZIP/RAR 备注。 | 无须为查看某个文件先完整解压。 | [基本功能](https://cn.bandisoft.com/bandizip/) |
| 修改压缩包 | 在包内添加、删除、重命名文件及新建文件夹；也可打开包内文件，交给关联程序编辑后写回。 | 添加/删除等结构修改仅适用于**普通 ZIP**；编辑并写回包内文件仅支持 ZIP/ZIPX，过程中会临时解压该文件。 | [结构修改](https://cn.bandisoft.com/bandizip/help/how-to-modify-an-archive-without-decompression/)、[编辑并写回](https://www.bandisoft.com/bandizip/help/how-to-edit-and-save-file-in-archive-directly/) |
| 校验与防护 | 测试压缩包完整性；可将下载压缩包的 Zone.Identifier 传给解压后的特定类型文件；提供包内恶意软件扫描。 | 完整性检测受格式校验信息限制；恶意软件扫描的免费版能力有限。 | [完整性测试](https://en.bandisoft.com/bandizip/help/archive-test/)、[下载来源标记](https://cn.bandisoft.com/bandizip/help/zone-identifier/)、[版本对比](https://cn.bandisoft.com/bandizip/help/edition-comparison/) |
| 性能 | 多核压缩、高速压缩、快速拖放、并行解压。 | 并行解压有格式与存储介质等条件；快速拖放在 Microsoft Store 版受沙盒限制。 | [多核压缩](https://cn.bandisoft.com/bandizip/help/multicorecompress/)、[高速压缩](https://cn.bandisoft.com/bandizip/help/fastarchiving/)、[快速拖放](https://cn.bandisoft.com/bandizip/help/fastdnd/)、[并行解压](https://cn.bandisoft.com/bandizip/help/parallel-extraction/) |
| 兼容性 | 自动识别/手动处理旧 ZIP 文件名代码页，支持 UTF-8 文件名。 | 对乱码压缩包有用；自动识别不保证每次正确。 | [代码页问题](https://cn.bandisoft.com/bandizip/help/codepage-autodetect-problem/)、[ZIP UTF-8](https://cn.bandisoft.com/bandizip/help/utf8/) |
| 系统集成 | 文件关联、Windows 资源管理器右键菜单、拖放；可通过命令行完成压缩、解压、测试等批量任务。 | 右键菜单项可定制；安装渠道可能影响 Shell 集成。 | [右键菜单示例](https://cn.bandisoft.com/bandizip/help/how-to-zip/)、[命令行参数](https://en.bandisoft.com/bandizip/help/parameter/) |
| 付费增强 | 密码管理器、损坏 ZIP 修复、包内图片预览、密码恢复等。 | 具体归属见第 4 节；不应算作免费版常规能力。 | [版本对比](https://cn.bandisoft.com/bandizip/help/edition-comparison/) |

### “智能解压”规则值得单独记录

只有一个文件，或所有文件都在同一个顶层文件夹时，解压到当前目录；其他结构解压到以压缩包命名的新文件夹。若同名文件夹已存在，则创建带序号的新目录。[官方示例](https://cn.bandisoft.com/bandizip/help/auto_dest/)

## 3. 设置项地图

### 3.1 长期生效的设置或偏好

表中的入口只在官方文档明确写出时标具体路径；否则仅列设置类别，不猜测 F5 中的具体标签名。

| 分组 | 可核实的设置项 | 用途与注意 | 官方资料 |
| --- | --- | --- | --- |
| 资源管理器右键 | 显示压缩、解压、测试等右键动作；可启用“压缩为自定义文件名”。后者明确位于 `设置(F5) → 右键菜单`。 | 自定义命名支持原文件名、日期和时间变量，如 `${NAME}_%Y%m%d.zip`。右键“测试压缩包”也可单独启用。 | [自定义文件名](https://en.bandisoft.com/bandizip/help/custom-filename/)、[右键测试多个压缩包](https://en.bandisoft.com/bandizip/help/how-to-test-multiple-archives/) |
| 文件关联 | `设置(F5) → 文件关联` 中选择由 Bandizip 打开的压缩格式；可“全不选”“选择基本项”“立即应用”。 | Windows 默认应用设置也可能决定最终打开方式；图标异常有时是系统图标缓存问题。 | [官方 Windows 文件关联说明](https://cn.bandisoft.com/kb/how-to-change-file-association-windows/)、[图标排查](https://www.bandisoft.com/bandizip/help/refresh-shell-icons/) |
| 外观与浏览 | 主题颜色；文件夹树自动展开。 | 主题颜色文档给出的入口是主窗口“查看 → 颜色设置”，不应假定都在 F5 中。 | [主题颜色](https://cn.bandisoft.com/bandizip/help/change-theme-color/)、[自动展开树](https://cn.bandisoft.com/bandizip/help/expand-folder-tree-automatically/) |
| 文件名编码 | 自动识别代码页，以及识别失败时手动选择代码页。 | 对旧格式、跨语言压缩包尤为重要。 | [代码页处理](https://cn.bandisoft.com/bandizip/help/codepage-autodetect-problem/) |
| 删除行为 | 删除压缩包时“移至回收站”，或直接永久删除。 | 还影响“解压后删除压缩包”和修改现有压缩包时的原件处理。 | [回收站设置](https://cn.bandisoft.com/bandizip/help/move-files-to-recycle-bin/) |
| 下载来源与安全 | 将压缩包的 `Zone.Identifier` 传递给部分解压文件。 | 官方列出受支持扩展名；不能描述成对**所有**文件无条件传递。 | [Zone.Identifier](https://cn.bandisoft.com/bandizip/help/zone-identifier/) |
| 性能 | 快速拖放、并行解压等功能的启用与适用条件。 | 尤其需向用户说明并行解压的限制和快速拖放在商店版的限制。 | [快速拖放](https://cn.bandisoft.com/bandizip/help/fastdnd/)、[并行解压](https://cn.bandisoft.com/bandizip/help/parallel-extraction/) |
| 更新 | “自动更新”开关。 | 官方说明主要更新会提示；频繁的小更新不会逐次弹通知。 | [更新策略](https://cn.bandisoft.com/bandizip/help/update/) |
| 设置迁移 | `高级设置 → 导出 Bandizip 设置`，生成 `.reg`。 | 导入需关闭所有 Bandizip 窗口，再双击 REG 合并并重新运行程序；官方没有把它描述为“应用内选择备份文件导入”。 | [导出和导入设置](https://cn.bandisoft.com/bandizip/help/how-to-export-bandizip-settings/) |

### 3.2 每次压缩/解压时的操作选项

这些是功能对话框或命令行参数，不一定都是全局持久设置。

| 操作 | 可选择的参数或策略 | 官方资料 |
| --- | --- | --- |
| 新建压缩包 | 输出路径和文件名、目标格式、压缩级别/算法、密码与加密方式、分卷大小；特定格式还可加密文件名。 | [压缩流程](https://cn.bandisoft.com/bandizip/help/how-to-zip/)、[分卷](https://cn.bandisoft.com/bandizip/help/how-to-split-a-large-file-into-smaller-files-with-bandizip/)、[密码](https://cn.bandisoft.com/bandizip/help/how-to-set-a-password-for-an-archive/)、[文件名加密](https://cn.bandisoft.com/bandizip/help/encrypt-file-names/) |
| 解压 | 目标目录；当前目录、同名文件夹或智能解压；可只解压所选项；可在解压后删除原压缩包。 | [解压流程](https://cn.bandisoft.com/bandizip/help/how-to-unzip/)、[智能解压](https://cn.bandisoft.com/bandizip/help/auto_dest/)、[解压后删除与回收站](https://cn.bandisoft.com/bandizip/help/move-files-to-recycle-bin/) |
| 校验 | 对单个或多个压缩包执行测试，判断可否正确解压及校验和是否一致。 | [压缩包测试](https://en.bandisoft.com/bandizip/help/archive-test/)、[多个压缩包](https://en.bandisoft.com/bandizip/help/how-to-test-multiple-archives/) |
| 批处理/自动化 | 命令行指定压缩或解压、格式、压缩级别、密码、分卷、线程、代码页、目标路径、排除规则等。 | [命令行参数](https://en.bandisoft.com/bandizip/help/parameter/) |

## 4. 免费版与付费版边界

官方把 Windows 版分为标准版（免费）、专业版和企业版（付费）。[版本对比](https://cn.bandisoft.com/bandizip/help/edition-comparison/)

| 能力 | 标准版 | 专业版 | 企业版 |
| --- | --- | --- | --- |
| 基础压缩、解压、右键集成 | 支持 | 支持 | 支持 |
| 广告 | 有 | 无 | 无 |
| 密码管理器、修复压缩包、包内图片预览 | 无 | 有 | 有 |
| 密码恢复 | 仅可尝试最多 4 位密码，用于购买前测试 | 有 | 无 |
| 包内反恶意软件扫描 | 受限 | 完整 | 完整 |
| 官方表列线程上限 | 16 | 64 | 32 |
| 离线注册 | 不适用 | 无 | 有 |

注：官网提供部分专业功能的试用方式，但不能因此把它们当作标准版的完整功能；具体试用限制以[官方试用说明](https://www.bandisoft.com/bandizip/help/test-before-buy/)为准。企业版采用更保守的更新通知策略。[版本对比](https://cn.bandisoft.com/bandizip/help/edition-comparison/)

## 5. 对 One 的产品借鉴（分析，不是 Bandizip 功能事实）

1. **先做高频动作闭环**：压缩、解压、智能解压、测试、只提取所选文件；右键菜单里的名称和主窗口保持一致。
2. **把默认操作与高级参数分层**：常用 ZIP/7Z 一键完成；格式、加密、分卷、线程、编码等放到展开区。避免把长期偏好混进单次任务对话框。
3. **把安全与可恢复性放进流程**：删除原包前提供回收站或确认策略；修改压缩包时保留原件；下载来源标记与压缩包校验应明确说明适用范围。
4. **把格式能力写准确**：分开展示“可创建”“可打开”“可原位修改”，不要用一个“支持”字样覆盖三者。

## 6. 待实机核对的部分

- F5 设置窗口各标签页、复选框的**完整列表**、当前默认值、灰置条件和重启生效条件；公开帮助页不是设置界面的逐项说明。
- Windows 11 安装版与便携版、Microsoft Store 版的右键菜单、文件关联和拖放差异。
- 实际压缩/解压对话框中不同格式可见的高级参数，以及旧格式文件名代码页在真实样本中的表现。

核对时建议保留版本号与界面截图，避免把历史版本或其他平台的设置误记为当前 Windows 版功能。
