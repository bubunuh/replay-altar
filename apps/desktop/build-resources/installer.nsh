; Replay Altar's installer additions (electron-builder NSIS). The collector runs in the
; background on ReplayAltar.exe (while the window is open, or always and from login through the
; Run key with "Keep Replay Altar running after closing the window"): stop it before files are
; replaced or removed, and remove its Run entry on uninstall (your replays and stats in
; %LOCALAPPDATA%\replay-altar are kept).
!macro customInit
  nsExec::Exec 'taskkill /F /IM ReplayAltar.exe'
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /IM ReplayAltar.exe'
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ReplayAltarCollector"
!macroend
