import { Routes } from '@angular/router';
import { authGuard, operatorGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
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
        loadComponent: () => import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'services',
        loadComponent: () => import('./features/services/services.component').then((m) => m.ServicesComponent),
      },
      {
        path: 'services/:id',
        loadComponent: () => import('./features/service-detail/service-detail.component').then((m) => m.ServiceDetailComponent),
      },
      {
        path: 'incidents',
        loadComponent: () => import('./features/incidents/incidents.component').then((m) => m.IncidentsComponent),
      },
      {
        path: 'alert-rules',
        loadComponent: () => import('./features/alert-rules/alert-rules.component').then((m) => m.AlertRulesComponent),
      },
      {
        path: 'chaos',
        canActivate: [operatorGuard],
        loadComponent: () => import('./features/chaos/chaos.component').then((m) => m.ChaosComponent),
      },
    ],
  },
  {
    path: '**',
    loadComponent: () => import('./features/not-found/not-found.component').then((m) => m.NotFoundComponent),
  },
];
