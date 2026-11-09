/* XM4D project page: the 3D viewers (every .viewer element). Each draws one trained run (assets/3d/<key>.bin, written
   by export_viewer.py in the research code) with WebGL 2: its Gaussians as depth-sorted splats, the dynamic ones re-posed
   every frame by the deformation graph (viewer-worker.js poses and sorts them), and over them the graph, the input
   cameras, and 3D tracks of a few dynamic Gaussians. The panel picks the run and what is shown; the view follows the
   input camera until it is dragged. A run with hinged parts (an articulated object: header "parts") is posed by one
   slider per part instead of time.
   A v2 file (export_viewer_v2.py) carries every Gaussian of the trained model and its appearance model: a GPU pass
   evaluates the colour MLP per Gaussian for the shown frame and eye (embedding of frame t, features, view direction),
   and the splats are drawn as gsplat's classic rasteriser draws them (0.3 px dilation, opacity-aware support, alpha
   clamped to 0.999, the frustum-clamped Jacobian, the camera's principal point), accumulated in a float target, so the
   input-camera view reproduces the eval's render of that frame (measure_viewer.py measures it). */
(function () {
  'use strict';

  document.querySelectorAll('.viewer').forEach(Viewer);

  function Viewer(root) {
  var canvas = root.querySelector('.viewer-canvas');
  var status = root.querySelector('.viewer-status');
  var select = root.querySelector('.viewer-scene') || (root.id ? document.querySelector('.viewer-scene[data-for="' + root.id + '"]') : null);
  var playBtn = root.querySelector('.viewer-play');
  var slider = root.querySelector('.viewer-slider');
  var frameLabel = root.querySelector('.viewer-frame');
  var partsBox = root.querySelector('.viewer-parts');
  var viewBtns = Array.prototype.slice.call(root.querySelectorAll('[data-view]'));
  var trackBox = root.querySelector('[data-layer="tracks"]');
  var layers = {};
  root.querySelectorAll('[data-layer]').forEach(function (box) {
    layers[box.dataset.layer] = box.checked;
    box.addEventListener('change', function () { layers[box.dataset.layer] = box.checked; dirty = true; requestSort(); });
  });

  function say(text) { status.textContent = text; status.hidden = !text; }

  /* ── small math (column-major 4x4 for GL; 3x3 row-major for camera rotations) ── */
  function normalize(v) { var n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; }
  function axisAngle(a, t) {  // row-major rotation about unit axis a
    var c = Math.cos(t), s = Math.sin(t), C = 1 - c, x = a[0], y = a[1], z = a[2];
    return [c + x * x * C, x * y * C - z * s, x * z * C + y * s,
            y * x * C + z * s, c + y * y * C, y * z * C - x * s,
            z * x * C - y * s, z * y * C + x * s, c + z * z * C];
  }
  function mul3(A, B) {
    var o = new Array(9);
    for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
    return o;
  }
  function apply3(A, v) { return [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]]; }
  function col(R, j) { return [R[j], R[3 + j], R[6 + j]]; }
  function viewMatrix(R, c) {  // world -> camera (OpenCV), from camera-to-world rotation R (row-major) and centre c
    var t = [-(R[0] * c[0] + R[3] * c[1] + R[6] * c[2]), -(R[1] * c[0] + R[4] * c[1] + R[7] * c[2]), -(R[2] * c[0] + R[5] * c[1] + R[8] * c[2])];
    return new Float32Array([R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, t[0], t[1], t[2], 1]);
  }
  function projMatrix(I, w, h) {  // OpenCV camera (+z ahead, y down), intrinsics I (px) on a w x h target
    var n = 0.01, f = 1000;
    return new Float32Array([2 * I.fx / w, 0, 0, 0, 0, -2 * I.fy / h, 0, 0, 2 * I.cx / w - 1, 1 - 2 * I.cy / h, f / (f - n), 1, 0, 0, -(f * n) / (f - n), 0]);
  }
  function mul4(A, B) {
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) o[c * 4 + r] = A[r] * B[c * 4] + A[4 + r] * B[c * 4 + 1] + A[8 + r] * B[c * 4 + 2] + A[12 + r] * B[c * 4 + 3];
    return o;
  }
  function quatFromR(R) {  // row-major rotation -> [x, y, z, w]
    var t = R[0] + R[4] + R[8], x, y, z, w, s;
    if (t > 0) { s = Math.sqrt(t + 1) * 2; w = s / 4; x = (R[7] - R[5]) / s; y = (R[2] - R[6]) / s; z = (R[3] - R[1]) / s; }
    else if (R[0] > R[4] && R[0] > R[8]) { s = Math.sqrt(1 + R[0] - R[4] - R[8]) * 2; w = (R[7] - R[5]) / s; x = s / 4; y = (R[1] + R[3]) / s; z = (R[2] + R[6]) / s; }
    else if (R[4] > R[8]) { s = Math.sqrt(1 + R[4] - R[0] - R[8]) * 2; w = (R[2] - R[6]) / s; x = (R[1] + R[3]) / s; y = s / 4; z = (R[5] + R[7]) / s; }
    else { s = Math.sqrt(1 + R[8] - R[0] - R[4]) * 2; w = (R[3] - R[1]) / s; x = (R[2] + R[6]) / s; y = (R[5] + R[7]) / s; z = s / 4; }
    return [x, y, z, w];
  }
  function quatToR(q) {
    var x = q[0], y = q[1], z = q[2], w = q[3];
    return [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
            2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
            2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
  }
  function nlerp(a, b, s) {
    var d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], g = d < 0 ? -1 : 1;
    var q = [0, 1, 2, 3].map(function (i) { return a[i] * (1 - s) + g * b[i] * s; }), n = Math.hypot(q[0], q[1], q[2], q[3]);
    return q.map(function (v) { return v / n; });
  }

  /* ── binary scene file (see export_viewer.py) ── */
  var HALF = new Float32Array(65536);
  (function () {
    for (var h = 0; h < 65536; h++) {
      var s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
      HALF[h] = e === 0 ? s * f * Math.pow(2, -24) : e === 31 ? (f ? NaN : s * Infinity) : s * (1 + f / 1024) * Math.pow(2, e - 15);
    }
  })();
  var TYPES = { float32: Float32Array, uint8: Uint8Array, int8: Int8Array, uint16: Uint16Array, float16: Uint16Array };
  function parse(buf) {
    var head = new Uint8Array(buf, 0, 8);
    if (String.fromCharCode(head[0], head[1], head[2], head[3]) !== 'XM4D') throw new Error('not a scene file');
    var hl = new DataView(buf).getUint32(4, true);
    var hdr = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl)));
    var A = {};
    Object.keys(hdr.arrays).forEach(function (k) {
      var a = hdr.arrays[k], n = a.shape.reduce(function (x, y) { return x * y; }, 1);
      var v = new TYPES[a.dtype](buf, 8 + hl + a.offset, n);
      if (a.dtype === 'float16') { var f = new Float32Array(n); for (var i = 0; i < n; i++) f[i] = HALF[v[i]]; v = f; }
      A[k] = v;
    });
    return { hdr: hdr, A: A };
  }

  /* ── GL ── */
  var gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: true });
  if (!gl) { say('This viewer needs WebGL 2, which this browser does not provide.'); return; }

  function program(vs, fs) {
    function sh(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { p: p, u: u, a: function (name) { return gl.getAttribLocation(p, name); } };
  }

  // splats: 3 texels per Gaussian (512 per row): centre xyz + rgba8 (rgb: baked colour, a: opacity), covariance
  // xx xy xz yy, covariance yz zz. Projected as gsplat's classic rasteriser does (persp_proj + add_blur + the
  // opacity-aware box): the Jacobian at the frustum-clamped centre, +0.3 px on the diagonal, support where
  // alpha = min(0.999, o exp(-sigma)) >= 1/255, culled by its box against the image. Colour from the appearance pass
  // (u_col) when the run has one. Pixel coordinates are the camera's (y down), with the principal point u_K.zw.
  var SPLAT_VS = '#version 300 es\n' +
    'precision highp float; precision highp int; precision highp usampler2D; precision highp sampler2D;\n' +
    'uniform usampler2D u_tex; uniform sampler2D u_col; uniform bool u_app; uniform mat4 u_view; uniform vec4 u_K; uniform vec2 u_viewport;\n' +
    'uniform int u_nDyn; uniform bool u_static, u_dyn;\n' +
    'in vec2 a_corner; in uint a_index; out vec4 v_color; flat out vec3 v_conic; flat out vec2 v_mean;\n' +
    'void main() {\n' +
    '  int i = int(a_index); bool dyn = i < u_nDyn;\n' +
    '  gl_Position = vec4(0., 0., 2., 1.);\n' +
    '  if (dyn ? !u_dyn : !u_static) return;\n' +
    '  ivec2 b = ivec2((i & 511) * 3, i >> 9);\n' +
    '  uvec4 t0 = texelFetch(u_tex, b, 0);\n' +
    '  vec3 c = (u_view * vec4(uintBitsToFloat(t0.xyz), 1.)).xyz;\n' +
    '  float op = float(t0.w >> 24) / 255.;\n' +
    '  if (c.z < 0.01 || op < 1. / 255.) return;\n' +
    '  vec4 c1 = uintBitsToFloat(texelFetch(u_tex, b + ivec2(1, 0), 0));\n' +
    '  vec2 c2 = uintBitsToFloat(texelFetch(u_tex, b + ivec2(2, 0), 0).xy);\n' +
    '  mat3 V = mat3(c1.x, c1.y, c1.z, c1.y, c1.w, c2.x, c1.z, c2.x, c2.y), Rv = mat3(u_view), Vc = Rv * V * transpose(Rv);\n' +
    '  float fx = u_K.x, fy = u_K.y, cx = u_K.z, cy = u_K.w, W = u_viewport.x, H = u_viewport.y, rz = 1. / c.z;\n' +
    '  float tx = c.z * min((W - cx) / fx + 0.15 * W / fx, max(-(cx / fx + 0.15 * W / fx), c.x * rz));\n' +
    '  float ty = c.z * min((H - cy) / fy + 0.15 * H / fy, max(-(cy / fy + 0.15 * H / fy), c.y * rz));\n' +
    '  vec3 j0 = vec3(fx * rz, 0., -fx * tx * rz * rz), j1 = vec3(0., fy * rz, -fy * ty * rz * rz);\n' +
    '  vec3 v0 = Vc * j0, v1 = Vc * j1;\n' +
    '  float A = dot(j0, v0) + 0.3, B = dot(j0, v1), D = dot(j1, v1) + 0.3, det = A * D - B * B;\n' +
    '  if (det <= 0.) return;\n' +
    '  vec2 m = vec2(fx * c.x * rz + cx, fy * c.y * rz + cy);\n' +
    '  float ext = min(3.33, sqrt(2. * log(op * 255.)));\n' +
    '  vec2 rad = ceil(ext * sqrt(vec2(A, D)));\n' +
    '  if (m.x + rad.x <= 0. || m.x - rad.x >= W || m.y + rad.y <= 0. || m.y - rad.y >= H) return;\n' +
    '  float mid = 0.5 * (A + D), r = length(vec2(0.5 * (A - D), B)), l1 = mid + r, l2 = max(mid - r, 0.);\n' +
    '  vec2 e = abs(B) > 1e-9 * mid ? normalize(vec2(B, l1 - A)) : (A >= D ? vec2(1., 0.) : vec2(0., 1.));\n' +
    '  vec2 p = m + ext * (a_corner.x * sqrt(l1) * e + a_corner.y * sqrt(l2) * vec2(-e.y, e.x)) + a_corner;\n' +   // + 1 px: the pixel centres on the support's edge
    '  uint k = t0.w;\n' +
    '  vec3 rgb = u_app ? texelFetch(u_col, ivec2(i & 511, i >> 9), 0).rgb : vec3(float(k & 255u), float((k >> 8) & 255u), float((k >> 16) & 255u)) / 255.;\n' +
    '  v_color = vec4(rgb, op); v_conic = vec3(D, -B, A) / det; v_mean = m;\n' +
    '  gl_Position = vec4(2. * p.x / W - 1., 1. - 2. * p.y / H, 0., 1.);\n' +
    '}';
  var SPLAT_FS = '#version 300 es\nprecision highp float;\nuniform vec2 u_viewport;\nin vec4 v_color; flat in vec3 v_conic; flat in vec2 v_mean; out vec4 o;\n' +
    'void main() {\n' +
    '  vec2 d = v_mean - vec2(gl_FragCoord.x, u_viewport.y - gl_FragCoord.y);\n' +
    '  float s = 0.5 * (v_conic.x * d.x * d.x + v_conic.z * d.y * d.y) + v_conic.y * d.x * d.y;\n' +
    '  float a = min(0.999, v_color.a * exp(-s));\n' +
    '  if (s < 0. || a < 1. / 255.) discard;\n' +
    '  o = vec4(a * v_color.rgb, a);\n' +
    '}';

  // the appearance pass (v2 runs): one fragment per Gaussian (512 per row) evaluates the trained colour MLP,
  // sigmoid(MLP([embedding, features, SH bases of the view direction]) + colour logit), as AppearanceOptModule does.
  // The embedding's (and the features' offset) share of the first layer is a per-frame bias (u_bs static, u_bd
  // dynamic: they differ in split0 mode); the weights are 4x4 blocks in uniform blocks (see appSetup).
  function appSource(NB, NF, NH) {  // NB output blocks of 4 (width/4), NF feature blocks of 4, NH hidden layers
    var s = '#version 300 es\nprecision highp float; precision highp int; precision highp usampler2D;\n' +
      'uniform usampler2D u_tex, u_app; uniform int u_n, u_nDyn; uniform vec3 u_eye; uniform vec4 u_bs[' + NB + '], u_bd[' + NB + '];\n' +
      'layout(std140) uniform First { mat4 W1[' + (NF + 1) * NB + ']; mat4 W3[' + NB + ']; vec4 BH[' + NH * NB + ']; vec4 B3; };\n';
    for (var h = 0; h < NH; h++) s += 'layout(std140) uniform Hid' + h + ' { mat4 H' + h + '[' + NB * NB + ']; };\n';
    s += 'out vec4 o;\nvoid main() {\n' +
      '  ivec2 q = ivec2(gl_FragCoord.xy); int i = q.y * 512 + q.x;\n' +
      '  if (i >= u_n) { o = vec4(0.); return; }\n' +
      '  ivec2 b = ivec2(q.x * ' + (NF / 4 + 1) + ', q.y);\n' +
      '  vec3 pos = uintBitsToFloat(texelFetch(u_tex, ivec2(q.x * 3, q.y), 0).xyz);\n' +
      '  vec3 d = normalize(pos - u_eye);\n' +
      '  vec4 x[' + (NF + 1) + '];\n' +
      '  for (int t = 0; t < ' + NF / 4 + '; t++) {\n' +
      '    uvec4 u = texelFetch(u_app, b + ivec2(t, 0), 0);\n' +
      '    for (int c = 0; c < 4; c++) x[t * 4 + c] = vec4(u[c] & 255u, (u[c] >> 8) & 255u, (u[c] >> 16) & 255u, u[c] >> 24);\n' +
      '  }\n' +
      '  x[' + NF + '] = vec4(0.28209479177387814, -0.48860251190292 * d.y, 0.48860251190292 * d.z, -0.48860251190292 * d.x);\n' +
      '  vec3 clog = uintBitsToFloat(texelFetch(u_app, b + ivec2(' + NF / 4 + ', 0), 0).xyz);\n' +
      '  bool dyn = i < u_nDyn; vec4 h[' + NB + '], g[' + NB + '];\n' +
      '  for (int k = 0; k < ' + NB + '; k++) h[k] = dyn ? u_bd[k] : u_bs[k];\n' +
      '  for (int j = 0; j < ' + (NF + 1) + '; j++) for (int k = 0; k < ' + NB + '; k++) h[k] += W1[j * ' + NB + ' + k] * x[j];\n' +
      '  for (int k = 0; k < ' + NB + '; k++) h[k] = max(h[k], 0.);\n';
    for (h = 0; h < NH; h++) {
      s += '  for (int k = 0; k < ' + NB + '; k++) g[k] = BH[' + h * NB + ' + k];\n' +
        '  for (int j = 0; j < ' + NB + '; j++) for (int k = 0; k < ' + NB + '; k++) g[k] += H' + h + '[j * ' + NB + ' + k] * h[j];\n' +
        '  for (int k = 0; k < ' + NB + '; k++) h[k] = max(g[k], 0.);\n';
    }
    s += '  vec4 y = B3;\n  for (int j = 0; j < ' + NB + '; j++) y += W3[j] * h[j];\n' +
      '  o = vec4(1. / (1. + exp(-(y.xyz + clog))), 1.);\n}';
    return s;
  }
  var FULL_VS = '#version 300 es\nvoid main() { gl_Position = vec4(float((gl_VertexID & 1) * 4 - 1), float((gl_VertexID >> 1) * 4 - 1), 0., 1.); }';
  var COPY_FS = '#version 300 es\nprecision highp float; uniform sampler2D u_img; out vec4 o;\nvoid main() { o = texelFetch(u_img, ivec2(gl_FragCoord.xy), 0); }';

  // screen-space thick segments, clipped at the near plane
  var LINE_VS = '#version 300 es\nprecision highp float;\n' +
    'uniform mat4 u_vp; uniform vec2 u_viewport;\n' +
    'in vec2 a_corner; in vec3 a_a, a_b; in vec4 a_color; in float a_width; out vec4 v_color; out float v_side; out float v_w;\n' +
    'void main() {\n' +
    '  vec4 p = u_vp * vec4(a_a, 1.), q = u_vp * vec4(a_b, 1.); float e = 0.02;\n' +
    '  gl_Position = vec4(0., 0., 2., 1.);\n' +
    '  if (p.w < e && q.w < e) return;\n' +
    '  if (p.w < e) p = mix(p, q, (e - p.w) / (q.w - p.w)); else if (q.w < e) q = mix(q, p, (e - q.w) / (p.w - q.w));\n' +
    '  vec2 h = 0.5 * u_viewport, s = p.xy / p.w * h, t = q.xy / q.w * h, d = t - s;\n' +
    '  float L = length(d); vec2 u = L > 1e-4 ? d / L : vec2(1., 0.), n = vec2(-u.y, u.x);\n' +
    '  float w = a_width + 1.;\n' +
    '  vec2 at = mix(s, t, a_corner.x) + n * a_corner.y * 0.5 * w + u * (2. * a_corner.x - 1.) * 0.5 * a_width;\n' +
    '  gl_Position = vec4(at / h, 0., 1.); v_color = a_color; v_side = a_corner.y; v_w = w;\n' +
    '}';
  var LINE_FS = '#version 300 es\nprecision highp float;\nin vec4 v_color; in float v_side; in float v_w; out vec4 o;\n' +
    'void main() { float a = v_color.a * clamp((1. - abs(v_side)) * 0.5 * v_w, 0., 1.); o = vec4(v_color.rgb * a, a); }';

  // round dots with a white rim
  var DOT_VS = '#version 300 es\nprecision highp float;\n' +
    'uniform mat4 u_vp; uniform vec2 u_viewport;\n' +
    'in vec2 a_corner; in vec3 a_p; in vec4 a_color; in float a_size; out vec4 v_color; out vec2 v_c; out float v_r;\n' +
    'void main() {\n' +
    '  vec4 p = u_vp * vec4(a_p, 1.); gl_Position = vec4(0., 0., 2., 1.);\n' +
    '  if (p.w < 0.02) return;\n' +
    '  float R = 0.5 * a_size + 1.;\n' +
    '  gl_Position = vec4(p.xy / p.w + a_corner * 2. * R / u_viewport, 0., 1.); v_color = a_color; v_c = a_corner; v_r = R;\n' +
    '}';
  var DOT_FS = '#version 300 es\nprecision highp float;\nin vec4 v_color; in vec2 v_c; in float v_r; out vec4 o;\n' +
    'void main() {\n' +
    '  float d = length(v_c) * v_r, rim = v_r - 1., fill = rim - max(1.2, 0.18 * rim);\n' +
    '  float a = clamp(rim - d + 0.5, 0., 1.) * v_color.a; if (a <= 0.) discard;\n' +
    '  vec3 c = mix(vec3(1.), v_color.rgb, clamp(fill - d + 0.5, 0., 1.)); o = vec4(c * a, a);\n' +
    '}';

  var splatP, lineP, dotP, copyP;
  try { splatP = program(SPLAT_VS, SPLAT_FS); lineP = program(LINE_VS, LINE_FS); dotP = program(DOT_VS, DOT_FS); copyP = program(FULL_VS, COPY_FS); }
  catch (err) { say('The viewer could not start: ' + err.message); return; }

  function quad(corners) { var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(corners), gl.STATIC_DRAW); return b; }
  var splatQuad = quad([-1, -1, 1, -1, 1, 1, -1, 1]);
  var lineQuad = quad([0, -1, 1, -1, 1, 1, 0, 1]);
  var dotQuad = quad([-1, -1, 1, -1, 1, 1, -1, 1]);

  var splatVao = gl.createVertexArray(), orderBuf = gl.createBuffer();
  gl.bindVertexArray(splatVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, splatQuad);
  gl.enableVertexAttribArray(splatP.a('a_corner')); gl.vertexAttribPointer(splatP.a('a_corner'), 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, orderBuf);
  gl.enableVertexAttribArray(splatP.a('a_index')); gl.vertexAttribIPointer(splatP.a('a_index'), 1, gl.UNSIGNED_INT, 0, 0);
  gl.vertexAttribDivisor(splatP.a('a_index'), 1);

  function instanced(P, quadBuf, fields) {  // fields: [name, size] interleaved per instance
    var vao = gl.createVertexArray(), buf = gl.createBuffer(), stride = fields.reduce(function (s, f) { return s + f[1]; }, 0);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(P.a('a_corner')); gl.vertexAttribPointer(P.a('a_corner'), 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    var off = 0;
    fields.forEach(function (f) {
      var loc = P.a(f[0]);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, f[1], gl.FLOAT, false, stride * 4, off * 4); gl.vertexAttribDivisor(loc, 1);
      off += f[1];
    });
    return { vao: vao, buf: buf, stride: stride };
  }
  var lineV = instanced(lineP, lineQuad, [['a_a', 3], ['a_b', 3], ['a_color', 4], ['a_width', 1]]);
  var dotV = instanced(dotP, dotQuad, [['a_p', 3], ['a_color', 4], ['a_size', 1]]);
  gl.bindVertexArray(null);
  var tex = gl.createTexture(), emptyVao = gl.createVertexArray();

  // a float target for the splats (8-bit blending of hundreds of layers drifts), then copied to the canvas
  var floatOK = !!gl.getExtension('EXT_color_buffer_float'), blend32 = floatOK && !!gl.getExtension('EXT_float_blend');
  var acc = { fb: null, tex: null, w: 0, h: 0, fmt: floatOK ? (blend32 ? 'RGBA32F' : 'RGBA16F') : 'canvas' };
  function accTarget(w, h) {
    if (!floatOK) return null;
    if (acc.w !== w || acc.h !== h) {
      if (acc.tex) gl.deleteTexture(acc.tex);
      if (!acc.fb) acc.fb = gl.createFramebuffer();
      acc.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, acc.tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, blend32 ? gl.RGBA32F : gl.RGBA16F, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, acc.tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { floatOK = false; acc.fmt = 'canvas'; gl.bindFramebuffer(gl.FRAMEBUFFER, null); return null; }
      acc.w = w; acc.h = h;
    }
    return acc.fb;
  }

  /* ── appearance (v2 runs): per-Gaussian features + colour logits in a texture, the MLP in uniform blocks ── */
  var appTex = gl.createTexture(), colTex = gl.createTexture(), colFb = gl.createFramebuffer(), appUbo = [], appProgs = {};
  function appSetup(sc, n) {  // false when this run has no appearance model (v1 file) or this GPU cannot run it
    var h = sc.hdr, A = sc.A, ap = h.app;
    if (!ap || !A.s_feat || !A.app_w) return false;
    var L = ap.layers, E = ap.embed_dim, F = ap.feat_dim, nSH = (ap.sh_degree + 1) * (ap.sh_degree + 1), Wd = L[0][0], NB = Wd / 4, NF = F / 4, NH = L.length - 2;
    var ok = Wd % 4 === 0 && F % 16 === 0 && nSH <= 4 && L[0][1] === E + F + nSH && L[L.length - 1][0] === 3 && NH >= 0 &&
      L.slice(1, -1).every(function (l) { return l[0] === Wd && l[1] === Wd; }) && L[L.length - 1][1] === Wd &&
      Wd * Wd * 4 <= gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE) && ((NF + 1) * NB * 16 + NB * 16 + (NH * NB + 1) * 4) * 4 <= gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE);
    if (!ok) { console.warn('viewer: appearance model not supported here; baked colours'); return false; }
    var key = NB + ',' + NF + ',' + NH, P = appProgs[key];
    if (!P) {
      try { P = appProgs[key] = program(FULL_VS, appSource(NB, NF, NH)); }
      catch (err) { console.warn('viewer: appearance pass failed to compile; baked colours', err); return false; }
      gl.uniformBlockBinding(P.p, gl.getUniformBlockIndex(P.p, 'First'), 0);
      for (var hh = 0; hh < NH; hh++) gl.uniformBlockBinding(P.p, gl.getUniformBlockIndex(P.p, 'Hid' + hh), 1 + hh);
    }
    // weights: [W (out x in, row-major), b] per layer
    var w = A.app_w, off = 0, Ws = [], Bs = [];
    L.forEach(function (l) { Ws.push(w.subarray(off, off + l[0] * l[1])); off += l[0] * l[1]; Bs.push(w.subarray(off, off + l[0])); off += l[0]; });
    var lo = A.feat_lo, hi = A.feat_hi, In = L[0][1];
    // first layer, features (dequantised: lo + q (hi - lo) / 255) and SH bases, as 4x4 blocks: block (j, k) column c = input 4j+c, row r = output 4k+r
    var first = new Float32Array(((NF + 1) * NB * 16 + NB * 16 + (NH * NB + 1) * 4)), j, k, c, r;
    for (j = 0; j <= NF; j++) for (k = 0; k < NB; k++) for (c = 0; c < 4; c++) for (r = 0; r < 4; r++) {
      var jin = 4 * j + c, o = 4 * k + r, v = 0;
      if (jin < F) v = Ws[0][o * In + E + jin] * (hi[jin] - lo[jin]) / 255;
      else if (jin - F < nSH) v = Ws[0][o * In + E + jin];
      first[((j * NB + k) * 4 + c) * 4 + r] = v;
    }
    var o3 = (NF + 1) * NB * 16, last = Ws[L.length - 1];
    for (j = 0; j < NB; j++) for (c = 0; c < 4; c++) for (r = 0; r < 3; r++) first[o3 + (j * 4 + c) * 4 + r] = last[r * Wd + 4 * j + c];
    var ob = o3 + NB * 16;
    for (hh = 0; hh < NH; hh++) first.set(Bs[1 + hh], ob + hh * Wd);
    first.set(Bs[L.length - 1], ob + NH * Wd);
    var ubos = [first];
    for (hh = 0; hh < NH; hh++) {
      var Hm = new Float32Array(NB * NB * 16), Wh = Ws[1 + hh];
      for (j = 0; j < NB; j++) for (k = 0; k < NB; k++) for (c = 0; c < 4; c++) for (r = 0; r < 4; r++) Hm[((j * NB + k) * 4 + c) * 4 + r] = Wh[(4 * k + r) * Wd + 4 * j + c];
      ubos.push(Hm);
    }
    ubos.forEach(function (u, i) {
      if (!appUbo[i]) appUbo[i] = gl.createBuffer();
      gl.bindBuffer(gl.UNIFORM_BUFFER, appUbo[i]); gl.bufferData(gl.UNIFORM_BUFFER, u, gl.STATIC_DRAW);
    });
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);
    // per frame: the first layer's bias + its embedding share + the features' offset (lo)
    var T = h.n_frames, Em = A.app_embed, bias = new Float32Array(T * Wd);
    for (var f = 0; f < T; f++) for (o = 0; o < Wd; o++) {
      var acc0 = Bs[0][o], row = o * In;
      for (var e = 0; e < E; e++) acc0 += Ws[0][row + e] * Em[f * E + e];
      for (j = 0; j < F; j++) acc0 += Ws[0][row + E + j] * lo[j];
      bias[f * Wd + o] = acc0;
    }
    // per Gaussian (dynamic first, as everywhere): NF/4 texels of uint8 features, then the colour logits (float32)
    var rows = Math.ceil(n / 512), per = NF / 4 + 1, data = new Uint32Array(rows * 512 * per * 4), u8 = new Uint8Array(data.buffer), f32 = new Float32Array(data.buffer);
    var nD = h.n_dyn;
    for (var i = 0; i < n; i++) {
      var dyn = i < nD, ii = dyn ? i : i - nD, fe = dyn ? A.d_feat : A.s_feat, cl = dyn ? A.d_clog : A.s_clog, base = i * per * 4;
      u8.set(fe.subarray(ii * F, ii * F + F), base * 4);
      f32[base + (per - 1) * 4] = cl[ii * 3]; f32[base + (per - 1) * 4 + 1] = cl[ii * 3 + 1]; f32[base + (per - 1) * 4 + 2] = cl[ii * 3 + 2];
    }
    gl.bindTexture(gl.TEXTURE_2D, appTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, 512 * per, rows, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, data);
    gl.bindTexture(gl.TEXTURE_2D, colTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, floatOK ? gl.RGBA16F : gl.RGBA8, 512, rows, 0, gl.RGBA, floatOK ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, colFb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colTex, 0);
    var good = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!good) { console.warn('viewer: no colour target for the appearance pass; baked colours'); return false; }
    return { P: P, n: n, rows: rows, Wd: Wd, NB: NB, NH: NH, bias: bias, mode: ap.mode || 'base', key: null };
  }
  function appPass(app, tt, eye) {  // colours of every Gaussian at time tt seen from eye (cached until either changes)
    var key = tt + ',' + eye.join(',');
    if (app.key === key) return;
    app.key = key;
    var T = scene.T, f = Math.max(0, Math.min(T - 1, Math.floor(tt))), g = Math.min(f + 1, T - 1), a = tt - f, Wd = app.Wd;
    var bd = new Float32Array(Wd), bs = new Float32Array(Wd);
    for (var o = 0; o < Wd; o++) {
      bd[o] = app.bias[f * Wd + o] * (1 - a) + app.bias[g * Wd + o] * a;
      bs[o] = app.mode === 'split0' ? app.bias[o] : bd[o];   // split0 (NVIDIA): the static scene keeps frame 0's embedding
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, colFb); gl.viewport(0, 0, 512, app.rows); gl.disable(gl.BLEND);
    gl.useProgram(app.P.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(app.P.u.u_tex, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, appTex); gl.uniform1i(app.P.u.u_app, 1);
    gl.uniform1i(app.P.u.u_n, app.n); gl.uniform1i(app.P.u.u_nDyn, scene.hdr.n_dyn); gl.uniform3f(app.P.u.u_eye, eye[0], eye[1], eye[2]);
    gl.uniform4fv(app.P.u['u_bs[0]'], bs); gl.uniform4fv(app.P.u['u_bd[0]'], bd);
    for (var i = 0; i <= app.NH; i++) gl.bindBufferBase(gl.UNIFORM_BUFFER, i, appUbo[i]);
    gl.bindVertexArray(emptyVao); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /* ── scene ── */
  var scene = null, worker = new Worker('viewer-worker.js'), sceneId = 0;
  var order = null, nDraw = 0, texData = null, rowsDyn = 0, shownT = 0;

  function uploadScene(sc) {
    var h = sc.hdr, A = sc.A, nD = h.n_dyn, nS = h.n_static, n = nD + nS, rows = Math.ceil(n / 512);
    var lo = h.log_scale[0], hi = h.log_scale[1];
    texData = new Uint32Array(rows * 512 * 3 * 4);
    var f32 = new Float32Array(texData.buffer), sPos = new Float32Array(nS * 3), ch = A.s_chunk;
    for (var i = 0; i < n; i++) {
      var dyn = i < nD, j = dyn ? i : i - nD;
      var sc3 = dyn ? A.d_scale : A.s_scale, qa = dyn ? A.d_quat : A.s_quat, ca = dyn ? A.d_rgba : A.s_rgba, b = i * 12;
      if (!dyn) {  // uint16 within its chunk's box (256 Gaussians per chunk)
        var c6 = (j >> 8) * 6;
        for (var a = 0; a < 3; a++) sPos[j * 3 + a] = f32[b + a] = ch[c6 + a] + A.s_pos[j * 3 + a] / 65535 * (ch[c6 + 3 + a] - ch[c6 + a]);
      }
      texData[b + 3] = ca[j * 4] | (ca[j * 4 + 1] << 8) | (ca[j * 4 + 2] << 16) | (ca[j * 4 + 3] << 24);
      var s0 = Math.exp(lo + sc3[j * 3] / 255 * (hi - lo)), s1 = Math.exp(lo + sc3[j * 3 + 1] / 255 * (hi - lo)), s2 = Math.exp(lo + sc3[j * 3 + 2] / 255 * (hi - lo));
      var w = qa[j * 4], x = qa[j * 4 + 1], y = qa[j * 4 + 2], z = qa[j * 4 + 3], qn = Math.hypot(w, x, y, z) || 1;
      w /= qn; x /= qn; y /= qn; z /= qn;
      var R = quatToR([x, y, z, w]);
      var m = [R[0] * s0, R[1] * s1, R[2] * s2, R[3] * s0, R[4] * s1, R[5] * s2, R[6] * s0, R[7] * s1, R[8] * s2];
      f32[b + 4] = m[0] * m[0] + m[1] * m[1] + m[2] * m[2];
      f32[b + 5] = m[0] * m[3] + m[1] * m[4] + m[2] * m[5];
      f32[b + 6] = m[0] * m[6] + m[1] * m[7] + m[2] * m[8];
      f32[b + 7] = m[3] * m[3] + m[4] * m[4] + m[5] * m[5];
      f32[b + 8] = m[3] * m[6] + m[4] * m[7] + m[5] * m[8];
      f32[b + 9] = m[6] * m[6] + m[7] * m[7] + m[8] * m[8];
    }
    rowsDyn = Math.ceil(nD / 512);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, 512 * 3, rows, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, texData);
    return sPos;
  }

  function setupScene(sc, withTracks) {
    var h = sc.hdr, A = sc.A, T = h.n_frames, M = h.n_nodes;
    sceneId++;
    order = null; nDraw = 0; shownT = 0;
    var sPos = uploadScene(sc);
    var w = new Float32Array(A.d_w.length);
    for (var i = 0; i < w.length; i++) w[i] = A.d_w[i] / 255;
    for (i = 0; i < h.n_dyn; i++) {  // renormalise the quantised weights
      var s = 0, k;
      for (k = 0; k < h.k; k++) s += w[i * h.k + k];
      for (k = 0; k < h.k; k++) w[i * h.k + k] /= s || 1;
    }
    var dNode = A.d_node instanceof Uint8Array ? new Uint16Array(A.d_node) : A.d_node;
    worker.postMessage({ type: 'scene', id: sceneId, nDyn: h.n_dyn, nStatic: h.n_static, k: h.k, nNodes: M, nFrames: T,
      sPos: sPos, dNode: dNode, dW: w, dRel: A.d_rel, nPos: A.n_pos, nRot: A.n_rot });

    // cameras: centre and rotation per frame
    var cams = [];
    for (var f = 0; f < T; f++) {
      var c = A.cams.subarray(f * 12, f * 12 + 12), R = [c[0], c[1], c[2], c[4], c[5], c[6], c[8], c[9], c[10]];
      cams.push({ R: R, c: [c[3], c[7], c[11]], q: quatFromR(R) });
    }
    scene = { hdr: h, A: A, T: T, M: M, cams: cams, w: w, dNode: dNode, pingpong: T <= 24 };
    scene.app = appSetup(sc, h.n_dyn + h.n_static);
    // focus: the graph's centroid at frame 0, at its depth along camera 0's axis
    var P0 = nodesAt(0).P, cen = [0, 0, 0];
    for (i = 0; i < M; i++) for (k = 0; k < 3; k++) cen[k] += P0[i * 3 + k] / M;
    var fwd = col(cams[0].R, 2), dc = [cen[0] - cams[0].c[0], cen[1] - cams[0].c[1], cen[2] - cams[0].c[2]];
    scene.depth = Math.max(0.05, dc[0] * fwd[0] + dc[1] * fwd[1] + dc[2] * fwd[2]);
    scene.up = col(cams[0].R, 1).map(function (v) { return -v; });
    var E = A.edges, L0 = [];  // edges longer than 6x the median at frame 0 are not drawn
    for (i = 0; i < E.length; i += 2) L0.push(Math.hypot(P0[E[i] * 3] - P0[E[i + 1] * 3], P0[E[i] * 3 + 1] - P0[E[i + 1] * 3 + 1], P0[E[i] * 3 + 2] - P0[E[i + 1] * 3 + 2]));
    L0 = L0.filter(isFinite).sort(function (x, y) { return x - y; });
    scene.edgeMax = L0.length ? 6 * L0[L0.length >> 1] : Infinity;
    scene.parts = h.parts ? setupParts(h.parts, P0) : null;
    root.classList.toggle('is-articulated', !!scene.parts);
    if (!scene.parts && withTracks) buildTracks();
    if (trackBox) {  // a run whose graph nodes jitter in depth (data-tracks="off") shows none
      trackBox.disabled = !scene.tracks;
      trackBox.parentNode.title = scene.tracks ? '' : 'No 3D tracks for this run';
    }
    t = 0; dir = 1; follow = true; active = 0; glide = null; setView('input');
    slider.max = T - 1; slider.value = 0;
    dirty = true; requestSort();
  }

  function nodesAt(t) {  // as the worker: node positions and (trained 3x3, row-major) matrices at time t
    var sc = scene, T = sc.T, M = sc.M, f = Math.max(0, Math.min(T - 1, Math.floor(t))), g = Math.min(f + 1, T - 1), a = t - f;
    var P = new Float32Array(M * 3), R = new Float32Array(M * 9), c;
    for (var m = 0; m < M; m++) {
      var i = (m * T + f) * 3, j = (m * T + g) * 3;
      for (c = 0; c < 3; c++) P[m * 3 + c] = sc.A.n_pos[i + c] * (1 - a) + sc.A.n_pos[j + c] * a;
      i = (m * T + f) * 9; j = (m * T + g) * 9;
      for (c = 0; c < 9; c++) R[m * 9 + c] = sc.A.n_rot[i + c] * (1 - a) + sc.A.n_rot[j + c] * a;
    }
    return { P: P, R: R };
  }

  /* ── articulated parts: one slider per part, from its frame-0 pose: a revolute part turns about its hinge (axis
        through pivot, slider in degrees), a prismatic one slides along its axis (slider in % of its largest opening) ── */
  var demo = true, demoT = 0;
  var views = root.dataset.partViews !== undefined, active = 0, glide = null;  // data-part-views: the input view goes to the part that moves
  function setupParts(parts, P0) {
    var R0 = nodesAt(0).R;
    partsBox.innerHTML = '';
    return parts.map(function (pt, k) {
      var slide = pt.type === 'prismatic';
      var part = { slide: slide, axis: normalize(pt.axis), pivot: slide ? pt.origin : pt.pivot, sign: slide ? 1 : pt.sign,
                   max: slide ? 100 : Math.ceil(pt.max_deg), len: pt.max_m, h: pt.h, deg: 0, unit: slide ? '%' : '°',
                   P0: [P0[k * 3], P0[k * 3 + 1], P0[k * 3 + 2]], R0: Array.prototype.slice.call(R0, k * 9, k * 9 + 9) };
      if (pt.fixed) { part.fixed = true; return part; }  // held at its frame-0 pose, without a slider (its fit is not good enough to pose it)
      if (views) {  // its view: the frame where it is opened furthest (the camera then looks at it)
        var T = scene.T, best = -Infinity;
        for (var f = 0; f < T; f++) {
          var o = 0, c;
          if (slide) for (c = 0; c < 3; c++) o += Math.pow(scene.A.n_pos[(k * T + f) * 3 + c] - part.P0[c], 2);
          else for (c = 0; c < 9; c++) o -= scene.A.n_rot[(k * T + f) * 9 + c] * part.R0[c];
          if (o > best) { best = o; part.view = f; }
        }
        var cv = scene.cams[part.view], fw = col(cv.R, 2);
        part.depth = Math.max(0.05, (part.P0[0] - cv.c[0]) * fw[0] + (part.P0[1] - cv.c[1]) * fw[1] + (part.P0[2] - cv.c[2]) * fw[2]);
      }
      var lab = document.createElement('label'), name = document.createElement('span'), val = document.createElement('output');
      var input = document.createElement('input');
      lab.className = 'viewer-part'; name.textContent = pt.name || (root.dataset.partName || 'Part') + ' ' + (k + 1);
      input.type = 'range'; input.min = 0; input.max = part.max; input.step = 1; input.value = 0;
      input.setAttribute('aria-label', name.textContent + (slide ? ' opening' : ' opening angle'));
      val.textContent = '0' + part.unit;
      input.addEventListener('input', function () { stopDemo(); setPart(k, +input.value); lookAt(k); });
      lab.appendChild(name); lab.appendChild(input); lab.appendChild(val); partsBox.appendChild(lab);
      part.input = input; part.out = val;
      return part;
    });
  }
  function setPart(k, deg) {
    var part = scene.parts[k];
    part.deg = deg; part.input.value = deg; part.out.textContent = Math.round(deg) + part.unit;
    dirty = true; requestSort();
  }
  function stopDemo() { if (demo) { demo = false; setPlaying(false); } }
  function partNodes() {  // node positions and matrices from the sliders (a part's Gaussians keep their shapes, as in training)
    var M = scene.M, P = new Float32Array(M * 3), R = new Float32Array(M * 9);
    scene.parts.forEach(function (pt, k) {
      var c;
      if (pt.slide) {
        for (c = 0; c < 3; c++) P[k * 3 + c] = pt.P0[c] + pt.axis[c] * pt.len * pt.deg / 100;
        for (c = 0; c < 9; c++) R[k * 9 + c] = pt.R0[c];
        return;
      }
      var q = axisAngle(pt.axis, pt.sign * pt.deg * Math.PI / 180), d = [pt.P0[0] - pt.pivot[0], pt.P0[1] - pt.pivot[1], pt.P0[2] - pt.pivot[2]];
      var p = apply3(q, d), r = mul3(q, pt.R0);
      for (c = 0; c < 3; c++) P[k * 3 + c] = pt.pivot[c] + p[c];
      for (c = 0; c < 9; c++) R[k * 9 + c] = r[c];
    });
    return { P: P, R: R, key: scene.parts.map(function (pt) { return pt.deg.toFixed(2); }).join(',') };
  }
  function demoAngles(dt) {  // until a slider is touched: each part opens to 3/4 of its range and closes, in turn
    var lead = views ? GLIDE : 0, per = 3.2 + lead;  // with part views, after the view has gone to it
    var live = scene.parts.filter(function (pt) { return !pt.fixed; });
    demoT = (demoT + dt) % (per * live.length);
    lookAt(scene.parts.indexOf(live[Math.floor(demoT / per)]));
    live.forEach(function (pt, k) {
      var u = demoT - k * per - lead, a = u > 0 && u < 3.2 ? Math.sin(Math.PI * u / 3.2) : 0;
      setPart(scene.parts.indexOf(pt), Math.round(0.75 * pt.max * a * a * 10) / 10);
    });
  }

  var TRAIL = 12, SMOOTH = 2;  // frames of track behind the current one; half-width of the trails' moving average
  function buildTracks() {  // a spread of dynamic Gaussians (farthest-point sampling at frame 0), posed at every frame
    var sc = scene, h = sc.hdr, K = h.k, nD = h.n_dyn, T = sc.T, nTr = Math.min(110, nD);
    var frames = [];
    for (var f = 0; f < T; f++) frames.push(nodesAt(f));
    function posAt(i, F) {
      var x = 0, y = 0, z = 0;
      for (var k = 0; k < K; k++) {
        var e = i * K + k, w = sc.w[e], m = sc.dNode[e], R = F.R, r = m * 9, u = sc.A.d_rel[e * 3], v = sc.A.d_rel[e * 3 + 1], q = sc.A.d_rel[e * 3 + 2];
        x += w * (F.P[m * 3] + R[r] * u + R[r + 1] * v + R[r + 2] * q);
        y += w * (F.P[m * 3 + 1] + R[r + 3] * u + R[r + 4] * v + R[r + 5] * q);
        z += w * (F.P[m * 3 + 2] + R[r + 6] * u + R[r + 7] * v + R[r + 8] * q);
      }
      return [x, y, z];
    }
    function pathOf(i) {
      var pts = new Float32Array(T * 3);
      for (var f = 0; f < T; f++) { var p = posAt(i, frames[f]); pts[f * 3] = p[0]; pts[f * 3 + 1] = p[1]; pts[f * 3 + 2] = p[2]; }
      return pts;
    }
    function smooth(P) {  // a moving average over SMOOTH frames either side: the graph's per-frame depth jitter otherwise zigzags every trail
      var S = new Float32Array(P.length), r = T > 24 ? SMOOTH : 1;
      for (var f = 0; f < T; f++) {
        var a = Math.max(0, f - r), b = Math.min(T - 1, f + r);
        for (var c = 0; c < 3; c++) { var s = 0; for (var g = a; g <= b; g++) s += P[g * 3 + c]; S[f * 3 + c] = s / (b - a + 1); }
      }
      return S;
    }
    var color = function (n) { return hsl((n * 137.508) % 360, 0.8, 0.5); };
    // the export's choice (pick_tracks.py) when the file has one: only Gaussians on the surface the input video shows
    var stored = (h.tracks || []).filter(function (i) { return i < nD; }).slice(0, nTr);
    if (stored.length) {
      sc.tracks = stored.map(function (i, n) { return { pts: smooth(pathOf(i)), color: color(n) }; });
      sc.posAt = posAt; return;
    }
    // otherwise only Gaussians the images pinned down get a track: opaque, not tiny, in a dense part of the dynamic cloud
    // at frame 0, and no more jagged than twice the run's median (a faint floater far from the body zigzags through space)
    var i, all0 = [];
    for (i = 0; i < nD; i++) all0.push(posAt(i, frames[0]));
    var med = [0, 1, 2].map(function (a) { return median(all0.map(function (p) { return p[a]; })); });
    var cell = median(all0.map(function (p) { return Math.hypot(p[0] - med[0], p[1] - med[1], p[2] - med[2]); })) / 8 || 1;
    var vox = new Map(), key = function (p, a, b, c) { return (Math.floor(p[0] / cell) + a) + ',' + (Math.floor(p[1] / cell) + b) + ',' + (Math.floor(p[2] / cell) + c); };
    all0.forEach(function (p) { var s = key(p, 0, 0, 0); vox.set(s, (vox.get(s) || 0) + 1); });
    var dens = function (p) {
      var n = 0;
      for (var a = -1; a < 2; a++) for (var b = -1; b < 2; b++) for (var c = -1; c < 2; c++) n += vox.get(key(p, a, b, c)) || 0;
      return n;
    };
    var qs = sc.A.d_scale, qa = sc.A.d_rgba, qBig = function (i) { return Math.max(qs[i * 3], qs[i * 3 + 1], qs[i * 3 + 2]); };  // log size, quantised
    var cand = [], step = Math.max(1, Math.floor(nD / 4000));
    for (i = 0; i < nD; i += step) cand.push(i);
    var qMin = median(cand.map(qBig)) + 255 * Math.log(0.5) / (h.log_scale[1] - h.log_scale[0]), dMin = 0.25 * median(cand.map(function (i) { return dens(all0[i]); }));
    cand = cand.filter(function (i) { return qa[i * 4 + 3] >= 128 && qBig(i) >= qMin && dens(all0[i]) >= dMin; });
    var paths = cand.map(pathOf);
    var jag = paths.map(function (P) {
      var s = 0;
      for (var f = 1; f < T - 1; f++) s += Math.hypot(P[f * 3 - 3] - 2 * P[f * 3] + P[f * 3 + 3], P[f * 3 - 2] - 2 * P[f * 3 + 1] + P[f * 3 + 4], P[f * 3 - 1] - 2 * P[f * 3 + 2] + P[f * 3 + 5]);
      return T > 2 ? s / (T - 2) : 0;
    }), jMax = 2 * median(jag);
    var keep = cand.map(function (_, n) { return n; }).filter(function (n) { return jag[n] <= jMax; });
    cand = keep.map(function (n) { return cand[n]; }); paths = keep.map(function (n) { return paths[n]; });
    if (!cand.length) { sc.tracks = []; sc.posAt = posAt; return; }
    var p0 = cand.map(function (i) { return all0[i]; }), dist = new Float32Array(cand.length).fill(Infinity), pick = [0];
    for (var n = 1; n < nTr && n < cand.length; n++) {
      var last = p0[pick[n - 1]], best = 0;
      for (var j = 0; j < cand.length; j++) {
        var d = Math.pow(p0[j][0] - last[0], 2) + Math.pow(p0[j][1] - last[1], 2) + Math.pow(p0[j][2] - last[2], 2);
        if (d < dist[j]) dist[j] = d;
        if (dist[j] > dist[best]) best = j;
      }
      pick.push(best);
    }
    sc.tracks = pick.map(function (j, n) { return { pts: smooth(paths[j]), color: color(n) }; });
    sc.posAt = posAt;
  }
  function median(v) {
    var s = Float64Array.from(v).sort();
    return s.length ? s[s.length >> 1] : 0;
  }
  function hsl(hh, s, l) {
    var k = function (n) { return (n + hh / 30) % 12; }, a = s * Math.min(l, 1 - l);
    var f = function (n) { return l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)); };
    return [f(0), f(8), f(4)];
  }

  /* ── loading ── */
  var abort = null;
  function load(opt) {
    if (abort) abort.abort();
    var ctl = abort = new AbortController(), label = opt.textContent.trim();
    say('Loading ' + label + '…');
    fetch(opt.dataset.src, { signal: ctl.signal }).then(function (res) {
      if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
      var total = +res.headers.get('Content-Length') || 0;
      if (!res.body || !total) return res.arrayBuffer();
      var reader = res.body.getReader(), got = 0, parts = [];
      return (function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            var out = new Uint8Array(got), o = 0;
            parts.forEach(function (p) { out.set(p, o); o += p.length; });
            return out.buffer;
          }
          parts.push(r.value); got += r.value.length;
          say('Loading ' + label + ' · ' + (got / 1e6).toFixed(1) + ' / ' + (total / 1e6).toFixed(1) + ' MB');
          return pump();
        });
      })();
    }).then(function (buf) {
      if (ctl !== abort) return;
      setupScene(parse(buf), opt.dataset.tracks !== 'off');
      say('');
    }).catch(function (err) {
      if (err.name !== 'AbortError') say('Could not load ' + label + ' (' + err.message + ').');
    });
  }

  /* ── view: follow the input camera, or orbit freely ── */
  var follow = true, cam = { R: null, c: null, target: null };
  function inputCamera(t) {
    var sc = scene, f = Math.max(0, Math.min(sc.T - 1, Math.floor(t))), g = Math.min(f + 1, sc.T - 1), a = t - f;
    var A = sc.cams[f], B = sc.cams[g];
    if (a === 0) return { R: A.R.slice(), c: A.c.slice() };
    return { R: quatToR(nlerp(A.q, B.q, a)), c: [0, 1, 2].map(function (i) { return A.c[i] * (1 - a) + B.c[i] * a; }) };
  }
  var GLIDE = 1.2;  // seconds the input view takes to go from one part's view to the next
  function followCamera(tt) {  // the input camera (at time tt, default the shown one); with part views, the active part's view, glided to from where the view was
    if (!(views && scene.parts)) return inputCamera(tt === undefined ? shownT : tt);
    var B = scene.cams[scene.parts[active].view];
    if (!glide) return { R: B.R.slice(), c: B.c.slice() };
    var e = glide.u * glide.u * (3 - 2 * glide.u);
    return { R: quatToR(nlerp(glide.q, B.q, e)), c: [0, 1, 2].map(function (i) { return glide.c[i] * (1 - e) + B.c[i] * e; }) };
  }
  function lookAt(k) {
    if (!(views && scene.parts) || k === active) return;
    var v = followCamera();
    glide = follow ? { q: quatFromR(v.R), c: v.c, u: 0 } : null; active = k;
    dirty = true; requestSort();
  }
  function setView(mode) {
    follow = mode === 'input';
    viewBtns.forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.view === mode ? 'true' : 'false'); });
    dirty = true; requestSort();
  }
  viewBtns.forEach(function (b) {
    b.addEventListener('click', function () { if (scene) { if (b.dataset.view === 'free') unfollow(); else setView('input'); } });
  });
  var limit = +root.dataset.orbitLimit || 0;  // degrees the view may turn from the input camera (0: free)
  function unfollow() {  // leave the input camera where it is now and orbit about the point it looks at
    if (!follow) return;
    var ic = followCamera(), f = col(ic.R, 2), depth = views && scene.parts ? scene.parts[active].depth : scene.depth;
    cam.R = ic.R; cam.c = ic.c; cam.target = [0, 1, 2].map(function (i) { return ic.c[i] + f[i] * depth; });
    cam.yaw = 0; cam.pitch = 0; cam.dist0 = depth;
    setView('free');
  }
  function current() { return follow ? followCamera() : cam; }

  var drag = null;
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  canvas.addEventListener('pointerdown', function (e) {
    if (!scene) return;
    canvas.setPointerCapture(e.pointerId);
    drag = drag || { pts: {} };
    drag.pts[e.pointerId] = [e.clientX, e.clientY];
    drag.pan = e.button === 2 || e.shiftKey;
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!drag || !drag.pts[e.pointerId]) return;
    var ids = Object.keys(drag.pts), prev = drag.pts[e.pointerId], dx = e.clientX - prev[0], dy = e.clientY - prev[1];
    if (ids.length === 2) {  // pinch: zoom by the change of spread, pan by the midpoint's move
      var o = drag.pts[ids[0] == e.pointerId ? ids[1] : ids[0]];
      var d0 = Math.hypot(prev[0] - o[0], prev[1] - o[1]), d1 = Math.hypot(e.clientX - o[0], e.clientY - o[1]);
      drag.pts[e.pointerId] = [e.clientX, e.clientY];
      unfollow(); zoom(d0 / Math.max(d1, 1)); pan(dx / 2, dy / 2);
      return;
    }
    drag.pts[e.pointerId] = [e.clientX, e.clientY];
    if (!dx && !dy) return;
    unfollow();
    if (drag.pan) pan(dx, dy); else orbit(dx, dy);
  });
  function endDrag(e) {
    if (!drag) return;
    delete drag.pts[e.pointerId];
    if (!Object.keys(drag.pts).length) drag = null;
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', function (e) {
    if (!scene) return;
    e.preventDefault(); unfollow(); zoom(Math.exp(e.deltaY * (e.deltaMode ? 0.05 : 0.0015)));
  }, { passive: false });

  function orbit(dx, dy) {
    var yaw = -dx * 0.005, pitch = dy * 0.005;
    if (limit) {
      var L = limit * Math.PI / 180;
      yaw = Math.max(-L, Math.min(L, cam.yaw + yaw)) - cam.yaw; pitch = Math.max(-L, Math.min(L, cam.pitch + pitch)) - cam.pitch;
      cam.yaw += yaw; cam.pitch += pitch;
    }
    var Q = mul3(axisAngle(scene.up, yaw), axisAngle(normalize(col(cam.R, 0)), pitch));
    var off = apply3(Q, [cam.c[0] - cam.target[0], cam.c[1] - cam.target[1], cam.c[2] - cam.target[2]]);
    cam.R = mul3(Q, cam.R); cam.c = [0, 1, 2].map(function (i) { return cam.target[i] + off[i]; });
    dirty = true; requestSort();
  }
  function pan(dx, dy) {
    var d = Math.hypot(cam.c[0] - cam.target[0], cam.c[1] - cam.target[1], cam.c[2] - cam.target[2]);
    var k = d / focal(), r = col(cam.R, 0), u = col(cam.R, 1);
    for (var i = 0; i < 3; i++) { var m = -(dx * r[i] + dy * u[i]) * k; cam.c[i] += m; cam.target[i] += m; }
    dirty = true; requestSort();
  }
  function zoom(f) {
    if (limit) {  // stay between 0.7 and 1.4 times the input camera's distance
      var d = Math.hypot(cam.c[0] - cam.target[0], cam.c[1] - cam.target[1], cam.c[2] - cam.target[2]);
      f = Math.max(0.7 * cam.dist0, Math.min(1.4 * cam.dist0, d * f)) / d;
    }
    for (var i = 0; i < 3; i++) cam.c[i] = cam.target[i] + (cam.c[i] - cam.target[i]) * f;
    dirty = true; requestSort();
  }

  /* ── sizing ── */
  var dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; dirty = true; }
  }
  function intr() {  // the input camera's intrinsics on the canvas (device px): its whole image fits, centred
    var h = scene.hdr, K = h.K, s = Math.min(canvas.width / h.image[0], canvas.height / h.image[1]);
    return { fx: K[0][0] * s, fy: K[1][1] * s, cx: canvas.width / 2 + (K[0][2] - h.image[0] / 2) * s, cy: canvas.height / 2 + (K[1][2] - h.image[1] / 2) * s };
  }
  function focal() { return intr().fx / dpr; }  // CSS px

  /* ── sorting (in the worker) ── */
  var busy = false, want = false, seq = 0, lastSent = null;
  function requestSort() {
    if (!scene) return;
    if (busy) { want = true; return; }
    // sorted for the view it will be drawn from: the input camera at the time being posed (t), not the one shown now
    var v = follow ? followCamera(t) : cam, view = viewMatrix(v.R, v.c), nodes = scene.parts ? partNodes() : null;
    var key = (nodes ? nodes.key : t.toFixed(4)) + Array.prototype.join.call(view, ',') + layers.static + layers.dynamic;
    if (key === lastSent && order) return;
    lastSent = key; busy = true; want = false; seq++;
    worker.postMessage({ type: 'sort', id: sceneId, t: t, view: view, seq: seq,
      nodes: nodes ? { P: nodes.P, R: nodes.R } : null, nodesKey: nodes ? nodes.key : null });
  }
  worker.onmessage = function (e) {
    var m = e.data;
    busy = false;
    if (m.id !== sceneId) { requestSort(); return; }
    var f32 = new Float32Array(texData.buffer), nD = scene.hdr.n_dyn;
    for (var i = 0; i < nD; i++) { f32[i * 12] = m.dyn[i * 3]; f32[i * 12 + 1] = m.dyn[i * 3 + 1]; f32[i * 12 + 2] = m.dyn[i * 3 + 2]; }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (rowsDyn) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512 * 3, rowsDyn, gl.RGBA_INTEGER, gl.UNSIGNED_INT, texData.subarray(0, rowsDyn * 512 * 12));
    gl.bindBuffer(gl.ARRAY_BUFFER, orderBuf);
    gl.bufferData(gl.ARRAY_BUFFER, m.order, gl.DYNAMIC_DRAW);
    order = m.order; nDraw = m.order.length; shownT = m.t;
    sorts++; if (m.ms !== undefined) sortMs.push(m.ms);
    dirty = true;
    if (want || m.t !== t) requestSort();
  };

  /* ── overlays ── */
  var INK = [0.11, 0.11, 0.13], BLUE = [0.12, 0.31, 0.55], ORANGE = [0.9, 0.47, 0.12];
  var EDGE = [0.31, 0.78, 0.31], NODE = [0.9, 0.24, 0.24];
  function overlays() {
    var L = [], D = [], sc = scene, T = sc.T, tt = shownT, px = dpr;
    function seg(a, b, c, alpha, w) { L.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], alpha, w * px); }
    function dot(p, c, alpha, s) { D.push(p[0], p[1], p[2], c[0], c[1], c[2], alpha, s * px); }
    if (layers.cameras) {
      var K = sc.hdr.K, W = sc.hdr.image[0], H = sc.hdr.image[1], d = 0.2 * sc.depth;
      var frust = function (R, c, color, alpha, w) {
        var pts = [[0, 0], [W, 0], [W, H], [0, H]].map(function (uv) {
          var p = apply3(R, [(uv[0] - K[0][2]) / K[0][0] * d, (uv[1] - K[1][2]) / K[1][1] * d, d]);
          return [c[0] + p[0], c[1] + p[1], c[2] + p[2]];
        });
        for (var i = 0; i < 4; i++) { seg(c, pts[i], color, alpha, w); seg(pts[i], pts[(i + 1) % 4], color, alpha, w); }
      };
      for (var f = 1; f < T; f++) seg(sc.cams[f - 1].c, sc.cams[f].c, BLUE, 0.7, 1.6);
      var every = Math.max(1, Math.ceil(T / 12)), eye = current().c;
      for (f = 0; f < T; f += every) {  // not the ones around the eye (seen from inside, they cross the whole view)
        var cf = sc.cams[f].c;
        if (Math.hypot(cf[0] - eye[0], cf[1] - eye[1], cf[2] - eye[2]) > 1.5 * d) frust(sc.cams[f].R, cf, BLUE, 0.45, 1.2);
      }
      if (!follow) { var ic = followCamera(); frust(ic.R, ic.c, ORANGE, 1, 2.4); }
    }
    if (layers.tracks && sc.tracks) {
      var f1 = Math.floor(tt), f0 = Math.max(0, f1 - Math.min(TRAIL, Math.max(2, Math.round(T / 4))));  // short runs: shorter trails
      sc.tracks.forEach(function (tr) {
        var P = tr.pts, prev = null;
        for (var f = f0; f <= f1; f++) {
          var p = [P[f * 3], P[f * 3 + 1], P[f * 3 + 2]];
          if (prev) seg(prev, p, tr.color, 0.25 + 0.75 * (f - f0) / Math.max(1, f1 - f0), 2.2);
          prev = p;
        }
        var g = Math.min(f1 + 1, T - 1), a = tt - f1;
        var head = [0, 1, 2].map(function (i) { return P[f1 * 3 + i] * (1 - a) + P[g * 3 + i] * a; });
        if (prev) seg(prev, head, tr.color, 1, 2.2);
        dot(head, tr.color, 1, 6);
      });
    }
    if (layers.graph && sc.parts) {  // hinge axes or slide rails, and each part's node
      var PN = partNodes();
      sc.parts.forEach(function (pt, k) {
        if (pt.fixed) return;
        var lo = pt.slide ? 0 : pt.h[0] - 0.04, hi = pt.slide ? pt.len : pt.h[1] + 0.04;
        var a = [0, 1, 2].map(function (i) { return pt.pivot[i] + pt.axis[i] * lo; }), b = [0, 1, 2].map(function (i) { return pt.pivot[i] + pt.axis[i] * hi; });
        seg(a, b, INK, 0.55, 6.5); seg(a, b, EDGE, 1, 4.4);
        dot([PN.P[k * 3], PN.P[k * 3 + 1], PN.P[k * 3 + 2]], NODE, 1, 12);
      });
    } else if (layers.graph) {
      var N = nodesAt(tt), E = sc.A.edges;
      var P3 = function (m) { return [N.P[m * 3], N.P[m * 3 + 1], N.P[m * 3 + 2]]; };
      // a node the video did not observe at this frame (n_obs: its position there is the table completion's infill,
      // not data) is drawn faint, and so are its edges
      var fo = Math.round(tt), obs = sc.A.n_obs ? function (m) { return sc.A.n_obs[m * T + fo] > 0; } : function () { return true; };
      for (var e = 0; e < E.length; e += 2) {
        var a = P3(E[e]), b = P3(E[e + 1]), len = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (!(len <= sc.edgeMax)) continue;  // a node gone astray at this frame (and NaN) would draw a line across the view
        var k2 = obs(E[e]) && obs(E[e + 1]) ? 1 : 0.3;
        seg(a, b, INK, 0.55 * k2, 4.2); seg(a, b, EDGE, k2, 2.4);
      }
      for (var m = 0; m < sc.M; m++) { var p = P3(m); if (isFinite(p[0] + p[1] + p[2])) dot(p, NODE, obs(m) ? 1 : 0.3, 10); }
    }
    return { L: new Float32Array(L), D: new Float32Array(D) };
  }

  /* ── frame ── */
  var dirty = true, t = 0, dir = 1, playing = true, inView = false, last = null, raf = null;
  function draw() {
    resize();
    var W = canvas.width, H = canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (!scene || !order) return;
    var v = current(), view = viewMatrix(v.R, v.c), I = intr();
    var proj = projMatrix(I, W, H), vp = mul4(proj, view), vpSize = [W, H];
    if (scene.app) appPass(scene.app, shownT, v.c);
    var fb = accTarget(W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, W, H);
    if (fb) gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE_MINUS_DST_ALPHA, gl.ONE, gl.ONE_MINUS_DST_ALPHA, gl.ONE);   // front to back: under
    gl.useProgram(splatP.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(splatP.u.u_tex, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, colTex); gl.uniform1i(splatP.u.u_col, 1);
    gl.uniform1i(splatP.u.u_app, scene.app ? 1 : 0);
    gl.uniformMatrix4fv(splatP.u.u_view, false, view);
    gl.uniform4f(splatP.u.u_K, I.fx, I.fy, I.cx, I.cy); gl.uniform2f(splatP.u.u_viewport, W, H);
    gl.uniform1i(splatP.u.u_nDyn, scene.hdr.n_dyn); gl.uniform1i(splatP.u.u_static, layers.static ? 1 : 0); gl.uniform1i(splatP.u.u_dyn, layers.dynamic ? 1 : 0);
    gl.bindVertexArray(splatVao);
    gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, nDraw);
    if (fb) {  // the float image to the canvas (premultiplied, as the canvas is)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.disable(gl.BLEND);
      gl.useProgram(copyP.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, acc.tex); gl.uniform1i(copyP.u.u_img, 0);
      gl.bindVertexArray(emptyVao); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.BLEND);
    }
    var o = overlays();
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (o.L.length) {
      gl.useProgram(lineP.p);
      gl.uniformMatrix4fv(lineP.u.u_vp, false, vp); gl.uniform2f(lineP.u.u_viewport, vpSize[0], vpSize[1]);
      gl.bindVertexArray(lineV.vao); gl.bindBuffer(gl.ARRAY_BUFFER, lineV.buf); gl.bufferData(gl.ARRAY_BUFFER, o.L, gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, o.L.length / lineV.stride);
    }
    if (o.D.length) {
      gl.useProgram(dotP.p);
      gl.uniformMatrix4fv(dotP.u.u_vp, false, vp); gl.uniform2f(dotP.u.u_viewport, vpSize[0], vpSize[1]);
      gl.bindVertexArray(dotV.vao); gl.bindBuffer(gl.ARRAY_BUFFER, dotV.buf); gl.bufferData(gl.ARRAY_BUFFER, o.D, gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, o.D.length / dotV.stride);
    }
    gl.bindVertexArray(null);
    if (!scene.parts) frameLabel.textContent = 'frame ' + (Math.floor(shownT) + scene.hdr.frame0) + ' / ' + (scene.T - 1 + scene.hdr.frame0);
  }
  function tick(now) {
    raf = null;
    if (!inView) return;
    if (glide && glide.u < 1 && last !== null) { glide.u = Math.min(1, glide.u + Math.min(0.1, (now - last) / 1000) / GLIDE); dirty = true; requestSort(); }
    if (playing && scene && scene.parts && last !== null) demoAngles(Math.min(0.1, (now - last) / 1000));
    else if (playing && scene && last !== null) {
      var dt = Math.min(0.1, (now - last) / 1000), T = scene.T;
      t += dir * dt * scene.hdr.fps;
      if (scene.pingpong) {
        if (t > T - 1) { t = 2 * (T - 1) - t; dir = -1; }
        if (t < 0) { t = -t; dir = 1; }
      } else if (t > T - 1) t = 0;
      t = Math.max(0, Math.min(T - 1, t));
      slider.value = t;
      requestSort();
    }
    last = now;
    if (dirty) { dirty = false; draw(); }
    raf = requestAnimationFrame(tick);
  }
  function setPlaying(on) {
    playing = on; last = null;
    playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
    root.classList.toggle('is-paused', !on);
  }
  playBtn.addEventListener('click', function () { if (scene && scene.parts) demo = !playing; setPlaying(!playing); });
  slider.addEventListener('input', function () { setPlaying(false); t = +slider.value; requestSort(); });

  /* ── a handle for tests (measure_viewer.py): pause at a frame in the input view, read the canvas back ── */
  var sorts = 0, sortMs = [];
  root.xm4d = {
    info: function () {
      return scene ? { T: scene.T, image: scene.hdr.image, n: scene.hdr.n_static + scene.hdr.n_dyn, version: scene.hdr.version || 1,
                       app: !!scene.app, target: acc.fmt, canvas: [canvas.width, canvas.height], dpr: dpr } : null;
    },
    frame: function (f) { setPlaying(false); setView('input'); t = f; slider.value = f; requestSort(); },
    ready: function () { return !!(scene && order && !busy && shownT === t); },
    capture: function () {  // the canvas as drawn now: RGBA bytes (premultiplied, i.e. over black), rows top first, base64
      draw();
      var w = canvas.width, h = canvas.height, px = new Uint8Array(w * h * 4), out = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (var y = 0; y < h; y++) out.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      var s = '';
      for (var i = 0; i < out.length; i += 0x8000) s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
      return { w: w, h: h, data: btoa(s) };
    },
    timeDraw: function (n, keepColours) {  // GPU+CPU ms per full redraw (appearance pass included unless keepColours), synchronised by a 1-px read
      var px = new Uint8Array(4), t0 = performance.now();
      for (var i = 0; i < n; i++) { if (scene.app && !keepColours) scene.app.key = null; draw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      return (performance.now() - t0) / n;
    },
    sortStats: function () { return { sorts: sorts, ms: sortMs.slice(-20) }; },
    debug: function (what) {  // float readbacks for tests: 'colors' (appearance pass output) or 'order'
      var b64 = function (a) { var u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), s = ''; for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
      if (what === 'order') return b64(order);
      draw(); var r = scene.app.rows, px = new Float32Array(512 * r * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, colFb); gl.readPixels(0, 0, 512, r, gl.RGBA, gl.FLOAT, px); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return b64(px);
    }
  };

  /* ── scene picking (the run list: in the panel, or anywhere with data-for="<this viewer's id>"). An option with
        data-page is an application's own 3D page (fridge, kitchen twin, hand-object clips): it shows, as it is, in the
        frame the list's data-embed names (?embed: without its top bar and heading), in place of this viewer ── */
  var started = false, frame = select && select.dataset.embed ? document.getElementById(select.dataset.embed) : null;
  function source() { return select ? select.selectedOptions[0] : { dataset: { src: root.dataset.src }, textContent: root.dataset.label || '' }; }
  if (select) select.addEventListener('change', function () {
    var opt = source(), page = opt.dataset.page;
    if (frame) {
      frame.hidden = !page; root.hidden = !!page;
      if (page) { var u = page.split('#'); frame.src = u[0] + '?embed' + (u[1] ? '#' + u[1] : ''); return; }
      if (frame.getAttribute('src')) frame.removeAttribute('src');     /* the page stops drawing */
    }
    if (started) load(opt);
  });
  if (frame) window.addEventListener('message', function (e) {   /* the embedded page reports its height (embed.js) */
    if (e.source === frame.contentWindow && e.data && e.data.xm4dEmbedHeight) frame.style.height = e.data.xm4dEmbedHeight + 'px';
  });

  new ResizeObserver(function () { dirty = true; }).observe(canvas);
  new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      inView = e.isIntersecting;
      if (inView && !started) { started = true; load(source()); }
      last = null;
      if (inView && raf === null) raf = requestAnimationFrame(tick);
    });
  }, { rootMargin: '200px 0px' }).observe(root);
  }
})();
