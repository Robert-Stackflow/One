# Power Display 显示器管理调研

2026-10-10 查阅 Microsoft Learn 和 PowerToys 官方源码目录，并核对 One 现有亮度实现。本文保留调研依据；开发版已实现「操作增强 → 显示器管理」首阶段，后续任务统一见 [TODO](../development/TODO.md)。调研阶段未修改屏幕设置；首阶段验证仅读取真实设备清单与控制能力。

## 官方能力与限制

[Power Display 官方说明](https://learn.microsoft.com/en-us/windows/powertoys/power-display)提供以下能力；实际可用项取决于显示器及其接口：

| 范围 | 能力 |
| --- | --- |
| 逐屏控制 | 亮度、对比度、显示器音量、输入源、旋转、色温及电源状态 |
| 多屏操作 | 联动亮度、逐屏排除；托盘滚轮可选择主屏或全部屏幕，步长可调 |
| 配置方案 | 保存跨屏参数、手动应用、选择启动恢复；可与 Light Switch 的深浅色切换联动 |
| 诊断与脚本 | 显示器标识、能力与 VCP 映射；命令行查询、设值、增减和应用方案 |

外接屏主要依赖 DDC/CI；内置面板单独识别。滑块写入合并并换算硬件范围，休眠恢复后重新发现显示器。官方特别提示：能力探测在少数设备上可能触发系统故障；强兼容探测、输入源、色温和电源控制需显式启用，并处理黑屏、控制失联或设置残留。存在已知设备排除及异常后停用机制。[来源](https://learn.microsoft.com/en-us/windows/powertoys/power-display#before-you-enable-power-display)

官方 CLI 与正在运行的 Power Display 应用通信；不能把它当成独立、无需 PowerToys 的显示器库。[CLI 说明](https://learn.microsoft.com/en-us/windows/powertoys/power-display#command-line-interface)

## 源码与 One 现状

[PowerToys 源码目录](https://github.com/microsoft/PowerToys/tree/main/src/modules/powerdisplay)将功能分为应用、CLI、Lib、Models、Contracts、IPC 及配套单元测试。`PowerDisplay.Lib` 有 Drivers、Interfaces、Services 和 .NET 项目；`PowerDisplayModuleInterface` 使用 C++ 管理模块和进程。因此可参考其硬件抽象、发现与配置设计，不能把整个功能当成现成 C++ 库直接接入 Electron。

PowerToys 仓库采用 [MIT 许可](https://github.com/microsoft/PowerToys/blob/main/LICENSE)。复用具体源码时仍核对所选文件、依赖及其许可，并保留版权声明；本次没有下载或引入运行依赖。

One 的 [native/levels.cpp](../../native/levels.cpp) 已按光标所在屏幕调亮度，外接屏使用物理显示器接口及 VCP `0x10`，内置面板回退 WMI；已有句柄管理、读值缓存和硬件范围换算。[主进程适配](../../src/main/levels.ts)可以作为现有调用链的起点。该辅助程序的音量实现使用 Windows 音频端点，与显示器 DDC/CI 音量应区分。

现有亮度入口不能据此宣称完整 Power Display 功能已支持；还需要显示器列表、稳定身份、独立参数能力、配置方案和完整交互。现有实现遇到不能唯一定位的镜像物理屏会报错，扩展时保留明确反馈，避免控制错误设备。

## 接入建议

以下为 One 的实施建议，不是已验证的上游或 One 行为：

- 按用户最新要求，显示器管理位于「操作增强」的独立 tab，采用左列表/右参数布局；进入及刷新自动检测常用接口，后续扩展方案、联动和脚本。
- 用稳定设备身份关联设置；显示序号只用于展示，不能在热插拔或重排后把旧参数套给另一块屏幕。区分内置、外接、镜像及暂时离线设备。
- 原生辅助进程承担发现、查询和写入；按设备排队、合并滑块更新、限制并发及重试，设置超时，及时释放句柄。探测与写入不能阻塞窗口。
- 旋转走 Windows 显示配置接口单独评估；显示器音量、输入源、色温和电源按硬件能力启用。不能用遮罩冒充硬件亮度，也不能把系统音量当显示器音量。
- 高影响控制和强兼容探测默认关闭；启用时说明实际影响。准备设备排除、失败熔断与明确的恢复方法，异常后不在每次启动无限探测。
- 配置方案初步覆盖亮度、对比度、显示器音量和色温；输入源、电源与旋转是否纳入单独评估。默认不在启动或主题切换时自动套用，用户显式开启后才生效。
- 与主题自动切换共用触发入口；明确手动改值、联动亮度、方案应用和主题触发的先后规则。CLI 可复用 One 现有进程通信思路，固定目标与参数校验，返回逐屏结果。

## 开发版首阶段

入口遵循用户最新要求放在「操作增强 → 显示器管理」tab，左侧选屏、右侧参数；左栏 header 放刷新及读取状态，右栏 header 放检测状态。进入、刷新和设备拓扑变化后自动检测亮度、对比度和显示器音量，串行检测当前选择屏优先，其余在后台依次完成。

实现使用 [QueryDisplayConfig](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-querydisplayconfig) 获取活动目标、GDI 来源、内置/虚拟类型、分辨率、刷新率及旋转。优先采用经过 EDID 头、校验和及重复检查的厂商/产品/序列标识，否则退回连接路径与 EDID 摘要。ID 不依赖显示序号；镜像目标和重复序列不会被当作唯一物理屏。每次控制重新发现并核对路径与身份，拓扑变化和唤醒清空旧映射。弱连接标识仍需真实扩展坞和相同型号替换验收；本阶段不提供自动应用方案。

外接屏按 [GetMonitorBrightness](https://learn.microsoft.com/en-us/windows/win32/api/highlevelmonitorconfigurationapi/nf-highlevelmonitorconfigurationapi-getmonitorbrightness)、[GetMonitorContrast](https://learn.microsoft.com/en-us/windows/win32/api/highlevelmonitorconfigurationapi/nf-highlevelmonitorconfigurationapi-getmonitorcontrast) 及 VCP 0x10/0x12/0x62 的有效读值开放控制；内置屏亮度使用与原有边缘操作共用的 WMI 实现。百分比按实际硬件最小/最大值换算，写入后读回当前值；显示器音量不调用系统音频端点。原生辅助进程一次一项操作、8 秒超时、无自动重试，使用 RAII 释放物理句柄；主进程串行、有界队列和拖动合并，失败后暂停控制直到重新检测。离开 tab 取消未完成任务。

代码入口为 [原生辅助程序](../../native/display.cpp)、[主进程服务](../../src/main/display-management.ts)和[界面](../../src/renderer/display-management-view.ts)。原生/服务 72 项、Electron 桌面 25 项及共用 WMI 后的旧亮度服务回归通过；实际两屏仅作清单与控制接口读取，不测试改值。证据在 verification/display-management/latest.json；输入源、色温、电源、旋转写入、联动、方案及 CLI 继续在 TODO 中保留，完整硬件验收尚未完成。

## 验收条件

覆盖单屏/多屏、内置/外接、不同 DDC/CI 范围、不支持或错误能力、镜像、显示序号变化、热插拔、休眠唤醒、断线重连、扩展坞及远程桌面。验证逐屏设值和联动排除不会误操作其他屏幕；连续拖动、并发查询、取消与异常不会卡住界面或无限重试。

配置方案验证缺失设备、部分失败、重启恢复、手动调整及主题切换冲突；脚本验证稳定 ID、多目标、非法值、应用未运行及失败结果。输入源、色温、电源、强兼容探测须在适用真实硬件上验证恢复途径，模拟测试不能代替设备兼容结论。
