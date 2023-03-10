import { createSignal, createEffect } from 'solid-js';
import {
	createMutable,
	createStore,
	modifyMutable,
	produce,
} from 'solid-js/store';
import {
	WebGLRenderer,
	PerspectiveCamera,
	Scene,
	AnimationMixer,
	sRGBEncoding,
	PCFSoftShadowMap,
	DirectionalLight,
	AmbientLight,
	Mesh,
	PlaneGeometry,
	MeshStandardMaterial,
	CubeTextureLoader,
	Vector3,
	Camera,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { Entity } from '../types/Entity';
import useEventListener from './useEventListener';

function createDemo(container: HTMLDivElement) {
	const fov = 60;
	const aspect = 1920 / 1080;
	const near = 1.0;
	const far = 1000.0;

	const renderer = createMutable(new WebGLRenderer({ antialias: true }));
	const camera = createMutable(new PerspectiveCamera(fov, aspect, near, far));
	camera.position.set(25, 10, 25);
	const scene = createMutable(new Scene());
	const [mixers, setMixers] = createStore<AnimationMixer[]>([]);
	const [prevRAF, setPrevRAF] = createSignal<number | null>(null);
	const [controls, setControls] = createSignal<Entity>();
	const [orbControls, setOrbControls] = createSignal<OrbitControls>();
	const [plane, setPlane] = createSignal(
		new Mesh(
			new PlaneGeometry(100, 100, 10, 10),
			new MeshStandardMaterial({
				color: 0x808080,
			})
		)
	);

	modifyMutable(
		renderer,
		produce((_renderer) => {
			_renderer.outputEncoding = sRGBEncoding;
			_renderer.shadowMap.enabled = true;
			_renderer.shadowMap.type = PCFSoftShadowMap;
			_renderer.setPixelRatio(window.devicePixelRatio);
			_renderer.setSize(container.offsetWidth, container.offsetHeight);
		})
	);

	const [prevChild, setPrevChild] = createSignal<HTMLCanvasElement>();
	createEffect(() => {
		if (prevChild())
			container.replaceChild(prevChild()!, renderer.domElement);
		else container.appendChild(renderer.domElement);
		setPrevChild(renderer.domElement);
	});

	createEffect(() => {
		setOrbControls(new OrbitControls(camera, renderer.domElement));
		orbControls()!.enableDamping = true;
		orbControls()!.target.set(0, 10, 0);
		// orbControls()!.minAzimuthAngle = Math.PI;
		// orbControls()!.maxAzimuthAngle = Math.PI;
		orbControls()!.update();
	});

	const dirLight: DirectionalLight = new DirectionalLight(0xffffff, 1.0);
	dirLight.position.set(-100, 100, 100);
	dirLight.target.position.set(0, 0, 0);
	dirLight.castShadow = true;
	dirLight.shadow.bias = -0.001;
	dirLight.shadow.mapSize.width = 4096;
	dirLight.shadow.mapSize.height = 4096;
	dirLight.shadow.camera.near = 0.1;
	dirLight.shadow.camera.far = 500.0;
	dirLight.shadow.camera.near = 0.5;
	dirLight.shadow.camera.far = 500.0;
	dirLight.shadow.camera.left = 50;
	dirLight.shadow.camera.right = -50;
	dirLight.shadow.camera.top = 50;
	dirLight.shadow.camera.bottom = -50;
	const ambLight = new AmbientLight(0xffffff, 0.25);

	plane().castShadow = false;
	plane().receiveShadow = true;
	plane().rotation.x = -Math.PI / 2;

	const loader = new CubeTextureLoader();
	const texture = loader.load([
		'./images/qwop/posx.jpg',
		'./images/qwop/negx.jpg',
		'./images/qwop/posy.jpg',
		'./images/qwop/negy.jpg',
		'./images/qwop/posz.jpg',
		'./images/qwop/negz.jpg',
	]);
	texture.encoding = sRGBEncoding;

	modifyMutable(
		scene,
		produce((_scene) => {
			_scene.add(dirLight);
			_scene.add(ambLight);
			_scene.add(plane());
			_scene.background = texture;
		})
	);

	createEffect(() => {
		modifyMutable(
			scene,
			produce((_scene) => {
				_scene.add(plane());
			})
		);
	});

	const loadAnimatedModel = () => {};

	const step = (timeElapsed: number) => {
		const timeElapsedS = timeElapsed * 0.001;
		if (mixers.length > 0) {
			mixers.map((m) => m.update(timeElapsedS));
		}

		// if (orbControls()) orbControls()!.update();

		if (controls()) {
			controls()!.update(timeElapsedS);

			// modifyMutable(
			// 	camera,
			// 	produce((_camera) => {
			// 		const target = controls()?.target();
			// 		if (target) {
			// 			_camera.position.copy(target.position);
			// 			_camera.position.add(new Vector3(0, 10, -20));
			// 			// _camera.quaternion.copy(target.quaternion);
			// 		}
			// 	})
			// );
		}
	};

	// createEffect(() => {
	// 	modifyMutable(
	// 		camera,
	// 		produce((_camera) => {
	// 			const target = controls()?.target();
	// 			if (target) {
	// 				_camera.position.copy(target.position);
	// 				_camera.quaternion.copy(target.quaternion);
	// 			}
	// 		})
	// 	);
	// });

	const updateCamera = (callback: (camera: Camera) => void) => {
		modifyMutable(
			camera,
			produce((_camera) => {
				callback(camera);
			})
		);
	};

	const [_update, _setUpdate] = createSignal<(timeElapsed: number) => void>();
	const onUpdate = (fn: (timeElapsed: number) => void) =>
		_setUpdate((_) => fn);
	const RAF = () => {
		requestAnimationFrame((t) => {
			if (prevRAF() === null) setPrevRAF(t);

			RAF();

			renderer.render(scene, camera);

			step(t - (prevRAF() ?? 0));
			if (_update()) _update()!(t);
			setPrevRAF(t);
		});
	};

	const onWindowResize = () => {
		// timeout necessary to allow container to resize before accessing its dimensions
		// timeout of 0 basically indicates "wait until other queued stuff is done"
		setTimeout(() => {
			modifyMutable(
				camera,
				produce((_camera) => {
					_camera.aspect =
						container.offsetWidth / container.offsetHeight;
					_camera.updateProjectionMatrix();
				})
			);
			renderer.setSize(container.offsetWidth, container.offsetHeight);
		}, 0);
	};

	useEventListener('resize', onWindowResize);
	RAF();

	return {
		renderer,
		camera,
		scene,
		mixers,
		orbControls,
		plane,
		updateCamera,
		onUpdate,
		prevRAF,
		controls,
		setMixers,
		setPrevRAF,
		setControls,
		setOrbControls,
		setPlane,
		onWindowResize,
	};
}

export default createDemo;
