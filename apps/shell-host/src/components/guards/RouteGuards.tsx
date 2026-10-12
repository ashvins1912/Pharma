import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

export const ProtectedRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const location = useLocation();
  return localStorage.getItem('auth_token') ? children : <Navigate to="/login" state={{ from: location }} replace />;
};
export const PublicOnlyRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const location = useLocation();
  const dest = (location.state as any)?.from?.pathname || '/dashboard';
  return localStorage.getItem('auth_token') ? <Navigate to={dest} replace /> : children;
};
