// Schema + deterministic seed for the demo "back office" system.
// This is a real Postgres (PGlite, WASM) database with FKs that cascade and triggers
// that fire side effects, so a dry run exercises the same code paths as the real run.

export const TABLES = ["customers", "orders", "payments", "ledger", "outbox", "trash"] as const;
export type TableName = (typeof TABLES)[number];

export const SCHEMA_SQL = `
create table customers (
  id serial primary key,
  name text not null,
  email text not null,
  plan text not null,
  status text not null default 'active',
  marketing_opt_in boolean not null default true,
  last_active_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table orders (
  id serial primary key,
  customer_id int not null references customers(id) on delete cascade,
  total_cents int not null,
  status text not null default 'paid',
  created_at timestamptz not null
);

create table payments (
  id serial primary key,
  order_id int not null references orders(id) on delete cascade,
  customer_id int not null,
  amount_cents int not null,
  status text not null default 'captured',
  refunded_cents int not null default 0,
  captured_at timestamptz not null
);

create table ledger (
  id serial primary key,
  kind text not null,
  amount_cents int not null,
  ref text,
  created_at timestamptz not null default now()
);

create table outbox (
  id serial primary key,
  customer_id int,
  kind text not null,
  subject text not null,
  status text not null default 'held',
  created_at timestamptz not null default now()
);

create table trash (
  id serial primary key,
  source text not null,
  row_data jsonb not null,
  deleted_at timestamptz not null default now()
);

-- Side effect #1: a refund writes the ledger and queues a receipt email.
create function on_payment_refund() returns trigger as $$
begin
  if new.status = 'refunded' and old.status = 'captured' then
    insert into ledger(kind, amount_cents, ref)
      values ('refund', -new.refunded_cents, 'payment:' || new.id);
    insert into outbox(customer_id, kind, subject)
      values (new.customer_id, 'refund_receipt',
              'Your refund of $' || (new.refunded_cents / 100.0)::numeric(10,2) || ' is on the way');
  end if;
  return new;
end $$ language plpgsql;

create trigger trg_refund after update on payments
  for each row execute function on_payment_refund();

-- Side effect #2: deleting a customer archives only the customer row.
-- Orders and payments cascade away with NO archive. That is the trap.
create function archive_customer() returns trigger as $$
begin
  insert into trash(source, row_data) values ('customers', to_jsonb(old));
  return old;
end $$ language plpgsql;

create trigger trg_archive before delete on customers
  for each row execute function archive_customer();
`;

// Small deterministic PRNG so every visitor gets the same dataset.
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const FIRST = ["Ava", "Noah", "Mia", "Liam", "Zoe", "Omar", "Lena", "Kai", "Iris", "Theo", "Nora", "Ravi", "Sana", "Leo", "Maya", "Jonas", "Yara", "Finn", "Dara", "Eli"];
const LAST = ["Stone", "Rivera", "Khan", "Novak", "Bauer", "Okafor", "Silva", "Ito", "Moreau", "Haddad", "Lindqvist", "Patel", "Costa", "Weiss", "Nakamura"];

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function seedSql(): string {
  const rnd = lcg(42);
  const day = 86_400_000;
  const base = Date.now(); // ages are relative to seed time; the random draw itself is fixed
  const iso = (daysAgo: number) => new Date(base - daysAgo * day).toISOString();

  const customers: string[] = [];
  const orders: string[] = [];
  const payments: string[] = [];
  let orderId = 1;
  let paymentId = 1;

  for (let id = 1; id <= 240; id++) {
    const first = FIRST[Math.floor(rnd() * FIRST.length)];
    const last = LAST[Math.floor(rnd() * LAST.length)];
    const r = rnd();
    const plan = r < 0.5 ? "free" : r < 0.85 ? "pro" : "team";
    const dormant = rnd() < 0.27; // not seen in 200-700 days
    const lastActive = dormant ? 200 + Math.floor(rnd() * 500) : Math.floor(rnd() * 60);
    const optIn = rnd() < 0.82;
    customers.push(
      `(${id},${q(`${first} ${last}`)},${q(`${first}.${last}${id}@example.com`.toLowerCase())},${q(plan)},${q(dormant ? "inactive" : "active")},${optIn},${q(iso(lastActive))},${q(iso(lastActive + 30 + Math.floor(rnd() * 300)))})`,
    );

    if (plan === "free" && rnd() < 0.7) continue;
    const nOrders = plan === "free" ? 1 : 1 + Math.floor(rnd() * 3);
    for (let o = 0; o < nOrders; o++) {
      const amount = plan === "team" ? 19_900 + Math.floor(rnd() * 20) * 500 : plan === "pro" ? 2_900 + Math.floor(rnd() * 8) * 500 : 900 + Math.floor(rnd() * 4) * 300;
      // Dormant customers sometimes hold an annual plan: recent money, old activity.
      const annual = dormant && plan !== "free" && rnd() < 0.5;
      const age = annual ? 20 + Math.floor(rnd() * 300) : lastActive + Math.floor(rnd() * 120);
      orders.push(`(${orderId},${id},${amount},'paid',${q(iso(age))})`);
      payments.push(`(${paymentId},${orderId},${id},${amount},'captured',0,${q(iso(age))})`);
      orderId++;
      paymentId++;
    }
  }

  return `
insert into customers(id,name,email,plan,status,marketing_opt_in,last_active_at,created_at) values ${customers.join(",")};
insert into orders(id,customer_id,total_cents,status,created_at) values ${orders.join(",")};
insert into payments(id,order_id,customer_id,amount_cents,status,refunded_cents,captured_at) values ${payments.join(",")};
select setval('customers_id_seq',(select max(id) from customers));
select setval('orders_id_seq',(select max(id) from orders));
select setval('payments_id_seq',(select max(id) from payments));
`;
}
