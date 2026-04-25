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

export interface ShippingAddress {
  first_name: string;
  last_name: string;
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

export interface PreviewItem {
  product_id: number;
  variation_id: number | null;
  name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  available: boolean;
  reason: string | null;
  stock_left: number | null;
}

export interface PreviewSite {
  site_id: string;
  currency: string;
  items_subtotal: number;
  discount_total: number;
  shipping_total: number;
  tax_total: number;
  total: number;
  coupons_applied: string[];
  items: PreviewItem[];
  all_available: boolean;
  error: string | null;
}

export interface PreviewResult {
  sites: PreviewSite[];
  grand_total: number;
  currency: string;
  currency_mismatch: boolean;
  all_available: boolean;
}

export interface IntentOut {
  payment_intent_id: string;
  client_secret: string;
  publishable_key: string;
  amount: number;
  currency: string;
}

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
