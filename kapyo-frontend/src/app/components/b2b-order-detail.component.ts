import { CurrencyPipe, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnInit, Output, inject } from '@angular/core';

import { OrderDetail } from '@models/b2b.model';
import { B2bService } from '@services/b2b.service';

@Component({
  selector: 'app-b2b-order-detail',
  standalone: true,
  imports: [NgIf, NgFor, CurrencyPipe, DatePipe],
  template: `
    <div class="backdrop" (click)="close.emit()"></div>
    <div class="dialog" role="dialog" aria-modal="true">
      <header>
        <h2 *ngIf="order">Commande #{{ order.external_order_number }}</h2>
        <h2 *ngIf="!order">Chargement…</h2>
        <button class="close" (click)="close.emit()" aria-label="Fermer">×</button>
      </header>

      <section *ngIf="order" class="body">
        <div class="meta">
          <span class="chip" [attr.data-site]="order.site_id">
            {{ order.site_id === 'site-a' ? 'Shop A' : 'Shop B' }}
          </span>
          <span class="status-pill" [attr.data-status]="order.status">{{ order.status }}</span>
          <span class="muted">{{ order.created_at | date: 'medium' }}</span>
        </div>

        <dl>
          <dt>Client</dt>
          <dd>{{ order.customer_name }} — {{ order.customer_email }}</dd>
          <dt>Total</dt>
          <dd><strong>{{ order.total | currency: order.currency }}</strong></dd>
        </dl>

        <h3>Articles ({{ order.items.length }})</h3>
        <table>
          <thead>
            <tr><th>Produit</th><th>Qté</th><th>Prix unitaire</th><th>Sous-total</th></tr>
          </thead>
          <tbody>
            <tr *ngFor="let it of order.items">
              <td>{{ it.product_name }}<br><span class="muted">#{{ it.product_id }}</span></td>
              <td>{{ it.quantity }}</td>
              <td>{{ it.price | currency: order.currency }}</td>
              <td>{{ it.price * it.quantity | currency: order.currency }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <p *ngIf="error" class="err">{{ error }}</p>

      <footer>
        <a *ngIf="order?.admin_url" [href]="order!.admin_url!" target="_blank" rel="noopener" class="btn-ghost">
          Ouvrir dans WP Admin
        </a>
        <button class="btn-primary" (click)="close.emit()">Fermer</button>
      </footer>
    </div>
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; background: rgba(17,24,39,0.5); z-index: 1000; }
    .dialog {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      z-index: 1001; background: white; border-radius: 12px;
      width: min(640px, calc(100vw - 32px)); max-height: calc(100vh - 64px);
      overflow: auto; box-shadow: 0 24px 48px rgba(0,0,0,0.2);
    }
    header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--kapyo-border); }
    h2 { margin: 0; font-size: 18px; }
    .close { background: transparent; color: var(--kapyo-muted); font-size: 24px; padding: 0 6px; }
    .body { padding: 16px 20px; display: flex; flex-direction: column; gap: 16px; }
    .meta { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .muted { color: var(--kapyo-muted); font-size: 13px; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; font-size: 14px; }
    dt { color: var(--kapyo-muted); }
    dd { margin: 0; }
    h3 { margin: 0; font-size: 14px; text-transform: uppercase; color: var(--kapyo-muted); letter-spacing: 0.05em; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--kapyo-border); font-size: 13px; vertical-align: top; }
    th { color: var(--kapyo-muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    .chip { padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; color: white; }
    .chip[data-site="site-a"] { background: var(--kapyo-shop-a); }
    .chip[data-site="site-b"] { background: var(--kapyo-shop-b); }
    .status-pill { padding: 2px 10px; border-radius: 999px; font-size: 11px; background: #f3f4f6; }
    .status-pill[data-status="completed"]  { background: #d1fae5; color: #065f46; }
    .status-pill[data-status="processing"] { background: #dbeafe; color: #1e40af; }
    .status-pill[data-status="pending"]    { background: #fef3c7; color: #92400e; }
    .status-pill[data-status="cancelled"], .status-pill[data-status="failed"] { background: #fee2e2; color: #991b1b; }
    .err { color: #b91c1c; padding: 12px 20px; }
    footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--kapyo-border); }
    footer a { text-decoration: none; padding: 9px 14px; border-radius: 6px; }
  `],
})
export class B2bOrderDetailComponent implements OnInit, OnChanges {
  @Input() orderId!: number;
  @Output() close = new EventEmitter<void>();

  private api = inject(B2bService);
  order: OrderDetail | null = null;
  error: string | null = null;

  ngOnInit(): void { this.load(); }
  ngOnChanges(): void { this.load(); }

  private load(): void {
    if (!this.orderId) return;
    this.order = null;
    this.error = null;
    this.api.getOrder(this.orderId).subscribe({
      next: (o) => (this.order = o),
      error: (e) => (this.error = `Erreur: ${e?.error?.detail ?? e.message}`),
    });
  }
}
