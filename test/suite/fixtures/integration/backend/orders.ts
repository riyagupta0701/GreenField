// Integration fixture — backend (Express)
// Defines /api/orders with more fields than the frontend reads

import express from 'express';
const app = express();

app.get('/api/orders', (req: any, res: any) => {
  res.json([{
    id: 1,
    total: 59.99,
    status: 'shipped',
    createdAt: '2024-01-01',   // dead — frontend never reads this
    customerId: 'cust-42',     // dead — frontend never reads this
    notes: 'Rush order',       // dead — frontend never reads this
    internalRef: 'INT-001',    // dead — frontend never reads this
  }]);
});

app.post('/api/orders', (req: any, res: any) => {
  const { customerId, items, notes } = req.body;
  // 'discount' and 'tags' are never read from req.body → dead request fields
  res.json({ ok: true });
});
