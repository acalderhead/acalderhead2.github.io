/**
 * UI INTERACTION ENGINE (ui.js)
 * Purpose: Manages interface states, scroll triggers, and input feedback.
 * Maintenance: This file handles "How" things move; /data/config.json handles "What" they look like.
 */

/* ── Global Interaction State ── */
window.uiState = {
    isLightMode: false,
    isMenuOpen: false,
    lastScrollTop: 0
};

/**
 * THEME TOGGLE CONTROLLER
 * Logic: Swaps CSS variables in :root based on the 'design.themes' object in config.json.
 */
window.toggleTheme = function() {
    const root = document.documentElement;
    window.uiState.isLightMode = !window.uiState.isLightMode;
    
    // Select the target palette from our pre-loaded CONFIG
    const themeData = window.uiState.isLightMode 
        ? CONFIG.design.themes.light 
        : CONFIG.design.themes.dark;

    // Batch update CSS variables
    Object.entries(themeData).forEach(([key, value]) => {
        root.style.setProperty(`--${key.replace('_', '-')}`, value);
    });

    // Notify the background engine to ripple the network
    if (typeof window.maybeActivate === 'function') {
        window.maybeActivate(8, true); // High intensity pulse on theme swap
    }

    // Persist preference (Optional logic for local storage could go here)
    console.log(`UI_STATE: Theme switched to ${window.uiState.isLightMode ? 'LIGHT' : 'DARK'}`);
};

/**
 * INTERSECTION OBSERVER (SCROLL ANIMATIONS)
 * Logic: Uses a high-performance observer to trigger "fade-in" classes 
 * only when elements enter the viewport.
 */
const scrollOptions = {
    threshold: 0.15,
    rootMargin: "0px 0px -50px 0px"
};

const uiObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            
            // Subtle neural pulse when a new section "connects" with the user
            if (typeof window.maybeActivate === 'function') {
                window.maybeActivate(2, false);
            }
            
            // Stop observing once visible to save resources
            uiObserver.unobserve(entry.target);
        }
    });
}, scrollOptions);

/**
 * INITIALIZE DYNAMIC UI BEHAVIORS
 * Called by app.js or DOMContentLoaded.
 */
function initUIBehaviors() {
    // 1. Attach scroll observers to all fade-in candidates
    document.querySelectorAll('.fade-in, .glass-block, section').forEach(el => {
        uiObserver.observe(el);
    });

    // 2. Global Key Listeners (The "Data Detective" Shortcuts)
    document.addEventListener('keydown', (e) => {
        // Accessibility: 'T' key toggles theme
        if (e.key.toLowerCase() === 't' && !e.ctrlKey) {
            const checkbox = document.getElementById('theme-trigger');
            if (checkbox) {
                checkbox.checked = !checkbox.checked;
                window.toggleTheme();
            }
        }
    });
}

/**
 * WILDCARD FEATURE: FOCUS MODE
 * Logic: Diminishes background noise to prioritize data readability.
 * This can be triggered by specific projects or user intent.
 */
window.toggleFocusMode = function(enable) {
    const canvas = document.getElementById('neural-canvas');
    if (canvas) {
        canvas.style.transition = "opacity 1s ease";
        canvas.style.opacity = enable ? "0.1" : "0.6";
    }
    console.log(`UI_STATE: Focus Mode ${enable ? 'ENABLED' : 'DISABLED'}`);
};

// Initialize when the DOM is ready
document.addEventListener('DOMContentLoaded', initUIBehaviors);
