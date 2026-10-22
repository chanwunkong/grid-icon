// Every coordinate stored in a project is an integer grid point.
export interface Pt {
  x: number;
  y: number;
}

export type Cap = 'butt' | 'round' | 'square';
export type Join = 'miter' | 'round' | 'bevel';

export interface Style {
  width: number; // in grid units, positive integer
  cap: Cap;
  join: Join;
  miterLimit: number;
}

// A guide cuts other curves (it creates intersections) but is not part of the icon:
// it is drawn dashed in the editor and left out of exports.
export interface LineCurve {
  id: string;
  kind: 'line';
  a: Pt;
  b: Pt;
  guide: boolean;
  style: Style;
}

// A full circle: center plus any grid point on it, so r² is always an integer.
// There is no arc tool: arcs are made by cutting a circle with other curves and deleting pieces.
export interface CircleCurve {
  id: string;
  kind: 'circle';
  c: Pt;
  p: Pt;
  guide: boolean;
  style: Style;
}

export type Curve = LineCurve | CircleCurve;

/** An exact number written as "a" (rational "n/d") or "a|b|d" for a + b√d. */
export interface ExactPtJSON {
  x: string;
  y: string;
}

/**
 * A fill remembers one exact (rational) point inside its region. After the geometry changes the
 * region is found again from this point; if the point is no longer inside a closed region the fill goes.
 */
export interface Fill {
  id: string;
  point: ExactPtJSON;
  color: string;
}

/** A deleted piece of a curve, between two exact intersection points (lines a→b, circles counter-clockwise). */
export interface ErasedPiece {
  curve: string;
  a: ExactPtJSON;
  b: ExactPtJSON;
}

export interface Project {
  version: 1;
  grid: { w: number; h: number };
  curves: Curve[];
  erased: ErasedPiece[];
  fills: Fill[];
}

export const DEFAULT_STYLE: Style = { width: 2, cap: 'round', join: 'round', miterLimit: 4 };
