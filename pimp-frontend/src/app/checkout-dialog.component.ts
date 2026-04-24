import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { AuthService } from '@auth0/auth0-angular';
import { take } from 'rxjs';

import { CartStore } from './cart.store';
import { BillingInfo, CheckoutResult, CheckoutService } from './checkout.service';
import { NotificationsService } from './notifications.service';

@Component({
  selector: 'app-checkout-dialog',
  standalone: true,
  imports: [NgIf, NgFor, AsyncPipe, FormsModule],
  template: `
    <div class="backdrop" (click)="onCancel()"></div>
    <div class="dialog" role="dialog" aria-modal="true">
      <header>
        <h2 *ngIf="!result">Valider ma commande</h2>
        <h2 *ngIf="result">Commande transmise</h2>
        <button class="close" (click)="onCancel()" aria-label="Fermer">×</button>
      </header>

      <form *ngIf="!result" #f="ngForm" (ngSubmit)="submit(f)" novalidate>
        <p class="muted">
          Pimp créera une commande sur chaque boutique concernée. Les commandes
          restent en attente de paiement côté marchand.
        </p>

        <div class="row">
          <label>Prénom
            <input name="first_name" [(ngModel)]="billing.first_name" required>
          </label>
          <label>Nom
            <input name="last_name" [(ngModel)]="billing.last_name" required>
          </label>
        </div>
        <label>Email
          <input type="email" name="email" [(ngModel)]="billing.email" required>
        </label>
        <label>Téléphone
          <input name="phone" [(ngModel)]="billing.phone">
        </label>
        <label>Adresse
          <input name="address_1" [(ngModel)]="billing.address_1" required>
        </label>
        <label>Complément (optionnel)
          <input name="address_2" [(ngModel)]="billing.address_2">
        </label>
        <div class="row">
          <label class="small">Code postal
            <input name="postcode" [(ngModel)]="billing.postcode" required>
          </label>
          <label class="grow">Ville
            <input name="city" [(ngModel)]="billing.city" required>
          </label>
          <label class="small">Pays
            <input name="country" [(ngModel)]="billing.country" maxlength="2" required>
          </label>
        </div>
        <label>Note (optionnel)
          <textarea name="note" [(ngModel)]="customerNote" rows="2"></textarea>
        </label>

        <footer>
          <button type="button" class="btn-ghost" (click)="onCancel()" [disabled]="submitting">Annuler</button>
          <button type="submit" class="btn-primary" [disabled]="submitting || f.invalid">
            {{ submitting ? 'Envoi…' : 'Confirmer la commande' }}
          </button>
        </footer>
      </form>

      <div *ngIf="result" class="result">
        <p *ngIf="result.fully_succeeded">
          Toutes les commandes ont été créées. Merci !
        </p>
        <p *ngIf="!result.fully_succeeded" class="warning">
          Certaines commandes n'ont pas pu être créées. Les articles concernés
          restent dans votre panier Pimp.
        </p>
        <ul class="orders">
          <li *ngFor="let o of result.orders" [attr.data-status]="o.status">
            <span class="chip" [attr.data-site]="o.site_id">
              {{ o.site_id === 'site-a' ? 'Shop A' : 'Shop B' }}
            </span>
            <ng-container *ngIf="o.status === 'created'; else failed">
              <span>Commande #{{ o.order_number }} — {{ o.total }} {{ o.currency }}</span>
              <a *ngIf="o.order_url" [href]="o.order_url" target="_blank" rel="noopener">Voir</a>
            </ng-container>
            <ng-template #failed>
              <span class="err">Échec : {{ o.error }}</span>
            </ng-template>
          </li>
        </ul>
        <footer>
          <button class="btn-primary" (click)="onCancel()">Fermer</button>
        </footer>
      </div>
    </div>
  `,
  styles: [`
    .backdrop {
      position: fixed; inset: 0; background: rgba(17,24,39,0.5);
      z-index: 1000; animation: fade 0.15s ease-out;
    }
    .dialog {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      z-index: 1001; background: white; border-radius: 12px;
      width: min(560px, calc(100vw - 32px));
      max-height: calc(100vh - 64px); overflow: auto;
      box-shadow: 0 24px 48px rgba(0,0,0,0.2);
    }
    header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 16px 20px; border-bottom: 1px solid var(--pimp-border);
    }
    h2 { margin: 0; font-size: 18px; }
    .close { background: transparent; color: var(--pimp-muted); font-size: 24px; padding: 0 6px; }
    form, .result { padding: 16px 20px 20px; display: flex; flex-direction: column; gap: 12px; }
    .muted { color: var(--pimp-muted); margin: 0 0 4px; font-size: 14px; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--pimp-muted); }
    input, textarea {
      padding: 9px 10px; border: 1px solid var(--pimp-border); border-radius: 6px;
      font-size: 14px; color: var(--pimp-text); font-family: inherit;
    }
    input:focus, textarea:focus { outline: 2px solid var(--pimp-primary); border-color: transparent; }
    .row { display: flex; gap: 10px; }
    .row label { flex: 1; }
    .row label.small { flex: 0 0 100px; }
    .row label.grow  { flex: 1 1 auto; }
    footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
    .orders { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .orders li {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; border: 1px solid var(--pimp-border); border-radius: 8px;
    }
    .orders li[data-status="failed"] { border-color: #fecaca; background: #fef2f2; }
    .orders li a { margin-left: auto; color: var(--pimp-primary); font-size: 13px; }
    .chip {
      padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; color: white;
    }
    .chip[data-site="site-a"] { background: var(--pimp-shop-a); }
    .chip[data-site="site-b"] { background: var(--pimp-shop-b); }
    .err { color: #b91c1c; font-size: 13px; }
    .warning { color: #92400e; background: #fef3c7; padding: 10px; border-radius: 6px; margin: 0; }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  `],
})
export class CheckoutDialogComponent {
  @Output() closed = new EventEmitter<void>();
  @Input() defaultEmail: string | null = null;

  private auth = inject(AuthService);
  private api = inject(CheckoutService);
  private cart = inject(CartStore);
  private notif = inject(NotificationsService);

  billing: BillingInfo = {
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
  customerNote = '';
  submitting = false;
  result: CheckoutResult | null = null;

  constructor() {
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

  submit(form: NgForm): void {
    if (form.invalid || this.submitting) return;
    this.submitting = true;

    this.api.submit(this.billing, this.customerNote || undefined).subscribe({
      next: (res) => {
        this.result = res;
        this.submitting = false;
        this.cart.refresh();
        if (res.fully_succeeded) {
          this.notif.push('Commande(s) créée(s) avec succès.', 'success');
        } else if (res.orders.some((o) => o.status === 'created')) {
          this.notif.push('Commande partiellement créée — voir le détail.', 'warning');
        } else {
          this.notif.push('Aucune commande n’a pu être créée.', 'warning');
        }
      },
      error: (err) => {
        this.submitting = false;
        this.notif.push(`Erreur: ${err?.error?.detail ?? err.message}`, 'warning');
      },
    });
  }

  onCancel(): void {
    this.closed.emit();
  }
}
