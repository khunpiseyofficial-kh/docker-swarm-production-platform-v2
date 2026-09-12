-- =============================================================================
-- schema.sql — Production-like E-Commerce MariaDB Schema & Seed Data
-- =============================================================================

CREATE DATABASE IF NOT EXISTS shopdb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE shopdb;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('customer', 'admin') DEFAULT 'customer',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Products Table
CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  category VARCHAR(50) NOT NULL,
  image_url VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Orders Table
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  status ENUM('pending', 'paid', 'shipped', 'delivered', 'cancelled') DEFAULT 'paid',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Order Items Table
CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed Initial Admin & Demo User (bcrypt hash for 'Password123!')
-- $2a$10$wE44sK9m68z5q1Z5NnBVOe45aM3qL4r6B4K5l5S7R5q3R3m5Q5m2
INSERT IGNORE INTO users (id, username, email, password_hash, role) VALUES
(1, 'admin', 'admin@shop.local', '$2a$10$3zR1P3V7U4K4n0E1s2d3n.H6t4Y3e5Q6q1w2e3r4t5y6u7i8o9p0', 'admin'),
(2, 'devops_engineer', 'devops@shop.local', '$2a$10$3zR1P3V7U4K4n0E1s2d3n.H6t4Y3e5Q6q1w2e3r4t5y6u7i8o9p0', 'customer');

-- Seed Catalog Products
INSERT IGNORE INTO products (id, name, description, price, stock, category, image_url) VALUES
(1, 'Cloud Native Mechanical Keyboard', 'Custom 75% hot-swappable keyboard with lubricated linear switches, RGB backlighting, and CNC aluminum case.', 189.99, 45, 'Peripherals', 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=600&q=80'),
(2, 'UltraWide Curved Monitor 34"', 'WQHD 3440x1440 144Hz HDR400 display with USB-C 90W power delivery and integrated KVM switch.', 549.50, 20, 'Displays', 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=600&q=80'),
(3, 'Swarm Operator Wireless Mouse', 'Ergonomic tri-mode wireless mouse with PAW3395 sensor, 26,000 DPI, and 80-hour battery life.', 89.00, 75, 'Peripherals', 'https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?auto=format&fit=crop&w=600&q=80'),
(4, 'Active Noise-Cancelling Headphones', 'High-fidelity audio with hybrid ANC, 40mm beryllium drivers, and 45-hour playback on a single charge.', 279.00, 30, 'Audio', 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80'),
(5, 'Enterprise NVMe SSD 2TB', 'PCIe Gen 4.0 x4 internal solid state drive boasting up to 7450 MB/s sequential read speeds.', 169.99, 50, 'Storage', 'https://images.unsplash.com/photo-1597872200969-2b65d56bd16b?auto=format&fit=crop&w=600&q=80'),
(6, 'Docker Blue Desk Mat (XL)', 'Spill-resistant micro-woven cloth surface with anti-fray stitched edges (900mm x 400mm x 4mm).', 34.99, 120, 'Accessories', 'https://images.unsplash.com/photo-1616400619175-5beda3a17896?auto=format&fit=crop&w=600&q=80'),
(7, 'Smart Thunderbolt 4 Docking Station', 'Dual 4K@60Hz display support, 2.5GbE Ethernet, UHS-II SD reader, and 96W upstream charging.', 219.00, 25, 'Accessories', 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?auto=format&fit=crop&w=600&q=80'),
(8, 'Studio Condenser USB Microphone', 'Cardioid pattern 24-bit/96kHz mic with hardware gain dial, zero-latency headphone monitoring.', 129.99, 40, 'Audio', 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?auto=format&fit=crop&w=600&q=80');
