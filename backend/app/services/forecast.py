"""Talep tahmini: Holt çift üstel düzeltme + yeniden sipariş noktası (ROP).

Saf, deterministik fonksiyonlar — db/FastAPI bağımlılığı yok, stdlib yeterli.
"""

import math


def holt_forecast(
    series: list[float], horizon: int, alpha: float = 0.35, beta: float = 0.15
) -> list[float]:
    """Holt (trend bileşenli) üstel düzeltme ile `horizon` adımlık tahmin.

    n<2 için son değer (seri boşsa 0) tekrarlanır. Negatif tahminler 0'a kırpılır.
    """
    if horizon <= 0:
        return []
    if len(series) < 2:
        last = float(series[-1]) if series else 0.0
        return [max(0.0, last)] * horizon
    level = float(series[0])
    trend = float(series[1]) - float(series[0])
    for value in series[1:]:
        prev_level = level
        level = alpha * float(value) + (1 - alpha) * (level + trend)
        trend = beta * (level - prev_level) + (1 - beta) * trend
    return [max(0.0, level + step * trend) for step in range(1, horizon + 1)]


def demand_stats(series: list[float]) -> tuple[float, float]:
    """(günlük ortalama, popülasyon std). n<2 için std=0."""
    n = len(series)
    if n == 0:
        return 0.0, 0.0
    mean = math.fsum(series) / n
    if n < 2:
        return mean, 0.0
    variance = math.fsum((x - mean) ** 2 for x in series) / n
    return mean, math.sqrt(variance)


def reorder_point(series: list[float], lead_time_days: int = 3, service_z: float = 1.65) -> int:
    """ROP = ceil(ort * L + z * std * sqrt(L)); en az 0."""
    mean, std = demand_stats(series)
    lead = max(lead_time_days, 0)
    raw = mean * lead + service_z * std * math.sqrt(lead)
    return max(0, math.ceil(raw))


def days_until_stockout(current_stock: float, forecast: list[float]) -> int | None:
    """Kümülatif tahminin stoğu aştığı ilk gün (1-indexli); hiç aşmazsa None."""
    cumulative = 0.0
    for day, demand in enumerate(forecast, start=1):
        cumulative += demand
        if cumulative > current_stock:
            return day
    return None
