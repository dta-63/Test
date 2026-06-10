import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, take } from 'rxjs';

import { MeService } from '@services/me.service';

export const b2bGuard: CanActivateFn = () => {
  const me = inject(MeService);
  const router = inject(Router);

  return me.me$.pipe(
    take(1),
    map((v) => (v.is_b2b ? true : router.parseUrl('/'))),
  );
};
