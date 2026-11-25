import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { queryClient } from './api/queries';
import { Layout } from './components/Layout';
import { APP_NAME } from './config';
import {
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
  SignupPage,
  VerifyEmailPage,
} from './pages/AuthPages';
import { CloudResultPage } from './pages/CloudResultPage';
import {
  DashboardLayout,
  FilesPage,
  HistoryPage,
  OverviewPage,
  RulesPage,
  SettingsPage,
} from './pages/DashboardPages';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { ResultPage } from './pages/ResultPage';
import { ToolPage } from './pages/ToolPage';
import { SessionProvider } from './session/SessionContext';
import './index.css';

document.title = APP_NAME;

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="result/local" element={<ResultPage />} />
              <Route path="result/:jobId" element={<CloudResultPage />} />
              <Route path="login" element={<LoginPage />} />
              <Route path="signup" element={<SignupPage />} />
              <Route path="forgot-password" element={<ForgotPasswordPage />} />
              <Route path="reset-password" element={<ResetPasswordPage />} />
              <Route path="verify-email" element={<VerifyEmailPage />} />
              <Route path="app" element={<DashboardLayout />}>
                <Route index element={<OverviewPage />} />
                <Route path="history" element={<HistoryPage />} />
                <Route path="files" element={<FilesPage />} />
                <Route path="rules" element={<RulesPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
              <Route path="tools/:slug" element={<ToolPage />} />
              <Route path="privacy" element={<PrivacyPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
