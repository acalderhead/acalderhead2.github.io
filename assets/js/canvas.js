/**
 * canvas.js — Flat-top isometric hex tessellation background
 *
 * Replaces the neural-network canvas from the original design.
 * Renders a Catan-style hex grid that responds to mouse hover (raise tiles)
 * and click (ripple wave). The canvas is fixed behind all page content.
 *
 * Public API (consumed by app.js):
 *   HexCanvas.init()   — boot, called once on DOMContentLoaded
 *   HexCanvas.resize() — called by window resize handler in app.js
 *
 * Design notes
 * ─────────────────────────────────────────────────────────────────────────
 * FLAT-TOP HEXAGON GEOMETRY
 *   For circumradius R (centre → vertex):
 *     Column pitch (Δx) = R × 1.5       — centres shift 1.5R rightward per col
 *     Row pitch    (Δy) = R × √3        — centres shift R√3 downward per row
 *     Odd-col offset    = R × √3 / 2    — odd columns are offset down half a row
 *   Flat-top vertex angles: 0°, 60°, 120°, 180°, 240°, 300°
 *     v[0]=right  v[1]=lower-right  v[2]=lower-left
 *     v[3]=left   v[4]=upper-left   v[5]=upper-right
 *
 * ISOMETRIC WALLS (light source from upper-left)
 *   Three visible wall faces when a tile is raised:
 *     • Lower-right wall  (v[1]→v[2]) — lightest  (right-facing)
 *     • Bottom wall       (v[2]→v[3]) — medium    (front-facing)
 *     • Lower-left wall   (v[3]→v[4]) — darkest   (left-facing)
 *   Upper walls (v[4]→v[5]→v[0]) are hidden behind the raised face.
 *
 * RENDERING ORDER (painter's algorithm per tile)
 *   1. Lower-right wall — drawn first, sits furthest back
 *   2. Bottom wall
 *   3. Lower-left wall
 *   4. Top face — always on top of walls
 *   5. Inner rim highlight — subtle ring on raised face
 *   6. Bloom glow — radial gradient, drawn after face
 * ─────────────────────────────────────────────────────────────────────────
 */

const HexCanvas = (() => {

  /* ── DOM references ──────────────────────────────────────────────────── */
  let canvas, ctx, stage;

  /* ── Geometry constants ─────────────────────────────────────────────── */
  const R      = 18;                       // circumradius (centre → vertex), px
  const SQ3    = Math.sqrt(3);
  const COL_P  = R * 1.5;                  // horizontal pitch between column centres
  const ROW_P  = R * SQ3;                  // vertical pitch between row centres
  const ODD_DY = ROW_P * 0.5;             // offset applied to odd columns
  const WALL   = 8;                        // max isometric wall height, px
  const HOVER_R= 58;                       // radius of mouse lift influence, px
  const TRAIL_N= 28;                       // number of trail positions to buffer

  /* ── Colour palette ─────────────────────────────────────────────────── */
  // Warm parchment base; two alternating face tones create honeycomb texture at rest.
  // Raised tiles go near-white; walls shift to cool blue to echo the site's --accent-s.
  const BASE_FACES = [
    [232, 229, 223],   // tone A — warm grey
    [228, 225, 218],   // tone B — slightly warmer
  ];
  const PAL = {
    bg:        [240, 239, 233],
    topUp:     [254, 254, 252],
    leftRest:  [200, 197, 191],
    leftUp:    [178, 205, 228],
    rightRest: [215, 212, 206],
    rightUp:   [195, 217, 236],
    botRest:   [207, 204, 198],
    botUp:     [186, 211, 232],
  };

  /* ── State ──────────────────────────────────────────────────────────── */
  let W, H;
  let hexes  = [];   // all hex tile objects
  let sorted = [];   // hexes sorted back→front by cy (painter's algorithm)
  let mouse  = { x: -9999, y: -9999 };
  let curX   = -99, curY = -99;   // crosshair position
  let trail  = [];   // recent mouse positions for ghost-lift effect

  /* ── Math helpers ───────────────────────────────────────────────────── */
  // Linear interpolation, clamped to [0, 1]
  function lerp(a, b, t) { return a + (b - a) * Math.max(0, Math.min(1, t)); }

  // Lerp each RGB channel independently
  function lerpRGB(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  }

  // Format RGB array as CSS colour string
  function rgb(c) { return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; }

  // Smoothstep — eases linear t into an S-curve (Ken Perlin's formula)
  function ss(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

  /**
   * fv — compute flat-top hexagon vertices for a given centre and radius.
   * Returns array of [x, y] pairs, v[0] at 0° (rightmost point).
   */
  function fv(cx, cy, r) {
    const v = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      v.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return v;
  }

  /* ── Grid builder ───────────────────────────────────────────────────── */
  function buildGrid() {
    hexes = [];
    const cols = Math.ceil(W / COL_P) + 3;  // +3 ensures coverage at edges
    const rows = Math.ceil(H / ROW_P) + 3;

    for (let col = -1; col < cols; col++) {
      for (let row = -1; row < rows; row++) {
        const cx = col * COL_P;
        const cy = row * ROW_P + (col % 2 !== 0 ? ODD_DY : 0);
        hexes.push({
          cx, cy,
          // Alternate between two base tones using a checkerboard pattern
          baseCol:    BASE_FACES[(col + row * 2) % 2 === 0 ? 0 : 1],
          lift:       0,   // current hover lift amount [0, 1]
          ripple:     0,   // current ripple amount [0, 1]
          rippleTs:   0,   // timestamp when ripple was triggered
          rippleStr:  0,   // peak ripple strength for this wave
        });
      }
    }
    // Sort tiles back-to-front by vertical centre (painter's algorithm)
    sorted = [...hexes].sort((a, b) => a.cy - b.cy);
  }

  /* ── Tile renderer ──────────────────────────────────────────────────── */
  function drawTile(h) {
    const { cx, cy, baseCol } = h;

    // Combined lift value — sum of hover and ripple, clamped to [0, 1]
    const cmb = Math.min(ss(h.lift) + ss(h.ripple), 1);
    const lpx = cmb * WALL;   // actual pixel offset upward

    /* Colour blends — lerp between rest and raised colours */
    const topC   = lerpRGB(baseCol,        PAL.topUp,    cmb);
    const leftC  = lerpRGB(PAL.leftRest,   PAL.leftUp,   cmb);
    const rightC = lerpRGB(PAL.rightRest,  PAL.rightUp,  cmb);
    const botC   = lerpRGB(PAL.botRest,    PAL.botUp,    cmb);

    // Top face vertices shifted upward by lpx (the raised surface)
    const tv = fv(cx, cy - lpx, R);
    // Base vertices at grid level — form the bottoms of the walls
    const bv = fv(cx, cy,       R);

    if (lpx > 0.4) {
      /* ── Lower-right wall: v[1]→v[2] top edge, v[1]→v[2] base ─────── */
      ctx.beginPath();
      ctx.moveTo(tv[1][0], tv[1][1]);
      ctx.lineTo(tv[2][0], tv[2][1]);
      ctx.lineTo(bv[2][0], bv[2][1]);
      ctx.lineTo(bv[1][0], bv[1][1]);
      ctx.closePath();
      ctx.fillStyle   = rgb(rightC);
      ctx.fill();
      ctx.strokeStyle = 'rgba(100,95,88,0.15)';
      ctx.lineWidth   = 0.4;
      ctx.stroke();

      /* ── Bottom wall: v[2]→v[3] top edge ────────────────────────────── */
      ctx.beginPath();
      ctx.moveTo(tv[2][0], tv[2][1]);
      ctx.lineTo(tv[3][0], tv[3][1]);
      ctx.lineTo(bv[3][0], bv[3][1]);
      ctx.lineTo(bv[2][0], bv[2][1]);
      ctx.closePath();
      ctx.fillStyle   = rgb(botC);
      ctx.fill();
      ctx.strokeStyle = 'rgba(100,95,88,0.12)';
      ctx.lineWidth   = 0.4;
      ctx.stroke();

      /* ── Lower-left wall: v[3]→v[4] top edge ────────────────────────── */
      ctx.beginPath();
      ctx.moveTo(tv[3][0], tv[3][1]);
      ctx.lineTo(tv[4][0], tv[4][1]);
      ctx.lineTo(bv[4][0], bv[4][1]);
      ctx.lineTo(bv[3][0], bv[3][1]);
      ctx.closePath();
      ctx.fillStyle   = rgb(leftC);
      ctx.fill();
      ctx.strokeStyle = 'rgba(100,95,88,0.10)';
      ctx.lineWidth   = 0.4;
      ctx.stroke();
    }

    /* ── Top face ─────────────────────────────────────────────────────── */
    ctx.beginPath();
    ctx.moveTo(tv[0][0], tv[0][1]);
    for (let i = 1; i < 6; i++) ctx.lineTo(tv[i][0], tv[i][1]);
    ctx.closePath();
    ctx.fillStyle = rgb(topC);
    ctx.fill();

    // Grid seam — colour shifts to accent blue when tile is raised
    if (cmb > 0.06) {
      ctx.strokeStyle = `rgba(70,130,180,${(0.22 + cmb * 0.65).toFixed(3)})`;
      ctx.lineWidth   = 0.5 + cmb * 0.85;
    } else {
      ctx.strokeStyle = 'rgba(130,125,116,0.42)';
      ctx.lineWidth   = 0.55;
    }
    ctx.stroke();

    /* ── Inner rim highlight ─────────────────────────────────────────── */
    if (cmb > 0.15) {
      const ia = (cmb - 0.15) * 0.7;   // fade in after cmb crosses 0.15
      const iv = fv(cx, cy - lpx, R * 0.80);
      ctx.beginPath();
      ctx.moveTo(iv[0][0], iv[0][1]);
      for (let i = 1; i < 6; i++) ctx.lineTo(iv[i][0], iv[i][1]);
      ctx.closePath();
      ctx.strokeStyle = `rgba(215,232,248,${ia.toFixed(3)})`;
      ctx.lineWidth   = 0.7;
      ctx.stroke();
    }

    /* ── Bloom glow — radial gradient centred on raised face ─────────── */
    if (cmb > 0.09) {
      const br = R * 2.0;
      const bA = cmb * 0.10;
      const gy = cy - lpx * 0.5;   // glow origin at midpoint of lift
      const gr = ctx.createRadialGradient(cx, gy, 0, cx, gy, br);
      gr.addColorStop(0,   `rgba(70,130,180,${bA.toFixed(3)})`);
      gr.addColorStop(0.6, `rgba(70,130,180,${(bA * 0.3).toFixed(3)})`);
      gr.addColorStop(1,   'rgba(70,130,180,0)');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(cx, gy, br, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ── Ripple trigger ─────────────────────────────────────────────────── */
  /**
   * Trigger a radial ripple wave from click position (mx, my).
   * Each tile gets a staggered setTimeout proportional to distance,
   * creating the expanding ring effect.
   */
  function triggerRipple(mx, my) {
    const maxD = Math.min(Math.hypot(W, H) * 0.52, 360);
    hexes.forEach(h => {
      const d = Math.hypot(h.cx - mx, h.cy - my);
      if (d > maxD) return;
      const delay    = d * 1.55;
      const strength = Math.pow(1 - d / maxD, 1.45);
      setTimeout(() => {
        if (strength > h.ripple) {
          h.ripple    = strength;
          h.rippleTs  = performance.now();
          h.rippleStr = strength;
        }
      }, delay);
    });
  }

  /* ── Main animation loop ────────────────────────────────────────────── */
  function tick() {
    const now = performance.now();

    /* Record mouse position into trail buffer (for ghost-lift effect) */
    if (mouse.x > -100) {
      trail.push({ x: mouse.x, y: mouse.y, ts: now });
      if (trail.length > TRAIL_N) trail.shift();
    }

    /* Update each hex's lift and ripple values */
    hexes.forEach(h => {
      /* Direct hover — proximity^2.1 falloff within HOVER_R */
      const d      = Math.hypot(h.cx - mouse.x, h.cy - mouse.y);
      const direct = Math.pow(Math.max(0, 1 - d / HOVER_R), 2.1);

      /* Trail ghost — past positions contribute lift weighted by age + distance */
      let ghost = 0;
      for (let i = 0; i < trail.length; i++) {
        const pt  = trail[i];
        const age = (now - pt.ts) / 440;   // normalised age, 0→1 over 440ms
        if (age >= 1) continue;
        const td = Math.hypot(h.cx - pt.x, h.cy - pt.y);
        if (td > 60) continue;
        const s = (1 - age) * Math.pow(1 - td / 60, 1.5) * (i / TRAIL_N);
        if (s > ghost) ghost = s;
      }

      const target = Math.max(direct, Math.min(ghost, 0.72));
      // Faster attack than decay so hover feels responsive but trails linger
      h.lift += (target - h.lift) * (target > h.lift ? 0.19 : 0.048);
      h.lift  = Math.max(0, Math.min(1, h.lift));

      /* Ripple — sin-envelope decay over 860ms */
      if (h.ripple > 0) {
        const age = (now - h.rippleTs) / 860;
        if (age >= 1) {
          h.ripple    = 0;
          h.rippleStr = 0;
        } else {
          // sin envelope gives a smooth rise-and-fall; pow decay shortens the tail
          h.ripple = h.rippleStr * Math.sin(age * Math.PI) * Math.pow(1 - age, 0.65);
        }
      }
    });

    /* Clear canvas with background colour */
    ctx.fillStyle = `rgb(${PAL.bg[0]},${PAL.bg[1]},${PAL.bg[2]})`;
    ctx.fillRect(0, 0, W, H);

    /* Paint tiles back→front (sorted by cy) */
    sorted.forEach(drawTile);

    /* Crosshair cursor — replaces the default CSS cursor */
    if (curX > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(70,130,180,0.65)';
      ctx.lineWidth   = 0.9;
      ctx.beginPath();
      ctx.arc(curX, curY, 3.5, 0, Math.PI * 2);
      ctx.stroke();
      // Four tick marks — up, down, left, right
      [
        [0, -7], [0, 7], [-7, 0], [7, 0],
      ].forEach(([dx, dy]) => {
        ctx.beginPath();
        ctx.moveTo(curX + dx, curY + dy);
        ctx.lineTo(
          curX + dx + (dy ? 0 : Math.sign(dx) * 3),
          curY + dy + (dx ? 0 : Math.sign(dy) * 3),
        );
        ctx.stroke();
      });
      ctx.restore();
    }

    requestAnimationFrame(tick);
  }

  /* ── Event listeners ────────────────────────────────────────────────── */
  function attachEvents() {
    /* Update mouse coords inside the stage */
    canvas.addEventListener('mousemove', e => {
      const r  = canvas.getBoundingClientRect();
      mouse.x  = e.clientX - r.left;
      mouse.y  = e.clientY - r.top;
      curX     = mouse.x;
      curY     = mouse.y;
    });

    /* Reset when cursor leaves */
    canvas.addEventListener('mouseleave', () => {
      mouse.x = mouse.y = -9999;
      curX    = curY = -99;
      trail.length = 0;
    });

    /* Click → ripple from click point */
    canvas.addEventListener('click', e => {
      const r = canvas.getBoundingClientRect();
      triggerRipple(e.clientX - r.left, e.clientY - r.top);
    });
  }

  /* ── Boot ───────────────────────────────────────────────────────────── */
  function init() {
    canvas = document.getElementById('hex-canvas');
    ctx    = canvas.getContext('2d');

    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;

    buildGrid();
    attachEvents();
    requestAnimationFrame(tick);
  }

  /* Called by app.js window resize handler */
  function resize() {
    if (!canvas) return;
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    buildGrid();
    sorted = [...hexes].sort((a, b) => a.cy - b.cy);
  }

  /* Public interface */
  return { init, resize };

})();