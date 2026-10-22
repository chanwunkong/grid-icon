// Minimal typings for the parts of clipper-lib (Clipper 6, Angus Johnson) used here.
declare module 'clipper-lib' {
  export interface IntPoint { X: number; Y: number }
  export type Path = IntPoint[];
  export type Paths = Path[];
  export const ClipType: { ctUnion: number };
  export const PolyType: { ptSubject: number };
  export const PolyFillType: { pftNonZero: number };
  export class Clipper {
    AddPaths(paths: Paths, polyType: number, closed: boolean): boolean;
    Execute(clipType: number, solution: Paths, subjFill: number, clipFill: number): boolean;
    static Area(path: Path): number;
  }
  const ClipperLib: { Clipper: typeof Clipper; ClipType: typeof ClipType; PolyType: typeof PolyType; PolyFillType: typeof PolyFillType };
  export default ClipperLib;
}
