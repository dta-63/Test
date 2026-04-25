import { CurrencyPipe, NgFor, NgIf } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  inject,
} from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { AuthService } from '@auth0/auth0-angular';
import { take } from 'rxjs';

import { CartStore } from './cart.store';
import {
  BillingInfo,
  CheckoutResult,
  CheckoutService,
  PreviewResult,
  ShippingAddress,
} from './checkout.service';
import { NotificationsService } from './notifications.service';
import { PublicConfigService } from './public-config.service';
import { StripeElements, StripePaymentElement, StripeService } from './stripe.service';

type Step = 'address' | 'payment' | 'result';

function emptyBilling(): BillingInfo {
  return {
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    address_1: '',
    address_2: '',
    postcode: '',
    city: '',
    country: 'FR',
  };
}

function emptyShipping(): ShippingAddress {
  return {
    first_name: '',
    last_name: '',
    phone: '',
    address_1: '',
    address_2: '',
    postcode: '',
    city: '',
    country: 'FR',
  };
}

@Component({
  selector: 'app-checkout-dialog',
  standalone: true,
  imports: [NgIf, NgFor, FormsModule, CurrencyPipe],
  template: `
    <div class="backdrop" (click)="onCancel()"></div>
    <div class="dialog" role="dialog" aria-modal="true">
      <header>
        <h2 *ngIf="step === 'address'">Adresses & livraison</h2>
        <h2 *ngIf="step === 'payment'">Paiement</h2>
        <h2 *ngIf="step === 'result'">Récapitulatif</h2>
        <button class="close" (click)="onCancel()" aria-label="Fermer">×</button>
      </header>

      <!-- ============ STEP 1: addresses ============ -->
      <form *ngIf="step === 'address'" #f="ngForm" (ngSubmit)="goToPayment(f)" novalidate>
        <fieldset>
          <legend>Facturation</legend>
          <div class="row">
            <label>Prénom <input name="b_first" [(ngModel)]="billing.first_name" required></label>
            <label>Nom <input name="b_last" [(ngModel)]="billing.last_name" required></label>
          </div>
          <label>Email <input type="email" name="b_email" [(ngModel)]="billing.email" required></label>
          <label>Téléphone <input name="b_phone" [(ngModel)]="billing.phone"></label>
          <label>Adresse <input name="b_addr1" [(ngModel)]="billing.address_1" required></label>
          <label>Complément <input name="b_addr2" [(ngModel)]="billing.address_2"></label>
          <div class="row">
            <label class="small">CP <input name="b_post" [(ngModel)]="billing.postcode" required></label>
            <label class="grow">Ville <input name="b_city" [(ngModel)]="billing.city" required></label>
            <label class="small">Pays <input name="b_country" [(ngModel)]="billing.country" maxlength="2" required></label>
          </div>
        </fieldset>

        <label class="inline">
          <input type="checkbox" [(ngModel)]="shipSameAsBilling" name="ship_same">
          Livrer à la même adresse
        </label>

        <fieldset *ngIf="!shipSameAsBilling">
          <legend>Livraison</legend>
          <div class="row">
            <label>Prénom <input name="s_first" [(ngModel)]="shipping.first_name" required></label>
            <label>Nom <input name="s_last" [(ngModel)]="shipping.last_name" required></label>
          </div>
          <label>Adresse <input name="s_addr1" [(ngModel)]="shipping.address_1" required></label>
          <label>Complément <input name="s_addr2" [(ngModel)]="shipping.address_2"></label>
          <div class="row">
            <label class="small">CP <input name="s_post" [(ngModel)]="shipping.postcode" required></label>
            <label class="grow">Ville <input name="s_city" [(ngModel)]="shipping.city" required></label>
            <label class="small">Pays <input name="s_country" [(ngModel)]="shipping.country" maxlength="2" required></label>
          </div>
        </fieldset>

        <label>Note pour les marchands (optionnel)
          <textarea name="note" [(ngModel)]="customerNote" rows="2"></textarea>
        </label>

        <footer>
          <button type="button" class="btn-ghost" (click)="onCancel()">Annuler</button>
          <button type="submit" class="btn-primary" [disabled]="loading || f.invalid">
            {{ loading ? 'Calcul…' : 'Continuer' }}
          </button>
        </footer>
      </form>

      <!-- ============ STEP 2: payment ============ -->
      <section *ngIf="step === 'payment'" class="payment">
        <div *ngIf="preview" class="preview">
          <h3>Total recalculé par les boutiques</h3>
          <ul>
            <li *ngFor="let s of preview.sites">
              <span class="chip" [attr.data-site]="s.site_id">{{ s.site_id === 'site-a' ? 'Shop A' : 'Shop B' }}</span>
              <span *ngIf="!s.error">
                {{ s.items_subtotal | currency: s.currency }} produits
                <span *ngIf="s.shipping_total"> · {{ s.shipping_total | currency: s.currency }} livraison</span>
                <span *ngIf="s.tax_total"> · {{ s.tax_total | currency: s.currency }} taxes</span>
                <span *ngIf="s.discount_total"> · -{{ s.discount_total | currency: s.currency }} remise</span>
                <strong> = {{ s.total | currency: s.currency }}</strong>
              </span>
              <span *ngIf="s.error" class="err">Indisponible: {{ s.error }}</span>
            </li>
          </ul>
          <div class="grand-total">
            Total à payer
            <strong>{{ preview.grand_total | currency: preview.currency }}</strong>
          </div>
        </div>

        <div *ngIf="stripeMode" class="stripe-block">
          <p class="muted">
            Vous payez en une fois via Stripe. Pimp répartira ensuite le paiement
            vers les boutiques (la transaction Stripe est référencée sur chaque commande).
          </p>
          <div #stripeMount class="stripe-mount"></div>
          <p *ngIf="stripeError" class="err">{{ stripeError }}</p>
        </div>
        <div *ngIf="!stripeMode" class="stripe-block">
          <p class="muted">
            Stripe n'est pas configuré. Les commandes seront créées en attente
            de paiement (le marchand les traite manuellement).
          </p>
        </div>

        <footer>
          <button class="btn-ghost" (click)="step = 'address'" [disabled]="loading">Retour</button>
          <button class="btn-primary" (click)="payAndConfirm()" [disabled]="loading || !stripeReady && stripeMode">
            {{ loading ? 'Paiement…' : (stripeMode ? 'Payer et commander' : 'Confirmer la commande') }}
          </button>
        </footer>
      </section>

      <!-- ============ STEP 3: result ============ -->
      <section *ngIf="step === 'result' && result" class="result">
        <p *ngIf="result.fully_succeeded">Toutes les commandes ont été créées. Merci !</p>
        <p *ngIf="!result.fully_succeeded" class="warning">
          Certaines commandes n'ont pas pu être créées. Les articles concernés restent
          dans votre panier.
        </p>
        <ul class="orders">
          <li *ngFor="let o of result.orders" [attr.data-status]="o.status">
            <span class="chip" [attr.data-site]="o.site_id">{{ o.site_id === 'site-a' ? 'Shop A' : 'Shop B' }}</span>
            <ng-container *ngIf="o.status === 'created'; else failed">
              <span>Commande #{{ o.order_number }} — {{ o.total }} {{ o.currency }}</span>
              <a *ngIf="o.order_url" [href]="o.order_url" target="_blank" rel="noopener">Voir</a>
            </ng-container>
            <ng-template #failed><span class="err">Échec : {{ o.error }}</span></ng-template>
          </li>
        </ul>
        <footer>
          <button class="btn-primary" (click)="onCancel()">Fermer</button>
        </footer>
      </section>
    </div>
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; background: rgba(17,24,39,0.5); z-index: 1000; }
    .dialog {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      z-index: 1001; background: white; border-radius: 12px;
      width: min(620px, calc(100vw - 32px)); max-height: calc(100vh - 64px);
      overflow: auto; box-shadow: 0 24px 48px rgba(0,0,0,0.2);
    }
    header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 16px 20px; border-bottom: 1px solid var(--pimp-border);
    }
    h2 { margin: 0; font-size: 18px; }
    .close { background: transparent; color: var(--pimp-muted); font-size: 24px; padding: 0 6px; }
    form, .payment, .result {
      padding: 16px 20px 20px; display: flex; flex-direction: column; gap: 12px;
    }
    fieldset {
      border: 1px solid var(--pimp-border); border-radius: 8px; padding: 14px;
      display: flex; flex-direction: column; gap: 10px;
    }
    legend { padding: 0 6px; color: var(--pimp-muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--pimp-muted); }
    label.inline { flex-direction: row; align-items: center; gap: 8px; color: var(--pimp-text); font-size: 14px; }
    input, textarea {
      padding: 9px 10px; border: 1px solid var(--pimp-border); border-radius: 6px;
      font-size: 14px; color: var(--pimp-text); font-family: inherit;
    }
    input:focus, textarea:focus { outline: 2px solid var(--pimp-primary); border-color: transparent; }
    .row { display: flex; gap: 10px; }
    .row label { flex: 1; }
    .row label.small { flex: 0 0 100px; }
    .row label.grow  { flex: 1 1 auto; }
    footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; padding-top: 4px; }
    .preview { background: var(--pimp-bg); padding: 14px; border-radius: 8px; }
    .preview h3 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; color: var(--pimp-muted); letter-spacing: 0.05em; }
    .preview ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
    .preview li { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .grand-total {
      margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--pimp-border);
      display: flex; justify-content: space-between; align-items: center; font-size: 16px;
    }
    .grand-total strong { color: var(--pimp-primary); font-size: 22px; }
    .stripe-block .muted { font-size: 13px; }
    .stripe-mount { margin-top: 8px; min-height: 60px; }
    .chip { padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; color: white; }
    .chip[data-site="site-a"] { background: var(--pimp-shop-a); }
    .chip[data-site="site-b"] { background: var(--pimp-shop-b); }
    .err { color: #b91c1c; font-size: 13px; }
    .warning { color: #92400e; background: #fef3c7; padding: 10px; border-radius: 6px; margin: 0; }
    .orders { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .orders li {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; border: 1px solid var(--pimp-border); border-radius: 8px;
    }
    .orders li[data-status="failed"] { border-color: #fecaca; background: #fef2f2; }
    .orders li a { margin-left: auto; color: var(--pimp-primary); font-size: 13px; }
  `],
})
export class CheckoutDialogComponent implements AfterViewInit, OnDestroy {
  @Output() closed = new EventEmitter<void>();
  @Input() defaultEmail: string | null = null;

  @ViewChild('stripeMount') stripeMount?: ElementRef<HTMLDivElement>;

  private auth = inject(AuthService);
  private api = inject(CheckoutService);
  private cart = inject(CartStore);
  private notif = inject(NotificationsService);
  private cfg = inject(PublicConfigService);
  private stripeSvc = inject(StripeService);

  step: Step = 'address';
  billing: BillingInfo = emptyBilling();
  shipping: ShippingAddress = emptyShipping();
  shipSameAsBilling = true;
  customerNote = '';

  loading = false;
  preview: PreviewResult | null = null;
  result: CheckoutResult | null = null;

  // Stripe state
  stripeMode = false;
  stripeReady = false;
  stripeError: string | null = null;
  private stripeElements: StripeElements | null = null;
  private paymentElement: StripePaymentElement | null = null;
  private paymentIntentId: string | null = null;

  constructor() {
    this.stripeMode = !!this.cfg.config()?.stripe_enabled;
    this.auth.user$.pipe(take(1)).subscribe((u) => {
      if (!u) return;
      if (u.email) this.billing.email = u.email;
      if (u.given_name) this.billing.first_name = u.given_name;
      if (u.family_name) this.billing.last_name = u.family_name;
      if (!this.billing.first_name && u.name) {
        const [first, ...rest] = u.name.split(' ');
        this.billing.first_name = first ?? '';
        this.billing.last_name = rest.join(' ');
      }
    });
  }

  ngAfterViewInit(): void {}

  ngOnDestroy(): void {
    this.paymentElement?.unmount();
  }

  goToPayment(form: NgForm): void {
    if (form.invalid || this.loading) return;
    if (this.shipSameAsBilling) {
      this.shipping = {
        first_name: this.billing.first_name,
        last_name: this.billing.last_name,
        phone: this.billing.phone,
        address_1: this.billing.address_1,
        address_2: this.billing.address_2,
        postcode: this.billing.postcode,
        city: this.billing.city,
        country: this.billing.country,
      };
    }
    this.loading = true;
    this.api.preview(this.billing, this.shipping).subscribe({
      next: (p) => {
        this.preview = p;
        this.step = 'payment';
        this.loading = false;
        if (this.stripeMode) {
          this.startStripe();
        } else {
          this.stripeReady = true;
        }
      },
      error: (e) => {
        this.loading = false;
        this.notif.push(`Preview impossible: ${e?.error?.detail ?? e.message}`, 'warning');
      },
    });
  }

  private async startStripe(): Promise<void> {
    const cfg = this.cfg.config();
    if (!cfg?.stripe_enabled) return;
    try {
      this.api.createIntent(this.billing, this.shipping, this.customerNote).subscribe({
        next: async (intent) => {
          this.paymentIntentId = intent.payment_intent_id;
          const stripe = await this.stripeSvc.ensure(intent.publishable_key);
          this.stripeElements = stripe.elements({ clientSecret: intent.client_secret });
          this.paymentElement = this.stripeElements.create('payment');
          // Mount into the view child after a microtask so the DOM is ready.
          setTimeout(() => {
            if (this.stripeMount && this.paymentElement) {
              this.paymentElement.mount(this.stripeMount.nativeElement);
              this.stripeReady = true;
            }
          }, 0);
        },
        error: (e) => {
          this.stripeError = `Stripe: ${e?.error?.detail ?? e.message}`;
        },
      });
    } catch (e: unknown) {
      this.stripeError = (e as Error).message;
    }
  }

  async payAndConfirm(): Promise<void> {
    if (this.loading) return;
    this.loading = true;

    if (!this.stripeMode) {
      this.api.submit(this.billing, this.shipping, this.customerNote).subscribe({
        next: (r) => this.handleResult(r),
        error: (e) => this.handleError(e),
      });
      return;
    }

    const cfg = this.cfg.config();
    if (!cfg) { this.loading = false; return; }
    try {
      const stripe = await this.stripeSvc.ensure(cfg.stripe_publishable_key);
      if (!this.stripeElements) throw new Error('Stripe non initialisé');
      const conf = await stripe.confirmPayment({
        elements: this.stripeElements,
        confirmParams: { return_url: window.location.origin },
        redirect: 'if_required',
      });
      if (conf.error) {
        this.loading = false;
        this.stripeError = conf.error.message;
        return;
      }
      const pi = conf.paymentIntent;
      if (!pi || pi.status !== 'succeeded') {
        this.loading = false;
        this.stripeError = `Paiement non finalisé (${pi?.status ?? 'inconnu'})`;
        return;
      }
      const intentId = this.paymentIntentId ?? pi.id;
      this.api.confirmPayment(intentId).subscribe({
        next: (r) => this.handleResult(r),
        error: (e) => this.handleError(e),
      });
    } catch (e: unknown) {
      this.handleError(e);
    }
  }

  private handleResult(r: CheckoutResult): void {
    this.loading = false;
    this.result = r;
    this.step = 'result';
    this.cart.refresh();
    if (r.fully_succeeded) this.notif.push('Commande(s) créée(s) avec succès.', 'success');
    else if (r.orders.some((o) => o.status === 'created'))
      this.notif.push('Commande partiellement créée — voir le détail.', 'warning');
    else this.notif.push("Aucune commande n'a pu être créée.", 'warning');
  }

  private handleError(e: unknown): void {
    this.loading = false;
    const err = e as { error?: { detail?: string }; message?: string };
    this.notif.push(`Erreur: ${err?.error?.detail ?? err?.message ?? 'inconnue'}`, 'warning');
  }

  onCancel(): void {
    this.closed.emit();
  }
}
