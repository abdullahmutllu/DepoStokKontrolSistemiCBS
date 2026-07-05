"""Talep tahmini (Holt) ve ROP: elle doğrulanabilir mini serilerle saf birim testleri."""

import math

import pytest

from app.services.forecast import (
    days_until_stockout,
    demand_stats,
    holt_forecast,
    reorder_point,
)


class TestHoltForecast:
    def test_constant_series_gives_constant_forecast(self):
        # level=5, trend=0 sabit kalır → tüm tahminler 5.
        assert holt_forecast([5.0, 5.0, 5.0, 5.0], horizon=4) == pytest.approx([5.0] * 4)

    def test_increasing_trend_forecasts_above_last_value(self):
        series = [1.0, 2.0, 3.0, 4.0, 5.0]
        result = holt_forecast(series, horizon=3)
        assert all(v > series[-1] for v in result)
        assert result == sorted(result)  # trend korunur, tahmin artan

    def test_negative_forecasts_clipped_to_zero(self):
        # Düşen seri: ham tahmin negatife iner (1 - 3*step), kırpılır.
        result = holt_forecast([10.0, 7.0, 4.0, 1.0], horizon=3)
        assert result == pytest.approx([0.0, 0.0, 0.0])
        assert min(result) >= 0.0

    def test_short_series_fallback_repeats_last_value(self):
        assert holt_forecast([7.0], horizon=4) == [7.0] * 4
        assert holt_forecast([], horizon=3) == [0.0] * 3
        assert holt_forecast([-3.0], horizon=2) == [0.0, 0.0]  # fallback da kırpılır

    def test_zero_horizon_returns_empty(self):
        assert holt_forecast([1.0, 2.0, 3.0], horizon=0) == []


class TestDemandStats:
    def test_mean_and_population_std(self):
        mean, std = demand_stats([2.0, 4.0, 6.0])
        assert mean == pytest.approx(4.0)
        assert std == pytest.approx(math.sqrt(8.0 / 3.0))

    def test_short_series_std_is_zero(self):
        assert demand_stats([5.0]) == (5.0, 0.0)
        assert demand_stats([]) == (0.0, 0.0)


class TestReorderPoint:
    def test_matches_hand_computed_formula(self):
        series = [4.0, 6.0, 8.0, 6.0, 4.0]
        # ort = 5.6, pop. std = sqrt(11.2/5); ROP = ceil(5.6*3 + 1.65*std*sqrt(3)) = 22
        mean = 5.6
        std = math.sqrt(11.2 / 5.0)
        expected = math.ceil(mean * 3 + 1.65 * std * math.sqrt(3))
        assert expected == 22
        assert reorder_point(series, lead_time_days=3, service_z=1.65) == 22

    def test_empty_series_is_zero(self):
        assert reorder_point([]) == 0


class TestDaysUntilStockout:
    def test_stock_10_forecast_4_4_4_runs_out_on_day_3(self):
        assert days_until_stockout(10.0, [4.0, 4.0, 4.0]) == 3

    def test_returns_none_when_stock_never_exceeded(self):
        assert days_until_stockout(100.0, [4.0, 4.0, 4.0]) is None
        assert days_until_stockout(12.0, [4.0, 4.0, 4.0]) is None  # eşitlik aşma sayılmaz
        assert days_until_stockout(5.0, []) is None
