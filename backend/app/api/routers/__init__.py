from fastapi import FastAPI


def register_routers(app: FastAPI) -> None:
    from app.api.routers import (
        ai,
        auth,
        customers,
        dxf,
        geo,
        insights,
        layout,
        locations,
        logistics,
        network,
        notifications,
        orders,
        picking,
        products,
        regions,
        reports,
        stock,
        warehouses,
    )

    prefix = "/api/v1"
    app.include_router(auth.router, prefix=prefix)
    app.include_router(warehouses.router, prefix=prefix)
    app.include_router(locations.router, prefix=prefix)
    app.include_router(layout.router, prefix=prefix)
    app.include_router(dxf.router, prefix=prefix)
    app.include_router(products.router, prefix=prefix)
    app.include_router(stock.router, prefix=prefix)
    app.include_router(reports.router, prefix=prefix)
    app.include_router(notifications.router, prefix=prefix)
    app.include_router(ai.router, prefix=prefix)
    app.include_router(geo.router, prefix=prefix)
    app.include_router(regions.router, prefix=prefix)
    app.include_router(customers.router, prefix=prefix)
    app.include_router(network.router, prefix=prefix)
    app.include_router(picking.router, prefix=prefix)
    app.include_router(logistics.router, prefix=prefix)
    app.include_router(insights.router, prefix=prefix)
    app.include_router(orders.router, prefix=prefix)
