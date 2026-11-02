; ---------------------------------------------------------------------------
; Lehtratuh installer extras
;
; electron-builder already writes the file-association table (perMachine: true).
; These macros add the pieces it does not cover:
;   • "Open with Lehtratuh" on the image extensions even when Windows has a
;     different default handler, so the app is not invisible in the shell menu.
;   • A proper App Paths entry, so the Win+R / Start menu "lehtratuh" command
;     works and other apps can locate the exe.
;   • Clean removal of everything above on uninstall.
; ---------------------------------------------------------------------------

!macro customInstall
  ; App Paths — lets the shell find the exe without a full path.
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\Lehtratuh.exe" "" "$INSTDIR\Lehtratuh.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\Lehtratuh.exe" "Path" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\Lehtratuh.exe" "SupportedTypes" ".jpg;.jpeg;.png;.gif;.bmp;.webp;.tif;.tiff;.ico;.avif;.heic;.jxl"

  ; OpenWithProgids for every image extension. This is what puts the app in the
  ; "Open with" list unconditionally, rather than only where it already owns the
  ; extension.
  WriteRegStr HKCR ".jpg\OpenWithProgids" "Lehtratuh.Image" ""
  WriteRegStr HKCR ".jpeg\OpenWithProgids" "Lehtratuh.Image" ""
  WriteRegStr HKCR ".png\OpenWithProgids" "Lehtratuh.Image" ""
  WriteRegStr HKCR ".gif\OpenWithProgids" "Lehtratuh.Image" ""
  WriteRegStr HKCR ".bmp\OpenWithProgids" "Lehtratuh.Image" ""
  WriteRegStr HKCR ".webp\OpenWithProgids" "Lehtratuh.Image" ""
  WriteRegStr HKCR ".tif\OpenWithProgids" "Lehtratuh.Image" ""
  WriteRegStr HKCR ".tiff\OpenWithProgids" "Lehtratuh.Image" ""
  WriteRegStr HKCR ".avif\OpenWithProgids" "Lehtratuh.Image" ""
  WriteRegStr HKCR ".heic\OpenWithProgids" "Lehtratuh.Image" ""
  WriteRegStr HKCR ".ico\OpenWithProgids" "Lehtratuh.Image" ""
  WriteRegStr HKCR ".jxl\OpenWithProgids" "Lehtratuh.Image" ""

  ; The ProgID itself, so "Open with" shows a real name and icon.
  WriteRegStr HKCR "Lehtratuh.Image" "" "Lehtratuh image"
  WriteRegStr HKCR "Lehtratuh.Image\DefaultIcon" "" "$INSTDIR\Lehtratuh.exe,0"
  WriteRegStr HKCR "Lehtratuh.Image\shell\open" "" "Open in Lehtratuh"
  WriteRegStr HKCR "Lehtratuh.Image\shell\open\command" "" '"$INSTDIR\Lehtratuh.exe" "%1"'
  WriteRegStr HKCR "Lehtratuh.Image\shell\edit" "" "Edit in Lehtratuh"
  WriteRegStr HKCR "Lehtratuh.Image\shell\edit\command" "" '"$INSTDIR\Lehtratuh.exe" --edit "%1"'
  ; "edit" marks the app as an editor as well as a viewer in the shell.
  WriteRegStr HKCR "Lehtratuh.Image" "FriendlyTypeName" "Lehtratuh image"

  ; Notify the shell so the new associations appear without a restart.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\Lehtratuh.exe"

  DeleteRegValue HKCR ".jpg\OpenWithProgids" "Lehtratuh.Image"
  DeleteRegValue HKCR ".jpeg\OpenWithProgids" "Lehtratuh.Image"
  DeleteRegValue HKCR ".png\OpenWithProgids" "Lehtratuh.Image"
  DeleteRegValue HKCR ".gif\OpenWithProgids" "Lehtratuh.Image"
  DeleteRegValue HKCR ".bmp\OpenWithProgids" "Lehtratuh.Image"
  DeleteRegValue HKCR ".webp\OpenWithProgids" "Lehtratuh.Image"
  DeleteRegValue HKCR ".tif\OpenWithProgids" "Lehtratuh.Image"
  DeleteRegValue HKCR ".tiff\OpenWithProgids" "Lehtratuh.Image"
  DeleteRegValue HKCR ".avif\OpenWithProgids" "Lehtratuh.Image"
  DeleteRegValue HKCR ".heic\OpenWithProgids" "Lehtratuh.Image"
  DeleteRegValue HKCR ".ico\OpenWithProgids" "Lehtratuh.Image"
  DeleteRegValue HKCR ".jxl\OpenWithProgids" "Lehtratuh.Image"

  DeleteRegKey HKCR "Lehtratuh.Image"

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
