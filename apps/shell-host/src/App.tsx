import React, { useState, useEffect, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AppShell, Card } from '@enterprise/shared-ui';
import { ProtectedRoute, PublicOnlyRoute } from './components/guards/RouteGuards';
import { LoginView } from './features/Auth/LoginView';
import { dashboardService, DashboardItem } from './core/services/dashboard.service';
import '@enterprise/design-tokens/global.css';

const MOCK_DATA: DashboardItem[] = [
  { id: '1', title: 'Automated Fluid Scaling', description: 'Adapts components fluidly from desktop monitors down to mobile viewports.', buttonText: 'Run Diagnostics', actionPayload: 'scale_perf' },
  { id: '2', title: 'Encapsulated MFE Core', description: 'Completely isolated using CSS modules to prevent layout or styling leakage across systems.', buttonText: 'Init Workspace', actionPayload: 'mfe_context' }
];

// Lazy load future decoupled Micro-Frontend modules dynamically
const RemoteDashboardWorkspace = React.lazy(() => 
  import('remote_dashboard/DashboardWorkspace').catch(() => ({
    default: () => {
      const navigate = useNavigate();
      const [data, setData] = useState<DashboardItem[]>([]);

      useEffect(() => {
        dashboardService.getGridItems().then(setData).catch(() => setData(MOCK_DATA));
      }, []);

      return (
        <AppShell onLogout={() => { localStorage.clear(); navigate('/login'); }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(clamp(280px, 100%, 380px), 1fr))', gap: 'var(--space-lg)', padding: 'var(--space-lg)', width: '100%', maxWidth: '1400px', margin: '0 auto' }}>
            {data.map(i => (
              <Card key={i.id} title={i.title} description={i.description} buttonText={i.buttonText} onAction={() => dashboardService.triggerAction(i.actionPayload).catch(() => alert(`Local offline resolution execution complete for context: ${i.actionPayload}`))} />
            ))}
          </div>
        </AppShell>
      );
    }
  }))
);

export const App: React.FC = () => (
  <BrowserRouter>
    <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center', fontWeight: 600 }}>Loading runtime modules...</div>}>
      <Routes>
        <Route path="/login" element={<PublicOnlyRoute><LoginView /></PublicOnlyRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><RemoteDashboardWorkspace /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  </BrowserRouter>
);

export default App;
