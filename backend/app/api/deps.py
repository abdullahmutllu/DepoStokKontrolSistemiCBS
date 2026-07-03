from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import ForbiddenError, UnauthorizedError
from app.core.security import decode_access_token
from app.models import User

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise UnauthorizedError("Kimlik doğrulaması gerekli")
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise UnauthorizedError("Geçersiz veya süresi dolmuş oturum")
    user = db.get(User, int(payload["sub"]))
    if user is None:
        raise UnauthorizedError("Kullanıcı bulunamadı")
    return user


def require_owner(user: User = Depends(get_current_user)) -> User:
    if user.role != "owner":
        raise ForbiddenError("Bu işlem için yönetici yetkisi gerekli")
    return user
