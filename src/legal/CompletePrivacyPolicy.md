# Mifela POS Privacy Policy - GDPR & DPPDP Compliant

**Effective Date:** March 30, 2026  
**Last Updated:** November 12, 2026  
**Controller:** Mifela Solutions  
**Contact:** privacy@mifela.com

## 1. Who We Are

Mifela Solutions provides a Point of Sale (POS) and Inventory Management system for retail businesses. Our software is installed locally on merchant premises (Electron desktop application) with optional cloud synchronization features.

## 2. What Personal Data We Collect

We collect and process the following categories of personal data:

### 2.1 Merchant-Provided Data (Direct Collection)
- **Business Identity**: Store name, business address, GST/TIN number, PAN
- **Owner/Admin**: Full name, email address, phone number
- **Payment Information**: Razorpay payment tokens (transient, never stored long-term)
- **Hardware Fingerprint**: Device identifiers for license binding

### 2.2 Transaction Data (Generated Through Use)
- **Sales Records**: Transaction timestamps, item descriptions, amounts, taxes
- **Inventory Data**: Product names, SKUs, pricing, stock levels
- **Customer Data** (when captured): Names, phone numbers, email addresses
- **Employee/Staff Data**: Names, roles, contact information (for payroll)
- **Cheque Records**: Bank details, cheque numbers (for clearance processing)

### 2.3 Cloud-Synced Data (Optional)
- **Provisioned Node Metadata**: Store details, hardware fingerprint, payment status
- **License Activation Data**: Necessary for software verification
- **Telemetry** (opt-in): Usage statistics for product improvement

## 3. How We Use Your Data

### 3.1 Primary Purposes
- **Software Operation**: License verification, security enforcement, update delivery
- **Transaction Processing**: Sales recording, inventory management, tax calculation
- **Payment Processing**: Integration with Razorpay for subscription and payment gateway
- **Security**: Hardware binding, anti-piracy measures, breach detection
- **Product Improvement** (opt-in): Usage analytics to improve user experience

### 3.2 Legal Bases (GDPR Article 6)
- **Contract Performance**: Processing necessary for the POS software contract
- **Legal Obligations**: Tax reporting, financial record-keeping requirements
- **Legitimate Interests**: Fraud prevention, security maintenance, product improvement
- **Consent**: Marketing communications, optional feature enhancement

### 3.3 Purpose Limitation
Data is used solely for the purposes disclosed at collection. We do not repurpose data for unrelated objectives.

## 4. Data Recipients & Sharing

### 4.1 Internal Recipients
- Mifela Solutions development and support teams
- Authorized personnel for license and payment verification

### 4.2 Third-Party Processors
- **Razorpay**: Payment gateway integration (payment processing only)
- **Google Firebase**: Cloud Firestore for license provisioning and node metadata
- **Cloud Functions**: License verification challenges and validation

### 4.3 Legal & Regulatory
- Authorities as required by applicable law (tax, financial reporting)
- Law enforcement with valid legal process

### 4.4 International Transfers
- Data processed within India (primary)
- Cloud services located in Asia-Pacific region
- Adequacy measures: Standard Contractual Clauses where applicable

## 5. Data Retention Periods

| Data Type | Retention Period | Legal Basis |
|-----------|-----------------|-------------|
| **License/Vault Data** | Until account deletion or 5 years after last activity | Contract + Legal Obligation |
| **Transaction Records** | 7 years (tax compliance) | Legal Obligation |
| **Customer Records** | Until withdrawal consent + 3 years | Consent + Legal Obligation |
| **Payment Tokens** | Until transaction completes + 30 days | Contract + Legal Obligation |
| **Hardware Fingerprints** | Indefinite (for license binding) | Contract |
| **Telemetry Data** | 2 years or until withdrawal | Consent |
| **Cloud Node Metadata** | Until node unprovisioning + 1 year | Contract |

## 6. Your Data Subject Rights

### 6.1 Right to Access
You may request a copy of all personal data we process about you. Submit requests to privacy@mifela.com within 30 days.

### 6.2 Right to Rectification
You may request correction of inaccurate or incomplete personal data. We will respond within 30 days.

### 6.3 Right to Erasure ("Right to be Forgotten")
You may request deletion of your personal data, except where we have legal obligations to retain data (tax records, audit trails).

### 6.4 Right to Restrict Processing
You may request restriction of data processing in specific circumstances (disputes, accuracy challenges).

### 6.5 Right to Data Portability
You may request your data in a structured, commonly used format for transfer to another controller.

### 6.6 Right to Object
You may object to processing based on legitimate interests, direct marketing, or profiling.

### 6.7 Rights Related to Automated Decision-Making
Our system includes some automated verification (license checks), but no solely automated decisions affecting legal rights.

## 7. Consent Management

### 7.1 Types of Consent Collected
- **Functional Consent**: Required for software operation
- **Analytics Consent** (opt-in): Usage statistics for product improvement
- **Marketing Consent** (opt-in): Promotional communications
- **Data Processing Consent**: Required at setup (mandatory)

### 7.2 Consent Mechanism
At initial setup, merchants must check an explicit consent checkbox:
- Must be unchecked by default
- Must have granular options
- Must include link to full privacy policy
- Must include version/timestamp tracking

### 7.3 Withdrawing Consent
- Withdrawal mechanism available in settings
- Consent status auditable with full history
- No punitive effects for withdrawal
- Functional consent withdrawal may limit some features

### 7.4 Consent Records
Each consent record includes:
- Timestamp of grant/withdrawal
- Version of privacy policy at time of consent
- Specific consent types granted
- Merchant identifier
- Audit trail

## 8. Data Security Measures

### 8.1 Technical Safeguards
- **AES-256 Encryption**: Local vault storage (SYS_VAULT)
- **Hardware Binding**: Fingerprint-based license enforcement
- **Secure Token Transmission**: Razorpay payment tokens only
- **SHA-256 Hashing**: Passwords and recovery pins
- **Transport Layer**: TLS 1.2+ for all external communications
- **Electron Security**: nodeIntegration disabled, contextIsolation enabled

### 8.2 Organizational Safeguards
- Access controls on all systems
- Regular security audits
- Employee training on data protection
- Incident response procedures

### 8.3 Data Breach Protocol
- **72-Hour Notification**: To relevant authorities where required
- **72-Hour Notification**: To affected data subjects where high risk
- **Incident Investigation**: Root cause analysis
- **Remediation**: Technical and organizational measures

## 9. Cookies & Tracking

Our web interface uses essential cookies only for:
- Session management during setup
- Preference retention
- No advertising or tracking cookies

## 10. Children's Data

Our software is designed for business use (18+). We knowingly do not collect data from children under 16.

## 11. Changes to This Policy

We may update this privacy policy. Material changes will be:
- Posted with updated effective date
- Notified within the application
- Require re-consent if processing purposes change significantly

## 12. Contact Information

**Data Protection Officer (DPO):**  
Mifela Solutions  
privacy@mifela.com  
Data Protection Compliance Line: +91-XXXX-XXXXXXX

**For GDPR/DPDP Rights Requests:**  
Submit via: privacy@mifela.com  
Expected response: Within 30 days

---
*Note: This policy is a living document and must be reviewed annually or upon significant changes to data processing activities.*

---
**India Digital Personal Data Protection Act, 2023 Compliance:**  
This policy also complies with India's DPP Act, 2023, including data principal rights, data fiduciary obligations, and the requirement for verifiable parental consent where applicable.

**EU GDPR Compliance:**  
This policy also complies with Regulation (EU) 2016/679, including data subject rights, lawful bases, and cross-border transfer mechanisms.