from collections import Counter

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import CartItem, User
from ..schemas import AccountStats, AccountView, UserOut

router = APIRouter()


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.get("/account", response_model=AccountView)
def get_account(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> AccountView:
    items = db.query(CartItem).filter(CartItem.user_id == user.id).all()
    by_site = Counter(i.site_id for i in items)
    total_quantity = sum(i.quantity for i in items)
    total_value = round(sum(float(i.price) * i.quantity for i in items), 2)
    currency = items[0].currency if items else "EUR"

    return AccountView(
        user=UserOut.model_validate(user),
        stats=AccountStats(
            total_items=len(items),
            total_quantity=total_quantity,
            total_value=total_value,
            currency=currency,
            by_site=dict(by_site),
        ),
    )


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> None:
    """Purge local account data. Auth0 identity itself remains and can log in again."""
    db.delete(user)
    db.commit()
