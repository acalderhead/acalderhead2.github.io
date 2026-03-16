/**
 * ============================================================================
 * canvas.js — Neural Network Visual Engine
 *
 * Renders an ambient, interactive particle network on a fixed background
 * canvas. Nodes drift slowly across the screen; clicking fires a chain
 * reaction that propagates outward through neighboring nodes.
 *
 * Intended wiring (index.html):
 *   <canvas id="neural-canvas"></canvas>
 *   <script src="assets/js/canvas.js"></script>
 *
 * Color values are hardcoded here for now. They will later be driven by
 * data/config.json once the config loader (app.js) is in place.
 * ============================================================================
 */

/**
 * ============================================================================
 * CONFIGURATION
 * All tunable parameters live here so nothing magic is buried in logic below.
 * ============================================================================
 */
const CONFIG = {
    // 1. CORE NETWORK
    NODE_COUNT:           80,  // Total nodes on screen
    MAX_EDGE_DIST:       300,  // Max pixel distance to draw an edge
    EDGE_FADE_THRESHOLD:  75,  // Pixels at which edge opacity drops steeply
    BASE_VELOCITY:      0.18,  // Max initial speed per axis

    // 2. TIMING & ENERGY
    MAX_ENERGY:    5,  // Ceiling for node energy (used in lerping)
    RISE_RATE:  0.20,  // Energy gain per frame (snappy pop-in)
    DECAY_RATE: 0.12,  // Energy loss per frame (smooth fade-out)

    // 3. CHAIN REACTIONS
    CHAIN_MAX_DEPTH:      3,  // Max layers a reaction propagates
    CHAIN_SPREAD_DELAY: 500,  // ms before an active node triggers its neighbors
    CHAIN_ENERGY_DROP:  0.8,  // Energy multiplier passed to each child node
    CHAIN_MULTI_CHANCE: 0.5,  // Probability (0–1) to activate 2 neighbors vs 1

    // 4. PASSIVE WAVES
    WAVE_BASE_INT: 15000,  // Minimum ms between autonomous background waves
    WAVE_VAR:      25000,  // Random ms added on top of base interval
    WAVE_POWER:      0.7,  // Energy multiplier for passive (non-click) waves

    // 5. MOUSE INTERACTION
    MOUSE_RADIUS:     100,  // Pixel radius within which nodes react to cursor
    MOUSE_NODE_GLOW: 0.20,  // Max additional opacity/size for hovered nodes
    MOUSE_EDGE_GLOW: 0.02,  // Max additional opacity for hovered edges

    // 6. VISUAL SCALES — resting vs active states
    VISUALS: {
        NODE_RAD_BASE:      1.30,
        NODE_RAD_ACT_MULTI: 0.70,  // Added radius per unit of MAX_ENERGY when active
        NODE_ALPHA_REST:    0.40,
        NODE_ALPHA_ACT:     0.80,
        EDGE_WT_REST:       1.00,
        EDGE_WT_ACT:        1.60,
        EDGE_ALPHA_REST:    0.20,
        EDGE_ALPHA_ACT:     0.50,
    },

    // 7. COLORS (HSL) — TODO: replace with values from data/config.json
    COLORS: {
        restH:  0,  restS: 0,  restL: 83,  // Resting: light grey
        actH: 214,  actS: 75,  actL:  48   // Active:  vivid blue
    }
};

/**
 * ============================================================================
 * GLOBAL STATE
 * ============================================================================
 */
const canvas = document.getElementById('neural-canvas');
const ctx    = canvas.getContext('2d');
let width, height;
let particles = [];
let mouse = { x: -1000, y: -1000 };  // Off-screen default so no accidental hover

/**
 * Linear interpolation helper.
 * @param {number} a  Start value
 * @param {number} b  End value
 * @param {number} t  Factor 0–1
 */
function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * Returns an hsla() colour string blended between the resting and active
 * colour stops based on the node's current energy ratio (0–1).
 * Uses smoothstep easing so the transition feels organic, not linear.
 *
 * @param {number} t      Energy ratio 0 (rest) → 1 (full activation)
 * @param {number} alpha  Final opacity to bake into the string
 */
function getDynamicHSL(t, alpha) {
    const ease = t * t * (3 - 2 * t);  // Smoothstep: accelerates then decelerates
    const c = CONFIG.COLORS;

    const h = lerp(c.restH, c.actH, ease);
    const s = lerp(c.restS, c.actS, ease);
    const l = lerp(c.restL, c.actL, ease);

    return `hsla(${h.toFixed(1)},${s.toFixed(1)}%,${l.toFixed(1)}%,${alpha})`;
}

/**
 * Initialises (or re-initialises) the canvas dimensions and particle array.
 * Called once on load and again on every window resize.
 */
function init() {
    width  = canvas.width  = window.innerWidth;
    height = canvas.height = window.innerHeight;
    particles = [];

    for (let i = 0; i < CONFIG.NODE_COUNT; i++) {
        particles.push({
            x:           Math.random() * width,
            y:           Math.random() * height,
            vx:          (Math.random() - 0.5) * (CONFIG.BASE_VELOCITY * 2),
            vy:          (Math.random() - 0.5) * (CONFIG.BASE_VELOCITY * 2),
            energy:      0,
            active:      false,
            isRising:    false,
            targetPower: 0
        });
    }
}

/**
 * Activates a single node and, after CHAIN_SPREAD_DELAY, attempts to
 * propagate the reaction to 1–2 neighbors.
 *
 * Neighbor selection is distance-weighted: closer nodes are more probable,
 * but a minimum floor weight (0.15) ensures distant nodes are never excluded.
 *
 * When two children are selected, the second fires with an extra 150–350 ms
 * stagger so activations don't appear simultaneous.
 *
 * @param {object} node   Particle to activate
 * @param {number} layer  Current chain depth (1 = source)
 * @param {number} power  Energy level to assign this node
 */
function activateNode(node, layer, power) {
    // Gate: already-active nodes and depth overruns are silently ignored.
    if (node.active || layer > CONFIG.CHAIN_MAX_DEPTH) return;

    node.active      = true;
    node.isRising    = true;
    node.energy      = 0;
    node.targetPower = power;

    if (layer < CONFIG.CHAIN_MAX_DEPTH) {
        setTimeout(() => {
            const neighbors = particles.filter(p =>
                !p.active &&
                Math.hypot(p.x - node.x, p.y - node.y) < CONFIG.MAX_EDGE_DIST
            );

            if (neighbors.length > 0) {
                const numToAct = Math.random() < CONFIG.CHAIN_MULTI_CHANCE ? 2 : 1;

                for (let i = 0; i < numToAct; i++) {
                    if (neighbors.length === 0) break;

                    // Distance-weighted selection: closer nodes are more likely,
                    // but a softening floor (0.15) keeps far nodes in the pool.
                    const weights = neighbors.map(n => {
                        const d = Math.hypot(n.x - node.x, n.y - node.y);
                        return Math.max(0.15, 1 - d / CONFIG.MAX_EDGE_DIST);
                    });
                    const totalWeight = weights.reduce((s, w) => s + w, 0);
                    let rand = Math.random() * totalWeight;
                    let idx  = 0;
                    for (let k = 0; k < weights.length; k++) {
                        rand -= weights[k];
                        if (rand <= 0) { idx = k; break; }
                    }

                    const target = neighbors.splice(idx, 1)[0];

                    // Stagger each subsequent hop: 150–350 ms extra delay per child.
                    const hopDelay = i * (150 + Math.random() * 200);
                    setTimeout(() => activateNode(
                        target,
                        layer + 1,
                        power * CONFIG.CHAIN_ENERGY_DROP
                    ), hopDelay);
                }
            }
        }, CONFIG.CHAIN_SPREAD_DELAY);
    }
}

/**
 * Schedules periodic autonomous activation waves to keep the canvas alive
 * even when the user is not interacting.
 */
function randomWave() {
    const inactive = particles.filter(p => !p.active);
    if (inactive.length > 0) {
        const root = inactive[Math.floor(Math.random() * inactive.length)];
        activateNode(root, 1, CONFIG.MAX_ENERGY * CONFIG.WAVE_POWER);
    }

    const nextInt = CONFIG.WAVE_BASE_INT + (Math.random() * CONFIG.WAVE_VAR);
    setTimeout(randomWave, nextInt);
}

/**
 * Main animation loop.
 * Each frame: clear → update physics + energy → draw edges → draw nodes.
 */
function animate() {
    ctx.clearRect(0, 0, width, height);

    particles.forEach((p, i) => {
        // ── 1. Physics: drift and boundary bounce ──
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > width)  p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;

        // ── 2. Energy state machine ──
        if (p.active) {
            if (p.isRising) {
                p.energy += CONFIG.RISE_RATE;
                if (p.energy >= p.targetPower) {
                    p.energy   = p.targetPower;
                    p.isRising = false;
                }
            } else {
                p.energy -= CONFIG.DECAY_RATE;
                if (p.energy <= 0) {
                    p.energy = 0;
                    p.active = false;  // Release state lock — node can fire again
                }
            }
        }

        const eRatio = p.energy / CONFIG.MAX_ENERGY;

        // ── 3. Mouse proximity boost ──
        const mDist = Math.hypot(p.x - mouse.x, p.y - mouse.y);
        const pRatio = mDist < CONFIG.MOUSE_RADIUS
            ? (1 - mDist / CONFIG.MOUSE_RADIUS)
            : 0;

        const mNodeBoost = pRatio * CONFIG.MOUSE_NODE_GLOW;
        const mEdgeBoost = pRatio * CONFIG.MOUSE_EDGE_GLOW;

        // ── 4. Edges ──
        for (let j = i + 1; j < particles.length; j++) {
            const q    = particles[j];
            const dist = Math.hypot(p.x - q.x, p.y - q.y);

            if (dist < CONFIG.MAX_EDGE_DIST) {
                let distFade = 1 - (dist / CONFIG.MAX_EDGE_DIST);

                // Steeper opacity dropoff beyond the fade threshold
                if (dist > CONFIG.EDGE_FADE_THRESHOLD) {
                    distFade = Math.pow(distFade, 3);
                }

                const qRatio     = q.active ? (q.energy / CONFIG.MAX_ENERGY) : 0;
                const edgeERatio = Math.max(eRatio, qRatio);
                const edgeAlpha  = lerp(
                    CONFIG.VISUALS.EDGE_ALPHA_REST + mEdgeBoost,
                    CONFIG.VISUALS.EDGE_ALPHA_ACT,
                    edgeERatio
                ) * distFade;
                const edgeWeight = lerp(
                    CONFIG.VISUALS.EDGE_WT_REST,
                    CONFIG.VISUALS.EDGE_WT_ACT,
                    edgeERatio
                );

                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(q.x, q.y);
                ctx.strokeStyle = getDynamicHSL(edgeERatio, edgeAlpha.toFixed(3));
                ctx.lineWidth   = edgeWeight;
                ctx.stroke();
            }
        }

        // ── 5. Node ──
        const nodeAlpha  = lerp(
            CONFIG.VISUALS.NODE_ALPHA_REST + mNodeBoost,
            CONFIG.VISUALS.NODE_ALPHA_ACT,
            eRatio
        );
        const nodeRadius = lerp(
            CONFIG.VISUALS.NODE_RAD_BASE * (1 + mNodeBoost),
            CONFIG.VISUALS.NODE_RAD_BASE * (1 + mNodeBoost) + CONFIG.MAX_ENERGY * CONFIG.VISUALS.NODE_RAD_ACT_MULTI,
            eRatio
        );

        ctx.beginPath();
        ctx.arc(p.x, p.y, nodeRadius, 0, Math.PI * 2);
        ctx.fillStyle = getDynamicHSL(eRatio, nodeAlpha.toFixed(3));
        ctx.fill();
    });

    requestAnimationFrame(animate);
}

/**
 * ============================================================================
 * EVENT LISTENERS
 * ============================================================================
 */

// Track cursor position for proximity glow effect
window.addEventListener('mousemove', e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
});

// Click anywhere → activate the node nearest to the click point
document.addEventListener('click', e => {
    let best         = null;
    let shortestDist = Infinity;

    particles.forEach(p => {
        if (p.active) return;
        const dist = Math.hypot(p.x - e.clientX, p.y - e.clientY);
        if (dist < shortestDist) {
            shortestDist = dist;
            best         = p;
        }
    });

    if (best) activateNode(best, 1, CONFIG.MAX_ENERGY);
});

// Re-initialise on resize so nodes fill the new viewport
window.addEventListener('resize', init);

/**
 * ============================================================================
 * BOOTSTRAP
 * ============================================================================
 */
init();
animate();
randomWave();