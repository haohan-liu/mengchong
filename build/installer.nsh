!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎来到 ${PRODUCT_NAME}"
  !define MUI_WELCOMEPAGE_TEXT "轻盈陪伴，从这一刻开始。$\r$\n$\r$\n首次安装可以自由选择路径；升级会自动沿用当前安装与数据。"
  ; electron-builder defines this macro after its NSIS helper includes are loaded.
  ; It skips the page on an upgrade while keeping it for a first installation.
  !insertmacro skipPageIfUpdated
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "准备卸载 ${PRODUCT_NAME}"
  !define MUI_WELCOMEPAGE_TEXT "如果只是升级到新版本，请直接运行新版安装包；你的设置、聊天与统计会保留。$\r$\n$\r$\n继续卸载将移除程序文件。"
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    ReadRegStr $0 HKCU "Software\com.qpet.ai" "DataDirectory"
    ${IfNot} $0 == ""
      IfFileExists "$0\.qpet-data-root" 0 +2
        RMDir /r "$0"
    ${EndIf}
    RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
    DeleteRegKey HKCU "Software\com.qpet.ai"
  ${EndIf}
!macroend
