export default {
  type: 'object',
  properties: {
    paymentKey: { type: 'string' },
    orderId: { type: 'string' },
    amount: { type: 'number' },
  },
  required: ['paymentKey', 'orderId', 'amount'],
} as const
