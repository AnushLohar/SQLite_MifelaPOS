// src/components/settings.js



import { 
    appId, getCurrentUserPlan, availableLocations, storeId as primaryStoreId,
    setConvenienceFee, setCurrency, userRole, getStoreId
} from '../store/state.js';

import { DOM, showModal, showToast } from '../utils/dom.js';
import { generateMerchantId } from '../utils/ids.js'; 
import { escapeHTML } from '../utils/security.js';
import { autoDetectPrinters } from '../utils/print.js';
import { enforcePageSecurity } from '../utils/security.js';

// ==========================================
// STATE VARIABLES & HELPERS
// ==========================================
export let isSettingsInitialized = false;
let currentStoreId = null; 
let activeTab = 'profile'; 
let currentSecurityState = {};
let originalPhoneNumber = '';
let recaptchaVerifier = null;
let confirmationResult = null;
let isSettingsEventsBound = false;
let isProfileDirty = false;
let isStoreDirty = false;
let isWaDirty = false;

// Bulletproof App ID getter to prevent "undefined" path permission errors
function getAppId() {
    return (typeof window !== 'undefined' && window.__app_id) ? window.__app_id : appId;
}

// Helper: Normalize Plan to support legacy caching
function normalizePlan(planString) {
    if (!planString) return 'free';
    const plan = planString.toLowerCase();
    if (plan === 'standard') return 'silver';
    if (plan === 'premium') return 'platinum'; 
    return plan;
}

// ==========================================
// 1. HTML TEMPLATES
// ==========================================

function getProfileSettingsHTML() {
    return `
        <div class="space-y-6">
            <div class="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 flex flex-col sm:flex-row items-center sm:items-start gap-6 relative overflow-hidden">
                <div class="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-full blur-3xl -z-10 translate-x-1/3 -translate-y-1/3"></div>
                
                <div class="relative group">
                    <div class="w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 p-1 shadow-md">
                        <div class="w-full h-full rounded-full border-4 border-white flex items-center justify-center text-white text-3xl font-black shadow-inner bg-indigo-500" id="profile-avatar-initial">
                            U
                        </div>
                    </div>
                    <div class="absolute bottom-0 right-0 bg-emerald-500 w-6 h-6 rounded-full border-4 border-white shadow-sm" title="Online"></div>
                </div>
                
                <div class="flex-1 text-center sm:text-left mt-2 sm:mt-0">
                    <h2 class="text-2xl font-extrabold text-slate-900 tracking-tight" id="profile-display-name-header">User Name</h2>
                    <p class="text-sm font-medium text-slate-500 mt-1 flex items-center justify-center sm:justify-start gap-2">
                        <span id="profile-role-badge" class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-100 text-indigo-700 border border-indigo-200">Admin</span>
                    </p>
                </div>
            </div>

            <div class="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
                <div class="px-8 py-5 border-b border-slate-100 bg-slate-50/50">
                    <h3 class="text-lg font-bold text-slate-800">Personal Information</h3>
                    <p class="text-xs text-slate-500 mt-0.5">Manage your local profile details. Changes save automatically.</p>
                </div>
                
                <div class="p-8 space-y-6">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div class="space-y-1.5 md:col-span-2">
                            <label class="block text-xs font-bold text-slate-700 uppercase tracking-wide">Full Name <span class="text-red-500">*</span></label>
                            <input type="text" id="profile-name-input" class="auto-save-profile w-full border border-slate-300 p-3 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm font-medium bg-slate-50 hover:bg-white transition-all shadow-inner" placeholder="Your Name" required>
                        </div>
                        
                        <div class="space-y-1.5">
                            <label class="block text-xs font-bold text-slate-700 uppercase tracking-wide">Designation / Role</label>
                            <input type="text" id="profile-designation-input" class="auto-save-profile w-full border border-slate-300 p-3 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm font-medium bg-slate-50 hover:bg-white transition-all shadow-inner" placeholder="e.g. Store Owner">
                        </div>
                        
                        <div class="space-y-1.5">
                            <label class="block text-xs font-bold text-slate-700 uppercase tracking-wide">Preferred Language</label>
                            <div class="relative">
                                <select id="profile-lang-input" class="auto-save-profile w-full border border-slate-300 p-3 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm font-medium bg-slate-50 hover:bg-white transition-all shadow-inner appearance-none cursor-pointer pr-10">
                                    <option value="en">English</option>
                                    <option value="hi">Hindi</option>
                                    <option value="mr">Marathi</option>
                                    <option value="gu">Gujarati</option>
                                </select>
                                <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-400">
                                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                                </div>
                            </div>
                        </div>

                        <div class="space-y-1.5">
                            <label class="block text-xs font-bold text-slate-700 uppercase tracking-wide">Email Address</label>
                            <input type="email" id="profile-email-input" class="auto-save-profile w-full border border-slate-300 p-3 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-medium bg-slate-50 hover:bg-white transition-all shadow-inner" placeholder="Email">
                        </div>

                        <div class="space-y-1.5">
                            <label class="block text-xs font-bold text-slate-700 uppercase tracking-wide">Phone Number</label>
                            <input type="tel" id="profile-phone-input" class="auto-save-profile w-full border border-slate-300 p-3 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-medium bg-slate-50 hover:bg-white transition-all shadow-inner" placeholder="Phone">
                        </div>
                    </div>
                </div>
            </div>

            <div class="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden mt-6">
                <div class="px-8 py-5 border-b border-slate-100 bg-slate-50/50">
                    <h3 class="text-lg font-bold text-slate-800">App Security & Password</h3>
                    <p class="text-xs text-slate-500 mt-0.5">Manage your local application access password.</p>
                </div>
                
                <div class="p-8 space-y-8">
                    <form id="change-password-form" class="space-y-4">
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                            <div class="space-y-1.5">
                                <label class="text-xs font-bold text-slate-700 uppercase tracking-wide">Current Password</label>
                                <input type="password" id="current-password" class="w-full border border-slate-300 p-3 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm bg-slate-50" placeholder="Current Password">
                            </div>
                            <div class="space-y-1.5">
                                <label class="text-xs font-bold text-slate-700 uppercase tracking-wide">New Password</label>
                                <input type="password" id="new-password" class="w-full border border-slate-300 p-3 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm bg-slate-50" placeholder="New Password" minlength="4">
                            </div>
                            <div class="space-y-1.5">
                                <label class="text-xs font-bold text-slate-700 uppercase tracking-wide">Confirm Password</label>
                                <input type="password" id="confirm-password" class="w-full border border-slate-300 p-3 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm bg-slate-50" placeholder="Confirm Password" minlength="4">
                            </div>
                        </div>
                        <button type="submit" id="btn-change-password" class="px-5 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-sm font-bold transition-all active:scale-95 shadow-md">Update App Password</button>
                    </form>
                </div>
            </div>
        </div>
    `;
}

function getSystemSettingsHTML() {
    const inputClass = "auto-save-store block w-full px-4 py-3 border border-slate-300 rounded-xl text-sm font-bold text-slate-900 focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-600 transition-all bg-white hover:border-slate-400 placeholder-slate-300 shadow-sm";     
    
    // Read memory BEFORE drawing the HTML
    let printConfig = { 
        silent: true, 
        barcodePrinter: '', 
        receiptPrinter: '', 
        invoicePrinter: '',
        pageSize: '58mm' // For receipts
    };
    try { 
        const saved = localStorage.getItem('mifela_printer_settings');
        if (saved) printConfig = { ...printConfig, ...JSON.parse(saved) }; 
    } catch(e) {}

    return `
        <div id="settings-recaptcha-container" class="hidden"></div>

        <form id="store-settings-form" class="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start w-full  ">
            
            <div class="xl:col-span-7 space-y-8 flex flex-col">
                
                <div class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow duration-300">
                    <div class="px-8 py-6 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative overflow-hidden">
                        <div id="store-save-indicator" class="absolute top-0 right-0 px-4 py-1 text-[10px] font-bold tracking-widest text-emerald-600 bg-emerald-100 rounded-bl-xl opacity-0 transition-opacity duration-300 flex items-center gap-1.5 z-50">
                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            All changes saved
                        </div>

                        <div>
                            <h3 class="font-bold text-gray-900 text-lg flex items-center gap-3">
                                <span class="p-2 bg-indigo-100 text-indigo-600 rounded-lg shadow-sm">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
                                </span>
                                Store Profile
                            </h3>
                            <p class="text-sm text-gray-500 mt-1 sm:ml-12">Changes are saved automatically.</p>
                        </div>
                        </div>
                    
                    <div class="p-8">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                            <div class="md:col-span-2 group">
                                <label class="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 group-focus-within:text-indigo-600 transition-colors">Store Name <span class="text-red-500">*</span></label>
                                <input type="text" id="setting-store-name" class="${inputClass}" placeholder="e.g. My Awesome Store" required>
                            </div>
                            
                            <div class="group">
                                <label class="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 group-focus-within:text-indigo-600 transition-colors">Contact Phone <span class="text-red-500">*</span></label>
                                <div class="relative">
    <input type="tel" id="setting-store-phone" class="${inputClass}" placeholder="919999999999" required>
</div>
                            </div>
                            
                            <div class="group">
                                <label class="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 group-focus-within:text-indigo-600 transition-colors">Support Email</label>
                                <input type="email" id="setting-store-email" class="${inputClass}" placeholder="support@store.com">
                            </div>

                            <div class="md:col-span-2 group">
                                <label class="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 group-focus-within:text-indigo-600 transition-colors">Physical Address <span class="text-red-500">*</span></label>
                                <textarea id="setting-store-address" rows="2" class="${inputClass} resize-none" placeholder="Enter full store address" required></textarea>
                            </div>

                            <div class="group">
                                <label class="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 group-focus-within:text-indigo-600 transition-colors">State <span class="text-red-500">*</span></label>
                                <input type="text" id="setting-store-state" class="${inputClass}" placeholder="e.g. Maharashtra" required>
                            </div>

                            <div class="group">
                                <label class="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 group-focus-within:text-indigo-600 transition-colors">Dealer Type</label>
                                <div class="relative">
                                    <select id="setting-store-type" class="${inputClass} appearance-none cursor-pointer pr-10">
                                        <option value="regular">Regular</option>
                                        <option value="composition">Composition</option>
                                        <option value="unregistered">Unregistered</option>
                                    </select>
                                    <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-500">
                                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="md:col-span-2 group">
                                <label class="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 group-focus-within:text-indigo-600 transition-colors">Tax ID / GSTIN <span class="text-red-500">*</span></label>
                                <input type="text" id="setting-store-tax-id" class="${inputClass} uppercase tracking-widest font-mono border-l-4 border-l-indigo-500" placeholder="GSTIN or Tax ID" required>
                            </div>

                            <div class="group">
                                <label class="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 group-focus-within:text-indigo-600 transition-colors">PAN NO</label>
                                <input type="text" id="setting-store-pan" class="${inputClass} uppercase tracking-widest font-mono" placeholder="ABCDE1234F">
                            </div>
                        

                            <div class="md:col-span-2 pt-6 mt-2 border-t border-gray-100">
                                <h4 class="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2 mb-6">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z"></path></svg>
                                    Banking Details
                                </h4>
                                
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-6 bg-gray-50/50 p-6 rounded-2xl border border-gray-200 shadow-inner">
                                    <div class="group">
                                        <label class="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2">Bank Name</label>
                                        <input type="text" id="setting-bank-name" class="${inputClass}" placeholder="e.g. HDFC Bank">
                                    </div>
                                    <div class="group">
                                        <label class="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2">Branch</label>
                                        <input type="text" id="setting-bank-branch" class="${inputClass}" placeholder="e.g. Main Branch">
                                    </div>
                                    <div class="group">
                                        <label class="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2">Account Number</label>
                                        <input type="text" id="setting-bank-acc" class="${inputClass} font-mono tracking-widest" placeholder="XXXXXXXXXX">
                                    </div>
                                    <div class="group">
                                        <label class="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2">IFSC Code</label>
                                        <input type="text" id="setting-bank-ifsc" class="${inputClass} font-mono uppercase tracking-widest" placeholder="HDFC0001234">
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div id="merchant-id-container" class="px-8 pb-8"></div>
                </div>

                <div class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow duration-300">
                     <div class="px-8 py-6 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative">
                        <div id="wa-save-indicator" class="absolute top-0 right-0 px-3 py-1 text-[10px] font-bold tracking-widest text-emerald-600 bg-emerald-100 rounded-bl-xl opacity-0 transition-opacity duration-300 flex items-center gap-1.5 z-50">
                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            Saved
                        </div>
                        <div>
                            <h3 class="font-bold text-gray-900 text-lg flex items-center gap-3">
                                <span class="p-2 bg-pink-100 text-pink-600 rounded-lg shadow-sm">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"></path></svg>
                                </span>
                                Branding & Invoice
                            </h3>
                            <p class="text-sm text-gray-500 mt-1 sm:ml-12">Customize how this store appears on receipts.</p>
                        </div>
                        </div>

                    <div class="p-8 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                        <div class="md:col-span-2 group">
                            <label class="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 group-focus-within:text-pink-600 transition-colors flex justify-between items-center">
                                <span>Store Logo</span>
                                <span class="text-[10px] bg-pink-50 text-pink-600 px-2 py-0.5 rounded font-bold border border-pink-100">Recommended: Square Format</span>
                            </label>
                            
                            <div id="logo-drop-zone" class="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:bg-slate-50 hover:border-pink-400 transition-colors relative group/drop overflow-hidden flex flex-col items-center justify-center gap-3 bg-white h-40">
                                
                                <input type="file" id="logo-file-input" accept="image/png, image/jpeg, image/webp" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" title="Click or Drag to Upload">
                                
                                <img id="logo-preview-img" src="" class="hidden h-24 object-contain rounded-lg shadow-sm border border-slate-200 z-0 relative">
                                
                                <button type="button" id="remove-logo-btn" class="hidden absolute top-3 right-3 bg-red-500 text-white rounded-full p-1.5 shadow-md hover:bg-red-600 z-[20] transition-transform active:scale-95 cursor-pointer" title="Remove Logo">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                                </button>
                                
                                <div id="logo-upload-placeholder" class="flex flex-col items-center relative z-0">
                                    <div class="w-12 h-12 bg-pink-50 text-pink-500 rounded-full flex items-center justify-center mb-2 group-hover/drop:scale-110 transition-transform shadow-sm border border-pink-100">
                                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                    </div>
                                    <p class="text-sm font-bold text-slate-700">Click to upload or drag and drop</p>
                                    <p class="text-[10px] font-medium text-slate-400 mt-1">PNG, JPG, WEBP (Max 2MB). Auto-resized for receipts.</p>
                                </div>
                            </div>
                            <div class="flex items-center gap-4 my-4">
                                <div class="h-px bg-slate-200 flex-1"></div>
                                <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">OR USE EXTERNAL URL</span>
                                <div class="h-px bg-slate-200 flex-1"></div>
                            </div>

                            <input type="url" id="setting-store-logo" class="${inputClass}" placeholder="https://your-image-url.com/logo.png">
                        </div>
                        
                        <div class="group">
                            <label class="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 group-focus-within:text-pink-600 transition-colors">Invoice Prefix</label>
                            <input type="text" id="setting-invoice-prefix" class="${inputClass}" placeholder="e.g. INV-">
                        </div>
                        <div class="group">
                            <label class="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 group-focus-within:text-pink-600 transition-colors">Theme Color</label>
                            <div class="flex items-center gap-3">
                                <input type="color" id="setting-theme-color" class="auto-save-store h-11 w-14 rounded cursor-pointer border border-slate-300 p-0.5 bg-white shadow-sm" value="#4f46e5">
                                <span class="text-[10px] text-gray-500 font-medium">Accent color for your digital receipts.</span>
                            </div>
                        </div>

                    
                        <div class="group">
                            <label class="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 group-focus-within:text-pink-600 transition-colors">Tagline</label>
                            <input type="text" id="setting-store-tagline" class="${inputClass}" placeholder="e.g. Quality First">
                        </div>
                        
                       <div class="group">
                            <label class="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 group-focus-within:text-pink-600 transition-colors">Website</label>
                            <input type="url" id="setting-store-website" class="${inputClass}" placeholder="https://">
                        </div>
                        <div class="group">
                            <label class="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 group-focus-within:text-pink-600 transition-colors">Store UPI ID</label>
                            <input type="text" id="setting-store-upi" class="${inputClass}" placeholder="e.g. store@upi">
                        </div>
                        <div class="md:col-span-2 group">
                            <label class="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 group-focus-within:text-pink-600 transition-colors">Terms & Conditions</label>
                            <textarea id="setting-store-tnc" rows="2" class="${inputClass} resize-none" placeholder="e.g. Goods once sold will not be taken back."></textarea>
                        </div>
                        <div class="md:col-span-2 group">
                            <label class="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 group-focus-within:text-pink-600 transition-colors">Footer Message</label>
                            <input type="text" id="setting-store-footer" class="${inputClass}" placeholder="e.g. Thank you for shopping with us!">
                        </div>
                    </div>
                </div>

                

            </div> <div class="xl:col-span-5 space-y-8 flex flex-col">
                
                <div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow duration-300">
                    <div class="flex justify-between items-center mb-6 relative">
                        <h3 class="font-bold text-gray-900 flex items-center gap-3">
                            <span class="p-2 bg-emerald-100 text-emerald-600 rounded-lg shadow-sm">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08-.402-2.599-1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            </span>
                            Financial Defaults
                        </h3>
                    </div>
                    
                    <div class="space-y-5">
                        <div class="group">
                            <label class="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 group-focus-within:text-emerald-600 transition-colors">Currency</label>
                            <div class="relative">
                                <select id="currency-select" class="${inputClass} appearance-none cursor-pointer pr-10 font-bold">
                                    <option value="INR">INR (₹)</option>
                                    <option value="USD">USD ($)</option>
                                    <option value="EUR">EUR (€)</option>
                                    <option value="GBP">GBP (£)</option>
                                </select>
                                <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-500">
                                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                                </div>
                            </div>
                        </div>

                        <div class="group">
                            <label class="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 group-focus-within:text-emerald-600 transition-colors">Default Tax Rate (%)</label>
                            <div class="relative">
                                <input type="number" id="default-tax-rate" class="${inputClass} pr-10 font-bold" placeholder="0">
                                <span class="absolute right-4 top-3 text-gray-400 font-bold">%</span>
                            </div>
                        </div>

                        <div class="group">
                            <label class="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 group-focus-within:text-emerald-600 transition-colors">Convenience Fee (%)</label>
                            <div class="relative">
                                <input type="number" id="setting-convenience-fee" class="${inputClass} pr-10 font-bold" placeholder="0">
                                <span class="absolute right-4 top-3 text-gray-400 font-bold">%</span>
                            </div>
                        </div>

                        </div>
                </div>

                

    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow duration-300 mt-6  ">
    <div class="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between relative">
        <div class="flex items-center gap-3">
            <div class="p-2 bg-yellow-100 text-yellow-600 rounded-lg shadow-sm">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.898 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path></svg>
            </div>
            <div>
                <h3 class="text-lg font-bold text-slate-800">Loyalty Tokens Program</h3>
                <p class="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Reward & Retain Customers</p>
            </div>
        </div>
        <label class="relative inline-flex items-center cursor-pointer group">
            <input type="checkbox" id="setting-loyalty-enabled" class="auto-save-store sr-only peer">
            <div class="w-10 h-5 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-yellow-500 shadow-inner"></div>
        </label>
    </div>
    
    <div class="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 transition-opacity duration-300" id="loyalty-config-panel">
        <div class="group">
            <label class="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Earning Ratio</label>
            <div class="flex items-center bg-white border border-slate-300 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-yellow-500/20 focus-within:border-yellow-500 shadow-sm transition-all">
                <span class="pl-4 pr-2 py-3 text-sm font-bold text-slate-400 bg-slate-50 border-r border-slate-200">₹</span>
                <input type="number" id="setting-loyalty-earn" class="auto-save-store w-full px-3 py-3 text-sm font-bold text-slate-800 outline-none" placeholder="100" min="1">
                <span class="pr-4 pl-2 py-3 text-xs font-bold text-slate-500 bg-slate-50 border-l border-slate-200 whitespace-nowrap">= 1 Token</span>
            </div>
        </div>
        <div class="group">
            <label class="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Redemption Value</label>
            <div class="flex items-center bg-white border border-slate-300 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-yellow-500/20 focus-within:border-yellow-500 shadow-sm transition-all">
                <span class="pl-4 pr-3 py-3 text-xs font-bold text-slate-500 bg-slate-50 border-r border-slate-200 whitespace-nowrap">1 Token = ₹</span>
                <input type="number" id="setting-loyalty-value" class="auto-save-store w-full px-3 py-3 text-sm font-bold text-slate-800 outline-none" placeholder="1" min="0.1" step="0.1">
            </div>
        </div>
    </div>
</div>
                
<div class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow duration-300   mt-6">
    <div class="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white flex items-center gap-3">
        <div class="p-2 bg-purple-100 text-purple-600 rounded-lg shadow-sm">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
        </div>
        <div>
            <h3 class="text-lg font-bold text-slate-800">Hardware & Printers</h3>
            <p class="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Configure Hardware Routing</p>
        </div>
    </div>
    
    <div id="printer-settings-panel" class="p-6 space-y-6">
        
        <div class="flex items-center justify-between bg-slate-50 p-4 rounded-xl border border-slate-100 mb-6">
            <div>
                <label class="block text-sm font-bold text-gray-800">Background (Silent) Printing</label>
                <p class="text-xs text-gray-500 mt-0.5 max-w-sm leading-relaxed">Turn off to force OS print dialog to show up manually.</p>
            </div>
            <label class="flex items-center cursor-pointer relative z-10">
                <input type="checkbox" id="setting-silent-print" class="sr-only" ${printConfig.silent !== false ? 'checked' : ''}>
                <div class="block bg-gray-200 w-11 h-6 rounded-full transition-colors toggle-bg"></div>
                <div class="dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform shadow-sm"></div>
            </label>
        </div>

        <div class="space-y-4">
            <h4 class="text-xs font-bold text-purple-700 uppercase tracking-widest border-b border-slate-100 pb-2">Thermal Receipt Printer (POS)</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="group">
                    <label for="setting-receipt-printer-name" class="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Assigned Machine</label>
                    <div class="relative">
                        <select id="setting-receipt-printer-name" class="${inputClass} appearance-none cursor-pointer pr-10 !py-2.5">
                            <option value="">System Default</option>
                        </select>
                        <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-500">
                            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                        </div>
                    </div>
                </div>
                <div class="group">
                    <label for="setting-paper-size" class="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Roll Size</label>
                    <div class="relative">
                        <select id="setting-paper-size" class="${inputClass} appearance-none cursor-pointer pr-10 !py-2.5">
                            <option value="58mm" ${printConfig.pageSize === '58mm' ? 'selected' : ''}>58mm Receipt (Narrow)</option>
                            <option value="80mm" ${printConfig.pageSize === '80mm' ? 'selected' : ''}>80mm Receipt (Wide)</option>
                        </select>
                        <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-500">
                            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="space-y-4 pt-4 border-t border-slate-100">
            <h4 class="text-xs font-bold text-purple-700 uppercase tracking-widest border-b border-slate-100 pb-2">Barcode Label Printer (Inventory)</h4>
            <div class="group">
                <label for="setting-barcode-printer-name" class="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Assigned Machine</label>
                <div class="relative">
                    <select id="setting-barcode-printer-name" class="${inputClass} appearance-none cursor-pointer pr-10 !py-2.5">
                        <option value="">Same as System Default</option>
                    </select>
                    <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-500">
                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </div>
                </div>
                <p class="text-[10px] text-slate-400 mt-1">Label sizing is controlled directly in the Barcode Print Preview window.</p>
            </div>
        </div>

        <div class="space-y-4 pt-4 border-t border-slate-100">
            <h4 class="text-xs font-bold text-purple-700 uppercase tracking-widest border-b border-slate-100 pb-2">A4 Document Printer (Wholesale/B2B)</h4>
            <div class="group">
                <label for="setting-invoice-printer-name" class="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Assigned Machine</label>
                <div class="relative">
                    <select id="setting-invoice-printer-name" class="${inputClass} appearance-none cursor-pointer pr-10 !py-2.5">
                        <option value="">Same as System Default</option>
                    </select>
                    <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-500">
                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </div>
                </div>
            </div>
        </div>

        <div class="pt-4 border-t border-slate-100">
            <button type="button" id="btn-test-print" class="w-full px-6 py-3 bg-white text-indigo-600 border border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 font-bold rounded-xl shadow-sm transition-all transform active:scale-95 flex items-center justify-center gap-2">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
                Print Test Page (Receipt Printer)
            </button>
        </div>
    </div>
</div>

<div id="settings-security-container"></div>
        <div id="settings-essentials-container"></div>

        <!-- 🚀 THE FIX: Dynamic Release Notes & Version Display -->
        <div id="settings-version-container" class="bg-slate-50 rounded-2xl shadow-inner border border-slate-200 overflow-hidden mt-6 flex flex-col relative">
            <div class="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                <svg class="w-32 h-32 text-indigo-900" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/></svg>
            </div>
            <div class="p-6 flex flex-col items-center text-center border-b border-slate-200 bg-white relative z-10">
                <div class="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center mb-3 border border-indigo-200 shadow-sm">
                    <svg class="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M12 5l7 7-7 7"></path></svg>
                </div>
                <h3 class="text-sm font-black text-slate-800">Mifela POS</h3>
                <p id="app-current-version-text" class="text-[10px] text-slate-500 font-mono mt-1 font-bold uppercase tracking-widest">Version: 1.0.169</p>
            </div>
            
            
        </div>

    </div> 
</form>
<style>input:checked ~ .toggle-bg { background-color: #4f46e5; } input:checked ~ .dot { transform: translateX(100%); }</style>
`;
}

export function populateSystemUI(data) {
    if (!data) data = {};

    try {
        const sysDetails = JSON.parse(localStorage.getItem('mifela_sys_details') || '{}');
        data.storeName = data.storeName || data.name || sysDetails.storeName || '';
        data.phone = data.phone || data.storePhone || sysDetails.contact || '';
        data.email = data.email || data.storeEmail || sysDetails.email || '';
        data.address = data.address || sysDetails.address || '';
        data.state = data.state || sysDetails.state || '';
        
        data.taxId = data.taxId || data.gstin || sysDetails.gstin || '';
        data.pan = data.pan || sysDetails.pan || '';

        // 🚀 NEW: Automatically derive PAN if missing but GSTIN is available
        if (!data.pan && data.taxId && data.taxId.length >= 15) {
            data.pan = data.taxId.substring(2, 12);
        }
        
        data.currency = data.currency || sysDetails.currency || 'INR';
        data.taxRate = data.taxRate !== undefined ? data.taxRate : (sysDetails.taxRate || 0);
    } catch(e) {
        console.warn("Failed to parse sys details fallback");
    }

    const setVal = (id, val) => { 
        const el = document.getElementById(id); 
        if (el) el.value = val !== undefined ? val : ''; 
    };

    originalPhoneNumber = data.phone;

    setVal('setting-store-name', data.storeName);
    setVal('setting-store-phone', data.phone);
    setVal('setting-store-email', data.email);
    setVal('setting-store-address', data.address);
    setVal('setting-store-state', data.state);
    setVal('setting-store-tax-id', data.taxId);
    setVal('setting-store-pan', data.pan);
    setVal('setting-store-logo', data.logoUrl);
    
    const previewImg = document.getElementById('logo-preview-img');
    const placeholder = document.getElementById('logo-upload-placeholder');
    const removeBtn = document.getElementById('remove-logo-btn'); 
    
    if (previewImg && placeholder) {
        if (data.logoUrl && (data.logoUrl.startsWith('http') || data.logoUrl.startsWith('data:image'))) {
            previewImg.src = data.logoUrl;
            previewImg.classList.remove('hidden');
            placeholder.classList.add('hidden');
            if (removeBtn) removeBtn.classList.remove('hidden');
        } else {
            previewImg.src = '';
            previewImg.classList.add('hidden');
            placeholder.classList.remove('hidden');
            if (removeBtn) removeBtn.classList.add('hidden');
        }
    }
    
    setVal('setting-store-tagline', data.tagline);
    setVal('setting-store-footer', data.footer);
    setVal('setting-store-website', data.website);
    setVal('currency-select', data.currency);
    setVal('default-tax-rate', data.taxRate);
    setVal('setting-convenience-fee', data.convenienceFee || 0); 
    setVal('setting-store-type', data.dealerType || 'regular');
    setVal('setting-invoice-prefix', data.invoicePrefix);
    setVal('setting-invoice-terms', data.invoiceTerms);
    setVal('setting-store-upi', data.upiId);  
    setVal('setting-store-tnc', data.tnc);
    setVal('setting-theme-color', data.themeColor || '#4f46e5'); 
    setVal('setting-loyalty-earn', data.loyaltyEarnRatio || 100);
    setVal('setting-loyalty-value', data.loyaltyTokenValue || 1);

    const loyaltyToggle = document.getElementById('setting-loyalty-enabled');
    if (loyaltyToggle) {
        loyaltyToggle.checked = !!data.loyaltyEnabled;
        const panel = document.getElementById('loyalty-config-panel');
        if (panel) {
            panel.style.opacity = loyaltyToggle.checked ? '1' : '0.4';
            panel.style.pointerEvents = loyaltyToggle.checked ? 'auto' : 'none';
        }
    }
    document.getElementById('setting-loyalty-enabled')?.addEventListener('change', (e) => {
        const panel = document.getElementById('loyalty-config-panel');
        panel.style.opacity = e.target.checked ? '1' : '0.4';
        panel.style.pointerEvents = e.target.checked ? 'auto' : 'none';
    });
    
    if (data.bankDetails) {
        setVal('setting-bank-name', data.bankDetails.bankName);
        setVal('setting-bank-branch', data.bankDetails.branch);
        setVal('setting-bank-acc', data.bankDetails.accountNumber);
        setVal('setting-bank-ifsc', data.bankDetails.ifsc);
    }

    const unlockInput = (id) => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = false;
            el.classList.remove('opacity-60', 'cursor-not-allowed', 'bg-slate-100');
        }
    };
    unlockInput('setting-store-tagline');
    unlockInput('setting-store-footer');
    unlockInput('setting-store-website');
    unlockInput('setting-invoice-prefix'); 
    unlockInput('setting-invoice-terms');  
    unlockInput('setting-theme-color');    

    currentSecurityState = data.security || {};
    organizeDynamicSections();
    loadVersionAndUpdates(); 

    const secToggle = document.getElementById('sec-enable-toggle');
    if (secToggle) {
        secToggle.addEventListener('change', (e) => {
            currentSecurityState.enabled = e.target.checked;
            const panel = document.getElementById('sec-details-panel');
            if (panel) panel.classList.toggle('hidden', !e.target.checked);
        });
    }

    if (typeof loadHardwarePrinters !== 'undefined') loadHardwarePrinters();
}


export async function loadSettingsPage(targetView = 'settings') {
    isSettingsInitialized = true; // 🚀 THE FIX: Immediately flag as initialized to break the crash loop

    // 1. Build shell ONLY if it doesn't exist
    if (!document.getElementById('settings-content-wrapper')) {
        renderSettingsShell(); 
        bindEvents();
    }
    
    // 2. Fetch data once
    const storeId = currentStoreId || (typeof getStoreId === 'function' ? getStoreId() : 'main');
    currentStoreId = storeId; 
    
    try {
        let storeData = {};
        
        // Try to load from the SQLite settings table via dbAPI
        if (window.dbAPI && window.dbAPI.getStoreSettings) {
             const sqliteSettings = await window.dbAPI.getStoreSettings(storeId);
             if (sqliteSettings) storeData = sqliteSettings;
        } else {
             // Fallback to local storage if API isn't ready
             const localStore = localStorage.getItem(`mifela_settings_${storeId}`);
             if (localStore) storeData = JSON.parse(localStore);
        }

        populateSystemUI(storeData);
        populateProfileUI();
        
        const loyaltyToggle = document.getElementById('setting-loyalty-enabled');
        if (loyaltyToggle) {
            loyaltyToggle.checked = !!storeData.loyaltyEnabled;
        }
    } catch (e) {
        console.error("Error loading offline settings:", e);
    }
    
    // 3. Set tab and show
    activeTab = targetView;
    switchView(targetView);
}

function renderSettingsShell() {
    const container = document.getElementById('settings');
    if (!container) return;
    
    container.innerHTML = `
        <div id="settings-content-wrapper" class="w-full">
            
            <div class="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h2 id="settings-view-title" class="text-3xl font-black text-slate-900 tracking-tight">My Profile</h2>
                    <p class="text-sm text-slate-500 mt-1 font-medium">Update your account and business preferences.</p>
                </div>
                
                <div class="flex items-center gap-3 relative">
                    <!-- Unified Top Right Save Button -->
                    <button id="unified-save-btn" class="hidden bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-xl text-sm font-bold transition-all shadow-sm active:scale-95 flex items-center gap-2">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                        Save Changes
                    </button>
                </div>
            </div>

            <main class="relative">
                <div id="profile-view" class="settings-view hidden opacity-0 transition-all duration-300 translate-y-2">
                    ${getProfileSettingsHTML()}
                </div>
                
                <div id="store-view" class="settings-view hidden opacity-0 transition-all duration-300 translate-y-2">
                    ${getSystemSettingsHTML()}
                </div>
            </main>
        </div>
    `;
}
async function loadVersionAndUpdates() {
    const versionEl = document.getElementById('app-current-version-text');
    const badgeEl = document.getElementById('latest-version-badge');
    const notesEl = document.getElementById('release-notes-content');
    
    // 1. Fetch Current Installed Version
    let currentVersion = '1.0.169'; 
    if (window.electronAPI && typeof window.electronAPI.getVersion === 'function') {
        try { currentVersion = await window.electronAPI.getVersion(); } catch (e) {}
    }
    if (versionEl) versionEl.textContent = `VERSION: ${currentVersion}`;

    // 2. Render Engine for the Release Notes
    const renderNotes = (data) => {
        if (!data) return;
        if (badgeEl) {
            const isLatest = data.version === currentVersion;
            badgeEl.textContent = `v${data.version || 'Latest'}`;
            if (isLatest) {
                badgeEl.className = 'bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-mono font-bold border border-emerald-200';
            } else {
                badgeEl.className = 'bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-[10px] font-mono font-bold border border-indigo-200';
            }
        }
        if (notesEl) {
            let htmlContent = data.releaseNotes || '<p class="italic text-slate-500">Up to date with the latest performance and security enhancements.</p>';
            if (typeof htmlContent === 'string' && !htmlContent.includes('<')) {
                htmlContent = `<p>${escapeHTML(htmlContent)}</p>`;
            }
            notesEl.innerHTML = `<div class="prose prose-sm max-w-none text-slate-600">${htmlContent}</div>`;
        }
    };

    // 3. Fallback for Web Browsers
    if (!window.electronAPI || !window.electronAPI.updater) {
        if (badgeEl) badgeEl.textContent = `v${currentVersion}`;
        if (notesEl) notesEl.innerHTML = '<p class="italic text-slate-400">Release notes unavailable in web browser mode.</p>';
        return;
    }

    // 4. Check Global Cache or Trigger a Background Fetch
    if (window.__mifela_update_info) {
        renderNotes(window.__mifela_update_info);
    } else {
        window.onUpdateInfoReceived = renderNotes;
        window.electronAPI.updater.check(); 
    }
}

async function resolveStoreContext(user) {
    const pStoreId = typeof getStoreId === 'function' ? getStoreId() : primaryStoreId;
    
    const locs = typeof getAvailableLocations === 'function' ? getAvailableLocations() : (availableLocations || []);

    if (locs && locs.length > 0) {
        if (!currentStoreId || !locs.find(s => s.id === currentStoreId)) {
            currentStoreId = pStoreId || locs[0].id;
        }
    } else {
        currentStoreId = pStoreId;
    }
}

function refreshAllViews() {
    // Hardcode to 'main' since we are a single offline instance now
    const storeId = typeof getStoreId === 'function' ? getStoreId() : 'main';
    
    if (window.dbAPI && window.dbAPI.getStoreSettings) {
        window.dbAPI.getStoreSettings(storeId).then(sqliteSettings => {
            populateSystemUI(sqliteSettings || {});
        }).catch(err => {
            console.error("Failure rendering settings:", err);
        });
    } else {
        const localStore = localStorage.getItem(`mifela_settings_${storeId}`);
        populateSystemUI(localStore ? JSON.parse(localStore) : {});
    }
    populateProfileUI();
}

// --- REPLACE bindEvents IN src/components/settings.js ---

function bindEvents() {
    // 1. LINK TOP-RIGHT HEADER BUTTONS
    const headerProfileBtn = document.getElementById('profile-btn');
    if (headerProfileBtn) {
        headerProfileBtn.onclick = async (e) => {
            e.preventDefault();
            await flushSettingsChanges();
            if (typeof window.showView === 'function') window.showView('settings');
            switchView('profile'); 
        };
    }

    const headerStoreBtn = document.getElementById('settings-btn');
    if (headerStoreBtn) {
        headerStoreBtn.onclick = async (e) => {
            e.preventDefault();
            await flushSettingsChanges();
            if (typeof window.showView === 'function') window.showView('settings');
            switchView('store'); 
        };
    }

    // 2. UNIFIED SAVE & AUTO-BLUR LOGIC
    const unifiedSaveBtn = document.getElementById('unified-save-btn');
    if (unifiedSaveBtn) {
        unifiedSaveBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await flushSettingsChanges();
        });
    }

    const wrapper = document.getElementById('settings-content-wrapper');
    if (wrapper) {
        wrapper.addEventListener('focusout', (e) => {
            if (e.relatedTarget && e.relatedTarget.id === 'unified-save-btn') return;
            
            if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) {
                setTimeout(() => {
                    if (isProfileDirty || isStoreDirty) {
                        flushSettingsChanges();
                    }
                }, 200);
            }
        });
    }

    const resetBtn = document.getElementById('reset-app-data-btn');
    if (resetBtn) {
        resetBtn.onclick = () => {
            if (confirm('Clear local cache? This fixes UI glitches but keeps cloud data safe.')) {
                localStorage.clear();
                sessionStorage.clear();
                window.location.reload();
            }
        };
    }
    
    // Auto-save tagging
    const storeForm = document.getElementById('store-settings-form');
    if (storeForm) {
        const markStoreDirty = () => { isStoreDirty = true; updateSaveIndicator('store', 'Unsaved changes', 'amber'); };
        
        storeForm.addEventListener('input', (e) => { 
            if (e.target.classList.contains('auto-save-store')) markStoreDirty(); 
        });
        
        storeForm.addEventListener('change', (e) => { 
            if (e.target.classList.contains('auto-save-store')) {
                markStoreDirty(); 
                // Force immediate save when toggles/checkboxes are clicked
                if (e.target.type === 'checkbox' || e.target.type === 'radio' || e.target.tagName === 'SELECT') {
                    flushSettingsChanges();
                }
            } 
        });
    }

    const profileInputs = document.querySelectorAll('.auto-save-profile');
    profileInputs.forEach(input => {
        input.addEventListener('input', () => { isProfileDirty = true; updateSaveIndicator('profile', 'Unsaved', 'amber'); });
        input.addEventListener('change', () => { isProfileDirty = true; updateSaveIndicator('profile', 'Unsaved', 'amber'); });
    });
    const storeTaxInput = document.getElementById('setting-store-tax-id');
    const storePanInput = document.getElementById('setting-store-pan');
    if (storeTaxInput && storePanInput) {
        storeTaxInput.addEventListener('input', (e) => {
            let val = e.target.value.toUpperCase().trim();
            e.target.value = val;
            if (val.length >= 15 && !storePanInput.value) {
                storePanInput.value = val.substring(2, 12);
                storePanInput.classList.add('bg-indigo-50', 'transition-colors');
                setTimeout(() => storePanInput.classList.remove('bg-indigo-50'), 800);
                storePanInput.dispatchEvent(new Event('input', { bubbles: true })); // Triggers Auto-Save
            }
        });
    }

    // Drag & Drop Logo Image Compressor
    const dropZone = document.getElementById('logo-drop-zone');
    const fileInput = document.getElementById('logo-file-input');
    const previewImg = document.getElementById('logo-preview-img');
    const placeholder = document.getElementById('logo-upload-placeholder');
    const urlInput = document.getElementById('setting-store-logo');

    if (dropZone && fileInput) {
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropZone.classList.add('border-pink-500', 'bg-pink-50');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropZone.classList.remove('border-pink-500', 'bg-pink-50');
            });
        });

        fileInput.addEventListener('change', function() {
            const file = this.files[0];
            if (!file) return;
            
            if (!file.type.match('image.*')) {
                if (typeof showToast === 'function') showToast('Invalid File', 'Please select an image file (PNG, JPG)', 'error');
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX_DIMENSION = 300;
                    let width = img.width;
                    let height = img.height;

                    if (width > height && width > MAX_DIMENSION) {
                        height *= MAX_DIMENSION / width;
                        width = MAX_DIMENSION;
                    } else if (height > MAX_DIMENSION) {
                        width *= MAX_DIMENSION / height;
                        height = MAX_DIMENSION;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    
                    ctx.fillStyle = "#FFFFFF";
                    ctx.fillRect(0, 0, width, height);
                    ctx.drawImage(img, 0, 0, width, height);

                    const compressedDataUrl = canvas.toDataURL('image/png');

                    previewImg.src = compressedDataUrl;
                    previewImg.classList.remove('hidden');
                    placeholder.classList.add('hidden');
                    
                    const removeBtn = document.getElementById('remove-logo-btn');
                    if (removeBtn) removeBtn.classList.remove('hidden');
                    
                    urlInput.value = compressedDataUrl;
                    isStoreDirty = true; 
                    updateSaveIndicator('store', 'Unsaved changes', 'amber'); 
                    flushSettingsChanges(); 
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });

        urlInput.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            const removeBtn = document.getElementById('remove-logo-btn');
            if (val && (val.startsWith('http') || val.startsWith('data:image'))) {
                previewImg.src = val;
                previewImg.classList.remove('hidden');
                placeholder.classList.add('hidden');
                if (removeBtn) removeBtn.classList.remove('hidden');
            } else {
                previewImg.src = '';
                previewImg.classList.add('hidden');
                placeholder.classList.remove('hidden');
                if (removeBtn) removeBtn.classList.add('hidden');
            }
        });

        const removeLogoBtn = document.getElementById('remove-logo-btn');
        if (removeLogoBtn) {
            removeLogoBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation(); 
                
                previewImg.src = '';
                previewImg.classList.add('hidden');
                removeLogoBtn.classList.add('hidden');
                placeholder.classList.remove('hidden');
                
                urlInput.value = '';
                fileInput.value = '';
                isStoreDirty = true;
                updateSaveIndicator('store', 'Unsaved changes', 'amber');
                flushSettingsChanges(); 
            });
        }
    }
}



function switchView(viewName) {
    activeTab = viewName;
    const profileView = document.getElementById('profile-view');
    const storeView = document.getElementById('store-view');
    const viewTitle = document.getElementById('settings-view-title');

    const showView = (el) => { 
        el?.classList.remove('hidden'); 
        setTimeout(() => el?.classList.remove('opacity-0', 'translate-y-2'), 10); 
    };
    const hideView = (el) => { 
        el?.classList.add('opacity-0', 'translate-y-2'); 
        el?.classList.add('hidden'); 
    };

    if (viewName === 'profile') {
        showView(profileView); 
        hideView(storeView);
        if(viewTitle) viewTitle.textContent = "My Profile";
    } else {
        hideView(profileView); 
        showView(storeView);
        if(viewTitle) viewTitle.textContent = "Store Configuration";
    }
}





function updateSaveIndicator(target, text, color) {
    const ind = document.getElementById(`${target}-save-indicator`);
    const unifiedBtn = document.getElementById('unified-save-btn');
    
    // Whenever a setting goes "dirty", surface the unified save button
    if (color === 'amber' && unifiedBtn) {
        unifiedBtn.classList.remove('hidden');
    }

    if (!ind) return;
    
    let bg = 'bg-emerald-100', textCol = 'text-emerald-700', dot = 'bg-emerald-500', dotAnim = '';
    if (color === 'amber') { bg = 'bg-amber-100'; textCol = 'text-amber-700'; dot = 'bg-amber-500'; dotAnim = 'animate-pulse'; }
    if (color === 'blue') { bg = 'bg-blue-100'; textCol = 'text-blue-700'; dot = 'bg-blue-500'; dotAnim = 'animate-pulse'; }

    ind.className = `absolute top-0 right-0 px-4 py-1 text-[10px] font-bold tracking-widest rounded-bl-xl transition-opacity duration-300 flex items-center gap-1.5 ${bg} ${textCol} opacity-100 z-50`;
    ind.innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${dot} ${dotAnim}"></span> ${text}`;
    
    if (color === 'emerald') {
        setTimeout(() => {
            if (ind.textContent.includes('Saved')) ind.classList.replace('opacity-100', 'opacity-0');
        }, 3000);
    }
}

// ==========================================
// 3. PROFILE LOGIC
// ==========================================

async function populateProfileUI() {
    const nameInput = document.getElementById('profile-name-input');
    const desigInput = document.getElementById('profile-designation-input'); 
    const langInput = document.getElementById('profile-lang-input'); 
    const emailInput = document.getElementById('profile-email-input'); 
    const phoneInput = document.getElementById('profile-phone-input'); 
    
    const headerName = document.getElementById('profile-display-name-header');
    const headerAvatar = document.getElementById('profile-avatar-initial');
    const roleBadge = document.getElementById('profile-role-badge');

    let displayName = 'Admin User';
    let displayEmail = '';
    let displayPhone = '';
    
    try {
        const localProfile = JSON.parse(localStorage.getItem('mifela_staff_profile') || '{}');
        
        if (localProfile.name) displayName = localProfile.name;
        if (localProfile.email) displayEmail = localProfile.email;
        if (localProfile.phone) displayPhone = localProfile.phone;
        
        if (desigInput && localProfile.designation) desigInput.value = localProfile.designation;
        if (langInput && localProfile.language) langInput.value = localProfile.language;
    } catch (e) {
        console.warn("Could not fetch offline user profile details", e);
    }

    if (nameInput) nameInput.value = displayName;
    if (emailInput) emailInput.value = displayEmail;
    if (phoneInput) phoneInput.value = displayPhone;
    
    if (headerName) headerName.textContent = escapeHTML(displayName);
    if (headerAvatar) headerAvatar.textContent = escapeHTML(displayName.charAt(0).toUpperCase());

    // 🚀 THE FIX: Local Password Handler
    const passForm = document.getElementById('change-password-form');
    if (passForm) {
        passForm.onsubmit = (e) => {
            e.preventDefault();
            const currPass = document.getElementById('current-password').value;
            const pass1 = document.getElementById('new-password').value;
            const pass2 = document.getElementById('confirm-password').value;
            
            const savedAppPassword = localStorage.getItem('mifela_app_password') || '';
            
            // If they have a password set, verify it first
            if (savedAppPassword && currPass !== savedAppPassword) {
                return showModal('Error', 'Current password is incorrect.', 'error');
            }
            
            if (pass1 !== pass2) return showModal('Error', 'New passwords do not match.', 'error');
            
            localStorage.setItem('mifela_app_password', pass1);
            showToast('Success', 'App Security Password updated!', 'success');
            passForm.reset();
        };
    }
}

async function handleSaveProfile(e) {
    if(e) e.preventDefault();

    const nameInput = document.getElementById('profile-name-input');
    if (!nameInput) return;

    const newName = nameInput.value.trim();
    if (!newName) {
        showToast('Error', 'Name cannot be empty', 'error');
        return;
    }
    
    const newDesig = document.getElementById('profile-designation-input')?.value.trim() || ''; 
    const newLang = document.getElementById('profile-lang-input')?.value || 'en'; 
    const newEmail = document.getElementById('profile-email-input')?.value.trim() || ''; 
    const newPhone = document.getElementById('profile-phone-input')?.value.trim() || ''; 

    try {
        // 🚀 THE FIX: Save directly to Local Storage
        const profileData = {
            name: newName,
            designation: newDesig,
            language: newLang,
            email: newEmail,
            phone: newPhone,
            role: 'admin'
        };
        
        localStorage.setItem('mifela_staff_profile', JSON.stringify(profileData));
        
        const headerName = document.getElementById('profile-display-name-header');
        const headerAvatar = document.getElementById('profile-avatar-initial');
        if (headerName) headerName.textContent = escapeHTML(newName);
        if (headerAvatar) headerAvatar.textContent = escapeHTML(newName.charAt(0).toUpperCase());

    } catch (error) {
        console.error("Profile update error:", error);
        showModal('Error', 'Failed to update profile locally.', 'error');
    }
}

export async function flushSettingsChanges() {
    const promises = [];
    const unifiedBtn = document.getElementById('unified-save-btn');

    if (isProfileDirty || isStoreDirty) {
        if (unifiedBtn) {
            unifiedBtn.innerHTML = `<span class="animate-spin h-4 w-4 border-2 border-white rounded-full border-t-transparent inline-block"></span> Saving...`;
        }
    }

    if (isProfileDirty) {
        promises.push(handleSaveProfile().then(() => { isProfileDirty = false; }));
    }
    if (isStoreDirty) {
        updateSaveIndicator('store', 'Saving...', 'blue');
        promises.push(handleSaveStore().then(() => { 
            isStoreDirty = false; 
            updateSaveIndicator('store', 'Saved', 'emerald'); 
        }));
    }
    
    // 🚀 THE FIX: Removed isWaDirty WhatsApp logic
    
    if (promises.length > 0) {
        await Promise.all(promises);
        
        if (unifiedBtn) {
            unifiedBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Saved!`;
            unifiedBtn.classList.replace('bg-indigo-600', 'bg-emerald-500');
            unifiedBtn.classList.replace('hover:bg-indigo-700', 'hover:bg-emerald-600');
            
            setTimeout(() => {
                if (!isProfileDirty && !isStoreDirty) {
                    unifiedBtn.classList.add('hidden');
                    unifiedBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg> Save Changes`;
                    unifiedBtn.classList.replace('bg-emerald-500', 'bg-indigo-600');
                    unifiedBtn.classList.replace('hover:bg-emerald-600', 'hover:bg-indigo-700');
                }
            }, 2000);
        }
    }
}


export async function handleSaveStore(arg) {
    let targetStoreId = arg || currentStoreId;
    if (!targetStoreId) return;

    const settingsSection = document.getElementById('settings');
    const getVal = (id) => settingsSection.querySelector('#' + id)?.value?.trim() || '';
    
    // Prevent silent aborts if the user hasn't filled out the store name yet
    let sName = getVal('setting-store-name');
    if (!sName) {
        sName = "Main Store";
        const nameInput = document.getElementById('setting-store-name');
        if (nameInput) nameInput.value = sName;
    }

    let sPhone = getVal('setting-store-phone');
    const sEmail = getVal('setting-store-email');
    const sAddr = getVal('setting-store-address');
    
    // 🚀 THE FIX: Force uppercase and fallback PAN extraction on manual save
    const sTax = getVal('setting-store-tax-id').toUpperCase();
    const sState = getVal('setting-store-state');
    
    let sPan = getVal('setting-store-pan').toUpperCase();
    
    if (!sPan && sTax.length >= 15) {
        sPan = sTax.substring(2, 12);
        const panInput = document.getElementById('setting-store-pan');
        if (panInput) panInput.value = sPan;
    }

    const sLogo = getVal('setting-store-logo');
    const sTag = getVal('setting-store-tagline');
    const sWeb = getVal('setting-store-website');
    const sFoot = getVal('setting-store-footer');
    const sType = getVal('setting-store-type');
    
    const sUpi = getVal('setting-store-upi');
    const sTnc = getVal('setting-store-tnc');
    
    const razorpayKeyId = getVal('setting-razorpay-key');
    const razorpayKeySecret = getVal('setting-razorpay-secret');
    
    const bankDetails = {
        bankName: getVal('setting-bank-name'),
        branch: getVal('setting-bank-branch'),
        accountNumber: getVal('setting-bank-acc'),
        ifsc: getVal('setting-bank-ifsc')
    };    
    
    const digits = sPhone.replace(/\D/g, ''); 
    sPhone = digits.startsWith('91') && digits.length === 12 ? `+${digits}` : `+91${digits.slice(-10)}`;
    const taxRate = parseFloat(document.getElementById('default-tax-rate')?.value || 0);
    const convenienceFee = parseFloat(document.getElementById('setting-convenience-fee')?.value || 0); 
    const currency = document.getElementById('currency-select')?.value || 'INR';
    const loyaltyEnabled = document.getElementById('setting-loyalty-enabled')?.checked || false;
    const loyaltyEarnRatio = parseFloat(getVal('setting-loyalty-earn')) || 100;
    const loyaltyTokenValue = parseFloat(getVal('setting-loyalty-value')) || 1;
    
    await proceedWithStoreSave(null, targetStoreId, { 
        sName, sPhone, sEmail, sAddr, sTax, sPan, sTag, sWeb, sFoot, sState, sType, bankDetails, taxRate, convenienceFee, currency, sLogo, razorpayKeyId, razorpayKeySecret,
        sUpi, sTnc, loyaltyEnabled, loyaltyEarnRatio, loyaltyTokenValue 
    });
}

async function proceedWithStoreSave(btn, targetStoreId, data) {
    try {
        const mergedSettings = {
            storeId: targetStoreId,
            storeName: data.sName,
            phone: data.sPhone,
            email: data.sEmail,
            address: data.sAddr,
            state: data.sState,
            taxId: data.sTax,
            pan: data.sPan,       
            logoUrl: data.sLogo,  
            tagline: data.sTag,
            website: data.sWeb,
            footer: data.sFoot,
            dealerType: data.sType,
            bankDetails: data.bankDetails,
            currency: data.currency,
            taxRate: data.taxRate,
            convenienceFee: data.convenienceFee,
            razorpayKeyId: data.razorpayKeyId,
            razorpayKeySecret: data.razorpayKeySecret,
            upiId: data.sUpi,
            tnc: data.sTnc,
            loyaltyEnabled: data.loyaltyEnabled,
            loyaltyEarnRatio: data.loyaltyEarnRatio,
            loyaltyTokenValue: data.loyaltyTokenValue,
            security: currentSecurityState,
            updatedAt: new Date().toISOString()
        };

        // 🚀 THE FIX: Save to local SQLite database instead of Firebase
        if (window.dbAPI && window.dbAPI.saveStoreSettings) {
            await window.dbAPI.saveStoreSettings(targetStoreId, mergedSettings);
        }
        
        // Backup to localStorage for fast synchronous reads in other tabs
        localStorage.setItem(`mifela_settings_${targetStoreId}`, JSON.stringify(mergedSettings));

        const dashStoreName = document.getElementById('dashboard-store-name');
        if (dashStoreName) dashStoreName.textContent = escapeHTML(data.sName);
        
        const locSelector = document.getElementById('location-selector');
        if (locSelector && locSelector.options[locSelector.selectedIndex]) {
            let newLabel = data.sName;
            if (locSelector.options[locSelector.selectedIndex].text.includes('(Main Store)')) {
                newLabel += ' (Main Store)';
            }
            locSelector.options[locSelector.selectedIndex].text = escapeHTML(newLabel);
        }

        originalPhoneNumber = data.sPhone;
    } catch (error) {
        console.error("Offline Store Update Error:", error);
    }
}


function renderMerchantId(merchantId) {
    const container = document.getElementById('merchant-id-container');
    if (container && merchantId) {
        container.innerHTML = `
            <div class="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-1 shadow-lg mt-8">
                <div class="bg-white rounded-xl p-6 relative overflow-hidden">
                    <div class="absolute top-0 right-0 p-4 opacity-10">
                        <svg class="w-24 h-24 text-indigo-900" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zm0 9l2.5-1.25L12 8.5l-2.5 1.25L12 11zm0 2.5l-5-2.5-5 2.5L12 22l10-8.5-5-2.5-5 2.5z"/></svg>
                    </div>
                    <div class="flex justify-between items-center mb-4 relative z-10">
                        <p class="text-xs font-bold text-indigo-500 uppercase tracking-widest">Public Merchant ID</p>
                        <span class="bg-green-100 text-green-700 px-2 py-0.5 rounded text-[10px] font-bold border border-green-200">ACTIVE</span>
                    </div>
                    <div class="flex flex-col sm:flex-row justify-between items-center gap-4 relative z-10">
                        <span class="text-2xl font-mono font-bold text-gray-900 tracking-wider select-all">${merchantId}</span>
                        <button type="button" class="text-xs bg-indigo-50 text-indigo-700 px-4 py-2 rounded-lg font-bold hover:bg-indigo-100 transition-colors flex items-center gap-2" 
                            onclick="navigator.clipboard.writeText('${merchantId}');">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                            Copy ID
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
}

function organizeDynamicSections() {
    if (document.getElementById('settings-security-container')) renderSecuritySection(currentSecurityState);
    if (document.getElementById('settings-essentials-container')) injectEssentialsSection();
}

function injectEssentialsSection() {
    const container = document.getElementById('settings-essentials-container');
    if (!container) return;
    
    container.innerHTML = `
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <h3 class="font-bold text-gray-800 mb-4 flex items-center gap-2">
                <span class="p-1.5 bg-amber-100 text-amber-600 rounded-lg">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>
                </span>
                Feedback & Support
            </h3>
            <div class="space-y-4">
                <textarea id="settings-feedback-text" rows="3" class="w-full border border-slate-300 p-3 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-medium resize-none bg-slate-50 hover:bg-white transition-all shadow-inner" placeholder="Report a bug or request a feature..."></textarea>
                <button type="button" id="send-settings-feedback-btn" class="w-full bg-amber-50 text-amber-700 border border-amber-100 py-3 rounded-xl text-sm font-bold hover:bg-amber-100 transition-colors shadow-sm">
                    Submit Report
                </button>
            </div>
        </div>
    `;

    document.getElementById('send-settings-feedback-btn').addEventListener('click', handleSendFeedback);
}

async function handleSendFeedback() {
    const textInput = document.getElementById('settings-feedback-text');
    const text = textInput.value.trim();
    
    if (!text) { 
        showToast('Required', 'Please enter some text before submitting.', 'warning'); 
        return; 
    }
    
    const btn = document.getElementById('send-settings-feedback-btn');
    const originalText = btn.textContent;
    btn.innerHTML = `<span class="animate-pulse">Sending...</span>`;
    btn.disabled = true;
    
    try {
        const user = auth.currentUser;
        
        await addDoc(collection(db, `artifacts/${appId}/feedback`), {
            type: 'General Report',
            message: text,
            timestamp: new Date().toISOString(),
            status: 'open',
            userId: user ? user.email || user.uid : 'Unknown',
            storeId: currentStoreId || 'Unknown Store'
        });

        showToast('Thank You', 'Your feedback has been sent to Mifela HQ.', 'success');
        textInput.value = ''; 
        
    } catch (error) {
        console.error("Feedback Error:", error);
        showToast('Error', 'Failed to send feedback: ' + error.message, 'error');
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

async function getCurrentIP() {
    return '127.0.0.1'; // 🚀 THE FIX: Offline mode always returns localhost to prevent lockouts
}

export async function checkAndAutoUpdateSecurityIp(forceStoreId = null) {
    // 🚀 THE FIX: Disabled IP Security in offline mode
    return;
}

async function renderSecuritySection(security) {
    const container = document.getElementById('settings-security-container');
    if (!container) return;

    if (userRole !== 'admin' && userRole !== 'store_manager') {
        container.innerHTML = ''; 
        return;
    }

    const currentIp = await getCurrentIP();
    const isEnabled = !!security.enabled; 
    const isStrict = security.strictMode !== false; 
    const authorizedIp = security.authorizedIp || (security.ipMap ? security.ipMap['main'] : null) || 'Not Set';
    const isMatched = currentIp === authorizedIp;

    let statusBadge = '';
    if (isEnabled) {
        statusBadge = isMatched 
            ? `<div class="flex items-center gap-2 text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full text-xs font-bold border border-emerald-200"><div class="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div> Authorized</div>`
            : `<div class="flex items-center gap-2 text-amber-700 bg-amber-50 px-3 py-1 rounded-full text-xs font-bold border border-amber-200"><div class="w-2 h-2 bg-amber-500 rounded-full"></div> Mismatch</div>`;
    } else {
        statusBadge = `<div class="text-gray-500 bg-gray-100 px-3 py-1 rounded-full text-xs font-bold border border-gray-200">Disabled</div>`;
    }

    container.innerHTML = `
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 mt-8 overflow-hidden transition-all hover:shadow-md">
            <div class="px-6 py-5 bg-white border-b border-gray-100 flex justify-between items-center">
                <h3 class="font-bold text-gray-800 flex items-center gap-3">
                    <span class="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                    </span>
                    <div>
                        <span class="block text-base">Network Security</span>
                        <span class="block text-xs text-gray-500 font-normal mt-0.5">Control access based on IP address</span>
                    </div>
                </h3>
                <label class="flex items-center cursor-pointer relative z-10">
                    <input type="checkbox" id="sec-enable-toggle" class="auto-save-store sr-only" ${isEnabled ? 'checked' : ''}>
                    <div class="block bg-gray-200 w-11 h-6 rounded-full transition-colors toggle-bg"></div>
                    <div class="dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform shadow-sm"></div>
                </label>
            </div>
            
            <div id="sec-details-panel" class="${isEnabled ? '' : 'hidden'} p-6 bg-gray-50/30">
                <div class="flex justify-between items-center mb-6">${statusBadge}</div>
                <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6 relative overflow-hidden">
                    <div class="absolute top-0 left-0 w-1 h-full ${isMatched ? 'bg-emerald-500' : 'bg-amber-500'}"></div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                        <div>
                            <p class="text-[10px] text-gray-400 uppercase font-bold mb-1">Current Device IP</p>
                            <div class="flex items-center gap-2">
                                <span class="font-mono text-xl text-gray-800 font-bold tracking-tight">${currentIp || 'Loading...'}</span>
                                ${isMatched ? '<span class="text-emerald-500"><svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg></span>' : ''}
                            </div>
                        </div>
                        <div class="relative">
                            <p class="text-[10px] text-gray-400 uppercase font-bold mb-1">Authorized IP</p>
                             <div class="flex items-center gap-3">
                                <span class="font-mono text-xl ${isMatched ? 'text-gray-800' : 'text-amber-600'} font-bold tracking-tight">
                                    ${authorizedIp === 'Not Set' ? '<span class="text-gray-300 italic">Not Set</span>' : authorizedIp}
                                </span>
                                <button type="button" id="sec-update-ip-btn" class="ml-auto text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100 hover:text-indigo-800 px-3 py-1.5 rounded-lg font-bold transition-colors border border-indigo-100">
                                    Authorize Current
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <label class="flex items-start gap-3 p-4 bg-white rounded-xl border border-gray-200 hover:border-indigo-300 cursor-pointer transition-all h-full shadow-sm group">
                        <div class="pt-0.5">
                            <input type="checkbox" id="sec-strict-mode" class="auto-save-store h-5 w-5 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300" ${isStrict ? 'checked' : ''}>
                        </div>
                        <div>
                            <span class="font-bold text-sm text-gray-800 block group-hover:text-indigo-700 transition-colors">Strict Mode</span>
                            <span class="text-xs text-gray-500 block mt-0.5 leading-relaxed">Block login/clock-in completely if IP doesn't match.</span>
                        </div>
                    </label>
                </div>
            </div>
        </div>
        <style>input:checked ~ .toggle-bg { background-color: #4f46e5; } input:checked ~ .dot { transform: translateX(100%); }</style>
    `;

    document.getElementById('sec-enable-toggle')?.addEventListener('change', (e) => {
    currentSecurityState.enabled = e.target.checked;
    const panel = document.getElementById('sec-details-panel'); 
    if (panel) panel.classList.toggle('hidden', !e.target.checked);
});
    
    document.getElementById('sec-update-ip-btn')?.addEventListener('click', async () => {
        const ip = await getCurrentIP();
        if(ip) {
            currentSecurityState.authorizedIp = ip;
            await handleSaveStore();
            showToast('Success', 'IP Authorized for this location', 'success');
            renderSecuritySection(currentSecurityState);
        }
    });

    document.getElementById('sec-strict-mode')?.addEventListener('change', () => {
        currentSecurityState.strictMode = document.getElementById('sec-strict-mode').checked;
    });
}




// ==========================================
// 6. INITIALIZATION & EXPORTS
// ==========================================

export async function initializeUserIfNeeded(user) {
    if (!user) return 'ERROR';
    try {
        const profileRef = doc(db, 'userProfiles', user.uid);
        const profileSnap = await getDoc(profileRef);

        let profileData = {};
        if (profileSnap.exists()) {
            profileData = profileSnap.data();
            
            if (profileData.role !== 'admin') {
                if (profileData.assignedLocationId && profileData.storeId !== profileData.assignedLocationId) {
                    try {
                        await updateDoc(profileRef, { storeId: profileData.assignedLocationId });
                        window.location.reload();
                        await new Promise(() => {});
                        return 'RELOADING';
                    } catch (e) {
                        alert("Permission Error: Your account was assigned to a branch incorrectly, preventing access.\n\nPlease ask your Admin to log in to their account once to automatically fix this issue.");
                        await new Promise(() => {}); 
                    }
                }
                if (profileData.storeId || profileData.assignedLocationId) {
                    return 'READY';
                }
            } else {
                setTimeout(async () => {
                    try {
                        const storesQ = query(collection(db, `artifacts/${getAppId()}/stores`), where("ownerId", "==", user.uid));
                        const storesSnap = await getDocs(storesQ);
                        const ownedStoreIds = storesSnap.docs.map(d => d.id);
                        
                        if (ownedStoreIds.length > 0) {
                            const staffQ = query(collection(db, 'userProfiles'), where("role", "in", ["store_manager", "cashier", "accountant"]));
                            const staffSnap = await getDocs(staffQ);
                            
                            staffSnap.forEach(async (staffDoc) => {
                                const sData = staffDoc.data();
                                if (sData.assignedLocationId && sData.storeId !== sData.assignedLocationId) {
                                    if (ownedStoreIds.includes(sData.assignedLocationId) || ownedStoreIds.includes(sData.storeId)) {
                                        try {
                                            await updateDoc(staffDoc.ref, { storeId: sData.assignedLocationId });
                                        } catch(err) {}
                                    }
                                }
                            });
                        }
                    } catch (e) {}
                }, 2500);
            }
        }

        const q = query(collection(db, `artifacts/${getAppId()}/stores`), where("ownerId", "==", user.uid));
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
             const hasIncompleteStore = snapshot.docs.some(doc => {
                 const data = doc.data();
                 const hasName = data.storeName && data.storeName.trim().length > 2;
                 const hasAddress = data.address && data.address.trim().length > 4;
                 const hasTaxId = data.taxId && data.taxId.trim().length > 4;
                 return !(hasName && hasAddress && hasTaxId); 
             });

             if (hasIncompleteStore) {
                 return 'SETUP_REQUIRED'; 
             } else {
                 return 'READY';
             }
        } else {
            return 'SETUP_REQUIRED';
        }
    } catch (e) { 
        return 'ERROR'; 
    }
}

export async function createInitialStore(user, storeDetails) {
    if (!user || !storeDetails) throw new Error("Missing Data");
    
    let finalPhone = storeDetails.phone || '';
    if (finalPhone && !finalPhone.startsWith('+')) {
        finalPhone = '+91' + finalPhone;
    }

    if (!storeDetails.skipPhoneCheck && finalPhone && !finalPhone.startsWith('AUTH_')) {
        const phoneQ = query(collection(db, `artifacts/${getAppId()}/directory_merchants`), where("phone", "==", finalPhone));
        const phoneSnap = await getDocs(phoneQ);
        if (!phoneSnap.empty) {
            throw new Error("This phone number is already registered to another store.");
        }
    }
    
    storeDetails.phone = finalPhone; 

    const userProfileRef = doc(db, 'userProfiles', user.uid);
    const newMerchantId = generateMerchantId(finalPhone); 
    const storesRef = collection(db, `artifacts/${getAppId()}/stores`);
    const newStoreRef = doc(storesRef);
    const newStoreId = newStoreRef.id;

    const newStoreData = {
        ownerId: user.uid,
        merchantId: newMerchantId,
        createdAt: new Date().toISOString(),
        currency: storeDetails.currency || "INR",
        taxRate: parseFloat(storeDetails.taxRate) || 0,
        plan: "free",
        dashboardWidgets: ['revenueToday'],
        storeName: storeDetails.storeName,
        phone: storeDetails.phone,
        email: storeDetails.email,
        address: storeDetails.address,
        state: storeDetails.state,
        taxId: storeDetails.taxId
    };

    try {
        await setDoc(newStoreRef, newStoreData);

        await setDoc(doc(db, `artifacts/${getAppId()}/directory_merchants/${newMerchantId}`), {
            merchantId: newMerchantId,
            storeId: newStoreId,
            storeName: newStoreData.storeName,
            ownerId: user.uid,
            state: newStoreData.state,
            gstin: newStoreData.taxId,
            pan: storeDetails.pan || '',      
            phone: newStoreData.phone,
            email: newStoreData.email
        });

        await setDoc(doc(db, `artifacts/${getAppId()}/stores/${newStoreId}/settings/profile`), {
            storeName: newStoreData.storeName,
            phone: newStoreData.phone,
            email: newStoreData.email,
            address: newStoreData.address,
            state: newStoreData.state,
            taxId: newStoreData.taxId,
            pan: storeDetails.pan || '',      
            currency: newStoreData.currency,
            taxRate: newStoreData.taxRate,
            razorpayKeyId: storeDetails.razorpayKeyId || '',
            razorpayKeySecret: storeDetails.razorpayKeySecret || '',
            security: { enabled: false },
            createdAt: new Date().toISOString()
        });

        await setDoc(userProfileRef, {
            role: "admin", 
            storeId: newStoreId, 
            email: user.email || storeDetails.email || '', 
            name: storeDetails.adminName || user.displayName || "Admin", 
            status: "Active"
        }, { merge: true });
        
        return newStoreId;
    } catch (e) {
        throw e;
    }
}

export function populateSettingsUI(settings, user, activeView) { 
    const settingsSection = document.getElementById('settings');
    const isVisible = settingsSection && !settingsSection.classList.contains('hidden');
    const shellExists = !!document.getElementById('settings-content-wrapper');
    
    if (isVisible && shellExists) {
        refreshAllViews(user);
    } else {
        const viewToLoad = (activeView === 'settings') ? 'store' : activeView;
        loadSettingsPage(viewToLoad || 'profile'); 
    }
}

export async function handleSaveProfileStore(e) { 
    if(e) e.preventDefault(); 
    await handleSaveProfile(); 
    await handleSaveStore('main'); 
}

export async function handleSaveSettings(e) { 
    if(e) e.preventDefault(); 
    await handleSaveStore('main'); 
}
export function setupSettingsListeners() { bindEvents(); }


document.addEventListener('click', async (e) => {
    const profileBtn = e.target.closest('#profile-btn');
    const settingsBtn = e.target.closest('#settings-btn');
    const navLink = e.target.closest('a') || e.target.closest('[data-view]'); 
    
    if (profileBtn || settingsBtn) {
        e.preventDefault();
        e.stopPropagation();
        
        // Add toast alert if there are unsaved changes
        if (isProfileDirty || isStoreDirty || isWaDirty) {
            showToast('Auto-Saved', 'Unsaved changes were saved before switching views.', 'info');
        }
        await flushSettingsChanges();
        
        document.querySelectorAll('.view-section').forEach(el => {
            el.classList.remove('active', 'block');
            el.classList.add('hidden');
        });
        
        const settingsSection = document.getElementById('settings');
        if (settingsSection) {
            settingsSection.classList.remove('hidden');
            settingsSection.classList.add('active', 'block');
        }
        
        if (profileBtn) loadSettingsPage('profile');
        else loadSettingsPage('store');
        
    } else if (navLink && !navLink.closest('#settings')) {
        // Add toast alert if navigating completely away from settings
        if (isProfileDirty || isStoreDirty || isWaDirty) {
            showToast('Auto-Saved', 'Unsaved changes were saved securely before leaving.', 'info');
        }
        flushSettingsChanges(); 
    }
});

// ==========================================
// 8. WHATSAPP CONFIGURATION ENGINE
// ==========================================

export function initWhatsAppSettingsUI() {
    const radios = document.querySelectorAll('input[name="wa_mode_toggle"]');
    const customContainer = document.getElementById('custom-wa-settings-container');

    radios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'custom') {
                customContainer.classList.remove('hidden');
                customContainer.classList.add('block');
            } else {
                customContainer.classList.add('hidden');
                customContainer.classList.remove('block');
            }
        });
    });
}

export async function loadWhatsAppSettings() {
    const storeId = currentStoreId || (typeof getStoreId === 'function' ? getStoreId() : primaryStoreId);
    if (!storeId) return;

    try {
        const secretsRef = doc(db, `artifacts/${getAppId()}/stores/${storeId}/settings/secrets`);
        const snap = await getDoc(secretsRef);
        
        let mode = 'managed'; 

        if (snap.exists()) {
            const data = snap.data();
            if (data.wa_mode) mode = data.wa_mode;
            
            if (data.wa_phone_id) document.getElementById('custom_wa_phone_id').value = data.wa_phone_id;
            if (data.wa_token) document.getElementById('custom_wa_token').value = data.wa_token;
        }

        const selectedRadio = document.querySelector(`input[name="wa_mode_toggle"][value="${mode}"]`);
        if (selectedRadio) {
            selectedRadio.checked = true;
            selectedRadio.dispatchEvent(new Event('change'));
        }

        const waInputs = document.querySelectorAll('#custom_wa_phone_id, #custom_wa_token');
        waInputs.forEach(input => {
            input.addEventListener('input', () => { isWaDirty = true; updateSaveIndicator('wa', 'Unsaved', 'amber'); });
        });

        const radios = document.querySelectorAll('input[name="wa_mode_toggle"]');
        radios.forEach(r => r.addEventListener('change', () => { isWaDirty = true; updateSaveIndicator('wa', 'Unsaved', 'amber'); }));
    } catch (error) {
        if (error.code === 'permission-denied') {
            const waSection = document.getElementById('custom-wa-settings-container')?.closest('.bg-white.rounded-2xl');
            if (waSection) waSection.style.display = 'none';
        } else {
            console.warn("Could not load WhatsApp settings:", error);
        }
    }
}

async function saveWhatsAppSettings(e) {
    if(e) e.preventDefault();
    const storeId = currentStoreId || (typeof getStoreId === 'function' ? getStoreId() : primaryStoreId);
    if (!storeId) return;

    const selectedRadio = document.querySelector('input[name="wa_mode_toggle"]:checked');
    const selectedMode = selectedRadio ? selectedRadio.value : 'managed';
    
    const settingsData = {
        wa_mode: selectedMode,
        updatedAt: new Date().toISOString()
    };

    if (selectedMode === 'custom') {
        const phoneId = document.getElementById('custom_wa_phone_id').value.trim();
        const token = document.getElementById('custom_wa_token').value.trim();
        
        if (!phoneId || !token) return;
        
        settingsData.wa_phone_id = phoneId;
        settingsData.wa_token = token;
    }

    try {
        const secretsRef = doc(db, `artifacts/${getAppId()}/stores/${storeId}/settings/secrets`);
        await setDoc(secretsRef, settingsData, { merge: true });
    } catch (error) {
        console.error("WhatsApp Save failed:", error);
    }
}
// export async function autoDetectPrinters() {
//     if (!window.electronAPI || typeof window.electronAPI.getPrinters !== 'function') {
//         console.warn("Auto-detect requires the Electron desktop app.");
//         return [];
//     }

//     try {
//         const printers = await window.electronAPI.getPrinters();
//         return printers || [];
//     } catch (e) {
//         console.error("Failed to fetch printers from Electron IPC:", e);
//         return [];
//     }
// }