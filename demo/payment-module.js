/**
 * Payment Module
 * 
 * Features:
 * - Payment creation
 * - Payment status management
 * - Refund processing
 * - Transaction history
 */

const crypto = require('crypto');

// In-memory payment store
const payments = new Map();

// Payment status enum
const PaymentStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  PARTIAL_REFUNDED: 'partial_refunded'
};

// Payment method enum
const PaymentMethod = {
  CREDIT_CARD: 'credit_card',
  ALIPAY: 'alipay',
  WECHAT_PAY: 'wechat_pay',
  BANK_TRANSFER: 'bank_transfer'
};

/**
 * Generate unique payment ID
 */
function generatePaymentId() {
  return 'PAY-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
}

/**
 * Create a new payment
 */
function createPayment(orderId, amount, currency = 'USD', method = PaymentMethod.CREDIT_CARD, customerInfo = {}) {
  const payment = {
    id: generatePaymentId(),
    orderId,
    amount: parseFloat(amount),
    currency,
    method,
    status: PaymentStatus.PENDING,
    customerInfo: {
      email: customerInfo.email || '',
      phone: customerInfo.phone || '',
      name: customerInfo.name || ''
    },
    transactionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    refundedAmount: 0,
    refundHistory: []
  };
  
  payments.set(payment.id, payment);
  return payment;
}

/**
 * Process payment (simulate payment gateway)
 */
function processPayment(paymentId) {
  const payment = payments.get(paymentId);
  if (!payment) {
    throw new Error('Payment not found');
  }
  
  if (payment.status !== PaymentStatus.PENDING) {
    throw new Error('Payment is not in pending status');
  }
  
  // Simulate payment processing
  payment.status = PaymentStatus.PROCESSING;
  payment.transactionId = 'TXN-' + crypto.randomBytes(8).toString('hex').toUpperCase();
  payment.updatedAt = new Date().toISOString();
  
  // Simulate successful payment (90% success rate for demo)
  const success = Math.random() > 0.1;
  
  if (success) {
    payment.status = PaymentStatus.COMPLETED;
    payment.completedAt = new Date().toISOString();
  } else {
    payment.status = PaymentStatus.FAILED;
  }
  
  payment.updatedAt = new Date().toISOString();
  return payment;
}

/**
 * Get payment by ID
 */
function getPayment(paymentId) {
  return payments.get(paymentId) || null;
}

/**
 * Get payments by order ID
 */
function getPaymentsByOrderId(orderId) {
  const result = [];
  for (const payment of payments.values()) {
    if (payment.orderId === orderId) {
      result.push(payment);
    }
  }
  return result;
}

/**
 * Get payments by status
 */
function getPaymentsByStatus(status) {
  const result = [];
  for (const payment of payments.values()) {
    if (payment.status === status) {
      result.push(payment);
    }
  }
  return result;
}

/**
 * Refund payment (full or partial)
 */
function refundPayment(paymentId, amount, reason = '') {
  const payment = payments.get(paymentId);
  if (!payment) {
    throw new Error('Payment not found');
  }
  
  if (payment.status !== PaymentStatus.COMPLETED) {
    throw new Error('Can only refund completed payments');
  }
  
  const refundAmount = parseFloat(amount);
  const remainingRefundable = payment.amount - payment.refundedAmount;
  
  if (refundAmount > remainingRefundable) {
    throw new Error(`Refund amount exceeds remaining refundable amount: ${remainingRefundable}`);
  }
  
  const refund = {
    id: 'REF-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex'),
    amount: refundAmount,
    reason,
    createdAt: new Date().toISOString()
  };
  
  payment.refundHistory.push(refund);
  payment.refundedAmount += refundAmount;
  payment.updatedAt = new Date().toISOString();
  
  // Update payment status
  if (payment.refundedAmount >= payment.amount) {
    payment.status = PaymentStatus.REFUNDED;
  } else {
    payment.status = PaymentStatus.PARTIAL_REFUNDED;
  }
  
  return payment;
}

/**
 * Get payment statistics
 */
function getStats() {
  let totalAmount = 0;
  let completedAmount = 0;
  let refundedAmount = 0;
  const statusCounts = {};
  
  for (const payment of payments.values()) {
    totalAmount += payment.amount;
    statusCounts[payment.status] = (statusCounts[payment.status] || 0) + 1;
    
    if (payment.status === PaymentStatus.COMPLETED) {
      completedAmount += payment.amount;
    }
    
    if (payment.status === PaymentStatus.REFUNDED || payment.status === PaymentStatus.PARTIAL_REFUNDED) {
      refundedAmount += payment.refundedAmount;
    }
  }
  
  return {
    totalPayments: payments.size,
    totalAmount,
    completedAmount,
    refundedAmount,
    netAmount: completedAmount - refundedAmount,
    statusCounts
  };
}

module.exports = {
  PaymentStatus,
  PaymentMethod,
  createPayment,
  processPayment,
  getPayment,
  getPaymentsByOrderId,
  getPaymentsByStatus,
  refundPayment,
  getStats
};

// Demo usage
if (require.main === module) {
  console.log('=== Payment Module Demo ===\n');
  
  // Create payments
  console.log('1. Creating payments...');
  const payment1 = createPayment('ORD-001', 99.99, 'USD', PaymentMethod.CREDIT_CARD, {
    email: 'customer1@example.com',
    name: 'John Doe'
  });
  console.log('   Created:', payment1.id, '- Amount:', payment1.amount, payment1.currency);
  
  const payment2 = createPayment('ORD-002', 199.50, 'USD', PaymentMethod.ALIPAY, {
    phone: '+86-138-0000-1234',
    name: '张三'
  });
  console.log('   Created:', payment2.id, '- Amount:', payment2.amount, payment2.currency);
  
  // Process payments
  console.log('\n2. Processing payments...');
  const processed1 = processPayment(payment1.id);
  console.log('   Payment 1:', processed1.status, '- Txn:', processed1.transactionId);
  
  const processed2 = processPayment(payment2.id);
  console.log('   Payment 2:', processed2.status, '- Txn:', processed2.transactionId);
  
  // Get payment
  console.log('\n3. Getting payment by ID...');
  const fetched = getPayment(payment1.id);
  console.log('   Found:', fetched.id, '- Order:', fetched.orderId);
  
  // Get by order
  console.log('\n4. Getting payments by order ID...');
  const orderPayments = getPaymentsByOrderId('ORD-001');
  console.log('   Payments for ORD-001:', orderPayments.length);
  
  // Refund
  console.log('\n5. Refunding payment...');
  const refunded = refundPayment(payment1.id, 50.00, 'Customer request');
  console.log('   Refunded:', refunded.status, '- Amount:', refunded.refundedAmount);
  
  // Stats
  console.log('\n6. Payment statistics:');
  const stats = getStats();
  console.log('   Total:', stats.totalPayments);
  console.log('   Completed Amount:', stats.completedAmount);
  console.log('   Refunded Amount:', stats.refundedAmount);
  console.log('   Net Amount:', stats.netAmount);
  console.log('   Status Counts:', JSON.stringify(stats.statusCounts));
  
  console.log('\n=== Demo Complete ===');
}
