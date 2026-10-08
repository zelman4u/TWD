-- =====================================================================
-- Tagoloan Water District (TWD) Municipal Water Utility System
-- Relational Database Schema (MySQL / PostgreSQL compatible)
-- =====================================================================

-- 1. Barangays & Service Zones
CREATE TABLE IF NOT EXISTS barangays (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    code VARCHAR(20) NOT NULL,
    active_connections INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. System Users & Staff Accounts
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(150) NOT NULL,
    role ENUM('admin', 'meter_reader', 'billing_officer', 'consumer') NOT NULL,
    status ENUM('active', 'inactive', 'suspended', 'pending') DEFAULT 'active',
    contact_number VARCHAR(20),
    assigned_zone VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 3. Consumers (Master Account Ledger)
CREATE TABLE IF NOT EXISTS consumers (
    account_number VARCHAR(30) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    address TEXT NOT NULL,
    barangay_id VARCHAR(50) REFERENCES barangays(id),
    barangay VARCHAR(100) NOT NULL,
    sitio_zone VARCHAR(100),
    contact_number VARCHAR(20),
    email VARCHAR(100),
    meter_number VARCHAR(50) NOT NULL UNIQUE,
    consumer_type ENUM('Residential', 'Commercial', 'Institutional') DEFAULT 'Residential',
    meter_size VARCHAR(20) DEFAULT '1/2"',
    status ENUM('active', 'disconnected', 'pending', 'temporary_cutoff', 'Disconnection Notice') DEFAULT 'active',
    rfid_tag VARCHAR(50) UNIQUE,
    qr_code VARCHAR(100),
    registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    linked_user_id VARCHAR(50) REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 4. Water Meters Physical Assets
CREATE TABLE IF NOT EXISTS water_meters (
    id VARCHAR(50) PRIMARY KEY,
    meter_number VARCHAR(50) NOT NULL UNIQUE,
    account_number VARCHAR(30) REFERENCES consumers(account_number),
    brand VARCHAR(100) DEFAULT 'Kent / Elster',
    pipe_size VARCHAR(20) DEFAULT '1/2"',
    status ENUM('active', 'damaged', 'maintenance', 'unassigned') DEFAULT 'active',
    last_reading DECIMAL(10, 2) DEFAULT 0.00,
    last_reading_date DATE,
    installed_at DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Meter Readings & Telemetry
CREATE TABLE IF NOT EXISTS meter_readings (
    id VARCHAR(50) PRIMARY KEY,
    account_number VARCHAR(30) NOT NULL REFERENCES consumers(account_number),
    meter_number VARCHAR(50) NOT NULL,
    reader_id VARCHAR(50) REFERENCES users(id),
    reader_name VARCHAR(150),
    billing_period VARCHAR(20) NOT NULL, -- e.g. '2026-10'
    previous_reading DECIMAL(10, 2) NOT NULL,
    current_reading DECIMAL(10, 2) NOT NULL,
    consumption DECIMAL(10, 2) NOT NULL,
    photo_url TEXT,
    gps_latitude DECIMAL(10, 8),
    gps_longitude DECIMAL(11, 8),
    status ENUM('pending_verification', 'verified', 'rejected') DEFAULT 'pending_verification',
    reading_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Billing Statements & Invoices
CREATE TABLE IF NOT EXISTS billing_statements (
    id VARCHAR(50) PRIMARY KEY,
    reading_id VARCHAR(50) REFERENCES meter_readings(id),
    account_number VARCHAR(30) NOT NULL REFERENCES consumers(account_number),
    billing_month VARCHAR(20) NOT NULL,
    period_from DATE NOT NULL,
    period_to DATE NOT NULL,
    due_date DATE NOT NULL,
    disconnection_date DATE NOT NULL,
    previous_reading DECIMAL(10, 2) NOT NULL,
    current_reading DECIMAL(10, 2) NOT NULL,
    cubic_meters_used DECIMAL(10, 2) NOT NULL,
    basic_charge DECIMAL(10, 2) NOT NULL,
    franchise_tax DECIMAL(10, 2) DEFAULT 0.00,
    maintenance_fee DECIMAL(10, 2) DEFAULT 10.00,
    surcharge DECIMAL(10, 2) DEFAULT 0.00,
    total_amount DECIMAL(10, 2) NOT NULL,
    amount_paid DECIMAL(10, 2) DEFAULT 0.00,
    payment_status ENUM('unpaid', 'partially_paid', 'paid', 'overdue') DEFAULT 'unpaid',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Payment Transactions & Receipts
CREATE TABLE IF NOT EXISTS payment_records (
    id VARCHAR(50) PRIMARY KEY,
    bill_id VARCHAR(50) REFERENCES billing_statements(id),
    account_number VARCHAR(30) NOT NULL REFERENCES consumers(account_number),
    or_number VARCHAR(50) NOT NULL UNIQUE, -- Official Receipt Number
    amount DECIMAL(10, 2) NOT NULL,
    payment_method ENUM('Cash', 'GCash', 'Maya', 'Bank Transfer', 'Bayad Center') DEFAULT 'Cash',
    collector_id VARCHAR(50) REFERENCES users(id),
    payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    receipt_photo_url TEXT,
    notes TEXT
);

-- 8. Disconnection & Grace Period Alerts
CREATE TABLE IF NOT EXISTS disconnection_alerts (
    id VARCHAR(50) PRIMARY KEY,
    account_number VARCHAR(30) NOT NULL REFERENCES consumers(account_number),
    unpaid_cycles INT DEFAULT 0,
    total_overdue DECIMAL(10, 2) NOT NULL,
    notice_served_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    grace_period_expiry DATE NOT NULL,
    status ENUM('active_notice', 'resolved_by_payment', 'disconnected') DEFAULT 'active_notice'
);
