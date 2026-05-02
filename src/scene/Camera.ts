import { mat4, vec3 } from 'wgpu-matrix';
import type { Mat4, Vec3 } from 'wgpu-matrix';

export class Camera {
  private radius:    number;
  private azimuth:   number;
  private elevation: number;

  private width  = 1280;
  private height = 720;

  private dragging = false;
  private prevX    = 0;
  private prevY    = 0;

  private readonly canvas: HTMLCanvasElement;

  private readonly onPointerDown: (e: PointerEvent) => void;
  private readonly onPointerMove: (e: PointerEvent) => void;
  private readonly onPointerUp:   (e: PointerEvent) => void;
  private readonly onWheel:       (e: WheelEvent)   => void;

  constructor(canvas: HTMLCanvasElement, radius = 5) {
    this.canvas    = canvas;
    this.radius    = radius;
    this.azimuth   = 0;
    this.elevation = 0.3;

    this.onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.prevX = e.clientX;
      this.prevY = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
    };

    this.onPointerMove = (e: PointerEvent): void => {
      if (!this.dragging) return;
      this.azimuth   -= (e.clientX - this.prevX) * (Math.PI / this.width);
      this.elevation += (e.clientY - this.prevY) * (Math.PI / this.height);
      this.prevX = e.clientX;
      this.prevY = e.clientY;
      const LIMIT = 89 * (Math.PI / 180);
      this.elevation = Math.max(-LIMIT, Math.min(LIMIT, this.elevation));
    };

    this.onPointerUp = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      this.dragging = false;
    };

    // deltaY * 0.005 ≈ 0.5 units per 100px scroll notch, matching GLFW yOffset * 0.5
    this.onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const delta = e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? e.deltaY * 0.005 : e.deltaY * 0.5;
      this.radius = Math.max(3, Math.min(10, this.radius + delta));
    };

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup',   this.onPointerUp);
    this.canvas.addEventListener('wheel',       this.onWheel, { passive: false });
  }

  setSize(width: number, height: number): void {
    this.width  = width;
    this.height = height;
  }

  getPosition(): Vec3 {
    const cx = Math.cos(this.elevation);
    return vec3.fromValues(
      this.radius * cx * Math.sin(this.azimuth),
      this.radius * Math.sin(this.elevation),
      this.radius * cx * Math.cos(this.azimuth),
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
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup',   this.onPointerUp);
    this.canvas.removeEventListener('wheel',       this.onWheel);
  }
}
