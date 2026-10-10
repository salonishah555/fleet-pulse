import { Routes, type CanDeactivateFn } from '@angular/router';
import { authGuard, operatorGuard } from './core/auth/auth.guard';

const confirmUnsavedRuleChanges: CanDeactivateFn<{ confirmDiscardChanges(): boolean }> = (component) =>
  component.confirmDiscardChanges();

export const routes: Routes = [
  {
    path: 'login',
    title: 'Sign in | Fleet Pulse',
    loadComponent: () => import('./features/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    loadComponent: () => import('./features/shell/app-shell.component').then((m) => m.AppShellComponent),
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        title: 'Dashboard | Fleet Pulse',
        data: { pageTitle: 'Operations Dashboard', breadcrumbs: [{ label: 'Dashboard' }] },
        loadComponent: () => import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'services',
        title: 'Services | Fleet Pulse',
        data: { pageTitle: 'Services', breadcrumbs: [{ label: 'Services' }] },
        loadComponent: () => import('./features/services/services.component').then((m) => m.ServicesComponent),
      },
      {
        path: 'services/:id',
        title: 'Service details | Fleet Pulse',
        data: { pageTitle: 'Service details', breadcrumbs: [{ label: 'Services', url: '/services' }, { label: 'Service details' }] },
        loadComponent: () => import('./features/service-detail/service-detail.component').then((m) => m.ServiceDetailComponent),
      },
      {
        path: 'incidents',
        title: 'Incidents | Fleet Pulse',
        data: { pageTitle: 'Incidents', breadcrumbs: [{ label: 'Incidents' }] },
        loadComponent: () => import('./features/incidents/incidents.component').then((m) => m.IncidentsComponent),
      },
      {
        path: 'alert-rules',
        title: 'Alert rules | Fleet Pulse',
        data: { pageTitle: 'Alert rules', breadcrumbs: [{ label: 'Alert rules' }] },
        canActivate: [operatorGuard],
        canDeactivate: [confirmUnsavedRuleChanges],
        loadComponent: () => import('./features/alert-rules/alert-rules.component').then((m) => m.AlertRulesComponent),
      },
      {
        path: 'rules',
        title: 'Alert rules | Fleet Pulse',
        data: { pageTitle: 'Alert rules', breadcrumbs: [{ label: 'Alert rules' }] },
        canActivate: [operatorGuard],
        canDeactivate: [confirmUnsavedRuleChanges],
        loadComponent: () => import('./features/alert-rules/alert-rules.component').then((m) => m.AlertRulesComponent),
      },
      {
        path: 'settings',
        title: 'Settings | Fleet Pulse',
        data: { pageTitle: 'Settings', breadcrumbs: [{ label: 'Settings' }] },
        loadComponent: () => import('./features/settings/settings.component').then((m) => m.SettingsComponent),
      },
      {
        path: 'chaos',
        title: 'Chaos testing | Fleet Pulse',
        data: { pageTitle: 'Chaos testing', breadcrumbs: [{ label: 'Chaos testing' }] },
        canActivate: [operatorGuard],
        loadComponent: () => import('./features/chaos/chaos.component').then((m) => m.ChaosComponent),
      },
    ],
  },
  {
    path: '**',
    title: 'Page not found | Fleet Pulse',
    loadComponent: () => import('./features/not-found/not-found.component').then((m) => m.NotFoundComponent),
  },
];
