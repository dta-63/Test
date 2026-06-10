import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { env } from '@core/env';

import {
  BillingInfo,
  CheckoutResult,
  IntentOut,
  PreviewResult,
  ShippingAddress,
} from '@models/checkout.model';

@Injectable({ providedIn: 'root' })
export class CheckoutService {
  private http = inject(HttpClient);
  private base = `${env.apiUrl}/api`;

  preview(billing: BillingInfo, shipping?: ShippingAddress): Observable<PreviewResult> {
    return this.http.post<PreviewResult>(`${this.base}/cart/preview`, {
      billing,
      shipping: shipping ?? null,
    });
  }

  submit(billing: BillingInfo, shipping?: ShippingAddress, customerNote?: string): Observable<CheckoutResult> {
    return this.http.post<CheckoutResult>(`${this.base}/checkout`, {
      billing,
      shipping: shipping ?? null,
      customer_note: customerNote || null,
    });
  }

  createIntent(billing: BillingInfo, shipping?: ShippingAddress, customerNote?: string): Observable<IntentOut> {
    return this.http.post<IntentOut>(`${this.base}/payment/intent`, {
      billing,
      shipping: shipping ?? null,
      customer_note: customerNote || null,
    });
  }

  confirmPayment(paymentIntentId: string): Observable<CheckoutResult> {
    return this.http.post<CheckoutResult>(`${this.base}/payment/confirm`, {
      payment_intent_id: paymentIntentId,
    });
  }
}
