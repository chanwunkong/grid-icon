import type { Curve, ErasedPiece, Fill, Project, Pt, Style } from '../model/types';
import { DEFAULT_STYLE } from '../model/types';
import { samePt } from '../model/geometry';
import { History, type Snapshot } from '../model/history';
import { Graph, ptFromJSON, ptToJSON, type RPt } from '../exact/graph';
import { ptEq } from '../exact/point';
import { Q } from '../exact/rational';
import { distanceToPiece } from '../view/paint';
import { newId, reach } from '../model/project';
import { render, type Keyline, type Scene } from '../view/render';
import { Viewport } from '../view/viewport';

export type Tool = 'line' | 'circle' | 'select' | 'fill';

const AUTOSAVE_KEY = 'grid-icon:autosave';
const REFERENCE_KEY = 'grid-icon:reference';

/**
 * A reference image under the grid, for tracing. Placed in grid units; never exported and not part
 * of the project file (it is kept only in this browser).
 */
export interface Reference {
  src: string; // data URL
  img: HTMLImageElement;
  x: number; // top-left, grid units
  y: number;
  w: number; // width in grid units (height follows the image's aspect ratio)
  opacity: number;
  visible: boolean;
}

/** A rational close to a float (1/1024 of a grid unit), for points picked by tapping. */
const dyadic = (v: number) => new Q(BigInt(Math.round(v * 1024)), 1024n);
const ratFromJSON = (p: { x: string; y: string }): RPt => ({ x: Q.parse(p.x), y: Q.parse(p.y) });

/** Owns the project, the view and the drawing tools; the UI layer only calls into it. */
export class Editor {
  project: Project;
  readonly vp = new Viewport();
  readonly history = new History();
  tool: Tool = 'line';
  style: Style = { ...DEFAULT_STYLE }; // used for new curves
  guideMode = false; // new curves are guides (cut other curves, not part of the icon)
  selectedId: string | null = null; // the selected curve
  selectedPiece: number | null = null; // and the piece of it that was tapped
  fillColor = '#2f6bff';
  fillErase = false; // the fill tool removes fills instead of adding them
  graph!: Graph; // exact planar graph of the current geometry
  faceColors = new Map<number, string>();
  overflowing = false; // drawn content reaches past the canvas (set by the export panel)
  reference: Reference | null = null;
  adjustingReference = false; // drags move the reference image instead of drawing
  private refDrag: { x: number; y: number } | null = null;
  showGrid = true;
  keylines = new Set<Keyline>();
  onChange: () => void = () => {};

  private ctx: CanvasRenderingContext2D;
  private cssW = 0;
  private cssH = 0;
  private marks: Pt[] = []; // points placed so far for the shape in progress
  private hover: Pt | null = null;
  private dragging = false; // a drag that will place the next point when released
  private dragTouch = false;
  private marksBeforeDrag: Pt[] = [];
  notice = ''; // one-off message for the status bar (e.g. "drag, don't click")
  private pan: { x: number; y: number } | null = null;
  private spaceDown = false;
  private frame = 0;

  constructor(private canvas: HTMLCanvasElement, project: Project) {
    this.ctx = canvas.getContext('2d')!;
    this.project = project;
    this.rebuild(true);
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
    this.resize();
    this.fit();
    this.bindPointer();
    this.bindKeys();
  }

  // ------------------------------------------------------------------ project

  setProject(p: Project) {
    this.project = p;
    this.history.clear();
    this.selectedId = null;
    this.selectedPiece = null;
    this.marks = [];
    this.rebuild(true);
    this.fit();
    this.changed();
  }

  private snapshot(): Snapshot {
    return { curves: this.project.curves, erased: this.project.erased, fills: this.project.fills };
  }

  /** Call before every change that should be undoable. */
  private record() {
    this.history.record(this.snapshot());
  }

  /**
   * Recompute the planar graph. With `prune`, deleted-piece records whose end points no longer
   * exist and fills whose point is no longer inside a closed region are dropped (as part of the
   * same undo step as the change that caused it).
   */
  private rebuild(prune: boolean) {
    const { curves } = this.project;
    let { erased, fills } = this.project;
    this.graph = new Graph(curves, erased);
    const g = this.graph;
    if (prune) {
      erased = erased.filter((e) => {
        const a = ptFromJSON(e.a), b = ptFromJSON(e.b);
        return g.pieces.some((p) => p.erased && p.curve === e.curve && ptEq(g.vertices[p.from].p, a) && ptEq(g.vertices[p.to].p, b));
      });
    }
    // one fill per region: a later fill of the same region wins
    const byFace = new Map<number, Fill>();
    for (const f of fills) {
      const face = g.locate(ratFromJSON(f.point));
      if (face !== null) {
        byFace.delete(face);
        byFace.set(face, f);
      }
    }
    if (prune) fills = [...byFace.values()];
    this.faceColors = new Map([...byFace].map(([face, f]) => [face, f.color]));
    if (prune) this.project = { ...this.project, erased, fills };
    if (this.selectedId && !curves.some((c) => c.id === this.selectedId)) this.selectedId = null;
    this.selectedPiece = null;
  }

  /** An undoable change of the geometry (curves, deleted pieces) or fills. */
  private commit(patch: Partial<Snapshot>) {
    this.record();
    this.project = { ...this.project, ...patch };
    this.rebuild(true);
    this.changed();
  }

  private changed() {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(this.project));
    } catch {
      /* storage unavailable: autosave is only a convenience */
    }
    this.redraw();
    this.onChange();
  }

  static loadAutosave(): string | null {
    try {
      return localStorage.getItem(AUTOSAVE_KEY);
    } catch {
      return null;
    }
  }

  addCurve(c: Curve) {
    this.commit({ curves: [...this.project.curves, c] });
  }

  /** Delete the whole selected curve. */
  deleteSelected() {
    const id = this.selectedId;
    if (!id) return;
    this.selectedId = null;
    this.commit({ curves: this.project.curves.filter((c) => c.id !== id), erased: this.project.erased.filter((e) => e.curve !== id) });
  }

  /** Delete only the tapped piece of the selected curve (the part between two intersections). */
  erasePiece() {
    if (this.selectedPiece === null) return;
    const pc = this.graph.pieces[this.selectedPiece];
    const rec: ErasedPiece = { curve: pc.curve, a: ptToJSON(this.graph.vertices[pc.from].p), b: ptToJSON(this.graph.vertices[pc.to].p) };
    const id = pc.curve;
    this.commit({ erased: [...this.project.erased, rec] });
    this.selectedId = this.project.curves.some((c) => c.id === id) ? id : null;
  }

  /** Bring back every deleted piece of the selected curve. */
  restorePieces() {
    const id = this.selectedId;
    if (!id || !this.project.erased.some((e) => e.curve === id)) return;
    this.commit({ erased: this.project.erased.filter((e) => e.curve !== id) });
    this.selectedId = id;
  }

  get selectedHasErased(): boolean {
    return !!this.selectedId && this.project.erased.some((e) => e.curve === this.selectedId);
  }

  get selected(): Curve | undefined {
    return this.project.curves.find((c) => c.id === this.selectedId);
  }

  /** Change the style of the selected curve, or of curves drawn next when nothing is selected. */
  setStyle(patch: Partial<Style>) {
    const sel = this.selected;
    if (!sel) {
      this.style = { ...this.style, ...patch };
      this.onChange();
      this.redraw();
      return;
    }
    this.record();
    this.project = {
      ...this.project,
      curves: this.project.curves.map((c) => (c.id === sel.id ? { ...c, style: { ...c.style, ...patch } } : c)),
    };
    this.changed();
  }

  undo() {
    const s = this.history.undo(this.snapshot());
    if (!s) return;
    this.project = { ...this.project, ...s, erased: s.erased ?? [] };
    this.rebuild(false);
    this.changed();
  }

  redo() {
    const s = this.history.redo(this.snapshot());
    if (!s) return;
    this.project = { ...this.project, ...s, erased: s.erased ?? [] };
    this.rebuild(false);
    this.changed();
  }

  // ------------------------------------------------------------------ reference image

  /** Load an image as the tracing reference, fitted inside the canvas. */
  async setReferenceImage(src: string) {
    const img = new Image();
    img.src = src;
    await img.decode();
    this.reference = { src, img, x: 0, y: 0, w: 1, opacity: 0.4, visible: true };
    this.fitReference();
  }

  fitReference() {
    const r = this.reference;
    if (!r) return;
    const { w, h } = this.project.grid, aspect = r.img.naturalHeight / r.img.naturalWidth;
    r.w = Math.min(w, h / aspect);
    r.x = (w - r.w) / 2;
    r.y = (h - r.w * aspect) / 2;
    this.referenceChanged();
  }

  updateReference(patch: Partial<Omit<Reference, 'img' | 'src'>>) {
    if (!this.reference) return;
    Object.assign(this.reference, patch);
    this.referenceChanged();
  }

  removeReference() {
    this.reference = null;
    this.adjustingReference = false;
    this.referenceChanged();
  }

  private referenceChanged() {
    try {
      const r = this.reference;
      if (r) localStorage.setItem(REFERENCE_KEY, JSON.stringify({ src: r.src, x: r.x, y: r.y, w: r.w, opacity: r.opacity, visible: r.visible }));
      else localStorage.removeItem(REFERENCE_KEY);
    } catch {
      /* too large for storage, or storage unavailable: the reference just won't survive a reload */
    }
    this.redraw();
    this.onChange();
  }

  /** Bring back the reference image saved in this browser, if any. */
  async restoreReference() {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(REFERENCE_KEY);
    } catch {
      return;
    }
    if (!saved) return;
    try {
      const r = JSON.parse(saved);
      await this.setReferenceImage(r.src);
      Object.assign(this.reference!, { x: r.x, y: r.y, w: r.w, opacity: r.opacity, visible: r.visible });
      this.referenceChanged();
    } catch {
      /* ignore a broken saved reference */
    }
  }

  // ------------------------------------------------------------------ tools

  setTool(t: Tool) {
    this.tool = t;
    this.marks = [];
    if (t !== 'select') {
      this.selectedId = null;
      this.selectedPiece = null;
    }
    this.redraw();
    this.onChange();
  }

  /** Toggle guide mode for new curves, or flip the selected curve between guide and normal. */
  toggleGuide() {
    const sel = this.selected;
    if (!sel) {
      this.guideMode = !this.guideMode;
      this.redraw();
      this.onChange();
      return;
    }
    this.commit({ curves: this.project.curves.map((c) => (c.id === sel.id ? { ...c, guide: !c.guide } : c)) });
    this.selectedId = sel.id;
  }

  cancel() {
    if (this.marks.length) this.marks = [];
    else {
      this.selectedId = null;
      this.selectedPiece = null;
    }
    this.redraw();
    this.onChange();
  }

  /** Hint shown under the canvas for the current step of the current tool. */
  get hint(): string {
    if (this.notice) return this.notice;
    if (this.adjustingReference && this.reference) return '調整底圖：拖曳移動底圖；縮放用設定裡的數值。完成後關掉「調整底圖」';
    switch (this.tool) {
      case 'line':
        return `${this.guideMode ? '輔助線' : '直線'}：在起點按下，拖到終點放開`;
      case 'circle':
        return `${this.guideMode ? '輔助圓' : '圓'}：在圓心按下，拖到圓上的格點放開`;
      case 'select':
        return this.selectedPiece !== null ? '已選取一段：可以只刪這一段，或刪掉整條線' : '選取：點一條線（交點之間的一段）';
      case 'fill':
        return this.fillErase ? '移除填色：點一個已上色的封閉區域' : '填色：點一個封閉區域上色';
    }
  }

  private snap(sx: number, sy: number): Pt {
    const g = this.vp.toGrid(sx, sy), r = reach(this.project.grid.w, this.project.grid.h);
    return { x: Math.min(r.x1, Math.max(r.x0, Math.round(g.x))), y: Math.min(r.y1, Math.max(r.y0, Math.round(g.y))) };
  }

  /** The curve that would be created if the point being dragged were released at `p`. */
  private shapeFor(p: Pt): Curve | null {
    const m = this.marks, base = { id: 'preview', style: this.style, guide: this.guideMode };
    if (m.length !== 1 || samePt(m[0], p)) return null;
    if (this.tool === 'line') return { ...base, kind: 'line', a: m[0], b: p };
    if (this.tool === 'circle') return { ...base, kind: 'circle', c: m[0], p };
    return null;
  }

  private pick(sx: number, sy: number, touch: boolean) {
    const q = this.vp.toGrid(sx, sy), g = this.graph;
    const byId = new Map(this.project.curves.map((c) => [c.id, c]));
    let best: number | null = null, bd = Infinity;
    for (const pc of g.pieces) {
      if (pc.erased) continue;
      const c = byId.get(pc.curve)!;
      // fingers are less precise than a mouse: accept a wider band around the line
      const d = distanceToPiece(g, pc, q), tol = Math.max(c.guide ? 0 : c.style.width / 2, (touch ? 16 : 6) / this.vp.scale);
      if (d <= tol && d < bd) [best, bd] = [pc.index, d];
    }
    this.selectedPiece = best;
    this.selectedId = best === null ? null : g.pieces[best].curve;
  }

  /** Fill (or un-fill) the closed region under a tap. The point is kept as an exact rational. */
  private fillAt(sx: number, sy: number) {
    const f = this.vp.toGrid(sx, sy);
    // nudge off the grid's round numbers, so a line drawn later through grid points is very unlikely
    // to pass exactly through the stored point (a point on a line belongs to no region)
    const q: RPt = { x: dyadic(f.x).add(new Q(1n, 7919n)), y: dyadic(f.y).add(new Q(1n, 7907n)) };
    const face = this.graph.locate(q);
    if (face === null) {
      this.notice = '這裡不是封閉區域（或剛好點在線上）';
      this.onChange();
      return;
    }
    const others = this.project.fills.filter((fl) => this.graph.locate(ratFromJSON(fl.point)) !== face);
    if (this.fillErase) {
      if (others.length !== this.project.fills.length) this.commit({ fills: others });
      return;
    }
    this.commit({ fills: [...others, { id: newId(), point: { x: q.x.toString(), y: q.y.toString() }, color: this.fillColor }] });
  }

  /** Pointer pressed: the start of a drag (drawing tools) or a tap (select). */
  private press(p: Pt, touch: boolean, sx = 0, sy = 0) {
    this.notice = '';
    if (this.adjustingReference && this.reference) {
      this.refDrag = { x: sx, y: sy };
      return;
    }
    if (this.tool === 'select' || this.tool === 'fill') return;
    this.marksBeforeDrag = this.marks;
    this.dragging = true;
    this.dragTouch = touch;
    this.hover = p;
    this.marks = [p];
    this.redraw();
    this.onChange();
  }

  private release(p: Pt, sx: number, sy: number, touch: boolean) {
    if (this.refDrag) {
      this.refDrag = null;
      this.referenceChanged();
      return;
    }
    if (this.tool === 'select') {
      this.pick(sx, sy, touch);
      this.redraw();
      this.onChange();
      return;
    }
    if (this.tool === 'fill') {
      this.notice = '';
      this.fillAt(sx, sy);
      return;
    }
    if (!this.dragging) return;
    this.dragging = false;
    const shape = this.shapeFor(p);
    if (shape) {
      this.marks = [];
      this.addCurve({ ...shape, id: newId(), style: { ...this.style } });
    } else {
      this.marks = [];
      this.notice = '請拖曳：按下後拖到另一個格點再放開';
    }
    this.redraw();
    this.onChange();
  }

  /** A second finger or a cancelled pointer: forget the drag in progress. */
  private abortDrag() {
    this.refDrag = null;
    if (!this.dragging) return;
    this.dragging = false;
    this.marks = this.marksBeforeDrag;
    this.redraw();
    this.onChange();
  }

  // ------------------------------------------------------------------ view

  fit() {
    this.vp.fit(this.project.grid.w, this.project.grid.h, this.cssW, this.cssH);
    this.redraw();
  }

  zoom(factor: number) {
    this.vp.zoomAt(this.cssW / 2, this.cssH / 2, factor);
    this.redraw();
    this.onChange();
  }

  private resize() {
    const box = this.canvas.parentElement!.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // first layout, or the view turned between portrait and landscape: fit the drawing again
    const first = this.cssW === 0 || (this.cssW > this.cssH) !== (box.width > box.height);
    this.cssW = box.width;
    this.cssH = box.height;
    this.canvas.width = Math.round(box.width * dpr);
    this.canvas.height = Math.round(box.height * dpr);
    this.canvas.style.width = `${box.width}px`;
    this.canvas.style.height = `${box.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (first) this.fit();
    this.redraw();
  }

  redraw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const preview = this.hover ? this.shapeFor(this.hover) : null;
      const scene: Scene = {
        project: this.project, vp: this.vp, width: this.cssW, height: this.cssH,
        showGrid: this.showGrid, keylines: this.keylines, selectedId: this.selectedId,
        graph: this.graph, faceColors: this.faceColors, selectedPiece: this.selectedPiece, overflowing: this.overflowing,
        reference: this.reference,
        hover: this.tool === 'select' || this.tool === 'fill' ? null : this.hover,
        marks: this.marks, preview: this.dragging ? preview : null,
        guide: this.dragging ? this.hover : null, guideTouch: this.dragTouch,
      };
      render(this.ctx, scene);
    });
  }

  // ------------------------------------------------------------------ input

  private bindPointer() {
    const c = this.canvas;
    const local = (e: PointerEvent | WheelEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    // touch / pen: one finger previews and places a point when lifted; two fingers pan and pinch-zoom
    const touches = new Map<number, { x: number; y: number }>();
    let tap: { x: number; y: number } | null = null; // pending one-finger placement
    let gesture: { mid: { x: number; y: number }; dist: number } | null = null;
    const twoFinger = () => {
      const [a, b] = [...touches.values()];
      return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    };

    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      const q = local(e);
      c.setPointerCapture(e.pointerId);
      if (e.pointerType !== 'mouse') {
        touches.set(e.pointerId, q);
        if (touches.size === 1) {
          tap = q;
          this.hover = this.snap(q.x, q.y);
          this.press(this.hover, true, q.x, q.y);
        } else {
          tap = null; // a second finger turns the touch into a pan / zoom gesture
          this.abortDrag();
          this.hover = null;
          gesture = twoFinger();
        }
        this.redraw();
        return;
      }
      // middle or right button, or space + left button: pan
      if (e.button === 1 || e.button === 2 || (e.button === 0 && this.spaceDown)) {
        this.pan = q;
        c.style.cursor = 'grabbing';
        return;
      }
      if (e.button === 0) {
        this.hover = this.snap(q.x, q.y);
        this.press(this.hover, false, q.x, q.y);
      }
    });
    c.addEventListener('pointermove', (e) => {
      const q = local(e);
      if (e.pointerType !== 'mouse') {
        if (!touches.has(e.pointerId)) return;
        touches.set(e.pointerId, q);
        if (gesture && touches.size >= 2) {
          const now = twoFinger();
          this.vp.ox += now.mid.x - gesture.mid.x;
          this.vp.oy += now.mid.y - gesture.mid.y;
          this.vp.zoomAt(now.mid.x, now.mid.y, now.dist / gesture.dist);
          gesture = now;
          this.onChange();
        } else if (tap) {
          tap = q;
          if (this.moveReference(q)) return;
          this.hover = this.snap(q.x, q.y);
        }
        this.redraw();
        return;
      }
      if (this.pan) {
        this.vp.ox += q.x - this.pan.x;
        this.vp.oy += q.y - this.pan.y;
        this.pan = q;
      } else if (!this.moveReference(q)) {
        this.hover = this.snap(q.x, q.y);
      }
      this.redraw();
    });
    const up = (e: PointerEvent, cancelled: boolean) => {
      if (e.pointerType !== 'mouse') {
        if (!touches.delete(e.pointerId)) return;
        if (tap && !cancelled) tap = local(e); // where the finger lifts is the final position
        if (tap && !cancelled && touches.size === 0) this.release(this.snap(tap.x, tap.y), tap.x, tap.y, true);
        else if (cancelled) this.abortDrag();
        tap = null;
        if (touches.size < 2) gesture = null;
        if (touches.size === 0) this.hover = null;
        this.redraw();
        return;
      }
      if (this.pan) {
        this.pan = null;
        c.style.cursor = this.spaceDown ? 'grab' : 'crosshair';
        return;
      }
      if (e.button !== 0) return;
      const q = local(e);
      if (cancelled) this.abortDrag();
      else this.release(this.snap(q.x, q.y), q.x, q.y, false);
    };
    c.addEventListener('pointerup', (e) => up(e, false));
    c.addEventListener('pointercancel', (e) => up(e, true));
    c.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.hover = null;
      this.redraw();
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const q = local(e);
      this.vp.zoomAt(q.x, q.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
      this.redraw();
      this.onChange();
    }, { passive: false });
  }

  /** While adjusting the reference: drag it along. Returns true when the move was used for that. */
  private moveReference(q: { x: number; y: number }): boolean {
    if (!this.refDrag || !this.reference) return false;
    this.reference.x += (q.x - this.refDrag.x) / this.vp.scale;
    this.reference.y += (q.y - this.refDrag.y) / this.vp.scale;
    this.refDrag = q;
    this.redraw();
    this.onChange();
    return true;
  }

  private bindKeys() {
    window.addEventListener('keydown', (e) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, select, textarea, dialog')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo(); else this.undo();
        return;
      }
      if (mod && k === 'y') {
        e.preventDefault();
        this.redo();
        return;
      }
      if (mod) return;
      if (e.key === ' ') {
        e.preventDefault();
        this.spaceDown = true;
        if (!this.pan) this.canvas.style.cursor = 'grab';
        return;
      }
      if (e.key === 'Escape') {
        this.abortDrag();
        this.cancel();
      }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (e.shiftKey || this.selectedPiece === null) this.deleteSelected();
        else this.erasePiece();
      }
      else if (k === 'l') this.setTool('line');
      else if (k === 'c') this.setTool('circle');
      else if (k === 'v') this.setTool('select');
      else if (k === 'b') this.setTool('fill');
      else if (k === 'g') this.toggleGuide();
      else if (k === 'f') this.fit();
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ') {
        this.spaceDown = false;
        if (!this.pan) this.canvas.style.cursor = 'crosshair';
      }
    });
  }
}
