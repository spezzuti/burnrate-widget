; ---------------------------------------------------------------------------
; BurnRate custom NSIS include (Windows-only; ignored on mac/linux builds).
;
; Overrides electron-builder's "is the app already running?" check.
;
; electron-builder wires this in via the CHECK_APP_RUNNING macro
; (app-builder-lib/templates/nsis/include/allowOnlyOneInstallerInstance.nsh):
;
;     !macro CHECK_APP_RUNNING
;         !ifmacrodef customCheckAppRunning
;           !insertmacro customCheckAppRunning      ; <- this file wins
;         !else
;           !insertmacro _CHECK_APP_RUNNING         ; default graceful check
;         !endif
;     !macroend
;
; CHECK_APP_RUNNING runs in BOTH flows:
;   - install:   installSection.nsh -> !insertmacro CHECK_APP_RUNNING
;   - uninstall: uninstaller.nsh Function un.checkAppRunning -> CHECK_APP_RUNNING
; so defining customCheckAppRunning replaces the running-check for install AND
; uninstall.
;
; Why override: BurnRate hides to the system tray when its window is closed
; (when "Show tray stats" is on). The default check tries to close the app with
; a window message, which the hide-to-tray handler swallows, so the process
; never exits and the installer/uninstaller loops forever on "app is running"
; (leaving a half-uninstalled state). We force-terminate the process instead so
; install and uninstall NEVER block on a tray-hidden instance.
;
; Note: when customCheckAppRunning is defined, electron-builder skips including
; getProcessInfo.nsh and "Var pid" (see the !ifmacrondef guard at the top of
; allowOnlyOneInstallerInstance.nsh), so this macro must be self-contained and
; must NOT reference $pid / ${GetProcessInfo}. taskkill /F is self-contained.
; ---------------------------------------------------------------------------

!macro customCheckAppRunning
  DetailPrint "Ensuring ${PRODUCT_NAME} is not running..."
  ; Force-terminate any running instance (including a tray-hidden one).
  ; ${APP_EXECUTABLE_FILENAME} resolves to "BurnRate.exe".
  nsExec::Exec 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}"'
  Pop $0 ; discard exit code — non-zero simply means it wasn't running; ignore.
  ; Brief pause so Windows releases the file handles before we touch INSTDIR.
  Sleep 800
!macroend
