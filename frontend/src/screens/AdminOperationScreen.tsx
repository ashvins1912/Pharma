import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import AdaptiveHeader from '../components/admin/AdaptiveHeader';
import ScrollSafeTabs, { ScrollSafeTabDefinition } from '../components/admin/ScrollSafeTabs';
import OperationCollection from '../components/admin/OperationCollection';
import {
  AdminAuditRecord,
  AdminOperationRecord,
  OperationCategory,
  OperationStatus,
  OperationViewMode,
  getStatusPillClasses
} from '../types/adminOperations';

const INITIAL_OPERATIONS: AdminOperationRecord[] = [
  {
    id: 'op-101',
    code: 'OPS-4821',
    title: 'Schedule-H Prescription Verification Batch',
    description: 'Validate pharmacist sign-off on 18 queued Schedule-H antimicrobial orders before dispatch cutoff.',
    category: 'Compliance',
    status: 'Pending',
    assignee: 'Dr. Kavya Nair',
    updatedAt: 'Today, 09:40 IST',
    tenantName: 'Indiranagar Central Dispensary',
    slaTarget: '30 min SLA',
    steps: [
      { id: 's1', label: 'Cross-check uploaded Rx signatures', owner: 'Dr. Kavya Nair', done: true },
      { id: 's2', label: 'Confirm prescriber registration ID', owner: 'Compliance Desk', done: false },
      { id: 's3', label: 'Release verified orders to packing bay', owner: 'Dispatch Lead', done: false }
    ]
  },
  {
    id: 'op-102',
    code: 'OPS-4822',
    title: 'Cold-Chain Insulin Dispatch Allocation',
    description: 'Assign insulated courier pouches and verify thermal logger calibration across Zone-2 routes.',
    category: 'Fulfillment',
    status: 'In Review',
    assignee: 'Rohan Deshmukh',
    updatedAt: 'Today, 09:22 IST',
    tenantName: 'Koramangala Hub #04',
    slaTarget: '45 min SLA',
    steps: [
      { id: 's1', label: 'Calibrate 2-8C gel pack sensors', owner: 'Cold-Chain Team', done: true },
      { id: 's2', label: 'Pair manifests with rider terminal', owner: 'Rohan Deshmukh', done: false }
    ]
  },
  {
    id: 'op-103',
    code: 'OPS-4819',
    title: 'Near-Expiry Amoxicillin Surplus Transfer',
    description: 'Approve inter-branch stock rebalancing for 140 blister packs expiring in 45 days.',
    category: 'Inventory',
    status: 'Completed',
    assignee: 'Ananya Chatterjee',
    updatedAt: 'Today, 08:55 IST',
    tenantName: 'Bengaluru Metro Network',
    slaTarget: '2 hr SLA',
    steps: [
      { id: 's1', label: 'Audit batch numbers and MRP labels', owner: 'Ananya Chatterjee', done: true },
      { id: 's2', label: 'Update receiving branch stock ledger', owner: 'Inventory Sync', done: true }
    ]
  },
  {
    id: 'op-104',
    code: 'OPS-4817',
    title: 'Staff Role Elevation & Audit Policy Sync',
    description: 'Propagate updated Pharmacy Staff permissions across Gateway and Admin Control Plane.',
    category: 'Security',
    status: 'Active',
    assignee: 'Arjun Kulkarni',
    updatedAt: 'Today, 08:15 IST',
    tenantName: 'Platform Control Plane',
    slaTarget: '15 min SLA',
    steps: [
      { id: 's1', label: 'Review RBAC diff and permission version', owner: 'Arjun Kulkarni', done: true },
      { id: 's2', label: 'Monitor gateway token revalidation', owner: 'Security Ops', done: true }
    ]
  },
  {
    id: 'op-105',
    code: 'OPS-4815',
    title: 'Distributor C-Square Settlement Reconciliation',
    description: 'Mismatch detected on GST invoice #CSQ-99214 during automated ERP ledger synchronization.',
    category: 'Billing',
    status: 'Blocked',
    assignee: 'Meera Iyer',
    updatedAt: 'Yesterday, 19:10 IST',
    tenantName: 'Whitefield Flagship',
    slaTarget: '4 hr SLA',
    steps: [
      { id: 's1', label: 'Flagged tax rate variance on 4 SKUs', owner: 'Billing Bot', done: true },
      { id: 's2', label: 'Await supplier credit note upload', owner: 'Meera Iyer', done: false }
    ]
  },
  {
    id: 'op-106',
    code: 'OPS-4812',
    title: 'Controlled Narcotics Daily Register Seal',
    description: 'Digitally countersign closing stock register and archive immutable compliance snapshot.',
    category: 'Compliance',
    status: 'Completed',
    assignee: 'Dr. Kavya Nair',
    updatedAt: 'Yesterday, 18:05 IST',
    tenantName: 'Indiranagar Central Dispensary',
    slaTarget: 'Daily 18:30',
    steps: [
      { id: 's1', label: 'Verify physical bin count', owner: 'Chief Pharmacist', done: true },
      { id: 's2', label: 'Sign regulatory ledger digest', owner: 'Dr. Kavya Nair', done: true }
    ]
  }
];

const INITIAL_AUDIT_LOGS: AdminAuditRecord[] = [
  {
    id: 'aud-1',
    operationId: 'op-104',
    operationCode: 'OPS-4817',
    operationTitle: 'Staff Role Elevation & Audit Policy Sync',
    actor: 'Arjun Kulkarni',
    action: 'POLICY_HOT_RELOAD',
    status: 'Active',
    timestamp: 'Today, 08:16 IST',
    summary: 'Published permissionVersion v14 for PHARMACY_STAFF across API Gateway and backend.'
  },
  {
    id: 'aud-2',
    operationId: 'op-105',
    operationCode: 'OPS-4815',
    operationTitle: 'Distributor C-Square Settlement Reconciliation',
    actor: 'Meera Iyer',
    action: 'SETTLEMENT_HOLD_APPLIED',
    status: 'Blocked',
    timestamp: 'Yesterday, 19:12 IST',
    summary: 'Placed payout on hold pending credit note reconciliation for INR 14,820 GST variance.'
  },
  {
    id: 'aud-3',
    operationId: 'op-103',
    operationCode: 'OPS-4819',
    operationTitle: 'Near-Expiry Amoxicillin Surplus Transfer',
    actor: 'Ananya Chatterjee',
    action: 'STOCK_TRANSFER_COMPLETED',
    status: 'Completed',
    timestamp: 'Today, 08:55 IST',
    summary: 'Reallocated 140 packs from HSR Store to Koramangala Hub #04 without spoilage.'
  },
  {
    id: 'aud-4',
    operationId: 'op-101',
    operationCode: 'OPS-4821',
    operationTitle: 'Schedule-H Prescription Verification Batch',
    actor: 'System Guard',
    action: 'VERIFICATION_QUEUE_OPENED',
    status: 'Pending',
    timestamp: 'Today, 09:40 IST',
    summary: 'Queued 18 high-priority prescriptions requiring pharmacist verification prior to dispatch.'
  }
];

const CATEGORIES: Array<'ALL' | OperationCategory> = [
  'ALL',
  'Fulfillment',
  'Inventory',
  'Compliance',
  'Security',
  'Billing'
];

interface OperationTabContentProps {
  tabKey: string;
  operations: AdminOperationRecord[];
  view: OperationViewMode;
  onViewChange: (view: OperationViewMode) => void;
  isLoading: boolean;
  onSelectOperation: (operation: AdminOperationRecord) => void;
}

function OperationTabPanel({
  tabKey,
  operations,
  view,
  onViewChange,
  isLoading,
  onSelectOperation
}: OperationTabContentProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'ALL' | OperationCategory>('ALL');

  const filteredOperations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return operations.filter(op => {
      if (selectedCategory !== 'ALL' && op.category !== selectedCategory) return false;
      if (!query) return true;
      return (
        op.title.toLowerCase().includes(query) ||
        op.description.toLowerCase().includes(query) ||
        op.code.toLowerCase().includes(query) ||
        op.assignee.toLowerCase().includes(query)
      );
    });
  }, [operations, searchQuery, selectedCategory]);

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedCategory('ALL');
  };

  return (
    <OperationCollection
      operations={filteredOperations}
      view={view}
      onViewChange={onViewChange}
      isLoading={isLoading}
      onSelectOperation={onSelectOperation}
      onResetFilters={resetFilters}
      toolbarLeft={
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1 min-w-0">
          <div className="flex flex-row items-center flex-1 min-w-[200px] bg-white border border-slate-200 rounded-lg px-3 min-h-11 shadow-xs">
            <label htmlFor={`search-${tabKey}`} className="sr-only">
              Search operations
            </label>
            <input
              id={`search-${tabKey}`}
              type="search"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="Search code, title, or assignee..."
              className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-row items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            {CATEGORIES.map(category => {
              const active = selectedCategory === category;
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setSelectedCategory(category)}
                  className={`min-h-11 min-w-11 px-3 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
                    active
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <span>{category === 'ALL' ? 'All Categories' : category}</span>
                </button>
              );
            })}
          </div>
        </div>
      }
    />
  );
}

export interface AdminOperationScreenProps {
  defaultTab?: 'all' | 'pending' | 'completed' | 'audit';
}

export default function AdminOperationScreen({ defaultTab = 'all' }: AdminOperationScreenProps) {
  const { operationId } = useParams<{ operationId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [operations, setOperations] = useState<AdminOperationRecord[]>(INITIAL_OPERATIONS);
  const [auditLogs, setAuditLogs] = useState<AdminAuditRecord[]>(INITIAL_AUDIT_LOGS);
  const [auditSearch, setAuditSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const viewParam = searchParams.get('view');
  const activeView: OperationViewMode = viewParam === 'list' ? 'list' : 'grid';

  const handleViewChange = (nextView: OperationViewMode) => {
    setSearchParams(
      prev => {
        const updated = new URLSearchParams(prev);
        updated.set('view', nextView);
        return updated;
      },
      { preventScrollReset: true }
    );
  };

  const handleOpenOperation = (targetId: string) => {
    const queryString = searchParams.toString();
    navigate(`/admin/operations/${encodeURIComponent(targetId)}${queryString ? `?${queryString}` : ''}`);
  };

  const selectedOperationIndex = useMemo(
    () => (operationId ? operations.findIndex(op => op.id === operationId) : -1),
    [operations, operationId]
  );

  const selectedOperation =
    selectedOperationIndex >= 0 ? operations[selectedOperationIndex] : null;

  const prevOperation = useMemo(() => {
    if (selectedOperationIndex > 0) {
      const target = operations[selectedOperationIndex - 1];
      return { id: target.id, title: target.title };
    }
    return null;
  }, [operations, selectedOperationIndex]);

  const nextOperation = useMemo(() => {
    if (selectedOperationIndex >= 0 && selectedOperationIndex < operations.length - 1) {
      const target = operations[selectedOperationIndex + 1];
      return { id: target.id, title: target.title };
    }
    if (!operationId && operations.length > 0) {
      return { id: operations[0].id, title: operations[0].title };
    }
    return null;
  }, [operations, selectedOperationIndex, operationId]);

  // Brief simulated refresh trigger so skeleton states can be previewed cleanly
  const triggerRefresh = () => {
    setIsLoading(true);
  };

  useEffect(() => {
    if (!isLoading) return undefined;
    const timer = window.setTimeout(() => {
      setIsLoading(false);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [isLoading]);

  const handleUpdateOperationStatus = (targetOp: AdminOperationRecord, nextStatus: OperationStatus) => {
    setOperations(prev =>
      prev.map(op =>
        op.id === targetOp.id
          ? {
              ...op,
              status: nextStatus,
              updatedAt: 'Just now',
              steps:
                nextStatus === 'Completed'
                  ? op.steps.map(step => ({ ...step, done: true }))
                  : op.steps
            }
          : op
      )
    );

    const newAudit: AdminAuditRecord = {
      id: `aud-${Date.now()}`,
      operationId: targetOp.id,
      operationCode: targetOp.code,
      operationTitle: targetOp.title,
      actor: 'Operations Lead',
      action: `STATUS_CHANGED_TO_${nextStatus.toUpperCase().replace(/\s+/g, '_')}`,
      status: nextStatus,
      timestamp: 'Just now',
      summary: `Updated ${targetOp.code} workflow status from ${targetOp.status} to ${nextStatus}.`
    };
    setAuditLogs(prev => [newAudit, ...prev]);
  };

  const handleToggleStep = (targetOp: AdminOperationRecord, stepId: string) => {
    setOperations(prev =>
      prev.map(op =>
        op.id === targetOp.id
          ? {
              ...op,
              steps: op.steps.map(step =>
                step.id === stepId ? { ...step, done: !step.done } : step
              ),
              updatedAt: 'Just now'
            }
          : op
      )
    );
  };

  const pendingOperations = useMemo(
    () => operations.filter(op => op.status === 'Pending' || op.status === 'In Review' || op.status === 'Blocked' || op.status === 'Failed'),
    [operations]
  );

  const completedOperations = useMemo(
    () => operations.filter(op => op.status === 'Completed' || op.status === 'Active'),
    [operations]
  );

  const filteredAuditLogs = useMemo(() => {
    const query = auditSearch.trim().toLowerCase();
    if (!query) return auditLogs;
    return auditLogs.filter(
      entry =>
        entry.operationTitle.toLowerCase().includes(query) ||
        entry.operationCode.toLowerCase().includes(query) ||
        entry.actor.toLowerCase().includes(query) ||
        entry.summary.toLowerCase().includes(query)
    );
  }, [auditLogs, auditSearch]);

  const kpiCards = useMemo(() => {
    const pendingCount = operations.filter(op => op.status === 'Pending' || op.status === 'In Review').length;
    const completedCount = operations.filter(op => op.status === 'Completed' || op.status === 'Active').length;
    const blockedCount = operations.filter(op => op.status === 'Blocked' || op.status === 'Failed').length;

    return [
      { label: 'Total Operations', value: operations.length, caption: 'All active & archived queues' },
      { label: 'Pending Review', value: pendingCount, caption: 'Awaiting pharmacist or ops action' },
      { label: 'Completed & Active', value: completedCount, caption: 'Verified within SLA window' },
      { label: 'Blocked / Alerts', value: blockedCount, caption: 'Requires manual escalation' }
    ];
  }, [operations]);

  const tabs: ScrollSafeTabDefinition[] = useMemo(
    () => [
      {
        id: 'all',
        label: 'All Operations',
        count: operations.length,
        renderPanel: () => (
          <OperationTabPanel
            tabKey="all"
            operations={operations}
            view={activeView}
            onViewChange={handleViewChange}
            isLoading={isLoading}
            onSelectOperation={op => handleOpenOperation(op.id)}
          />
        )
      },
      {
        id: 'pending',
        label: 'Pending',
        count: pendingOperations.length,
        renderPanel: () => (
          <OperationTabPanel
            tabKey="pending"
            operations={pendingOperations}
            view={activeView}
            onViewChange={handleViewChange}
            isLoading={isLoading}
            onSelectOperation={op => handleOpenOperation(op.id)}
          />
        )
      },
      {
        id: 'completed',
        label: 'Completed',
        count: completedOperations.length,
        renderPanel: () => (
          <OperationTabPanel
            tabKey="completed"
            operations={completedOperations}
            view={activeView}
            onViewChange={handleViewChange}
            isLoading={isLoading}
            onSelectOperation={op => handleOpenOperation(op.id)}
          />
        )
      },
      {
        id: 'audit',
        label: 'Audit Logs',
        count: auditLogs.length,
        renderPanel: () => (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-row items-center flex-1 max-w-md bg-white border border-slate-200 rounded-lg px-3 min-h-11 shadow-xs">
                <label htmlFor="audit-log-search" className="sr-only">
                  Search audit logs
                </label>
                <input
                  id="audit-log-search"
                  type="search"
                  value={auditSearch}
                  onChange={event => setAuditSearch(event.target.value)}
                  placeholder="Filter audit trail by actor, code, or action..."
                  className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none"
                />
              </div>
              <span className="text-xs text-slate-500 tabular-nums">
                Showing {filteredAuditLogs.length} of {auditLogs.length} records
              </span>
            </div>

            <div className="flex flex-col bg-white border border-slate-200 rounded-xl divide-y divide-slate-200 overflow-hidden shadow-xs">
              {filteredAuditLogs.map(entry => (
                <article
                  key={entry.id}
                  className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex flex-col gap-1 flex-1 min-w-0">
                    <div className="flex flex-row flex-wrap items-center gap-2">
                      <span className="text-xs font-mono font-semibold text-slate-600 tabular-nums">
                        {entry.operationCode}
                      </span>
                      <span className="text-sm font-semibold text-slate-900">
                        {entry.operationTitle}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600">{entry.summary}</p>
                    <div className="flex flex-row flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>{entry.actor}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{entry.action}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{entry.timestamp}</span>
                    </div>
                  </div>

                  <div className="flex flex-row items-center gap-3 shrink-0">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${getStatusPillClasses(entry.status)}`}>
                      {entry.status}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleOpenOperation(entry.operationId)}
                      className="min-h-11 min-w-11 px-3 rounded-lg flex flex-row items-center justify-center text-sm font-medium text-blue-600 hover:bg-blue-50 whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                    >
                      <span>Open</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )
      }
    ],
    [operations, pendingOperations, completedOperations, auditLogs, filteredAuditLogs, auditSearch, activeView, isLoading]
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <AdaptiveHeader
        pageTitle="Admin Operations"
        operationName={selectedOperation?.title}
        backTo={selectedOperation ? '/admin/operations' : '/'}
        backLabel={selectedOperation ? 'Back to operations list' : 'Back to home'}
        prevOperation={prevOperation}
        nextOperation={nextOperation}
        siblingPositionLabel={
          selectedOperationIndex >= 0
            ? `${selectedOperationIndex + 1} / ${operations.length}`
            : undefined
        }
        onSelectOperation={handleOpenOperation}
        rightSlot={
          !selectedOperation ? (
            <button
              type="button"
              onClick={triggerRefresh}
              className="min-h-11 min-w-11 flex flex-row items-center justify-center px-3.5 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              <span>{isLoading ? 'Syncing...' : 'Refresh'}</span>
            </button>
          ) : undefined
        }
      />

      <main className="flex-1 flex flex-col w-full max-w-[1440px] mx-auto px-4 sm:px-6 py-6 gap-6">
        {/* Page Heading */}
        <section className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold text-slate-900">
              {selectedOperation ? selectedOperation.title : 'Dispensary Operations Center'}
            </h1>
            <p className="text-sm text-slate-600">
              {selectedOperation
                ? `${selectedOperation.code} · ${selectedOperation.tenantName} · ${selectedOperation.slaTarget}`
                : 'Coordinate fulfillment queues, compliance sign-offs, stock transfers, and audit activity in real time.'}
            </p>
          </div>

          {selectedOperation && (
            <div className="flex flex-row flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleUpdateOperationStatus(selectedOperation, 'Completed')}
                className="min-h-11 min-w-11 px-4 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium flex flex-row items-center justify-center whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
              >
                <span>Approve &amp; Complete</span>
              </button>
              <button
                type="button"
                onClick={() => handleUpdateOperationStatus(selectedOperation, 'Pending')}
                className="min-h-11 min-w-11 px-4 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 text-sm font-medium flex flex-row items-center justify-center whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
              >
                <span>Return to Pending</span>
              </button>
              <button
                type="button"
                onClick={() => handleUpdateOperationStatus(selectedOperation, 'Blocked')}
                className="min-h-11 min-w-11 px-4 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 text-sm font-medium flex flex-row items-center justify-center whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
              >
                <span>Flag Blocked</span>
              </button>
            </div>
          )}
        </section>

        {/* Operation Detail Route View (/admin/operations/:operationId) */}
        {operationId && !selectedOperation ? (
          <section className="bg-white border border-slate-200 rounded-xl p-8 flex flex-col items-center justify-center text-center gap-3 shadow-xs">
            <h2 className="text-lg font-semibold text-slate-900">Operation record not found</h2>
            <p className="text-sm text-slate-600 max-w-md">
              The requested operation ID could not be located in the active operations directory.
            </p>
            <button
              type="button"
              onClick={() => navigate('/admin/operations')}
              className="min-h-11 min-w-11 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              <span>Return to Operations</span>
            </button>
          </section>
        ) : selectedOperation ? (
          <div className="flex flex-col gap-6">
            {/* Summary Strip */}
            <div className="flex flex-row gap-4 overflow-x-auto lg:flex-wrap no-scrollbar">
              <div className="bg-white border border-slate-200 rounded-xl p-4 flex-1 min-w-[160px] flex flex-col gap-2 shadow-xs">
                <span className="text-xs font-medium text-slate-500">Current Status</span>
                <div className="flex flex-row items-center">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${getStatusPillClasses(selectedOperation.status)}`}>
                    {selectedOperation.status}
                  </span>
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4 flex-1 min-w-[160px] flex flex-col gap-1 shadow-xs">
                <span className="text-xs font-medium text-slate-500">Category</span>
                <span className="text-lg font-semibold text-slate-900">{selectedOperation.category}</span>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4 flex-1 min-w-[160px] flex flex-col gap-1 shadow-xs">
                <span className="text-xs font-medium text-slate-500">Assigned Lead</span>
                <span className="text-lg font-semibold text-slate-900">{selectedOperation.assignee}</span>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4 flex-1 min-w-[160px] flex flex-col gap-1 shadow-xs">
                <span className="text-xs font-medium text-slate-500">Last Updated</span>
                <span className="text-lg font-semibold text-slate-900 tabular-nums">{selectedOperation.updatedAt}</span>
              </div>
            </div>

            {/* Workflow Checklist Card */}
            <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4 shadow-xs">
              <div className="flex flex-col gap-1 border-b border-slate-100 pb-3">
                <h2 className="text-base font-semibold text-slate-900">Execution Checklist</h2>
                <p className="text-sm text-slate-600">{selectedOperation.description}</p>
              </div>

              <div className="flex flex-col divide-y divide-slate-200">
                {selectedOperation.steps.map(step => (
                  <div
                    key={step.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className={`text-sm font-medium ${step.done ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
                        {step.label}
                      </span>
                      <span className="text-xs text-slate-500">Owner: {step.owner}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleToggleStep(selectedOperation, step.id)}
                      className={`min-h-11 min-w-11 px-3.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
                        step.done
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                          : 'bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200'
                      }`}
                    >
                      <span>{step.done ? 'Completed' : 'Mark Complete'}</span>
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : (
          /* Operations Directory & Scroll-Safe Multi-Tabs (/admin/operations) */
          <>
            {/* KPI Summary Strip (Strictly Flexbox) */}
            <section aria-label="Operations summary metrics" className="flex flex-row gap-4 overflow-x-auto lg:flex-wrap no-scrollbar">
              {kpiCards.map(card => (
                <div
                  key={card.label}
                  className="bg-white border border-slate-200 rounded-xl p-4 flex-1 min-w-[160px] flex flex-col justify-between gap-2 shadow-xs"
                >
                  <span className="text-xs font-medium text-slate-500">{card.label}</span>
                  <span className="text-2xl font-bold text-slate-900 tabular-nums">{card.value}</span>
                  <span className="text-xs text-slate-600">{card.caption}</span>
                </div>
              ))}
            </section>

            {/* Keep-Alive Scroll & Focus Preserving Tabs */}
            <ScrollSafeTabs tabs={tabs} paramKey="tab" defaultTabId={defaultTab} />
          </>
        )}
      </main>
    </div>
  );
}
