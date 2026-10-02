@echo off
setlocal
for /f "usebackq tokens=*" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "ONE_VS_INSTALL=%%i"
if not defined ONE_VS_INSTALL exit /b 1
call "%ONE_VS_INSTALL%\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 exit /b 1
if not defined CARGO_TARGET_DIR set "CARGO_TARGET_DIR=%~dp0..\work\rust-search"
node "%~dp0build.mjs"
exit /b %errorlevel%
