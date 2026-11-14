from uuid import UUID

from fastapi import APIRouter

from app.core.database import Database
from app.transactions.models import Transaction
from app.transactions.queries import PageQuery, list_currency_transactions, list_recent_transactions

router = APIRouter(tags=["transactions"])


@router.get("/transactions")
def get_recent_transactions(page: PageQuery, db: Database) -> list[Transaction]:
    return list_recent_transactions(db, page)


@router.get("/currencies/{currency_id}/transactions")
def get_currency_transactions(currency_id: UUID, page: PageQuery, db: Database) -> list[Transaction]:
    return list_currency_transactions(db, currency_id, page)
