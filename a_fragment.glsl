
#define RAY_OFFSET 1e-5

precision highp isampler2D;
precision highp usampler2D;
${ shaderStructs}
${shaderIntersectFunction}
#include <common>

uniform mat4 cameraWorldMatrix;
uniform mat4 invProjectionMatrix;
uniform sampler2D normalAttribute;
uniform BVH bvh;
uniform float seed;
uniform float opacity;
varying vec2 vUv;

void main() {
    rand()
}
