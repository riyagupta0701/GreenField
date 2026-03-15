// Integration fixture — frontend
// Fetches /api/orders and reads only a subset of the returned fields

import axios from 'axios';

async function loadOrders() {
  const res = await axios.get('/api/orders');
  const orders = res.data;

  return (orders as any[]).map((order: any) => {
    const { id, total, status } = order;
    // intentionally NOT reading: createdAt, customerId, notes, internalRef
    return { id, total, status };
  });
}

async function createOrder() {
  await axios.post('/api/orders', {
    customerId: 'cust-42',
    items: [],
    notes: 'Rush order',
    // intentionally NOT sending: discount, tags
  });
}
