/**
 * Eingabe für Maus, Tastatur und Touch.
 *
 * Arbeitet direkt mit DOM-Pointer-Events auf der Spielfläche (nicht über Phaser),
 * damit Maus und Touch klar getrennt und Gesten (Pinch, langes Drücken) gut
 * kontrollierbar sind. Was eine Geste *bedeutet* (auswählen, platzieren,
 * angreifen …), entscheidet das InputTarget (die Spielszene).
 * Alle Koordinaten sind Bildschirm-Pixel relativ zur Spielfläche.
 */

export interface InputTarget {
  panBy(dxScreen: number, dyScreen: number): void;
  zoomAt(factor: number, sx: number, sy: number): void;
  /** Maus: Linksklick (ohne Ziehen). */
  leftClick(sx: number, sy: number, shift: boolean): void;
  /** Maus: Rechtsklick (ohne Ziehen) – Kontextbefehl bzw. Abbrechen. */
  rightClick(sx: number, sy: number): void;
  /** Touch: kurzes Tippen. */
  tap(sx: number, sy: number): void;
  /** Doppelklick/-tippen: alle gleichen Einheiten im Bild. */
  doubleSelect(sx: number, sy: number, touch: boolean): void;
  selectInBox(x0: number, y0: number, x1: number, y1: number, additive: boolean): void;
  /** Maus bewegt sich (für Platzier-Vorschau und Mauszeiger). */
  hover(sx: number, sy: number): void;
  hasSelection(): boolean;
  /** Spieltasten (s, a, d, escape, space …). true = verarbeitet. */
  onKey(key: string): boolean;
  saveGroup(n: number): void;
  recallGroup(n: number): void;
  centerOnSelection(): void;
}

const DRAG_THRESHOLD_MOUSE = 6;
const DRAG_THRESHOLD_TOUCH = 12;
const DOUBLE_MS = 350;
const LONG_PRESS_MS = 400;
const EDGE_PX = 14;
const SCROLL_SPEED = 900;

interface Point {
  x: number;
  y: number;
}

type TouchMode = 'none' | 'pending' | 'pan' | 'box' | 'pinch';

export class InputController {
  /** Aus, solange ein Menü offen ist. */
  enabled = true;

  private mouse = { x: 0, y: 0, inside: false };
  private leftDown: { x: number; y: number; dragging: boolean } | null = null;
  private rightDown: { x: number; y: number; lastX: number; lastY: number; panning: boolean } | null = null;
  private lastClick = { time: 0, x: 0, y: 0 };

  private touches = new Map<number, Point>();
  private touchMode: TouchMode = 'none';
  private touchStart = { x: 0, y: 0 };
  private longPressTimer: number | undefined;
  private pinch = { dist: 0, midX: 0, midY: 0 };
  private lastTap = { time: 0, x: 0, y: 0 };

  private keys = new Set<string>();
  private lastGroupKey = { n: -1, time: 0 };
  private cleanup: (() => void)[] = [];

  constructor(
    private readonly el: HTMLElement,
    private readonly dragBox: HTMLElement,
    private readonly target: InputTarget,
  ) {
    el.style.touchAction = 'none';
    const on = <K extends keyof HTMLElementEventMap>(
      t: HTMLElement | Window,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    on(el, 'pointerdown', (e) => this.enabled && (e.pointerType === 'mouse' ? this.mouseDown(e) : this.touchDown(e)));
    on(el, 'pointermove', (e) => this.enabled && (e.pointerType === 'mouse' ? this.mouseMove(e) : this.touchMove(e)));
    on(el, 'pointerup', (e) => this.enabled && (e.pointerType === 'mouse' ? this.mouseUp(e) : this.touchUp(e)));
    on(el, 'pointercancel', (e) => this.cancelPointer(e));
    on(el, 'pointerenter', (e) => {
      if (e.pointerType === 'mouse') this.mouse.inside = true;
    });
    on(el, 'pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.mouse.inside = false;
    });
    on(el, 'wheel', (e) => this.onWheel(e), { passive: false });
    on(el, 'contextmenu', (e) => e.preventDefault());
    on(window, 'keydown', (e) => this.onKeyDown(e));
    on(window, 'keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    on(window, 'blur', () => {
      this.keys.clear();
      this.mouse.inside = false;
    });
  }

  destroy(): void {
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
    clearTimeout(this.longPressTimer);
  }

  /** Pro Frame: Kamera per Tastatur und Bildrand bewegen. */
  update(deltaMs: number): void {
    if (!this.enabled) return;
    const step = (SCROLL_SPEED * deltaMs) / 1000;
    let dx = 0;
    let dy = 0;
    const k = this.keys;
    const wasd = !this.target.hasSelection();
    if (k.has('arrowleft') || (wasd && k.has('a'))) dx -= step;
    if (k.has('arrowright') || (wasd && k.has('d'))) dx += step;
    if (k.has('arrowup') || (wasd && k.has('w'))) dy -= step;
    if (k.has('arrowdown') || (wasd && k.has('s'))) dy += step;
    if (this.mouse.inside && !this.leftDown && !this.rightDown && document.hasFocus()) {
      const w = this.el.clientWidth;
      const h = this.el.clientHeight;
      if (this.mouse.x < EDGE_PX) dx -= step;
      if (this.mouse.x > w - EDGE_PX) dx += step;
      if (this.mouse.y < EDGE_PX) dy -= step;
      if (this.mouse.y > h - EDGE_PX) dy += step;
    }
    if (dx !== 0 || dy !== 0) this.target.panBy(-dx, -dy);
  }

  private capture(e: PointerEvent) {
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // unkritisch
    }
  }

  private pos(e: PointerEvent | WheelEvent): Point {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private cancelPointer(e: PointerEvent) {
    if (e.pointerType === 'mouse') {
      this.leftDown = null;
      this.rightDown = null;
      this.showBox(null);
    } else {
      this.touches.delete(e.pointerId);
      if (this.touches.size === 0) this.resetTouch();
    }
  }

  // ───────────── Maus ─────────────

  private mouseDown(e: PointerEvent) {
    const p = this.pos(e);
    this.capture(e);
    if (e.button === 0) this.leftDown = { x: p.x, y: p.y, dragging: false };
    else if (e.button === 2 || e.button === 1) {
      this.rightDown = { x: p.x, y: p.y, lastX: p.x, lastY: p.y, panning: e.button === 1 };
    }
  }

  private mouseMove(e: PointerEvent) {
    const p = this.pos(e);
    this.mouse.x = p.x;
    this.mouse.y = p.y;
    this.mouse.inside = true;
    this.target.hover(p.x, p.y);
    const l = this.leftDown;
    if (l) {
      if (!l.dragging && Math.hypot(p.x - l.x, p.y - l.y) > DRAG_THRESHOLD_MOUSE) l.dragging = true;
      if (l.dragging) this.showBox({ x0: l.x, y0: l.y, x1: p.x, y1: p.y });
    }
    const r = this.rightDown;
    if (r) {
      if (!r.panning && Math.hypot(p.x - r.x, p.y - r.y) > DRAG_THRESHOLD_MOUSE) r.panning = true;
      if (r.panning) this.target.panBy(p.x - r.lastX, p.y - r.lastY);
      r.lastX = p.x;
      r.lastY = p.y;
    }
  }

  private mouseUp(e: PointerEvent) {
    const p = this.pos(e);
    if (e.button === 0 && this.leftDown) {
      const l = this.leftDown;
      this.leftDown = null;
      this.showBox(null);
      if (l.dragging) {
        this.target.selectInBox(l.x, l.y, p.x, p.y, e.shiftKey);
        return;
      }
      const now = performance.now();
      const isDouble = now - this.lastClick.time < DOUBLE_MS && Math.hypot(p.x - this.lastClick.x, p.y - this.lastClick.y) < 10;
      this.lastClick = { time: isDouble ? 0 : now, x: p.x, y: p.y };
      if (isDouble) this.target.doubleSelect(p.x, p.y, false);
      else this.target.leftClick(p.x, p.y, e.shiftKey);
    } else if ((e.button === 2 || e.button === 1) && this.rightDown) {
      const r = this.rightDown;
      this.rightDown = null;
      if (!r.panning && e.button === 2) this.target.rightClick(p.x, p.y);
    }
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    if (!this.enabled) return;
    const p = this.pos(e);
    const factor = Math.pow(1.0015, -e.deltaY * (e.deltaMode === 1 ? 33 : 1));
    this.target.zoomAt(factor, p.x, p.y);
  }

  // ───────────── Touch ─────────────

  private touchDown(e: PointerEvent) {
    const p = this.pos(e);
    this.touches.set(e.pointerId, p);
    this.capture(e);
    if (this.touches.size === 1) {
      this.touchMode = 'pending';
      this.touchStart = p;
      clearTimeout(this.longPressTimer);
      this.longPressTimer = window.setTimeout(() => {
        if (this.touchMode === 'pending') {
          this.touchMode = 'box';
          navigator.vibrate?.(15);
          this.showBox({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        }
      }, LONG_PRESS_MS);
    } else if (this.touches.size === 2) {
      clearTimeout(this.longPressTimer);
      this.showBox(null);
      this.touchMode = 'pinch';
      this.startPinch();
    }
  }

  private startPinch() {
    const [a, b] = [...this.touches.values()];
    this.pinch = { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
  }

  private touchMove(e: PointerEvent) {
    const prev = this.touches.get(e.pointerId);
    if (!prev) return;
    const p = this.pos(e);
    this.touches.set(e.pointerId, p);
    switch (this.touchMode) {
      case 'pending':
        if (Math.hypot(p.x - this.touchStart.x, p.y - this.touchStart.y) > DRAG_THRESHOLD_TOUCH) {
          clearTimeout(this.longPressTimer);
          this.touchMode = 'pan';
          this.target.panBy(p.x - this.touchStart.x, p.y - this.touchStart.y);
        }
        break;
      case 'pan':
        this.target.panBy(p.x - prev.x, p.y - prev.y);
        break;
      case 'box':
        this.showBox({ x0: this.touchStart.x, y0: this.touchStart.y, x1: p.x, y1: p.y });
        break;
      case 'pinch': {
        if (this.touches.size < 2) break;
        const [a, b] = [...this.touches.values()];
        const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        this.target.panBy(midX - this.pinch.midX, midY - this.pinch.midY);
        this.target.zoomAt(dist / this.pinch.dist, midX, midY);
        this.pinch = { dist, midX, midY };
        break;
      }
    }
  }

  private touchUp(e: PointerEvent) {
    const p = this.touches.get(e.pointerId) ?? this.pos(e);
    this.touches.delete(e.pointerId);
    if (this.touchMode === 'pinch') {
      if (this.touches.size === 0) this.resetTouch();
      return;
    }
    if (this.touches.size > 0) return;
    const mode = this.touchMode;
    this.resetTouch();
    if (mode === 'box') {
      this.target.selectInBox(this.touchStart.x, this.touchStart.y, p.x, p.y, false);
    } else if (mode === 'pending') {
      const now = performance.now();
      const isDouble = now - this.lastTap.time < DOUBLE_MS && Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < 30;
      this.lastTap = { time: isDouble ? 0 : now, x: p.x, y: p.y };
      if (isDouble) this.target.doubleSelect(p.x, p.y, true);
      else this.target.tap(p.x, p.y);
    }
  }

  private resetTouch() {
    clearTimeout(this.longPressTimer);
    this.touchMode = 'none';
    this.showBox(null);
  }

  // ───────────── Tastatur ─────────────

  private onKeyDown(e: KeyboardEvent) {
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT')) return;
    if (!this.enabled) {
      // Im Menü nur Escape weiterreichen (Pause schliessen)
      if (e.key === 'Escape') this.target.onKey('escape');
      return;
    }
    const key = e.key.toLowerCase();
    this.keys.add(key);
    const digit = /^Digit([0-9])$/.exec(e.code)?.[1] ?? /^Numpad([0-9])$/.exec(e.code)?.[1];
    if (digit !== undefined) {
      const n = Number(digit);
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        this.target.saveGroup(n);
      } else {
        const now = performance.now();
        const twice = this.lastGroupKey.n === n && now - this.lastGroupKey.time < DOUBLE_MS;
        this.target.recallGroup(n);
        if (twice) this.target.centerOnSelection();
        this.lastGroupKey = { n, time: now };
      }
      return;
    }
    if (key.startsWith('arrow') || key === ' ') e.preventDefault();
    // Mit Auswahl sind S/A/D Befehle, ohne Auswahl Kamera (WASD)
    if (['s', 'a', 'd'].includes(key) && !this.target.hasSelection()) return;
    this.target.onKey(key === ' ' ? 'space' : key);
  }

  // ───────────── Auswahlrahmen ─────────────

  private showBox(b: { x0: number; y0: number; x1: number; y1: number } | null) {
    const el = this.dragBox;
    if (!b) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.style.left = `${Math.min(b.x0, b.x1)}px`;
    el.style.top = `${Math.min(b.y0, b.y1)}px`;
    el.style.width = `${Math.abs(b.x1 - b.x0)}px`;
    el.style.height = `${Math.abs(b.y1 - b.y0)}px`;
  }
}
