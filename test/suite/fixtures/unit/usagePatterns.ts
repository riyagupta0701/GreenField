// Fixture: all usage patterns that usageTracker must detect

declare const response: any;
declare const user: any;
declare const key: string;

// 1. Direct property access
const a = response.id;
const b = response.email;

// 2. Optional chaining
const c = response.user?.name;
const d = response.profile?.avatar?.url;

// 3. Destructuring (simple)
const { username, role } = response;

// 4. Destructuring with alias — key is "createdAt", local name is "joinedAt"
const { createdAt: joinedAt } = response;

// 5. Nested destructuring
const { address: { city, zipCode } } = response;

// 6. JSX expression (property access, already caught by rule 1)
// <p>{user.displayName}</p>  — equivalent to:
const jsx = user.displayName;

// 7. Template literal (property access, already caught by rule 1)
const msg = `Hello ${user.firstName}`;

// 8. Dynamic bracket access — must NOT be tracked (conservative rule)
const dynamic = response[key];
