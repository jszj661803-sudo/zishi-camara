# AI 模特图生成与存储规范

## 目录结构

```
generated-models/
├── 孩童/
│   ├── 单人/
│   │   ├── 活泼/
│   │   │   ├── child_single_lively_001_model.png    # 模特实景图
│   │   │   ├── child_single_lively_001_outline.png  # 轮廓线稿图
│   │   │   └── ...
│   │   └── 甜美/
│   └── 亲子/
│       ├── 甜美/
│       └── 活泼/
├── 女性/
│   ├── 单人/
│   │   ├── 甜美/  (4个姿势)
│   │   ├── 活泼/  (2个姿势)
│   │   ├── 通勤/  (2个姿势)
│   │   ├── 轻熟/  (2个姿势)
│   │   ├── 优雅/  (2个姿势)
│   │   └── 痞帅/  (1个姿势)
│   └── 情侣/
│       ├── 甜美/  (1个姿势)
│       └── 活泼/  (1个姿势)
├── 男性/
│   └── 单人/
│       ├── 痞帅/  (2个姿势)
│       ├── 通勤/  (1个姿势)
│       └── 活泼/  (1个姿势)
└── 多人/
    ├── 闺蜜/
    │   ├── 甜美/  (2个姿势)
    │   └── 活泼/  (1个姿势)
    └── 朋友/
        └── 活泼/  (1个姿势)

共计：24 组 × 2张 = 48 张图
```

## 命名规则

`{人群}_{类型}_{风格}_{序号}_{类型}.png`

- 模特图：`female_single_sweet_001_model.png`
- 轮廓图：`female_single_sweet_001_outline.png`

## 图片规格

| 项目 | 要求 |
|------|------|
| 格式 | PNG（支持透明通道的轮廓图） |
| 比例 | 3:4 竖拍 |
| 分辨率 | 1080×1440 或 1440×1920 |
| 背景 | 模特图：干净统一背景；轮廓图：纯白背景+黑色线条 |
| 风格 | 所有图风格统一，看起来是同一套产品 |

## 生成方式

### 方案A：Midjourney（推荐）
1. 使用 `ai-prompt-library.json` 中的 `modelPrompt` 英文提示词
2. 加 `--ar 3:4 --style raw --v 6.1` 参数
3. 人物用 `--no face details, recognizable person` 避免生成真实人脸

### 方案B：Stable Diffusion（本地/API）
1. 使用 ComfyUI 或 Automatic1111
2. 加载写实模型（如 Realistic Vision 或 Juggernaut XL）
3. 控制姿势可用 ControlNet + OpenPose

### 方案C：DALL-E 3（API批量）
1. 使用 OpenAI API
2. 质量稳定但风格控制不如MJ

## 轮廓图生成

轮廓图用于 UI 中的取景框叠加层，要求：
1. 纯白背景（#FFFFFF）
2. 仅人体轮廓黑色线条
3. 无面部细节、无服装纹理
4. 人物位置和大小与模特图一致

生成方式：
- 先用 AI 生成模特图
- 再用背景移除工具（remove.bg API / SAM）提取人物
- 对人物做边缘检测（Canny）生成轮廓线
- 或用 ControlNet Canny/Lineart 直接从姿势生成
