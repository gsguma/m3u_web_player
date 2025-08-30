@echo off
setlocal
set url=%1
set url=%url:vlc:=%
start "" "C:\Program Files\VideoLAN\VLC\vlc.exe" "%url%" --no-fullscreen --loop --input-repeat=65535 --meta-title="IPTV"
