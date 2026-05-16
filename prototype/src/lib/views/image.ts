import type { CocoonView } from '../view-contract';

/**
 * Port of legacy `@cocoon/plugin-views` Image. Shows a single image read from
 * disk. Faithful to the legacy split: the pure half reads the file (in the
 * core, via the injected `readFileBase64` capability — the View itself imports
 * nothing, so it stays browser-bundle-safe) and ships only a `data:` URI; the
 * render half is a plain `<img>`. Bound by default to the `src` *output* port
 * (legacy `defaultPort`), so a bare `view: Image` plus `out: { src: plot.png }`
 * works — exactly the `examples/interop` shape.
 */

export interface ImageData {
  /** A ready-to-render `data:<mime>;base64,…` URI. */
  src: string;
}

export interface ImageState {
  /** Optional explicit path; overrides the bound port value (legacy). */
  src?: string;
}

export const Image: CocoonView<ImageData, ImageState> = {
  defaultPort: { incoming: false, name: 'src' },

  serialiseViewData(data, state, context) {
    const path = state?.src ?? data[0];
    if (typeof path !== 'string' || !context) return null;
    const img = context.readFileBase64(path);
    return img ? { src: `data:${img.mime};base64,${img.base64}` } : null;
  },

  mount(el, props) {
    const img = document.createElement('img');
    img.style.maxWidth = '100%';
    img.style.maxHeight = '100%';
    img.style.objectFit = 'contain';
    img.style.display = 'block';
    const apply = (d: ImageData | null) => {
      img.src = d?.src ?? '';
    };
    apply(props.data);
    el.appendChild(img);
    return {
      update(next) {
        apply(next.data);
      },
      destroy() {
        img.remove();
      },
    };
  },
};
