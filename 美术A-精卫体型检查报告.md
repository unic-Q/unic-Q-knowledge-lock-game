# 美术A：精卫体型检查报告

更新日期：2026-07-12  
检查对象：`outputs/美术交接包-2026-07-12/03_运行时美术/game-ready/characters/jingwei`

## 1. 结论

精卫 `jump` 播放时看起来变小，主要不是单纯“美术画小了”，而是 **动画画布高度差异 + 程序缩放策略** 共同导致。

关键数据：

| 动作 | 帧尺寸 | 内容高度中位数 | 相对 idle 内容高度 | 相对 idle 帧高度 |
| --- | ---: | ---: | ---: | ---: |
| `idle` | `362x356` | `334.5px` | `1.000` | `1.000` |
| `jump` | `246x435` | `307.5px` | `0.919` | `1.222` |
| `pulse_run` | `272x283` | `255.0px` | `0.762` | `0.795` |
| `ability_spirit_split_loop` | `184x298` | `214.5px` | `0.641` | `0.837` |
| `hit` | `418x262` | `215.5px` | `0.644` | `0.736` |
| `death` | `209x276` | `249.5px` | `0.746` | `0.775` |

判断：

- `jump` 的内容本身比 `idle` 略小，约为 `idle` 的 91.9%。
- 但 `jump` 的帧画布高度比 `idle` 高很多，是 `idle` 的 122.2%。
- 如果程序按 `frame.h` 把不同动作塞进同一个显示高度，`jump` 会被强行缩到约 `356 / 435 = 81.8%`，所以肉眼会明显觉得角色变小。
- 正确做法是给同一形态使用固定 `displayScale`，不要按每套动作的 `frame_height` 动态缩放。

## 2. 程序侧必须改

精卫动画播放建议：

- 同一形态使用固定 `displayScale`。
- 不允许根据 `frame_width/frame_height` 自动归一化角色显示高度。
- 每帧用 `pivot: { x: 0.5, y: 1.0 }` 或逐帧 pivot 对齐脚底/角色基准点。
- 碰撞盒和视觉帧尺寸分离。
- `jump` 的上下位移应由程序物理位置控制，素材帧只表现姿态，不应靠缩放模拟跳跃。

最低接入规则：

```text
visualHeight is not frame_height
collisionBox is not frame_width/frame_height
displayScale is form-level, not animation-level
draw position is anchored by pivot
```

## 3. 美术侧建议

如果程序改成固定 `displayScale` 后，`jump` 仍比 `idle` 略小，可以再做美术微调：

- 将 `jump` 角色主体整体放大约 8-10%，但不要改变脚底/落点 pivot。
- 保留跳跃动作的 crouch / airborne / landing 姿态差异，不能强行让每帧轮廓完全等高。
- 不要通过增加透明画布来修体型，透明画布只会继续误导程序缩放。

不建议：

- 不建议把 `jump` 帧强行改成和 `idle` 一样的 `362x356`，除非程序和所有 JSON 同步重建。
- 不建议用 `frame.h` 推算角色高度。

## 4. 精卫各动作风险

### `jump`

问题：

- 帧画布高 `435px`，明显高于 `idle` 的 `356px`。
- 内容中位高 `307.5px`，略小于 `idle` 的 `334.5px`。
- 若按帧高缩放，必然显小。

处理优先级：P0。

责任：

- 程序先修 `displayScale`。
- 美术后验收是否仍需放大主体 8-10%。

### `ability_spirit_split_loop`

问题：

- 已清理大面积白底。
- 该动作是技能流程，不应和 `idle/jump` 直接比体型。
- 需要按 1-4、5-12、13-16 三段播放。

处理优先级：P0。

责任：

- 美术负责白底和脚间白底清理。
- 程序负责分段播放。

### `pulse_run`

问题：

- 内容高度中位数约为 `idle` 的 76.2%。
- 需要确认这是否来自奔跑姿态压低，还是素材体型本身偏小。

处理优先级：P1。

责任：

- 程序先固定 `displayScale` 后再判断。
- 若仍显小，美术再返修。

## 5. 本次脚本改进

已更新 `tools/clean_connected_white_png.py`：

- 保留原来的边缘连通白底清理。
- 保留细白线/灰白长条清理。
- 新增 `--bottom-enclosed-clean`，用于清理人物两脚之间、衣摆下方等不连通边缘的小块白底。

新增参数：

```text
--bottom-enclosed-clean
--bottom-white-threshold
--bottom-chroma-tolerance
--bottom-min-alpha
--bottom-band
--bottom-max-area
--bottom-max-width
--bottom-max-height
```

安全策略：

- 只处理帧底部区域。
- 只处理小面积、低饱和、近白色组件。
- 不处理连到帧边缘的大区域。
- 不处理超过面积/宽高限制的浅色衣服、魂魄高光和主体部分。

## 6. 本轮已处理文件

已处理：

```text
outputs/美术交接包-2026-07-12/03_运行时美术/game-ready/characters/jingwei/ability_spirit_split_loop/atlas.png
```

已备份：

```text
outputs/美术交接包-2026-07-12/03_运行时美术/game-ready/characters/jingwei/ability_spirit_split_loop/atlas.original-before-white-clean.png
```

处理结果：

- 大块白底已清理。
- 细白线/灰白底线已清理。
- 新增脚间封闭白底清理后，人物两脚之间的小白块清理更完整。
- `animation.json` 未改，帧尺寸仍是 `184x298 * 16`。
