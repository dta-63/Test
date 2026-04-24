import { Routes } from '@angular/router';
import { AccountComponent } from './account.component';
import { CartComponent } from './cart.component';

export const routes: Routes = [
  { path: '', component: CartComponent },
  { path: 'account', component: AccountComponent },
  { path: '**', redirectTo: '' },
];
