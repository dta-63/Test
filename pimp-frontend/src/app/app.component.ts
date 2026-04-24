import { AsyncPipe, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from '@auth0/auth0-angular';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NgIf, AsyncPipe],
  template: `
    <header class="topbar">
      <div class="brand">
        <span class="logo">P</span>
        <strong>Pimp</strong>
        <span class="tagline">votre panier unifié</span>
      </div>
      <nav>
        <ng-container *ngIf="auth.isAuthenticated$ | async; else loginBtn">
          <span class="user" *ngIf="auth.user$ | async as u">{{ u.email || u.name }}</span>
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
    .brand { display: flex; align-items: center; gap: 10px; font-size: 20px; }
    .logo {
      width: 32px; height: 32px; border-radius: 8px;
      background: var(--pimp-primary); color: white;
      display: inline-flex; align-items: center; justify-content: center;
      font-weight: 700;
    }
    .tagline { color: var(--pimp-muted); font-size: 13px; font-weight: 400; margin-left: 8px; }
    nav { display: flex; gap: 12px; align-items: center; }
    .user { color: var(--pimp-muted); font-size: 14px; }
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
