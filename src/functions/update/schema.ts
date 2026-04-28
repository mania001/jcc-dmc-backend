export default {
  type: 'object',
  properties: {
    result: { type: 'boolean' },
    payment_key: { type: 'string' },
  },
  required: ['payment_key'],
} as const
