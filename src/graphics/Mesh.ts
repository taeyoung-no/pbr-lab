import { packVertices, type Vertex } from './Vertex.ts';

export class Mesh {
  private readonly _vertexBuffer: GPUBuffer;
  private readonly _indexBuffer:  GPUBuffer;
  private readonly _indexCount:   number;

  constructor(device: GPUDevice, vertices: Vertex[], indices: number[]) {
    this._indexCount = indices.length;

    const vData = packVertices(vertices);
    this._vertexBuffer = device.createBuffer({
      size:  vData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this._vertexBuffer, 0, vData);

    const iData = new Uint32Array(indices);
    this._indexBuffer = device.createBuffer({
      size:  iData.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this._indexBuffer, 0, iData);
  }

  draw(pass: GPURenderPassEncoder): void {
    pass.setVertexBuffer(0, this._vertexBuffer);
    pass.setIndexBuffer(this._indexBuffer, 'uint32');
    pass.drawIndexed(this._indexCount);
  }

  destroy(): void {
    this._vertexBuffer.destroy();
    this._indexBuffer.destroy();
  }
}
