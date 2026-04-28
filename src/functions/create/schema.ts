export default {
  type: 'object',
  properties: {
    name: { type: 'string' },
    jumin1: { type: 'string' },
    jumin2: { type: 'string' },
    email: { type: 'string' },
    price1: { type: 'number' },
    price2: { type: 'number' },
    price3: { type: 'number' },
    price4: { type: 'number' },
    price5: { type: 'number' },
    contents: { type: 'string' },
    orderId: { type: 'string' },
  },
  required: ['name', 'orderId'],
} as const
