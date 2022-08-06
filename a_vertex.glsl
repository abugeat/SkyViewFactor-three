
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

    // get [-1, 1] normalized device coordinates
    vec2 ndc = 2.0 * vUv - vec2( 1.0 );
    vec3 rayOrigin, rayDirection;
    ndcToCameraRay( ndc, cameraWorldMatrix, invProjectionMatrix, rayOrigin, rayDirection );

    // Lambertian render
    gl_FragColor = vec4( 0.0 );

    vec3 throughputColor = vec3( 1.0 );
    vec3 randomPoint = vec3( .0 );

    // hit results
    uvec4 faceIndices = uvec4( 0u );
    vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
    vec3 barycoord = vec3( 0.0 );
    float side = 1.0;
    float dist = 0.0;

    // for ( int i = 0; i < BOUNCES; i ++ ) {
    for ( int i = 0; i <= 1; i ++ ) { // Correspond to 0 reflexion, 2 rays: 1 for camera view and 1 for pixel color

        if ( ! bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist ) ) {

            float value = ( rayDirection.y + 0.5 ) / 1.5;
            // vec3 skyColor = mix( vec3( 1.0 ), vec3( 1.0, 1.0, 1.0 ), value );
            vec3 skyColor = vec3( 1.0, 1.0, 1.0);

            // gl_FragColor = vec4( skyColor * throughputColor * 2.0, 1.0 );
            gl_FragColor = vec4( 1.0, 1.0, 1.0 ,10.0 );

            break;

        }

        // 1 / PI attenuation for physically correct lambert model
        // https://www.rorydriscoll.com/2009/01/25/energy-conservation-in-games/
        throughputColor *= 1.0 / PI;

        randomPoint = vec3(
            rand( vUv + float( i + 1 ) + vec2( seed, seed ) ),
            rand( - vUv * seed + float( i ) - seed ),
            rand( - vUv * float( i + 1 ) - vec2( seed, - seed ) )
        );
        randomPoint -= 0.5;
        randomPoint *= 2.0;

        // ensure the random vector is not 0,0,0 and that it won't exactly negate
        // the surface normal

        float pointLength = max( length( randomPoint ), 1e-4 );
        randomPoint /= pointLength;
        randomPoint *= 0.999;

        // fetch the interpolated smooth normal
        vec3 normal =
            side *
            textureSampleBarycoord(
                normalAttribute,
                barycoord,
                faceIndices.xyz
            ).xyz;

        // adjust the hit point by the surface normal by a factor of some offset and the
        // maximum component-wise value of the current point to accommodate floating point
        // error as values increase.
        vec3 point = rayOrigin + rayDirection * dist;
        vec3 absPoint = abs( point );
        float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );
        rayOrigin = point + faceNormal * ( maxPoint + 1.0 ) * RAY_OFFSET;
        
        // INSERT RANDOM FUNCTION FOR NEW DIRECTION FOR SKY VIEW FACTOR COMPUTATION
        
        rayDirection = faceNormal; //normalize(vec3(1.0,1.0,0.0)); // normalize( normal + randomPoint );

    }

    gl_FragColor.a = opacity;

}
