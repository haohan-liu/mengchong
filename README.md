# 珊珊 AI 桌宠

面向 Windows 10/11 x64 的轻量桌宠。项目采用 Electron 43、Vite、TypeScript 与 HTML Canvas，不使用 Vue、React 或大型 UI/图表库。交付范围固定为 24 个动作、24 份动作 prompt 和 280 张正式透明序列帧。

> 新电脑先双击 `一键安装开发环境.bat`，以后改完双击 `一键备份与发布.bat`。第一次上传源码、第一次创建 Release 和完整迭代步骤请看 [《发布与迭代指南》](docs/发布与迭代指南.md)。

## 版权与成果归属

“珊珊桌宠”由开发者浩涵设计、开发并持续发布。项目程序、界面、角色表现、动画素材、文字内容、安装包及相关发布成果，在适用法律允许范围内的著作权及相关权益归浩涵所有。© 2026 浩涵，保留所有权利。完整声明见 [COPYRIGHT.md](COPYRIGHT.md)；第三方开源组件分别遵循各自许可证。

## 当前交付

- 透明、无边框、始终置顶的桌宠窗口；支持多屏工作区约束、拖拽、落地、点击、1.2 秒三连击、鼠标跟随/追逐/抓取。
- 15 个顶层状态、固定优先级、递增转换 token、once 自动回到 `idle_breath`。
- Canvas manifest 动画播放器；动作独立 FPS、loop/once、80ms 淡入、DPR 上限 2、32 帧 ImageBitmap LRU。
- 只通过托盘、桌宠右键菜单和桌宠设置按钮打开的正式控制台；没有调试快捷键。
- 默认名称为“珊珊”，可在控制台修改，并同步更新聊天、通知、托盘、窗口标题与智能体身份。
- 前台应用、窗口标题、键鼠数量、鼠标距离、空闲/锁屏、全屏、会议、电源和网络感知；键盘钩子从不读取或保存键值。
- DeepSeek 流式对话、取消/30 秒超时、月度上限、断网/无 Key 本地回复、DPAPI 密钥、临时上下文脱敏与最多三次工具调用。
- 版本化设置原子写入，最多 50 个聊天会话/每会话 200 条消息，90 天聚合统计和带校验的数据目录迁移。

## 安装与启动

需要 Node.js 22+ 与 npm。Rust stable x64 MSVC 工具链是正式 Rust sidecar 的可选依赖；未安装 Rust 时，构建脚本会使用 Windows 自带的 C# 编译器生成 12KB 左右的 Win32 兼容 sidecar，同样只统计输入次数且不读取键值。

```powershell
npm install
npm run dev
```

如果 Electron 安装阶段因网络中断而没有下载 `node_modules/electron/dist/electron.exe`，联网后重新运行：

```powershell
node node_modules/electron/install.js
```

开发启动会在 `127.0.0.1:1421` 启动 Vite，同时监听 Electron 主进程 TypeScript。生产构建：

```powershell
npm run build
npm run smoke
```

`npm run pack` 生成未安装目录，`npm run dist` 生成 NSIS 安装包。传感器选择顺序为 Rust sidecar → Win32 兼容 sidecar → Electron 基础降级层；开发启动也会自动完成该选择和编译。

## DeepSeek 配置

从托盘选择“打开桌宠控制台”，进入“DeepSeek 智能体”：

1. Base URL 默认锁定为 `https://api.deepseek.com`；只有点击旁边的编辑按钮后才能修改，保存后会重新锁定。
2. 选择 `deepseek-v4-flash` 或 `deepseek-v4-pro`。
3. 输入 API Key 并点击“安全保存”；Key 由 Electron `safeStorage` 使用 Windows DPAPI 加密，renderer 和数据目录都拿不到明文。
4. 点击“测试连接”，然后按需开启深度思考与自动上下文。

推理字段 `reasoning_content` 不显示、不保存。智能体不具备 Shell、任意命令、任意文件读写、删除、安装或注册表工具。打开链接、启动白名单应用和额外读取内容必须逐次确认。

## 感知与隐私

首次启动会在真实控制台上显示四步透明遮罩指引，依次说明基础操作、权限与隐私、DeepSeek API Key 和开始使用。用户明确选择后才会启用本地感知；也可选择“暂不开启感知”进入应用，之后再到控制台单独开启。在线智能对话使用 DeepSeek 接口，用户需要在“智能体 API”页面安全保存自己的 API Key 并测试连接；默认 API 地址只读，点击编辑按钮后才可修改，保存后会自动重新锁定。“关于与更新”可随时重新打开首次使用指引。

- 不保存按键内容；低级钩子只增加事件计数。
- 不录音；原生层只输出保守的占用/会议布尔信号。
- 不截图。
- 标题、剪贴板与选中文本各最多 2000 字，仅存在于一次主动 AI 请求的内存中，不进入聊天历史或统计。
- 密码管理器、凭据窗口、无痕浏览和自定义黑名单内容禁止读取。
- API Key、Bearer Token、密码字段、银行卡和身份证样式会在发送前脱敏。
- 原生/兼容进程失败时按 1/2/4 秒退避重启三次，然后降级到 Electron 空闲、锁屏、网络、鼠标距离和性能信息。

原生传感器与兼容源码位于 `native/sensor`，通过 stdout JSONL 与主进程通信。当前源码的麦克风信号使用已知会议进程的保守占用判断，不读取音频；用户主动请求 AI 时会用固定、无用户参数的 UI Automation helper 尝试读取焦点选区，失败时使用现有剪贴板，不模拟 `Ctrl+C`。

## 控制台

控制台关闭后窗口会销毁以释放 renderer 内存。界面固定分为左侧导航/实时性能区和右侧独立滚动内容区。九个页面包括：总览、外观与桌宠、状态与动作、感知与隐私、提醒与陪伴、DeepSeek 智能体、数据统计、数据与存储、关于与更新。状态页可预览全部 24 个动作，状态控制默认保持 30 秒；循环预览可“停止并恢复自动”。

左侧与总览会实时显示系统 CPU/内存、桌宠总 CPU/内存、Electron 进程数、传感器内存和事件循环延迟。“感知与隐私”页还会显示前台应用、最近 1 秒/10 秒输入计数及当前数据来源，用于确认本地感知是否实际工作。

外观设置只改变窗口大小、动效强度、气泡和控制台主题，不改变人物身份、服装或配色。

## 数据目录迁移

在“数据与存储”选择新目录。新用户首次安装由程序自动使用当前 Windows 账户的应用数据目录，不依赖开发电脑路径；曾经测试或迁移过的电脑会继续保留已选目录。页面只展示当前实际目录。迁移流程会暂停统计写入、复制数据、逐文件 SHA-256 校验、原子切换路径；验证失败时不修改当前设置并清理暂存目录。迁移成功后删除旧目录，只保留新的数据位置。API Key 永远留在默认 DPAPI 存储中。

## 自动更新与卸载

正式安装版通过公开仓库 `haohan-liu/mengchong-exe` 的 GitHub Releases 检查更新。独立的“关于与更新”页面提供手动检查、下载、重启安装和打开官方发布页入口；应用启动 15 秒后自动检查，之后每 6 小时检查一次。有新版本或下载完成时会显示 Windows 通知，点击通知会打开更新页。开发模式不会连接更新服务器；发布页尚无 Release 时会显示中文指引，不再直接暴露 GitHub 英文错误。

安装器使用固定 `appId` `com.qpet.ai`。从官方发布页手动下载更高版本安装包并运行时，NSIS 会识别现有安装并原位覆盖，保留设置、聊天、统计和自定义数据目录；后续版本不得修改 `appId` 或 `productName`，否则 Windows 可能把它识别为另一款应用。

新电脑可先双击 `一键安装开发环境.bat`：已安装且满足要求的 Git、Node.js、npm、GitHub CLI 和项目依赖会自动跳过，缺少的部分才安装；npm、Electron 与 electron-builder 使用项目级国内镜像。日常发布再双击 `一键备份与发布.bat`，助手会先检测源码改动，然后提供“只测试、只备份、打包但不发布、正式发布”四种闭环；没有改动且已经同步时会直接结束，不做无意义的打包。正式发布最后手动输入中文“发布”或“确定”。

卸载器会清理默认应用数据和更新缓存。对于迁移后的数据目录，只有目录中存在 `.qpet-data-root` 应用标记时才会删除；升级安装通过 `${isUpdated}` 跳过数据清理，保留设置、聊天和统计数据。

落盘数据只有版本化设置、聊天历史、统计聚合和提醒状态。统计 v2 只累加每秒新增输入事件，按本地日期保存并每 15 秒原子落盘；旧版滚动窗口导致的重复输入计数会在首次加载时自动修复。可查看今天/7/30/90 天，也可分别清空聊天、统计，或全部重置。

## 动画资产

动作源清单是根目录 `animations_manifest.json`，构建使用的镜像是 `src/data/animations.json`。正式序列位于：

```text
public/sprites/{action_id}/{action_id}_{frameIndex:03d}.png
```

全部帧为 512×512 RGBA，脚底基线为 y=451。人物身份以 `assets/generated/character-anchor.png` 为唯一锚点；动作首尾回到同一锚点，动作峰值统一可见高度、水平中心和脚底基线。总览检查图位于 `assets/generated/review/24-actions-contact-sheet.jpg`。

替换动作的方法：

1. 保持原始人物发型、金色圆眼镜、灰色 V 领针织背心、灰裙、白鞋和腕表不变。
2. 生成纯色绿幕源图，保存到 `assets/generated/actions`。
3. 使用 imagegen 技能的 `remove_chroma_key.py` 去背到 `assets/generated/actions-alpha`，绿色边缘先使用 `--edge-contract 1`。
4. 运行 `python scripts/process-sprites.py` 重新归一化和输出。
5. 运行两项严格校验；任何缺帧、多帧、额外目录、错误尺寸、无透明区或基线偏差都会失败。

```powershell
npm run validate:prompts
npm run validate:assets
```

项目没有占位动作、占位序列帧或 `build-placeholder-sprites`。

## 测试

```powershell
npm test
npm run typecheck
npm run build
npm run smoke
```

测试覆盖动作交付约束、状态优先级、once 恢复、三连击、拖拽阈值、隐私脱敏、AI 本地降级、工具确认策略、数据迁移、统计 v2 修复、传感器隐私边界和正式控制台页面契约。Electron smoke 会真实验证 sidecar 启动、拖拽 IPC、大小滑杆、动作预览、固定导航与两个 renderer。

## 目录摘要

```text
electron/              Electron 主进程、preload 与安全服务
native/sensor/         Rust 传感器与 Win32 兼容传感器
src/renderer/          桌宠窗口、状态机、动画播放器
src/console/           正式用户控制台
src/shared/            隐私、应用分类和智能体工具策略
public/sprites/        24 组、280 张正式 RGBA 帧
prompts/actions/       24 份动作 prompt
scripts/               构建、校验、smoke 和资产处理
tests/                 单元与契约测试
```

内存策略以单桌宠窗口为目标：按需创建控制台、32 帧解码 LRU、主动关闭淘汰 ImageBitmap、后台降帧、无大型 UI/图表框架。最终工作集仍应在目标机器上运行两分钟后用任务管理器复核；Electron 基础开销会随系统与 GPU 驱动变化。
