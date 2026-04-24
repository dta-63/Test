import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { env } from './env';

export interface BillingInfo {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  address_1: string;
  address_2?: string;
  postcode: string;
  city: string;
  country: string;
}

export interface CheckoutOrder {
  site_id: string;
  status: 'created' | 'failed';
  order_id: number | null;
  order_number: string | null;
  order_url: string | null;
  total: string | null;
  currency: string | null;
  error: string | null;
}

export interface CheckoutResult {
  orders: CheckoutOrder[];
  fully_succeeded: boolean;
}

@Injectable({ providedIn: 'root' })
export class CheckoutService {
  private http = inject(HttpClient);
  private base = `${env.apiUrl}/api`;

  submit(billing: BillingInfo, customerNote?: string): Observable<CheckoutResult> {
    return this.http.post<CheckoutResult>(`${this.base}/checkout`, {
      billing,
      customer_note: customerNote || null,
    });
  }
}
