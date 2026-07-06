"""levels table + warehouse bearing + storage_location level_id (indoor georef)

Revision ID: b8f1c2a3d4e5
Revises: f2797d4c4b28
Create Date: 2026-07-06 13:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'b8f1c2a3d4e5'
down_revision: Union[str, Sequence[str], None] = 'f2797d4c4b28'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'levels',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('warehouse_id', sa.Integer(), nullable=False),
        sa.Column('ordinal', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('name', sa.String(length=80), nullable=False, server_default='Zemin'),
        sa.Column('base_elevation_m', sa.Float(), nullable=False, server_default='0'),
        sa.Column('meta', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(['warehouse_id'], ['warehouses.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('warehouse_id', 'ordinal', name='uq_levels_warehouse_ordinal'),
    )
    op.create_index(op.f('ix_levels_warehouse_id'), 'levels', ['warehouse_id'], unique=False)

    op.add_column(
        'warehouses',
        sa.Column('bearing_deg', sa.Float(), nullable=False, server_default='0'),
    )

    op.add_column('storage_locations', sa.Column('level_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_storage_locations_level_id',
        'storage_locations',
        'levels',
        ['level_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_index(
        op.f('ix_storage_locations_level_id'), 'storage_locations', ['level_id'], unique=False
    )

    # Backfill: every existing warehouse gets a ground level; its locations join it.
    op.execute(
        "INSERT INTO levels (warehouse_id, ordinal, name, base_elevation_m) "
        "SELECT id, 0, 'Zemin', 0 FROM warehouses"
    )
    op.execute(
        "UPDATE storage_locations sl SET level_id = l.id "
        "FROM levels l WHERE l.warehouse_id = sl.warehouse_id AND l.ordinal = 0"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_storage_locations_level_id'), table_name='storage_locations')
    op.drop_constraint('fk_storage_locations_level_id', 'storage_locations', type_='foreignkey')
    op.drop_column('storage_locations', 'level_id')
    op.drop_column('warehouses', 'bearing_deg')
    op.drop_index(op.f('ix_levels_warehouse_id'), table_name='levels')
    op.drop_table('levels')
