import { Injectable } from '@angular/core';

declare global {
  interface Window {
    Stripe?: (publishableKey: string) => StripeJs;
  }
}

export interface StripeJs {
  elements(opts: { clientSecret: string; appearance?: object }): StripeElements;
  confirmPayment(opts: {
    elements: StripeElements;
    confirmParams: { return_url: string };
    redirect: 'if_required' | 'always';
  }): Promise<{ paymentIntent?: { id: string; status: string }; error?: { message: string } }>;
}

export interface StripeElements {
  create(type: 'payment'): StripePaymentElement;
}

export interface StripePaymentElement {
  mount(selector: string | HTMLElement): void;
  unmount(): void;
}

let stripeJsPromise: Promise<void> | null = null;

function loadStripeJs(): Promise<void> {
  if (window.Stripe) return Promise.resolve();
  if (stripeJsPromise) return stripeJsPromise;
  stripeJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Stripe.js'));
    document.head.appendChild(script);
  });
  return stripeJsPromise;
}

@Injectable({ providedIn: 'root' })
export class StripeService {
  private instance: StripeJs | null = null;

  async ensure(publishableKey: string): Promise<StripeJs> {
    await loadStripeJs();
    if (!window.Stripe) throw new Error('Stripe.js failed to load');
    if (!this.instance) this.instance = window.Stripe(publishableKey);
    return this.instance;
  }
}
