import { mat4, vec3 } from 'wgpu-matrix';
import type { Mat4, Vec3 } from 'wgpu-matrix';

export class Camera {
  private _radius:    number;
  private _azimuth:   number;
  private _elevation: number;

  private _width  = 1280;
  private _height = 720;

  private _dragging = false;
  private _prevX    = 0;
  private _prevY    = 0;

  private readonly _canvas: HTMLCanvasElement;

  private readonly _onPointerDown: (e: PointerEvent) => void;
  private readonly _onPointerMove: (e: PointerEvent) => void;
  private readonly _onPointerUp:   (e: PointerEvent) => void;
  private readonly _onWheel:       (e: WheelEvent)   => void;

  constructor(canvas: HTMLCanvasElement, radius = 5) {
    this._canvas    = canvas;
    this._radius    = radius;
    this._azimuth   = 0;
    this._elevation = 0.3;

    this._onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      this._dragging = true;
      this._prevX = e.clientX;
      this._prevY = e.clientY;
      this._canvas.setPointerCapture(e.pointerId);
    };

    this._onPointerMove = (e: PointerEvent): void => {
      if (!this._dragging) return;
      this._azimuth   -= (e.clientX - this._prevX) * (Math.PI / this._width);
      this._elevation += (e.clientY - this._prevY) * (Math.PI / this._height);
      this._prevX = e.clientX;
      this._prevY = e.clientY;
      const LIMIT = 89 * (Math.PI / 180);
      this._elevation = Math.max(-LIMIT, Math.min(LIMIT, this._elevation));
    };

    this._onPointerUp = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      this._dragging = false;
    };

    // deltaY * 0.005 ≈ 0.5 units per 100px scroll notch, matching GLFW yOffset * 0.5
    this._onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const delta = e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? e.deltaY * 0.005 : e.deltaY * 0.5;
      this._radius = Math.max(3, Math.min(10, this._radius + delta));
    };

    this._canvas.addEventListener('pointerdown', this._onPointerDown);
    this._canvas.addEventListener('pointermove', this._onPointerMove);
    this._canvas.addEventListener('pointerup',   this._onPointerUp);
    this._canvas.addEventListener('wheel',       this._onWheel, { passive: false });
  }

  setSize(width: number, height: number): void {
    this._width  = width;
    this._height = height;
  }

  getPosition(): Vec3 {
    const cx = Math.cos(this._elevation);
    return vec3.fromValues(
      this._radius * cx * Math.sin(this._azimuth),
      this._radius * Math.sin(this._elevation),
      this._radius * cx * Math.cos(this._azimuth),
    );
  }

  getView(): Mat4 {
    return mat4.lookAt(
      this.getPosition(),
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(0, 1, 0),
    );
  }

  destroy(): void {
    this._canvas.removeEventListener('pointerdown', this._onPointerDown);
    this._canvas.removeEventListener('pointermove', this._onPointerMove);
    this._canvas.removeEventListener('pointerup',   this._onPointerUp);
    this._canvas.removeEventListener('wheel',       this._onWheel);
  }
}
