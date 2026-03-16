/**
 * E-Commerce Complete Demo
 * 
 * Demonstrates a full e-commerce flow:
 * 1. User Registration & Login
 * 2. Order Creation
 * 3. Payment Processing
 * 4. Order Status Updates
 * 
 * This combines: auth-module + order-module + payment-module
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ============================================
// AUTH MODULE (simplified from auth-module.js)
// ============================================
const users = new Map();

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function registerUser(username, password, email) {
  if (users.has(username)) {
    throw new Error('User already exists');
  }
  const salt = crypto.randomBytes(32).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const user = {
    username,
    email,
    passwordHash,
    salt,
    createdAt: new Date().toISOString()
  };
  users.set(username, user);
  return user;
}

function login(username, password) {
  const user = users.get(username);
  if (!user) {
    throw new Error('User not found');
  }
  const passwordHash = hashPassword(password, user.salt);
  if (passwordHash !== user.passwordHash) {
    throw new Error('Invalid password');
  }
  const token = crypto.randomBytes(32).toString('hex');
  return { user, token };
}

// ============================================
// ORDER MODULE (simplified from order-module.js)
// ============================================
const orders = new Map();
let orderCounter = 0;

function generateOrderId() {
  orderCounter++;
  const random = crypto.randomBytes(4).toString('hex');
  return `ORD-${Date.now()}-${random}`;
}

const OrderStatus = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  PROCESSING: 'processing',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled'
};

function createOrder(username, items) {
  const orderId = generateOrderId();
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const order = {
    id: orderId,
    username,
    items,
    total,
    status: OrderStatus.PENDING,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  orders.set(orderId, order);
  return order;
}

function updateOrderStatus(orderId, newStatus) {
  const order = orders.get(orderId);
  if (!order) throw new Error('Order not found');
  const validTransitions = {
    [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
    [OrderStatus.CONFIRMED]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
    [OrderStatus.PROCESSING]: [OrderStatus.SHIPPED],
    [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED],
    [OrderStatus.DELIVERED]: [],
    [OrderStatus.CANCELLED]: []
  };
  if (!validTransitions[order.status].includes(newStatus)) {
    throw new Error(`Invalid transition: ${order.status} -> ${newStatus}`);
  }
  order.status = newStatus;
  order.updatedAt = new Date().toISOString();
  return order;
}

// ============================================
// PAYMENT MODULE (simplified from payment-module.js)
// ============================================
const payments = new Map();

const PaymentStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded'
};

const PaymentMethod = {
  CREDIT_CARD: 'credit_card',
  ALIPAY: 'alipay',
  WECHAT_PAY: 'wechat_pay'
};

function generatePaymentId() {
  return 'PAY-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
}

function createPayment(orderId, amount, method = PaymentMethod.CREDIT_CARD) {
  const payment = {
    id: generatePaymentId(),
    orderId,
    amount,
    method,
    status: PaymentStatus.PENDING,
    transactionId: null,
    createdAt: new Date().toISOString()
  };
  payments.set(payment.id, payment);
  return payment;
}

function processPayment(paymentId) {
  const payment = payments.get(paymentId);
  if (!payment) throw new Error('Payment not found');
  if (payment.status !== PaymentStatus.PENDING) {
    throw new Error('Payment is not pending');
  }
  payment.status = PaymentStatus.PROCESSING;
  payment.transactionId = 'TXN-' + crypto.randomBytes(8).toString('hex').toUpperCase();
  // Simulate 90% success
  const success = Math.random() > 0.1;
  payment.status = success ? PaymentStatus.COMPLETED : PaymentStatus.FAILED;
  return payment;
}

// ============================================
// MAIN DEMO
// ============================================
function runEcommerceDemo() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     E-Commerce Complete Flow Demo                        ║');
  console.log('║     Auth + Order + Payment Integration                    ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  
  const steps = [];
  
  // Step 1: Register User
  console.log('📝 Step 1: User Registration');
  console.log('─'.repeat(50));
  try {
    const user = registerUser('demo_user', 'password123', 'demo@example.com');
    steps.push({ step: 'register', status: 'success', username: user.username });
    console.log(`   ✅ Registered: ${user.username} (${user.email})`);
  } catch (e) {
    console.log(`   ⚠️  User exists, proceeding to login`);
  }
  
  // Step 2: Login
  console.log('\n🔐 Step 2: User Login');
  console.log('─'.repeat(50));
  const { user, token } = login('demo_user', 'password123');
  steps.push({ step: 'login', status: 'success', token: token.substring(0, 16) + '...' });
  console.log(`   ✅ Logged in: ${user.username}`);
  console.log(`   🔑 Token: ${token.substring(0, 16)}...`);
  
  // Step 3: Create Order
  console.log('\n🛒 Step 3: Create Order');
  console.log('─'.repeat(50));
  const items = [
    { name: 'Wireless Mouse', price: 29.99, quantity: 2 },
    { name: 'Mechanical Keyboard', price: 149.99, quantity: 1 },
    { name: 'USB-C Hub', price: 49.99, quantity: 1 }
  ];
  const order = createOrder('demo_user', items);
  steps.push({ step: 'create_order', status: 'success', orderId: order.id, total: order.total });
  console.log(`   ✅ Order created: ${order.id}`);
  console.log(`   📦 Items: ${items.length} products`);
  console.log(`   💰 Total: $${order.total.toFixed(2)}`);
  
  // Step 4: Process Payment
  console.log('\n💳 Step 4: Process Payment');
  console.log('─'.repeat(50));
  const payment = createPayment(order.id, order.total, PaymentMethod.CREDIT_CARD);
  steps.push({ step: 'process_payment', status: 'pending', paymentId: payment.id });
  console.log(`   💵 Payment created: ${payment.id}`);
  console.log(`   💰 Amount: $${payment.amount.toFixed(2)}`);
  
  const processedPayment = processPayment(payment.id);
  steps[steps.length - 1].status = processedPayment.status;
  console.log(`   ✅ Payment ${processedPayment.status}: ${processedPayment.transactionId}`);
  
  // Step 5: Update Order Status
  console.log('\n📦 Step 5: Order Status Updates');
  console.log('─'.repeat(50));
  const statusFlow = [
    OrderStatus.CONFIRMED,
    OrderStatus.PROCESSING,
    OrderStatus.SHIPPED,
    OrderStatus.DELIVERED
  ];
  
  for (const newStatus of statusFlow) {
    const updatedOrder = updateOrderStatus(order.id, newStatus);
    console.log(`   📋 ${updatedOrder.status}`);
    steps.push({ step: 'update_status', status: 'success', orderStatus: newStatus });
  }
  
  // Summary
  console.log('\n' + '═'.repeat(50));
  console.log('📊 DEMO SUMMARY');
  console.log('═'.repeat(50));
  console.log(`   👤 User: demo_user`);
  console.log(`   🧾 Order: ${order.id}`);
  console.log(`   💳 Payment: ${payment.id}`);
  console.log(`   💵 Amount: $${order.total.toFixed(2)}`);
  console.log(`   ✅ Final Status: ${order.status}`);
  console.log('\n' + '═'.repeat(50));
  
  return { steps, order, payment, user };
}

// Export for use in other demos
module.exports = { runEcommerceDemo };

// Run if called directly
if (require.main === module) {
  runEcommerceDemo();
}
