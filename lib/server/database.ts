export type SqlValue = string | number | null;
export type Statement = { sql: string; params: SqlValue[] };
export type SqlResult = { rows: Record<string, any>[]; changes: number };
/** batch must be one transaction: all statements commit or all roll back. */
export interface Database { batch(statements: Statement[]): Promise<SqlResult[]> }
export const statement = (sql: string, ...params: SqlValue[]): Statement => ({ sql, params });
export async function query(db: Database, sql: string, ...params: SqlValue[]) {
  return (await db.batch([statement(sql, ...params)]))[0].rows;
}
