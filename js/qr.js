/* ============================================================
 *  MasterCards — qr.js
 *  Generador QR minimalista (byte mode, EC level L, SVG output).
 *  Sin dependencias externas. Para códigos TOTP otpauth://.
 * ============================================================ */

// GF(256) con polinomio irreducible 0x11D (usado en QR / Reed-Solomon)
var GF_EXP = new Uint8Array(512);
var GF_LOG = new Uint8Array(256);
(function initGalois() {
  var x = 1;
  for (var i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x = (x << 1) ^ (x & 0x80 ? 0x11D : 0);
  }
  for (var i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();
function gfMul(a, b) { return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]; }

// Reed-Solomon: genera polinomio generador de grado 'nsym'
function rsGenPoly(nsym) {
  var g = [1];
  for (var i = 0; i < nsym; i++) {
    var ng = new Uint8Array(g.length + 1);
    for (var j = 0; j < g.length; j++) {
      ng[j] ^= g[j];
      ng[j + 1] ^= gfMul(g[j], GF_EXP[i]);
    }
    g = ng;
  }
  return g;
}
function rsEncode(data, nsym) {
  var gen = rsGenPoly(nsym);
  var res = new Uint8Array(data.length + nsym);
  for (var i = 0; i < data.length; i++) res[i] = data[i];
  for (var i = 0; i < data.length; i++) {
    var coef = res[i];
    if (coef !== 0) for (var j = 1; j < gen.length; j++) res[i + j] ^= gfMul(gen[j], coef);
  }
  return res.slice(data.length);
}

// Tablas QR por versión (EC level L): [totalCodewords, ecPerBlock, groups: [[count, dataPerBlock]...]]
var QR_TABLE = [
  null,
  [26, 7, [[1, 19]]],           // v1
  [44, 10, [[1, 34]]],          // v2
  [70, 15, [[1, 55]]],          // v3
  [100, 20, [[1, 80]]],         // v4
  [134, 26, [[1, 108]]],        // v5
  [172, 18, [[2, 68]]],         // v6
  [196, 20, [[2, 78]]],         // v7
  [242, 24, [[2, 97]]],         // v8
  [292, 30, [[2, 116], [2, 117]]], // v9
  [346, 18, [[2, 68], [2, 69]]]    // v10
];
var ALIGN_POS = [null, null, [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];

function chooseVersion(len) {
  for (var v = 1; v <= 10; v++) {
    var t = QR_TABLE[v];
    var dataBits = 0;
    var groups = t[2];
    for (var g = 0; g < groups.length; g++) dataBits += groups[g][0] * groups[g][1] * 8;
    if (len <= dataBits) return v;
  }
  return 10;
}

function encodeData(text, version) {
  var bytes = [];
  for (var i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i) & 0xFF);
  var t = QR_TABLE[version];
  var groups = t[2];
  var totalData = 0;
  for (var g = 0; g < groups.length; g++) totalData += groups[g][0] * groups[g][1];
  var bits = [];
  // Mode indicator: 0100 (byte mode)
  bits.push(0, 1, 0, 0);
  // Character count (8 bits for versions 1-9)
  var len = bytes.length;
  for (var i = 7; i >= 0; i--) bits.push((len >> i) & 1);
  // Data bytes
  for (var b = 0; b < bytes.length; b++) {
    for (var i = 7; i >= 0; i--) bits.push((bytes[b] >> i) & 1);
  }
  // Terminator (up to 4 zeros)
  var maxBits = totalData * 8;
  var termLen = Math.min(4, maxBits - bits.length);
  for (var i = 0; i < termLen; i++) bits.push(0);
  // Pad to byte boundary
  while (bits.length % 8) bits.push(0);
  // Pad bytes (0xEC, 0x11 alternating)
  var padBytes = [0xEC, 0x11];
  var pi = 0;
  while (bits.length < maxBits) {
    var pb = padBytes[pi % 2];
    for (var i = 7; i >= 0; i--) bits.push((pb >> i) & 1);
    pi++;
  }
  // Convert to bytes
  var dataBytes = [];
  for (var i = 0; i < bits.length; i += 8) {
    var b = 0;
    for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    dataBytes.push(b);
  }
  return new Uint8Array(dataBytes);
}

function interleavedCodewords(dataBytes, version) {
  var t = QR_TABLE[version];
  var totalData = 0;
  var groups = t[2];
  for (var g = 0; g < groups.length; g++) totalData += groups[g][0] * groups[g][1];
  var ecPerBlock = t[1];
  var blocks = [];
  var offset = 0;
  for (var g = 0; g < groups.length; g++) {
    for (var i = 0; i < groups[g][0]; i++) {
      var blockData = dataBytes.slice(offset, offset + groups[g][1]);
      offset += groups[g][1];
      var ec = rsEncode(blockData, ecPerBlock);
      blocks.push({ data: blockData, ec: ec });
    }
  }
  // Interleave data
  var maxDataLen = 0;
  for (var i = 0; i < blocks.length; i++) maxDataLen = Math.max(maxDataLen, blocks[i].data.length);
  var result = [];
  for (var i = 0; i < maxDataLen; i++) {
    for (var j = 0; j < blocks.length; j++) {
      if (i < blocks[j].data.length) result.push(blocks[j].data[i]);
    }
  }
  // Interleave EC
  for (var i = 0; i < ecPerBlock; i++) {
    for (var j = 0; j < blocks.length; j++) {
      result.push(blocks[j].ec[i]);
    }
  }
  return result;
}

// ---- Matrix operations ----
function createMatrix(version) {
  var size = version * 4 + 17;
  var mod = [];
  var reserved = [];
  for (var r = 0; r < size; r++) {
    mod[r] = new Uint8Array(size);
    reserved[r] = new Uint8Array(size);
  }
  return { size: size, mod: mod, res: reserved };
}

function setReserved(m, r, c, v) {
  if (r >= 0 && r < m.size && c >= 0 && c < m.size) {
    m.mod[r][c] = v;
    m.res[r][c] = 1;
  }
}

function placeFinder(m, row, col) {
  for (var r = -1; r <= 7; r++) {
    for (var c = -1; c <= 7; c++) {
      var rr = row + r, cc = col + c;
      if (rr < 0 || rr >= m.size || cc < 0 || cc >= m.size) continue;
      var inBorder = (r === -1 || r === 7 || c === -1 || c === 7);
      var inOuter = (r === 0 || r === 6 || c === 0 || c === 6);
      var inInner = (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      m.mod[rr][cc] = (inBorder || inOuter || inInner) ? 1 : 0;
      m.res[rr][cc] = 1;
    }
  }
}

function placeAlign(m, row, col) {
  for (var r = -2; r <= 2; r++) {
    for (var c = -2; c <= 2; c++) {
      var outer = (r === -2 || r === 2 || c === -2 || c === 2);
      var center = (r === 0 && c === 0);
      m.mod[row + r][col + c] = (outer || center) ? 1 : 0;
      m.res[row + r][col + c] = 1;
    }
  }
}

function placeTiming(m) {
  for (var i = 8; i < m.size - 8; i++) {
    if (!m.res[6][i]) { m.mod[6][i] = (i % 2 === 0) ? 1 : 0; m.res[6][i] = 1; }
    if (!m.res[i][6]) { m.mod[i][6] = (i % 2 === 0) ? 1 : 0; m.res[i][6] = 1; }
  }
}

function placeDarkModule(m, version) {
  setReserved(m, 4 * version + 9, 8, 1);
}

function reserveFormatArea(m) {
  for (var i = 0; i < 15; i++) {
    // Around top-left finder
    if (i < 6) setReserved(m, 8, i, 0);
    else if (i < 8) setReserved(m, 8, i + 1, 0);
    else if (i < 9) setReserved(m, i - 8 + 1, 8, 0);
    else setReserved(m, i - 8 + 2, 8, 0);
    // Bottom-left
    setReserved(m, m.size - 1 - i, 8, 0);
    // Top-right
    setReserved(m, 8, m.size - 15 + i, 0);
  }
  setReserved(m, m.size - 8, 8, 0);
}

function placeDataBits(m, bits) {
  var idx = 0;
  var right = m.size - 1;
  while (right >= 0) {
    if (right === 6) right--; // skip timing column
    var upward = ((m.size - 1 - right) % 2 === 0);
    var col = right;
    var rows = upward ? m.size - 1 : 0;
    var endRow = upward ? -1 : m.size;
    var step = upward ? -1 : 1;
    for (var r = rows; r !== endRow; r += step) {
      for (var dc = 0; dc <= 1; dc++) {
        var c = col - dc;
        if (c < 0 || c >= m.size) continue;
        if (m.res[r][c]) continue;
        m.mod[r][c] = idx < bits.length ? bits[idx] : 0;
        idx++;
      }
    }
    right -= 2;
  }
}

// Mask patterns
var MASK_FNS = [
  function (r, c) { return (r + c) % 2 === 0; },
  function (r, c) { return r % 2 === 0; },
  function (r, c) { return c % 3 === 0; },
  function (r, c) { return (r + c) % 3 === 0; },
  function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
  function (r, c) { return ((r * c) % 2 + (r * c) % 3) === 0; },
  function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; },
  function (r, c) { return ((r + c) % 2 + (r * c) % 3) % 2 === 0; }
];

function applyMask(m, maskIdx) {
  var fn = MASK_FNS[maskIdx];
  for (var r = 0; r < m.size; r++) {
    for (var c = 0; c < m.size; c++) {
      if (!m.res[r][c] && fn(r, c)) m.mod[r][c] ^= 1;
    }
  }
}

function penalty(m) {
  var score = 0;
  // Adjacent modules in row
  for (var r = 0; r < m.size; r++) {
    var cnt = 1;
    for (var c = 1; c < m.size; c++) {
      if (m.mod[r][c] === m.mod[r][c - 1]) { cnt++; } else { if (cnt >= 5) score += cnt - 2; cnt = 1; }
    }
    if (cnt >= 5) score += cnt - 2;
  }
  // Adjacent modules in column
  for (var c = 0; c < m.size; c++) {
    var cnt = 1;
    for (var r = 1; r < m.size; r++) {
      if (m.mod[r][c] === m.mod[r - 1][c]) { cnt++; } else { if (cnt >= 5) score += cnt - 2; cnt = 1; }
    }
    if (cnt >= 5) score += cnt - 2;
  }
  // 2x2 blocks
  for (var r = 0; r < m.size - 1; r++) {
    for (var c = 0; c < m.size - 1; c++) {
      var v = m.mod[r][c];
      if (v === m.mod[r][c + 1] && v === m.mod[r + 1][c] && v === m.mod[r + 1][c + 1]) score += 3;
    }
  }
  return score;
}

function writeFormatBits(m, maskIdx) {
  // EC level L = 01, mask pattern = maskIdx
  var formatInfo = (0x01 << 3) | maskIdx; // EC L = 01
  var data = formatInfo << 10;
  // BCH(15,5)
  var gen = 0x537;
  var tmp = data;
  for (var i = 4; i >= 0; i--) {
    if (tmp & (1 << (i + 10))) tmp ^= gen << i;
  }
  data = (formatInfo << 10) | tmp;
  data ^= 0x5412; // XOR mask
  // Place format bits around top-left
  var bits = [];
  for (var i = 14; i >= 0; i--) bits.push((data >> i) & 1);
  // Horizontal (row 8)
  var positions = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  for (var i = 0; i < 15; i++) {
    var r = positions[i][0], c = positions[i][1];
    m.mod[r][c] = bits[i];
  }
  // Bottom-left and top-right
  var bits2 = [];
  for (var i = 0; i < 15; i++) bits2.push((data >> i) & 1);
  var positions2 = [[m.size - 1, 8], [m.size - 2, 8], [m.size - 3, 8], [m.size - 4, 8], [m.size - 5, 8], [m.size - 6, 8], [m.size - 7, 8], [8, m.size - 8], [8, m.size - 7], [8, m.size - 6], [8, m.size - 5], [8, m.size - 4], [8, m.size - 3], [8, m.size - 2], [8, m.size - 1]];
  for (var i = 0; i < 15; i++) {
    m.mod[positions2[i][0]][positions2[i][1]] = bits2[i];
  }
}

/**
 * Genera un SVG de código QR para el texto dado.
 * @param {string} text - Texto a codificar
 * @param {number} [scale=4] - Escalado de módulos
 * @returns {string} SVG string
 */
export function generateQR(text, scale) {
  scale = scale || 4;
  var version = chooseVersion(text.length * 8);
  var dataBytes = encodeData(text, version);
  var codewords = interleavedCodewords(dataBytes, version);
  // Build bit stream
  var bits = [];
  for (var i = 0; i < codewords.length; i++) {
    for (var j = 7; j >= 0; j--) bits.push((codewords[i] >> j) & 1);
  }
  var m = createMatrix(version);
  // Place finders
  placeFinder(m, 0, 0);
  placeFinder(m, 0, m.size - 7);
  placeFinder(m, m.size - 7, 0);
  // Align patterns
  if (version >= 2) {
    var ap = ALIGN_POS[version];
    if (ap) {
      for (var i = 0; i < ap.length; i++) {
        for (var j = 0; j < ap.length; j++) {
          if (m.res[ap[i]][ap[j]]) continue;
          placeAlign(m, ap[i], ap[j]);
        }
      }
    }
  }
  placeTiming(m);
  placeDarkModule(m, version);
  reserveFormatArea(m);
  placeDataBits(m, bits);
  // Try all masks, pick lowest penalty
  var bestMask = 0, bestPenalty = Infinity;
  for (var mi = 0; mi < 8; mi++) {
    var copy = { size: m.size, mod: m.mod.map(function (r) { return r.slice(); }), res: m.res };
    applyMask(copy, mi);
    writeFormatBits(copy, mi);
    var p = penalty(copy);
    if (p < bestPenalty) { bestPenalty = p; bestMask = mi; }
  }
  applyMask(m, bestMask);
  writeFormatBits(m, bestMask);
  // Generate SVG
  var quiet = 4; // quiet zone
  var total = m.size + quiet * 2;
  var svgSize = total * scale;
  var parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + svgSize + '" height="' + svgSize + '" viewBox="0 0 ' + total + ' ' + total + '">'];
  parts.push('<rect width="' + total + '" height="' + total + '" fill="white"/>');
  for (var r = 0; r < m.size; r++) {
    for (var c = 0; c < m.size; c++) {
      if (m.mod[r][c]) {
        parts.push('<rect x="' + (c + quiet) + '" y="' + (r + quiet) + '" width="1" height="1" fill="black"/>');
      }
    }
  }
  parts.push('</svg>');
  return parts.join('');
}
