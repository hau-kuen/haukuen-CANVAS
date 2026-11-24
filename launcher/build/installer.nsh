; 把默认安装目录从 %LOCALAPPDATA% 改到 D 盘（C 盘空间紧张）。
; 用户仍可在安装向导里改路径（allowToChangeInstallationDirectory: true）。
!macro preInit
  SetRegView 64
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "D:\AI\Canvas Agent"
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "D:\AI\Canvas Agent"
  SetRegView 32
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "D:\AI\Canvas Agent"
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "D:\AI\Canvas Agent"
!macroend
