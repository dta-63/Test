import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { env } from './env';

export interface PimpUser {
  id: number;
  auth0_sub: string;
  email: string | null;
  created_at: string;
}

export interface AccountStats {
  total_items: number;
  total_quantity: number;
  total_value: number;
  currency: string;
  by_site: Record<string, number>;
}

export interface AccountView {
  user: PimpUser;
  stats: AccountStats;
}

@Injectable({ providedIn: 'root' })
export class AccountService {
  private http = inject(HttpClient);
  private base = `${env.apiUrl}/api`;

  get(): Observable<AccountView> {
    return this.http.get<AccountView>(`${this.base}/account`);
  }

  delete(): Observable<void> {
    return this.http.delete<void>(`${this.base}/account`);
  }
}
