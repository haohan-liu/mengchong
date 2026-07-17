# 正式封装前项目检查报告

检查日期：2026-07-17（Windows 10 x64，Asia/Shanghai）

## 1. 结论

源码、自动测试、生产构建、Electron 实机 smoke、最终 NSIS 封装和封装后 EXE smoke 均已通过。最终结论：**可以使用**。

当前未发现 P0。发现 7 个 P1 和 6 个 P2，均已修复；记录 1 个 P3（缺少 package author 元数据）。

## 2. 项目结构与技术栈

- Electron 43.1 + TypeScript 5.9 + Vite 7.3，renderer 使用原生 DOM、CSS、Canvas，无 React/Vue。
- 桌宠入口：`index.html` → `src/main.ts` → `src/renderer/App.ts`。
- 控制台入口：`console.html` → `src/console/main.ts`，八个正式页面。
- 聊天台入口：`chat.html` → `src/chat/main.ts`。
- 后台入口：`electron/main.ts`；preload 为 `electron/preload.cts`。
- 通信：renderer 只通过 context-isolated preload API 使用 Electron IPC；`nodeIntegration=false`、`sandbox=true`。
- 原生感知：Rust sidecar 优先，当前机器无 Rust，实际构建 Win32 C# 兼容 sidecar；stdout JSONL 通信。
- 设置：`%APPDATA%/<应用>/settings.json` 原子写入；API Key 为同目录 `deepseek.key`，使用 Electron safeStorage/Windows DPAPI。
- 用户数据：默认 `<userData>/data`，包含 `statistics.json`、`chat-index.json`、`chats/*.json`；迁移到用户选择目录下的 `QPetData`。
- 正式封装：electron-builder 26，Windows x64 NSIS，安装包名 `ai-desktop-pet-1.0.0.exe`。

开发环境通过 `PET_DEV_URL=http://127.0.0.1:1421` 加载 Vite；正式版只加载 app.asar 内的 `dist/*.html`，不依赖开发服务器。

## 3. 正确命令与实际结果

| 命令 | 结果 | 说明 |
|---|---|---|
| `npm install` | 未重装 | 已有依赖完整，`npm ls --all` 成功 |
| `npm run validate:prompts` | 通过 | 24 动作、24 prompt |
| `npm run validate:assets` | 通过 | 24 动作、280 张 RGBA PNG，15 loop / 9 once |
| `npm test` | 通过 | 最终 18 个文件、41 项测试 |
| `npm run typecheck` | 通过 | renderer 与 Electron 两套严格检查 |
| `npm run build` | 通过 | 首次因旧 `pet-sensor.exe` 被残留进程占用失败；释放后通过 |
| `npm run smoke` | 通过 | 常规桌面权限下验证三个 renderer、sidecar、IPC、托盘等 |
| `npm audit --registry=https://registry.npmjs.org` | 通过 | 0 vulnerabilities；配置的镜像不支持 audit API |
| `npx electron-builder` | 一次通过 | 生成 NSIS 和 win-unpacked；随后发现并移除重复资源 |
| 封装 EXE `--smoke-test` | 通过 | `release/win-unpacked/珊珊桌宠.exe` 退出码 0，无残留进程 |
| 最后一批源码后二次封装 | 通过 | 改用 `release-final` 新输出目录解除旧产物扫描占用 |

正确日常命令：开发 `npm run dev`；生产验证 `npm run build && npm run smoke`；未安装目录 `npm run pack`；NSIS `npm run dist`。

## 4. 功能检查清单

| 模块/功能 | 状态 | 验证 |
|---|---|---|
| 桌宠启动、Canvas 动画、24 动作 | 正常 | 资源校验、构建、smoke |
| 点击、三连击、拖拽、落地、滚轮缩放 | 正常 | 单测 + Electron smoke |
| 托盘显隐、恢复、控制台、聊天、退出 | 正常 | Electron smoke；退出后无残留进程 |
| 置顶、锁定位置、重置位置、节能模式 | 正常 | IPC/契约与 smoke |
| 控制台八页导航及保存反馈 | 正常 | 契约测试、smoke、代码调用链 |
| 设置原子保存、重启加载、损坏值恢复 | 已修复 | 新增损坏配置归一化测试 |
| 数据统计、90 天保留、CSV/JSON、清空 | 正常 | 统计单测与 IPC 审查 |
| 数据目录迁移、SHA-256 校验、保留旧目录 | 正常 | 迁移单测；选择目录需人工确认 |
| 聊天发送、本地回退、历史、话题、删除 | 正常 | AI 单测、聊天契约、smoke |
| DeepSeek 流式、30 秒超时、停止 | 正常（API 实网未测） | 取消链路审查；窗口销毁会 abort |
| Markdown/代码块与 HTML 安全 | 正常 | 先 escapeHtml 后有限格式化，无脚本执行 |
| 上下文黑名单、选区、剪贴板、脱敏 | 正常 | 隐私单测与调用链 |
| 主动陪伴冷却、每日上限、静默 | 正常 | 主进程逻辑与 smoke |
| 专注/休息/饮水提醒 | 已修复 | 原设置无人读取；新增单实例调度与测试 |
| Windows 自启动 | 正常（未改登录项实测） | settings save 调用 setLoginItemSettings |

没有发现仍可触发的无效按钮或 IPC 名称不一致。三个窗口使用同一个 SettingsStore/DataStore，并通过 `settings:changed`、`pet:activity`、`pet:runtime-changed` 同步。

## 5. 已修复问题

### P1-1 最小尺寸气泡越界

- 复现：smoke 将桌宠缩至 60%，气泡顶部为 -10.3px。
- 原因：气泡固定使用 71.7% bottom 偏移。
- 修改：`src/renderer/App.ts` 按实际 native window scale 计算偏移，并保留 100% 以上原位置。
- 验证：60%/150% smoke 均通过。

### P1-2 损坏设置可进入运行时

- 影响：错误数组、枚举、数字可能导致 `.some` 崩溃、布局异常或危险 URL。
- 修改：`electron/services/SettingsStore.ts` 对所有字段做类型、范围、枚举、时间和 URL scheme 归一化；新增 `tests/settings-recovery.spec.ts`。
- 状态：已修复。

### P1-3 聊天窗口关闭后请求继续

- 修改：`DeepSeekAgent` 监听发送方 WebContents `destroyed` 并 abort，请求完成后移除监听。
- 状态：已修复。

### P1-4 once 动画结束后主进程状态陈旧

- 修改：renderer 恢复 IDLE/idle_breath 时同步报告；主进程广播 runtime。
- 状态：已修复。

### P1-5 持久化失败会毒化后续写入队列

- 修改：SettingsStore/DataStore 写链允许下一次写入从前次失败恢复；后台统计写失败显式记录，避免未处理 Promise。
- 状态：已修复。

### P1-6 工具伪成功

- 原因：complete/snooze/focus 直接返回 `{ok:true}`，未改变任何状态。
- 修改：不再向模型声明未实现工具，执行层也明确返回失败；保留已实现的安全工具。
- 状态：已修复。

### P1-7 工作节奏设置未接业务

- 修改：新增 `ReminderScheduler`，按生产活动累计专注时间、休息冷却、饮水间隔；遵守静默、会议、全屏、锁屏和手动模式，并写入统计。
- 验证：新增 `tests/reminder-scheduler.spec.ts`，类型检查与 41 项测试通过。
- 状态：已修复并封装进最终 NSIS。

### P2

- 气泡字号设置此前硬编码为 15px：已接通。
- app.asar 同时打包 dist/public 两套 sprites：已去重，安装包曾由约 166.6 MB 降至 133.4 MB，asar 72.9 MB 降至 36.6 MB。
- AssetLoader 中途解码失败不释放已创建 ImageBitmap：已释放。
- 拖拽中窗口关闭可能遗留 16ms timer：已清理。
- 聊天 smoke 就绪断言格式错误且存在竞态：已修复渲染顺序和断言。
- smoke 失败信息缺少布局数据：已补充矩形、viewport、scale 诊断。

## 6. 自动触发与资源

传感器每秒单路发出 snapshot；原生进程最多按 1/2/4 秒重启三次后降级，fallback interval 只有一个。主动气泡有 pending 锁、冷却、每日上限和静默条件。专注/饮水调度器为主进程单实例，不注册窗口级重复监听。退出调用 `sensor.stop()`、清除 fallback、终止 sidecar并 flush 数据。smoke 后确认无桌宠/sidecar 残留。

smoke 验证性能 telemetry 非零、控制台关闭销毁 renderer、连续页面活动不会改变滚动位置。没有完成两小时长期运行、睡眠/唤醒循环和任务管理器基线，因此不能把长期内存/CPU 判为已实测正常。

## 7. 安全与封装复核

- npm 官方审计：0 漏洞。
- BrowserWindow：contextIsolation、sandbox 开启，nodeIntegration 关闭。
- API Key 只在主进程解密，不进入 renderer、聊天历史或日志。
- 模型工具无 shell、任意命令、任意文件写删、安装或注册表能力；URL 只允许 HTTP/HTTPS并按权限确认。
- asar 清单：无 `.env`、测试目录、日志；敏感模式扫描无命中。
- 最终安装包：`release-final/ai-desktop-pet-1.0.0.exe`，133,361,927 bytes。
- 最终 SHA-256：`4889E4B4E064544FB030FD4A37B7C93DEC9A8AE6552BFD2A25C07D39BCB60A79`。
- 最终 `release-final/win-unpacked/珊珊桌宠.exe --smoke-test` 退出码 0。
- package.json 缺少 author，仅属 P3 元数据问题。

## 8. 尚未自动验证/人工清单

1. 安装 NSIS 到含中文和空格的目录；启动、退出、再次启动、卸载，并确认不误删用户数据。
2. Windows 100/125/150/200% 缩放、多显示器负坐标、切换主屏和分辨率。
3. 睡眠/唤醒、锁屏/解锁、断网/恢复，观察是否只触发一次。
4. 使用测试 DeepSeek Key 验证 401、超时、流式、停止、工具确认；检查日志不含 Key。
5. 连续运行至少两小时，记录空闲/动画 CPU、工作集、句柄、进程数；重复开关控制台/聊天各 20 次。

## 9. 问题统计与建议

| 等级 | 发现 | 已修复 | 当前未关闭 |
|---|---:|---:|---:|
| P0 | 0 | 0 | 0 |
| P1 | 7 | 7 | 0 |
| P2 | 6 | 6 | 0 |
| P3 | 1 | 0 | 1 |

最终建议：**可以使用**。仍建议在目标机器完成安装/卸载、多屏高 DPI、真实 API 和两小时资源观察。

## 10. 修改文件

`package.json`；`electron/main.ts`；`electron/services/AgentTools.ts`、`DataStore.ts`、`DeepSeekAgent.ts`、`ReminderScheduler.ts`、`SettingsStore.ts`；`src/chat/main.ts`；`src/renderer/App.ts`、`animation/AssetLoader.ts`、`state/StateMachine.ts`；`src/shared/AgentToolPolicy.ts`；`tests/ai-flow.spec.ts`、`reminder-scheduler.spec.ts`、`settings-recovery.spec.ts`；本报告。
