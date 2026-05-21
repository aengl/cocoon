// Minimal ambient declaration for idiomorph — the upstream package ships
// no .d.ts. We only use `Idiomorph.morph(oldNode, newContent, options)`
// from the ESM bundle; the options shape mirrors the parts we actually
// reach for (morphStyle + the two before-* callbacks).

declare module 'idiomorph' {
  export interface IdiomorphCallbacks {
    /** Return false to skip morphing into `oldNode` (and its children). */
    beforeNodeMorphed?: (oldNode: Node, newNode: Node) => boolean | void;
    /** Return false to keep `node` instead of removing it. */
    beforeNodeRemoved?: (node: Node) => boolean | void;
    beforeNodeAdded?: (node: Node) => boolean | void;
    afterNodeMorphed?: (oldNode: Node, newNode: Node) => void;
    afterNodeAdded?: (node: Node) => void;
    afterNodeRemoved?: (node: Node) => void;
  }
  export interface IdiomorphOptions {
    morphStyle?: 'innerHTML' | 'outerHTML';
    ignoreActive?: boolean;
    ignoreActiveValue?: boolean;
    head?: 'merge' | 'append' | 'morph';
    callbacks?: IdiomorphCallbacks;
  }
  export const Idiomorph: {
    morph: (
      oldNode: Element,
      newContent: string | Element | Node,
      options?: IdiomorphOptions
    ) => void;
  };
}
