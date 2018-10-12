export type SVGTranslation = (x: number) => number;

export function translate(x: number): SVGTranslation {
  return y => x + y;
}
