# 文档导航

源码使用 Git 管理。发布包、开发缓存、验证截图和测试样本都在仓库的忽略目录中，不作为源码提交。

| 位置 | 内容 |
| --- | --- |
| 根目录 `README.md` | 项目入口、最新发布包位置和功能概要 |
| `docs/user-guide` | 持续更新的使用说明 |
| `docs/development` | 需求、设计、开发与缓存规则、当前优化进度 |
| `docs/research` | 调研依据与实现参考 |
| `docs/history` | 各版本当时的验收结论，按版本保存 |

使用说明以当前源码为准，开发版新增能力会单独注明；可运行发布包版本与位置见 [项目入口](../README.md)。历史验收保留当时的环境和限制，不能代替当前说明。

## 使用说明

- [桌面工具与搜索](user-guide/桌面工具与搜索.md)
- [文本处理](user-guide/文本处理.md)
- [预览与外观](user-guide/预览与外观.md)
- [系统信息与磁盘告警](user-guide/系统信息与磁盘告警.md)

## 开发资料

- [开发、发布与缓存规则](development/开发与缓存.md)
- [安装器](development/安装器.md)
- [需求](development/需求.md)
- [技术栈](development/技术栈.md)
- [开发计划](development/开发计划.md)
- [设计规范](development/设计规范.md)
- [图标设计](development/图标设计.md)
- [持续优化进度](development/优化进度.md)
- [原生文件索引模块](development/原生文件索引.md)

## 调研与历史

- [空间分析调研](research/SpaceSniffer调研.md)
- [屏幕取色调研](research/取色实现调研.md)
- [文件索引内存与驻留](research/文件索引内存调研.md)
- [历史验收记录](history/README.md)

历史文档保留当时的测量和环境说明；旧发布包与大型测试数据已清理，复现测试时从当前源码重新生成。

## 文档维护

新文档放入对应分类并更新本导航；版本验收只更新历史索引。根目录仅保留 `README.md`，不另存带日期的说明副本。截图、日志和生成样本使用有上限的验证目录，规则见 [开发、发布与缓存](development/开发与缓存.md)。

运行 `npm run check:docs` 可检查文档分类、导航覆盖和仓库内链接，不生成额外缓存。当前说明更新后修正原文件，历史记录通过 Git 保存。
