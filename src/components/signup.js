// src/components/signup.js
import { DOM, showModal, showToast } from '../utils/dom.js';
import { getStoreId, getUserId, setStoreAndUserRefs } from '../store/state.js';
import { loadInventoryPage } from '../components/inventory.js';

// Wait for DOM to be ready, then initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Check if user is already logged in and has an active license
  const storedUser = localStorage.getItem('mifela_local_user');
  const storedStore = localStorage.getItem('mifela_active_store');

  if (storedUser && storedStore) {
    // User is already licensed - redirect to dashboard
    loadInventoryPage();
    return;
  }

  // Check if user is logged in via Firebase but license is pending
  const isLoggedIn = storedUser || localStorage.getItem('mifela_user_session');

  if (isLoggedIn) {
    // User exists but license is pending - show activation screen
    showActivationScreen();
    return;
  }

  // Show signup onboarding flow
  showSignupScreen();
});

/**
 * Show signup onboarding flow
 */
function showSignupScreen() {
  const container = document.getElementById('app-content');
  if (!container) return;

  container.innerHTML = `
    <div id="signup-overlay" class="fixed inset-0 bg-slate-900/95 backdrop-blur-xl z-50 flex items-center justify-center p-6 animate-fadeIn">
      <div class="bg-white dark:bg-slate-900 rounded-3xl p-8 max-w-md w-full shadow-2xl border border-slate-200 dark:border-slate-700">
        <div class="flex items-center justify-between mb-8">
          <div>
            <h1 class="text-3xl font-black tracking-tight text-sky-300">mifela<span class="text-sky-200">.</span></h1>
            <p class="text-slate-500 text-sm">One-Time Payment Required</p>
          </div>
          <button id="signup-close-btn" class="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18:6M6 6l12:12"></path></svg>
          </button>
        </div>

        <form id="signup-form" class="space-y-6">
          <div>
            <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Store Name *</label>
            <input type="text" id="signup-store-name" required
                   class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-3 rounded-xl font-bold text-slate-800 focus:border-SLATE-500 outline-none transition-colors">
          </div>

          <div>
            <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Owner Name *</label>
            <input type="text" id="signup-owner-name" required
                   class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-3 rounded-xl font-bold text-slate-800 focus:border-SLATE-500 outline-none transition-colors">
          </div>

          <div>
            <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Business Email *</label>
            <input type="email" id="signup-email" required
                   class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-3 rounded-xl font-bold text-slate-800 focus:border-SLATE-500 outline-none transition-colors">
          </div>

          <div>
            <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Business Phone *</label>
            <input type="tel" id="signup-phone" required
                   class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-3 rounded-xl font-bold text-slate-800 focus:border-SLATE-500 outline-none transition-colors">
          </div>

          <div>
            <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Password *</label>
            <input type="password" id="signup-password" required
                   class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-3 rounded-xl font-bold text-slate-800 focus:border-SLATE-500 outline-none transition-colors">
          </div>

          <div id="signup-error" class="hidden p-3 rounded-xl border-red-500/20 text-red-400 text-sm mb-4">
            <svg class="w-4 h-4 shrink-0 float-left mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.86c2.17 0 3.502 1.435 3.502 3.005 0 1.568-.963 3.005-3.502 3.005H9.999a3.005 3.005 0 01-3.502-3.005C3.003 15.435 3.5 13.974 3.5 12.5 3.5 11.474 5.49 9 9.999 9 15c2.73 0 5.222 1.16 7 2.905a3.547 3.547 0 005.378 1.406zM4.273 5.238a6 6 0 1110.03 0 6 6 0 01-10.03 0zM9.88 18a3 3 0 115.66-2.19 3 3 0 00-5.66 2.19z"></path></svg>
            <span id="signup-error-text"></span>
          </div>
        </form>

        <div id="payment-screen" class="hidden mt-8">
          <p class="text-slate-500 mb-4">Account created pending ₹25,000 license activation.</p>
          <p class="text-slate-400 text-sm">One-time payment to activate GOLD plan (lifetime license).</p>
          <button id="pay-razorpay-btn" class="w-full bg-SLATE-600 hover:bg-SLATE-700 text-white font-black py-3 rounded-xl shadow-lg transition-all active:scale-95 text-sm uppercase tracking-widest">
            Pay ₹25,000 & Activate License
          </button>
        </div>
      </div>
    </div>
  `;

  // Handle form submission
  const form = document.getElementById('signup-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const storeName = document.getElementById('signup-store-name').value.trim();
      const ownerName = document.getElementById('signup-owner-name').value.trim();
      const email = document.getElementById('signup-email').value.trim();
      const phone = document.getElementById('signup-phone').value.trim();
      const password = document.getElementById('signup-password').value.trim();

      // Show loading state
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<svg class="animate-spin w-4 h-4 mr-2" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Creating Account...';
      }

      try {
        // 1. Create Firebase Auth user
        const credential = await window.firebase.auth().createUserWithEmailAndPassword(email, password);

        // 2. Create pending_payment document in Firestore
        const storeId = 'STORE-' + Math.random().toString(36).substring(2, 8).toUpperCase();

        // TODO: Write to Firestore: { uid: credential.user.uid, storeId, status: 'pending_payment', plan: 'GOLD' }
        // For now, simulate with localStorage
        const pendingData = {
          uid: credential.user.uid,
          storeId,
          status: 'pending_payment',
          plan: 'GOLD',
          ownerName,
          email,
          phone,
          createdAt: new Date().toISOString()
        };
        localStorage.setItem('mifela_pending_account', JSON.stringify(pendingData));

        // Transition to payment screen
        showPaymentScreen();
      } catch (error) {
        console.error("Signup failed:", error);
        const errorEl = document.getElementById('signup-error');
        const errorText = document.getElementById('signup-error-text');
        if (errorEl && errorText) {
          errorEl.classList.remove('hidden');
          errorText.textContent = error.message || 'Signup failed. Please try again.';
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = 'Create Account';
        }
      }
    });
  }

  // Handle close button
  const closeBtn = document.getElementById('signup-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const overlay = document.getElementById('signup-overlay');
      if (overlay) overlay.remove();
    });
  }

  // Handle payment button
  const payBtn = document.getElementById('pay-razorpay-btn');
  if (payBtn) {
    payBtn.addEventListener('click', () => showPaymentScreen());
  }
}

/**
 * Show payment screen (₹25,000 Razorpay)
 */
function showPaymentScreen() {
  const overlay = document.getElementById('signup-overlay');
  if (!overlay) return;

  // Hide signup form, show payment screen
  const formSection = overlay.querySelector('form');
  if (formSection) formSection.classList.add('hidden');

  const paymentSection = overlay.querySelector('#payment-screen');
  if (paymentSection) paymentSection.classList.remove('hidden');

  // Initialize Razorpay Checkout
  setTimeout(() => {
    loadRazorpayScript();
  }, 100);
}

/**
 * Load Razorpay SDK lazily
 */
function loadRazorpayScript() {
  // Check if already loaded
  if (window.Razorpay) {
    initRazorpayCheckout();
    return;
  }

  const script = document.createElement('script');
  script.src = 'https://checkout.razorpay.com/v1/checkout.js';
  script.async = true;
  script.onload = initRazorpayCheckout;
  script.onerror = () => {
    showToast('Error', 'Failed to load Razorpay SDK. Please check internet connection.', 'error');
  };
  document.head.appendChild(script);
}

/**
 * Initialize Razorpay Checkout
 * Requests an order_id from the backend createRazorpayOrder Cloud Function
 * before opening the Razorpay checkout.
 */
async function initRazorpayCheckout() {
  const overlay = document.getElementById('signup-overlay');
  if (!overlay) return;

  // Get pending account data
  const pendingData = JSON.parse(localStorage.getItem('mifela_pending_account') || '{}');
  if (!pendingData.uid) {
    showToast('Error', 'Account not properly created. Please start over.', 'error');
    return;
  }

  // Request order_id from backend (never create order client-side)
  let orderId;
  try {
    const resp = await fetch('https://asia-south1-mifela-pos-sqlite.cloudfunctions.net/createRazorpayOrder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: pendingData.uid,
        storeId: pendingData.storeId,
        amount: 2500000, // ₹25,000 in paise
        currency: 'INR',
        receipt: `receipt_${pendingData.storeId}`,
        notes: { uid: pendingData.uid, storeId: pendingData.storeId, plan: 'GOLD' },
      }),
    });
    if (!resp.ok) throw new Error('Failed to create Razorpay order');
    const data = await resp.json();
    orderId = data.orderId;
    if (!orderId) throw new Error('No orderId returned');
  } catch (e) {
    console.error('Razorpay order creation failed:', e);
    showToast('Error', 'Could not start payment. Please try again.', 'error');
    return;
  }

  const razorpayOptions = {
    key: window.RAZORPAY_KEY_ID || '', // Public key only — provided by app config/env
    amount: 2500000, // ₹25,000 in paise
    currency: 'INR',
    name: 'mifela POS',
    description: 'GOLD License Activation - One-Time Payment',
    order_id: orderId,
    handler: async function (response) {
      await handleRazorpayPayment(response);
    },
    prefill: {
      name: pendingData.ownerName || 'Store Owner',
      email: pendingData.email,
      contact: pendingData.phone
    },
    notes: {
      storeId: pendingData.storeId,
      plan: 'GOLD'
    },
    theme: {
      color: '#F37254'
    }
  };

  // Open Razorpay checkout
  try {
    const rzp = new window.Razorpay(razorpayOptions);
    rzp.open();
  } catch (e) {
    showToast('Error', 'Could not initialize Razorpay. Please try again.', 'error');
  }
}

/**
 * Handle Razorpay payment success
 */
async function handleRazorpayPayment(razorpayResponse) {
  const overlay = document.getElementById('signup-overlay');
  if (!overlay) return;

  // Show verification state
  const paymentSection = document.getElementById('payment-section');
  if (paymentSection) paymentSection.innerHTML = `
    <div class="p-6 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700">
      <div class="flex items-center justify-between">
        <span class="text-slate-400 text-sm">Verifying payment & generating license...</span>
        <svg class="w-5 h-5 animate-spin opacity-75" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"/></svg>
      </div>
    </div>
  `;

  // Disable the overlay to prevent duplicate clicks
  overlay.style.pointerEvents = 'none';

  try {
    // 1. Verify payment with backend Cloud Function
    // const verificationResult = await verifyRazorpayPayment(razorpayResponse);

    // 2. For now, simulate successful verification
    // In production, this would call: window.electronAPI.provisionSecurity()

    // Generate license key
    const licenseKey = generateLicenseKey();

    // Save license data locally
    const licenseData = {
      licenseKey,
      status: 'active',
      uid: pendingData.uid,
      storeId: pendingData.storeId,
      plan: 'GOLD',
      createdAt: new Date().toISOString(),
      activatedAt: new Date().toISOString()
    };
    localStorage.setItem('mifela_license', JSON.stringify(licenseData));

    // Set user session
    const userSession = {
      uid: pendingData.uid,
      email: pendingData.email,
      storeName: pendingData.storeName,
      role: 'admin',
      plan: 'GOLD'
    };
    localStorage.setItem('mifela_local_user', JSON.stringify(userSession));
    localStorage.setItem('mifela_active_store', pendingData.storeId);
    localStorage.setItem('mifela_active_user', pendingData.uid);
    localStorage.setItem('mifela_user_session', JSON.stringify(userSession));

    // Show license generated screen
    setTimeout(() => {
      overlay.innerHTML = `
        <div class="p-8 text-center animate-fadeIn">
          <div class="w-20 h-20 rounded-full bg-SLATE-500 mx-auto my-4 flex items-center justify-center">
            <svg class="w-10 h-10 text-SLATE-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a2 2 0 00-2-2H5a2 2 0 00-2 2v4m0 0v2m3.5-3.5a2.5 2.5 0 110 5H12"></path></svg>
          </div>
          <h2 class="text-2xl font-black tracking-tight text-sky-300 mb-2">License Generated!</h2>
          <p class="text-slate-500 mb-6">Your GOLD license is now active.</p>

          <div class="bg-slate-100 dark:bg-slate-800 rounded-xl p-6 max-w-md mx-auto mb-8">
            <h3 class="font-black text-slate-600 text-sm mb-3">License Key</h3>
            <p class="font-mono text-2xl font-bold text-SLATE-600 break-all" id="license-key-display">MIFELA-XXXX-XXXX-XXXX</p>
            <button id="copy-license-btn" class="w-full mt-3 bg-slate-200 dark:bg-slate-700 text-slate-700 py-2 rounded-xl text-sm font-medium uppercase transition-colors hover:bg-slate-300 dark:hover:bg-slate-600">
              Copy License Key
            </button>
          </div>

          <button id="launch-dashboard-btn" class="w-full bg-SLATE-600 hover:bg-SLATE-700 text-white font-black py-3 rounded-xl shadow-lg transition-all active:scale-95 text-sm uppercase tracking-widest">
            Launch POS Dashboard
          </button>
        </div>
      `;
    }, 2000);

    // Handle license key copy
    const copyBtn = document.getElementById('copy-license-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const keyDisplay = document.getElementById('license-key-display');
        if (keyDisplay) {
          navigator.clipboard.writeText(keyDisplay.textContent).then(() => {
            showToast('Success', 'License key copied to clipboard', 'success');
          });
        }
      });
    }

    // Handle dashboard launch
    const dashboardBtn = document.getElementById('launch-dashboard-btn');
    if (dashboardBtn) {
      dashboardBtn.addEventListener('click', () => {
        // Navigate to POS dashboard
        window.location.hash = '#dashboard';
        // In a real app, would use router
        overlay.remove();
        // Initialize the app
        document.dispatchEvent(new CustomEvent('mifela:onboard-complete'));
      });
    }

  } catch (error) {
    console.error("License generation failed:", error);
    showToast('Error', 'Failed to generate license. Please contact support.', 'error');
    // Reset to payment screen
    const overlay = document.getElementById('signup-overlay');
    if (overlay) {
      const formSection = overlay.querySelector('form');
      if (formSection) formSection.classList.remove('hidden');
      const paymentSection = overlay.querySelector('#payment-section');
      if (paymentSection) paymentSection.classList.add('hidden');
      overlay.style.pointerEvents = 'auto';
    }
  }
}

/**
 * Generate a license key (MIFELA-XXXX-XXXX-XXXX format)
 */
function generateLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid ambiguous chars
  const part1 = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const part2 = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const part3 = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `MIFELA-${part1}-${part2}-${part3}`;
}

/**
 * Show activation screen for users with pending license
 */
function showActivationScreen() {
  const container = document.getElementById('app-content');
  if (!container) return;

  container.innerHTML = `
    <div class="fixed inset-0 bg-slate-900/95 backdrop-blur-xl z-50 flex items-center justify-center p-6 animate-fadeIn">
      <div class="bg-white dark:bg-slate-900 rounded-3xl p-8 max-w-md w-full shadow-2xl border border-slate-200 dark:border-slate-700">
        <div class="flex items-center justify-between mb-8">
          <div>
            <h1 class="text-3xl font-black tracking-tight text-sky-300">mifela<span class="text-sky-200">.</span></h1>
            <p class="text-slate-500 text-sm">License Required</p>
          </div>
          <button id="activation-close-btn" class="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18:6M6:6l12:12"></path></svg>
          </button>
        </div>

        <div class="space-y-6">
          <p class="text-slate-500 text-sm">Your store account exists but license activation is required.</p>

          <p class="text-slate-400 text-sm mb-6">To activate your GOLD lifetime license, complete the ₹25,000 one-time payment.</p>

          <div id="activation-payment-section">
            <!-- Will be populated by showPaymentScreen -->
          </div>

          <p class="text-slate-400 text-sm">Or enter an existing license key below:</p>

          <div class="border rounded-xl p-4 mb-6" id="enter-license-section">
            <input type="text" id="enter-license-key" class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-3 rounded-xl font-bold text-slate-800 focus:border-SLATE-500 outline-none transition-colors" placeholder="MIFELA-XXXX-XXXX-XXXX">
            <button id="activate-license-btn" class="w-full mt-3 bg-SLATE-600 hover:bg-SLATE-700 text-white font-black py-3 rounded-xl shadow-lg transition-all active:scale-95 text-sm uppercase tracking-widest">
              Activate License
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Handle license key activation
  const activateBtn = document.getElementById('activate-license-btn');
  if (activateBtn) {
    activateBtn.addEventListener('click', async () => {
      const licenseKey = document.getElementById('enter-license-key').value.trim();
      if (!licenseKey) {
        showToast('Error', 'Please enter a license key', 'error');
        return;
      }

      // Verify license key (simulated)
      // In production: call verifyNodeActivation cloud function
      if (licenseKey.startsWith('MIFELA-') && licenseKey.split('-').length === 4) {
        // Simulate successful activation
        const licenseData = {
          licenseKey,
          status: 'active',
          uid: 'pending_user',
          storeId: 'STORE-PENDING',
          plan: 'GOLD',
          createdAt: new Date().toISOString(),
          activatedAt: new Date().toISOString()
        };
        localStorage.setItem('mifela_license', JSON.stringify(licenseData));
        localStorage.setItem('mifela_local_user', JSON.stringify({
          uid: 'pending_user',
          email: 'local@mifela.com',
          storeName: 'Pending Store',
          role: 'admin',
          plan: 'GOLD'
        }));
        localStorage.setItem('mifela_active_store', 'STORE-PENDING');
        localStorage.setItem('mifela_active_user', 'pending_user');
        localStorage.setItem('mifela_user_session', JSON.stringify({
          uid: 'pending_user',
          email: 'local@mifela.com',
          storeName: 'Pending Store',
          role: 'admin',
          plan: 'GOLD'
        }));

        // Redirect to dashboard
        setTimeout(() => {
          window.location.hash = '#dashboard';
          overlay.remove();
        }, 500);
      } else {
        showToast('Error', 'Invalid license key format', 'error');
      }
    });
  }

  // Handle entering new license key
  const licenseInput = document.getElementById('enter-license-key');
  if (licenseInput) {
    licenseInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        if (activateBtn) activateBtn.click();
      });
  });
}

// Handle close button
const closeBtn = document.getElementById('activation-close-btn');
if (closeBtn) {
  closeBtn.addEventListener('click', () => {
    const actOverlay = document.getElementById('signup-overlay');
    if (actOverlay) actOverlay.remove();
  });
}
}

/**
 * Initialize the app after onboarding
 */
function initApp() {
  // Dispatch event that onboarding is complete
  document.dispatchEvent(new CustomEvent('mifela:onboard-complete'));
}

// Initialize on page load
initApp();