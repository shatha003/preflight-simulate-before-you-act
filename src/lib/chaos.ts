import { withLock, type Db } from "./db";

/**
 * Failure-test helper: another writer changes the data while a human is reviewing.
 * It adds customers that match the broad filters used by the three actions
 * (dormant, opted in, half with a recent payment and half with an old one), so whichever action is pending now touches more
 * rows than the preview showed.
 */
export function concurrentWriter(db: Db, n = 40): Promise<number> {
  return withLock(async () => {
    await db.exec("begin");
    try {
      const start = (await db.query<{ m: number }>("select coalesce(max(id),0) as m from customers")).rows[0].m;
      await db.query(
        `insert into customers(id, name, email, plan, status, marketing_opt_in, last_active_at)
         select $1 + g, 'Imported ' || g, 'imported' || g || '@example.com', 'pro', 'inactive', true, now() - interval '400 days'
         from generate_series(1, $2::int) g`,
        [start, n],
      );
      await db.query(
        `insert into orders(id, customer_id, total_cents, status, created_at)
         select (select coalesce(max(id),0) from orders) + g, $1 + g, 4900, 'paid',
                now() - case when g % 2 = 0 then interval '10 days' else interval '400 days' end
         from generate_series(1, $2::int) g`,
        [start, n],
      );
      await db.query(
        `insert into payments(id, order_id, customer_id, amount_cents, status, refunded_cents, captured_at)
         select (select coalesce(max(id),0) from payments) + g,
                (select max(id) from orders) - $2::int + g, $1 + g, 4900, 'captured', 0,
                now() - case when g % 2 = 0 then interval '10 days' else interval '400 days' end
         from generate_series(1, $2::int) g`,
        [start, n],
      );
      await db.exec("commit");
      return n;
    } catch (e) {
      await db.exec("rollback");
      throw e;
    }
  });
}
