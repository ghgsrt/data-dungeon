import { modifyMutable, produce } from 'solid-js/store';
import { AnimationAction, AnimationMixer, Event } from 'three';
import { Entity } from '../types/Entity';
import {
	State,
	StateFn,
	StateProps,
	StateEnterProps,
	StateUpdateProps,
	StateFinishedProps,
	StateCleanupProps,
	StateExitProps,
	StateBuilderFn,
} from '../types/State';

const boilerplateDefaultState = createState('nameOfAnimationInFSM');

const boilerplateCustomState = createState('nameOfAnimationInFSM', {
	enter: ({ action, prevState, getPrevAction, setTimeFromRatio }) =>
		action.play(), // action.play() should be the very last thing called
	update: ({ action, timeElapsed }) => {}, // likely won't need
	finished: ({ action, getMixer }) => {}, // likely won't need
	cleanup: ({ action, getMixer }) => {}, // likely won't need
	exit: ({ action }) => {}, // likely won't need
});

export interface CreateStateFns {
	enter?: StateFn<StateEnterProps>;
	update?: StateFn<StateUpdateProps>;
	finished?: StateFn<StateFinishedProps>;
	cleanup?: StateFn<StateCleanupProps>;
	exit?: StateFn<StateExitProps>;
}

function createState(name: string, stateFns?: CreateStateFns): StateBuilderFn {
	const stateFnWrapper = <P extends StateProps>(
		callback: StateFn<P>,
		entity: Entity,
		props?: Partial<P>
	) => {
		modifyMutable(
			entity.animations,
			produce((animations) => {
				const _props: StateProps = {
					...props,
					action: animations[name].action,
				};

				//! Don't know how to make TS recognize the following
				//! won't cause an error lol
				if ('prevState' in _props) {
					//? default assignments
					_props.action.enabled = true;
					_props.action.time = 0.0;
					_props.action.setEffectiveTimeScale(1.0);
					_props.action.setEffectiveWeight(1.0);

					_props.getPrevAction = () =>
						animations[_props.prevState?.name]?.action;

					_props.setTimeFromRatio = (names?: string[]) => {
						if (names && names.includes(_props.prevState?.name))
							return;

						const prevAction = _props.getPrevAction();
						const ratio =
							_props.action.getClip().duration /
							prevAction.getClip().duration;
						_props.action.time = prevAction.time * ratio;
					};

					let prevAction;
					if ((prevAction = _props.getPrevAction()))
						_props.action.crossFadeFrom(prevAction, 0.5, true);

					// _props.action.clampWhenFinished = false;
				}

				callback(_props, entity);
			})
		);
	};

	return (entity) => {
		const getMixer = () => entity.animations[name].action.getMixer();
		const changeState = (name: string) =>
			entity.stateMachine()?.changeState(name);

		const enter: State['enter'] = (prevState) => {
			if (stateFns?.finished) {
				getMixer().addEventListener('finished', finished);
			}

			entity.setState('actions', name, true);

			const defaultEnter: StateFn<StateEnterProps> = ({ action }) => {
				action.play();
			};

			stateFnWrapper<StateEnterProps>(
				stateFns?.enter ?? defaultEnter,
				entity,
				{
					prevState,
					getMixer,
				}
			);
		};

		const update: State['update'] = (timeElapsed) => {
			if (stateFns?.update) {
				stateFnWrapper<StateUpdateProps>(stateFns.update, entity, {
					timeElapsed,
					changeState,
				});
			}

			entity.setState(
				'timers',
				name,
				entity.animations[name].action.time /
					entity.animations[name].action.getClip().duration
			);
		};

		const finished: State['finished'] = () => {
			if (stateFns?.finished)
				stateFnWrapper<StateFinishedProps>(stateFns.finished, entity, {
					getMixer,
				});
		};

		const cleanup: State['cleanup'] = () => {
			if (stateFns?.cleanup)
				stateFnWrapper<StateCleanupProps>(stateFns.cleanup, entity, {
					getMixer,
				});

			entity.setState('timers', name, 0);
			// console.log(name, entity.state.timers['falling-down']);

			getMixer().removeEventListener('finished', finished);
		};

		const exit: State['exit'] = () => {
			if (stateFns?.exit)
				stateFnWrapper<StateExitProps>(stateFns.exit, entity);

			// console.log('cleaning up', name);
			cleanup();

			entity.setState('actions', name, false);
		};

		return {
			name,
			enter,
			update,
			finished,
			cleanup,
			exit,
		};
	};
}

export default createState;

// function createState(
// 	name: string,
// 	enter: StateEnterFn,
// 	update: StateUpdateFn,
// 	exit: StateExitFn
// ): StateBuilderFn {
// 	return (entity) => ({
// 		name,
// 		enter: (prevState) => enter(entity, prevState),
// 		update: (timeElapsed, input) => update(entity, timeElapsed, input),
// 		exit: () => exit(entity),
// 	});
// }
