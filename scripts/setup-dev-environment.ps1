#requires -Version 5.1

<#
  珊珊桌宠：Windows 一键开发环境安装器

  设计原则：
  1. 先检测，已经安装且版本满足要求就跳过，不重复安装。
  2. Node.js、Git 安装包和 npm/Electron 依赖优先使用国内 HTTPS 镜像。
  3. 下载的 Windows 安装包必须通过 Authenticode 签名检查才会请求 UAC 安装。
  4. GitHub CLI 没有项目可控的国内官方镜像，因此使用 Windows winget 安装。
  5. 仓库镜像地址、版本要求都集中在下面配置区，后续维护只改这里。
#>

param([switch]$LauncherCheck)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
if ($LauncherCheck) { Write-Host "环境安装 BAT 已成功启动 PowerShell。" -ForegroundColor Green; exit 0 }

# ======================== 集中配置区（维护环境只改这里） =====================
$MinimumNodeMajor = 22
$NodeMirror = "https://npmmirror.com/mirrors/node"
$NpmRegistry = "https://registry.npmmirror.com"
$ElectronMirror = "https://npmmirror.com/mirrors/electron/"
$ElectronBuilderMirror = "https://npmmirror.com/mirrors/electron-builder-binaries/"

# Git 国内镜像当前使用一个明确版本，便于校验和复现；以后升级只改下面两行。
$GitForWindowsVersion = "2.51.0.windows.1"
$GitInstallerName = "Git-2.51.0-64-bit.exe"
$GitMirrorBase = "https://registry.npmmirror.com/-/binary/git-for-windows"
# ============================================================================

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$TempRoot = Join-Path $env:TEMP "qpet-dev-environment"

function Write-Title([string]$Text) { Write-Host ""; Write-Host "========== $Text ==========" -ForegroundColor Cyan }
function Write-Info([string]$Text) { Write-Host "[说明] $Text" -ForegroundColor DarkCyan }
function Write-Ok([string]$Text) { Write-Host "[完成] $Text" -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host "[注意] $Text" -ForegroundColor Yellow }

function Refresh-ProcessPath {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Invoke-Native([string]$FilePath, [string[]]$Arguments, [string]$FailureMessage) {
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$FailureMessage（退出码：$LASTEXITCODE）" }
}

function Download-SignedInstaller([string]$Url, [string]$Destination) {
  Write-Info "正在从国内镜像下载：$Url"
  Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing
  if (-not (Test-Path $Destination) -or (Get-Item $Destination).Length -lt 1MB) {
    throw "下载文件异常或不完整：$Destination"
  }
  $signature = Get-AuthenticodeSignature $Destination
  if ($signature.Status -ne "Valid") {
    throw "安装包数字签名校验未通过（$($signature.Status)），为安全起见不会运行：$Destination"
  }
  Write-Ok "安装包签名有效：$($signature.SignerCertificate.Subject)"
}

function Install-WithUac([string]$FilePath, [string[]]$Arguments, [string]$Name) {
  Write-Info "即将出现 Windows UAC 确认，用于安装 $Name。"
  $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -Verb RunAs -Wait -PassThru
  if ($process.ExitCode -notin @(0, 3010)) { throw "$Name 安装失败（退出码：$($process.ExitCode)）。" }
  Refresh-ProcessPath
  Write-Ok "$Name 安装完成"
}

function Test-NodeVersion {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return $false }
  $versionText = (& node --version).TrimStart('v')
  try { return ([version]$versionText).Major -ge $MinimumNodeMajor } catch { return $false }
}

function Install-NodeFromMirror {
  Write-Title "安装 Node.js LTS"
  Write-Info "从国内 Node.js 镜像读取版本列表，选择不低于 $MinimumNodeMajor 的最新 LTS x64 MSI。"
  $index = Invoke-RestMethod -Uri "$NodeMirror/index.json" -UseBasicParsing
  $candidate = $index | Where-Object {
    $_.lts -and ([version]$_.version.TrimStart('v')).Major -ge $MinimumNodeMajor -and $_.files -contains "win-x64-msi"
  } | Sort-Object { [version]$_.version.TrimStart('v') } -Descending | Select-Object -First 1
  if (-not $candidate) { throw "国内镜像中没有找到符合要求的 Node.js LTS x64 MSI。" }

  $version = [string]$candidate.version
  $name = "node-$version-x64.msi"
  $destination = Join-Path $TempRoot $name
  Download-SignedInstaller "$NodeMirror/$version/$name" $destination
  Install-WithUac "msiexec.exe" @("/i", "`"$destination`"", "/passive", "/norestart") "Node.js $version"
}

function Ensure-Node {
  if (Test-NodeVersion) {
    Write-Ok "Node.js 已满足要求：$(& node --version)（最低要求：$MinimumNodeMajor）"
    return
  }
  if (Get-Command node -ErrorAction SilentlyContinue) { Write-Warn "现有 Node.js 版本低于要求，将升级。" }
  else { Write-Info "未检测到 Node.js。" }
  Install-NodeFromMirror
  if (-not (Test-NodeVersion)) { throw "Node.js 安装后仍未进入 PATH，请重启电脑后重新运行。" }
}

function Ensure-Git {
  if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Ok "Git 已安装：$(& git --version)"
    return
  }
  Write-Title "安装 Git for Windows"
  $destination = Join-Path $TempRoot $GitInstallerName
  $url = "$GitMirrorBase/v$GitForWindowsVersion/$GitInstallerName"
  Download-SignedInstaller $url $destination
  Install-WithUac $destination @("/VERYSILENT", "/NORESTART", "/SP-") "Git for Windows"
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git 安装后仍未进入 PATH，请重启电脑后重新运行。" }
}

function Ensure-GitHubCli {
  if (Get-Command gh -ErrorAction SilentlyContinue) {
    Write-Ok "GitHub CLI 已安装：$(& gh --version | Select-Object -First 1)"
    return
  }
  Write-Title "安装 GitHub CLI"
  Write-Info "GitHub CLI 用于源码上传和 Release 发布；使用 Windows winget 安装。"
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "未找到 winget。请从 Microsoft Store 安装【应用安装程序】，再重新运行。"
  }
  Invoke-Native "winget" @("install", "--id", "GitHub.cli", "--exact", "--source", "winget", "--accept-package-agreements", "--accept-source-agreements") "GitHub CLI 安装失败"
  Refresh-ProcessPath
  $knownGh = Join-Path $env:ProgramFiles "GitHub CLI\gh.exe"
  if ((-not (Get-Command gh -ErrorAction SilentlyContinue)) -and (Test-Path $knownGh)) {
    $env:Path = "$(Split-Path $knownGh);$env:Path"
  }
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "GitHub CLI 安装后仍未进入 PATH，请重开窗口。" }
  Write-Ok "GitHub CLI 安装完成"
}

function Write-ProjectNpmConfig {
  $npmrc = Join-Path $ProjectRoot ".npmrc"
  $content = @"
# 项目级 npm 国内镜像：只影响本项目，不修改其他项目的 npm 设置。
registry=$NpmRegistry
"@
  [IO.File]::WriteAllText($npmrc, $content.TrimStart(), [Text.UTF8Encoding]::new($false))
  Write-Ok "项目已使用国内 npm / Electron / electron-builder 镜像"
}

function Ensure-ProjectDependencies {
  Write-Title "检查项目依赖"
  Set-Location $ProjectRoot
  # 二进制镜像通过环境变量传给 Electron 工具，避免 npm 把专用键当成未知配置警告。
  $env:ELECTRON_MIRROR = $ElectronMirror
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = $ElectronBuilderMirror
  $valid = $false
  if (Test-Path (Join-Path $ProjectRoot "node_modules")) {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      & npm ls --depth=0 *> $null
      $valid = $LASTEXITCODE -eq 0
    } catch { $valid = $false }
    finally { $ErrorActionPreference = $previousPreference }
  }
  if ($valid) {
    Write-Ok "node_modules 与 package-lock.json 当前一致，无需重复安装"
    return
  }
  Write-Info "项目依赖缺失或版本不一致，使用国内镜像执行 npm ci。"
  Invoke-Native "npm" @("ci") "项目依赖安装失败"
  Write-Ok "项目依赖安装完成"
}

try {
  Write-Host "珊珊桌宠 · 一键安装开发环境" -ForegroundColor Magenta
  Write-Info "已安装且满足要求的工具会自动跳过，不会重复安装。"
  New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null
  Ensure-Node
  Ensure-Git
  Ensure-GitHubCli
  Write-ProjectNpmConfig
  Ensure-ProjectDependencies

  Write-Title "最终检查"
  Write-Host "Node：$(& node --version)"
  Write-Host "npm：$(& npm --version)"
  Write-Host "Git：$(& git --version)"
  Write-Host "GitHub CLI：$(& gh --version | Select-Object -First 1)"
  Write-Ok "开发、测试、备份和发布所需环境已经准备完成"
  Write-Info "下一步可以运行 npm run dev，或双击【一键备份与发布.bat】。"
  exit 0
} catch {
  Write-Host ""; Write-Host "[未完成] $($_.Exception.Message)" -ForegroundColor Red
  Write-Info "已安装成功的环境不会回滚；修复提示中的问题后重新运行，脚本会自动跳过已完成部分。"
  exit 1
}
