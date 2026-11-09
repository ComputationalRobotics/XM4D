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

  /* ── Teaser: full screen above the page, as a player. Autoplays muted and pauses off screen; a click on the video
       plays or pauses it (a large icon in the middle); the bar seeks, shows the time and turns the sound on; while it
       plays, the bar and the cue hide when the pointer rests. It fades and recedes as the page scrolls up over it ── */
  var intro = document.getElementById('teaser');
  var promo = document.getElementById('promo');
  if (intro && promo) {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var stage = intro.querySelector('.intro-stage');
    var hit = document.getElementById('promo-hit');
    var big = intro.querySelector('.intro-big');
    var playBtn = document.getElementById('promo-play');
    var soundBtn = document.getElementById('promo-sound');
    var seek = document.getElementById('promo-seek');
    var timeEl = document.getElementById('promo-time');
    var bar = intro.querySelector('.intro-bar');
    var cue = intro.querySelector('.intro-cue');
    var userPaused = false, onScreen = true, seeking = false;     /* autoplays even with reduced motion: Pause is right there */

    var clock = function (s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); };
    var showTime = function () {
      var d = promo.duration || +seek.max, t = seeking ? +seek.value : promo.currentTime;
      if (!seeking) seek.value = t;
      seek.max = d; seek.style.setProperty('--p', (100 * t / d).toFixed(2) + '%');
      timeEl.textContent = clock(t) + ' / ' + clock(d);
    };
    var paint = function () {
      intro.classList.toggle('is-paused', userPaused);
      intro.classList.toggle('is-sound', !promo.muted);
      var label = userPaused ? 'Play the teaser' : 'Pause the teaser';
      playBtn.setAttribute('aria-label', label); hit.setAttribute('aria-label', label);
      soundBtn.setAttribute('aria-pressed', String(!promo.muted));
    };
    var sync = function () {
      if (userPaused || !onScreen) { if (!promo.paused) promo.pause(); }
      else {
        var p = promo.play();
        if (p && p.catch) p.catch(function () { userPaused = true; paint(); });   /* autoplay blocked: show Play */
      }
      paint();
    };
    var flashTimer = null;
    var toggle = function (flash) {
      userPaused = !userPaused; sync();
      if (flash && !userPaused) {                     /* the large icon: Play stays while paused; on play, Pause flashes */
        big.classList.add('is-flash', 'show-pause'); clearTimeout(flashTimer);
        flashTimer = setTimeout(function () { big.classList.remove('is-flash', 'show-pause'); }, 500);
      }
    };
    hit.addEventListener('click', function () { toggle(true); wake(); });
    playBtn.addEventListener('click', function () { toggle(false); });
    soundBtn.addEventListener('click', function () {
      promo.muted = !promo.muted;
      if (!promo.muted) userPaused = false;     /* turning the sound on means "play it" */
      sync();
    });
    seek.addEventListener('input', function () { seeking = true; promo.currentTime = +seek.value; showTime(); });
    seek.addEventListener('change', function () { seeking = false; showTime(); });
    promo.addEventListener('loadedmetadata', showTime);
    /* the bar follows playback about 8 times a second, and not at all while it is hidden */
    setInterval(function () { if (!promo.paused && onScreen && getComputedStyle(bar).opacity !== '0') showTime(); }, 125);

    var idleTimer = null;
    var wake = function () {
      intro.classList.remove('is-idle'); clearTimeout(idleTimer);
      idleTimer = setTimeout(function () {         /* stays while a key user is on the bar; a mouse drag leaves focus, not that */
        var a = document.activeElement; if (!(bar.contains(a) && a.matches(':focus-visible'))) intro.classList.add('is-idle');
      }, 2500);
    };
    ['pointermove', 'pointerdown', 'keydown', 'focusin'].forEach(function (ev) { intro.addEventListener(ev, wake, { passive: true }); });
    wake();

    if (io) {
      new IntersectionObserver(function (entries) { onScreen = entries[0].isIntersecting; sync(); },
        { threshold: 0.15 }).observe(intro);
    }

    var queued = false, last = -1;
    var fade = function () {
      queued = false;
      var k = Math.min(1, Math.max(0, window.scrollY / (intro.offsetHeight * 0.8)));
      if (k === last) return;
      last = k;
      stage.style.opacity = String(1 - 0.85 * k);
      stage.style.transform = k ? 'translateY(' + (30 * k).toFixed(2) + '%) scale(' + (1 - 0.05 * k).toFixed(4) + ')' : '';
      bar.style.opacity = k ? String(Math.max(0, 1 - 3 * k)) : '';
      if (cue) cue.style.opacity = k ? String(Math.max(0, 1 - 4 * k)) : '';
    };
    if (!reduce) {
      window.addEventListener('scroll', function () {
        if (!queued) { queued = true; requestAnimationFrame(fade); }
      }, { passive: true });
      fade();
    }
    if (cue) {
      cue.addEventListener('click', function (e) {
        e.preventDefault();
        window.scrollTo({ top: intro.offsetTop + intro.offsetHeight, behavior: reduce ? 'auto' : 'smooth' });
      });
    }

    /* the overlay: the teaser's text, pills and logos as SVG over the text-free video, in the teaser's 1920x1080 design
       space (assets/video/promo-text.json: per item its runs, font, box and per-frame x, y, opacity, scale). The SVG is
       fitted like the video (cover or contain), and follows the frame on screen. If the file cannot be read, the video
       falls back to the 720p cut with its text baked in. */
    var layer = document.getElementById('promo-text');
    if (layer) {
      var NS = 'http://www.w3.org/2000/svg', cues = null, nodes = [], lastF = -1;
      layer.style.visibility = 'hidden';
      var fitLayer = function () {
        layer.setAttribute('preserveAspectRatio', getComputedStyle(promo).objectFit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice');
      };
      var at = function (v, i) { return typeof v === 'number' ? v : v[i]; };
      var build = function (data) {
        cues = data;
        data.items.forEach(function (it) {
          var g = document.createElementNS(NS, 'g'), el;
          g.style.display = 'none';
          if (it.kind === 'text') {
            el = document.createElementNS(NS, 'text');
            var f = it.font, size = f.size;
            el.setAttribute('font-size', size); el.setAttribute('font-weight', f.weight || 400);
            el.setAttribute('fill', f.fill || '#1c1c20'); el.setAttribute('text-anchor', it.anchor || 'start');
            if (f.ls) el.setAttribute('letter-spacing', (f.ls * size).toFixed(2));
            var up = 0;
            it.runs.forEach(function (r) {
              var ts = document.createElementNS(NS, 'tspan'), shift = r.sup ? -0.36 * size : 0;
              ts.textContent = r.t;
              if (r.fill) ts.setAttribute('fill', r.fill);
              if (r.weight) ts.setAttribute('font-weight', r.weight);
              if (r.sup) ts.setAttribute('font-size', (0.6 * size).toFixed(2));
              if (shift !== up) { ts.setAttribute('dy', (shift - up).toFixed(2)); up = shift; }
              el.appendChild(ts);
            });
          } else if (it.kind === 'image') {
            el = document.createElementNS(NS, 'image');
            el.setAttribute('href', it.href);
            el.setAttribute('x', it.box[0]); el.setAttribute('y', it.box[1]);
            el.setAttribute('width', it.box[2] - it.box[0]); el.setAttribute('height', it.box[3] - it.box[1]);
          } else {
            el = document.createElementNS(NS, 'rect');
            el.setAttribute('x', it.rect[0]); el.setAttribute('y', it.rect[1]);
            el.setAttribute('width', it.rect[2] - it.rect[0]); el.setAttribute('height', it.rect[3] - it.rect[1]);
            if (it.rx) { el.setAttribute('rx', it.rx); el.setAttribute('ry', it.rx); }
            el.setAttribute('fill', it.fill || 'none');
            if (it.stroke) { el.setAttribute('stroke', it.stroke); el.setAttribute('stroke-width', it.sw || 1); }
          }
          g.appendChild(el); layer.appendChild(g); nodes.push(g);
        });
        fitLayer(); draw(true);
        /* the poster has the text baked in: the layer shows once the text-free video has a frame up */
        var show = function () { layer.style.visibility = ''; };
        if (promo.readyState >= 2) show(); else promo.addEventListener('loadeddata', show, { once: true });
      };
      var draw = function (force, t) {     /* t: the presented frame's media time, when the browser reports it */
        if (!cues) return;
        var f = Math.max(0, Math.min(cues.frames - 1, Math.round((t === undefined ? promo.currentTime : t) * cues.fps - 1e-3)));
        if (f === lastF && !force) return;
        lastF = f;
        cues.items.forEach(function (it, k) {
          var g = nodes[k];
          if (f < it.f0 || f > it.f1) { if (g.style.display !== 'none') g.style.display = 'none'; return; }
          var i = f - it.f0, o = at(it.o, i);
          if (o <= 0.002) { g.style.display = 'none'; return; }
          g.style.display = '';
          g.setAttribute('opacity', o.toFixed(3));
          g.setAttribute('transform', 'translate(' + at(it.x, i) + ' ' + at(it.y, i) + ') scale(' + at(it.s, i) + ')');
        });
      };
      var follow = function () {
        if (promo.requestVideoFrameCallback) {
          var onFrame = function (now, meta) { draw(false, meta && meta.mediaTime); promo.requestVideoFrameCallback(onFrame); };
          promo.requestVideoFrameCallback(onFrame);
        } else {
          var loop = function () { if (!promo.paused) draw(); requestAnimationFrame(loop); };
          requestAnimationFrame(loop);
        }
        ['seeked', 'timeupdate', 'loadeddata'].forEach(function (ev) { promo.addEventListener(ev, function () { draw(); }); });
        window.addEventListener('resize', fitLayer);
      };
      fetch('assets/video/promo-text.json?v=11').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (data) { return (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(function () { build(data); follow(); }); })
        .catch(function () {                      /* no overlay: the cut with its text baked in */
          var t = promo.currentTime; promo.src = 'assets/video/promo-720-text.mp4?v=11'; promo.currentTime = t; sync();
        });
    }
    showTime(); sync();
  }
})();
