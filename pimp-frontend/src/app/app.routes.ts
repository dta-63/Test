import { Routes } from '@angular/router';
import { AccountComponent } from './account.component';
import { B2bDashboardComponent } from './b2b-dashboard.component';
import { b2bGuard } from './b2b.guard';
import { CartComponent } from './cart.component';

export const routes: Routes = [
  { path: '', component: CartComponent },
  { path: 'account', component: AccountComponent },
  { path: 'b2b', component: B2bDashboardComponent, canActivate: [b2bGuard] },
  { path: '**', redirectTo: '' },
];
