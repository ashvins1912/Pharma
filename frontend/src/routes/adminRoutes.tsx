import React from 'react';
import {
  Link,
  Outlet,
  RouteObject,
  ScrollRestoration,
  createBrowserRouter,
  useLocation
} from 'react-router-dom';
import AdminOperationScreen from '../screens/AdminOperationScreen';
import { useAuth } from '../context/AuthContext';

const LegacyApp = React.lazy(() => import('../App.jsx'));

const OPERATION_ROUTE_PERMISSIONS = [
  'orders.read',
  'orders.manage',
  'inventory.read',
  'medicine_requests.read',
  'delivery.read',
  'users.read',
  'tenants.read',
  'csquare.read',
  'billing.read',
  'promotions.read'
];

export function RequireAdminOperationsAccess({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (!auth || auth.loading || auth.authTransitionLoading) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col items-center text-center gap-3">
          <div className="h-9 w-9 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" aria-hidden="true" />
          <span className="text-sm font-semibold text-slate-900">Verifying operator credentials...</span>
          <span className="text-xs text-slate-500">Checking role permissions for {location.pathname}</span>
        </div>
      </div>
    );
  }

  const hasOperatorAccess = Boolean(
    auth.user &&
      auth.isFullyAuthenticated &&
      (auth.isAdmin ||
        auth.isSuperAdmin ||
        auth.canAccessOperations ||
        (typeof auth.hasAnyPermission === 'function' &&
          auth.hasAnyPermission(OPERATION_ROUTE_PERMISSIONS)))
  );

  if (!hasOperatorAccess) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center justify-center p-6">
        <section
          aria-labelledby="operations-access-guard-title"
          className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-xs flex flex-col gap-4"
        >
          <div className="flex flex-row items-center justify-between gap-2">
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
              Restricted Route
            </span>
            <span className="text-xs font-mono text-slate-500">{location.pathname}</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <h1 id="operations-access-guard-title" className="text-xl font-bold text-slate-900">
              Admin Operations Access Required
            </h1>
            <p className="text-sm text-slate-600">
              {auth.user
                ? 'Your current account does not hold operational RBAC permissions for the Dispensary Operations Center.'
                : 'Sign in with an authorized Pharmacist, Operations Staff, or Admin account to open this route.'}
            </p>
          </div>

          <div className="flex flex-row flex-wrap items-center gap-3 pt-2">
            <Link
              to="/"
              className="min-h-11 min-w-11 px-4 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium flex flex-row items-center justify-center whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              <span>Return to Storefront</span>
            </Link>
            <Link
              to="/?view=signin"
              className="min-h-11 min-w-11 px-4 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 text-sm font-medium flex flex-row items-center justify-center whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              <span>Switch Account</span>
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return <>{children}</>;
}

export function AdminOperationsLayout() {
  return (
    <RequireAdminOperationsAccess>
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
        <Outlet />
        <ScrollRestoration getKey={location => location.pathname} />
      </div>
    </RequireAdminOperationsAccess>
  );
}

export function AdminOperationRouteNotFound() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center justify-center p-6">
      <section className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col items-center text-center gap-3">
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200">
          Route Not Found
        </span>
        <h1 className="text-lg font-bold text-slate-900">Unknown Operations View</h1>
        <p className="text-sm text-slate-600">
          Select an operation queue or return to the main Dispensary Operations Center.
        </p>
        <Link
          to="/admin/operations"
          className="min-h-11 min-w-11 px-4 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium flex flex-row items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          <span>Go to Operations Center</span>
        </Link>
      </section>
    </div>
  );
}

export function RootAppFallback() {
  return (
    <React.Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 text-slate-600 flex flex-col items-center justify-center p-6">
          <span className="text-sm font-medium">Loading application...</span>
        </div>
      }
    >
      <LegacyApp />
    </React.Suspense>
  );
}

export const adminOperationRoutes: RouteObject[] = [
  {
    path: '/admin/operations',
    element: <AdminOperationsLayout />,
    children: [
      {
        index: true,
        element: <AdminOperationScreen defaultTab="all" />
      },
      {
        path: 'pending',
        element: <AdminOperationScreen defaultTab="pending" />
      },
      {
        path: 'completed',
        element: <AdminOperationScreen defaultTab="completed" />
      },
      {
        path: 'audit',
        element: <AdminOperationScreen defaultTab="audit" />
      },
      {
        path: ':operationId',
        element: <AdminOperationScreen />
      },
      {
        path: '*',
        element: <AdminOperationRouteNotFound />
      }
    ]
  }
];

export const appRoutes: RouteObject[] = [
  ...adminOperationRoutes,
  {
    path: '*',
    element: <RootAppFallback />
  }
];

export function createAdminRouter(routes: RouteObject[] = appRoutes) {
  return createBrowserRouter(routes);
}

export const appRouter = createAdminRouter();

export default adminOperationRoutes;
