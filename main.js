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

  function setPoster(video) {
    if (video.dataset.poster) { video.poster = video.dataset.poster; delete video.dataset.poster; }
  }
  function load(video) {
    if (video.dataset.loaded) return;
    setPoster(video);
    video.src = video.dataset.src;
    video.dataset.loaded = '1';
  }
  /* the clips' posters (data-poster) load as each nears the screen, and only once the teaser has started, so that on
     a first visit the teaser gets the bandwidth instead of some fifty images below it */
  var startPosters = function () {
    if (startPosters.done) return;
    startPosters.done = true;
    var posters = Array.prototype.slice.call(document.querySelectorAll('video[data-poster]'));
    if (!('IntersectionObserver' in window)) { posters.forEach(setPoster); return; }
    var pio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { setPoster(e.target); pio.unobserve(e.target); } });
    }, { rootMargin: '600px 0px' });
    posters.forEach(function (v) { pio.observe(v); });
  };
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

  /* ── Method steps: highlight the one in the middle of the viewport and play its clip in the sticky stage (the
        stage's videos, one per step in step order, cross-fade). The posters and the active clip load as the stage nears
        the screen; the clip plays only while the stage is in view, from its beginning each time the stage comes into
        view or its step comes up ── */
  var steps = Array.prototype.slice.call(document.querySelectorAll('.step'));
  var stageVids = Array.prototype.slice.call(document.querySelectorAll('.stage-media video'));
  var hudTask = document.getElementById('hud-task');
  var stageNear = !('IntersectionObserver' in window), stageSeen = stageNear, stageStep = -1;
  function syncStage() {
    stageVids.forEach(function (v, i) {
      var on = i === stageStep;
      v.classList.toggle('is-on', on);
      if (on && stageNear && !v.getAttribute('src')) { v.preload = 'auto'; v.src = v.dataset.stageSrc; }
      if (on && stageSeen) {
        var p = v.play();
        if (p && p.catch) p.catch(function () { /* autoplay blocked — poster stays */ });
      } else if (!v.paused) v.pause();
    });
  }
  if (stageVids.length && !stageNear) {
    var stageBox = stageVids[0].parentNode;
    new IntersectionObserver(function (entries) {
      stageNear = entries[entries.length - 1].isIntersecting;
      if (stageNear) stageVids.forEach(function (v) {
        if (v.dataset.stagePoster) { v.poster = v.dataset.stagePoster; delete v.dataset.stagePoster; }
      });
      syncStage();
    }, { rootMargin: '400px 0px' }).observe(stageBox);
    new IntersectionObserver(function (entries) {
      var seen = entries[entries.length - 1].isIntersecting, v = stageVids[stageStep];
      if (seen && !stageSeen && v && v.getAttribute('src')) v.currentTime = 0;
      stageSeen = seen;
      syncStage();
    }, { threshold: 0.5 }).observe(stageBox);
  }
  function showStep(step) {
    if (hudTask && step.dataset.title) hudTask.textContent = step.dataset.title;
    var k = steps.indexOf(step);
    if (k !== stageStep && stageVids[k] && stageVids[k].getAttribute('src')) stageVids[k].currentTime = 0;
    stageStep = k;
    syncStage();
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
    var ready = false, starved = false, shownT = null;            /* shownT: media time of the frame on screen */

    /* a slow connection (where the browser tells) gets a lighter cut than the screen alone would pick */
    var net = navigator.connection;
    if (net && (net.saveData || net.downlink < 10)) {
      var want = net.saveData || net.downlink < 5 ? 720 : 1080;
      var picked = Array.prototype.slice.call(promo.querySelectorAll('source')).filter(function (s) {
        return !s.media || window.matchMedia(s.media).matches;
      })[0];
      var res = picked ? +(/promo-(\d+)/.exec(picked.src) || [0, 0])[1] : 0;
      if (res > want) promo.src = picked.src.replace('promo-' + res, 'promo-' + want);
    }

    var clock = function (s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); };
    var showTime = function () {
      var d = promo.duration || +seek.max, t = seeking ? +seek.value : (shownT !== null ? shownT : promo.currentTime);
      if (!seeking) seek.value = t;
      seek.max = d; seek.style.setProperty('--p', (100 * t / d).toFixed(2) + '%');
      timeEl.textContent = clock(t) + ' / ' + clock(d);
    };
    var paint = function () {
      intro.classList.toggle('is-loading', !userPaused && (!ready || starved));
      intro.classList.toggle('is-paused', userPaused);
      intro.classList.toggle('is-sound', !promo.muted);
      var label = userPaused ? 'Play the teaser' : intro.classList.contains('is-loading') ? 'Loading the teaser' : 'Pause the teaser';
      playBtn.setAttribute('aria-label', label); hit.setAttribute('aria-label', label);
      soundBtn.setAttribute('aria-pressed', String(!promo.muted));
    };
    var sync = function () {
      if (userPaused || !onScreen || !ready) { if (!promo.paused) promo.pause(); }
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
    /* playback waits, paused on the first frame with the ring showing, until it can play through without stopping:
       8 s buffered, or 3 s while the download runs at least 1.5x faster than playback. A download slower than that
       steps down to the next lighter cut (1440p, 1080p, 720p). A browser that buffers nothing until it plays (iOS)
       starts after 4 s. Whenever playback later waits for data, the ring shows again */
    var begin = function () { if (ready) return; ready = true; clearInterval(watch); startPosters(); sync(); };
    var ahead = function () {
      var b = promo.buffered, t = promo.currentTime;
      for (var i = 0; i < b.length; i++) if (b.start(i) <= t + 0.1 && b.end(i) > t) return b.end(i) - t;
      return 0;
    };
    var CUTS = [1440, 1080, 720], since = null;
    var check = function () {
      if (ready || !(promo.readyState >= 1) || !promo.duration) return;
      if (since === null) since = performance.now();
      var a = ahead(), dt = (performance.now() - since) / 1000, rate = a / Math.max(dt, 0.25);
      if (a >= Math.min(8, promo.duration - promo.currentTime - 0.5) || (a >= 3 && rate >= 1.5)) { begin(); return; }
      if (dt > 4 && a < 0.5) { begin(); return; }
      var m = /promo-(\d+)\.mp4/.exec(promo.currentSrc), lower = m && CUTS[CUTS.indexOf(+m[1]) + 1];
      if (dt > 2 && rate < 1.5 && lower) { since = null; promo.src = promo.currentSrc.replace('promo-' + m[1], 'promo-' + lower); }
    };
    var watch = setInterval(check, 250);
    promo.addEventListener('progress', check);
    setTimeout(startPosters, 15000);                 /* the page's other images, even if the teaser never gets going */
    promo.addEventListener('waiting', function () { starved = true; paint(); });
    ['playing', 'pause', 'seeked'].forEach(function (ev) {
      promo.addEventListener(ev, function () { if (ev !== 'seeked' || promo.readyState >= 3) { starved = false; paint(); } });
    });
    seek.addEventListener('input', function () { seeking = true; shownT = null; promo.currentTime = +seek.value; showTime(); });
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
        layer.style.visibility = '';             /* the poster is the text-free first frame, so the text can show at once */
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
          var onFrame = function (now, meta) {
            if (meta) shownT = meta.mediaTime;     /* the bar follows the frames shown, never a clock running ahead of them */
            draw(false, meta && meta.mediaTime); promo.requestVideoFrameCallback(onFrame);
          };
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
  } else startPosters();
})();
