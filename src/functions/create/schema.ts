export default {
  type: 'object',
  properties: {
    pay_type: { type: 'string', enum: ['card', 'mobile'] },
    name: { type: 'string' },
    jumin1: { type: 'string' },
    jumin2: { type: 'string' },
    email: { type: 'string' },
    tithe: { type: 'number' },
    thanks: { type: 'number' },
    building: { type: 'number' },
    mission: { type: 'number' },
    relief: { type: 'number' },
    order_id: { type: 'string' },
  },
  required: ['pay_type', 'name', 'jumin1', 'jumin2', 'order_id'],
} as const
