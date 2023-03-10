import { createEffect, createSignal, For, JSX } from 'solid-js';
import GameWindow from './components/QWOP/GameWindow';
import InputExample from './components/InputExample';
import Example from './components/Example';
import globalStore from './global';
import Practice from './components/practice/Practice';
import Overworld from './components/QWOP/Overworld';

function App() {
	const [currentDemoTitle, setCurrentDemoTitle] = createSignal<string>('');
	const { setActiveComponent } = globalStore;

	createEffect(() => setActiveComponent(currentDemoTitle()));

	//! ADD YOUR DEMO HERE
	//? Key: title of your demo
	//? Value: your demo component
	//* that's all you have to do!
	const demoMenu: Record<string, () => JSX.Element> = {
		// 'Example Comp.': () => <Example />,
		// 'useInput Example': () => <InputExample />,
		// Model: <Model />,
		QWOP: () => <GameWindow />,
		XRay: () => <Practice />,
		Overworld: () => <Overworld />,
	};

	return (
		<div class="flex h-screen w-screen overflow-hidden bg-gray-800">
			<div class="flex h-screen w-min flex-col">
				<For each={Object.keys(demoMenu)}>
					{(demoTitle) => (
						<div
							class={`flex flex-1 cursor-pointer select-none items-center
									justify-center bg-gray-300
									  p-1 text-center shadow-inner
									  transition-colors hover:bg-gray-400
									  active:bg-gray-400
									  ${currentDemoTitle() === demoTitle ? 'bg-gray-400' : ''}`}
							onClick={() => setCurrentDemoTitle(demoTitle)}
						>
							{demoTitle}
						</div>
					)}
				</For>
			</div>
			<div class="h-screen flex-1">{demoMenu[currentDemoTitle()]?.()}</div>
		</div>
	);
}

export default App;
