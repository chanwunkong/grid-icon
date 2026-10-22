import type { Curve, ErasedPiece, Fill } from './types';

export interface Snapshot {
  curves: Curve[];
  erased: ErasedPiece[];
  fills: Fill[];
}

/** Undo / redo by storing whole snapshots; projects are small enough for this. */
export class History {
  private past: string[] = [];
  private future: string[] = [];

  constructor(private limit = 200) {}

  record(state: Snapshot) {
    this.past.push(JSON.stringify(state));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: Snapshot): Snapshot | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(JSON.stringify(current));
    return JSON.parse(prev);
  }

  redo(current: Snapshot): Snapshot | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(JSON.stringify(current));
    return JSON.parse(next);
  }

  clear() {
    this.past = [];
    this.future = [];
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }
}
