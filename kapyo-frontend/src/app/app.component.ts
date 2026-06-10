import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '@auth0/auth0-angular';
import { Subscription } from 'rxjs';

import { env, isAuth0Configured } from '@core/env';
import { MeService } from '@services/me.service';
import { NotificationsService } from '@services/notifications.service';
import { PublicConfigService } from '@services/public-config.service';
import { WebSocketService } from '@services/websocket.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgIf, NgFor, AsyncPipe],
  template: `
    <div *ngIf="!auth0Configured" class="config-banner" role="alert">
      <strong>Auth0 non configuré.</strong>
      Le bouton "Se connecter" ne fait rien tant que vous n'avez pas créé un
      tenant Auth0 et renseigné <code>AUTH0_DOMAIN</code>,
      <code>AUTH0_API_AUDIENCE</code> et <code>AUTH0_SPA_CLIENT_ID</code> dans
      le fichier <code>.env</code>, puis rebuild :
      <code>docker compose up -d --build kapyo-frontend kapyo-backend</code>.
      Voir la section "Démarrage" du README.
    </div>

    <header class="topbar">
      <a class="brand" routerLink="/">
        <span class="logo">P</span>
        <strong>Kapyo</strong>
        <span class="tagline">votre panier unifié</span>
      </a>
      <nav>
        <ng-container *ngIf="auth.isAuthenticated$ | async; else loginBtn">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Panier</a>
          <a routerLink="/account" routerLinkActive="active">Mon compte</a>
          <a *ngIf="(me.me$ | async)?.is_b2b" routerLink="/b2b" routerLinkActive="active" class="b2b-link">
            <span class="dot"></span>B2B
          </a>
          <button class="btn-ghost" (click)="logout()">Se déconnecter</button>
        </ng-container>
        <ng-template #loginBtn>
          <button class="btn-primary" (click)="login()" [disabled]="!auth0Configured">Se connecter</button>
        </ng-template>
      </nav>
    </header>
    <main><router-outlet /></main>

    <div class="toasts" role="status" aria-live="polite">
      <div *ngFor="let n of notif.notifications()" class="toast" [attr.data-kind]="n.kind">
        <span>{{ n.message }}</span>
        <button (click)="notif.dismiss(n.id)" aria-label="Fermer">×</button>
      </div>
    </div>
  `,
  styles: [`
    .config-banner {
      background: #fef3c7; color: #92400e;
      border-bottom: 1px solid #fcd34d;
      padding: 12px 24px; font-size: 14px; line-height: 1.5;
    }
    .config-banner code {
      background: rgba(0,0,0,0.06); padding: 1px 6px;
      border-radius: 4px; font-size: 12px;
    }
    .topbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 32px; background: white;
      border-bottom: 1px solid var(--kapyo-border);
    }
    .brand {
      display: flex; align-items: center; gap: 10px; font-size: 20px;
      text-decoration: none; color: inherit;
    }
    .logo {
      width: 32px; height: 32px; border-radius: 8px;
      background: var(--kapyo-primary); color: white;
      display: inline-flex; align-items: center; justify-content: center;
      font-weight: 700;
    }
    .tagline { color: var(--kapyo-muted); font-size: 13px; font-weight: 400; margin-left: 8px; }
    nav { display: flex; gap: 16px; align-items: center; }
    nav a {
      color: var(--kapyo-text); text-decoration: none; font-size: 14px; font-weight: 500;
      padding: 6px 10px; border-radius: 6px;
    }
    nav a:hover { background: var(--kapyo-bg); }
    nav a.active { color: var(--kapyo-primary); background: var(--kapyo-bg); }
    nav a.b2b-link { display: inline-flex; align-items: center; gap: 6px; }
    nav a.b2b-link .dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #059669; box-shadow: 0 0 0 3px rgba(5,150,105,0.15);
    }
    main { padding: 32px; max-width: 1100px; margin: 0 auto; }

    .toasts {
      position: fixed; bottom: 20px; right: 20px; z-index: 9999;
      display: flex; flex-direction: column; gap: 10px;
      max-width: 360px;
    }
    .toast {
      background: white; border-left: 4px solid var(--kapyo-primary);
      padding: 12px 14px; border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.12);
      display: flex; align-items: flex-start; gap: 8px;
      font-size: 14px; animation: toast-in 0.2s ease-out;
    }
    .toast[data-kind="success"] { border-left-color: #059669; }
    .toast[data-kind="warning"] { border-left-color: #d97706; }
    .toast button {
      margin-left: auto; background: transparent; padding: 0 6px;
      color: var(--kapyo-muted); font-size: 18px; line-height: 1;
    }
    @keyframes toast-in {
      from { transform: translateX(20px); opacity: 0; }
      to   { transform: translateX(0);    opacity: 1; }
    }
  `],
})
export class AppComponent implements OnInit, OnDestroy {
  auth = inject(AuthService);
  me = inject(MeService);
  notif = inject(NotificationsService);
  private cfg = inject(PublicConfigService);
  private ws = inject(WebSocketService);

  readonly auth0Configured = isAuth0Configured();

  private sub?: Subscription;

  ngOnInit(): void {
    if (!this.auth0Configured) {
      console.error(
        '[Kapyo] Auth0 is not configured. Got domain=%s clientId=%s. ' +
        'Create a .env from .env.example, fill AUTH0_* vars, then ' +
        'docker compose up -d --build kapyo-frontend kapyo-backend.',
        env.auth0Domain, env.auth0ClientId,
      );
      return;
    }
    this.cfg.load();
    this.sub = this.auth.isAuthenticated$.subscribe((ok) => {
      if (ok) {
        void this.ws.start();
        this.me.load();
      } else {
        this.ws.stop();
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.ws.stop();
  }

  login(): void {
    this.auth.loginWithRedirect();
  }

  logout(): void {
    this.auth.logout({ logoutParams: { returnTo: window.location.origin } });
  }
}
