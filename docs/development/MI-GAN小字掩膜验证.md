# MI-GAN 小字掩膜验证

## 当前结论

同色和简单线性渐变优先使用本地颜色估计。当前 MI-GAN pipeline v2 对理想小字掩膜的纹理与线条重建仍有明显误差，原图翻译暂不自动启用它；复杂背景继续提供明确的可读底板与原图对照。后续接入须验证真实 OCR 笔画掩膜及真实截图，不以这次合成样本替代计划中的 30 张人工验收。

## 可复现条件

- 使用项目锁定的 `migan_pipeline_v2.onnx`，SHA-256 为 `6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b`，CPU 推理，复用现有 `image-repair-worker.cjs`。
- 512×320 像素，纯色、渐变、周期纹理及相交线条/色块四种背景，各包含 12/18/28px 的 `OCR 文本 2026`。
- 干净背景与叠字输入分别保存，按字体 alpha 得到理想笔画掩膜。分别比较推理掩膜扩张 1px 和 4px；评分及最终合成均只使用笔画扩张 1px 的范围，范围外保留输入像素。
- 首轮基准使用了共享 Buffer 切片，污染干净对照；该轮指标无效。已改为独立复制并增加对照图哈希不变检查，以下仅引用修正后的结果。

```powershell
node tests/translation-background-model-probe.cjs
node tests/translation-background-model-probe.cjs work/current/migan-probe/migan_pipeline_v2.onnx 4
```

报告分别位于 `work/current/translation-background-eval/report.json` 和 `work/current/translation-background-eval-d4/report.json`。图片与完整报告保留本地，不下载模型、不发送图文到服务。

## 修正后的结果

下表为笔画评分范围内 RGB 平均绝对误差（0–255），每组 3 张，越低越接近干净背景。

| 背景 | 推理扩张 1px | 推理扩张 4px |
| --- | ---: | ---: |
| 纯色 | 16.02 | 0.79 |
| 渐变 | 14.00 | 1.32 |
| 相交线条/色块 | 13.91 | 7.25 |
| 周期纹理 | 17.87 | 18.28 |

24 次推理的网络掩膜外像素变化均为 0。4px 推理、1px 合成的局部对照已检查：纯色/渐变残字明显减轻，纹理与相交线条仍出现破坏和不连续；不能据此承诺复杂背景无痕修复。

## 管线原因与后续条件

[官方 ONNX 说明](https://github.com/Picsart-AI-Research/MI-GAN#for-developers) 定义 `uint8` RGB 输入，掩膜 `255` 为已知区域、`0` 为修复区域，管线含裁剪、缩放和混合。[官方导出代码](https://github.com/Picsart-AI-Research/MI-GAN/blob/main/scripts/create_onnx_pipeline.py) 的后处理对已知区域掩膜做 3×3 max-pool，再用 5×5 高斯核混合；极细的孔洞因此仍会混入旧笔画。扩大推理范围、仅在精确笔画范围合成能减轻该问题，不能解决纹理/线条重建本身的误差。

后续条件：从实际 OCR 坐标获得可校正的笔画掩膜；把推理范围与合成范围分开；验证相邻文字/图表/线条、透明背景和长图分块；记录失败时切回原图/底板的行为。当前脚本仅用于本地评估，没有改变通用背景修复的行为。
