import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '@auth0/auth0-angular';

/**
 * Landing page for the Auth0 redirect callback (/auth/callback).
 * auth0-angular's AuthModule handles the code exchange automatically;
 * this component just waits for authentication to settle then redirects
 * to the path stored in appState.returnTo (or / by default).
 */
@Component({
  selector: 'app-auth-callback',
  standalone: true,
  template: `<p style="padding:2rem;color:#6b7280">Connexion en cours…</p>`,
})
export class AuthCallbackComponent implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);

  ngOnInit(): void {
    this.auth.appState$.subscribe((state) => {
      const target: string = (state as { returnTo?: string })?.returnTo ?? '/';
      void this.router.navigateByUrl(target);
    });
  }
}
