; aFinder as the default file manager (src/main/services/defaultApp.ts) adds an "afinder" verb to folders and
; drives in HKCU and makes it their default. Uninstalling takes both back, so a double-click on a folder never
; points at a removed aFinder.exe. Not on updates: the old version is uninstalled then, and the user's choice stays.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ReadRegStr $0 HKCU "Software\Classes\Directory\shell" ""
    StrCmp $0 "afinder" 0 +2
      DeleteRegValue HKCU "Software\Classes\Directory\shell" ""
    DeleteRegKey HKCU "Software\Classes\Directory\shell\afinder"
    ReadRegStr $0 HKCU "Software\Classes\Drive\shell" ""
    StrCmp $0 "afinder" 0 +2
      DeleteRegValue HKCU "Software\Classes\Drive\shell" ""
    DeleteRegKey HKCU "Software\Classes\Drive\shell\afinder"
  ${endIf}
!macroend
