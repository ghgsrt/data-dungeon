import { createSignal } from 'solid-js';
import {
	createStore,
	createMutable,
	modifyMutable,
	produce,
} from 'solid-js/store';
import {
	Vector3,
	Object3D,
	Group,
	AnimationMixer,
	LoadingManager,
	Quaternion,
	AnimationUtils,
	AdditiveAnimationBlendMode,
	SkeletonHelper,
	Box3,
	Box3Helper,
	Color,
} from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import {
	EOptionsConfig,
	EntityConfig,
	Entity,
	Animations,
	ThreeTarget,
	ThreeLoader,
} from '../types/Entity';
import { FiniteStateMachine } from '../types/State';

type EOCVals = EOptionsConfig[keyof EOptionsConfig];
const defaultOptions: Record<string, EOCVals> = {
	scale: 0.1,
	shadow: true,
	velocity: new Vector3(0, 0, 0),
	acceleration: new Vector3(2, 0.25, 80.0),
	deceleration: new Vector3(-0.0005, -0.0001, -5.0),
} satisfies EOptionsConfig;

const reconcileOptions = (options?: Partial<EOptionsConfig>) => {
	const _options: typeof defaultOptions = options ?? {};

	for (const defaultOption in defaultOptions) {
		_options[defaultOption] ??= defaultOptions[defaultOption];
	}

	return _options as unknown as EOptionsConfig;
};

function createEntity(entityConfig: EntityConfig, useSkelly = true): Entity {
	const [scene, setScene] = createStore(entityConfig.scene);
	const [camera, setCamera] = createStore(entityConfig.camera);

	const modelsBasePath = './models'; //? parent directory is 'public'
	const [modelDir, setModelDir] = createSignal('');
	const [modelName, setModelName] = createSignal('');
	const [modelExt, setModelExt] = createSignal('');
	const [modelReady, setModelReady] = createSignal(false);

	const animsBasePath = './animations'; //? parent directory is 'public'
	const [animsDir, setAnimsDir] = createSignal('');
	const [animNames, setAnimNames] = createStore<string[]>([]);
	const [additAnimNames, setAdditAnimNames] = createStore<string[]>([]);
	const [animsExt, setAnimsExt] = createSignal('');

	const [defaultAnim, setDefaultAnim] = createSignal('');
	const animations = createMutable<Animations>({});
	const [stateMachine, setStateMachine] = createSignal<FiniteStateMachine>();

	const options = reconcileOptions(entityConfig.options);
	const [scale, setScale] = createSignal(options.scale);
	const [shadow, setShadow] = createSignal(options.shadow);
	const [velocity, setVelocity] = createSignal(options.velocity);
	const [acceleration, setAcceleration] = createSignal(options.acceleration);
	const [deceleration, setDeceleration] = createSignal(options.deceleration);

	const [target, setTarget] = createSignal<Group>();
	const [skellyboi, setSkellyboi] = createSignal<SkeletonHelper>();
	const [manager, setManager] = createStore(new LoadingManager());
	let mixer: AnimationMixer; //! CANNOT BE REACTIVE!!!

	//? storage for any extraneous data you want tied to the entity
	const [state, setState] = createStore({
		actions: {
			move: {
				forward: false,
				left: false,
				right: false,
				backward: false,
				sprinting: false,
			},
		},
		timers: {},
		...(entityConfig.state ?? {}),
	});

	//? Custom update function
	//! Pass a callback into this instead of changing update()
	//* e.g., entity.onUpdate(() => { ... })
	const [_update, _setUpdate] = createSignal<Entity['update']>();
	const onUpdate: Entity['onUpdate'] = (fn) => _setUpdate((_) => fn);

	const sanitizeAnimName = (name: string): string => {
		const [_dir, _name] = name.split('.')[0].split('/');
		return _name ?? _dir;
	};

	const readyForStateChange: Entity['readyForStateChange'] = () =>
		Object.keys(animations).length > 0;

	const toDefaultState: Entity['toDefaultState'] = () =>
		stateMachine()?.changeState(sanitizeAnimName(defaultAnim()));

	const applyShadows = (c: Object3D) => (c.castShadow = shadow());

	const toggleAdditAction: Entity['toggleAdditAction'] = (
		name,
		weight,
		pressed,
		timeScale = 1
	) => {
		const prevAction =
			animations[stateMachine()?.currentState()?.name ?? 'idle'].action;
		const currDur = prevAction.getClip().duration;
		const action = animations[name].action;

		action.enabled = pressed;
		action.setEffectiveTimeScale(timeScale);
		action.setEffectiveWeight(pressed ? weight : 0);
		action.time = action.getClip().duration / currDur;
		action.blendMode = AdditiveAnimationBlendMode;
		pressed ? action.play() : action.stop();
	};

	const getModelPath = (): string =>
		`${modelsBasePath}/${modelExt()}/${modelDir()}/${modelName()}.${modelExt()}`;

	const reconcileAnimPath = (animName: string): string => {
		const [path, _ext] = animName.split('.');
		const [_dir, _name] = path.split('/');

		let dir, name;
		if (_name) {
			dir = _dir;
			name = _name;
		} else {
			dir = animsDir();
			name = _dir;
		}
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		const ext = _ext ?? animsExt(); // "sophisticated linter" my ass lmao

		return `${animsBasePath}/${ext}/${dir}/${name}.${ext}`;
	};

	const onLoad = (anim: ThreeTarget, name: string, isAdditive: boolean) => {
		let clip = anim.animations[0];
		if (isAdditive) {
			AnimationUtils.makeClipAdditive(clip);

			if (clip.name.endsWith('_pose')) {
				clip = AnimationUtils.subclip(clip, clip.name, 2, 3, 30);
			}
		}

		const action = mixer.clipAction(clip);

		modifyMutable(
			animations,
			produce((_animations) => {
				// sanitizeAnimName(animNames[Object.keys(animations).length])
				_animations[sanitizeAnimName(name)] = {
					clip,
					action,
				};
			})
		);
	};

	//? "proxy" fn necessary for tracking reactivity when branching into onLoad
	// const passAnimToLoad = onLoad; //? no longer necessary, don't even remember what caused it to be in the first place
	//? leaving here anyway in case it's needed again/for reference

	const loaders: Record<string, ThreeLoader> = {
		fbx: new FBXLoader(),
		glb: new GLTFLoader(),
		gltf: new GLTFLoader(),
	};
	const getLoader = (ext: string, manager?: LoadingManager): ThreeLoader => {
		const loader = loaders[ext];
		if (manager) loader.manager = manager;

		return loader;
	};

	const logLoading = (xhr: ProgressEvent<EventTarget>, label = 'model') => {
		const percComplete = (xhr.loaded / xhr.total) * 100;
		console.log(`${label}: ${percComplete}% loaded`);
		if (percComplete === 100) setModelReady(true);
	};
	const logLoadError = (error: ErrorEvent) => console.log(error);

	const loadAnim = (name: string, isAdditive = false) => {
		setState('actions', (_) => ({ [name]: false }));
		setState('timers', (_) => ({ [name]: 0 }));

		const path = reconcileAnimPath(name);
		const ext = path.split('.')[2];
		getLoader(ext, manager).load(
			path,
			(a) => onLoad(a, name, isAdditive),
			(xhr) =>
				logLoading(
					xhr,
					`Animation[${name}]${isAdditive ? ' (addit.)' : ''}`
				),
			logLoadError
		);
	};

	const loadAnims = (_target: Group): void => {
		setManager(
			produce((_manager) => {
				_manager.onLoad = toDefaultState;
			})
		);

		for (const name of animNames) loadAnim(name);
		for (const name of additAnimNames) loadAnim(name, true);
	};

	const extractTarget = (_target: ThreeTarget): Group => {
		switch (modelExt()) {
			case 'fbx':
				return _target as Group;
			default:
				return (_target as GLTF).scene;
		}
	};

	const loadModel = (ext: string) =>
		getLoader(ext).load(
			getModelPath(),
			(model: ThreeTarget) => {
				const _target = extractTarget(model);

				_target.scale.setScalar(scale());
				_target.traverse(applyShadows);

				setTarget(_target);
				//! DEBUG
				const skellyboi = new SkeletonHelper(_target);
				setSkellyboi(skellyboi);
				setScene(
					produce((_scene) => {
						_scene.add(_target);
						if (useSkelly) _scene.add(skellyboi);
					})
				);

				mixer = new AnimationMixer(_target);
				loadAnims(_target);
			},
			logLoading,
			logLoadError
		);

	const loadModelAndAnims: Entity['loadModelAndAnims'] = (loadConfig) => {
		setModelDir(loadConfig.parentDir);
		setModelName(loadConfig.modelName);
		setModelExt(loadConfig.modelExt);
		setAnimsDir(loadConfig.animsDir ?? loadConfig.parentDir);
		if (loadConfig.animNames) {
			setAnimNames(loadConfig.animNames);
			setDefaultAnim(loadConfig.animNames[0]);
		}
		if (loadConfig.additAnimNames) {
			setAdditAnimNames(loadConfig.additAnimNames);
		}
		setAnimsExt(loadConfig.animsExt ?? loadConfig.modelExt);

		switch (modelExt()) {
			case 'glb':
				loadModel('gltf');
				break;
			default:
				loadModel(modelExt());
		}
	};
	if (entityConfig.load) loadModelAndAnims(entityConfig.load);

	const update: Entity['update'] = (timeInSeconds) => {
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		if (!target()) return;

		stateMachine()?.update(timeInSeconds);
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		if (mixer) mixer.update(timeInSeconds);

		const frameDeceleration = new Vector3(
			velocity().x * deceleration().x,
			velocity().y * deceleration().y,
			velocity().z * deceleration().z
		);
		frameDeceleration.multiplyScalar(timeInSeconds);
		frameDeceleration.z =
			Math.sign(frameDeceleration.z) *
			Math.min(Math.abs(frameDeceleration.z), Math.abs(velocity()!.z));

		velocity()!.add(frameDeceleration);

		const _Q = new Quaternion();
		const _A = new Vector3();
		const _R = target()!.quaternion.clone();

		const acc = acceleration().clone();

		const { forward, left, right, backward, sprinting } =
			state.actions.move;

		if (sprinting) acc.multiplyScalar(5.0);

		if (forward !== backward) {
			if (forward) velocity().z += acc.z * timeInSeconds;
			if (backward) velocity().z -= (acc.z / 1.85) * timeInSeconds;
		}
		//! scuffed behavior. obey the channels damnit
		if ((left || right) && left !== right) {
			_A.set(0, 1, 0);
			_Q.setFromAxisAngle(
				_A,
				(left ? 1 : -1) *
					4.0 *
					Math.PI *
					timeInSeconds *
					acceleration().y
			);
			_R.multiply(_Q);
		}

		target()!.quaternion.copy(_R);

		const _forward = new Vector3(0, 0, 1);
		_forward.applyQuaternion(target()!.quaternion);
		_forward.normalize();

		const _upways = new Vector3(0, 1, 0);
		_upways.applyQuaternion(target()!.quaternion);
		_upways.normalize();

		const _sideways = new Vector3(1, 0, 0);
		_sideways.applyQuaternion(target()!.quaternion);
		_sideways.normalize();

		_sideways.multiplyScalar(velocity().x * timeInSeconds);
		_upways.multiplyScalar(velocity().y * timeInSeconds);
		_forward.multiplyScalar(velocity().z * timeInSeconds);

		// target()!.position.add(_forward);
		target()!.position.add(_upways);
		target()!.position.add(_sideways);

		let collidesX = false;
		let collidesZ = false;
		if ('collidesWith' in state) {
			for (const collider of state.collidesWith as Group[]) {
				const buildingBox = new Box3().setFromObject(collider);
				const playerBox = new Box3().setFromObject(target()!);

				if (buildingBox.intersectsBox(playerBox)) {
					const intersectionBox = buildingBox.intersect(playerBox);
					console.log(JSON.stringify(intersectionBox));
					const help = new Box3Helper(
						intersectionBox,
						new Color(0xff0000)
					);
					setScene(produce((scene) => scene.add(help)));

					const playerX = target()!.clone();
					playerX.position.add(new Vector3(_forward.x, 0, 0));
					const playerBoxX = new Box3().setFromObject(playerX);

					const playerZ = target()!.clone();
					playerZ.position.add(new Vector3(0, 0, _forward.z));
					const playerBoxZ = new Box3().setFromObject(playerZ);

					if (buildingBox.intersectsBox(playerBoxX)) collidesX = true;
					if (buildingBox.intersectsBox(playerBoxZ)) collidesZ = true;
				}
			}
		}
		// if ('collidesWith' in state) {
		// 	for (const collider of state.collidesWith as Group[]) {
		// 		const buildingBox = new Box3().setFromObject(collider);
		// 		const playerBox = new Box3().setFromObject(target()!);

		// 		if (buildingBox.intersectsBox(playerBox)) {
		// 			const intersectionBox = buildingBox.intersect(playerBox);
		// 			console.log(JSON.stringify(intersectionBox));
		// 			const help = new Box3Helper(
		// 				intersectionBox,
		// 				new Color(0xff0000)
		// 			);

		// 			setScene(produce((scene) => scene.add(help)));

		// 			const xSign = Math.sign(_forward.x);
		// 			const zSign = Math.sign(_forward.z);
		// 			const dist =
		// 				playerBox.distanceToPoint(
		// 					buildingBox.getSize(new Vector3())
		// 				) / 100;
		// 			target()!.position.sub(
		// 				_forward.add(new Vector3(xSign * dist, 0, zSign * dist))
		// 			);
		// 		}
		// 	}
		// }

		const _forwardAdjusted = new Vector3(
			collidesX ? 0 : _forward.x,
			_forward.y,
			collidesZ ? 0 : _forward.z
		);
		target()!.position.add(_forwardAdjusted);

		setCamera((_camera) => {
			// _camera.quaternion.copy(_R);
			_camera.position.add(_forwardAdjusted);
			_camera.position.add(_upways);
			_camera.position.add(_sideways);
			return _camera;
		});

		if (_update()) _update()!(timeInSeconds);
	};

	return {
		scene,
		camera,

		modelDir,
		modelName,
		modelExt,
		getModelPath,
		modelReady,

		animsDir, // note: this is a default
		animNames,
		additAnimNames,
		animsExt, // note: this is a default

		defaultAnim,
		animations,
		stateMachine,

		scale,
		shadow,
		velocity,
		acceleration,
		deceleration,

		target,
		skellyboi,
		manager,

		state,

		setScene,
		setCamera,

		setModelDir,
		setModelName,
		setModelExt,

		setAnimsDir,
		setAnimNames,
		setAdditAnimNames,
		setAnimsExt,

		setDefaultAnim,
		setStateMachine,

		setScale,
		setShadow,
		setVelocity,
		setAcceleration,
		setDeceleration,

		setTarget,
		setSkellyboi,
		setManager,

		setState,

		onUpdate,
		readyForStateChange,
		toDefaultState,
		toggleAdditAction,
		loadModelAndAnims,
		update,
	};
}

export default createEntity;
