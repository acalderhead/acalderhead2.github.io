/**
 * PORTFOLIO ORCHESTRATOR (app.js)
 * Purpose: Acts as the "Brain" of the site. Fetches design and content data, 
 * hydrates the DOM, and manages global UI states.
 * * Maintenance: To update content, edit /data/portfolio.json. 
 * To update design, edit /data/config.json.
 */

// Global State
let CONFIG = {};
let PORTFOLIO = {};
let galleryMode = 'major'; // Default project view
let selectedIdx = 0; // Currently active project index

/**
 * CORE BOOTSTRAP
 * Initiates the application lifecycle.
 */
async function bootstrap() {
    try {
        // Parallel fetch for performance optimization
        const [confRes, portRes] = await Promise.all([
            fetch('./data/config.json'),
            fetch('./data/portfolio.json')
        ]);
        
        if (!confRes.ok || !portRes.ok) throw new Error("Resource uplink failed.");

        CONFIG = await confRes.json();
        PORTFOLIO = await portRes.json();

        // Execution Pipeline
        initializeDesignSystem();
        renderUIStrings();
        renderIdentity();
        renderChronicle();
        renderGallery();
        
        // Remove loading state once data is active
        document.body.classList.remove('loading');
        console.log("SYSTEM_ONLINE: Data hydration complete.");
    } catch (err) {
        console.error("BOOT_CRITICAL: Check JSON syntax or server paths.", err);
    }
}

/**
 * 1. DESIGN SYSTEM INJECTION
 * Maps values from config.json to CSS Custom Properties (Variables).
 */
function initializeDesignSystem() {
    const root = document.documentElement;
    const theme = CONFIG.design.themes.dark; // Defaulting to Dark
    const fonts = CONFIG.design.fonts;

    // Apply Typography
    root.style.setProperty('--font-head', fonts.header);
    root.style.setProperty('--font-body', fonts.body);
    root.style.setProperty('--font-mono', fonts.mono);

    // Apply Color Palette
    Object.entries(theme).forEach(([key, val]) => {
        root.style.setProperty(`--${key.replace('_', '-')}`, val);
    });
}

/**
 * 2. STATIC STRING INJECTION
 * Fills headers, badges, and labels defined in config.json.
 */
function renderUIStrings() {
    const ui = CONFIG.ui_labels;
    const meta = CONFIG.meta;

    document.title = meta.site_title;
    document.getElementById('nav-brand').textContent = ui.nav_brand;
    document.getElementById('label-identity').textContent = ui.section_identity;
    document.getElementById('label-gallery').textContent = ui.section_gallery;
    
    const coordEl = document.getElementById('coords');
    if (coordEl) coordEl.textContent = meta.coordinates;
}

/**
 * 3. IDENTITY & SKILLS RENDERING
 * Populates the primary bio and technical skill-stack.
 */
function renderIdentity() {
    const id = PORTFOLIO.identity;
    const skills = PORTFOLIO.skills;

    // Bio Injection
    const bioTarget = document.getElementById('bio-target');
    if (bioTarget) {
        bioTarget.innerHTML = `
            <h3 class="role-title">${id.role}</h3>
            <p class="bio-text">${id.bio_summary}</p>
            <div class="skills-cloud" id="skills-cloud"></div>
        `;
    }

    // Skills Injection with micro-interaction logic
    const cloud = document.getElementById('skills-cloud');
    if (cloud) {
        cloud.innerHTML = skills.map(skill => 
            `<span class="tag interactive" onclick="maybeActivate(2, false)">${skill}</span>`
        ).join('');
    }
}

/**
 * 4. CHRONICLE (TIMELINE) RENDERING
 * Maps professional history into the scrollable timeline component.
 */
function renderChronicle() {
    const chronicle = PORTFOLIO.chronicle;
    const target = document.getElementById('timeline-target');
    if (!target) return;

    target.innerHTML = chronicle.map(item => `
        <div class="record ${item.current ? 'active' : ''}">
            <div class="record-header">
                <span class="role">${item.role}</span>
                <span class="date">${item.date}</span>
            </div>
            <div class="record-body">
                <p>${item.desc}</p>
            </div>
        </div>
    `).join('');
}

/**
 * 5. GALLERY VIEW CONTROLLER
 * Handles the logic for displaying projects and switching categories.
 */
function renderGallery() {
    const indexTarget = document.getElementById('gallery-menu');
    const viewerTarget = document.getElementById('gallery-viewer');
    if (!indexTarget || !viewerTarget) return;

    const items = PORTFOLIO.projects[galleryMode];

    // Render Sidebar Index
    indexTarget.innerHTML = items.map((item, idx) => `
        <div class="gallery-idx-item ${idx === selectedIdx ? 'active' : ''}" 
             onclick="selectProject(${idx})">
            ${item.id} // ${item.title}
        </div>
    `).join('');

    // Render Active Project Details
    const active = items[selectedIdx];
    viewerTarget.innerHTML = `
        <div class="file-header">
            <span class="file-id">${active.id}</span>
            <h3>${active.title}</h3>
        </div>
        <div class="file-tags">
            ${active.tags.map(t => `<span class="tag">${t}</span>`).join('')}
        </div>
        <p class="file-desc">${active.desc}</p>
        ${active.link ? `<a href="${active.link}" target="_blank" class="file-uplink">SOURCE_UPLINK ↗</a>` : ''}
    `;
}

/**
 * Interaction Helper: Updates the selected project index and re-renders.
 */
window.selectProject = function(idx) {
    selectedIdx = idx;
    renderGallery();
    // Visual feedback for the background engine
    if (typeof window.maybeActivate === 'function') window.maybeActivate(4, true);
};

// Start the application once the DOM is ready
document.addEventListener('DOMContentLoaded', bootstrap);
