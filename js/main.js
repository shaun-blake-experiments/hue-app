chrome.app.runtime.onLaunched.addListener(function() {
  // normal launch initiated by the user
  runApp();
});

chrome.app.runtime.onRestarted.addListener(function() {
  // restarted
  runApp();
});

function runApp(readInitialState) {
  chrome.app.window.create('index.html',
    {id: 'mainwindow'});
}