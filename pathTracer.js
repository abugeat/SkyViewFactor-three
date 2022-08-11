import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeBufferGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
// import * as Stats from 'stats.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import {
	MeshBVH, MeshBVHUniformStruct, FloatVertexAttributeTexture,
	shaderStructs, shaderIntersectFunction, SAH,
} from 'three-mesh-bvh';

const params = {
	enableRaytracing: true,
	smoothImageScaling: false,
	resolutionScale: 1.0 / window.devicePixelRatio,
	accumulate: true,
};

let renderer, camera, scene, gui, controls, stats;
let rtQuad, finalQuad, renderTarget, mesh;
let samples = 0;
let outputContainer;


init();
render();

function init() {

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: false } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setClearColor( 0x09141a );
	renderer.setSize( window.innerWidth, window.innerHeight );
	// https://stackoverflow.com/questions/69345609/three-js-textures-become-grayish-with-renderer-outputencoding-srgbencoding
	// https://learnopengl.com/Advanced-Lighting/Gamma-Correction
	// renderer.outputEncoding = THREE.sRGBEncoding;
	renderer.outputEncoding = THREE.LinearEncoding; 
	document.body.appendChild( renderer.domElement );

	outputContainer = document.getElementById( 'output' );

	// scene setup
	scene = new THREE.Scene();

	

	const axesHelper = new THREE.AxesHelper( 100 );
	scene.add( axesHelper );

	// const light = new THREE.DirectionalLight( 0xffffff, 2 );
	// light.position.set( 0, 1, 1 );
	// scene.add( light );
	// scene.add( new THREE.AmbientLight( 0xb0bec5, 0.9 ) );

	// camera setup
	camera = new THREE.PerspectiveCamera( 55, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 5, 7, -5 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	controls = new OrbitControls( camera, renderer.domElement );
	controls.target.set( 25, 0, -25 );
	controls.update();
	controls.addEventListener( 'change', () => {

		resetSamples();

	} );

	// stats setup
	// stats = new Stats();
	// document.body.appendChild( stats.dom );

	// hand-tuned ray origin offset values to accommodate floating point error. Mobile offset
	// tuned from Pixel 3 device that reports as highp but seemingly has low precision.
	const rtMaterial = new THREE.ShaderMaterial( {

		// defines: {
		// 	BOUNCES: 5,
		// },

		uniforms: {
			bvh: { value: new MeshBVHUniformStruct() },
			normalAttribute: { value: new FloatVertexAttributeTexture() },
			cameraWorldMatrix: { value: new THREE.Matrix4() },
			invProjectionMatrix: { value: new THREE.Matrix4() },
			seed: { value: 0 },
			opacity: { value: 1 },
		},

		vertexShader: /* glsl */`

			varying vec2 vUv;
			void main() {

				vec4 mvPosition = vec4( position, 1.0 );
				mvPosition = modelViewMatrix * mvPosition;
				gl_Position = projectionMatrix * mvPosition;

				vUv = uv;

			}

		`,

		fragmentShader: /* glsl */`
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

			// random function
			float random(vec2 xy)
			{
				return fract(sin(dot(xy,vec2(12.9898,78.233)))*43758.5453123);
			}

			// perpendicular vector function
			vec3 perpvec(vec3 v) 
			{
				vec3 newvec;
			    
				if (v.z<v.x)
				{newvec = normalize(vec3(v.y,-v.x,0.0));}
				else
				{newvec = normalize(vec3(0.0,-v.z,v.y));}
		
				return newvec;
			}

			vec4 getQuaternion(vec3 ax, float angle)
			{
				float half_angle = angle/2.0;
				float sin_half_angle = sin(half_angle);
                
                vec4 quat;
				quat.x = ax.x * sin_half_angle;
				quat.y = ax.y * sin_half_angle;
				quat.z = ax.z * sin_half_angle;
				quat.w = cos(half_angle);
				
				return quat;
			}

			vec3 rotateWithQuat(vec3 inivec, vec4 quat)
			{
				vec3 temp = cross(quat.xyz, inivec) + quat.w * inivec;
				vec3 rotated = inivec + 2.0*cross(quat.xyz, temp);

				return rotated;
			}

			vec3 viewFactorDirectionGenerator(vec3 normal, vec2 randpara)
			{	
				// get random angle (with cos rule)
				float randAngCos = asin(random(randpara));
				// rotate faceNormal around abitrary axis
				vec3 arbitraryax = perpvec(normal); 
				vec4 quatOne = getQuaternion(arbitraryax, randAngCos);
				vec3 newDirection = rotateWithQuat(normal, quatOne);
				
				// get random angle (uniform)
				float randAng = random(vec2(randpara.y,randpara.x)) * 2.0 * PI;
				// rotate new vec around faceNormal
				vec4 quatTwo = getQuaternion(normal, randAng);
				newDirection = rotateWithQuat(newDirection, quatTwo);
				
				return newDirection;
			}

			void main() {

				// get [-1, 1] normalized device coordinates
				vec2 ndc = 2.0 * vUv - vec2( 1.0 );
				vec3 rayOrigin, rayDirection;
				ndcToCameraRay( ndc, cameraWorldMatrix, invProjectionMatrix, rayOrigin, rayDirection );

				// Lambertian render
				gl_FragColor = vec4( 0.0 );

				vec3 throughputColor = vec3( .0 );
				// vec3 randomPoint = vec3( .0 );

				// hit results
				uvec4 faceIndices = uvec4( 0u );
				vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
				vec3 barycoord = vec3( 0.0 );
				float side = 1.0;
				float dist = 0.0;

				for ( int i = 0; i <= 1; i ++ ) { // Correspond to 0 reflexion, 2 rays: 1 for camera view and 1 for pixel color

					if ( ! bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist ) ) {

						vec3 skyColor = vec3(1.0, 1.0, 1.0);

						if (i == 1 && rayDirection.y > 0.0 ){
							gl_FragColor = vec4(1.0, 1.0, 1.0 , 1.0 );
						} else {
							gl_FragColor = vec4(0.0, 0.0, 0.0 , 1.0 );
						}
						// https://learnopengl.com/Advanced-Lighting/Gamma-Correction
						
						break;

					}

					// adjust the hit point by the surface normal by a factor of some offset and the
					// maximum component-wise value of the current point to accommodate floating point
					// error as values increase.
					vec3 point = rayOrigin + rayDirection * dist;
					vec3 absPoint = abs( point );
					float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );
					rayOrigin = point + faceNormal * ( maxPoint ) * RAY_OFFSET;

					// VIEW FACTOR RAY DIRECTION GENERATION
					rayDirection = normalize(viewFactorDirectionGenerator(faceNormal, vec2(seed, abs(point.x + point.y + point.z))));
					// rayDirection = viewFactorDirectionGenerator(faceNormal, vec2(seed, abs(faceNormal.x + faceNormal.y + faceNormal.z)));
				}

				gl_FragColor.a = opacity;

			}

		`

	} );

	rtQuad = new FullScreenQuad( rtMaterial );
	rtMaterial.transparent = true;
	rtMaterial.depthWrite = false;

	// load mesh and set up material BVH attributes
	new GLTFLoader().load( './cordoba.glb', gltf => {

		let dragonMesh;
		gltf.scene.traverse( c => {

			if ( c.isMesh ) { //&& c.name === 'Dragon' 

				dragonMesh = c;
				c.geometry.scale( 0.1, 0.1, 0.1 ).rotateX( -Math.PI / 2 );

			}

		} );

		const planeGeom = new THREE.PlaneBufferGeometry( 1, 1, 1, 1 );
		planeGeom.rotateX( - Math.PI / 2 );

		const merged = mergeBufferGeometries( [ planeGeom, dragonMesh.geometry ], false );
		// merged = mergeBufferGeometries( [dragonMesh.geometry ], false );
		// merged.translate( 0, - 0.5, 0 );
		// merged.rotateX(-Math.PI / 2);

		mesh = new THREE.Mesh( merged, new THREE.MeshStandardMaterial() );
		scene.add( mesh );

		const bvh = new MeshBVH( mesh.geometry, { maxLeafTris: 1, strategy: SAH } );
		rtMaterial.uniforms.bvh.value.updateFrom( bvh );
		rtMaterial.uniforms.normalAttribute.value.updateFrom( mesh.geometry.attributes.normal );

	} );

	renderTarget = new THREE.WebGLRenderTarget( 1, 1, {

		format: THREE.RGBAFormat,
		type: THREE.FloatType,

	} );

	finalQuad = new FullScreenQuad( new THREE.MeshBasicMaterial( {

		map: renderTarget.texture,

	} ) );



	gui = new GUI();
	gui.add( params, 'enableRaytracing' ).name( 'enable' );
	gui.add( params, 'accumulate' );
	gui.add( params, 'smoothImageScaling' );
	gui.add( params, 'resolutionScale', 0.1, 1, 0.01 ).onChange( resize );
	// gui.add( params, 'bounces', 1, 10, 1 ).onChange( v => {

	// 	rtMaterial.defines.BOUNCES = parseInt( v );
	// 	rtMaterial.needsUpdate = true;
	// 	resetSamples();

	// } );
	gui.open();

	window.addEventListener( 'resize', resize, false );
	resize();

}

function resetSamples() {

	samples = 0;

}

function resize() {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	const w = window.innerWidth;
	const h = window.innerHeight;
	const dpr = window.devicePixelRatio * params.resolutionScale;
	renderer.setSize( w, h );
	renderer.setPixelRatio( dpr );

	renderTarget.setSize( w * dpr, h * dpr );

	resetSamples();

}

function render() {

	// stats.update();
	requestAnimationFrame( render );

	renderer.domElement.style.imageRendering = params.smoothImageScaling ? 'auto' : 'pixelated';

	if ( mesh && params.enableRaytracing ) {

		// jitter camera for AA
		if ( params.accumulate ) {

			if ( samples === 0 ) {

				camera.clearViewOffset();

			} else {

				const w = renderTarget.width;
				const h = renderTarget.height;
				camera.setViewOffset(
					w, h,
					Math.random() - 0.5, Math.random() - 0.5,
					w, h,
				);

			}

		} else {

			resetSamples();

		}

		camera.updateMatrixWorld();

		// update material
		// keep appending a value that doesn't divide evenly into 2 so we have a different seed every frame
		const seed = ( rtQuad.material.uniforms.seed.value + 0.11111 ) % 2;
		rtQuad.material.uniforms.seed.value = seed;
		rtQuad.material.uniforms.cameraWorldMatrix.value.copy( camera.matrixWorld );
		rtQuad.material.uniforms.invProjectionMatrix.value.copy( camera.projectionMatrixInverse );
		rtQuad.material.uniforms.opacity.value = 1 / ( samples + 1 );

		// render float target
		renderer.autoClear = samples === 0;
		renderer.setRenderTarget( renderTarget );
		rtQuad.render( renderer );

		// render to screen
		renderer.setRenderTarget( null );
		finalQuad.render( renderer );

		renderer.autoClear = true;
		samples ++;

		////////////////////
		// Cursor color inspector
		const read = new Float32Array( 4 );
		renderer.readRenderTargetPixels( renderTarget, mouseX*params.resolutionScale, (window.innerHeight * params.resolutionScale) - mouseY*params.resolutionScale , 1, 1, read );
		cursor.innerHTML = Math.round(read[0]*100) + " %";

	} else {

		resetSamples();
		camera.clearViewOffset();
		
		renderer.render( scene, camera );

	}

	outputContainer.innerText = `samples: ${ samples }`;

}


// Cursor
// let circle = document.getElementById('circle');

const cursor = document.querySelector('.cursor');

let mouseX = 0;
let mouseY = 0;

let cursorX = 0;
let cursorY = 0;

let speed = 1.0; // change to increase the ease

function animate() {
    let distX = mouseX - cursorX;
    let distY = mouseY - cursorY;

    cursorX = cursorX + (distX * speed);
    cursorY = cursorY + (distY * speed);

    cursor.style.left = cursorX + 'px';
    cursor.style.top = cursorY + 'px';

    requestAnimationFrame(animate);
}

animate();

document.addEventListener('mousemove', (event) => {
    mouseX = event.pageX;
    mouseY = event.pageY;
});


