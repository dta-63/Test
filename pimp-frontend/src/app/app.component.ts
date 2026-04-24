import { AsyncPipe, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '@auth0/auth0-angular';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgIf, AsyncPipe],
  template: `
    <header class="topbar">
      <a class="brand" routerLink="/">
        <span class="logo">P</span>
        <strong>Pimp</strong>
        <span class="tagline">votre panier unifié</span>
      </a>
      <nav>
        <ng-container *ngIf="auth.isAuthenticated$ | async; else loginBtn">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Panier</a>
          <a routerLink="/account" routerLinkActive="active">Mon compte</a>
          <button class="btn-ghost" (click)="logout()">Se déconnecter</button>
        </ng-container>
        <ng-template #loginBtn>
          <button class="btn-primary" (click)="login()">Se connecter</button>
        </ng-template>
      </nav>
    </header>
    <main><router-outlet /></main>
  `,
  styles: [`
    .topbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 32px; background: white;
      border-bottom: 1px solid var(--pimp-border);
    }
    .brand {
      display: flex; align-items: center; gap: 10px; font-size: 20px;
      text-decoration: none; color: inherit;
    }
    .logo {
      width: 32px; height: 32px; border-radius: 8px;
      background: var(--pimp-primary); color: white;
      display: inline-flex; align-items: center; justify-content: center;
      font-weight: 700;
    }
    .tagline { color: var(--pimp-muted); font-size: 13px; font-weight: 400; margin-left: 8px; }
    nav { display: flex; gap: 16px; align-items: center; }
    nav a {
      color: var(--pimp-text); text-decoration: none; font-size: 14px; font-weight: 500;
      padding: 6px 10px; border-radius: 6px;
    }
    nav a:hover { background: var(--pimp-bg); }
    nav a.active { color: var(--pimp-primary); background: var(--pimp-bg); }
    main { padding: 32px; max-width: 1000px; margin: 0 auto; }
  `],
})
export class AppComponent {
  auth = inject(AuthService);

  login(): void {
    this.auth.loginWithRedirect();
  }

  logout(): void {
    this.auth.logout({ logoutParams: { returnTo: window.location.origin } });
  }
}
