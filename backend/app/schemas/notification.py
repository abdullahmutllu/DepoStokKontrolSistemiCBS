from datetime import datetime

from pydantic import BaseModel, ConfigDict


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    title: str
    message: str
    product_id: int | None
    read: bool
    created_at: datetime


class UnreadCountOut(BaseModel):
    unread: int
