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
