import { Routes } from '@angular/router';
import { AccountComponent } from '@pages/account.component';
import { AuthCallbackComponent } from '@pages/auth-callback.component';
import { B2bDashboardComponent } from '@pages/b2b-dashboard.component';
import { b2bGuard } from '@core/guards/b2b.guard';
import { CartComponent } from '@pages/cart.component';

export const routes: Routes = [
  { path: '', component: CartComponent },
  { path: 'auth/callback', component: AuthCallbackComponent },
  { path: 'account', component: AccountComponent },
  { path: 'b2b', component: B2bDashboardComponent, canActivate: [b2bGuard] },
  { path: '**', redirectTo: '' },
];
