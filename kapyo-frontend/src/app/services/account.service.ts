import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { env } from '@core/env';
import { AccountView } from '@models/user.model';

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
