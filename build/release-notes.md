### 🚀 What's New 

**New Features & Enhancements**
* **Advanced Partial Returns:** Replaced the "Full Refund" button with an interactive Partial Return system. You can now select specific items and exact quantities to return. The system automatically restocks the items, calculates the refund, and adjusts the customer's pending dues (Udhaar).
* **Customer Savings Display:** The POS now calculates the difference between the MRP and your Selling Price. The total amount the customer saved is now prominently displayed in a green banner on the checkout screen and printed securely on the thermal receipt.
* **Smart Inventory Discount Toggles:** Added sleek **% / ₹** sliding toggles for Scheme Discounts, RS Discounts, and overall Product Discounts. Typing in these fields now live-calculates the final Selling Price instantly.
* **Modernized Tax Toggles:** Upgraded the "Tax Inclusive" checkbox into a clear, modern pill toggle (`+ TAX` vs `INCL`) so its function is unmistakable.
* **Cleaner Inventory Layout:** Overhauled the "Purchase Invoice & Tax Breakdown" grid. It now uses a much cleaner two-row layout that gives inputs room to breathe without squishing or breaking tooltips.

**Bug Fixes & Optimizations**
* **Convenience Fee Math:** Fixed a critical bug where the POS Convenience Fee was being added as a flat currency amount (e.g., ₹5) instead of a percentage (5%).
* **Live Catalog Sync:** Fixed the "stale cache" bug. Newly added inventory items now instantly appear in the POS catalog and bundle builder without requiring you to reload the app.
* **Silent Printing & PDF Fallbacks:** Fixed an invisible crash that forced the "Save as PDF" dialog to appear. The app will now successfully print silently, and will explicitly warn you if your Windows/Mac default printer is accidentally set to PDF.
* **Receipt Formatting:** Fixed HTML injection issues that caused the receipt printer to crash or fail to display the "You Saved" amount.
* **Performance Boost:** Silenced background Chromium GPU errors ("Invalid mailbox") by cleanly disabling hardware acceleration for background printing processes.
* **Production Polish:** The Developer Tools (Console) will no longer automatically pop open when users launch the packaged app.