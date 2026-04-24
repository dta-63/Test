import { AsyncPipe, CurrencyPipe, DatePipe, KeyValuePipe, NgFor, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '@auth0/auth0-angular';
import { BehaviorSubject, switchMap } from 'rxjs';

import { AccountService } from './account.service';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [NgIf, NgFor, AsyncPipe, CurrencyPipe, DatePipe, KeyValuePipe, RouterLink],
  template: `
    <ng-container *ngIf="auth.isAuthenticated$ | async; else notLogged">
      <h1>Mon compte</h1>

      <section class="card profile" *ngIf="auth.user$ | async as u">
        <img *ngIf="u.picture" [src]="u.picture" [alt]="u.name" class="avatar" referrerpolicy="no-referrer">
        <div class="profile-body">
          <h2>{{ u.name || u.email }}</h2>
          <p class="muted" *ngIf="u.email">{{ u.email }}</p>
          <dl>
            <dt>Identifiant Auth0</dt>
            <dd><code>{{ u.sub }}</code></dd>
            <dt *ngIf="u.updated_at">Dernière mise à jour Auth0</dt>
            <dd *ngIf="u.updated_at">{{ u.updated_at | date: 'medium' }}</dd>
            <dt *ngIf="u.email_verified !== undefined">Email vérifié</dt>
            <dd *ngIf="u.email_verified !== undefined">{{ u.email_verified ? 'Oui' : 'Non' }}</dd>
          </dl>
        </div>
      </section>

      <ng-container *ngIf="account$ | async as account">
        <section class="card">
          <h2>Compte Pimp</h2>
          <dl>
            <dt>Numéro de compte</dt>
            <dd>#{{ account.user.id }}</dd>
            <dt>Inscrit le</dt>
            <dd>{{ account.user.created_at | date: 'longDate' }}</dd>
          </dl>
        </section>

        <section class="card">
          <h2>Activité</h2>
          <div class="stats">
            <div class="stat">
              <span class="stat-label">Articles distincts</span>
              <span class="stat-value">{{ account.stats.total_items }}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Quantité totale</span>
              <span class="stat-value">{{ account.stats.total_quantity }}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Valeur du panier</span>
              <span class="stat-value">{{ account.stats.total_value | currency: account.stats.currency }}</span>
            </div>
          </div>

          <div *ngIf="hasSites(account)" class="by-site">
            <h3>Par boutique</h3>
            <ul>
              <li *ngFor="let entry of account.stats.by_site | keyvalue">
                <span class="chip" [attr.data-site]="entry.key">
                  {{ entry.key === 'site-a' ? 'Shop A' : 'Shop B' }}
                </span>
                <span>{{ entry.value }} article(s)</span>
              </li>
            </ul>
          </div>
        </section>

        <section class="card danger">
          <h2>Zone sensible</h2>
          <p class="muted">
            Supprime vos données Pimp (panier + profil local). Vous pourrez
            vous reconnecter avec le même compte Auth0, un nouveau profil
            Pimp sera recréé automatiquement.
          </p>
          <div class="actions">
            <button class="btn-ghost" (click)="logout()">Se déconnecter</button>
            <button class="btn-danger" (click)="onDelete()">Supprimer mon compte Pimp</button>
          </div>
        </section>
      </ng-container>

      <p><a routerLink="/">← Retour au panier</a></p>
    </ng-container>

    <ng-template #notLogged>
      <div class="card center">
        <p>Vous devez être connecté pour gérer votre compte.</p>
        <button class="btn-primary" (click)="login()">Se connecter</button>
      </div>
    </ng-template>
  `,
  styles: [`
    h1 { margin: 0 0 20px; }
    .card {
      background: white; border-radius: 12px; padding: 24px;
      border: 1px solid var(--pimp-border); margin-bottom: 16px;
    }
    .card.center { text-align: center; }
    .card.danger { border-color: #fecaca; background: #fef2f2; }
    .profile { display: flex; gap: 20px; align-items: flex-start; }
    .avatar {
      width: 72px; height: 72px; border-radius: 50%;
      object-fit: cover; border: 2px solid var(--pimp-border);
    }
    .profile-body h2, .card h2 { margin: 0 0 8px; font-size: 18px; }
    .muted { color: var(--pimp-muted); margin: 0 0 12px; }
    dl { margin: 8px 0 0; display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; font-size: 14px; }
    dt { color: var(--pimp-muted); }
    dd { margin: 0; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 12px; word-break: break-all; }
    .stats {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px; margin-top: 12px;
    }
    .stat {
      background: var(--pimp-bg); padding: 16px; border-radius: 8px;
      display: flex; flex-direction: column; gap: 4px;
    }
    .stat-label { font-size: 12px; color: var(--pimp-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-value { font-size: 24px; font-weight: 700; color: var(--pimp-primary); }
    .by-site { margin-top: 20px; }
    .by-site h3 { margin: 0 0 8px; font-size: 14px; text-transform: uppercase; color: var(--pimp-muted); letter-spacing: 0.05em; }
    .by-site ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .by-site li { display: flex; align-items: center; gap: 10px; }
    .chip {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 12px; font-weight: 600; color: white;
    }
    .chip[data-site="site-a"] { background: var(--pimp-shop-a); }
    .chip[data-site="site-b"] { background: var(--pimp-shop-b); }
    .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 12px; }
    .btn-danger { background: #dc2626; color: white; }
    .btn-danger:hover { background: #b91c1c; }
  `],
})
export class AccountComponent {
  auth = inject(AuthService);
  private api = inject(AccountService);

  private refresh$ = new BehaviorSubject<void>(undefined);
  account$ = this.refresh$.pipe(switchMap(() => this.api.get()));

  hasSites(account: { stats: { by_site: Record<string, number> } }): boolean {
    return Object.keys(account.stats.by_site).length > 0;
  }

  login(): void {
    this.auth.loginWithRedirect();
  }

  logout(): void {
    this.auth.logout({ logoutParams: { returnTo: window.location.origin } });
  }

  onDelete(): void {
    const ok = window.confirm(
      'Supprimer toutes vos données Pimp (panier, profil local) ? Cette action est irréversible.',
    );
    if (!ok) return;
    this.api.delete().subscribe(() => this.logout());
  }
}
