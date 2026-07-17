import type { NormalizedRect } from "./collageEngine";

interface GpuPhoto {
  dataUrl: string;
}

function loadGpuImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A collage photo could not be decoded."));
    image.src = source;
  });
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("GPU shader allocation failed.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(shader) || "unknown shader error";
    gl.deleteShader(shader);
    throw new Error(detail);
  }
  return shader;
}

function rgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return [1, 1, 1];
  const value = Number.parseInt(match[1], 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** Rectangle-only accelerated photo layer. Shape layouts intentionally fall back to 2D canvas. */
export async function renderPhotosWebGL2(input: {
  photos: GpuPhoto[];
  rects: NormalizedRect[];
  width: number;
  height: number;
  background: string;
}): Promise<HTMLCanvasElement | null> {
  if (input.photos.length < 2 || input.rects.some((rect) => rect.shape && rect.shape !== "rect")) return null;
  const canvas = document.createElement("canvas");
  canvas.width = input.width;
  canvas.height = input.height;
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  if (!gl) return null;

  try {
    const vertex = compile(gl, gl.VERTEX_SHADER, `#version 300 es
      in vec2 a_position;
      in vec2 a_uv;
      out vec2 v_uv;
      void main() { gl_Position = vec4(a_position, 0.0, 1.0); v_uv = a_uv; }
    `);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, `#version 300 es
      precision mediump float;
      uniform sampler2D u_texture;
      in vec2 v_uv;
      out vec4 outColor;
      void main() { outColor = texture(u_texture, v_uv); }
    `);
    const program = gl.createProgram();
    if (!program) throw new Error("GPU program allocation failed.");
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "GPU link failed.");
    gl.deleteShader(vertex); gl.deleteShader(fragment); gl.useProgram(program);
    const positionLocation = gl.getAttribLocation(program, "a_position");
    const uvLocation = gl.getAttribLocation(program, "a_uv");
    const positionBuffer = gl.createBuffer();
    const uvBuffer = gl.createBuffer();
    if (!positionBuffer || !uvBuffer) throw new Error("GPU buffer allocation failed.");
    const [red, green, blue] = rgb(input.background);
    gl.viewport(0, 0, input.width, input.height); gl.clearColor(red, green, blue, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    for (let index = 0; index < input.photos.length; index += 1) {
      const rect = input.rects[index];
      if (!rect) continue;
      const image = await loadGpuImage(input.photos[index].dataUrl);
      const x0 = rect.x * 2 - 1;
      const x1 = (rect.x + rect.width) * 2 - 1;
      const y1 = 1 - rect.y * 2;
      const y0 = 1 - (rect.y + rect.height) * 2;
      const positions = new Float32Array([x0, y0, x1, y0, x0, y1, x0, y1, x1, y0, x1, y1]);
      const imageAspect = image.naturalWidth / image.naturalHeight;
      const rectAspect = (rect.width * input.width) / (rect.height * input.height);
      let u0 = 0, u1 = 1, v0 = 0, v1 = 1;
      if (imageAspect > rectAspect) { const span = rectAspect / imageAspect; u0 = (1 - span) / 2; u1 = 1 - u0; }
      else { const span = imageAspect / rectAspect; v0 = (1 - span) / 2; v1 = 1 - v0; }
      const uvs = new Float32Array([u0, v0, u1, v0, u0, v1, u0, v1, u1, v0, u1, v1]);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer); gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STREAM_DRAW); gl.enableVertexAttribArray(positionLocation); gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer); gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STREAM_DRAW); gl.enableVertexAttribArray(uvLocation); gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 0, 0);
      const texture = gl.createTexture();
      if (!texture) throw new Error("GPU texture allocation failed.");
      gl.bindTexture(gl.TEXTURE_2D, texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image); gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.deleteTexture(texture); image.src = "";
    }
    gl.finish();
    gl.deleteBuffer(positionBuffer); gl.deleteBuffer(uvBuffer); gl.deleteProgram(program);
    return canvas;
  } catch {
    const loseContext = gl.getExtension("WEBGL_lose_context");
    loseContext?.loseContext();
    return null;
  }
}
