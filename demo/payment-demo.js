/**
 * Combined Demo: Auth + Order + Payment
 * 
 * Demonstrates a complete e-commerce flow:
 * 1. User registration and login
 * 2. Order creation
 * 3. Payment processing
 * 4. Order status updates
 */

const auth = require('./auth-module');
const order = require('./order-module');
const payment = require('./payment-module');

console.log('=== Combined Auth + Order + Payment Demo ===\n');

// Step 1: Register users
console.log('Step 1: Register Users');
const user1 = auth.register('alice', 'password123', 'alice@example.com');
console.log('✓ Registered:', user1.username);

const user2 = auth.register('bob', 'securepass456', 'bob@example.com');
console.log('✓ Registered:', user2.username);

// Step 2: Login
console.log('\nStep 2: User Login');
const loginResult = auth.login('alice', 'password123');
console.log('✓ Logged in:', loginResult.user.username);
console.log('  Token:', loginResult.token.substring(0, 40) + '...');

// Step 3: Create order
console.log('\nStep 3: Create Order');
const newOrder = order.createOrder({
  userId: user1.id,
  items: [
    { productId: 'PROD-001', name: 'Laptop', price: 999.99, quantity: 1 },
    { productId: 'PROD-002', name: 'Mouse', price: 29.99, quantity: 2 }
  ]
});
console.log('✓ Order created:', newOrder.id);
console.log('  Status:', newOrder.status);
console.log('  Total: $' + newOrder.totalAmount);

// Step 4: Process payment
console.log('\nStep 4: Process Payment');
const pay = payment.createPayment(
  newOrder.id,
  newOrder.totalAmount,
  'USD',
  payment.PaymentMethod.CREDIT_CARD,
  { email: user1.email, name: user1.username }
);
console.log('✓ Payment created:', pay.id);
console.log('  Amount:', pay.amount, pay.currency);

const processedPay = payment.processPayment(pay.id);
console.log('✓ Payment processed:', processedPay.status);
console.log('  Transaction:', processedPay.transactionId);

// Step 5: Update order status based on payment
console.log('\nStep 5: Update Order Status');
if (processedPay.status === payment.PaymentStatus.COMPLETED) {
  order.updateOrderStatus(newOrder.id, order.OrderStatus.CONFIRMED);
  console.log('✓ Order confirmed');
  
  order.updateOrderStatus(newOrder.id, order.OrderStatus.PROCESSING);
  console.log('✓ Order processing');
  
  order.updateOrderStatus(newOrder.id, order.OrderStatus.SHIPPED);
  console.log('✓ Order shipped');
  
  order.updateOrderStatus(newOrder.id, order.OrderStatus.DELIVERED);
  console.log('✓ Order delivered');
}

// Step 6: Get final order status
console.log('\nStep 6: Final Order Status');
const finalOrder = order.getOrder(newOrder.id);
console.log('  Order:', finalOrder.id);
console.log('  Status:', finalOrder.status);
console.log('  Total: $' + finalOrder.totalAmount);

// Step 7: Statistics
console.log('\nStep 7: Statistics');
const orderStats = order.getStats();
console.log('  Order Stats:');
console.log('    Total Orders:', orderStats.totalOrders);
console.log('    Revenue: $' + orderStats.totalRevenue.toFixed(2));

const paymentStats = payment.getStats();
console.log('  Payment Stats:');
console.log('    Total Payments:', paymentStats.totalPayments);
console.log('    Completed Amount: $' + paymentStats.completedAmount.toFixed(2));
console.log('    Net Amount: $' + paymentStats.netAmount.toFixed(2));

console.log('\n=== Demo Complete ===');
