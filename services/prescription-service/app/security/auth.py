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
    permissions: List[str] = []

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
        return ServiceUserContext(
            user_id=payload.get("sub", ""),
            tenant_id=payload.get("tenantId"),
            branch_id=payload.get("branchId"),
            role=payload.get("role", "customer"),
            permissions=payload.get("permissions", [])
        )
    except jwt.PyJWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid service authorization token: {str(e)}"
        )
