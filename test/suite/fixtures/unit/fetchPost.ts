// Fixture: fetch POST with JSON.stringify body
fetch('/api/products', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Widget',
    price: 9.99,
    sku: 'WGT-001',
    inStock: true,
  }),
});
