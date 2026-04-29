import { Mesh } from './Mesh.ts';
import type { Vertex } from './Vertex.ts';

export class MeshGenerator {
  // UV sphere. sectorCount = longitude subdivisions, stackCount = latitude subdivisions.
  static createSphere(device: GPUDevice, sectorCount = 128, stackCount = 128): Mesh {
    const vertices: Vertex[] = [];
    const indices: number[] = [];

    const sectorStep = (2 * Math.PI) / sectorCount;
    const stackStep  = Math.PI / stackCount;

    for (let i = 0; i <= stackCount; i++) {
      const stackAngle = Math.PI / 2 - i * stackStep; // pi/2 to -pi/2
      const xz = Math.cos(stackAngle);
      const y  = Math.sin(stackAngle);

      for (let j = 0; j <= sectorCount; j++) {
        const a = j * sectorStep;
        const x = xz * Math.cos(a);
        const z = xz * Math.sin(a);

        // tangent = d(position)/d(sector angle) — longitude direction
        vertices.push({
          position: [x, y, z],
          normal:   [x, y, z],
          texCoord: [j / sectorCount, i / stackCount],
          tangent:  [Math.sin(a), 0, -Math.cos(a)],
        });
      }
    }

    // CCW winding viewed from outside
    // k1--k1+1
    // | \  |
    // k2--k2+1
    for (let i = 0; i < stackCount; i++) {
      let k1 = i * (sectorCount + 1);
      let k2 = k1 + sectorCount + 1;
      for (let j = 0; j < sectorCount; j++, k1++, k2++) {
        if (i !== 0)             indices.push(k1, k1 + 1, k2);
        if (i !== stackCount - 1) indices.push(k1 + 1, k2 + 1, k2);
      }
    }

    return new Mesh(device, vertices, indices);
  }

  static createCube(device: GPUDevice): Mesh {
    const h = 0.5;

    type Face = {
      normal:  [number, number, number];
      tangent: [number, number, number];
      pos:     [[number,number,number],[number,number,number],[number,number,number],[number,number,number]];
    };

    // tangent = direction of increasing U in UV space (derived from face geometry)
    const faces: Face[] = [
      { normal: [ 1, 0, 0], tangent: [ 0, 0,-1], pos: [[ h,-h, h],[ h,-h,-h],[ h, h,-h],[ h, h, h]] },
      { normal: [-1, 0, 0], tangent: [ 0, 0, 1], pos: [[-h,-h,-h],[-h,-h, h],[-h, h, h],[-h, h,-h]] },
      { normal: [ 0, 1, 0], tangent: [ 1, 0, 0], pos: [[-h, h, h],[ h, h, h],[ h, h,-h],[-h, h,-h]] },
      { normal: [ 0,-1, 0], tangent: [ 1, 0, 0], pos: [[-h,-h,-h],[ h,-h,-h],[ h,-h, h],[-h,-h, h]] },
      { normal: [ 0, 0, 1], tangent: [ 1, 0, 0], pos: [[-h,-h, h],[ h,-h, h],[ h, h, h],[-h, h, h]] },
      { normal: [ 0, 0,-1], tangent: [-1, 0, 0], pos: [[ h,-h,-h],[-h,-h,-h],[-h, h,-h],[ h, h,-h]] },
    ];

    const uvs: [number, number][] = [[0,1],[1,1],[1,0],[0,0]];
    const vertices: Vertex[] = [];
    const indices: number[] = [];

    for (const face of faces) {
      const base = vertices.length;
      for (let v = 0; v < 4; v++) {
        vertices.push({ position: face.pos[v], normal: face.normal, texCoord: uvs[v], tangent: face.tangent });
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    return new Mesh(device, vertices, indices);
  }

  static createPlane(device: GPUDevice): Mesh {
    const h = 0.5;
    const vertices: Vertex[] = [
      { position: [-h, 0,  h], normal: [0,1,0], texCoord: [0,1], tangent: [1,0,0] },
      { position: [ h, 0,  h], normal: [0,1,0], texCoord: [1,1], tangent: [1,0,0] },
      { position: [ h, 0, -h], normal: [0,1,0], texCoord: [1,0], tangent: [1,0,0] },
      { position: [-h, 0, -h], normal: [0,1,0], texCoord: [0,0], tangent: [1,0,0] },
    ];
    const indices = [0, 1, 2, 0, 2, 3];
    return new Mesh(device, vertices, indices);
  }
}
