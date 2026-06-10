import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { AuthService } from '@auth0/auth0-angular';
import { Observable, ReplaySubject, filter, switchMap, take } from 'rxjs';

import { env } from '@core/env';
import { MeView } from '@models/user.model';

@Injectable({ providedIn: 'root' })
export class MeService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private subject = new ReplaySubject<MeView>(1);
  readonly me$: Observable<MeView> = this.subject.asObservable();

  load(): void {
    this.auth.isAuthenticated$
      .pipe(filter(Boolean), take(1), switchMap(() => this.http.get<MeView>(`${env.apiUrl}/api/me`)))
      .subscribe({
        next: (v) => this.subject.next(v),
        error: () => this.subject.next({ user: null as never, is_b2b: false }),
      });
  }
}
