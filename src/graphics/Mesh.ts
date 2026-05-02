import { packVertices, type Vertex } from './Vertex.ts';

export class Mesh {
  private readonly vertexBuffer: GPUBuffer;
  private readonly indexBuffer:  GPUBuffer;
  private readonly indexCount:   number;

  constructor(device: GPUDevice, vertices: Vertex[], indices: number[]) {
    this.indexCount = indices.length;

    const vData = packVertices(vertices);
    this.vertexBuffer = device.createBuffer({
      size:  vData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.vertexBuffer, 0, vData);

    const iData = new Uint32Array(indices);
    this.indexBuffer = device.createBuffer({
      size:  iData.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.indexBuffer, 0, iData);
  }

  draw(pass: GPURenderPassEncoder): void {
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setIndexBuffer(this.indexBuffer, 'uint32');
    pass.drawIndexed(this.indexCount);
  }

  destroy(): void {
    this.vertexBuffer.destroy();
    this.indexBuffer.destroy();
  }
}
