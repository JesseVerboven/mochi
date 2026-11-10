'use strict';
/*
 * One fragment shader draws everything: the island (dark liquid glass) and the
 * companion blob (tinted jelly), smoothly unioned so the blob hangs from the
 * island like a droplet. The shared SDF is turned into a height field whose
 * normals drive refraction of the captured desktop, chromatic dispersion,
 * fresnel rim, specular and the creature's face.
 */
window.SHADERS = {
  vert: `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`,

  frag: `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2  uRes;      // CSS px
uniform float uDpr;
uniform float uTime;
uniform vec4  uIsland;   // centre.xy, half-size.xy
uniform float uIslandR;
uniform vec3  uBlob;     // centre.xy, radius
uniform vec2  uStretch;  // stretch axis * amount
uniform vec4  uEye;      // look.xy, open, happy
uniform vec3  uColA;
uniform vec3  uColB;
uniform float uEnergy;
uniform float uDark;
uniform float uGoo;
uniform float uGlow;
uniform float uHasBg;
uniform float uRefr;
uniform float uMono;   // 1 = render everything in greyscale
uniform float uPlain;  // 1 = island is flat solid black (no glass)
uniform sampler2D uBg;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float blobSdf(vec2 p) {
  vec2 d = p - uBlob.xy;
  float s = length(uStretch);
  vec2 ax = s > 1e-4 ? uStretch / s : vec2(1.0, 0.0);
  vec2 q = vec2(dot(d, ax), dot(d, vec2(-ax.y, ax.x)));
  float sx = 1.0 + s;
  float sy = 1.0 / sqrt(1.0 + s);
  q /= vec2(sx, sy);
  float a = atan(q.y, q.x);
  float w = sin(a * 3.0 + uTime * 2.1) * 0.5
          + sin(a * 5.0 - uTime * 3.3) * 0.3
          + sin(a * 2.0 + uTime * 1.3) * 0.4;
  return (length(q) - uBlob.z * (1.0 + w * 0.05 * uEnergy)) * min(sx, sy);
}

// x: distance, y: blob material weight
vec2 scene(vec2 p) {
  float di = sdRoundBox(p - uIsland.xy, uIsland.zw, uIslandR);
  float db = blobSdf(p);
  float k = uGoo;
  float h = clamp(0.5 + 0.5 * (db - di) / k, 0.0, 1.0);
  return vec2(mix(db, di, h) - k * h * (1.0 - h), 1.0 - h);
}

vec3 bgSample(vec2 uv) {
  uv = clamp(uv, vec2(0.001), vec2(0.999));
  if (uHasBg > 0.5) return texture(uBg, uv).rgb;
  // No capture: a soft, slowly drifting neutral backdrop.
  vec3 c = mix(vec3(0.16, 0.17, 0.22), vec3(0.07, 0.07, 0.10), uv.y);
  c += 0.035 * sin(vec3(0.0, 2.0, 4.0) + uv.x * 7.0 + uTime * 0.35);
  return c;
}

float ellipseSdf(vec2 q, vec2 r) { return (length(q / r) - 1.0) * min(r.x, r.y); }

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;

  vec2 sc = scene(p);
  float d = sc.x;
  float m = sc.y;

  float ds = scene(p - vec2(0.0, 6.0)).x;
  float shadow = 0.28 * exp(-max(ds, 0.0) / 10.0);
  float glow = uGlow * exp(-max(d, 0.0) / 14.0) * smoothstep(0.2, 0.9, m);

  float alpha = clamp(0.5 - d * uDpr, 0.0, 1.0);
  if (alpha <= 0.0) {
    fragColor = vec4(uColA * glow, min(1.0, shadow + glow));
    return;
  }

  // ---- height field & normal
  float e = 0.75;
  float gx = scene(p + vec2(e, 0.0)).x - scene(p - vec2(e, 0.0)).x;
  float gy = scene(p + vec2(0.0, e)).x - scene(p - vec2(0.0, e)).x;
  vec2 g = vec2(gx, gy) / (2.0 * e);
  float bevel = mix(10.0, uBlob.z * 0.95, m);
  float t = clamp(-d / bevel, 0.0, 1.0);
  float hgt = sqrt(max(1.0 - (1.0 - t) * (1.0 - t), 0.0));
  float slope = (1.0 - t) / max(hgt, 0.08);
  vec3 N = normalize(vec3(g * slope, 1.0));

  // ---- refraction with chromatic dispersion
  vec2 off = -N.xy * mix(16.0, 26.0, m) * uRefr;
  vec2 inv = 1.0 / uRes;
  vec3 bg;
  bg.r = bgSample((p + off * 1.00) * inv).r;
  bg.g = bgSample((p + off * 1.10) * inv).g;
  bg.b = bgSample((p + off * 1.22) * inv).b;

  // ---- lighting
  vec3 L = normalize(vec3(-0.45, -0.75, 0.6));
  vec3 Hh = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(N, Hh), 0.0), mix(70.0, 110.0, m));
  float fres = pow(1.0 - N.z, 1.6);
  float under = pow(max(dot(N, normalize(vec3(0.15, 0.9, 0.45))), 0.0), 3.0);

  // island: dark liquid glass
  vec3 isl = bg * mix(0.5, 0.10, uDark) + vec3(0.012, 0.012, 0.018);
  isl += uColA * fres * 0.28 + uColB * under * 0.10;

  // blob: tinted jelly with a glowing core
  vec2 bp = (p - uBlob.xy) / uBlob.z;
  float grad = smoothstep(-1.0, 1.1, bp.y + 0.25 * sin(bp.x * 2.2 + uTime * 0.9));
  vec3 body = mix(uColA, uColB, grad);
  vec2 cq = bp - vec2(0.0, 0.25);
  float core = exp(-dot(cq, cq) * 1.4);
  vec3 jelly = bg * body * 1.35 + body * (0.22 + 0.35 * core);
  jelly += mix(uColA, vec3(1.0), 0.4) * fres * 0.35;
  jelly += body * under * 0.35;

  vec3 col = mix(isl, jelly, m);
  col += vec3(1.0) * spec * mix(0.45, 0.85, m);
  float edge = smoothstep(1.6, 0.0, -d) * (0.55 + 0.45 * clamp(-g.y, 0.0, 1.0));
  col += mix(vec3(0.22), uColA * 0.6 + 0.2, m) * edge * 0.35;

  // ---- face
  float R = uBlob.z;
  vec2 ec0 = uBlob.xy + vec2(0.0, -R * 0.06) + uEye.xy * R * 0.16;
  float open = max(uEye.z, 0.0);
  float eyeD = 1e5;
  float hiD = 1e5;
  float cheek = 0.0;
  for (int i = 0; i < 2; i++) {
    float sd = i == 0 ? -1.0 : 1.0;
    vec2 ec = ec0 + vec2(sd * R * 0.34, 0.0);
    vec2 q = p - ec;
    float dOpen = ellipseSdf(q, vec2(R * 0.115, max(R * 0.18 * open, 0.9)));
    float dHappy = max(abs(length(q - vec2(0.0, R * 0.10)) - R * 0.14) - R * 0.032, q.y - R * 0.02);
    eyeD = min(eyeD, mix(dOpen, dHappy, uEye.w));
    hiD = min(hiD, length(q - vec2(-R * 0.04, -R * 0.07 * open)) - R * 0.04);
    vec2 cc = q - vec2(sd * R * 0.1, R * 0.27);
    cheek += exp(-dot(cc, cc) / (R * R * 0.02));
  }
  float onBlob = smoothstep(0.45, 0.8, m);
  float eyeA = clamp(0.5 - eyeD * uDpr, 0.0, 1.0) * onBlob;
  float hiA = clamp(0.5 - hiD * uDpr, 0.0, 1.0) * onBlob * (1.0 - uEye.w) * step(0.5, open);
  col += vec3(1.0, 0.45, 0.6) * cheek * onBlob * (0.10 + 0.25 * uEye.w);
  col = mix(col, vec3(0.03, 0.03, 0.07), eyeA * 0.92);
  col = mix(col, vec3(1.0), hiA * 0.9);

  // Solid black island: drop the glass entirely on the island part.
  col = mix(col, vec3(0.0), (1.0 - smoothstep(0.35, 0.65, m)) * uPlain);
  col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), uMono);

  col = clamp(col, 0.0, 1.0);
  vec3 outc = col * alpha + uColA * glow * (1.0 - alpha);
  float outa = alpha + (shadow + glow) * (1.0 - alpha);
  fragColor = vec4(outc, min(outa, 1.0));
}`,
};
