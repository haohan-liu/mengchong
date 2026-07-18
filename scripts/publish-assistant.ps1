#requires -Version 5.1

<#
  珊珊桌宠：源码备份、构建与 GitHub Release 发布助手

  【以后更换仓库时，只需要修改下面“集中配置区”】
  - SourceRepoSlug：源码备份仓库，保存可继续开发的项目文件。
  - ReleaseRepoSlug：公开发布仓库，只发布安装包和自动更新文件。
  - DefaultBranch：两个仓库使用的默认分支。
  - ArtifactPrefix：必须与 package.json 的 build.artifactName 前缀一致。
  - ReleaseTitlePrefix：GitHub Release 页面展示的产品名。

  脚本不会上传 node_modules、构建目录、日志、临时文件、API Key 或证书。
  首次运行如果本地尚未初始化 Git，会自动初始化；若远程已有独立历史，会先备份远程分支，
  并要求输入明确的 REPLACE 才允许替换，防止误覆盖仓库。
#>

param([switch]$LauncherCheck)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
if ($LauncherCheck) { Write-Host "备份发布 BAT 已成功启动 PowerShell。" -ForegroundColor Green; exit 0 }

# ======================== 集中配置区（换仓库只改这里） ========================
$SourceRepoSlug = "haohan-liu/mengchong"
$ReleaseRepoSlug = "haohan-liu/mengchong-exe"
$DefaultBranch = "main"
$ArtifactPrefix = "ai-desktop-pet"
$ReleaseTitlePrefix = "珊珊桌宠"
$GitHubHost = "github.com"
$ElectronMirror = "https://npmmirror.com/mirrors/electron/"
$ElectronBuilderMirror = "https://npmmirror.com/mirrors/electron-builder-binaries/"
$RequiredSourceFiles = @(
  "一键备份与发布.bat",
  "一键安装开发环境.bat"
)
# ============================================================================

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$SourceRepoUrl = "https://$GitHubHost/$SourceRepoSlug.git"
$WorkDirectory = Join-Path $ProjectRoot ".publish"
$PendingReleasePath = Join-Path $WorkDirectory "pending-release.json"
$script:GhPath = $null
$script:GitHubReady = $false
$script:ReplaceRemoteMain = $false

# 发布助手启动的 npm/electron-builder 子进程统一使用国内二进制镜像。
$env:ELECTRON_MIRROR = $ElectronMirror
$env:ELECTRON_BUILDER_BINARIES_MIRROR = $ElectronBuilderMirror

function Write-Title([string]$Text) {
  Write-Host ""
  Write-Host "========== $Text ==========" -ForegroundColor Cyan
}

function Write-Info([string]$Text) { Write-Host "[说明] $Text" -ForegroundColor DarkCyan }
function Write-Ok([string]$Text) { Write-Host "[完成] $Text" -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host "[注意] $Text" -ForegroundColor Yellow }

function Invoke-Native([string]$FilePath, [string[]]$Arguments, [string]$FailureMessage) {
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$FailureMessage（退出码：$LASTEXITCODE）" }
}

# 某些探测命令（例如首次运行时检查 Git 仓库或 Release 是否存在）失败是正常分支，
# 不能让 Windows PowerShell 的 Stop 策略把它们误判成整个助手崩溃。
function Test-NativeProbe([scriptblock]$Operation) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $Operation *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

function Assert-Command([string]$Name, [string]$InstallHint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "没有找到 $Name。$InstallHint"
  }
}

function Resolve-GitHubCli {
  $command = Get-Command gh -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $knownPaths = @(
    (Join-Path $env:ProgramFiles "GitHub CLI\gh.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "GitHub CLI\gh.exe")
  ) | Where-Object { $_ -and (Test-Path $_) }
  if ($knownPaths.Count -gt 0) { return $knownPaths[0] }

  Write-Warn "没有检测到 GitHub CLI（gh）。它负责安全登录和创建 Release。"
  $install = Read-Host "是否现在使用 winget 自动安装 GitHub CLI？输入 Y 安装，其他键退出"
  if ($install -notmatch '^[Yy]$') {
    throw "请先安装 GitHub CLI，然后重新双击【一键备份与发布.bat】。"
  }
  Assert-Command "winget" "请从 Microsoft Store 安装【应用安装程序】，或手动安装 GitHub CLI。"
  Invoke-Native "winget" @("install", "--id", "GitHub.cli", "--exact", "--source", "winget", "--accept-package-agreements", "--accept-source-agreements") "GitHub CLI 安装失败"

  $installed = Join-Path $env:ProgramFiles "GitHub CLI\gh.exe"
  if (-not (Test-Path $installed)) { throw "安装结束后仍未找到 gh.exe，请重开此窗口后再试。" }
  return $installed
}

function Show-ProxyState {
  Write-Info "网络诊断只读取代理配置，不会自动修改你的 VPN 或系统代理。"
  $gitProxy = (& git config --global --get http.proxy 2>$null)
  if ($gitProxy) { Write-Warn "Git 全局代理已设置：$gitProxy" }
  if ($env:HTTPS_PROXY) { Write-Warn "HTTPS_PROXY 环境变量已设置。" }
  if ($env:HTTP_PROXY) { Write-Warn "HTTP_PROXY 环境变量已设置。" }
  if (-not $gitProxy -and -not $env:HTTPS_PROXY -and -not $env:HTTP_PROXY) {
    Write-Info "未发现 Git/环境变量代理；VPN 开关仍可能影响系统网络。"
  }
}

function Wait-ForGitHubNetwork {
  Write-Title "检查 GitHub 网络"
  Show-ProxyState
  while ($true) {
    $reachable = $false
    try {
      $reachable = Test-NetConnection $GitHubHost -Port 443 -InformationLevel Quiet -WarningAction SilentlyContinue
    } catch { $reachable = $false }
    if ($reachable) { Write-Ok "已连通 $GitHubHost`:443"; return }

    Write-Warn "当前无法连接 GitHub。可能是网络、VPN、代理或 DNS 导致。"
    $choice = Read-Host "请切换 VPN/网络后输入 R 重试；输入 Q 退出"
    if ($choice -match '^[Qq]$') { throw "用户取消：GitHub 网络尚未连通。" }
  }
}

function Ensure-GitHubLogin {
  Write-Title "检查 GitHub 登录"
  $loggedIn = Test-NativeProbe { & $script:GhPath auth status --hostname $GitHubHost }
  if (-not $loggedIn) {
    Write-Info "即将打开 GitHub 官方浏览器授权。这里只是登录，不会立即上传文件。"
    Invoke-Native $script:GhPath @("auth", "login", "--hostname", $GitHubHost, "--git-protocol", "https", "--web") "GitHub 登录失败"
  }
  Invoke-Native $script:GhPath @("auth", "setup-git", "--hostname", $GitHubHost) "Git 凭据配置失败"
  Invoke-Native $script:GhPath @("api", "rate_limit") "GitHub API 连通性检查失败"
  Write-Ok "GitHub 登录和 API 连接正常"
}

function Ensure-GitHubReady {
  if ($script:GitHubReady) { return }
  $script:GhPath = Resolve-GitHubCli
  Wait-ForGitHubNetwork
  Ensure-GitHubLogin
  $script:GitHubReady = $true
}

function Test-RemoteRepo([string]$RepoSlug) {
  return Test-NativeProbe { & $script:GhPath repo view $RepoSlug --json nameWithOwner }
}

function Ensure-RemoteRepo([string]$RepoSlug, [bool]$MustBePublic, [string]$Purpose) {
  if (Test-RemoteRepo $RepoSlug) { Write-Ok "$Purpose 仓库可访问：$RepoSlug"; return }

  Write-Warn "找不到或无权访问 $RepoSlug。请先确认顶部仓库地址是否正确。"
  $create = Read-Host "如果仓库尚不存在，是否现在创建？输入 CREATE；其他输入将停止"
  if ($create -cne "CREATE") { throw "$Purpose 仓库不可访问，已停止。" }

  $visibility = "--public"
  if (-not $MustBePublic) {
    $answer = Read-Host "源码仓库输入 1 创建私有仓库，输入 2 创建公开仓库"
    $visibility = if ($answer -eq "2") { "--public" } else { "--private" }
  }
  Invoke-Native $script:GhPath @("repo", "create", $RepoSlug, $visibility, "--description", $Purpose) "创建仓库失败"
  Write-Ok "已创建仓库：$RepoSlug"
}

function Ensure-GitRepository {
  Push-Location $ProjectRoot
  try {
    if (-not (Test-Path (Join-Path $ProjectRoot ".git\HEAD"))) {
      Write-Info "这是本机第一次上传，正在初始化 Git 仓库。"
      Invoke-Native "git" @("init", "-b", $DefaultBranch) "Git 初始化失败"
    } elseif (-not (Test-NativeProbe { git rev-parse --is-inside-work-tree })) {
      throw "本地 .git 目录不完整。请先备份项目并删除空的 .git 目录，或在 Cursor 中重新初始化 Git。"
    }
    Invoke-Native "git" @("branch", "-M", $DefaultBranch) "设置默认分支失败"

    $remotes = @(& git remote)
    if ($remotes -notcontains "origin") {
      Invoke-Native "git" @("remote", "add", "origin", $SourceRepoUrl) "添加源码仓库地址失败"
    } else {
      $origin = (& git remote get-url origin)
      if ($origin -eq $SourceRepoUrl) { return }
      Write-Warn "origin 原地址为：$origin"
      Write-Info "根据脚本顶部配置，将 origin 更新为：$SourceRepoUrl"
      Invoke-Native "git" @("remote", "set-url", "origin", $SourceRepoUrl) "更新源码仓库地址失败"
    }
  } finally { Pop-Location }
}

function Test-SourceFilesForSecrets {
  Write-Title "检查待上传文件"
  Push-Location $ProjectRoot
  try {
    # 强制 Git 返回原始 Unicode 文件名。否则带中文名称的文件会被转义成
    # "\345\215..." 形式，PowerShell 再检查真实路径时会误报“路径中具有非法字符”。
    $files = @(& git -c core.quotePath=false ls-files --cached --others --exclude-standard)
    $badNames = @($files | Where-Object { $_ -match '(^|/)(\.env($|\.)|[^/]+\.(pfx|p12|pem|key))$' })
    if ($badNames.Count -gt 0) {
      throw "发现不应上传的密钥/环境文件：$($badNames -join ', ')。请先移出项目或加入 .gitignore。"
    }

    $secretPattern = '(?:sk-[A-Za-z0-9]{24,}|gh[pousr]_[A-Za-z0-9]{30,})'
    foreach ($relativePath in $files) {
      $fullPath = Join-Path $ProjectRoot $relativePath
      if (-not (Test-Path $fullPath -PathType Leaf)) { continue }
      $item = Get-Item $fullPath
      if ($item.Length -gt 2MB -or $item.Extension -notmatch '^\.(ts|tsx|js|mjs|cjs|json|md|txt|yml|yaml|ps1|bat|toml|rs|html|css)$') { continue }
      if (Select-String -Path $fullPath -Pattern $secretPattern -Quiet -ErrorAction SilentlyContinue) {
        throw "文件 $relativePath 疑似包含 API Key 或 GitHub Token。为防止泄露，上传已停止。"
      }
    }
    Write-Ok "忽略规则和常见密钥检查通过"
  } finally { Pop-Location }
}

function Prepare-RemoteHistory {
  Push-Location $ProjectRoot
  try {
    $remoteHasMain = Test-NativeProbe { git ls-remote --exit-code origin "refs/heads/$DefaultBranch" }
    $localHasHead = Test-NativeProbe { git rev-parse --verify HEAD }
    if (-not $remoteHasMain -or $localHasHead) { return }

    Write-Warn "远程 $DefaultBranch 已有提交，但本地项目还没有 Git 历史（常见于 GitHub 勾选了 README）。"
    Invoke-Native "git" @("fetch", "origin", $DefaultBranch) "读取远程历史失败"
    $remoteFiles = @(& git ls-tree -r --name-only "origin/$DefaultBranch")
    Write-Host "远程已有文件：$($remoteFiles -join ', ')"
    Write-Info "若继续，脚本会先创建远程备份分支，再用本机完整项目替换 main。"
    $confirm = Read-Host "确认本机项目才是正确完整版本时，请输入 REPLACE"
    if ($confirm -cne "REPLACE") { throw "未确认替换远程 main，已安全停止。" }

    $backupBranch = "pre-import-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Invoke-Native "git" @("push", "origin", "refs/remotes/origin/$DefaultBranch`:refs/heads/$backupBranch") "创建远程安全备份分支失败"
    $script:ReplaceRemoteMain = $true
    Write-Ok "远程原内容已备份到分支：$backupBranch"
  } finally { Pop-Location }
}

function Push-SourceWithRetry {
  Push-Location $ProjectRoot
  try {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
      $arguments = @("push", "-u", "origin", $DefaultBranch)
      if ($script:ReplaceRemoteMain) { $arguments = @("push", "--force-with-lease", "-u", "origin", $DefaultBranch) }
      & git @arguments
      if ($LASTEXITCODE -eq 0) {
        $script:ReplaceRemoteMain = $false
        Write-Ok "源码已推送到 https://$GitHubHost/$SourceRepoSlug"
        return
      }
      if ($attempt -lt 3) {
        Write-Warn "第 $attempt 次推送失败。请检查上方错误，可切换 VPN 后重试。"
        Show-ProxyState
        [void](Read-Host "网络调整完成后按 Enter 重试")
      }
    }
    throw "源码连续 3 次推送失败。本地提交不会丢失，网络恢复后重新运行即可。"
  } finally { Pop-Location }
}

function Stage-SourceFiles {
  foreach ($requiredFile in $RequiredSourceFiles) {
    $requiredPath = Join-Path $ProjectRoot $requiredFile
    if (-not (Test-Path $requiredPath -PathType Leaf)) {
      throw "缺少必须随源码备份的启动文件：$requiredFile。请恢复该文件后重新运行。"
    }
  }

  # --all 会纳入所有源码变更；随后再次显式暂存两个启动器，确保它们的更新
  # 一定会随本次备份推送到源码仓库，从而替换远端的旧版本。
  Invoke-Native "git" @("add", "--all") "整理待上传文件失败"
  foreach ($requiredFile in $RequiredSourceFiles) {
    Invoke-Native "git" @("add", "--", $requiredFile) "暂存启动文件 $requiredFile 失败"
  }
  Write-Ok "两个一键启动文件已纳入本次源码备份"
}

function Backup-Source([string]$DefaultMessage = "") {
  Ensure-GitHubReady
  Ensure-RemoteRepo $SourceRepoSlug $false "源码备份"
  Ensure-GitRepository
  Test-SourceFilesForSecrets
  Prepare-RemoteHistory

  Push-Location $ProjectRoot
  try {
    Stage-SourceFiles
    $changes = @(& git status --short)
    if ($changes.Count -gt 0) {
      Write-Host ""
      Write-Host "以下是将保存到源码仓库的改动：" -ForegroundColor Cyan
      $changes | ForEach-Object { Write-Host "  $_" }
      Write-Info "【源码提交说明】只给开发者看，用来记录这次改了什么；它不是发布页更新说明。"
      $fallback = if ($DefaultMessage) { $DefaultMessage } else { "chore: 项目备份 $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }
      $message = Read-Host "请输入源码提交说明（直接回车使用：$fallback）"
      if ([string]::IsNullOrWhiteSpace($message)) { $message = $fallback }
      Invoke-Native "git" @("commit", "-m", $message) "创建源码提交失败"
    } else {
      Write-Info "没有新的源码改动，将确认远程是否已经同步。"
    }
  } finally { Pop-Location }
  Push-SourceWithRetry
}

function Get-PackageVersion {
  $package = Get-Content (Join-Path $ProjectRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
  return [string]$package.version
}

function Get-SuggestedPatchVersion([string]$CurrentVersion) {
  try {
    $version = [version]$CurrentVersion
    return "$($version.Major).$($version.Minor).$($version.Build + 1)"
  } catch { return $CurrentVersion }
}

function Invoke-ReleaseBuild {
  Write-Title "安装依赖并构建正式安装包"
  Push-Location $ProjectRoot
  try {
    Invoke-Native "npm" @("ci") "npm 依赖安装失败"
    Invoke-Native "npm" @("run", "dist") "测试或安装包构建失败"
  } finally { Pop-Location }
}

function Invoke-LocalValidation {
  Write-Title "只做本地完整测试"
  Push-Location $ProjectRoot
  try {
    Invoke-Native "npm" @("run", "build") "本地完整测试失败"
    Invoke-Native "npm" @("run", "smoke") "Electron 真实烟雾测试失败"
  } finally { Pop-Location }
  Write-Ok "本地测试通过；没有上传源码、没有生成 Release"
}

function Get-ProjectChangeState {
  Push-Location $ProjectRoot
  try {
    if (-not (Test-Path (Join-Path $ProjectRoot ".git\HEAD"))) { return "working-changes" }
    $status = @(& git status --porcelain=v2 --branch)
    if ($LASTEXITCODE -ne 0) { return "working-changes" }
    if (@($status | Where-Object { -not $_.StartsWith("# ") }).Count -gt 0) { return "working-changes" }
    $oid = $status | Where-Object { $_ -like "# branch.oid *" } | Select-Object -First 1
    if (-not $oid -or $oid -like "*(initial)*") { return "working-changes" }
    $upstream = $status | Where-Object { $_ -like "# branch.upstream *" } | Select-Object -First 1
    if (-not $upstream) { return "unpushed-commits" }
    $aheadBehind = $status | Where-Object { $_ -like "# branch.ab *" } | Select-Object -First 1
    if ($aheadBehind -match '\+(\d+)' -and [int]$Matches[1] -gt 0) { return "unpushed-commits" }
    return "clean-and-synced"
  } finally { Pop-Location }
}

function Assert-ReleaseAssets([string]$Version) {
  $releaseDirectory = Join-Path $ProjectRoot "release"
  $assets = @(
    (Join-Path $releaseDirectory "$ArtifactPrefix-$Version.exe"),
    (Join-Path $releaseDirectory "$ArtifactPrefix-$Version.exe.blockmap"),
    (Join-Path $releaseDirectory "latest.yml")
  )
  foreach ($asset in $assets) {
    if (-not (Test-Path $asset -PathType Leaf)) { throw "缺少自动更新文件：$asset，已停止发布。" }
    if ((Get-Item $asset).Length -eq 0) { throw "文件为空：$asset，已停止发布。" }
  }
  $latest = Get-Content $assets[2] -Raw -Encoding UTF8
  if ($latest -notmatch "(?m)^version:\s*$([regex]::Escape($Version))\s*$") {
    throw "latest.yml 中的版本不是 $Version，已停止发布。"
  }
  Write-Ok "安装包、blockmap 和 latest.yml 均已生成并通过校验"
  return $assets
}

function New-ReleaseNotes([string]$Version) {
  New-Item -ItemType Directory -Path $WorkDirectory -Force | Out-Null
  $notesPath = Join-Path $WorkDirectory "release-notes-v$Version.md"
  if (-not (Test-Path $notesPath)) {
    @"
## 本次更新

- 请在这里写用户能感受到的新功能或修复。
- 例如：修复检查更新时页面闪烁的问题。

## 安装与升级

- 新用户：下载 exe 后按安装向导完成安装。
- 已安装用户：直接运行新版 exe 覆盖安装，设置与本地数据会保留。

---

珊珊桌宠由开发者浩涵设计、开发并发布。  
© 2026 浩涵。保留所有权利。第三方开源组件遵循各自许可证。
"@ | Set-Content $notesPath -Encoding UTF8
  }
  Write-Info "下面打开的是【GitHub Release 更新说明】，普通用户会在发布页看到；它不是源码提交说明。"
  # Windows 11 的新版记事本会把多个文件放进同一个后台进程；即使当前
  # 文件窗口已关闭，-Wait 也可能继续等待，从而让发布助手看起来“卡住”。
  # 因此这里不等待 notepad.exe 的进程退出，而是由用户保存后回到本窗口确认。
  Start-Process notepad.exe -ArgumentList "`"$notesPath`""
  [void](Read-Host "编辑并保存说明后，切回此窗口按回车继续（无需关闭其他记事本窗口）")
  if ([string]::IsNullOrWhiteSpace((Get-Content $notesPath -Raw -Encoding UTF8))) {
    throw "发布说明为空，已停止发布。"
  }
  return $notesPath
}

function Assert-RemoteReleaseAssets([object]$Release, [string[]]$Assets) {
  $remoteAssetNames = @($Release.assets | ForEach-Object { $_.name })
  foreach ($asset in $Assets) {
    if ($remoteAssetNames -notcontains (Split-Path $asset -Leaf)) {
      throw "Release 已创建，但远端缺少 $(Split-Path $asset -Leaf)，请不要通知用户更新并检查发布页。"
    }
  }
}

function Complete-ReleaseUpload([string]$Version, [string[]]$Assets, [string]$NotesPath) {
  $tag = "v$Version"
  Write-Title "发布到 GitHub Releases"
  Write-Info "目标：https://$GitHubHost/$ReleaseRepoSlug/releases/tag/$tag"

  $releaseExists = Test-NativeProbe { & $script:GhPath release view $tag --repo $ReleaseRepoSlug }
  if (-not $releaseExists) {
    $arguments = @("release", "create", $tag) + $Assets + @(
      "--repo", $ReleaseRepoSlug,
      "--target", $DefaultBranch,
      "--title", "$ReleaseTitlePrefix v$Version",
      "--notes-file", $NotesPath,
      "--latest"
    )
    Invoke-Native $script:GhPath $arguments "创建 GitHub Release 或上传文件失败"
  } else {
    Write-Warn "$tag 已经存在，将只做远端完整性校验，不覆盖已有资产。"
  }

  $jsonText = (& $script:GhPath release view $tag --repo $ReleaseRepoSlug --json url,assets)
  if ($LASTEXITCODE -ne 0) { throw "Release 已提交，但发布后校验失败，请到网页确认。" }
  $release = $jsonText | ConvertFrom-Json
  Assert-RemoteReleaseAssets $release $Assets
  if (Test-Path $PendingReleasePath) { Remove-Item -LiteralPath $PendingReleasePath -Force }
  Write-Ok "发布完成且 3 个更新文件均已在远端确认"
  Write-Host "发布地址：$($release.url)" -ForegroundColor Green
  $open = Read-Host "是否现在打开发布页？输入 Y 打开"
  if ($open -match '^[Yy]$') { & $script:GhPath release view $tag --repo $ReleaseRepoSlug --web }
}

function Resume-PendingRelease {
  Write-Title "发现上次未完成的 Release"
  $pending = Get-Content $PendingReleasePath -Raw -Encoding UTF8 | ConvertFrom-Json
  $version = [string]$pending.version
  $notesPath = [string]$pending.notesPath
  if ($version -notmatch '^\d+\.\d+\.\d+([+-][0-9A-Za-z.-]+)?$') { throw "待发布记录中的版本号无效。" }
  $resolvedNotes = [IO.Path]::GetFullPath($notesPath)
  $resolvedWork = [IO.Path]::GetFullPath($WorkDirectory + [IO.Path]::DirectorySeparatorChar)
  if (-not $resolvedNotes.StartsWith($resolvedWork, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $resolvedNotes)) {
    throw "待发布说明文件不存在或不在 .publish 安全目录中。"
  }
  $assets = Assert-ReleaseAssets $version
  Write-Warn "待继续版本：v$version。不会重新改版本或重新打包。"
  $confirm = Read-Host "检查安装包和说明后，输入“发布”、“确定”或 PUBLISH 继续；其他输入退出"
  if ($confirm -cne "PUBLISH") {
    if ($confirm.Trim() -notin @("发布", "确定")) { Write-Info "已保留待发布状态，下次仍可继续。"; return }
  }
  Ensure-GitHubReady
  Ensure-RemoteRepo $ReleaseRepoSlug $true "公开安装包发布"
  Backup-Source "chore(release): prepare v$version"
  Complete-ReleaseUpload $version $assets $resolvedNotes
}

function Publish-Release {
  Ensure-GitHubReady
  Ensure-RemoteRepo $ReleaseRepoSlug $true "公开安装包发布"
  $currentVersion = Get-PackageVersion
  $suggestedVersion = Get-SuggestedPatchVersion $currentVersion

  Write-Title "选择发布版本"
  Write-Info "当前项目版本是 $currentVersion。首次发布可输入 $currentVersion；后续更新通常使用建议版本 $suggestedVersion。"
  $version = Read-Host "请输入要发布的版本号（直接回车使用 $suggestedVersion）"
  if ([string]::IsNullOrWhiteSpace($version)) { $version = $suggestedVersion }
  if ($version -notmatch '^\d+\.\d+\.\d+([+-][0-9A-Za-z.-]+)?$') { throw "版本号必须类似 1.0.1。" }

  $tag = "v$version"
  if (Test-NativeProbe { & $script:GhPath release view $tag --repo $ReleaseRepoSlug }) { throw "发布页已经存在 $tag。为避免覆盖用户正在使用的版本，请换一个更高版本号。" }

  if ($version -ne $currentVersion) {
    Push-Location $ProjectRoot
    try { Invoke-Native "npm" @("version", $version, "--no-git-tag-version") "更新 package.json 版本失败" }
    finally { Pop-Location }
  }

  Invoke-ReleaseBuild
  $assets = Assert-ReleaseAssets $version
  $notesPath = New-ReleaseNotes $version
  $confirm = Read-Host "确认版本、说明和目标仓库无误后，输入“发布”、“确定”或 PUBLISH"
  if ($confirm -cne "PUBLISH") {
    if ($confirm.Trim() -notin @("发布", "确定")) { throw "未确认发布。安装包仍保留在 release 文件夹，可稍后重试。" }
  }
  New-Item -ItemType Directory -Path $WorkDirectory -Force | Out-Null
  @{ version = $version; notesPath = $notesPath } | ConvertTo-Json | Set-Content $PendingReleasePath -Encoding UTF8
  # 只有完整测试与打包通过、且用户明确确认发布后才提交源码。
  Backup-Source "chore(release): prepare v$version"
  Complete-ReleaseUpload $version $assets $notesPath
}

function Show-Menu {
  Write-Host ""
  Write-Host "珊珊桌宠 · 一键备份与发布" -ForegroundColor Magenta
  Write-Host "1. 只在本机完整测试（不上传、不打包）"
  Write-Host "2. 只备份源码到 mengchong（不打包、不发布）"
  Write-Host "3. 完整测试 + 打包 + 备份源码（不发布 Release）"
  Write-Host "4. 完整测试 + 打包 + 备份源码 + 发布 Release"
  Write-Host "5. 只检查 GitHub 登录与网络"
  Write-Host "0. 退出"
  return Read-Host "请输入序号"
}

try {
  Set-Location $ProjectRoot
  Assert-Command "git" "请先安装 Git for Windows。"
  Assert-Command "node" "请先安装 Node.js LTS。"
  Assert-Command "npm" "npm 会随 Node.js 一起安装。"
  if (Test-Path $PendingReleasePath) {
    Resume-PendingRelease
    Write-Ok "待发布流程处理结束。"
    exit 0
  }
  $changeState = Get-ProjectChangeState
  if ($changeState -eq "clean-and-synced") {
    Write-Title "智能改动检查"
    Write-Ok "没有源码改动，本地提交也已同步到远程。"
    Write-Info "按约定，本次不会运行测试、打包或发布，避免生成没有意义的新版本。"
    exit 0
  }
  if ($changeState -eq "unpushed-commits") {
    Write-Title "发现上次尚未推送的提交"
    Write-Info "当前文件没有新改动，只需要补推源码；不会重新打包或发布。"
    $retryPush = Read-Host "输入 Y 重试推送；其他键退出"
    if ($retryPush -match '^[Yy]$') { Backup-Source }
    exit 0
  }

  Write-Title "智能改动检查"
  Write-Ok "检测到新的项目文件改动，可按需要选择测试、备份、打包或正式发布。"

  switch (Show-Menu) {
    "1" { Invoke-LocalValidation }
    "2" { Backup-Source }
    "3" {
      Invoke-ReleaseBuild
      [void](Assert-ReleaseAssets (Get-PackageVersion))
      Backup-Source "chore: validated local installer"
      Write-Ok "安装包只保留在本机 release 文件夹，没有创建公开 Release。"
    }
    "4" { Publish-Release }
    "5" { Ensure-GitHubReady }
    "0" { Write-Info "已退出，没有执行上传。" }
    default { throw "没有选择有效的功能序号。" }
  }
  Write-Host ""
  Write-Ok "本次操作结束。"
  exit 0
} catch {
  Write-Host ""
  Write-Host "[未完成] $($_.Exception.Message)" -ForegroundColor Red
  Write-Info "脚本不会删除本地源码；已经创建的本地 Git 提交也会保留。修复提示中的问题后可重新运行。"
  exit 1
}
