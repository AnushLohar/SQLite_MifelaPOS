// src/components/publicToS.js

export function openPublicToSModal() {
    const modalId = 'public-tos-modal';
    if (document.getElementById(modalId)) document.getElementById(modalId).remove();

    const html = `
        <div id="${modalId}" class="fixed inset-0 z-[500] bg-slate-900/60 flex items-center justify-center p-4  ">
            <div class="bg-white rounded-3xl shadow-2xl w-full max-w-3xl flex flex-col h-[85vh] overflow-hidden border border-slate-100">
                <div class="px-8 py-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
                    <h3 class="text-xl font-black text-slate-800 flex items-center gap-3">
                        <span class="bg-emerald-100 text-emerald-600 p-2 rounded-xl text-sm">⚖️</span> Public Terms of Service
                    </h3>
                    <button onclick="document.getElementById('${modalId}').remove(); document.body.classList.remove('overflow-hidden');" class="text-slate-400 hover:text-red-500 transition-colors p-2 bg-white rounded-full border border-slate-200 shadow-sm">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                
                <div class="p-8 overflow-y-auto flex-1 text-sm text-slate-600 space-y-6 custom-scrollbar bg-white">
                    <div>
                        <h4 class="font-black text-slate-900 text-base uppercase tracking-wider mb-2">1. Acceptable Use</h4>
                        <p class="leading-relaxed">You agree not to misuse the Mifela platform or assist anyone else in doing so. You must not attempt to bypass, circumvent, or exploit our security measures, rate limiters, or APIs.</p>
                    </div>
                    
                    <div>
                        <h4 class="font-black text-slate-900 text-base uppercase tracking-wider mb-2">2. Data Privacy & Ownership</h4>
                        <p class="leading-relaxed">Your data remains yours. We respect your privacy. All customer data, transaction ledgers, and directory records are stored securely and handled strictly in accordance with our Privacy Policy.</p>
                    </div>

                    <div>
                        <h4 class="font-black text-slate-900 text-base uppercase tracking-wider mb-2">3. Third-Party Integrations</h4>
                        <p class="leading-relaxed">Use of third-party communication channels and integrations are subject strictly to the respective provider's terms of service and acceptable use policies.</p>
                    </div>

                    <!-- Add your full legal text here -->
                </div>
                
                <div class="px-8 py-5 border-t border-slate-100 bg-slate-50 flex justify-end shrink-0">
                    <button onclick="document.getElementById('${modalId}').remove(); document.body.classList.remove('overflow-hidden');" class="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black tracking-wide rounded-xl shadow-lg shadow-emerald-200 transition-all active:scale-95">Accept & Close</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    document.body.classList.add('overflow-hidden');
}