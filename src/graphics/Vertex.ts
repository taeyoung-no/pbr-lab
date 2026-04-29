export interface Vertex {
  position: [number, number, number];
  normal:   [number, number, number];
  texCoord: [number, number];
  tangent:  [number, number, number];
}

export const VERTEX_FLOATS = 11; // 3 + 3 + 2 + 3
export const VERTEX_STRIDE = VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT; // 44 bytes

export const VERTEX_BUFFER_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: VERTEX_STRIDE,
  attributes: [
    { shaderLocation: 0, offset:  0, format: 'float32x3' }, // position
    { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
    { shaderLocation: 2, offset: 24, format: 'float32x2' }, // texCoord
    { shaderLocation: 3, offset: 32, format: 'float32x3' }, // tangent
  ],
};

export function packVertices(vertices: Vertex[]): Float32Array {
  const out = new Float32Array(vertices.length * VERTEX_FLOATS);
  let i = 0;
  for (const v of vertices) {
    out[i++] = v.position[0]; out[i++] = v.position[1]; out[i++] = v.position[2];
    out[i++] = v.normal[0];   out[i++] = v.normal[1];   out[i++] = v.normal[2];
    out[i++] = v.texCoord[0]; out[i++] = v.texCoord[1];
    out[i++] = v.tangent[0];  out[i++] = v.tangent[1];  out[i++] = v.tangent[2];
  }
  return out;
}
