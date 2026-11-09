/* XM4D gallery viewer, worker: poses the dynamic Gaussians at time t through the deformation graph (the trainer's
   skinning, x = sum_k w_k (p_k(t) + R_k(t) rel_k)) and sorts all Gaussians front to back for the current view (exactly, by camera depth). */
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

var keys = null, keyU = null, idxA = null, idxB = null, h0 = new Uint32Array(65536), h1 = new Uint32Array(65536);
function sort(view, dyn) {  // camera depth (OpenCV: +z ahead), nearest first, exact: LSD radix sort on the float32 bits
  // (positive floats order as their bits), low 16 then high 16, as gsplat sorts by the depth's float bits; drops what is
  // nearer than the near plane
  var n = S.nDyn + S.nStatic, v2 = view[2], v6 = view[6], v10 = view[10], v14 = view[14], near = 0.01, i, j, d, m = 0;
  if (!keys || keys.length < n) { keys = new Float32Array(n); keyU = new Uint32Array(keys.buffer); idxA = new Uint32Array(n); idxB = new Uint32Array(n); }
  var nD = S.nDyn, sp = S.sPos;
  for (i = 0; i < nD; i++) {
    d = v2 * dyn[i * 3] + v6 * dyn[i * 3 + 1] + v10 * dyn[i * 3 + 2] + v14;
    if (d > near) { keys[m] = d; idxA[m++] = i; }
  }
  for (i = 0; i < S.nStatic; i++) {
    d = v2 * sp[i * 3] + v6 * sp[i * 3 + 1] + v10 * sp[i * 3 + 2] + v14;
    if (d > near) { keys[m] = d; idxA[m++] = i + nD; }
  }
  h0.fill(0); h1.fill(0);
  for (j = 0; j < m; j++) { var u = keyU[j]; h0[u & 0xffff]++; h1[u >>> 16]++; }
  var s0 = 0, s1 = 0, c;
  for (i = 0; i < 65536; i++) { c = h0[i]; h0[i] = s0; s0 += c; c = h1[i]; h1[i] = s1; s1 += c; }
  for (j = 0; j < m; j++) idxB[h0[keyU[j] & 0xffff]++] = j;
  var order = new Uint32Array(m);
  for (j = 0; j < m; j++) { var jj = idxB[j]; order[h1[keyU[jj] >>> 16]++] = idxA[jj]; }
  return order;
}

var cacheT = null, cacheDyn = null;
self.onmessage = function (e) {
  var m = e.data;
  if (m.type === 'scene') { S = m; cacheT = null; return; }
  if (m.type !== 'sort' || !S || m.id !== S.id) return;
  var key = m.nodes ? m.nodesKey : m.t;
  if (cacheT !== key) { cacheDyn = pose(m.t, m.nodes); cacheT = key; }
  var t0 = performance.now(), order = sort(m.view, cacheDyn), ms = performance.now() - t0, dyn = cacheDyn.slice();
  self.postMessage({ id: S.id, t: m.t, seq: m.seq, order: order, dyn: dyn, ms: ms }, [order.buffer, dyn.buffer]);
};
