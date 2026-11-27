// src/components/TnC.js

export function openTnCModal() {
    const modalId = 'tnc-modal';
    if (document.getElementById(modalId)) document.getElementById(modalId).remove();

    const html = `
        <div id="${modalId}" class="fixed inset-0 z-[500] bg-slate-900/60 flex items-center justify-center p-4  ">
            <div class="bg-white rounded-3xl shadow-2xl w-full max-w-3xl flex flex-col h-[85vh] overflow-hidden border border-slate-100">
                <div class="px-8 py-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
                    <h3 class="text-xl font-black text-slate-800 flex items-center gap-3">
                        <span class="bg-SLATE-100 text-SLATE-600 p-2 rounded-xl text-sm">📜</span> Terms and Conditions
                    </h3>
                    <button onclick="document.getElementById('${modalId}').remove(); document.body.classList.remove('overflow-hidden');" class="text-slate-400 hover:text-red-500 transition-colors p-2 bg-white rounded-full border border-slate-200 shadow-sm">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                
                <div class="p-8 overflow-y-auto flex-1 text-sm text-slate-600 space-y-6 custom-scrollbar bg-white">
                    <div>
                        <h4 class="font-black text-slate-900 text-base uppercase tracking-wider mb-2">1. Introduction</h4>
                        <p class="leading-relaxed">Welcome to Mifela. By accessing and using our Point of Sale (POS) and Inventory Management system, you accept and agree to be bound by the terms and provisions of this agreement.</p>
                    </div>
                    
                    <div>
                        <h4 class="font-black text-slate-900 text-base uppercase tracking-wider mb-2">2. Merchant Obligations</h4>
                        <p class="leading-relaxed">You are solely responsible for maintaining the confidentiality of your account credentials, devices, and secure magic links. You agree to ensure the accuracy of all inventory, billing, and tax data entered into the system.</p>
                    </div>

                    <div>
                        <h4 class="font-bold text-slate-900 text-base uppercase tracking-wider mb-2">3. Subscriptions & Billing</h4>
                        <p class="leading-relaxed">Access to premium hardware limits (such as AI Scanning) requires an active paid subscription. Payments are final and non-refundable except where explicitly required by local law.</p>
                    </div>

                    <!-- Add your full legal text here -->
                </div>
                
                <div class="px-8 py-5 border-t border-slate-100 bg-slate-50 flex justify-end shrink-0">
                    <button onclick="document.getElementById('${modalId}').remove(); document.body.classList.remove('overflow-hidden');" class="px-8 py-3 bg-SLATE-600 hover:bg-SLATE-700 text-white font-black tracking-wide rounded-xl shadow-lg shadow-SLATE-200 transition-all active:scale-95">Accept & Close</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    document.body.classList.add('overflow-hidden');
}