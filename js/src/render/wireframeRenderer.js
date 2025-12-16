/**
 * Wireframe Renderer for Apollo64
 *
 * N64-style wireframe graphics rendering system.
 * Designed for 320x240 resolution with 2x upscaling.
 *
 * Visual style references:
 * - Apollo Guidance Computer DSKY display
 * - 1960s NASA mission control displays
 * - Early flight simulators (wireframe vector graphics)
 * - N64 limitations: ~100k polys/frame, limited fill rate
 *
 * This module provides:
 * - Wireframe mesh rendering
 * - Trajectory visualization
 * - Panel/instrument rendering
 * - Command timeline display (DDR-style)
 */

// N64 target resolution
const NATIVE_WIDTH = 320;
const NATIVE_HEIGHT = 240;
const UPSCALE_FACTOR = 2;

// Color palette (N64 style - limited colors, high contrast)
const COLORS = {
  // Primary colors
  BACKGROUND: '#000000',
  WIREFRAME: '#00ff00',      // Classic green CRT
  WIREFRAME_DIM: '#006600',
  WIREFRAME_BRIGHT: '#66ff66',

  // UI colors
  TEXT_PRIMARY: '#ffffff',
  TEXT_SECONDARY: '#aaaaaa',
  TEXT_WARNING: '#ffff00',
  TEXT_DANGER: '#ff4444',
  TEXT_SUCCESS: '#44ff44',

  // Trajectory colors
  TRAJECTORY_NOMINAL: '#00ffff',
  TRAJECTORY_ACTUAL: '#ffff00',
  TRAJECTORY_PREDICTED: '#ff00ff',

  // Object colors
  CSM: '#00ff00',
  LM: '#00ffff',
  MOON: '#666666',
  EARTH: '#4444ff',
  SUN: '#ffff00',

  // Panel colors
  PANEL_BG: '#111111',
  PANEL_BORDER: '#444444',
  SWITCH_ON: '#00ff00',
  SWITCH_OFF: '#333333',
  INDICATOR_ACTIVE: '#ff0000',

  // Command timing colors
  CMD_PERFECT: '#00ff00',
  CMD_GREAT: '#88ff00',
  CMD_GOOD: '#ffff00',
  CMD_OK: '#ff8800',
  CMD_LATE: '#ff4400',
  CMD_MISS: '#ff0000',
};

// Wireframe mesh definitions for spacecraft
const MESHES = {
  CSM: {
    name: 'Command/Service Module',
    vertices: [
      // Command Module (cone)
      [0, 0, 3.2],           // Apex
      [1.95, 0, 0],          // Base ring
      [1.38, 1.38, 0],
      [0, 1.95, 0],
      [-1.38, 1.38, 0],
      [-1.95, 0, 0],
      [-1.38, -1.38, 0],
      [0, -1.95, 0],
      [1.38, -1.38, 0],
      // Service Module (cylinder)
      [1.95, 0, -7.5],
      [1.38, 1.38, -7.5],
      [0, 1.95, -7.5],
      [-1.38, 1.38, -7.5],
      [-1.95, 0, -7.5],
      [-1.38, -1.38, -7.5],
      [0, -1.95, -7.5],
      [1.38, -1.38, -7.5],
      // SPS nozzle
      [0, 0, -8.5],
    ],
    edges: [
      // CM cone
      [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8],
      // CM base ring
      [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 1],
      // SM walls
      [1, 9], [2, 10], [3, 11], [4, 12], [5, 13], [6, 14], [7, 15], [8, 16],
      // SM base ring
      [9, 10], [10, 11], [11, 12], [12, 13], [13, 14], [14, 15], [15, 16], [16, 9],
      // Nozzle
      [9, 17], [11, 17], [13, 17], [15, 17],
    ],
    scale: 10,
  },

  LM: {
    name: 'Lunar Module',
    vertices: [
      // Ascent stage (boxy)
      [2.35, 2.35, 3.76],
      [-2.35, 2.35, 3.76],
      [-2.35, -2.35, 3.76],
      [2.35, -2.35, 3.76],
      [2.35, 2.35, 0.5],
      [-2.35, 2.35, 0.5],
      [-2.35, -2.35, 0.5],
      [2.35, -2.35, 0.5],
      // Descent stage (octagonal)
      [2.0, 0, 0],
      [1.41, 1.41, 0],
      [0, 2.0, 0],
      [-1.41, 1.41, 0],
      [-2.0, 0, 0],
      [-1.41, -1.41, 0],
      [0, -2.0, 0],
      [1.41, -1.41, 0],
      [2.0, 0, -2.0],
      [1.41, 1.41, -2.0],
      [0, 2.0, -2.0],
      [-1.41, 1.41, -2.0],
      [-2.0, 0, -2.0],
      [-1.41, -1.41, -2.0],
      [0, -2.0, -2.0],
      [1.41, -1.41, -2.0],
      // Landing legs (simplified)
      [3.5, 0, -2.5],
      [0, 3.5, -2.5],
      [-3.5, 0, -2.5],
      [0, -3.5, -2.5],
    ],
    edges: [
      // Ascent stage top
      [0, 1], [1, 2], [2, 3], [3, 0],
      // Ascent stage bottom
      [4, 5], [5, 6], [6, 7], [7, 4],
      // Ascent stage walls
      [0, 4], [1, 5], [2, 6], [3, 7],
      // Descent stage top ring
      [8, 9], [9, 10], [10, 11], [11, 12], [12, 13], [13, 14], [14, 15], [15, 8],
      // Descent stage bottom ring
      [16, 17], [17, 18], [18, 19], [19, 20], [20, 21], [21, 22], [22, 23], [23, 16],
      // Descent stage walls
      [8, 16], [10, 18], [12, 20], [14, 22],
      // Landing legs
      [8, 24], [10, 25], [12, 26], [14, 27],
      [16, 24], [18, 25], [20, 26], [22, 27],
    ],
    scale: 8,
  },

  MOON: {
    name: 'Moon',
    vertices: [], // Generated sphere
    edges: [],
    scale: 1737.4, // km radius
    generate: 'sphere',
    segments: 16,
  },

  EARTH: {
    name: 'Earth',
    vertices: [],
    edges: [],
    scale: 6371, // km radius
    generate: 'sphere',
    segments: 24,
  },
};

// Camera presets
const CAMERA_PRESETS = {
  EXTERNAL_CSM: {
    position: [50, 30, 20],
    target: [0, 0, 0],
    up: [0, 1, 0],
    fov: 60,
  },
  COCKPIT_CDR: {
    position: [0.5, 0, 1],
    target: [0.5, 0, 10],
    up: [0, 1, 0],
    fov: 90,
  },
  TRAJECTORY_OVERVIEW: {
    position: [0, 0, 500000],
    target: [0, 0, 0],
    up: [0, 1, 0],
    fov: 45,
  },
  LUNAR_APPROACH: {
    position: [0, 50000, 0],
    target: [0, 0, 0],
    up: [0, 0, 1],
    fov: 30,
  },
};

/**
 * Generate sphere wireframe vertices and edges
 */
function generateSphere(segments) {
  const vertices = [];
  const edges = [];

  // Generate vertices
  for (let lat = 0; lat <= segments; lat++) {
    const theta = (lat * Math.PI) / segments;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let lon = 0; lon < segments; lon++) {
      const phi = (lon * 2 * Math.PI) / segments;
      const x = sinTheta * Math.cos(phi);
      const y = cosTheta;
      const z = sinTheta * Math.sin(phi);
      vertices.push([x, y, z]);
    }
  }

  // Generate edges (latitude lines)
  for (let lat = 0; lat <= segments; lat++) {
    for (let lon = 0; lon < segments; lon++) {
      const current = lat * segments + lon;
      const next = lat * segments + ((lon + 1) % segments);
      edges.push([current, next]);
    }
  }

  // Generate edges (longitude lines)
  for (let lat = 0; lat < segments; lat++) {
    for (let lon = 0; lon < segments; lon++) {
      const current = lat * segments + lon;
      const below = (lat + 1) * segments + lon;
      edges.push([current, below]);
    }
  }

  return { vertices, edges };
}

/**
 * Matrix math utilities for 3D transformations
 */
const Mat4 = {
  identity() {
    return [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
  },

  multiply(a, b) {
    const result = new Array(16).fill(0);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        for (let i = 0; i < 4; i++) {
          result[row * 4 + col] += a[row * 4 + i] * b[i * 4 + col];
        }
      }
    }
    return result;
  },

  translate(x, y, z) {
    return [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      x, y, z, 1,
    ];
  },

  scale(sx, sy, sz) {
    return [
      sx, 0, 0, 0,
      0, sy, 0, 0,
      0, 0, sz, 0,
      0, 0, 0, 1,
    ];
  },

  rotateX(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [
      1, 0, 0, 0,
      0, c, s, 0,
      0, -s, c, 0,
      0, 0, 0, 1,
    ];
  },

  rotateY(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [
      c, 0, -s, 0,
      0, 1, 0, 0,
      s, 0, c, 0,
      0, 0, 0, 1,
    ];
  },

  rotateZ(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [
      c, s, 0, 0,
      -s, c, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
  },

  perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan((fov * Math.PI) / 360);
    const rangeInv = 1 / (near - far);
    return [
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (near + far) * rangeInv, -1,
      0, 0, near * far * rangeInv * 2, 0,
    ];
  },

  lookAt(eye, center, up) {
    const zAxis = Vec3.normalize(Vec3.subtract(eye, center));
    const xAxis = Vec3.normalize(Vec3.cross(up, zAxis));
    const yAxis = Vec3.cross(zAxis, xAxis);

    return [
      xAxis[0], yAxis[0], zAxis[0], 0,
      xAxis[1], yAxis[1], zAxis[1], 0,
      xAxis[2], yAxis[2], zAxis[2], 0,
      -Vec3.dot(xAxis, eye), -Vec3.dot(yAxis, eye), -Vec3.dot(zAxis, eye), 1,
    ];
  },

  transformPoint(m, p) {
    const x = p[0], y = p[1], z = p[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [
      (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
    ];
  },
};

const Vec3 = {
  subtract(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  },

  cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  },

  dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  },

  normalize(v) {
    const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0];
  },

  length(v) {
    return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  },
};

/**
 * Wireframe Renderer class
 */
export class WireframeRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = options.width ?? NATIVE_WIDTH * UPSCALE_FACTOR;
    this.height = options.height ?? NATIVE_HEIGHT * UPSCALE_FACTOR;
    this.pixelScale = options.pixelScale ?? UPSCALE_FACTOR;

    // Set canvas size
    canvas.width = this.width;
    canvas.height = this.height;

    // Camera state
    this.camera = {
      position: [50, 30, 20],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fov: 60,
      near: 0.1,
      far: 1000000,
    };

    // Scene objects
    this.objects = [];

    // Initialize meshes with generated spheres
    this.meshes = { ...MESHES };
    for (const [key, mesh] of Object.entries(this.meshes)) {
      if (mesh.generate === 'sphere') {
        const sphere = generateSphere(mesh.segments);
        mesh.vertices = sphere.vertices;
        mesh.edges = sphere.edges;
      }
    }

    // Frame stats
    this.frameCount = 0;
    this.lastFrameTime = 0;
    this.fps = 0;
  }

  /**
   * Set camera preset
   */
  setCamera(presetName) {
    const preset = CAMERA_PRESETS[presetName];
    if (preset) {
      this.camera = { ...this.camera, ...preset };
    }
  }

  /**
   * Set camera position directly
   */
  setCameraPosition(position, target = null, up = null) {
    this.camera.position = position;
    if (target) this.camera.target = target;
    if (up) this.camera.up = up;
  }

  /**
   * Add object to scene
   */
  addObject(object) {
    this.objects.push({
      meshId: object.meshId,
      position: object.position ?? [0, 0, 0],
      rotation: object.rotation ?? [0, 0, 0],
      scale: object.scale ?? 1,
      color: object.color ?? COLORS.WIREFRAME,
      visible: object.visible ?? true,
      label: object.label ?? null,
    });
    return this.objects.length - 1;
  }

  /**
   * Update object transform
   */
  updateObject(index, updates) {
    if (index >= 0 && index < this.objects.length) {
      Object.assign(this.objects[index], updates);
    }
  }

  /**
   * Clear the scene
   */
  clear() {
    this.ctx.fillStyle = COLORS.BACKGROUND;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  /**
   * Render the scene
   */
  render() {
    const startTime = performance.now();

    // Clear
    this.clear();

    // Calculate view-projection matrix
    const aspect = this.width / this.height;
    const projection = Mat4.perspective(this.camera.fov, aspect, this.camera.near, this.camera.far);
    const view = Mat4.lookAt(this.camera.position, this.camera.target, this.camera.up);
    const viewProjection = Mat4.multiply(projection, view);

    // Render each object
    for (const obj of this.objects) {
      if (!obj.visible) continue;

      const mesh = this.meshes[obj.meshId];
      if (!mesh) continue;

      // Calculate model matrix
      let model = Mat4.identity();
      model = Mat4.multiply(model, Mat4.translate(...obj.position));
      model = Mat4.multiply(model, Mat4.rotateX(obj.rotation[0]));
      model = Mat4.multiply(model, Mat4.rotateY(obj.rotation[1]));
      model = Mat4.multiply(model, Mat4.rotateZ(obj.rotation[2]));
      model = Mat4.multiply(model, Mat4.scale(obj.scale * mesh.scale, obj.scale * mesh.scale, obj.scale * mesh.scale));

      const mvp = Mat4.multiply(viewProjection, model);

      // Transform and project vertices
      const projected = mesh.vertices.map((v) => {
        const transformed = Mat4.transformPoint(mvp, v);
        return [
          (transformed[0] + 1) * 0.5 * this.width,
          (1 - transformed[1]) * 0.5 * this.height,
          transformed[2],
        ];
      });

      // Draw edges
      this.ctx.strokeStyle = obj.color;
      this.ctx.lineWidth = this.pixelScale;
      this.ctx.beginPath();

      for (const [i1, i2] of mesh.edges) {
        const p1 = projected[i1];
        const p2 = projected[i2];

        // Basic frustum culling
        if (p1[2] < -1 || p1[2] > 1 || p2[2] < -1 || p2[2] > 1) continue;

        this.ctx.moveTo(p1[0], p1[1]);
        this.ctx.lineTo(p2[0], p2[1]);
      }

      this.ctx.stroke();

      // Draw label if present
      if (obj.label) {
        const center = Mat4.transformPoint(mvp, [0, 0, 0]);
        const screenX = (center[0] + 1) * 0.5 * this.width;
        const screenY = (1 - center[1]) * 0.5 * this.height;

        this.ctx.fillStyle = COLORS.TEXT_PRIMARY;
        this.ctx.font = `${12 * this.pixelScale}px monospace`;
        this.ctx.textAlign = 'center';
        this.ctx.fillText(obj.label, screenX, screenY - 20 * this.pixelScale);
      }
    }

    // Update FPS
    const endTime = performance.now();
    this.frameCount++;
    if (endTime - this.lastFrameTime > 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFrameTime = endTime;
    }
  }

  /**
   * Draw trajectory path
   */
  drawTrajectory(points, color = COLORS.TRAJECTORY_NOMINAL) {
    if (points.length < 2) return;

    const aspect = this.width / this.height;
    const projection = Mat4.perspective(this.camera.fov, aspect, this.camera.near, this.camera.far);
    const view = Mat4.lookAt(this.camera.position, this.camera.target, this.camera.up);
    const vp = Mat4.multiply(projection, view);

    const projected = points.map((p) => {
      const transformed = Mat4.transformPoint(vp, p);
      return [
        (transformed[0] + 1) * 0.5 * this.width,
        (1 - transformed[1]) * 0.5 * this.height,
        transformed[2],
      ];
    });

    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = this.pixelScale;
    this.ctx.setLineDash([4 * this.pixelScale, 4 * this.pixelScale]);
    this.ctx.beginPath();

    this.ctx.moveTo(projected[0][0], projected[0][1]);
    for (let i = 1; i < projected.length; i++) {
      if (projected[i][2] >= -1 && projected[i][2] <= 1) {
        this.ctx.lineTo(projected[i][0], projected[i][1]);
      } else {
        this.ctx.moveTo(projected[i][0], projected[i][1]);
      }
    }

    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  /**
   * Draw HUD overlay
   */
  drawHUD(data) {
    const margin = 10 * this.pixelScale;
    const lineHeight = 14 * this.pixelScale;
    const fontSize = 12 * this.pixelScale;

    this.ctx.font = `${fontSize}px monospace`;
    this.ctx.textAlign = 'left';

    // Top-left: GET and phase
    let y = margin + lineHeight;
    this.ctx.fillStyle = COLORS.TEXT_PRIMARY;
    this.ctx.fillText(`GET ${data.get ?? '--:--:--'}`, margin, y);
    y += lineHeight;
    this.ctx.fillStyle = COLORS.TEXT_SECONDARY;
    this.ctx.fillText(`Phase: ${data.phase ?? 'Unknown'}`, margin, y);

    // Top-right: Resources
    this.ctx.textAlign = 'right';
    y = margin + lineHeight;
    this.ctx.fillStyle = COLORS.TEXT_PRIMARY;
    this.ctx.fillText(`PWR ${data.power ?? '--'}%`, this.width - margin, y);
    y += lineHeight;
    this.ctx.fillText(`Δv ${data.deltaV ?? '--'} m/s`, this.width - margin, y);

    // Bottom-left: Drift status
    this.ctx.textAlign = 'left';
    y = this.height - margin - lineHeight * 2;
    const driftColor = this.#getDriftColor(data.driftSeverity);
    this.ctx.fillStyle = driftColor;
    this.ctx.fillText(`DRIFT: ${data.drift ?? '+0.0s'}`, margin, y);
    y += lineHeight;
    this.ctx.fillStyle = COLORS.TEXT_SECONDARY;
    this.ctx.fillText(`${data.driftSeverity ?? 'NOMINAL'}`, margin, y);

    // Bottom-right: FPS (debug)
    this.ctx.textAlign = 'right';
    this.ctx.fillStyle = COLORS.TEXT_SECONDARY;
    this.ctx.fillText(`${this.fps} FPS`, this.width - margin, this.height - margin);
  }

  /**
   * Draw command timeline (DDR-style)
   */
  drawCommandTimeline(timeline) {
    const timelineWidth = 80 * this.pixelScale;
    const timelineX = this.width - timelineWidth - 10 * this.pixelScale;
    const timelineTop = 60 * this.pixelScale;
    const timelineBottom = this.height - 60 * this.pixelScale;
    const timelineHeight = timelineBottom - timelineTop;

    // Draw timeline background
    this.ctx.fillStyle = COLORS.PANEL_BG;
    this.ctx.fillRect(timelineX, timelineTop, timelineWidth, timelineHeight);
    this.ctx.strokeStyle = COLORS.PANEL_BORDER;
    this.ctx.lineWidth = this.pixelScale;
    this.ctx.strokeRect(timelineX, timelineTop, timelineWidth, timelineHeight);

    // Draw "hit zone" line
    const hitLineY = timelineBottom - 30 * this.pixelScale;
    this.ctx.strokeStyle = COLORS.WIREFRAME;
    this.ctx.lineWidth = 2 * this.pixelScale;
    this.ctx.beginPath();
    this.ctx.moveTo(timelineX, hitLineY);
    this.ctx.lineTo(timelineX + timelineWidth, hitLineY);
    this.ctx.stroke();

    // Draw commands
    if (timeline?.commands) {
      for (const cmd of timeline.commands) {
        const relativeTime = cmd.secondsFromNow ?? 0;
        const normalizedY = relativeTime / (timeline.windowEnd - timeline.currentGetSeconds);
        const y = hitLineY - normalizedY * (timelineHeight - 60 * this.pixelScale);

        if (y < timelineTop || y > timelineBottom) continue;

        // Command marker
        const cmdColor = this.#getCommandColor(cmd.status, cmd.grade);
        this.ctx.fillStyle = cmdColor;
        this.ctx.beginPath();
        this.ctx.arc(
          timelineX + timelineWidth / 2,
          y,
          8 * this.pixelScale,
          0,
          Math.PI * 2
        );
        this.ctx.fill();

        // Command type icon
        this.ctx.fillStyle = COLORS.TEXT_PRIMARY;
        this.ctx.font = `${10 * this.pixelScale}px monospace`;
        this.ctx.textAlign = 'center';
        this.ctx.fillText(cmd.typeIcon ?? '●', timelineX + timelineWidth / 2, y + 4 * this.pixelScale);
      }
    }

    // Draw "COMMANDS" label
    this.ctx.fillStyle = COLORS.TEXT_SECONDARY;
    this.ctx.font = `${10 * this.pixelScale}px monospace`;
    this.ctx.textAlign = 'center';
    this.ctx.fillText('COMMANDS', timelineX + timelineWidth / 2, timelineTop - 5 * this.pixelScale);
  }

  #getDriftColor(severity) {
    switch (severity) {
      case 'NOMINAL': return COLORS.TEXT_SUCCESS;
      case 'MINOR': return COLORS.TEXT_PRIMARY;
      case 'MODERATE': return COLORS.TEXT_WARNING;
      case 'SIGNIFICANT':
      case 'MAJOR':
      case 'CRITICAL': return COLORS.TEXT_DANGER;
      default: return COLORS.TEXT_PRIMARY;
    }
  }

  #getCommandColor(status, grade) {
    if (status === 'completed') {
      switch (grade) {
        case 'PERFECT': return COLORS.CMD_PERFECT;
        case 'GREAT': return COLORS.CMD_GREAT;
        case 'GOOD': return COLORS.CMD_GOOD;
        case 'OK': return COLORS.CMD_OK;
        case 'LATE': return COLORS.CMD_LATE;
        case 'MISS': return COLORS.CMD_MISS;
        default: return COLORS.CMD_GOOD;
      }
    }
    if (status === 'missed') return COLORS.CMD_MISS;
    if (status === 'active') return COLORS.WIREFRAME_BRIGHT;
    return COLORS.WIREFRAME_DIM;
  }
}

export { COLORS, MESHES, CAMERA_PRESETS, NATIVE_WIDTH, NATIVE_HEIGHT, UPSCALE_FACTOR, Mat4, Vec3 };
