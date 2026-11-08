/* XM4D project page — the hand-object viewer (Applications): per clip, the Hunyuan3D object meshes at their solved
   6D poses, both hand skeletons, the camera and the table plane, scrubbed by frame; a camera view puts the meshes over
   the input frame, with the SAM 3 mask outlines dashed. Data per clip in data-base/<clip>/ (tools: export_viewer.py).
   three.js is loaded only when the viewer comes near the viewport. */
(function () {
  'use strict';
  var root = document.querySelector('.ho-viewer');
  if (!root) return;
  var THREE_URLS = ['https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js',
                    'https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/controls/OrbitControls.js'];

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error(src)); };
      document.head.appendChild(s);
    });
  }
  var started = false;
  function start() {
    if (started) return; started = true;
    THREE_URLS.reduce(function (p, u) { return p.then(function () { return loadScript(u); }); }, Promise.resolve())
      .then(init).catch(function () { root.querySelector('.ho-status').textContent = 'three.js did not load.'; });
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries, obs) {
      if (entries.some(function (e) { return e.isIntersecting; })) { obs.disconnect(); start(); }
    }, { rootMargin: '600px 0px' }).observe(root);
  } else start();

  function init() {
    var q = function (s) { return root.querySelector(s); };
    var stage = q('.ho-stage'), glCanvas = q('.ho-gl'), bgCanvas = q('.ho-bg'), ovCanvas = q('.ho-overlay');
    var inCanvas = q('.ho-input canvas'), statusEl = q('.ho-status'), hintEl = q('.ho-hint'), sel = q('.ho-clip'), capEl = q('.ho-caption');
    var playBtn = q('.ho-play'), slider = q('.ho-slider'), frameLabel = q('.ho-frame');
    var viewBtns = Array.prototype.slice.call(root.querySelectorAll('[data-view]'));
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var bgCtx = bgCanvas.getContext('2d'), ovCtx = ovCanvas.getContext('2d'), inCtx = inCanvas.getContext('2d');
    var BASE = root.dataset.base || '';

    function say(text) { statusEl.textContent = text || ''; statusEl.hidden = !text; }
    if (!window.THREE || !THREE.OrbitControls) { say('three.js did not load.'); return; }
    var css = getComputedStyle(root);
    function tok(name, fallback) { var v = css.getPropertyValue(name).trim(); return v || fallback || '#888888'; }
    var layers = {};
    root.querySelectorAll('[data-layer]').forEach(function (b) {
      layers[b.dataset.layer] = b.checked;
      b.addEventListener('change', function () { layers[b.dataset.layer] = b.checked; applyLayers(); });
    });

    /* ── three.js scene ── */
    var renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true }); }
    catch (e) { say('WebGL is not available in this browser.'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    var scene = new THREE.Scene();
    var stageColour = new THREE.Color(tok('--ho-stage', '#f1efe9'));
    scene.fog = new THREE.Fog(stageColour, 1.4, 3.0);
    var camera = new THREE.PerspectiveCamera(35, 4 / 3, 0.01, 30); camera.up.set(0, 0, 1);
    scene.add(camera);
    var headlight = new THREE.DirectionalLight(0xffffff, 0.22); headlight.position.set(0, 0, 1); camera.add(headlight); camera.add(headlight.target);
    scene.add(new THREE.AmbientLight(0xffffff, 0.32));   // as the clips' renderer: headlight ambient .32 + diffuse .22, one light .45
    var sun = new THREE.DirectionalLight(0xffffff, 0.45); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.002;
    scene.add(sun); scene.add(sun.target);
    var controls = new THREE.OrbitControls(camera, glCanvas);
    controls.enableDamping = !reduceMotion; controls.dampingFactor = 0.12; controls.screenSpacePanning = true;
    controls.minDistance = 0.08; controls.maxDistance = 6; controls.rotateSpeed = 0.8;
    controls.addEventListener('start', function () { if (camView) setView('orbit'); });
    controls.addEventListener('change', function () { dirty = true; });

    var sphereGeo = new THREE.SphereGeometry(1, 16, 12), cylGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, false);
    var axisGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false); axisGeo.translate(0, 0.5, 0);
    var Y = new THREE.Vector3(0, 1, 0), AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    var mats = {
      joint: new THREE.MeshPhongMaterial({ shininess: 30, specular: 0x333333, color: tok('--ho-joint', '#f7f7f7') }),
      bone: [new THREE.MeshPhongMaterial({ shininess: 30, specular: 0x333333, color: tok('--ho-left', '#e8912d') }),
             new THREE.MeshPhongMaterial({ shininess: 30, specular: 0x333333, color: tok('--ho-right', '#2f6fd6') })],
      halo: new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, transparent: true, fog: false, color: 0xffffff }),
      ax: ['--ho-ax-x', '--ho-ax-y', '--ho-ax-z'].map(function (n) { return new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, transparent: true, fog: false, color: tok(n) }); }),
      cam: new THREE.LineBasicMaterial({ fog: false, color: tok('--ho-cam', '#455a64') }),
      floor: new THREE.MeshLambertMaterial()
    };
    var floorTex = (function () {   // the clips' floor: a 10 cm checker
      var c = document.createElement('canvas'); c.width = c.height = 128; var g = c.getContext('2d');
      g.fillStyle = tok('--ho-floor-a', '#eceae6'); g.fillRect(0, 0, 128, 128); g.fillStyle = tok('--ho-floor-b', '#e2e0dc'); g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
      var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter;
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); return t;
    })();
    mats.floor.map = floorTex;
    function clearColour() { renderer.setClearColor(stageColour, camView ? 0 : 1); }

    /* ── state ── */
    var clip = null, loadToken = 0, frame = 0, camView = false, dirty = true, playing = false, tPlay = 0, last = null, inView = true;
    var group = null, savedOrbit = null;

    function fetchBuf(url, sig) { return fetch(url, { signal: sig }).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.arrayBuffer(); }); }
    function fetchJSON(url, sig) { return fetch(url, { signal: sig }).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }); }
    function loadTex(url) {
      return new Promise(function (res, rej) { new THREE.TextureLoader().load(url, function (t) { t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); res(t); }, undefined, function () { rej(new Error(url)); }); });
    }

    function meshGeometry(buf, info) {
      var g = new THREE.BufferGeometry(), n = info.n_verts;
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, info.position[0], n * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(buf, info.normal[0], n * 3), 3, true));
      if (info.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Uint16Array(buf, info.uv[0], n * 2), 2, true));
      if (info.color) g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(buf, info.color[0], n * 3), 3, true));
      var idx = info.index_type === 'u32' ? new Uint32Array(buf, info.index[0], info.n_faces * 3) : new Uint16Array(buf, info.index[0], info.n_faces * 3);
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingSphere(); return g;
    }
    function objectMaterial(tex, vertexColors) {
      return new THREE.MeshPhongMaterial({ map: tex || null, vertexColors: !!vertexColors, color: 0xffffff, shininess: 22, specular: 0x1c1c1c, side: THREE.DoubleSide });
    }

    // camera view: a solid edge around each mesh's silhouette (the back faces pushed out along the normals, kept only
    // outside the mesh by the stencil the mesh writes), so the mesh outline can be read against the mask outline
    function rimMaterial(colour) {
      var m = new THREE.MeshBasicMaterial({ color: colour, side: THREE.BackSide, transparent: true, opacity: 1, depthWrite: false, fog: false,
        stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp });
      m.onBeforeCompile = function (sh) {
        sh.uniforms.rimOffset = { value: 0.0018 };
        sh.vertexShader = 'uniform float rimOffset;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\ttransformed += normalize(normal) * rimOffset;');
      };
      return m;
    }

    function disposeGroup(g) {
      if (!g) return;
      g.traverse(function (o) {
        if (o.geometry && o.geometry !== sphereGeo && o.geometry !== cylGeo && o.geometry !== axisGeo) o.geometry.dispose();
        if (o.material && o.userData.ownMaterial) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      });
      scene.remove(g);
    }

    function axisTriad(info) {  // RGB triad at the object's centroid; halo first, coloured on top, always in front (as in the clips)
      var tri = new THREE.Group(); tri.position.fromArray(info.axis_origin); tri.userData.parts = [];
      for (var i = 0; i < 3; i++) {
        var qt = new THREE.Quaternion().setFromUnitVectors(Y, AXES[i]);
        var halo = new THREE.Mesh(axisGeo, mats.halo); halo.quaternion.copy(qt); halo.renderOrder = 20;
        var col = new THREE.Mesh(axisGeo, mats.ax[i]); col.quaternion.copy(qt); col.renderOrder = 21;
        tri.add(halo); tri.add(col); tri.userData.parts.push([halo, col]);
      }
      return tri;
    }
    function setAxisLen(tri, L) {
      tri.userData.parts.forEach(function (p) { p[0].scale.set(0.0022, L + 0.001, 0.0022); p[0].position.set(0, 0, 0); p[1].scale.set(0.0011, L, 0.0011); });
    }

    function buildHand(h) {
      var g = new THREE.Group(), joints = [], bones = [];
      for (var j = 0; j < 21; j++) { var s = new THREE.Mesh(sphereGeo, mats.joint); s.castShadow = true; g.add(s); joints.push(s); }
      clip.meta.hands.edges.forEach(function () { var b = new THREE.Mesh(cylGeo, mats.bone[h]); b.castShadow = true; g.add(b); bones.push(b); });
      return { group: g, joints: joints, bones: bones };
    }

    function frustumLines(meta) {  // OpenCV camera frame: apex + the image corners at depth d
      var K = meta.K, W = meta.image_size[0], H = meta.image_size[1], d = meta.frustum_depth;
      var cs = [[0, 0], [W, 0], [W, H], [0, H]].map(function (p) { return [d * (p[0] - K[2]) / K[0], d * (p[1] - K[5]) / K[4], d]; });
      var v = [];
      cs.forEach(function (c) { v.push(0, 0, 0, c[0], c[1], c[2]); });
      for (var i = 0; i < 4; i++) { var a = cs[i], b = cs[(i + 1) % 4]; v.push(a[0], a[1], a[2], b[0], b[1], b[2]); }
      var up = [[cs[0][0] * 0.3, cs[0][1] * 1.0], [cs[1][0] * 0.3, cs[1][1] * 1.0]], tip = [0, cs[0][1] * 1.35];  // a small "up" triangle above the top edge
      v.push(up[0][0], up[0][1], d, tip[0], tip[1], d, tip[0], tip[1], d, up[1][0], up[1][1], d);
      var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      var ls = new THREE.LineSegments(g, mats.cam); ls.matrixAutoUpdate = false;
      var dot = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: mats.cam.color, fog: false })); dot.userData.ownMaterial = true; dot.scale.setScalar(0.004); ls.add(dot);
      return ls;
    }

    /* ── loading a clip ── */
    var abortCtl = null;
    function loadClip(id) {
      var token = ++loadToken; if (abortCtl) abortCtl.abort(); abortCtl = new AbortController(); var sig = abortCtl.signal;
      setPlaying(false); say('Loading…');
      var base = BASE + id + '/';
      fetchJSON(base + 'meta.json', sig).then(function (meta) {
        var jobs = [fetchBuf(base + meta.files.poses, sig), fetchBuf(base + meta.files.cams, sig), fetchBuf(base + meta.files.joints, sig),
                    fetchBuf(base + meta.files.points, sig), fetchJSON(base + meta.files.contours, sig)];
        var meshes = meta.objects.concat(meta.static_mesh ? [meta.static_mesh] : []);
        meshes.forEach(function (o) { jobs.push(fetchBuf(base + o.file, sig)); jobs.push(o.texture ? loadTex(base + o.texture) : Promise.resolve(null)); });
        return Promise.all(jobs).then(function (r) { return { meta: meta, r: r, meshes: meshes }; });
      }).then(function (res) {
        if (token !== loadToken) return;
        build(id, res.meta, res.r, res.meshes);
      }).catch(function (e) {
        if (token !== loadToken || (e && e.name === 'AbortError')) return;
        say('Could not load this clip.'); console.error(e);
      });
    }

    function build(id, meta, r, meshInfos) {
      disposeGroup(group); group = new THREE.Group(); scene.add(group);
      var T = meta.T, nObj = meta.objects.length;
      clip = { id: id, base: BASE + id + '/', meta: meta, T: T, poses: new Float32Array(r[0]), cams: new Float32Array(r[1]), joints: new Float32Array(r[2]), contours: r[4],
               objects: [], hands: [], atlases: [], camMat: new THREE.Matrix4() };
      var c = meta.floor.center, half = meta.floor.half;
      // table plane: z = 0, as the clips' floor (10 cm checker), lit by one shadow-casting light
      clip.floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * half, 2 * half), mats.floor);
      clip.floorMesh.position.set(c[0], c[1], 0); clip.floorMesh.receiveShadow = true; group.add(clip.floorMesh);
      var n = 2 * half / (2 * meta.floor.square); floorTex.repeat.set(n, n);
      var L = new THREE.Vector3().fromArray(meta.light_dir).normalize();
      sun.target.position.set(c[0], c[1], 0); sun.position.set(c[0] - 1.5 * L.x, c[1] - 1.5 * L.y, -1.5 * L.z);
      var sc = sun.shadow.camera; sc.left = sc.bottom = -0.95 * half; sc.right = sc.top = 0.95 * half; sc.near = 0.3; sc.far = 3.0; sc.updateProjectionMatrix();
      sun.target.updateMatrixWorld();
      // objects
      meshInfos.forEach(function (info, k) {
        var geo = meshGeometry(r[5 + 2 * k], info), tex = r[6 + 2 * k];
        var mesh = new THREE.Mesh(geo, objectMaterial(tex, !!info.color)); mesh.userData.ownMaterial = true; mesh.castShadow = true;
        mesh.matrixAutoUpdate = false; mesh.renderOrder = 1; group.add(mesh);
        if (k < nObj) {
          var tri = axisTriad(info); tri.matrixAutoUpdate = true; var holder = new THREE.Group(); holder.matrixAutoUpdate = false; holder.add(tri); group.add(holder);
          var rim = new THREE.Mesh(geo, rimMaterial(tok('--ho-obj-' + info.label, info.colour))); rim.userData.ownMaterial = true;
          rim.matrixAutoUpdate = false; rim.renderOrder = 2; rim.visible = false; group.add(rim);
          clip.objects.push({ info: info, mesh: mesh, axes: holder, tri: tri, rim: rim });
        } else {  // a static mesh (the peg in ip1073): no pose, edged in teal as in the clip
          var srim = new THREE.Mesh(geo, rimMaterial(tok('--ho-obj-3'))); srim.userData.ownMaterial = true; srim.renderOrder = 2; srim.visible = false; group.add(srim);
          clip.staticMesh = { mesh: mesh, rim: srim, info: { label: 3, colour: '#009688' } };
        }
      });
      // hands
      for (var h = 0; h < 2; h++) { var hd = buildHand(h); group.add(hd.group); clip.hands.push(hd); }
      // static scene points
      var nP = meta.n_points, pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(r[3], 0, nP * 3), 3));
      pg.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(r[3], nP * 12, nP * 3), 3, true));
      clip.points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 2.5 * renderer.getPixelRatio(), sizeAttenuation: false, vertexColors: true }));
      clip.points.userData.ownMaterial = true; group.add(clip.points);
      clip.frustum = frustumLines(meta); group.add(clip.frustum);
      clip.atlases = meta.atlas.files.map(function () { return null; });
      // UI
      slider.max = String(T - 1);
      capEl.textContent = [meta.objects.map(function (o) { return o.name; }).join(' and '), T + ' frames'].join(' · ');
      root.classList.toggle('is-portrait', meta.image_size[1] > meta.image_size[0]);
      inCanvas.style.aspectRatio = meta.image_size[0] + ' / ' + meta.image_size[1];
      resetView();
      say('');
      setFrame(Math.floor((T - 1) / 2));
      applyLayers(); clearColour();
      if (!reduceMotion) setPlaying(true);
    }

    function stopMomentum() {  // drop what is left of a damped drag (OrbitControls clears it on an undamped update)
      var cp = camera.position.clone(), t = controls.target.clone(), qt = camera.quaternion.clone();
      controls.enableDamping = false; controls.update(); controls.enableDamping = !reduceMotion;
      camera.position.copy(cp); controls.target.copy(t); camera.quaternion.copy(qt);
    }
    function resetView() {
      stopMomentum();
      var v = clip.meta.view, aspect = stageAspect();
      var tgt = new THREE.Vector3().fromArray(v.target), eye = new THREE.Vector3().fromArray(v.eye);
      var k = aspect < v.aspect ? Math.min(2.2, v.aspect / aspect) : 1;
      eye = tgt.clone().addScaledVector(eye.sub(tgt), k);
      savedOrbit = { pos: eye, tgt: tgt };                 // the Orbit button comes back to this view
      if (!camView) { camera.position.copy(eye); controls.target.copy(tgt); camera.fov = v.fovy; updateOrbitProjection(); controls.update(); }
      dirty = true;
    }

    /* ── frames ── */
    var tmpM = new THREE.Matrix4(), flipGL = new THREE.Matrix4().makeScale(1, -1, -1), vA = new THREE.Vector3(), vB = new THREE.Vector3(), vD = new THREE.Vector3();
    function setFrame(i) {
      if (!clip) return;
      frame = Math.max(0, Math.min(clip.T - 1, i | 0));
      slider.value = String(frame);
      frameLabel.textContent = (frame + 1) + ' / ' + clip.T;
      var nObj = clip.meta.objects.length;
      clip.objects.forEach(function (o, k) {
        o.mesh.matrix.fromArray(clip.poses, (frame * nObj + k) * 16); o.mesh.matrixWorldNeedsUpdate = true;
        o.axes.matrix.copy(o.mesh.matrix); o.axes.matrixWorldNeedsUpdate = true;
        o.rim.matrix.copy(o.mesh.matrix); o.rim.matrixWorldNeedsUpdate = true;
      });
      var H = clip.meta.hands, J = clip.joints, T = clip.T;
      for (var h = 0; h < 2; h++) {
        var hd = clip.hands[h], ok = H.valid[h].charAt(frame) === '1';
        hd.group.visible = ok && layers.hands;
        if (!ok) continue;
        var base = (h * T + frame) * 63;
        for (var j = 0; j < 21; j++) {
          var rr = (j === 4 || j === 8 || j === 12 || j === 16 || j === 20) ? H.r_tip : H.r_joint;
          hd.joints[j].position.set(J[base + 3 * j], J[base + 3 * j + 1], J[base + 3 * j + 2]); hd.joints[j].scale.setScalar(rr);
        }
        H.edges.forEach(function (e, kk) {
          vA.set(J[base + 3 * e[0]], J[base + 3 * e[0] + 1], J[base + 3 * e[0] + 2]); vB.set(J[base + 3 * e[1]], J[base + 3 * e[1] + 1], J[base + 3 * e[1] + 2]);
          vD.subVectors(vB, vA); var len = Math.max(vD.length(), 1e-6), b = hd.bones[kk];
          var rb = H.r_bone * (kk >= 20 ? H.palm_bone_scale : 1);
          b.position.addVectors(vA, vB).multiplyScalar(0.5); b.quaternion.setFromUnitVectors(Y, vD.divideScalar(len)); b.scale.set(rb, len, rb);
        });
      }
      clip.camMat.fromArray(clip.cams, frame * 16);
      clip.frustum.matrix.copy(clip.camMat); clip.frustum.matrixWorldNeedsUpdate = true;
      if (camView) placeInputCamera();
      requestAtlas(frame);
      drawInputs(); dirty = true;
    }

    /* ── input frames (JPEG atlases, loaded per atlas) ── */
    function requestAtlas(i) {
      var A = clip.meta.atlas, a = Math.floor(i / A.per), r = i % A.per;
      loadAtlas(a);
      if (r >= A.per - 10 && a + 1 < A.files.length) loadAtlas(a + 1);
      if (r < 4 && a > 0) loadAtlas(a - 1);
    }
    function loadAtlas(a) {
      if (clip.atlases[a]) return;
      var c = clip, img = new Image(); c.atlases[a] = { img: img, ready: false };
      img.onload = function () { c.atlases[a].ready = true; if (c === clip && Math.floor(frame / c.meta.atlas.per) === a) drawInputs(); };
      img.onerror = function () { c.atlases[a] = null; };
      img.src = c.base + c.meta.atlas.files[a];
    }
    function frameSource(i) {
      var A = clip.meta.atlas, a = Math.floor(i / A.per), r = i % A.per, at = clip.atlases[a];
      if (!at || !at.ready) return null;
      return { img: at.img, sx: (r % A.cols) * A.frame_w, sy: Math.floor(r / A.cols) * A.frame_h, sw: A.frame_w, sh: A.frame_h };
    }
    function fitCanvas(cv) {
      var dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      return dpr;
    }
    function drawOutlines(ctx, rect, i) {  // rect in canvas pixels; contour points are input-image pixel indices
      var C = clip.contours, W = clip.meta.image_size[0], s = rect.w / W;
      if (!C || !C.polys) return;
      var lw = Math.max(1.5, 2.2 * Math.sqrt(s));
      clip.meta.objects.forEach(function (o) {
        var per = C.polys[String(o.label)]; if (!per || !per[i]) return;
        ctx.beginPath();
        per[i].forEach(function (p) {
          for (var k = 0; k < p.length; k += 2) { var x = rect.x + (p[k] + 0.5) * s, y = rect.y + (p[k + 1] + 0.5) * s; if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
          ctx.closePath();
        });
        ctx.lineJoin = 'round'; ctx.setLineDash([]); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = lw * 2.2; ctx.stroke();
        ctx.setLineDash([lw * 3.5, lw * 2.2]); ctx.strokeStyle = tok('--ho-obj-' + o.label, o.colour); ctx.lineWidth = lw; ctx.stroke(); ctx.setLineDash([]);
      });
    }
    function drawInputs() {
      if (!clip) return;
      // the input panel
      fitCanvas(inCanvas);
      var src = frameSource(frame);
      if (src) {
        inCtx.drawImage(src.img, src.sx, src.sy, src.sw, src.sh, 0, 0, inCanvas.width, inCanvas.height);
        if (layers.outlines) drawOutlines(inCtx, { x: 0, y: 0, w: inCanvas.width, h: inCanvas.height }, frame);
      }
      // the camera view: the frame behind the 3D, the outlines over it
      fitCanvas(bgCanvas); fitCanvas(ovCanvas);
      bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height); ovCtx.clearRect(0, 0, ovCanvas.width, ovCanvas.height);
      if (!camView) return;
      var r = imageRect(), dpr = Math.min(window.devicePixelRatio || 1, 2), R = { x: r.x * dpr, y: r.y * dpr, w: r.w * dpr, h: r.h * dpr };
      if (src) bgCtx.drawImage(src.img, src.sx, src.sy, src.sw, src.sh, R.x, R.y, R.w, R.h);
      if (layers.outlines) drawOutlines(ovCtx, R, frame);
    }

    /* ── views ── */
    function stageAspect() { return Math.max(0.2, stage.clientWidth / Math.max(1, stage.clientHeight)); }
    function imageRect() {  // the input image fitted inside the stage (CSS pixels)
      var W = clip.meta.image_size[0], H = clip.meta.image_size[1], cw = stage.clientWidth, ch = stage.clientHeight, s = Math.min(cw / W, ch / H);
      return { x: (cw - W * s) / 2, y: (ch - H * s) / 2, w: W * s, h: H * s, s: s };
    }
    function updateOrbitProjection() { camera.aspect = stageAspect(); camera.updateProjectionMatrix(); }
    function placeInputCamera() {
      // cams are camera-to-world with OpenCV axes; three.js cameras look down -z with y up: flip y and z
      tmpM.multiplyMatrices(clip.camMat, flipGL);
      tmpM.decompose(camera.position, camera.quaternion, vA); camera.scale.set(1, 1, 1); camera.updateMatrixWorld(true);
      // the projection from K, letterboxed into the stage (pixel centres at integer coordinates, as K is written)
      var K = clip.meta.K, W = clip.meta.image_size[0], H = clip.meta.image_size[1], r = imageRect();
      var sx = r.w / stage.clientWidth, sy = r.h / stage.clientHeight, n = 0.01, f = 30;
      camera.projectionMatrix.set(
        2 * K[0] / W * sx, 0, (1 - 2 * (K[2] + 0.5) / W) * sx, 0,
        0, 2 * K[4] / H * sy, (2 * (K[5] + 0.5) / H - 1) * sy, 0,
        0, 0, -(f + n) / (f - n), -2 * f * n / (f - n),
        0, 0, -1, 0);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      // orbit about the point the camera looks at, at the scene's depth, if the user drags away
      var depth = vA.fromArray(clip.meta.view.target).sub(camera.position).dot(vB.set(0, 0, -1).applyQuaternion(camera.quaternion));
      controls.target.copy(camera.position).addScaledVector(vB, Math.max(0.1, depth));
    }
    function setView(mode, restore) {
      var cam = mode === 'input';
      if (cam === camView && clip) { if (cam) { placeInputCamera(); drawInputs(); dirty = true; } return; }
      camView = cam;
      viewBtns.forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.view === mode ? 'true' : 'false'); });
      hintEl.textContent = cam ? 'Camera view · drag to leave it and orbit' : 'Drag to orbit · right-drag to pan · scroll to zoom';
      if (!clip) return;
      stopMomentum();
      if (cam) { savedOrbit = { pos: camera.position.clone(), tgt: controls.target.clone() }; placeInputCamera(); }
      else {
        // the Orbit button: back to the orbit view left for the camera view; a drag: orbit on from the input camera
        if (restore && savedOrbit) { camera.position.copy(savedOrbit.pos); controls.target.copy(savedOrbit.tgt); camera.fov = clip.meta.view.fovy; }
        else {  // keep the input camera's field of view, so the scene does not jump when a drag starts
          var r = imageRect(), half = Math.atan(clip.meta.image_size[1] / 2 / clip.meta.K[4]);
          camera.fov = Math.max(15, Math.min(90, 2 * Math.atan(Math.tan(half) * stage.clientHeight / r.h) * 180 / Math.PI));
        }
        updateOrbitProjection(); controls.update();
      }
      applyLayers(); clearColour(); drawInputs(); dirty = true;
    }
    viewBtns.forEach(function (b) { b.addEventListener('click', function () { setView(b.dataset.view, true); }); });

    function applyLayers() {
      if (!clip) return;
      clip.objects.concat(clip.staticMesh ? [clip.staticMesh] : []).forEach(function (o) {
        var m = o.mesh.material, oc = tok('--ho-obj-' + o.info.label, o.info.colour);
        // camera view: see-through, tinted with the object's colour, and writing the stencil the edge is kept outside of
        m.transparent = camView; m.opacity = camView ? 0.6 : 1; m.side = camView ? THREE.FrontSide : THREE.DoubleSide;
        m.color.set(0xffffff); if (camView) m.color.lerp(new THREE.Color(oc), 0.4);
        m.stencilWrite = camView; m.stencilRef = 1; m.stencilFunc = THREE.AlwaysStencilFunc; m.stencilZPass = THREE.ReplaceStencilOp; m.needsUpdate = true;
        o.rim.material.color.set(oc); o.rim.visible = camView;
        o.mesh.castShadow = !camView;
        if (o.axes) { o.axes.visible = layers.axes; setAxisLen(o.tri, camView ? o.info.axis_len_input : o.info.axis_len_3d); }
      });
      for (var h = 0; h < 2; h++) clip.hands[h].group.visible = layers.hands && clip.meta.hands.valid[h].charAt(frame) === '1';
      clip.points.visible = layers.points;
      clip.frustum.visible = layers.frustum && !camView;
      clip.floorMesh.visible = !camView;
      drawInputs(); dirty = true;
    }

    /* ── playback ── */
    function setPlaying(on) {
      playing = !!on && !!clip; last = null; tPlay = frame;
      playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      root.classList.toggle('is-paused', !playing);
    }
    playBtn.addEventListener('click', function () { setPlaying(!playing); });
    slider.addEventListener('input', function () { setPlaying(false); setFrame(+slider.value); });
    root.addEventListener('keydown', function (e) {   // within the viewer: space plays / pauses, arrows step a frame
      if (!clip || e.altKey || e.ctrlKey || e.metaKey) return;
      var t = e.target, tag = t && t.tagName, type = t && t.type;
      if (tag === 'SELECT' || (tag === 'INPUT' && type !== 'range' && type !== 'checkbox')) return;
      if (e.key === ' ' || e.code === 'Space') {
        if (tag === 'BUTTON' || (tag === 'INPUT' && type === 'checkbox')) return;   // native activation
        e.preventDefault(); setPlaying(!playing);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (tag === 'INPUT' && type === 'range') return;                         // the slider steps itself
        e.preventDefault(); setPlaying(false); setFrame(frame + (e.key === 'ArrowRight' ? 1 : -1));
      }
    });

    /* ── render loop (idle while the viewer is off screen) ── */
    var size = { w: 0, h: 0 };
    function resize() {
      var w = stage.clientWidth, h = stage.clientHeight;
      if (w === size.w && h === size.h) return;
      size.w = w; size.h = h; renderer.setSize(w, h, false);
      if (clip) { if (camView) placeInputCamera(); else updateOrbitProjection(); }
      drawInputs(); dirty = true;
    }
    new ResizeObserver(function () { resize(); }).observe(stage);
    new ResizeObserver(function () { drawInputs(); }).observe(inCanvas);
    var raf = null;
    function loop(now) {
      raf = null;
      if (!inView) return;
      raf = requestAnimationFrame(loop);
      resize();
      if (playing && clip) {
        if (last !== null) {
          tPlay += Math.min(0.1, (now - last) / 1000) * clip.meta.fps;
          if (tPlay >= clip.T) tPlay -= clip.T;
          if ((tPlay | 0) !== frame) setFrame(tPlay | 0);
        }
        last = now;
      }
      var moved = !camView && controls.update();
      if (clip && !camView) { var dist = camera.position.distanceTo(controls.target); scene.fog.near = dist + 0.5; scene.fog.far = dist + 2.0; }
      if (dirty || moved) { dirty = false; renderer.render(scene, camera); }
    }
    new IntersectionObserver(function (entries) {
      inView = entries[0].isIntersecting; last = null;
      if (inView && raf === null) raf = requestAnimationFrame(loop);
    }).observe(root);

    /* ── clip list ── */
    clearColour();
    raf = requestAnimationFrame(loop);
    fetchJSON(BASE + 'clips.json').then(function (idx) {
      idx.clips.forEach(function (c) {
        var o = document.createElement('option'); o.value = c.id; o.textContent = c.caption || c.id; sel.appendChild(o);
      });
      if (!idx.clips.length) { say('No clips.'); return; }
      sel.addEventListener('change', function () { loadClip(sel.value); });
      // a clip tab above (data-clip) picks the same clip here
      document.querySelectorAll('[role="tab"][data-clip]').forEach(function (tab) {
        tab.addEventListener('click', function () { if (sel.value !== tab.dataset.clip) { sel.value = tab.dataset.clip; loadClip(sel.value); } });
      });
      var picked = document.querySelector('[role="tab"][data-clip][aria-selected="true"]');
      sel.value = picked ? picked.dataset.clip : idx.clips[0].id;
      loadClip(sel.value);
    }).catch(function (e) { say('Could not load the clip list.'); console.error(e); });
  }
})();
