import jwt
from typing import Optional, List
from pydantic import BaseModel
from fastapi import HTTPException, Security, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from ..config import settings

class ServiceUserContext(BaseModel):
    user_id: str
    tenant_id: Optional[str] = None
    branch_id: Optional[str] = None
    role: str
    roles: List[str] = []
    permissions: List[str] = []
    scopes: List[str] = []
    is_admin: bool = False

security = HTTPBearer()

def get_current_service_context(
    credentials: HTTPAuthorizationCredentials = Security(security)
) -> ServiceUserContext:
    token = credentials.credentials
    try:
        payload = jwt.decode(
            token,
            settings.SERVICE_AUTH_SECRET,
            algorithms=["HS256"],
            issuer=settings.SERVICE_JWT_ISSUER,
            audience=settings.SERVICE_JWT_AUDIENCE
        )
        role = payload.get("role", "customer")
        roles = payload.get("roles") or ([role] if role else [])
        permissions = payload.get("permissions") or []
        scopes = payload.get("scope") or payload.get("scopes") or []
        if isinstance(scopes, str):
            scopes = [s for s in scopes.replace(",", " ").split() if s]
        is_admin = bool(payload.get("isAdmin") or payload.get("admin") or role in ("admin", "ADMIN", "SUPER_ADMIN"))
        return ServiceUserContext(
            user_id=payload.get("sub", ""),
            tenant_id=payload.get("tenantId"),
            branch_id=payload.get("branchId"),
            role=role,
            roles=roles,
            permissions=permissions,
            scopes=scopes,
            is_admin=is_admin,
        )
    except jwt.PyJWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid service authorization token: {str(e)}"
        )
