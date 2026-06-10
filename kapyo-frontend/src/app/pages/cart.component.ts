import { AsyncPipe, CurrencyPipe, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { AuthService } from '@auth0/auth0-angular';

import { CartStore } from '@state/cart.store';
import { CheckoutDialogComponent } from '@components/checkout-dialog.component';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [NgIf, NgFor, AsyncPipe, CurrencyPipe, DatePipe, CheckoutDialogComponent],
  template: `
    <ng-container *ngIf="auth.isLoading$ | async">
      <div class="skeleton-wrap">
        <div class="skeleton title"></div>
        <div class="skeleton-grid">
          <div class="skeleton card-ghost" *ngFor="let i of [1,2,3]"></div>
        </div>
      </div>
    </ng-container>

    <ng-container *ngIf="!(auth.isLoading$ | async)">
    <ng-container *ngIf="auth.isAuthenticated$ | async; else notLogged">
      <section *ngIf="cart$ | async as cart; else loading">
        <div class="header-row">
          <h1>Mon panier</h1>
          <button class="btn-ghost" (click)="clear()" [disabled]="cart.items.length === 0">
            Vider
          </button>
        </div>

        <div *ngIf="cart.items.length === 0" class="empty">
          Aucun article pour le moment. Rendez-vous sur
          <a href="http://shop-a.localhost">Shop A</a> ou
          <a href="http://shop-b.localhost">Shop B</a>
          et cliquez sur le bouton violet.
        </div>

        <div class="grid">
          <article *ngFor="let item of cart.items" class="card" [attr.data-site]="item.site_id">
            <div class="thumb">
              <img *ngIf="item.image_url" [src]="item.image_url" [alt]="item.product_name">
            </div>
            <div class="body">
              <span class="chip">{{ item.site_id === 'site-a' ? 'Shop A' : 'Shop B' }}</span>
              <h3><a [href]="item.product_url" target="_blank" rel="noopener">{{ item.product_name }}</a></h3>
              <div *ngIf="item.variation_label" class="variation" [innerHTML]="item.variation_label"></div>
              <div class="meta">
                <span>{{ item.price | currency: item.currency }}</span>
                <span>×{{ item.quantity }}</span>
                <span class="date">ajouté le {{ item.added_at | date:'short' }}</span>
              </div>
              <button class="btn-ghost" (click)="remove(item.id)">Retirer</button>
            </div>
          </article>
        </div>

        <footer class="total" *ngIf="cart.items.length > 0">
          <div>
            <span class="muted">Total</span>
            <strong>{{ cart.total | currency: cart.currency }}</strong>
          </div>
          <button class="btn-primary" (click)="openCheckout()">Valider ma commande</button>
        </footer>
      </section>
      <ng-template #loading><p>Chargement du panier…</p></ng-template>
    </ng-container>

    <ng-template #notLogged>
      <div class="welcome">
        <h1>Bienvenue sur Kapyo</h1>
        <p>Connectez-vous pour consulter votre panier unifié depuis Shop A et Shop B.</p>
      </div>
    </ng-template>
    </ng-container>

    <app-checkout-dialog *ngIf="checkoutOpen" (closed)="checkoutOpen = false"></app-checkout-dialog>
  `,
  styles: [`
    .header-row { display: flex; justify-content: space-between; align-items: center; }
    h1 { margin: 0 0 16px; }
    .empty { background: white; padding: 32px; border-radius: 12px; text-align: center; color: var(--kapyo-muted); }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); margin-top: 16px; }
    .card {
      background: white; border-radius: 12px; overflow: hidden;
      border: 1px solid var(--kapyo-border);
      display: flex; flex-direction: column;
    }
    .card[data-site="site-a"] { border-top: 4px solid var(--kapyo-shop-a); }
    .card[data-site="site-b"] { border-top: 4px solid var(--kapyo-shop-b); }
    .thumb { background: #f3f4f6; aspect-ratio: 16/10; display:flex; align-items:center; justify-content:center; }
    .thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .body { padding: 16px; display: flex; flex-direction: column; gap: 8px; }
    .chip { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--kapyo-muted); }
    h3 { margin: 0; font-size: 16px; }
    h3 a { color: inherit; text-decoration: none; }
    h3 a:hover { color: var(--kapyo-primary); }
    .variation { font-size: 12px; color: var(--kapyo-muted); }
    .meta { display: flex; gap: 10px; align-items: baseline; font-size: 13px; color: var(--kapyo-muted); flex-wrap: wrap; }
    .date { margin-left: auto; }
    .total {
      margin-top: 24px; background: white; padding: 20px; border-radius: 12px;
      display: flex; justify-content: space-between; align-items: center; font-size: 18px;
      gap: 16px; flex-wrap: wrap;
    }
    .total > div { display: flex; flex-direction: column; }
    .total .muted { color: var(--kapyo-muted); font-size: 13px; }
    .total strong { font-size: 20px; }
    .welcome { background: white; padding: 48px; border-radius: 12px; text-align: center; }
    .skeleton-wrap { padding-top: 4px; }
    .skeleton {
      background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
      background-size: 200% 100%;
      animation: shimmer 1.2s infinite;
      border-radius: 8px;
    }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .skeleton.title { height: 32px; width: 200px; margin-bottom: 24px; }
    .skeleton-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
    .skeleton.card-ghost { height: 260px; border-radius: 12px; }
  `],
})
export class CartComponent {
  auth = inject(AuthService);
  private store = inject(CartStore);

  cart$ = this.store.cart$;
  checkoutOpen = false;

  remove(id: number): void {
    this.store.remove(id);
  }

  clear(): void {
    this.store.clear();
  }

  openCheckout(): void {
    this.checkoutOpen = true;
  }
}
