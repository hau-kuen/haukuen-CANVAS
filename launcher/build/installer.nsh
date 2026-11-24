; 默认安装目录：优先 D 盘（C 盘空间紧张），没有 D 盘就回落到用户目录。
; 原来硬编码 "D:\AI\Canvas Agent"，在没有 D 盘的机器上默认路径非法，
; 一路「下一步」的用户会装到不存在的盘 —— 这是「装不上 / 装完不启动」的常见原因。
; 用户仍可在安装向导里改路径（allowToChangeInstallationDirectory: true）。
!macro preInit
  StrCpy $0 "$LOCALAPPDATA\Programs\Canvas Agent"
  IfFileExists "D:\*.*" 0 +2
    StrCpy $0 "D:\AI\Canvas Agent"

  SetRegView 64
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$0"
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$0"
  SetRegView 32
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$0"
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$0"
!macroend
