# Agent Note：整页图片拖放、上限投影预检与缩略图平铺

状态：implemented

[English](2026-08-12-web-image-intake-and-limits-alignment.md) | 中文

## 问题

issue #2248 的第二步对齐，接在[附件展示 note](2026-08-11-web-attachment-display-alignment.zh.md) 之后（其附件栏、toast 与原子组件包的决策继续有效；本 note 取代其中历史画廊几何与灯箱 backdrop 的具体规格）。与 DeepSeek Chat 相比剩下的差距：图片只能拖到 composer 卡片上——拖到聊天记录区会让浏览器直接导航到文件；灯箱关闭钮是裸 `×` 文本字符（button 不继承字体，且该字形的墨迹在行框中心之上，因此明显偏斜），backdrop 用 `color-mix(label-primary 74%)`，dark 下反转成刺眼的白色蒙层；一条消息的多张图各自以最大 240px 的块竖着堆叠，因为画廊容器本身被钉在 240px；客户端完全不执行也不展示图片限额——用户可以攒 50 张图，直到提交后收到原始的 `attachment-error (TOO_MANY_IMAGES)` toast，眼看附件栏清空又回滚。

## 决策

**整页拖放。** InputBar 在 document 上绑定 `dragenter`/`dragover`/`dragleave`/`drop`（enter/leave 深度计数、视口边缘与 `dragend` 复位、按 `Files` 类型门控使文本拖拽保留原生 textarea 路径），并渲染 `ui-attachment` 新增的 `DropOverlay` 原子组件：经 body portal、不接收指针事件的全视口层（DeepSeek Chat DragMask 的视觉——白色 70% 加 10px 模糊，dark 为 `rgba(39,39,48,0.7)`，插画、标题、上限行），`disabled` 变体宣告锁定或忙碌的 composer。指针惰性是承重的：拖拽事件继续命中下方页面，深度计数永远看不到遮罩自己。document 级监听状态是安全的，因为 composer-bar slot 为 `kind: 'single'`。

**工具栏选择器。** Command 启动器旁的附件按钮打开隐藏的原生多文件 input；其 `accept` 提示优先显示 PNG、JPEG、WebP 与 GIF，但输入路径仍会分类每个选中的文件。每次选择后都会清空 input 的值，因此再次选择同一文件仍会触发 `change`；随后与粘贴和整页拖放一样进入 `intakeAttachments` 路径。受支持的光栅图片进入图片路径，其他文件进入[不透明通用文件路径](2026-08-29-opaque-generic-file-attachments.zh.md)。Command 启动器保持独立；选择器不引入第二套菜单或上传协议。

**灯箱。** 关闭钮换成 `ui-primitives` 的 `IconCloseOutline16`（Modal 的先例——在 viewBox 内居中的 SVG 不依赖字体度量）。backdrop 用共享的对话框遮罩（`--dsw-alias-bg-mask-1` 加 `--dsw-mask-blur`，两个主题都是黑基色），画在独立的兄弟图层上，因为 `backdrop-filter` 画在容器上会把预览图自己也模糊掉。

**历史缩略图（DeepSeek Chat 规则）。** 一条消息仅有的一张图长边 240px、展示比例钳制在 [0.25, 4]，`cover` 裁切，特别高的图锚定顶部、特别宽的锚定左侧，从不放大；多张图渲染为固定 64px 方块，单个可换行的横排（10px 间距，用户消息右对齐）。assistant 连续的 `image` 块合并进同一个画廊，平铺而不是各占一行。

**上限对齐并投影。** 图片输入默认值是每条消息 20 张、每个源文件 20 MiB、图片源文件总量 200 MiB、每张图片 6400 万解码像素，以及源文件任一边 8192px。通用文件独立使用每条消息 20 个、每个 20 MiB、总计 200 MiB 的默认值。附件后端另行生成长边 2048px、独立安全上限 4 MiB 的图片主版本；不透明文件保留精确字节。模型请求使用各路由自己的模态、像素和编码字节预算，因此源文件准入不采用提供方请求限制。HTTP 载体使用 `DEFAULT_MAX_REQUEST_BODY_BYTES = 300 MiB`，满足 base64 与请求封装扩张后的加载时容量断言。两套策略通过每次启动恒定的 `imageLimits` 与条件式 `fileLimits` 会话投影到达客户端，由 **apiproxy** 而非 attachment Service Definition 注册；缺少 `fileLimits` 表示部署只支持图片。`dsh-llm` 依赖 `dsh-attachment`，而 `dsh-session-projection` 经 `dsh-session` 到达 `dsh-llm`，因此在 seam 包注册投影会形成 project-reference 环。附件存储仍对完整批次的数量、单项大小、总量、媒体类型与完整性检查负责。`SessionProjectionMap` 继续位于 proxy 的 sessions 协议文件中，客户端通过载体类型再导出使用它。

**加入预检与错误文案。** 文件选择、粘贴与拖放汇合到同一条 `intakeAttachments` 路径，分类受支持光栅图片与不透明文件、保留混合顺序，并在加入草稿前按各自投影检查每种模态的数量、单项字节和总字节。违反限制的模态批次会被整体拒绝，并立刻显示点名上限的横幅——不再有提交时回滚。Host 检查仍是绕过 composer 调用方的权威结果。用户可解决的原因使用点明出路的产品句子；base64 损坏、引用丢失与读取失败则折叠为一条保留原因码的发送失败句子。非附件错误继续显示原始消息与代码。

## 备选方案

**在 attachment Service Definition 构造函数里注册投影单元。** 天然的 seam 归属，也是第一版实现——被依赖图（上述环）和一个测试基建交互否决：基类构造函数调用 `ctx.inject` 使得 spec 中直接构造的 store 触发全局 invariant 宿主，后者往同一 root 重复挂载 `attachments` 服务。

**灯箱用 `--dsw-alias-bg-mask-photo`（0.88 黑、主题恒定、无人使用）。** 设计系统的照片查看器 token，也可能是 dsweb 灯箱实际的蒙层；用户选择与 settings 对话框遮罩一致（`bg-mask-1` 加模糊）——两者都能修复 dark 反转。

**在 `apply.ts` 的 `addImages` inject 里预检。** seam 纯度上的位置，因管线成本否决：投影仓没有暴露给 inject 工厂的非 React 面，而 InputBar 已经以惯用方式消费投影，且是两种手势的唯一调用方。

**用 `host.describe` 字段代替投影。** 与会话无关且更便宜，但要经注入 prop 链而非 `useProjection` 送达，而投影的键缺席语义（"未组合 attachment 服务 → 不预检"）是白拿的。

## 后果

工具栏选择器和窗口任意位置的拖放都会进入附件栏，超限输入在手势发生时就以点名上限的文案失败，历史图片像 DeepSeek Chat 一样平铺。300 MiB 的载体默认值仍是单请求驻留内存上界，因为桥会整体缓冲请求体。fixture 传输镜像默认投影；覆盖限制的部署会与 fixture 模式文案分叉，对 keyless 演示通道可接受。通用非图片文件卡在[通用文件决策](2026-08-29-opaque-generic-file-attachments.zh.md)下保持惰性且仅供下载。画廊箭头导航与灯箱缩放／下载仍然推迟（#2248）。
