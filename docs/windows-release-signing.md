# Windows 正式发布与安全软件误报

未签名的 Electron 安装包加上带全局输入统计能力的辅助程序，容易被 Windows 与安全软件判为低信誉或高风险。签名是面向公开分发的推荐措施，不是本项目打包或自用的前置条件。

## 一次性准备

1. 为发布主体申请可信 Windows 代码签名证书；面向公开分发时优先使用 EV 代码签名证书或云端签名服务。
2. 将证书安全地保存到 CI 密钥库或受控发布机，绝不提交 `.pfx` 与密码。
3. 在发布环境配置 `WIN_CSC_LINK`（PFX 路径或受控链接）和 `WIN_CSC_KEY_PASSWORD`。electron-builder 会自动签名主程序、NSIS 安装器和配置了 `signExts` 的 `pet-sensor.exe`；未配置签名凭据时仍可正常打包，但产物会是未签名状态。

## 构建前签名原生辅助程序

`pet-sensor.exe` 作为 extra resource 已由 electron-builder 的 `signExts` 纳入同一签名流程。仅在独立替换或单独分发该文件时，才需要手动使用 Windows SDK 的 `signtool.exe`：

```powershell
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /f C:\secure\publisher.pfx /p $env:WIN_CSC_KEY_PASSWORD native\sensor\target\release\pet-sensor.exe
npm run dist
```

构建完成后验证发布目录中的每一个 `.exe`：

```powershell
Get-ChildItem release -Recurse -Filter *.exe |
  ForEach-Object { Get-AuthenticodeSignature -FilePath $_.FullName } |
  Select-Object Path, Status, SignerCertificate
```

只有所有状态均为 `Valid`，且发布者名称一致时才发布 GitHub Release。

## 降低行为误报

- 应用现在只会在用户明确同意并开启本地感知后，才启动原生传感器；暂停或关闭感知会停止它。
- 保持首次引导、设置页和隐私说明与实际行为一致，明确说明只统计输入次数、不读取按键内容。
- 每次正式发布保持稳定的 `appId`、产品名、图标、下载域名和签名发布者；不要混用临时证书或频繁修改安装包标识。
- 发生误报时，携带带时间戳的签名安装包、SHA-256 与产品说明，通过 360 的官方误报申诉渠道提交复核；不要采用加壳、混淆或规避检测的方式。
