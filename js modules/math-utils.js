// math-utils.js

export function fractionStringApprox(x) {
  let [num, den] = bestRationalApproximation(x, 100000);
  let approx = num / den;
  let err = Math.abs(x - approx);
  let label = `${num}/${den}`;
  if (err > 0.01) label = "~" + label;
  return label;
}

export function bestRationalApproximation(x, maxDen) {
  let pPrevPrev = 0, pPrev = 1;
  let qPrevPrev = 1, qPrev = 0;
  let fraction = x;
  let a = Math.floor(fraction);
  let p = a * pPrev + pPrevPrev;
  let q = a * qPrev + qPrevPrev;
  while (true) {
    let remainder = fraction - a;
    if (Math.abs(remainder) < 1e-12) break;
    fraction = 1 / remainder;
    a = Math.floor(fraction);
    let pNext = a * p + pPrev;
    let qNext = a * q + qPrev;
    if (qNext > maxDen) break;
    pPrevPrev = pPrev;
    qPrevPrev = qPrev;
    pPrev = p;
    qPrev = q;
    p = pNext;
    q = qNext;
  }
  return [p, q];
}

export function parseFractionOrDecimal(s) {
  s = s.trim();
  if (!s) return NaN;
  if (s.includes("^")) {
    let match = s.match(/^(.+)\^(.+)$/);
    if (!match) return NaN;
    let baseStr = match[1].replace(/^\(+/, "").replace(/\)+$/, "");
    let expStr = match[2].replace(/^\(+/, "").replace(/\)+$/, "");
    let baseVal = parseFractionOrDecimal(baseStr);
    let expVal = parseFractionOrDecimal(expStr);
    if (!isFinite(baseVal) || !isFinite(expVal)) return NaN;
    return Math.pow(baseVal, expVal);
  }
  if (s.includes("/")) {
    let parts = s.split("/");
    if (parts.length !== 2) return NaN;
    let num = parseFloat(parts[0]);
    let den = parseFloat(parts[1]);
    if (!isFinite(num) || !isFinite(den) || den === 0) return NaN;
    return num / den;
  }
  return parseFloat(s);
}

export function ratioToHue(ratio) {
  let t = ratio - 1;
  return 360 * t;
}

export function hexToRgba(hex, alpha) {
  hex = hex.replace(/^#/, "");
  let r, g, b;
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else if (hex.length === 6) {
    r = parseInt(hex.substr(0, 2), 16);
    g = parseInt(hex.substr(2, 2), 16);
    b = parseInt(hex.substr(4, 2), 16);
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
