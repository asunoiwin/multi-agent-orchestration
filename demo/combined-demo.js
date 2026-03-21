/**
 * Combined Demo: User Authentication + Order Management
 * 
 * This demo shows how the two modules work together:
 * - Users must authenticate before placing orders
 * - Orders are linked to authenticated users
 * 
 * Usage:
 *   node demo/combined-demo.js
 */

const authModule = require('./auth-module');
const orderModule = require('./order-module');

console.log('=== Combined Auth + Order Management Demo ===\n');

// Step 1: Register users
console.log('Step 1: Register Users');
console.log('----------------------');

const user1 = authModule.register('alice', 'alice123', 'alice@example.com');
console.log(`✓ Registered: ${user1.username} (${user1.email})`);

const user2 = authModule.register('bob', 'bob456', 'bob@example.com');
console.log(`✓ Registered: ${user2.username} (${user2.email})`);

// Step 2: User login
console.log('\nStep 2: User Login');
console.log('-----------------');

const loginResult = authModule.login('alice', 'alice123');
console.log(`✓ Logged in: ${loginResult.user.username}`);
console.log(`  Token: ${loginResult.token.substring(0, 40)}...`);
const currentUser = loginResult.user;

// Step 3: Create order (authenticated)
console.log('\nStep 3: Create Order (Authenticated)');
console.log('-------------------------------------');

const order1 = orderModule.createOrder({
  userId: currentUser.id,
  items: [
    { name: 'MacBook Pro', price: 1999.99, quantity: 1 },
    { name: 'Magic Mouse', price: 99.99, quantity: 1 },
    { name: 'USB-C Hub', price: 49.99, quantity: 2 }
  ],
  notes: 'Please gift wrap'
});
console.log(`✓ Order created: ${order1.id}`);
console.log(`  Status: ${order1.status}`);
console.log(`  Total: $${order1.totalAmount.toFixed(2)}`);

// Step 4: Another user creates order
console.log('\nStep 4: Another User Creates Order');
console.log('----------------------------------');

const bobLogin = authModule.login('bob', 'bob456');
const order2 = orderModule.createOrder({
  userId: bobLogin.user.id,
  items: [
    { name: 'iPhone 15', price: 999.00, quantity: 1 }
  ]
});
console.log(`✓ Order created: ${order2.id}`);
console.log(`  Status: ${order2.status}`);
console.log(`  Total: $${order2.totalAmount.toFixed(2)}`);

// Step 5: Process order through status workflow
console.log('\nStep 5: Order Status Workflow');
console.log('-----------------------------');

console.log(`  Current status: ${order1.status}`);
const confirmed = orderModule.updateOrderStatus(order1.id, orderModule.OrderStatus.CONFIRMED, 'Payment received');
console.log(`  → Confirmed: ${confirmed.status}`);

const processed = orderModule.updateOrderStatus(order1.id, orderModule.OrderStatus.PROCESSING, 'Preparing for shipment');
console.log(`  → Processing: ${processed.status}`);

const shipped = orderModule.updateOrderStatus(order1.id, orderModule.OrderStatus.SHIPPED, 'Shipped via FedEx');
console.log(`  → Shipped: ${shipped.status}`);

const delivered = orderModule.updateOrderStatus(order1.id, orderModule.OrderStatus.DELIVERED, 'Delivered to customer');
console.log(`  → Delivered: ${delivered.status}`);

// Step 6: Query orders
console.log('\nStep 6: Query Orders');
console.log('--------------------');

// Get user's orders
const aliceOrders = orderModule.getOrdersByUser(currentUser.id);
console.log(`  Alice's orders: ${aliceOrders.length}`);

// Get pending orders
const pendingOrders = orderModule.getOrdersByStatus(orderModule.OrderStatus.PENDING);
console.log(`  Pending orders: ${pendingOrders.length}`);

// Get all orders with filters
const allOrders = orderModule.listOrders({ status: orderModule.OrderStatus.PENDING });
console.log(`  All pending: ${allOrders.length}`);

// Step 7: Statistics
console.log('\nStep 7: Statistics');
console.log('------------------');

const stats = orderModule.getStats();
console.log(`  Total orders: ${stats.total}`);
console.log(`  Revenue: $${stats.totalRevenue.toFixed(2)}`);
console.log(`  By status:`, stats.byStatus);

console.log('\n=== Demo Complete ===');
console.log('\nThis demonstrates:');
console.log('  1. User registration and authentication');
console.log('  2. JWT token-based login');
console.log('  3. Order creation linked to authenticated users');
console.log('  4. Order status workflow management');
console.log('  5. Query and filtering capabilities');
console.log('  6. Order statistics and reporting');
