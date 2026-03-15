// Fixture: axios POST with object body
import axios from 'axios';

axios.post('/api/users', {
  username: 'alice',
  email: 'alice@example.com',
  password: 'secret',
  role: 'admin',
});
