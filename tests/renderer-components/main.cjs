const {app, BrowserWindow} = require('electron');
if (!process.env.ONE_COMPONENT_TEST_PROFILE) throw Error('Missing isolated component test profile');
app.setPath('userData', process.env.ONE_COMPONENT_TEST_PROFILE);
app.whenReady().then(async () => {
  const window = new BrowserWindow({show: false, width: 900, height: 700,
    webPreferences: {contextIsolation: true, nodeIntegration: false, backgroundThrottling: false}});
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'));
});
app.on('window-all-closed', () => app.quit());
