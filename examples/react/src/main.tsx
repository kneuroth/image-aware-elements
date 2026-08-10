import { ImageSurface, Surface, type Layout } from '@image-aware/react';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
// Imported through the bundler rather than fetched, so the manifest is passed as
// a plain object. A raw JSON import types `corners` as number[][], which is why
// the prop accepts ManifestSource rather than a fully narrowed Manifest.
import manifest from '../../../fixtures/opportunities.surfaces.json';
import './styles.css';

function App() {
  const [count, setCount] = useState(0);
  const [layout, setLayout] = useState<Layout | null>(null);

  return (
    <>
      <header>
        <h1>React</h1>
        <p>The same manifest and photo as the other examples, driven by React state.</p>
      </header>

      <main>
        <ImageSurface manifest={manifest} src="/opportunities.jpg" fit="contain" onLayout={setLayout}>
          <Surface id="laptop-screen" className="screen">
            <h2>Rendered by React.</h2>
            <p>State updates repaint inside the perspective, with no re-solve of the transform.</p>
            <button type="button" onClick={() => setCount((n) => n + 1)}>
              Clicked {count} times
            </button>
            <span className="readout">
              {layout
                ? `photo ${Math.round(layout.imageRect.width)} x ${Math.round(layout.imageRect.height)} px`
                : 'measuring…'}
            </span>
          </Surface>
        </ImageSurface>
      </main>
    </>
  );
}

createRoot(document.querySelector('#root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
