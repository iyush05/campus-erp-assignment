export type RecordKind = 'markExport' | 'order' | 'period' | 'fee' | 'feeRule' | 'admission' | 'document' | 'guardian' | 'consent' | 'leave' | 'message' | 'bank' | 'privacy' | 'risk' | 'job';
export type ERPRecord = { id: string; kind: RecordKind; version: number; createdAt: string; updatedAt: string; createdBy: string; data: Record<string, any> };
export type ERPState = { records: ERPRecord[] };
export const emptyERP = (): ERPState => ({ records: [] });
