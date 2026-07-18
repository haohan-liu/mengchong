!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎来到 ${PRODUCT_NAME}"
  !define MUI_WELCOMEPAGE_TEXT "珊珊会陪你度过每一个专注时刻。$\r$\n$\r$\n安装只会写入应用运行所需的本地文件，不会读取或上传你的个人内容。"
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
