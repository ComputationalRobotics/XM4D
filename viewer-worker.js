/* XM4D gallery viewer, worker: poses the dynamic Gaussians at time t through the deformation graph (the trainer's
   skinning, x = sum_k w_k (p_k(t) + R_k(t) rel_k)) and sorts all Gaussians front to back for the current view. */
'use strict';

var S = null;

function nodeFrames(t) {  // node positions and (trained, free 3x3, row-major) matrices at time t, linear between frames
  var M = S.nNodes, T = S.nFrames, f = Math.max(0, Math.min(T - 1, Math.floor(t))), g = Math.min(f + 1, T - 1), a = t - f;
  var P = new Float32Array(M * 3), R = new Float32Array(M * 9), c;
  for (var m = 0; m < M; m++) {
    var i = (m * T + f) * 3, j = (m * T + g) * 3;
    for (c = 0; c < 3; c++) P[m * 3 + c] = S.nPos[i + c] * (1 - a) + S.nPos[j + c] * a;
    i = (m * T + f) * 9; j = (m * T + g) * 9;
    for (c = 0; c < 9; c++) R[m * 9 + c] = S.nRot[i + c] * (1 - a) + S.nRot[j + c] * a;
  }
  return { P: P, R: R };
}

function pose(t, nodes) {  // nodes: explicit node positions and matrices (an articulated object's sliders), else time t
  var F = nodes || nodeFrames(t), P = F.P, R = F.R, K = S.k, out = new Float32Array(S.nDyn * 3);
  for (var i = 0; i < S.nDyn; i++) {
    var x = 0, y = 0, z = 0;
    for (var k = 0; k < K; k++) {
      var e = i * K + k, w = S.dW[e], m = S.dNode[e], r = m * 9, p = m * 3, u = S.dRel[e * 3], v = S.dRel[e * 3 + 1], q = S.dRel[e * 3 + 2];
      x += w * (P[p] + R[r] * u + R[r + 1] * v + R[r + 2] * q);
      y += w * (P[p + 1] + R[r + 3] * u + R[r + 4] * v + R[r + 5] * q);
      z += w * (P[p + 2] + R[r + 6] * u + R[r + 7] * v + R[r + 8] * q);
    }
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
  }
  return out;
}

var depthBuf = null, keyBuf = null, counts = new Uint32Array(65536), starts = new Uint32Array(65536);
function sort(view, dyn) {  // 16-bit counting sort on camera depth (OpenCV: +z ahead), nearest first; drops what is behind
  var n = S.nDyn + S.nStatic, v2 = view[2], v6 = view[6], v10 = view[10], v14 = view[14];
  if (!depthBuf || depthBuf.length < n) { depthBuf = new Float32Array(n); keyBuf = new Uint16Array(n); }
  var lo = Infinity, hi = -Infinity, near = 0.01, i, d;
  for (i = 0; i < n; i++) {
    var src = i < S.nDyn ? dyn : S.sPos, b = (i < S.nDyn ? i : i - S.nDyn) * 3;
    d = v2 * src[b] + v6 * src[b + 1] + v10 * src[b + 2] + v14;
    depthBuf[i] = d;
    if (d > near) { if (d < lo) lo = d; if (d > hi) hi = d; }
  }
  counts.fill(0);
  var scale = hi > lo ? 65535 / (hi - lo) : 0, cnt = 0;
  for (i = 0; i < n; i++) {
    d = depthBuf[i];
    if (d <= near) continue;
    var key = ((d - lo) * scale) | 0;
    keyBuf[i] = key; counts[key]++; cnt++;
  }
  starts[0] = 0;
  for (i = 1; i < 65536; i++) starts[i] = starts[i - 1] + counts[i - 1];
  var order = new Uint32Array(cnt);
  for (i = 0; i < n; i++) if (depthBuf[i] > near) order[starts[keyBuf[i]]++] = i;
  return order;
}

var cacheT = null, cacheDyn = null;
self.onmessage = function (e) {
  var m = e.data;
  if (m.type === 'scene') { S = m; cacheT = null; return; }
  if (m.type !== 'sort' || !S || m.id !== S.id) return;
  var key = m.nodes ? m.nodesKey : m.t;
  if (cacheT !== key) { cacheDyn = pose(m.t, m.nodes); cacheT = key; }
  var order = sort(m.view, cacheDyn), dyn = cacheDyn.slice();
  self.postMessage({ id: S.id, t: m.t, seq: m.seq, order: order, dyn: dyn }, [order.buffer, dyn.buffer]);
};
