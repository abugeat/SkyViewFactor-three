import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { IFCLoader } from "web-ifc-three/IFCLoader";
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
// import { BufferGeometryUtils } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
// import * as Stats from 'stats.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import {
	MeshBVH, MeshBVHUniformStruct, FloatVertexAttributeTexture,
	shaderStructs, shaderIntersectFunction, SAH
} from 'three-mesh-bvh';
// import { DoubleSide } from 'three';   
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils";
import { MeshNormalMaterial, ObjectLoader } from 'three';


const params = {
	enableRaytracing: true,
	smoothImageScaling: true,
	resolutionScale: 1.0, // / window.devicePixelRatio,
	accumulate: true,
	importModel: () => document.getElementById("inputfile").click(),
	changeModelUp: () => changeModelUp(),
	invertModelUp: () => invertModelUp(),
	me: () => window.open('https://www.linkedin.com/in/antoine-bugeat-452167123/', '_blank').focus(),
	colorbar: true,
	saveIm: () => getImageData = true,
};



let renderer, camera, scene, gui, controls;
let rtQuad, finalQuad, renderTarget, mesh;
let samples = 0;
let outputContainer;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let rtMaterial;
let getImageData = false;
let controlsLocked = false;


// THREE.Object3D.DefaultUp.set( 0, 0, 1 );


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
	axesHelper.name = 'axesHelper';
	scene.add( axesHelper );

	// const light = new THREE.DirectionalLight( 0xffffff, 2 );
	// light.position.set( 0, 1, 1 );
	// scene.add( light );
	// scene.add( new THREE.AmbientLight( 0xb0bec5, 0.9 ) );

	// camera setup
	camera = new THREE.PerspectiveCamera( 55, window.innerWidth / window.innerHeight, 0.1, 50 );
	// camera.position.set( 5, 7, -5 );
	camera.position.set( 0, 40, -60 );
	camera.far = 100000;
	camera.updateProjectionMatrix();

	controls = new OrbitControls( camera, renderer.domElement );
	// controls.target.set( 25, 0, -25 );
	controls.target.set( 0, 0, 0 );
	controls.update();
	controls.addEventListener( 'change', () => {
		if (!controlsLocked) {
			resetSamples();
		}
	});


	// SHADER
	rtMaterial = new THREE.ShaderMaterial( {

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
			${shaderStructs}
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
			    
				if (abs(v.z)<abs(v.x))
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
				gl_FragColor = vec4( 0.0,0.0,0.0,1.0 );

				// hit results
				uvec4 faceIndices = uvec4( 0u );
				vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
				vec3 barycoord = vec3( 0.0 );
				float side = 1.0;
				float dist = 0.0;

				for ( int i = 0; i <= 1; i ++ ) { // Correspond to 0 reflexion, 2 rays: 1 for camera view and 1 for pixel color

					if ( ! bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist ) ) {

						//vec3 skyColor = vec3(1.0, 1.0, 1.0);

						if (i == 1) {
							if (rayDirection.y > 0.0) {
								gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
							} 
							// else
							// {
							// 	gl_FragColor = vec4(-0.5, -0.5, -0.5, 1.0);
							// }
						} 

						// https://learnopengl.com/Advanced-Lighting/Gamma-Correction
						
						break;

					} 

					// adjust the hit point by the surface normal by a factor of some offset and the
					// maximum component-wise value of the current point to accommodate floating point
					// error as values increase.
					vec3 point = rayOrigin + rayDirection * dist;
					vec3 absPoint = abs( point );
					float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) ) + 1.0;
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


	// DEFAULT MODEL
	loadModel("cordoue.glb","glb");
	

	// LOADER	
	const input = document.getElementById("inputfile");
	input.addEventListener("change", (event) => {
		
	  	const file = event.target.files[0];
	  	const url = URL.createObjectURL(file);
		const fileName = file.name;
		const fileExt = fileName.split('.').pop();

		// enable loading animation
		document.getElementById("loading").style.display = "flex";
		
		loadModel(url, fileExt);
		
		// const url = 'https://github.com/abugeat/3Dmodels/blob/main/cordoue.glb';
	  	// loader.load(url, (gltf) => { //./cordoba.glb sacrecoeur.glb cordoue.glb torino.glb
			
		// 	// remove previous model
		// 	while(scene.children.length > 0){ 
		// 		scene.remove(scene.children[0]); 
		// 	}
			
		// 	let subMesh;
		// 	gltf.scene.traverse( c => {
		// 		if ( c.isMesh ) { //&& c.name === 'Dragon' 
		// 			subMesh = c;
		// 			// let center = getCenterPoint(c);
		// 			// c.geometry.translateX(-center.x);
		// 			// c.geometry.translateY(-center.y);
		// 			// c.geometry.translateZ(-center.z);
		// 		}
		// 	} );

		// 	// move mesh barycenter to global origin
		// 	let center = getCenterPoint(subMesh);
		// 	subMesh.geometry.translate(-center.x, -center.y, -center.z);
			
		// 	mesh = new THREE.Mesh( subMesh.geometry, new THREE.MeshBasicMaterial( { color: 0xff0000, wireframe: true }) );
			
		// 	scene.add( mesh );

		// 	camera.position.set( 0, 40, -60 );
		// 	controls.target.set( 0, 0, 0 );
		// 	controls.update();

		// 	newBVH();
			
		// 	resetSamples();

	});
	// });



	renderTarget = new THREE.WebGLRenderTarget( 1, 1, {

		format: THREE.RGBAFormat,
		type: THREE.FloatType,

	} );

	finalQuad = new FullScreenQuad( new THREE.MeshBasicMaterial( {

		map: renderTarget.texture,

	} ) );



	gui = new GUI();
	gui.title("SkyViewFactor-three");

	const folder_model = gui.addFolder( 'Model' );
	folder_model.add( params, 'importModel' ).name( 'Import your model' ).onChange( () => {
		
		const input = document.getElementById("inputfile");
		input.click();
	
	});
	folder_model.add( params, 'changeModelUp' ).name( 'Change model up' );
	folder_model.add( params, 'invertModelUp' ).name( 'Invert model up' );
	

	const folder_computation = gui.addFolder( 'Computation' );
	folder_computation.add( params, 'enableRaytracing' ).name( 'Enable' );
	folder_computation.add( params, 'accumulate' ).name( 'Accumulate' );
	folder_computation.add( params, 'smoothImageScaling' ).name( 'Smooth' );
	folder_computation.add( params, 'resolutionScale', 0.1, 1, 0.01 ).name( 'Resolution scale' ).onChange( resize );
	
	const folder_features = gui.addFolder( 'Features' );
	folder_features.add( params, "colorbar").name( 'Show SVF scale').onChange( () => {
		if (params.colorbar) {
			document.getElementById("gradient").style.display = 'flex'; 
		} else {
			document.getElementById("gradient").style.display = 'none'; 
		}
	});
	folder_features.add( params, "saveIm").name( 'Save as .PNG' );

	const folder_about = gui.addFolder( 'About');
	folder_about.add( params, 'me' ).name( 'Me' );

	gui.open(false);

	window.addEventListener( 'resize', resize, false );

	resize();

}

function loadModel(url, fileExt) {
	let loader;
	const material = new THREE.MeshPhysicalMaterial({
		color: 0xffffff,
		// envMap: envTexture,
		metalness: 0.25,
		roughness: 0.1,
		opacity: 1.0,
		// transparent: true,
		// transmission: 0.5,
		side: THREE.DoubleSide,
		emissive: 0xee82ee,
		clearcoat: 1.0,
		clearcoatRoughness: 0.25,
		// wireframe: true 
	});

	// remove previous model
	for (let c=0; c<scene.children.length; c++) {
		if (scene.children[c].name != 'axesHelper') {
			scene.remove(scene.children[c]);
		}
	}
	// while(scene.children.length > 0){
	// 	console.log(scene.children[0].name != 'axesHelper');
		 
	// }

	switch (fileExt) {
		case "glb":
			loader = new GLTFLoader();
			loader.load(url, (gltf) => { //./cordoba.glb sacrecoeur.glb cordoue.glb torino.glb
				
				let subGeoList = [];
				gltf.scene.traverse( c => {
					if ( c.isMesh) { 
						subGeoList.push(c.geometry);

					}
				} );

				let meshgeometriesmerged = BufferGeometryUtils.mergeBufferGeometries(subGeoList, false);  
				
				// mesh = new THREE.Mesh( subMesh.geometry, new THREE.MeshBasicMaterial( { color: 0xff0000, wireframe: true }) );
				mesh = new THREE.Mesh( meshgeometriesmerged, material );

				// move mesh barycenter to global origin
				let center = getCenterPoint(mesh);
				mesh.geometry.translate(-center.x, -center.y, -center.z);

				scene.add( mesh );
	
				camera.position.set( 0, 40, -60 );
				controls.target.set( 0, 0, 0 );
				controls.update();
	
				newBVH();
				
				resetSamples();

				// disable loading animation
				document.getElementById("loading").style.display = "none";
	
			});
			break;
		
		case "stl":
			loader = new STLLoader();
			loader.load(url, (geometry) => {				
			
				mesh = new THREE.Mesh(geometry, material);

				// move mesh barycenter to global origin
				let center = getCenterPoint(mesh);
				mesh.geometry.translate(-center.x, -center.y, -center.z);
											
				scene.add(mesh);

				camera.position.set( 0, 40, -60 );
				controls.target.set( 0, 0, 0 );
				controls.update();
	
				newBVH();
				
				resetSamples();

				// disable loading animation
				document.getElementById("loading").style.display = "none";
			}
			// (xhr) => {
			// 	console.log((xhr.loaded / xhr.total) * 100 + '% loaded')
			// },
			// (error) => {
			// 	console.log(error)
			// }
			);
			break;

		case "obj":
			loader = new OBJLoader();
			loader.load(url, (object) => {
				// console.log(object);
				let subGeoList = [];
				for (let i=0; i< object.children.length; i++) {
					let children = object.children[i];
					if (children.isMesh) {
						subGeoList.push(children.geometry);
					}
				}

				let meshgeometriesmerged = BufferGeometryUtils.mergeBufferGeometries(subGeoList, false);  
				
				// mesh = new THREE.Mesh( subMesh.geometry, new THREE.MeshBasicMaterial( { color: 0xff0000, wireframe: true }) );
				mesh = new THREE.Mesh( meshgeometriesmerged, material );

				// move mesh barycenter to global origin
				let center = getCenterPoint(mesh);
				mesh.geometry.translate(-center.x, -center.y, -center.z);

				scene.add( mesh );
	
				camera.position.set( 0, 40, -60 );
				controls.target.set( 0, 0, 0 );
				controls.update();
	
				newBVH();
				
				resetSamples();

				// disable loading animation
				document.getElementById("loading").style.display = "none";

			}
			);
			break;

		case "ifc":
			loader = new IFCLoader();
			loader.ifcManager.setWasmPath("wasm/");
			loader.load(url, (ifcModel) => {
				
				// TO avoid Multi-root error when building bvh!
				ifcModel.geometry.clearGroups(); 

				mesh = new THREE.Mesh(ifcModel.geometry, material);

				// move mesh barycenter to global origin
				let center = getCenterPoint(mesh);
				mesh.geometry.translate(-center.x, -center.y, -center.z);
											
				scene.add(mesh);

				camera.position.set( 0, 40, -60 );
				controls.target.set( 0, 0, 0 );
				controls.update();
				
				newBVH();
				
				resetSamples();

				// disable loading animation
				document.getElementById("loading").style.display = "none";
			}
			);
			break;

		default:
			console.log(`Sorry, file format not recognized.`);
	}
	
}

function saveImage() {
	requestAnimationFrame(render);
	// renderer.render(scene, camera);
	let imgData = renderer.domElement.toDataURL();
	getImageData = false;
	const a = document.createElement("a");
	a.href = imgData.replace(/^data:image\/[^;]/, 'data:application/octet-stream');
	a.download = "image.png";
	a.click();
}

function changeModelUp() {

	mesh.geometry.rotateX(Math.PI/2);
	mesh.geometry.rotateY(Math.PI/2);

	newBVH();

	resetSamples();


}

function invertModelUp() {
	mesh.geometry.rotateX(Math.PI);
	
	newBVH();

	resetSamples();
}

function newBVH() {

	const bvh = new MeshBVH( mesh.geometry, {maxDepth: 400, verbose: true, maxLeafTris: 1, strategy: SAH } );
	rtMaterial.uniforms.bvh.value.updateFrom( bvh );
	rtMaterial.uniforms.normalAttribute.value.updateFrom( mesh.geometry.attributes.normal );

}

function resetSamples() {

	console.log("hello");
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

		updateSVFCursorvalue();

	} else {

		resetSamples();
		camera.clearViewOffset();

		renderer.render( scene, camera );

	}

	if (getImageData == true){
		saveImage();
	}

	outputContainer.innerText = `samples: ${ samples }`;

}

function updateSVFCursorvalue() {
	// Cursor color inspector
	const read = new Float32Array( 4 );
	let xpos = mouseX*params.resolutionScale*window.devicePixelRatio;
	let ypos = (window.innerHeight * params.resolutionScale*window.devicePixelRatio) - mouseY*params.resolutionScale*window.devicePixelRatio ;
	const readtop = new Float32Array( 4 );
	const readbottom = new Float32Array( 4 );
	const readleft = new Float32Array( 4 );
	const readright = new Float32Array( 4 );
	renderer.readRenderTargetPixels( renderTarget, xpos, ypos, 1, 1, read );
	renderer.readRenderTargetPixels( renderTarget, xpos, ypos-1, 1, 1, readbottom );
	renderer.readRenderTargetPixels( renderTarget, xpos, ypos+1, 1, 1, readtop );
	renderer.readRenderTargetPixels( renderTarget, xpos-1, ypos, 1, 1, readleft );
	renderer.readRenderTargetPixels( renderTarget, xpos+1, ypos, 1, 1, readright );
	const readcolor = (read[0] + readbottom[0] + readtop[0] + readleft[0] + readright[0]) / 5;
	cursor.innerHTML = Math.round(readcolor*100) + " %";

	// svf level colorbar
	document.getElementById("svfcursorlevel").style.bottom = (readcolor*100).toFixed(1).toString()+"%";
}

function getCenterPoint(mesh) {
	var geometry = mesh.geometry;
	geometry.computeBoundingBox();
	var center = new THREE.Vector3();
	geometry.boundingBox.getCenter( center );
	mesh.localToWorld( center );
	return center;
}

// SVF Cursor
const cursor = document.querySelector('.cursor');

let mouseX = -100;
let mouseY = -100;

document.addEventListener('mousemove', (event) => {
    mouseX = event.pageX;
    mouseY = event.pageY;
});

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





// IMPROVED ORBIT CONTROLS
document.addEventListener('mousedown', (event) => {
	// get view direction
	let viewDirection = new THREE.Vector3();
	camera.getWorldDirection( viewDirection );

	// update only if not looking into the bottom direction
	if (viewDirection.y > -0.999) {
		updatecontroltarget(event);
	}
});

function updatecontroltarget(event) {
	// NOT USED ! pointer: normalized position of the cursor [-1, 1] x,y (0,0 is the middle of the window) 
	// pointer.x = (event.pageX / window.innerWidth) * 2 - 1;
	// pointer.y = - (event.pageY / window.innerHeight) * 2 + 1;

	// update the picking ray with the camera and pointer position
	raycaster.setFromCamera( new THREE.Vector2(0.0, 0.0), camera );
	// raycaster.setFromCamera( pointer, camera );

	// calculate objects intersecting the picking ray
	const intersects = raycaster.intersectObjects( scene.children );


	// set the control target to the closest point
	if (intersects.length > 0) {
		if (intersects[0].distance > 0.001) {
			controls.target.copy(intersects[0].point);
			controls.update();
		}
	}

}


// disable controls when hover lil-gui
let lilguidiv = document.getElementsByClassName("lil-gui root")[0];
lilguidiv.addEventListener('mouseover', (event) => {
	controlsLocked = true;
});
lilguidiv.addEventListener('mouseout', (event) => {
	controlsLocked = false;
});