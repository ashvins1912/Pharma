export type OperationStatus =
  | 'Completed'
  | 'Active'
  | 'Pending'
  | 'In Review'
  | 'Failed'
  | 'Blocked';

export type OperationCategory =
  | 'Fulfillment'
  | 'Inventory'
  | 'Compliance'
  | 'Security'
  | 'Billing';

export type OperationViewMode = 'grid' | 'list';

export type OperationTabId = 'all' | 'pending' | 'completed' | 'audit';

export interface OperationStep {
  id: string;
  label: string;
  owner: string;
  done: boolean;
}

export interface AdminOperationRecord {
  id: string;
  code: string;
  title: string;
  description: string;
  category: OperationCategory;
  status: OperationStatus;
  assignee: string;
  updatedAt: string;
  tenantName: string;
  slaTarget: string;
  steps: OperationStep[];
}

export interface AdminAuditRecord {
  id: string;
  operationId: string;
  operationCode: string;
  operationTitle: string;
  actor: string;
  action: string;
  status: OperationStatus;
  timestamp: string;
  summary: string;
}

export function getStatusPillClasses(status: OperationStatus): string {
  switch (status) {
    case 'Completed':
    case 'Active':
      return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
    case 'Pending':
    case 'In Review':
      return 'bg-amber-50 text-amber-800 border border-amber-200';
    case 'Failed':
    case 'Blocked':
      return 'bg-rose-50 text-rose-700 border border-rose-200';
    default:
      return 'bg-slate-100 text-slate-700 border border-slate-200';
  }
}
