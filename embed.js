/* An application's 3D page inside the Gallery's frame (opened with ?embed, which the page's head turns into
   html.is-embed: style.css then hides its top bar and heading). Reports the page's height to the Gallery, so the frame
   fits it. */
(function () {
  if (!document.documentElement.classList.contains('is-embed') || window.parent === window) return;
  var last = 0;
  var post = function () {
    var h = Math.ceil(document.body.getBoundingClientRect().height);
    if (h !== last) { last = h; window.parent.postMessage({ xm4dEmbedHeight: h }, location.origin); }
  };
  new ResizeObserver(post).observe(document.body);
  post();
})();
