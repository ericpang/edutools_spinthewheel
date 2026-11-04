// Runs only in browsers that cannot load ES modules (the app itself is a module). Plain old JavaScript on purpose.
(function () {
  var el = document.getElementById('unsupported');
  if (!el) return;
  el.querySelector('h1').textContent = 'This browser is missing something the app needs';
  el.querySelector('p').textContent = 'Please use a recent version of Chrome, Edge, Firefox or Safari.';
  el.hidden = false;
})();
