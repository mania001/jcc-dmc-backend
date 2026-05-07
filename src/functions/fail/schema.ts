export default {
  type: 'object',
  properties: {
    orderId: { type: 'string' },
    paymentKey: { type: 'string' },
    errorCode: { type: 'string' },
    errorMessage: { type: 'string' },
  },
  required: ['orderId'],
} as const
