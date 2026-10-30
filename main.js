/* XM4D project page — page behaviour. */
(function () {
  'use strict';

  /* ── Toast ─────────────────────────────────────────── */
  var toast = document.getElementById('toast');
  var hideTimer = null;
  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { toast.classList.remove('visible'); }, 2400);
  }

  /* ── Copy BibTeX ───────────────────────────────────── */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', '');
        ta.style.position = 'absolute'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta); resolve();
      } catch (err) { reject(err); }
    });
  }
  document.querySelectorAll('[data-copy-target]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = document.querySelector(btn.getAttribute('data-copy-target'));
      if (!target) return;
      copyText(target.innerText.trim()).then(function () {
        showToast('BibTeX copied');
      }).catch(function () {
        showToast('Copy failed — select the text and copy it manually');
      });
    });
  });

  /* ── Result galleries: tabs + lazy, viewport-gated playback ── */
  var videos = Array.prototype.slice.call(document.querySelectorAll('video[data-src]'));

  function load(video) {
    if (video.dataset.loaded) return;
    video.src = video.dataset.src;
    video.dataset.loaded = '1';
  }
  function tryPlay(video) {
    load(video);
    var p = video.play();
    if (p && p.catch) p.catch(function () { /* autoplay blocked — poster stays */ });
  }
  function visible(el) { return !el.closest('[hidden]'); }

  var io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      var v = e.target;
      if (e.isIntersecting && visible(v)) tryPlay(v);
      else if (!v.paused) v.pause();
    });
  }, { rootMargin: '120px 0px', threshold: 0.1 }) : null;

  videos.forEach(function (v) { if (io) io.observe(v); else tryPlay(v); });

  document.querySelectorAll('.segmented[role="tablist"]').forEach(function (list) {
    var gallery = list.closest('.gallery');
    var tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var group = tab.dataset.group;
        tabs.forEach(function (t) { t.setAttribute('aria-selected', t === tab ? 'true' : 'false'); });
        gallery.querySelectorAll('.gallery-group').forEach(function (panel) {
          var on = panel.dataset.group === group;
          panel.hidden = !on;
          panel.classList.toggle('is-active', on);
          panel.querySelectorAll('video').forEach(function (v) {
            if (on) { v.currentTime = 0; tryPlay(v); } else if (!v.paused) v.pause();
          });
        });
      });
    });
  });

  /* ── Method steps: highlight the one in the middle of the viewport and
        show its figure (data-img) in the sticky stage ── */
  var steps = Array.prototype.slice.call(document.querySelectorAll('.step'));
  var stageImg = document.getElementById('stage-img');
  var hudTask = document.getElementById('hud-task');
  function showStep(step) {
    if (hudTask && step.dataset.title) hudTask.textContent = step.dataset.title;
    var src = step.dataset.img;
    if (!stageImg || !src || stageImg.getAttribute('src') === src) return;
    stageImg.classList.add('is-swapping');
    setTimeout(function () {
      stageImg.src = src;
      stageImg.classList.remove('is-swapping');
    }, 200);
  }
  if (steps.length) {
    // The active step is the last one whose top has passed the anchor line
    // (mid-viewport on desktop, lower on phones where the stage sits on top).
    var current = null;
    var setActive = function () {
      var anchor = window.innerHeight * (window.innerWidth <= 900 ? 0.78 : 0.5);
      var best = steps[0];
      steps.forEach(function (s) { if (s.getBoundingClientRect().top <= anchor) best = s; });
      steps.forEach(function (s) { s.classList.toggle('is-active', s === best); });
      if (best !== current) { current = best; showStep(best); }
    };
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { setActive(); ticking = false; });
    }, { passive: true });
    window.addEventListener('resize', setActive);
    setActive();
  }

  /* ── Teaser: a slider walks through the pipeline, zooming the current step to fill the window.
        It plays by itself; dragging it takes over. ── */
  var pipe = document.getElementById('pipeline');
  if (pipe) {
    var FIG_W = 2400, FIG_H = 808;  // units of data-crop, data-camera, and data-show
    var teaserFig = pipe.querySelector('.teaser');
    var pieces = {};
    pipe.querySelectorAll('.teaser-piece').forEach(function (el) {
      pieces[el.dataset.piece] = { el: el, crop: el.dataset.crop.split(' ').map(Number) };
    });
    var panels = Array.prototype.slice.call(pipe.querySelectorAll('.pipe-panel'));
    var slider = pipe.querySelector('.pipe-slider');
    var dots = Array.prototype.slice.call(pipe.querySelectorAll('.pipe-rail i'));
    var ticks = Array.prototype.slice.call(pipe.querySelectorAll('.pipe-ticks button'));
    var toggle = pipe.querySelector('.pipe-toggle');
    var LAST = panels.length - 1;
    var SECONDS_PER_STEP = 7, END_HOLD = 4;
    var REST = 0.35;  // around each stop the view rests; it moves only in between

    // rect (x, y, w, h in figure units) and opacity of every piece at each stop
    var states = panels.map(function (panel) {
      var cam = panel.dataset.camera.split(' ').map(Number);  // scale, dx, dy
      var show = {};
      panel.dataset.show.split(' ').forEach(function (item) {
        var at = item.split('@');
        show[at[0]] = at[1] ? at[1].split(',').map(Number) : true;
      });
      var state = {};
      Object.keys(pieces).forEach(function (k) {
        var c = pieces[k].crop, s = cam[0], x = cam[1] + c[0] * s, y = cam[2] + c[1] * s;
        var at = show[k];
        if (Array.isArray(at)) { x = at[0]; y = at[1]; if (at.length > 2) s = at[2]; }
        state[k] = { rect: [x, y, c[2] * s, c[3] * s], op: (show.all || at) ? 1 : 0 };
      });
      return state;
    });
    var ease = function (x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(2 - 2 * x, 3) / 2; };

    // at the Render stop the rendered clip plays over panel (c), then fades back to the still with the same poses;
    // it repeats while the user stays there (when the walkthrough plays on, its end hold waits for the clip)
    var clip = pipe.querySelector('.teaser-clip');
    var clipOn = false, clipTimer = null;
    var playClip = function () {
      clip.currentTime = 0;
      var p = clip.play();
      if (p && p.catch) p.catch(function () { /* autoplay blocked: the still stays */ });
    };
    var setClip = function (on) {
      if (!clip || on === clipOn) return;
      clipOn = on;
      clearTimeout(clipTimer);
      if (on) clipTimer = setTimeout(playClip, 500);
      else { clip.pause(); clip.classList.remove('is-playing'); }
    };
    if (clip) {
      clip.addEventListener('playing', function () { clip.classList.add('is-playing'); });
      clip.addEventListener('ended', function () {
        clip.classList.remove('is-playing');
        if (clipOn && !playing) clipTimer = setTimeout(playClip, 1800);
      });
    }

    var t = 0, shown = -1;
    var render = function (v) {
      t = Math.max(0, Math.min(LAST, v));
      var k = Math.min(Math.floor(t), LAST - 1);
      var g = ease(Math.max(0, Math.min(1, (t - k - REST) / (1 - 2 * REST))));
      Object.keys(pieces).forEach(function (key) {
        var A = states[k][key], B = states[k + 1][key], st = pieces[key].el.style;
        var r = A.rect.map(function (a, j) { return a + (B.rect[j] - a) * g; });
        st.left = (r[0] / FIG_W * 100) + '%';
        st.top = (r[1] / FIG_H * 100) + '%';
        st.width = (r[2] / FIG_W * 100) + '%';
        st.height = (r[3] / FIG_H * 100) + '%';
        // outgoing pieces fade early in the move and incoming ones late, overlapping a little
        var f = B.op > A.op ? (g - 0.4) / 0.6 : g / 0.6;
        st.opacity = A.op + (B.op - A.op) * Math.max(0, Math.min(1, f));
      });
      slider.value = t;
      pipe.style.setProperty('--fill', (t / LAST * 100) + '%');
      setClip(inView && t > LAST - REST);

      var step = g < 0.5 ? k : k + 1;
      if (step === shown) return;
      shown = step;
      panels.forEach(function (p, j) { p.hidden = j !== step; });
      ticks.forEach(function (b, j) {
        if (j === step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
        b.classList.toggle('is-done', j < step);
      });
      dots.forEach(function (d, j) { d.classList.toggle('is-done', j <= step); });
      slider.setAttribute('aria-valuetext', panels[step].querySelector('.pipe-kicker').textContent);
    };

    // a jump (label click, keyboard, loop restart) eases with CSS transitions instead of snapping
    var jumpTimer = null;
    var jumpTo = function (v) {
      teaserFig.classList.add('is-jump');
      render(v);
      clearTimeout(jumpTimer);
      jumpTimer = setTimeout(function () { teaserFig.classList.remove('is-jump'); }, 550);
    };

    var playing = true, inView = true, raf = null, last = null, held = 0;
    var frame = function (now) {
      raf = null;
      if (!playing || !inView) return;
      if (last !== null) {
        var dt = Math.min(0.1, (now - last) / 1000);
        if (t < LAST) render(t + dt / SECONDS_PER_STEP);
        else if ((!clip || clip.paused) && (held += dt) > END_HOLD) { held = 0; jumpTo(0); }
      }
      last = now;
      raf = requestAnimationFrame(frame);
    };
    var setPlaying = function (on) {
      playing = on;
      pipe.classList.toggle('is-paused', !on);
      toggle.setAttribute('aria-label', on ? 'Pause the walkthrough' : 'Play the walkthrough');
      last = null;
      if (on && raf === null) raf = requestAnimationFrame(frame);
    };

    slider.addEventListener('pointerdown', function () { setPlaying(false); });
    slider.addEventListener('input', function () { setPlaying(false); render(+slider.value); });
    slider.addEventListener('keydown', function (e) {
      var step = Math.round(t);
      var to = { ArrowRight: step + 1, ArrowUp: step + 1, ArrowLeft: step - 1, ArrowDown: step - 1, Home: 0, End: LAST }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      setPlaying(false);
      jumpTo(to);
    });
    ticks.forEach(function (b) {
      b.addEventListener('click', function () { setPlaying(false); jumpTo(+b.dataset.step); });
    });
    toggle.addEventListener('click', function () {
      if (!playing && t >= LAST) jumpTo(0);
      setPlaying(!playing);
    });

    pipe.classList.add('is-live');
    render(0);
    setPlaying(true);
    if ('IntersectionObserver' in window) {  // pause while off screen
      new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          inView = e.isIntersecting;
          last = null;
          setClip(inView && t > LAST - REST);
          if (inView && playing && raf === null) raf = requestAnimationFrame(frame);
        });
      }).observe(pipe);
    }
  }

  /* ── Hero video: autoplays muted; pause off-screen, resume when back ── */
  var promo = document.getElementById('promo');
  if (promo && io) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { var p = promo.play(); if (p && p.catch) p.catch(function () {}); }
        else if (!promo.paused) promo.pause();
      });
    }, { threshold: 0.25 }).observe(promo);
  }
})();
