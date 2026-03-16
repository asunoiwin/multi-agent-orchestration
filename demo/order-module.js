/**
 * Order Management Module - Demo Implementation
 * 
 * This module provides order CRUD operations for the multi-agent orchestration demo.
 * 
 * Features:
 * - Create new orders
 * - Query orders by status/user
 * - Update order status
 * - Cancel orders
 * - List all orders
 * 
 * Usage:
 *   const orderModule = require('./order-module');
 *   
 *   // Create order
 *   const order = orderModule.createOrder({ userId: 'user123', items: [...] });
 *   
 *   // Get order
 *   const order = orderModule.getOrder(orderId);
 *   
 *   // Update status
 *   orderModule.updateOrderStatus(orderId, 'shipped');
 */

const fs = require('fs');
const path = require('path');

// In-memory order storage (in production, use a database)
const orders = new Map();

// Order status constants
const OrderStatus = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  PROCESSING: 'processing',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled'
};

// Generate unique order ID
function generateOrderId() {
  return `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a new order
 * @param {Object} orderData - Order data
 * @param {string} orderData.userId - User ID
 * @param {Array} orderData.items - Array of order items
 * @param {string} orderData.notes - Optional notes
 * @returns {Object} Created order
 */
function createOrder(orderData) {
  const { userId, items = [], notes = '' } = orderData;
  
  if (!userId) {
    throw new Error('userId is required');
  }
  
  const orderId = generateOrderId();
  const now = new Date().toISOString();
  
  const order = {
    id: orderId,
    userId,
    items,
    notes,
    status: OrderStatus.PENDING,
    totalAmount: calculateTotal(items),
    createdAt: now,
    updatedAt: now,
    history: [
      {
        status: OrderStatus.PENDING,
        timestamp: now,
        note: 'Order created'
      }
    ]
  };
  
  orders.set(orderId, order);
  
  return order;
}

/**
 * Calculate total amount from items
 * @param {Array} items - Array of items with price
 * @returns {number} Total amount
 */
function calculateTotal(items) {
  return items.reduce((sum, item) => {
    const price = item.price || 0;
    const quantity = item.quantity || 1;
    // Support both 'name' and 'productName' fields
    return sum + price * quantity;
  }, 0);
}

/**
 * Get order by ID
 * @param {string} orderId - Order ID
 * @returns {Object|null} Order or null if not found
 */
function getOrder(orderId) {
  return orders.get(orderId) || null;
}

/**
 * Get orders by user ID
 * @param {string} userId - User ID
 * @returns {Array} Array of orders
 */
function getOrdersByUser(userId) {
  return Array.from(orders.values()).filter(order => order.userId === userId);
}

/**
 * Get orders by status
 * @param {string} status - Order status
 * @returns {Array} Array of orders
 */
function getOrdersByStatus(status) {
  return Array.from(orders.values()).filter(order => order.status === status);
}

/**
 * Update order status
 * @param {string} orderId - Order ID
 * @param {string} newStatus - New status
 * @param {string} note - Optional note
 * @returns {Object} Updated order
 */
function updateOrderStatus(orderId, newStatus, note = '') {
  const order = orders.get(orderId);
  
  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }
  
  // Validate status transition
  if (!isValidStatusTransition(order.status, newStatus)) {
    throw new Error(`Invalid status transition from ${order.status} to ${newStatus}`);
  }
  
  const now = new Date().toISOString();
  order.status = newStatus;
  order.updatedAt = now;
  order.history.push({
    status: newStatus,
    timestamp: now,
    note: note || `Status changed to ${newStatus}`
  });
  
  return order;
}

/**
 * Check if status transition is valid
 * @param {string} currentStatus - Current status
 * @param {string} newStatus - New status
 * @returns {boolean} True if valid
 */
function isValidStatusTransition(currentStatus, newStatus) {
  const validTransitions = {
    [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
    [OrderStatus.CONFIRMED]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
    [OrderStatus.PROCESSING]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
    [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
    [OrderStatus.DELIVERED]: [],
    [OrderStatus.CANCELLED]: []
  };
  
  return validTransitions[currentStatus]?.includes(newStatus) || false;
}

/**
 * Cancel an order
 * @param {string} orderId - Order ID
 * @param {string} reason - Cancellation reason
 * @returns {Object} Cancelled order
 */
function cancelOrder(orderId, reason = '') {
  return updateOrderStatus(orderId, OrderStatus.CANCELLED, reason);
}

/**
 * List all orders
 * @param {Object} filters - Optional filters
 * @returns {Array} Array of orders
 */
function listOrders(filters = {}) {
  let result = Array.from(orders.values());
  
  if (filters.userId) {
    result = result.filter(o => o.userId === filters.userId);
  }
  
  if (filters.status) {
    result = result.filter(o => o.status === filters.status);
  }
  
  if (filters.fromDate) {
    result = result.filter(o => new Date(o.createdAt) >= new Date(filters.fromDate));
  }
  
  if (filters.toDate) {
    result = result.filter(o => new Date(o.createdAt) <= new Date(filters.toDate));
  }
  
  // Sort by createdAt descending
  result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  return result;
}

/**
 * Get order statistics
 * @returns {Object} Statistics
 */
function getStats() {
  const allOrders = Array.from(orders.values());
  
  const stats = {
    total: allOrders.length,
    byStatus: {},
    totalRevenue: 0
  };
  
  for (const status of Object.values(OrderStatus)) {
    stats.byStatus[status] = allOrders.filter(o => o.status === status).length;
  }
  
  stats.totalRevenue = allOrders
    .filter(o => o.status !== OrderStatus.CANCELLED)
    .reduce((sum, o) => sum + o.totalAmount, 0);
  
  return stats;
}

/**
 * Add item to existing order
 * @param {string} orderId - Order ID
 * @param {Object} item - Item to add
 * @returns {Object} Updated order
 */
function addItemToOrder(orderId, item) {
  const order = orders.get(orderId);
  
  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }
  
  if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.DELIVERED) {
    throw new Error(`Cannot add items to order with status: ${order.status}`);
  }
  
  order.items.push(item);
  order.totalAmount = calculateTotal(order.items);
  order.updatedAt = new Date().toISOString();
  
  return order;
}

/**
 * Remove item from order
 * @param {string} orderId - Order ID
 * @param {number} itemIndex - Index of item to remove
 * @returns {Object} Updated order
 */
function removeItemFromOrder(orderId, itemIndex) {
  const order = orders.get(orderId);
  
  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }
  
  if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.DELIVERED) {
    throw new Error(`Cannot remove items from order with status: ${order.status}`);
  }
  
  if (itemIndex < 0 || itemIndex >= order.items.length) {
    throw new Error(`Invalid item index: ${itemIndex}`);
  }
  
  order.items.splice(itemIndex, 1);
  order.totalAmount = calculateTotal(order.items);
  order.updatedAt = new Date().toISOString();
  
  return order;
}

// Export module
module.exports = {
  OrderStatus,
  createOrder,
  getOrder,
  getOrderById: getOrder, // Alias
  getOrdersByUser,
  getOrdersByUserId: (userId) => ({ total: getOrdersByUser(userId).length, orders: getOrdersByUser(userId) }), // Wrapper
  getOrdersByStatus,
  updateOrderStatus,
  cancelOrder,
  listOrders,
  getStats,
  addItemToOrder,
  removeItemFromOrder,
  
  // For testing
  _orders: orders
};

// CLI test
if (require.main === module) {
  console.log('=== Order Management Module Demo ===\n');
  
  // Create some orders
  console.log('1. Creating sample orders...');
  
  const order1 = createOrder({
    userId: 'user001',
    items: [
      { name: 'Laptop', price: 999.99, quantity: 1 },
      { name: 'Mouse', price: 29.99, quantity: 2 }
    ],
    notes: 'Priority shipping'
  });
  console.log('   Created order:', order1.id);
  
  const order2 = createOrder({
    userId: 'user001',
    items: [
      { name: 'Keyboard', price: 149.99, quantity: 1 }
    ]
  });
  console.log('   Created order:', order2.id);
  
  const order3 = createOrder({
    userId: 'user002',
    items: [
      { name: 'Monitor', price: 299.99, quantity: 2 },
      { name: 'HDMI Cable', price: 15.99, quantity: 3 }
    ]
  });
  console.log('   Created order:', order3.id);
  
  // Query orders
  console.log('\n2. Querying orders for user001...');
  const userOrders = getOrdersByUser('user001');
  console.log('   Found:', userOrders.length, 'orders');
  
  console.log('\n3. Pending orders...');
  const pendingOrders = getOrdersByStatus(OrderStatus.PENDING);
  console.log('   Found:', pendingOrders.length, 'pending orders');
  
  // Update order status
  console.log('\n4. Updating order status...');
  const confirmed = updateOrderStatus(order1.id, OrderStatus.CONFIRMED, 'Payment confirmed');
  console.log('   Order status:', confirmed.status);
  
  // Get statistics
  console.log('\n5. Order statistics:');
  const stats = getStats();
  console.log('   Total orders:', stats.total);
  console.log('   By status:', JSON.stringify(stats.byStatus));
  console.log('   Total revenue: $' + stats.totalRevenue.toFixed(2));
  
  console.log('\n=== Demo Complete ===');
}
