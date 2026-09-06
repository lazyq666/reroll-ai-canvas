// Libraries.dev @ 999866f — see adjacent LICENSE / NOTICE files.
function Y(e){let t=e.replace("#","");(t.length===3||t.length===4)&&(t=t.split("").map(r=>r+r).join(""));let o=t.length>=8?parseInt(t.slice(6,8),16)/255:1;return[parseInt(t.slice(0,2),16)/255,parseInt(t.slice(2,4),16)/255,parseInt(t.slice(4,6),16)/255,o]}function ye(e,t,o){e/=255,t/=255,o/=255;let r=Math.max(e,t,o),i=Math.min(e,t,o),a=r-i,c=0,f=r===0?0:a/r;return a!==0&&(r===e?c=((t-o)/a+6)%6:r===t?c=(o-e)/a+2:c=(e-t)/a+4,c/=6),[c,f,r]}function we(e,t,o){let r=Math.floor(e*6),i=e*6-r,a=o*(1-t),c=o*(1-i*t),f=o*(1-(1-i)*t),s=0,l=0,p=0;switch(r%6){case 0:s=o,l=f,p=a;break;case 1:s=c,l=o,p=a;break;case 2:s=a,l=o,p=f;break;case 3:s=a,l=c,p=o;break;case 4:s=f,l=a,p=o;break;case 5:s=o,l=a,p=c;break}return[Math.round(s*255),Math.round(l*255),Math.round(p*255)]}var oe=66.66666666666667;var Re=1500,Te=1,re=16,Me=16,Ie=8,Ee=96,Ae=2;var nt=0;var it=1;var F={colorBack:"#00000000",speed:1,repetition:1.5,softness:.05,shiftRed:.3,shiftBlue:.3,distortion:.1,contour:.4,angle:90,shape:nt,scale:1,rotation:0,offsetX:0,offsetY:0,originX:.5,originY:.5,worldWidth:0,worldHeight:0,fit:it},at={name:"chromatic",modes:{dark:{...F,colorTint:"#88ccffcc",shiftRed:.75,shiftBlue:.75,shaderOpacity:1},light:{...F,colorTint:"#66b0ff99",shiftRed:.6,shiftBlue:.6,shaderOpacity:1}}},st={name:"silver",modes:{dark:{...F,colorTint:"#ffffff66",shaderOpacity:.88},light:{...F,colorTint:"#ffffff40",shaderOpacity:1}}},ct={name:"gold",modes:{dark:{...F,colorTint:"#ffcc55cc",speed:.85,shaderOpacity:.92},light:{...F,colorTint:"#f7d488aa",shaderOpacity:1}}},j={chromatic:at,silver:st,gold:ct};var Pe=`
#define TWO_PI 6.28318530718
#define PI 3.14159265358979323846
`,Ce=`
vec2 rotate(vec2 uv, float th) {
  return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv;
}
`;var Fe=`
  color += 1. / 256. * (fract(sin(dot(.014 * gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453123) - .5);
`,Be=`
vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
    -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
    + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy),
      dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
`;var ne=`#version 300 es
precision mediump float;

uniform sampler2D u_image;
uniform float u_imageAspectRatio;

uniform vec2 u_resolution;
uniform float u_time;

uniform vec4 u_colorBack;
uniform vec4 u_colorTint;

uniform float u_softness;
uniform float u_repetition;
uniform float u_shiftRed;
uniform float u_shiftBlue;
uniform float u_distortion;
uniform float u_contour;
uniform float u_angle;

uniform float u_shape;
uniform bool u_isImage;

in vec2 v_objectUV;
in vec2 v_responsiveUV;
in vec2 v_responsiveBoxGivenSize;
in vec2 v_imageUV;

out vec4 fragColor;

${Pe}
${Ce}
${Be}

float getColorChanges(float c1, float c2, float stripe_p, vec3 w, float blur, float bump, float tint) {

  float ch = mix(c2, c1, smoothstep(.0, 2. * blur, stripe_p));

  float border = w[0];
  ch = mix(ch, c2, smoothstep(border, border + 2. * blur, stripe_p));

  if (u_isImage == true) {
    bump = smoothstep(.2, .8, bump);
  }
  border = w[0] + .4 * (1. - bump) * w[1];
  ch = mix(ch, c1, smoothstep(border, border + 2. * blur, stripe_p));

  border = w[0] + .5 * (1. - bump) * w[1];
  ch = mix(ch, c2, smoothstep(border, border + 2. * blur, stripe_p));

  border = w[0] + w[1];
  ch = mix(ch, c1, smoothstep(border, border + 2. * blur, stripe_p));

  float gradient_t = (stripe_p - w[0] - w[1]) / w[2];
  float gradient = mix(c1, c2, smoothstep(0., 1., gradient_t));
  ch = mix(ch, gradient, smoothstep(border, border + .5 * blur, stripe_p));

  // Tint color is applied with color burn blending
  ch = mix(ch, 1. - min(1., (1. - ch) / max(tint, 0.0001)), u_colorTint.a);
  return ch;
}

float getImgFrame(vec2 uv, float th) {
  float frame = 1.;
  frame *= smoothstep(0., th, uv.y);
  frame *= 1.0 - smoothstep(1. - th, 1., uv.y);
  frame *= smoothstep(0., th, uv.x);
  frame *= 1.0 - smoothstep(1. - th, 1., uv.x);
  return frame;
}

float blurEdge3x3(sampler2D tex, vec2 uv, vec2 dudx, vec2 dudy, float radius, float centerSample) {
  vec2 texel = 1.0 / vec2(textureSize(tex, 0));
  vec2 r = radius * texel;

  float w1 = 1.0, w2 = 2.0, w4 = 4.0;
  float norm = 16.0;
  float sum = w4 * centerSample;

  sum += w2 * textureGrad(tex, uv + vec2(0.0, -r.y), dudx, dudy).r;
  sum += w2 * textureGrad(tex, uv + vec2(0.0, r.y), dudx, dudy).r;
  sum += w2 * textureGrad(tex, uv + vec2(-r.x, 0.0), dudx, dudy).r;
  sum += w2 * textureGrad(tex, uv + vec2(r.x, 0.0), dudx, dudy).r;

  sum += w1 * textureGrad(tex, uv + vec2(-r.x, -r.y), dudx, dudy).r;
  sum += w1 * textureGrad(tex, uv + vec2(r.x, -r.y), dudx, dudy).r;
  sum += w1 * textureGrad(tex, uv + vec2(-r.x, r.y), dudx, dudy).r;
  sum += w1 * textureGrad(tex, uv + vec2(r.x, r.y), dudx, dudy).r;

  return sum / norm;
}

float lst(float edge0, float edge1, float x) {
  return clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
}

void main() {

  const float firstFrameOffset = 2.8;
  float t = .3 * (u_time + firstFrameOffset);

  vec2 uv = v_imageUV;
  vec2 dudx = dFdx(v_imageUV);
  vec2 dudy = dFdy(v_imageUV);
  vec4 img = textureGrad(u_image, uv, dudx, dudy);

  if (u_isImage == false) {
    uv = v_objectUV + .5;
    uv.y = 1. - uv.y;
  }

  float cycleWidth = u_repetition;
  float edge = 0.;
  float contOffset = 1.;

  vec2 rotatedUV = uv - vec2(.5);
  float angle = (-u_angle + 70.) * PI / 180.;
  float cosA = cos(angle);
  float sinA = sin(angle);
  rotatedUV = vec2(
  rotatedUV.x * cosA - rotatedUV.y * sinA,
  rotatedUV.x * sinA + rotatedUV.y * cosA
  ) + vec2(.5);

  if (u_isImage == true) {
    float edgeRaw = img.r;
    edge = blurEdge3x3(u_image, uv, dudx, dudy, 6., edgeRaw);
    edge = pow(edge, 1.6);
    edge *= mix(0.0, 1.0, smoothstep(0.0, 0.4, u_contour));
  } else {
    if (u_shape < 1.) {
      // full-fill on canvas
      vec2 borderUV = v_responsiveUV + .5;
      float ratio = v_responsiveBoxGivenSize.x / v_responsiveBoxGivenSize.y;
      vec2 mask = min(borderUV, 1. - borderUV);
      vec2 pixel_thickness = min(250. / v_responsiveBoxGivenSize, vec2(.5));
      float maskX = smoothstep(0.0, pixel_thickness.x, mask.x);
      float maskY = smoothstep(0.0, pixel_thickness.y, mask.y);
      maskX = pow(maskX, .25);
      maskY = pow(maskY, .25);
      edge = clamp(1. - maskX * maskY, 0., 1.);

      uv = v_responsiveUV;
      if (ratio > 1.) {
        uv.y /= ratio;
      } else {
        uv.x *= ratio;
      }
      uv += .5;
      uv.y = 1. - uv.y;

      cycleWidth *= 2.;
      contOffset = 1.5;

    } else if (u_shape < 2.) {
      // circle
      vec2 shapeUV = uv - .5;
      shapeUV *= .67;
      edge = pow(clamp(3. * length(shapeUV), 0., 1.), 18.);
    } else if (u_shape < 3.) {
      // daisy
      vec2 shapeUV = uv - .5;
      shapeUV *= 1.68;

      float r = length(shapeUV) * 2.;
      float a = atan(shapeUV.y, shapeUV.x) + .2;
      r *= (1. + .05 * sin(3. * a + 2. * t));
      float f = abs(cos(a * 3.));
      edge = smoothstep(f, f + .7, r);
      edge *= edge;

      uv *= .8;
      cycleWidth *= 1.6;

    } else if (u_shape < 4.) {
      // diamond
      vec2 shapeUV = uv - .5;
      shapeUV = rotate(shapeUV, .25 * PI);
      shapeUV *= 1.42;
      shapeUV += .5;
      vec2 mask = min(shapeUV, 1. - shapeUV);
      vec2 pixel_thickness = vec2(.15);
      float maskX = smoothstep(0.0, pixel_thickness.x, mask.x);
      float maskY = smoothstep(0.0, pixel_thickness.y, mask.y);
      maskX = pow(maskX, .25);
      maskY = pow(maskY, .25);
      edge = clamp(1. - maskX * maskY, 0., 1.);
    } else if (u_shape < 5.) {
      // metaballs
      vec2 shapeUV = uv - .5;
      shapeUV *= 1.3;
      edge = 0.;
      for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float speed = 1.5 + 2./3. * sin(fi * 12.345);
        float angle = -fi * 1.5;
        vec2 dir1 = vec2(cos(angle), sin(angle));
        vec2 dir2 = vec2(cos(angle + 1.57), sin(angle + 1.));
        vec2 traj = .4 * (dir1 * sin(t * speed + fi * 1.23) + dir2 * cos(t * (speed * 0.7) + fi * 2.17));
        float d = length(shapeUV + traj);
        edge += pow(1.0 - clamp(d, 0.0, 1.0), 4.0);
      }
      edge = 1. - smoothstep(.65, .9, edge);
      edge = pow(edge, 4.);
    }

    edge = mix(smoothstep(.9 - 2. * fwidth(edge), .9, edge), edge, smoothstep(0.0, 0.4, u_contour));

  }

  float opacity = 0.;
  if (u_isImage == true) {
    opacity = img.g;
    float frame = getImgFrame(v_imageUV, 0.);
    opacity *= frame;
  } else {
    opacity = 1. - smoothstep(.9 - 2. * fwidth(edge), .9, edge);
    if (u_shape < 2.) {
      edge = 1.2 * edge;
    } else if (u_shape < 5.) {
      edge = 1.8 * pow(edge, 1.5);
    }
  }

  float diagBLtoTR = rotatedUV.x - rotatedUV.y;
  float diagTLtoBR = rotatedUV.x + rotatedUV.y;

  vec3 color = vec3(0.);
  vec3 color1 = vec3(.98, 0.98, 1.);
  vec3 color2 = vec3(.1, .1, .1 + .1 * smoothstep(.7, 1.3, diagTLtoBR));

  vec2 grad_uv = uv - .5;

  float dist = length(grad_uv + vec2(0., .2 * diagBLtoTR));
  grad_uv = rotate(grad_uv, (.25 - .2 * diagBLtoTR) * PI);
  float direction = grad_uv.x;

  float bump = pow(1.8 * dist, 1.2);
  bump = 1. - bump;
  bump *= pow(uv.y, .3);


  float thin_strip_1_ratio = .12 / cycleWidth * (1. - .4 * bump);
  float thin_strip_2_ratio = .07 / cycleWidth * (1. + .4 * bump);
  float wide_strip_ratio = (1. - thin_strip_1_ratio - thin_strip_2_ratio);

  float thin_strip_1_width = cycleWidth * thin_strip_1_ratio;
  float thin_strip_2_width = cycleWidth * thin_strip_2_ratio;

  float noise = snoise(uv - t);

  edge += (1. - edge) * u_distortion * noise;

  direction += diagBLtoTR;
  float contour = 0.;
  direction -= 2. * noise * diagBLtoTR * (smoothstep(0., 1., edge) * (1.0 - smoothstep(0., 1., edge)));
  direction *= mix(1., 1. - edge, smoothstep(.5, 1., u_contour));
  direction -= 1.7 * edge * smoothstep(.5, 1., u_contour);
  direction += .2 * pow(u_contour, 4.) * (1.0 - smoothstep(0., 1., edge));

  bump *= clamp(pow(uv.y, .1), .3, 1.);
  direction *= (.1 + (1.1 - edge) * bump);

  direction *= (.4 + .6 * (1.0 - smoothstep(.5, 1., edge)));
  direction += .18 * (smoothstep(.1, .2, uv.y) * (1.0 - smoothstep(.2, .4, uv.y)));
  direction += .03 * (smoothstep(.1, .2, 1. - uv.y) * (1.0 - smoothstep(.2, .4, 1. - uv.y)));

  direction *= (.5 + .5 * pow(uv.y, 2.));
  direction *= cycleWidth;
  direction -= t;


  float colorDispersion = (1. - bump);
  colorDispersion = clamp(colorDispersion, 0., 1.);
  float dispersionRed = colorDispersion;
  dispersionRed += .03 * bump * noise;
  dispersionRed += 5. * (smoothstep(-.1, .2, uv.y) * (1.0 - smoothstep(.1, .5, uv.y))) * (smoothstep(.4, .6, bump) * (1.0 - smoothstep(.4, 1., bump)));
  dispersionRed -= diagBLtoTR;

  float dispersionBlue = colorDispersion;
  dispersionBlue *= 1.3;
  dispersionBlue += (smoothstep(0., .4, uv.y) * (1.0 - smoothstep(.1, .8, uv.y))) * (smoothstep(.4, .6, bump) * (1.0 - smoothstep(.4, .8, bump)));
  dispersionBlue -= .2 * edge;

  dispersionRed *= (u_shiftRed / 20.);
  dispersionBlue *= (u_shiftBlue / 20.);

  float blur = 0.;
  float rExtraBlur = 0.;
  float gExtraBlur = 0.;
  if (u_isImage == true) {
    float softness = 0.05 * u_softness;
    blur = softness + .5 * smoothstep(1., 10., u_repetition) * smoothstep(.0, 1., edge);
    float smallCanvasT = 1.0 - smoothstep(100., 500., min(u_resolution.x, u_resolution.y));
    blur += smallCanvasT * smoothstep(.0, 1., edge);
    rExtraBlur = softness * (0.05 + .1 * (u_shiftRed / 20.) * bump);
    gExtraBlur = softness * 0.05 / max(0.001, abs(1. - diagBLtoTR));
  } else {
    blur = u_softness / 15. + .3 * contour;
  }

  vec3 w = vec3(thin_strip_1_width, thin_strip_2_width, wide_strip_ratio);
  w[1] -= .02 * smoothstep(.0, 1., edge + bump);
  float stripe_r = fract(direction + dispersionRed);
  float r = getColorChanges(color1.r, color2.r, stripe_r, w, blur + fwidth(stripe_r) + rExtraBlur, bump, u_colorTint.r);
  float stripe_g = fract(direction);
  float g = getColorChanges(color1.g, color2.g, stripe_g, w, blur + fwidth(stripe_g) + gExtraBlur, bump, u_colorTint.g);
  float stripe_b = fract(direction - dispersionBlue);
  float b = getColorChanges(color1.b, color2.b, stripe_b, w, blur + fwidth(stripe_b), bump, u_colorTint.b);

  color = vec3(r, g, b);
  color *= opacity;

  vec3 bgColor = u_colorBack.rgb * u_colorBack.a;
  color = color + bgColor * (1. - opacity);
  opacity = opacity + u_colorBack.a * (1. - opacity);

  ${Fe}

  fragColor = vec4(color, opacity);
}
`;var Ge=`#version 300 es
precision mediump float;

layout(location = 0) in vec4 a_position;

uniform vec2 u_resolution;
uniform float u_pixelRatio;
uniform float u_imageAspectRatio;
uniform float u_originX;
uniform float u_originY;
uniform float u_worldWidth;
uniform float u_worldHeight;
uniform float u_fit;
uniform float u_scale;
uniform float u_rotation;
uniform float u_offsetX;
uniform float u_offsetY;

out vec2 v_objectUV;
out vec2 v_objectBoxSize;
out vec2 v_responsiveUV;
out vec2 v_responsiveBoxGivenSize;
out vec2 v_patternUV;
out vec2 v_patternBoxSize;
out vec2 v_imageUV;

vec3 getBoxSize(float boxRatio, vec2 givenBoxSize) {
  vec2 box = vec2(0.);
  // fit = none
  box.x = boxRatio * min(givenBoxSize.x / boxRatio, givenBoxSize.y);
  float noFitBoxWidth = box.x;
  if (u_fit == 1.) { // fit = contain
    box.x = boxRatio * min(u_resolution.x / boxRatio, u_resolution.y);
  } else if (u_fit == 2.) { // fit = cover
    box.x = boxRatio * max(u_resolution.x / boxRatio, u_resolution.y);
  }
  box.y = box.x / boxRatio;
  return vec3(box, noFitBoxWidth);
}

void main() {
  gl_Position = a_position;

  vec2 uv = gl_Position.xy * .5;
  vec2 boxOrigin = vec2(.5 - u_originX, u_originY - .5);
  vec2 givenBoxSize = vec2(u_worldWidth, u_worldHeight);
  givenBoxSize = max(givenBoxSize, vec2(1.)) * u_pixelRatio;
  float r = u_rotation * 3.14159265358979323846 / 180.;
  mat2 graphicRotation = mat2(cos(r), sin(r), -sin(r), cos(r));
  vec2 graphicOffset = vec2(-u_offsetX, u_offsetY);


  // ===================================================

  float fixedRatio = 1.;
  vec2 fixedRatioBoxGivenSize = vec2(
  (u_worldWidth == 0.) ? u_resolution.x : givenBoxSize.x,
  (u_worldHeight == 0.) ? u_resolution.y : givenBoxSize.y
  );

  v_objectBoxSize = getBoxSize(fixedRatio, fixedRatioBoxGivenSize).xy;
  vec2 objectWorldScale = u_resolution.xy / v_objectBoxSize;

  v_objectUV = uv;
  v_objectUV *= objectWorldScale;
  v_objectUV += boxOrigin * (objectWorldScale - 1.);
  v_objectUV += graphicOffset;
  v_objectUV /= u_scale;
  v_objectUV = graphicRotation * v_objectUV;

  // ===================================================

  v_responsiveBoxGivenSize = vec2(
  (u_worldWidth == 0.) ? u_resolution.x : givenBoxSize.x,
  (u_worldHeight == 0.) ? u_resolution.y : givenBoxSize.y
  );
  float responsiveRatio = v_responsiveBoxGivenSize.x / v_responsiveBoxGivenSize.y;
  vec2 responsiveBoxSize = getBoxSize(responsiveRatio, v_responsiveBoxGivenSize).xy;
  vec2 responsiveBoxScale = u_resolution.xy / responsiveBoxSize;

  v_responsiveUV = uv;
  v_responsiveUV *= responsiveBoxScale;
  v_responsiveUV += boxOrigin * (responsiveBoxScale - 1.);
  v_responsiveUV += graphicOffset;
  v_responsiveUV /= u_scale;
  v_responsiveUV.x *= responsiveRatio;
  v_responsiveUV = graphicRotation * v_responsiveUV;
  v_responsiveUV.x /= responsiveRatio;

  // ===================================================

  float patternBoxRatio = givenBoxSize.x / givenBoxSize.y;
  vec2 patternBoxGivenSize = vec2(
  (u_worldWidth == 0.) ? u_resolution.x : givenBoxSize.x,
  (u_worldHeight == 0.) ? u_resolution.y : givenBoxSize.y
  );
  patternBoxRatio = patternBoxGivenSize.x / patternBoxGivenSize.y;

  vec3 boxSizeData = getBoxSize(patternBoxRatio, patternBoxGivenSize);
  v_patternBoxSize = boxSizeData.xy;
  float patternBoxNoFitBoxWidth = boxSizeData.z;
  vec2 patternBoxScale = u_resolution.xy / v_patternBoxSize;

  v_patternUV = uv;
  v_patternUV += graphicOffset / patternBoxScale;
  v_patternUV += boxOrigin;
  v_patternUV -= boxOrigin / patternBoxScale;
  v_patternUV *= u_resolution.xy;
  v_patternUV /= u_pixelRatio;
  if (u_fit > 0.) {
    v_patternUV *= (patternBoxNoFitBoxWidth / v_patternBoxSize.x);
  }
  v_patternUV /= u_scale;
  v_patternUV = graphicRotation * v_patternUV;
  v_patternUV += boxOrigin / patternBoxScale;
  v_patternUV -= boxOrigin;
  // x100 is a default multiplier between vertex and fragmant shaders
  // we use it to avoid UV presision issues
  v_patternUV *= .01;

  // ===================================================

  vec2 imageBoxSize;
  if (u_fit == 1.) { // contain
    imageBoxSize.x = min(u_resolution.x / u_imageAspectRatio, u_resolution.y) * u_imageAspectRatio;
  } else if (u_fit == 2.) { // cover
    imageBoxSize.x = max(u_resolution.x / u_imageAspectRatio, u_resolution.y) * u_imageAspectRatio;
  } else {
    imageBoxSize.x = min(10.0, 10.0 / u_imageAspectRatio * u_imageAspectRatio);
  }
  imageBoxSize.y = imageBoxSize.x / u_imageAspectRatio;
  vec2 imageBoxScale = u_resolution.xy / imageBoxSize;

  v_imageUV = uv;
  v_imageUV *= imageBoxScale;
  v_imageUV += boxOrigin * (imageBoxScale - 1.);
  v_imageUV += graphicOffset;
  v_imageUV /= u_scale;
  v_imageUV.x *= u_imageAspectRatio;
  v_imageUV = graphicRotation * v_imageUV;
  v_imageUV.x /= u_imageAspectRatio;

  v_imageUV += .5;
  v_imageUV.y = 1. - v_imageUV.y;
}`,Le=ne;function ie(e,t,o){let r=e.createShader(t);if(!r)throw new Error("metal-fx: gl.createShader returned null");if(e.shaderSource(r,o),e.compileShader(r),!e.getShaderParameter(r,e.COMPILE_STATUS)){let i=e.getShaderInfoLog(r);throw e.deleteShader(r),new Error(`metal-fx: shader compile failed: ${i??"(no info log)"}`)}return r}function ke(e,t,o){let r=e.createProgram();if(!r)throw new Error("metal-fx: gl.createProgram returned null");if(e.attachShader(r,t),e.attachShader(r,o),e.linkProgram(r),!e.getProgramParameter(r,e.LINK_STATUS)){let i=e.getProgramInfoLog(r);throw e.deleteProgram(r),new Error(`metal-fx: program link failed: ${i??"(no info log)"}`)}return r}var q=140,Q=40,ae=1.6,se=1.3,n=null,Oe=null;function Ve(e){Oe=e}var lt=["u_resolution","u_time","u_pixelRatio","u_colorBack","u_colorTint","u_repetition","u_softness","u_shiftRed","u_shiftBlue","u_distortion","u_contour","u_angle","u_shape","u_isImage","u_image","u_originX","u_originY","u_worldWidth","u_worldHeight","u_fit","u_scale","u_rotation","u_offsetX","u_offsetY","u_imageAspectRatio"];function Ue(e){e.enable(e.BLEND),e.blendFunc(e.ONE,e.ONE_MINUS_SRC_ALPHA);let t=ie(e,e.VERTEX_SHADER,Ge),o=ie(e,e.FRAGMENT_SHADER,Le),r=ke(e,t,o);e.useProgram(r);let i=e.createBuffer();if(!i)throw new Error("metal-fx: gl.createBuffer returned null");e.bindBuffer(e.ARRAY_BUFFER,i),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),e.STATIC_DRAW);let a=e.getAttribLocation(r,"a_position");e.enableVertexAttribArray(a),e.vertexAttribPointer(a,2,e.FLOAT,!1,0,0);let c={};for(let s of lt)c[s]=e.getUniformLocation(r,s);let f=e.createTexture();return f&&(e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,f),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,1,1,0,e.RGBA,e.UNSIGNED_BYTE,new Uint8Array([0,0,0,255])),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),c.u_image&&e.uniform1i(c.u_image,0)),{program:r,buffer:i,uniforms:c,dummyTexture:f}}function ce(){if(n)return n;let e=Math.min(Ae,typeof window<"u"&&window.devicePixelRatio||1),t=Math.round(Ee*e),o=typeof OffscreenCanvas<"u",r,i;if(o)r=new OffscreenCanvas(t,t),i=r.getContext("webgl2",{alpha:!0,premultipliedAlpha:!0,antialias:!1});else{let d=document.createElement("canvas");d.width=t,d.height=t,i=d.getContext("webgl2",{alpha:!0,premultipliedAlpha:!0,antialias:!1,preserveDrawingBuffer:!0}),r=d}if(!i)throw new Error("metal-fx: WebGL2 not supported");let{program:a,buffer:c,uniforms:f,dummyTexture:s}=Ue(i),l=d=>{d.preventDefault(),n&&(n.contextLost=!0)},p=()=>{if(!n)return;let d=Ue(n.gl);n.program=d.program,n.buffer=d.buffer,n.uniforms=d.uniforms,n.dummyTexture=d.dummyTexture,n.presetDirty=!0,n.contextLost=!1,Oe?.()};return r.addEventListener("webglcontextlost",l,!1),r.addEventListener("webglcontextrestored",p,!1),n={glCanvas:r,gl:i,program:a,buffer:c,uniforms:f,dummyTexture:s,preset:j.chromatic.modes.dark,presetDirty:!0,contextLost:!1,useOffscreen:o,frameBitmap:null,startMs:performance.now(),pausedMs:0,pausedAtMs:null,rafId:0,dpr:e,instances:new Set,frameCount:0,glowQueue:[],glowIdx:0,glowSkip:0,glowPixels:new Uint8Array(t*t*4),glowPixelsW:t,glowPixelsH:t},n}function $e(){if(!n)return;let{gl:e,program:t,buffer:o,frameBitmap:r,dummyTexture:i}=n;try{r?.close(),e.deleteBuffer(o),e.deleteProgram(t),i&&e.deleteTexture(i),e.getExtension("WEBGL_lose_context")?.loseContext()}catch{}n=null}var De=0;function U(){if(!n)return;let e=performance.now();if(e-De<Re)return;De=e;let{gl:t,glCanvas:o}=n,r=o.width,i=o.height;(n.glowPixelsW!==r||n.glowPixelsH!==i)&&(n.glowPixelsW=r,n.glowPixelsH=i,n.glowPixels=new Uint8Array(r*i*4)),t.readPixels(0,0,r,i,t.RGBA,t.UNSIGNED_BYTE,n.glowPixels)}var B={bx:0,by:0};function le(e,t,o){if(!n)return B.bx=0,B.by=0,B;let{glCanvas:r}=n,i=r.width,a=r.height,c=e.dpr,f=e.cssWidth*c,s=e.cssHeight*c,l=q*c,p=Q*c,d=f*(i/l)/e.shaderScale,u=s*(a/p)/e.shaderScale;d>i&&(d=i),u>a&&(u=a);let g=(i-d)/2,x=(a-u)/2,m=g+t/e.cssWidth*d,v=x+o/e.cssHeight*u;return B.bx=Math.round(m),B.by=Math.round(a-1-v),B}var S={r:0,g:0,b:0,lum:0,count:0};function He(e,t,o,r,i,a){let c=Math.max(1,a|0),f=Math.max(0,r-c),s=Math.min(t,r+c+1),l=Math.max(0,i-c),p=Math.min(o,i+c+1);S.r=0,S.g=0,S.b=0,S.lum=0,S.count=0;for(let d=l;d<p;d++){let u=d*t;for(let g=f;g<s;g++){let x=(u+g)*4;S.r+=e[x],S.g+=e[x+1],S.b+=e[x+2],S.lum+=(.2126*e[x]+.7152*e[x+1]+.0722*e[x+2])/255,S.count++}}return S}var _={r:255,g:255,b:255};function ue(e,t,o,r){if(!n)return 0;U();let i=le(e,t,o),a=He(n.glowPixels,n.glowPixelsW,n.glowPixelsH,i.bx,i.by,r);return a.count>0?a.lum/a.count:0}function We(e,t,o,r){if(!n)return _.r=255,_.g=255,_.b=255,_;U();let i=le(e,t,o),a=He(n.glowPixels,n.glowPixelsW,n.glowPixelsH,i.bx,i.by,r);return a.count===0?(_.r=255,_.g=255,_.b=255,_):(_.r=a.r/a.count,_.g=a.g/a.count,_.b=a.b/a.count,_)}function Ne(e,t,o,r){if(!n)return _.r=255,_.g=255,_.b=255,_;U();let i=le(e,t,o),{glowPixels:a,glowPixelsW:c,glowPixelsH:f}=n,s=Math.max(1,r|0),l=Math.max(0,i.bx-s),p=Math.min(c,i.bx+s+1),d=Math.max(0,i.by-s),u=Math.min(f,i.by+s+1),g=-1;_.r=255,_.g=255,_.b=255;for(let x=d;x<u;x++){let m=x*c;for(let v=l;v<p;v++){let h=(m+v)*4,y=a[h],w=a[h+1],E=a[h+2],M=Math.max(y,w,E),D=Math.min(y,w,E),H=(M>0?(M-D)/M:0)*(.35+.65*(M/255));H>g&&(g=H,_.r=y,_.g=w,_.b=E)}}return _}Ve(()=>{n&&n.instances.size>0&&n.pausedAtMs===null&&O()});typeof document<"u"&&document.addEventListener("visibilitychange",()=>{!n||n.pausedAtMs!==null||n.contextLost||(document.hidden?Ye():n.instances.size>0&&O())});function ut(e){let t=ce(),o=e.hostCanvas.getContext("2d",{alpha:!0});if(!o)throw new Error("metal-fx: canvas 2D context unavailable");let r=e.scale??1,i={canvas:e.hostCanvas,ctx:o,cssWidth:e.cssWidth,cssHeight:e.cssHeight,cornerRadius:e.cornerRadius,kind:e.kind,ringCssPx:e.ringCssPx??(e.kind==="circle"?2:1)*r,shaderScale:e.shaderScale??(e.kind==="circle"?se:ae)*r,opacityMul:e.opacityMul??1,visible:!0,paused:e.paused??!1,everCopied:!1,dpr:typeof window<"u"&&window.devicePixelRatio||1,scale:r,onAfterFrame:e.onAfterFrame,onFirstCopy:e.onFirstCopy};return ze(i),t.instances.add(i),t.rafId===0&&t.pausedAtMs===null&&O(),i}function dt(e){if(!n)return;n.instances.delete(e);let t=n.glowQueue.indexOf(e);t!==-1&&n.glowQueue.splice(t,1),n.instances.size===0&&(Ye(),$e())}function mt(e){n&&(n.glowQueue.includes(e)||n.glowQueue.push(e))}function ft(e,t){let o=!1;t.cssWidth!==void 0&&t.cssWidth!==e.cssWidth&&(e.cssWidth=t.cssWidth,o=!0),t.cssHeight!==void 0&&t.cssHeight!==e.cssHeight&&(e.cssHeight=t.cssHeight,o=!0),t.cornerRadius!==void 0&&(e.cornerRadius=t.cornerRadius),t.scale!==void 0&&(e.scale=t.scale),t.kind!==void 0&&t.kind!==e.kind&&(e.kind=t.kind,t.shaderScale===void 0&&(e.shaderScale=(t.kind==="circle"?se:ae)*e.scale),t.ringCssPx===void 0&&(e.ringCssPx=(t.kind==="circle"?2:1)*e.scale)),t.shaderScale!==void 0&&(e.shaderScale=t.shaderScale),t.ringCssPx!==void 0&&(e.ringCssPx=t.ringCssPx),t.opacityMul!==void 0&&(e.opacityMul=t.opacityMul),t.paused!==void 0&&t.paused!==e.paused&&(e.paused=t.paused,!t.paused&&n&&n.rafId===0&&n.pausedAtMs===null&&!n.contextLost&&O()),o&&ze(e)}function pt(e,t){e.visible=t,t&&n&&n.rafId===0&&n.pausedAtMs===null&&!n.contextLost&&O()}var xt=null;function gt(e,t){let o=ce();o.preset=xt??j[e].modes[t],o.presetDirty=!0}var me=null;function ht(e){me=e}function ze(e){e.dpr=Math.min(4,2*(typeof window<"u"&&window.devicePixelRatio||1));let t=Math.max(1,Math.round(e.cssWidth*e.dpr)),o=Math.max(1,Math.round(e.cssHeight*e.dpr));e.canvas.width!==t&&(e.canvas.width=t),e.canvas.height!==o&&(e.canvas.height=o)}function _t(e){let{ctx:t,dpr:o,canvas:r}=e,i=e.ringCssPx*o,a=r.width,c=r.height,f=Math.max(0,(e.cornerRadius-e.ringCssPx)*o);t.save(),t.globalCompositeOperation="destination-out",t.fillStyle="#000",t.beginPath(),t.roundRect(i,i,a-2*i,c-2*i,f),t.fill(),t.restore()}function vt(e){if(!n)return;let t=n.frameBitmap??n.glCanvas,o=e.dpr,r=e.canvas.width,i=e.canvas.height;if(r<1||i<1)return;let a=n.glCanvas.width,c=n.glCanvas.height,f=q*o,s=Q*o,l=r*(a/f)/e.shaderScale,p=i*(c/s)/e.shaderScale;l>a&&(l=a),p>c&&(p=c);let d=Math.max(0,(a-l)/2),u=Math.max(0,(c-p)/2),g=e.opacityMul*n.preset.shaderOpacity;if(e.ctx.clearRect(0,0,r,i),g<1&&(e.ctx.globalAlpha=g),e.ctx.drawImage(t,d,u,l,p,0,0,r,i),g<1&&(e.ctx.globalAlpha=1),_t(e),e.onFirstCopy){let x=e.onFirstCopy;e.onFirstCopy=void 0,x()}e.onAfterFrame?.()}function bt(){if(!n)return;let{gl:e,uniforms:t,preset:o,glCanvas:r,dpr:i}=n;t.u_resolution&&e.uniform2f(t.u_resolution,r.width,r.height),t.u_pixelRatio&&e.uniform1f(t.u_pixelRatio,i),t.u_colorBack&&e.uniform4fv(t.u_colorBack,Y(o.colorBack)),t.u_colorTint&&e.uniform4fv(t.u_colorTint,Y(o.colorTint)),t.u_repetition&&e.uniform1f(t.u_repetition,o.repetition),t.u_softness&&e.uniform1f(t.u_softness,o.softness),t.u_shiftRed&&e.uniform1f(t.u_shiftRed,o.shiftRed),t.u_shiftBlue&&e.uniform1f(t.u_shiftBlue,o.shiftBlue),t.u_distortion&&e.uniform1f(t.u_distortion,o.distortion),t.u_contour&&e.uniform1f(t.u_contour,o.contour),t.u_angle&&e.uniform1f(t.u_angle,o.angle),t.u_shape&&e.uniform1f(t.u_shape,o.shape),t.u_isImage&&e.uniform1i(t.u_isImage,0),t.u_imageAspectRatio&&e.uniform1f(t.u_imageAspectRatio,1),t.u_originX&&e.uniform1f(t.u_originX,o.originX),t.u_originY&&e.uniform1f(t.u_originY,o.originY),t.u_worldWidth&&e.uniform1f(t.u_worldWidth,o.worldWidth),t.u_worldHeight&&e.uniform1f(t.u_worldHeight,o.worldHeight),t.u_fit&&e.uniform1f(t.u_fit,o.fit),t.u_scale&&e.uniform1f(t.u_scale,o.scale),t.u_rotation&&e.uniform1f(t.u_rotation,o.rotation),t.u_offsetX&&e.uniform1f(t.u_offsetX,o.offsetX),t.u_offsetY&&e.uniform1f(t.u_offsetY,o.offsetY),n.presetDirty=!1}function St(e){if(!n)return;let{gl:t,uniforms:o,preset:r,glCanvas:i}=n,a=(e-n.startMs-n.pausedMs)/1e3*r.speed;t.viewport(0,0,i.width,i.height),t.clearColor(0,0,0,0),t.clear(t.COLOR_BUFFER_BIT),n.presetDirty&&bt(),o.u_time&&t.uniform1f(o.u_time,a),t.drawArrays(t.TRIANGLES,0,6),n.frameCount++}var de=0;function Xe(e){if(!n)return;if(n.contextLost){n.rafId=0;return}let t=!1;for(let o of n.instances)if(o.visible&&(!o.paused||!o.everCopied)){t=!0;break}if(!t){n.rafId=0;return}if(n.rafId=requestAnimationFrame(Xe),!(e-de<oe)){de=e-(e-de)%oe,St(e),n.useOffscreen&&(n.glowQueue.length>0&&U(),n.frameBitmap?.close(),n.frameBitmap=n.glCanvas.transferToImageBitmap());for(let o of n.instances)o.visible&&(o.paused&&o.everCopied||(vt(o),o.everCopied=!0));if(me&&n.glowQueue.length>0&&++n.glowSkip%Te===0){let o=n.glowQueue;n.glowIdx>=o.length&&(n.glowIdx=0);let r=o[n.glowIdx];r.visible&&!r.paused&&me(r,e),n.glowIdx++}}}function O(){!n||n.rafId!==0||(n.rafId=requestAnimationFrame(Xe))}function Ye(){n&&(n.rafId!==0&&cancelAnimationFrame(n.rafId),n.rafId=0)}var V={linear:e=>e,smoothstep:e=>e*e*(3-2*e)};function A(e,t,o,r=V.linear){return{from:e,to:t,dur:o,ease:r,startMs:-1,val:e,done:!1}}function P(e,t){e.startMs=t,e.val=e.from,e.done=!1}function fe(e,t){if(e.done||e.startMs<0)return e.val;let o=Math.min(1,(t-e.startMs)/e.dur);return e.val=e.from+(e.to-e.from)*e.ease(o),o>=1&&(e.done=!0),e.val}var yt=1.5,$=1/3,wt=4*$,Rt=2*$,Tt=2*$,Mt=1.35*$,It=13*$;function K(e,t,o){let r=Math.max(0,Math.min(o,Math.min(e,t)/2));return 2*Math.max(0,e-2*r)+2*Math.max(0,t-2*r)+2*Math.PI*r}function Z(e,t,o,r){return r==="circle"?2*Math.PI*Math.max(0,Math.min(o,Math.min(e,t)/2)):K(e,t,o)}function G(e,t,o,r,i,a,c,f){let s=f||{x:0,y:0},l=Math.max(0,Math.min(r,Math.min(t,o)/2));if(c==="circle"){let h=2*Math.PI*l;if(h<=1e-4)return s.x=t*.5,s.y=o*.5,s;e=(e%h+h)%h;let y=-Math.PI/2+e/h*Math.PI*2,w=Math.max(0,l-i+a);return s.x=t*.5+w*Math.cos(y),s.y=o*.5+w*Math.sin(y),s}let p=Math.max(0,t-2*l),d=Math.max(0,o-2*l),u=Math.PI*l/2,g=2*(p+d)+4*u;e=(e%g+g)%g;let x=Math.max(0,l-i+a),m=e;if(m<p)return s.x=l+m,s.y=i-a,s;if(m-=p,m<u){let h=-Math.PI/2+(u>0?m/u:0)*(Math.PI/2);return s.x=t-l+x*Math.cos(h),s.y=l+x*Math.sin(h),s}if(m-=u,m<d)return s.x=t-i+a,s.y=l+m,s;if(m-=d,m<u){let h=(u>0?m/u:0)*(Math.PI/2);return s.x=t-l+x*Math.cos(h),s.y=o-l+x*Math.sin(h),s}if(m-=u,m<p)return s.x=t-l-m,s.y=o-i+a,s;if(m-=p,m<u){let h=Math.PI/2+(u>0?m/u:0)*(Math.PI/2);return s.x=l+x*Math.cos(h),s.y=o-l+x*Math.sin(h),s}if(m-=u,m<d)return s.x=i-a,s.y=o-l-m,s;m-=d;let v=Math.PI+(u>0?m/u:0)*(Math.PI/2);return s.x=l+x*Math.cos(v),s.y=l+x*Math.sin(v),s}function ge(e,t){let o=e*2/t,r="";for(let i=0;i<=t;i++){let a=-e+i*o;r+=(i===0?"M ":"L ")+a.toFixed(3)+" 0 "}return r}var pe={x:0,y:0},xe={x:0,y:0};function je(e,t,o,r,i,a){return G(e-.1,t,o,r,i,0,a,pe),G(e+.1,t,o,r,i,0,a,xe),Math.atan2(xe.y-pe.y,xe.x-pe.x)}function he(e,t,o){if(e===t)return o<e?0:1;let r=Math.max(0,Math.min(1,(o-e)/(t-e)));return r*r*(3-2*r)}function qe(e){let t=Z(e.width,e.height,e.cornerRadius,e.kind),o=yt*(e.scale??1),r=[];for(let i=0;i<re;i++){let a=i/re*t,c=G(a,e.width,e.height,e.cornerRadius,o,0,e.kind);r.push({x:c.x,y:c.y,arc:a})}return r}function Qe(e,t){let{width:o,height:r,cornerRadius:i}=e,a=e.scale??1,c=e.kind==="circle"?2:1,f=Math.max(0,i-c),s=(-200*a).toFixed(0),l=s,p=(540*a).toFixed(0),d=(440*a).toFixed(0),u=`x="${s}" y="${l}" width="${p}" height="${d}"`,g=`${u} filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"`,x=v=>(v*a).toFixed(3),m=v=>(v*a).toFixed(3);return["<defs>",`<filter id="${t}_bXl" ${g}><feGaussianBlur stdDeviation="${m(8.4)}"/></filter>`,`<filter id="${t}_bLg" ${g}><feGaussianBlur stdDeviation="${m(4.8)}"/></filter>`,`<filter id="${t}_bMd" ${g}><feGaussianBlur stdDeviation="${m(2.1)}"/></filter>`,`<filter id="${t}_bSm" ${g}><feGaussianBlur stdDeviation="${m(.9)}"/></filter>`,`<filter id="${t}_ebO" ${g}><feGaussianBlur stdDeviation="${m(Tt)}"/></filter>`,`<filter id="${t}_ebC" ${g}><feGaussianBlur stdDeviation="${m(Mt)}"/></filter>`,`<radialGradient id="${t}_fg" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="white"/><stop offset="0.30" stop-color="white"/><stop offset="0.65" stop-color="#404040"/><stop offset="1" stop-color="black"/></radialGradient>`,`<mask id="${t}_fm" maskUnits="userSpaceOnUse" ${u}><rect ${u} fill="black"/><circle id="${t}_fc" cx="0" cy="0" r="${(It*a).toFixed(3)}" fill="url(#${t}_fg)"/></mask>`,`<mask id="${t}_rm" maskUnits="userSpaceOnUse" ${u}><rect ${u} fill="#808080"/><rect x="0" y="0" width="${o}" height="${r}" rx="${i}" ry="${i}" fill="white"/><rect x="${c}" y="${c}" width="${o-c*2}" height="${r-c*2}" rx="${f}" ry="${f}" fill="black"/></mask>`,"</defs>",`<g id="${t}_h" mask="url(#${t}_rm)" opacity="0">`,`<rect ${u} fill="none" pointer-events="none"/>`,`<g id="${t}_hI" stroke="white">`,`<path id="${t}_pXl" stroke-width="${x(26.4)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.385" filter="url(#${t}_bXl)"/>`,`<path id="${t}_pLg" stroke-width="${x(15.6)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.595" filter="url(#${t}_bLg)"/>`,`<path id="${t}_pMd" stroke-width="${x(7.2)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.70" filter="url(#${t}_bMd)"/>`,`<path id="${t}_pSm" stroke-width="${x(3)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.70" filter="url(#${t}_bSm)"/>`,"</g></g>",`<g id="${t}_e" mask="url(#${t}_rm)" opacity="0">`,`<rect ${u} fill="none" pointer-events="none"/>`,`<g mask="url(#${t}_fm)">`,`<g id="${t}_eI" stroke="white">`,`<path id="${t}_eO" stroke-width="${x(wt)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.85" filter="url(#${t}_ebO)"/>`,`<path id="${t}_eC" stroke-width="${x(Rt)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="1.0" filter="url(#${t}_ebC)"/>`,"</g></g></g>"].join("")}var Et=.00875,Ke=.08,Ze=.32,At=.05,Pt=3e3,Je=.85,J=.34,_e=1500,Ct=15,Ft=.0075,Bt=120,Gt=1.5,Lt=7.8,kt=9.13952,Ut=1,Ot=1/3,Vt=.8,$t=3.51,et=2e3,ve=400,Dt=2.625,Ht=1.008,Wt=.31,tt=140,ot=40,rt=20,Nt=0,I={x:0,y:0};function zt(e,t){let o=`mfxg_${++Nt}`,r=document.createElementNS("http://www.w3.org/2000/svg","svg");r.setAttribute("class","metal-fx-glow-svg"),r.setAttribute("preserveAspectRatio","none"),r.setAttribute("viewBox",`0 0 ${t.width} ${t.height}`),r.innerHTML=Qe(t,o),e.appendChild(r);let i=h=>r.querySelector(`#${o}_${h}`),a=i("h"),c=i("hI"),f=i("e"),s=i("eI"),l=i("fc"),p=Z(t.width,t.height,t.cornerRadius,t.kind)/K(tt,ot,rt),d=Math.max(1,Lt*p),u=Math.max(.6,kt*Ot*p),g=ge(d,Me),x=ge(u,Ie),m=[i("pXl"),i("pLg"),i("pMd"),i("pSm")],v=[i("eO"),i("eC")];for(let h of m)h.setAttribute("d",g);for(let h of v)h.setAttribute("d",x);return c.style.transformOrigin="0 0",s.style.transformOrigin="0 0",c.style.willChange="transform",s.style.willChange="transform",c.style.transition="transform 100ms linear",s.style.transition="transform 100ms linear",a.style.willChange="opacity",f.style.willChange="opacity",a.style.transition="opacity 100ms linear",f.style.transition="opacity 100ms linear",l.style.willChange="transform",{svg:r,haloGroup:a,haloInner:c,extraGroup:f,extraInner:s,fadeCircle:l,width:t.width,height:t.height,cornerRadius:t.cornerRadius,kind:t.kind,scale:t.scale??1,perim:qe(t),currentIdx:0,appearedAt:0,glowOpacity:0,relocTween:null,relocNextIdx:-1,wanderS:0,wanderTargetS:0,wanderFrames:0,tintFrom:{r:255,g:255,b:255},tintTarget:{r:255,g:255,b:255},tintTween:null,tintHoldUntil:0,lastHaloStroke:"",lastExtraStroke:""}}function Xt(e,t,o,r,i="dark"){let{width:a,height:c,cornerRadius:f,perim:s}=e;if(s.length===0)return;let l=2,p=-1,d=e.currentIdx,u=0;for(let b=0;b<s.length;b++){let T=s[b],R=ue(t,T.x,T.y,l);R>p&&(p=R,d=b),b===e.currentIdx&&(u=R)}let g=e.appearedAt>0&&o-e.appearedAt<Pt,x=J+(Je-J)*he(Ke,Ze,u),m=!g&&p-u>At;if(!e.relocTween||e.relocTween.done)if(e.appearedAt===0)e.currentIdx=d,e.appearedAt=o,e.wanderS=0,e.wanderTargetS=0,e.wanderFrames=0,e.relocTween=A(0,x,_e,V.smoothstep),P(e.relocTween,o);else if(e.relocTween?.done&&e.relocTween.to===0){e.currentIdx=e.relocNextIdx,e.appearedAt=o,e.wanderS=0,e.wanderTargetS=0,e.wanderFrames=0;let b=s[e.currentIdx],T=ue(t,b.x,b.y,l),R=J+(Je-J)*he(Ke,Ze,T);e.relocTween=A(0,R,_e,V.smoothstep),P(e.relocTween,o)}else m?(e.relocNextIdx=d,e.relocTween=A(e.glowOpacity,0,_e,V.smoothstep),P(e.relocTween,o)):e.glowOpacity+=(x-e.glowOpacity)*Et;e.relocTween&&(e.glowOpacity=fe(e.relocTween,o)),e.glowOpacity=Math.max(0,Math.min(1,e.glowOpacity));let v=Z(a,c,f,e.kind)/K(tt,ot,rt),h=Ct*v;e.wanderFrames++>=Bt&&(e.wanderTargetS=(Math.random()*2-1)*h,e.wanderFrames=0),e.wanderS+=(e.wanderTargetS-e.wanderS)*Ft;let y=s[e.currentIdx].arc+e.wanderS,w=Gt*e.scale;G(y,a,c,f,w,0,e.kind,I);let E=I.x,M=I.y,D=je(y,a,c,f,w,e.kind),be=`translate(${E.toFixed(3)}px,${M.toFixed(3)}px) rotate(${D.toFixed(4)}rad)`;e.haloInner.style.transform=be;let H=Ut*v*e.scale;G(y,a,c,f,w,H,e.kind,I),e.extraInner.style.transform=`translate(${I.x.toFixed(3)}px,${I.y.toFixed(3)}px) rotate(${D.toFixed(4)}rad)`,e.fadeCircle.style.transform=`translate(${I.x.toFixed(3)}px,${I.y.toFixed(3)}px)`;let L=i==="light",W=L?Ne(t,E,M,l):We(t,E,M,l);e.tintTween?e.tintTween.done&&(L?(e.tintFrom={r:e.tintFrom.r+(e.tintTarget.r-e.tintFrom.r)*e.tintTween.val,g:e.tintFrom.g+(e.tintTarget.g-e.tintFrom.g)*e.tintTween.val,b:e.tintFrom.b+(e.tintTarget.b-e.tintFrom.b)*e.tintTween.val},e.tintTarget={...W},e.tintTween=A(0,1,ve),P(e.tintTween,o)):o>=e.tintHoldUntil&&(e.tintFrom={...e.tintTarget},e.tintTarget={...W},e.tintTween=A(0,1,ve),P(e.tintTween,o),e.tintHoldUntil=o+et)):(e.tintFrom={...W},e.tintTarget={...W},e.tintTween=A(0,1,ve),P(e.tintTween,o),e.tintHoldUntil=L?0:o+et),fe(e.tintTween,o);let C=e.tintTween.val,N,z,X;if(L)N=Math.round(e.tintFrom.r+(e.tintTarget.r-e.tintFrom.r)*C),z=Math.round(e.tintFrom.g+(e.tintTarget.g-e.tintFrom.g)*C),X=Math.round(e.tintFrom.b+(e.tintTarget.b-e.tintFrom.b)*C);else{let b=e.tintFrom.r+(e.tintTarget.r-e.tintFrom.r)*C,T=e.tintFrom.g+(e.tintTarget.g-e.tintFrom.g)*C,R=e.tintFrom.b+(e.tintTarget.b-e.tintFrom.b)*C,k=Math.max(b,T,R)||1;N=Math.round(255*(b/k)),z=Math.round(255*(T/k)),X=Math.round(255*(R/k))}let ee=`rgb(${N},${z},${X})`;if(ee!==e.lastHaloStroke&&(e.lastHaloStroke=ee,e.haloInner.style.stroke=ee),L){let b=ye(N,z,X),[T,R,k]=we(b[0],Math.min(1,b[1]*Dt),Math.max(Wt,b[2]*Ht)),te=`rgb(${T},${R},${k})`;te!==e.lastExtraStroke&&(e.lastExtraStroke=te,e.extraInner.style.stroke=te)}else e.lastExtraStroke!=="#ffffff"&&(e.lastExtraStroke="#ffffff",e.extraInner.style.stroke="#ffffff");let Se=Math.max(0,Math.min(1,r));e.haloGroup.style.opacity=(e.glowOpacity*Vt*Se).toFixed(3),e.extraGroup.style.opacity=Math.min(1,e.glowOpacity*$t*Se).toFixed(3)}export{ut as createInstance,dt as destroyInstance,zt as injectGlow,mt as registerGlowInstance,ht as setGlowCallback,pt as setInstanceVisible,gt as setSharedPreset,Xt as updateGlow,ft as updateInstance};
