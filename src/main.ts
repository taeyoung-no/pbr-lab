import GUI from 'lil-gui';
import { Renderer } from './Renderer.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const renderer = new Renderer(canvas);

renderer.init()
  .then(() => {
    const gui = new GUI({ title: 'Inspector' });

    const light = gui.addFolder('Light');
    light.add(renderer.params, 'lightDirX', -1, 1, 0.01).name('Dir X');
    light.add(renderer.params, 'lightDirY', -1, 1, 0.01).name('Dir Y');
    light.add(renderer.params, 'lightDirZ', -1, 1, 0.01).name('Dir Z');
    light.add(renderer.params, 'lightIntensity', 0, 20, 0.1).name('Intensity');

    renderer.start();
  })
  .catch((err: unknown) => {
    console.error(err);
    document.body.innerHTML = `<pre style="color:red;padding:1rem">${String(err)}</pre>`;
  });
