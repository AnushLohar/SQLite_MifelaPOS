// src/utils/uiStates.js
// Unified empty/error/loading state cards matching the reference design:
// icon → title → subtitle → optional action button, inside a soft white card.

const ICONS = {
    offline: '📶',
    notFound: '👻',
    error: '⚠️',
    empty: '📭',
    loading: '⏳',
    maintenance: '🚧',
};

const STATES = {
    offline:     { title: 'No Internet',            subtitle: 'You are offline. Changes will sync automatically when you are back online.' },
    notFound:    { title: 'Page Not Found',         subtitle: 'The page you are looking for does not exist. Go back, or head over to Home.' },
    error:       { title: 'Something Went Wrong',   subtitle: 'An error occurred while loading this page. Please try again, or contact support.' },
    empty:       { title: 'No Data Found',          subtitle: 'There are no records to display yet.' },
    loading:     { title: 'Loading',                subtitle: 'Please wait while we fetch your data.' },
    maintenance: { title: 'Site Under Maintenance', subtitle: 'You can still reach us at our social media accounts. Send us an email at sales@mail.info' },
};

function escapeHtml(str) {
    if (typeof str !== 'string') return String(str || '');
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Build the inner card markup for a state. Pure string — nest anywhere.
 */
export function pageStateCardHtml(type, options = {}) {
    const base = STATES[type] || STATES.empty;
    const icon = options.icon || ICONS[type] || ICONS.empty;
    const title = escapeHtml(options.title || base.title);
    const subtitle = escapeHtml(options.subtitle || base.subtitle);
    const spinner = type === 'loading'
        ? `<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-700 mb-2"></div>`
        : `<div class="text-6xl opacity-80">${icon}</div>`;
    return `
        <div class="w-full max-w-md mx-auto py-16">
            <div class="bg-white rounded-3xl shadow-sm border border-slate-100 p-12 text-center flex flex-col items-center gap-4">
                ${spinner}
                <h2 class="text-xl font-black text-slate-900 tracking-tight">${title}</h2>
                <p class="text-sm text-slate-500 leading-relaxed max-w-xs">${subtitle}</p>
                ${options.action ? `<button data-ui-state-action class="mt-2 px-5 py-2 rounded-xl bg-slate-700 text-white text-sm font-bold hover:bg-slate-800 transition-colors shadow-sm">${escapeHtml(options.action.label)}</button>` : ''}
            </div>
        </div>
    `;
}

/**
 * Render a state card inside an arbitrary container element.
 */
export function renderPageState(container, type, options = {}) {
    if (!container) return;
    container.innerHTML = pageStateCardHtml(type, options);
    const btn = container.querySelector('[data-ui-state-action]');
    if (btn && options.action && typeof options.action.handler === 'function') {
        btn.addEventListener('click', options.action.handler);
    }
}

/**
 * Build a full-width table row containing the state card.
 * Use inside a <tbody>: tbody.innerHTML = tableStateRow('empty', {...}).
 * @param {number} colspan - number of table columns to span
 */
export function tableStateRow(type, options = {}, colspan = 999) {
    return `<tr><td colspan="${colspan}" class="p-0">${pageStateCardHtml(type, options)}</td></tr>`;
}

export const UI_STATE_TYPES = Object.keys(STATES);
