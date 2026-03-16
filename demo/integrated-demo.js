/**
 * Integrated Demo: User Authentication + Order Management
 * 
 * This demo shows how the two modules work together:
 * 1. User registers and logs in
 * 2. Authenticated user creates orders
 * 3. Order history is tied to user account
 */

const auth = require('./auth-module');
const order = require('./order-module');

console.log('=== Integrated Auth + Order Management Demo ===\n');

// Step 1: User Registration
console.log('--- Step 1: User Registration ---');
const newUser = auth.register('john_doe', 'securePass123', 'john@example.com');
console.log(`Registered user: ${newUser.username} (${newUser.email})`);
console.log(`User ID: ${newUser.id}`);

// Step 2: User Login
console.log('\n--- Step 2: User Login ---');
const loginResult = auth.login('john_doe', 'securePass123');
console.log(`Logged in as: ${loginResult.user.username}`);
console.log(`JWT Token: ${loginResult.token.substring(0, 40)}...`);

// Step 3: Validate Token (middleware simulation)
console.log('\n--- Step 3: Token Validation (Middleware) ---');
const payload = auth.validateToken(loginResult.token);
if (payload) {
  console.log('Token is valid!');
  console.log(`Authenticated user ID: ${payload.sub}`);
  
  // Get full user profile
  const userProfile = auth.getUserById(payload.sub);
  console.log(`User profile: ${userProfile.username} - ${userProfile.email}`);
} else {
  console.log('Invalid token!');
}

// Step 4: Create Orders (authenticated)
console.log('\n--- Step 4: Creating Orders ---');

// Order 1: Electronics - using object format
const order1 = order.createOrder({
  userId: loginResult.user.id,
  items: [
    { productId: 'ELEC-001', productName: 'MacBook Pro 14"', price: 1999.00, quantity: 1 },
    { productId: 'ELEC-002', productName: 'Magic Mouse', price: 99.00, quantity: 1 }
  ],
  notes: 'Priority shipping'
});
console.log(`Order 1 created: ${order1.id}`);
console.log(`  Items: ${order1.items.length}, Status: ${order1.status}`);

// Order 2: Accessories
const order2 = order.createOrder({
  userId: loginResult.user.id,
  items: [
    { productId: 'ACC-001', productName: 'USB-C Hub', price: 49.00, quantity: 2 },
    { productId: 'ACC-002', productName: 'Laptop Stand', price: 79.00, quantity: 1 },
    { productId: 'ACC-003', productName: 'Cable Kit', price: 25.00, quantity: 3 }
  ]
});
console.log(`Order 2 created: ${order2.id}`);
console.log(`  Items: ${order2.items.length}, Status: ${order2.status}`);

// Step 5: Update Order Status
console.log('\n--- Step 5: Order Status Updates ---');

const confirmedOrder = order.updateOrderStatus(order1.id, order.OrderStatus.CONFIRMED);
console.log(`Order ${confirmedOrder.id}: ${confirmedOrder.status}`);

const processingOrder = order.updateOrderStatus(order1.id, order.OrderStatus.PROCESSING);
console.log(`Order ${processingOrder.id}: ${processingOrder.status}`);

const shippedOrder = order.updateOrderStatus(order1.id, order.OrderStatus.SHIPPED);
console.log(`Order ${shippedOrder.id}: ${shippedOrder.status}`);

// Step 6: View Order History
console.log('\n--- Step 6: User Order History ---');
const orderHistory = order.getOrdersByUserId(loginResult.user.id);
console.log(`Total orders: ${orderHistory.total}`);
console.log('\nOrders:');
orderHistory.orders.forEach(o => {
  console.log(`  - ${o.id}: ${o.status} (${o.items?.length || 0} items)`);
});

// Step 7: Get Specific Order
console.log('\n--- Step 7: Query Specific Order ---');
const foundOrder = order.getOrderById(order1.id);
if (foundOrder) {
  console.log(`Found order: ${foundOrder.id}`);
  console.log('  Items:');
  foundOrder.items?.forEach(item => {
    console.log(`    - ${item.productName}: $${item.price} x ${item.quantity}`);
  });
  console.log(`  Status History:`);
  foundOrder.history?.forEach(h => {
    console.log(`    - ${h.timestamp.split('T')[0]}: ${h.status}`);
  });
}

// Step 8: Try Invalid Operations
console.log('\n--- Step 8: Error Handling Demo ---');

// Try to cancel a shipped order (should fail based on transition rules)
try {
  order.updateOrderStatus(order1.id, order.OrderStatus.CANCELLED);
} catch (e) {
  console.log(`Expected error: ${e.message}`);
}

// Try to login with wrong password
try {
  auth.login('john_doe', 'wrongpassword');
} catch (e) {
  console.log(`Auth error: ${e.message}`);
}

// Step 9: Register another user and create order
console.log('\n--- Step 9: Multi-User Scenario ---');
const user2 = auth.register('jane_smith', 'anotherPass456', 'jane@example.com');
console.log(`Registered: ${user2.username}`);

const user2Order = order.createOrder({
  userId: user2.id,
  items: [
    { productId: 'BOOK-001', productName: 'JavaScript: The Good Parts', price: 35.00, quantity: 5 }
  ]
});
console.log(`User 2 order: ${user2Order.id}`);

// Check orders are separated by user
const user1Orders = order.getOrdersByUserId(loginResult.user.id);
const user2Orders = order.getOrdersByUserId(user2.id);
console.log(`User 1 has ${user1Orders.total} order(s)`);
console.log(`User 2 has ${user2Orders.total} order(s)`);

console.log('\n=== Demo Complete ===');
console.log('\nSummary:');
console.log('- Authentication module handles user registration/login with JWT');
console.log('- Order module manages full order lifecycle');
console.log('- Both modules integrate seamlessly with user IDs');
