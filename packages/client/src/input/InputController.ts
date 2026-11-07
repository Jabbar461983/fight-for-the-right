/**
 * Eingabe für Maus, Tastatur und Touch.
 *
 * Arbeitet direkt mit DOM-Pointer-Events auf der Spielfläche (nicht über Phaser),
 * damit Maus und Touch klar getrennt und Gesten (Pinch, langes Drücken) gut
 * kontrollierbar sind. Was eine Geste *bedeutet*, entscheidet das InputTarget
 * (die Spielszene). Alle Koordinaten sind Bildschirm-Pixel relativ zur Spielfläche.
 */

export interface InputTarget {
  panBy(dxScreen: number, dyScreen: number): void;
  zoomAt(factor: number, sx: number, sy: number): void;
  /** Wählt die Einheit unter dem Punkt. true, wenn eine getroffen wurde. */
  selectAt(sx: number, sy: number, additive: boolean, touch: boolean): boolean;
  /** Wählt alle eigenen Einheiten gleichen Typs im Bild. */
  selectSameTypeAt(sx: number, sy: number, touch: boolean): void;
  selectInBox(x0: number, y0: number, x1: number, y1: number, additive: boolean): void;
  /** Kontextbefehl (aktuell: hierhin fahren). */
  commandAt(sx: number, sy: number): void;
  hasSelection(): boolean;
  hitsOwnUnit(sx: number, sy: number, touch: boolean): boolean;
  clearSelection(): void;
  stop(): void;
  saveGroup(n: number): void;
  recallGroup(n: number): void;
  centerOnSelection(): void;
}

/** Ab dieser Bewegung (px) ist ein Klick/Tippen ein Ziehen. */
const DRAG_THRESHOLD_MOUSE = 6;
const DRAG_THRESHOLD_TOUCH = 12;
/** Zeitfenster für Doppelklick/Doppeltippen. */
const DOUBLE_MS = 350;
/** Ab so langem Drücken beginnt der Auswahlrahmen (Touch). */
const LONG_PRESS_MS = 400;
/** Breite des Randbereichs für Rand-Scrollen. */
const EDGE_PX = 14;
/** Kameratempo für Tasten/Rand in Bildschirm-Pixel pro Sekunde. */
const SCROLL_SPEED = 900;

interface TouchPoint {
  x: number;
  y: number;
}

type TouchMode = 'none' | 'pending' | 'pan' | 'box' | 'pinch';

export class InputController {
  private readonly el: HTMLElement;

  // Maus
  private mouse = { x: 0, y: 0, inside: false };
  private leftDown: { x: number; y: number; dragging: boolean } | null = null;
  private rightDown: { x: number; y: number; lastX: number; lastY: number; panning: boolean } | null = null;
  private lastClick = { time: 0, x: 0, y: 0 };

  // Touch
  private touches = new Map<number, TouchPoint>();
  private touchMode: TouchMode = 'none';
  private touchStart = { x: 0, y: 0 };
  private longPressTimer: number | undefined;
  private pinch = { dist: 0, midX: 0, midY: 0 };
  private lastTap = { time: 0, x: 0, y: 0 };

  // Tastatur
  private keys = new Set<string>();
  private lastGroupKey = { n: -1, time: 0 };

  constructor(
    element: HTMLElement,
    private readonly dragBox: HTMLElement,
    private readonly target: InputTarget,
  ) {
    this.el = element;
    element.style.touchAction = 'none';
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointercancel', this.onPointerCancel);
    element.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') this.mouse.inside = true;
    });
    element.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.mouse.inside = false;
    });
    element.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.inside = false;
    });
  }

  /** Pro Frame aufrufen: Kamera per Tastatur und Bildrand bewegen. */
  update(deltaMs: number): void {
    const step = (SCROLL_SPEED * deltaMs) / 1000;
    let dx = 0;
    let dy = 0;
    const k = this.keys;
    // WASD nur ohne Auswahl – mit Auswahl sind S/A Befehle.
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
    // panBy erwartet «Finger-Bewegung»: Karte folgt dem Finger → Kamera entgegengesetzt.
    if (dx !== 0 || dy !== 0) this.target.panBy(-dx, -dy);
  }

  /** Hält den Zeiger fest, auch wenn er die Spielfläche verlässt (Ziehen über den Rand). */
  private capture(e: PointerEvent) {
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // Kann bei bereits beendeten Zeigern fehlschlagen – unkritisch.
    }
  }

  private pos(e: PointerEvent): TouchPoint {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ───────────── Pointer-Verteilung ─────────────

  private onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') this.mouseDown(e);
    else this.touchDown(e);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') this.mouseMove(e);
    else this.touchMove(e);
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') this.mouseUp(e);
    else this.touchUp(e);
  };

  private onPointerCancel = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') {
      this.leftDown = null;
      this.rightDown = null;
      this.showBox(null);
    } else {
      this.touches.delete(e.pointerId);
      if (this.touches.size === 0) this.resetTouch();
    }
  };

  // ───────────── Maus ─────────────

  private mouseDown(e: PointerEvent) {
    const p = this.pos(e);
    this.capture(e);
    if (e.button === 0) {
      this.leftDown = { x: p.x, y: p.y, dragging: false };
    } else if (e.button === 2 || e.button === 1) {
      this.rightDown = { x: p.x, y: p.y, lastX: p.x, lastY: p.y, panning: e.button === 1 };
    }
  }

  private mouseMove(e: PointerEvent) {
    const p = this.pos(e);
    this.mouse.x = p.x;
    this.mouse.y = p.y;
    this.mouse.inside = true;
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
      const isDouble =
        now - this.lastClick.time < DOUBLE_MS && Math.hypot(p.x - this.lastClick.x, p.y - this.lastClick.y) < 10;
      this.lastClick = { time: isDouble ? 0 : now, x: p.x, y: p.y };
      if (isDouble) {
        this.target.selectSameTypeAt(p.x, p.y, false);
      } else if (!this.target.selectAt(p.x, p.y, e.shiftKey, false) && !e.shiftKey) {
        this.target.clearSelection();
      }
    } else if ((e.button === 2 || e.button === 1) && this.rightDown) {
      const r = this.rightDown;
      this.rightDown = null;
      if (!r.panning && e.button === 2) this.target.commandAt(p.x, p.y);
    }
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = this.el.getBoundingClientRect();
    // Trackpads liefern viele kleine Schritte, Mausräder grosse – beides sanft behandeln.
    const factor = Math.pow(1.0015, -e.deltaY * (e.deltaMode === 1 ? 33 : 1));
    this.target.zoomAt(factor, e.clientX - r.left, e.clientY - r.top);
  };

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
      // Zweiter Finger: Pinch/Verschieben, laufende Geste abbrechen.
      clearTimeout(this.longPressTimer);
      this.showBox(null);
      this.touchMode = 'pinch';
      this.startPinch();
    }
  }

  private startPinch() {
    const [a, b] = [...this.touches.values()];
    this.pinch = {
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
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
      // Nach dem Pinch erst wieder reagieren, wenn alle Finger weg sind.
      if (this.touches.size === 1) this.startPinchRemainder();
      if (this.touches.size === 0) this.resetTouch();
      return;
    }
    if (this.touches.size > 0) return;
    const mode = this.touchMode;
    this.resetTouch();
    if (mode === 'box') {
      this.target.selectInBox(this.touchStart.x, this.touchStart.y, p.x, p.y, false);
    } else if (mode === 'pending') {
      this.tap(p.x, p.y);
    }
  }

  /** Ein Finger bleibt nach dem Pinch liegen: nicht als Tippen werten. */
  private startPinchRemainder() {
    this.pinch.dist = 1;
  }

  private resetTouch() {
    clearTimeout(this.longPressTimer);
    this.touchMode = 'none';
    this.showBox(null);
  }

  private tap(x: number, y: number) {
    const now = performance.now();
    const isDouble = now - this.lastTap.time < DOUBLE_MS && Math.hypot(x - this.lastTap.x, y - this.lastTap.y) < 30;
    this.lastTap = { time: isDouble ? 0 : now, x, y };
    if (this.target.hitsOwnUnit(x, y, true)) {
      if (isDouble) this.target.selectSameTypeAt(x, y, true);
      else this.target.selectAt(x, y, false, true);
    } else if (this.target.hasSelection()) {
      this.target.commandAt(x, y);
    }
  }

  // ───────────── Tastatur ─────────────

  private onKeyDown = (e: KeyboardEvent) => {
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
    const key = e.key.toLowerCase();
    this.keys.add(key);

    // Ziffern über e.code, damit Shift/Tastaturlayout keine Rolle spielen.
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

    switch (key) {
      case 's':
        if (this.target.hasSelection()) this.target.stop();
        break;
      case ' ':
        e.preventDefault();
        this.target.centerOnSelection();
        break;
      case 'escape':
        this.target.clearSelection();
        break;
      case 'arrowleft':
      case 'arrowright':
      case 'arrowup':
      case 'arrowdown':
        e.preventDefault();
        break;
    }
  };

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
