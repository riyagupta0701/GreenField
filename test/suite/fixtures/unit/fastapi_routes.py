from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

app = FastAPI()

# Pydantic model with real fields
class CreateUserRequest(BaseModel):
    username: str
    email: str
    age: Optional[int] = None
    # Pydantic noise names — should be filtered
    model_config = {"arbitrary_types_allowed": True}

# Pydantic response model
class UserResponse(BaseModel):
    userId: int
    displayName: str
    createdAt: str

# Pattern C: JSONResponse(content={...})
@app.get('/api/status')
def get_status():
    return JSONResponse(content={"status": "ok", "version": "1.0"})

# Pattern B: direct dict return (FastAPI)
@app.get('/api/health')
def health_check():
    return {"healthy": True, "uptime": 9999}

# Pattern E: Pydantic model param — conservative tracking
@app.post('/api/users')
def create_user(item: CreateUserRequest):
    # No explicit field access — conservative: emit all model fields
    db.save(item)
    return UserResponse(userId=1, displayName=item.username, createdAt="2026-01-01")

# Pattern E with explicit field access
@app.post('/api/users/update')
def update_user(item: CreateUserRequest):
    print(item.email)
    print(item.age)
    return {"updated": True}
