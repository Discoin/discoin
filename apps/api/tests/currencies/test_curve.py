import math
from decimal import Decimal
from fractions import Fraction

import pytest

from app.currencies.curve import CurveError, CurveSide, floor2, give_back, max_amount, payout, rate, value

RICH = CurveSide(reserve=Decimal(1_000_000))
POOR = CurveSide(reserve=Decimal(100_000))


def test_floor2_rounds_down_to_cents() -> None:
    assert floor2(Decimal("99.909")) == Decimal("99.90")
    assert floor2(Decimal("-0.001")) == Decimal("-0.01")
    assert floor2(Decimal(5)) == Decimal("5.00")


def test_value_is_worth_over_reserve() -> None:
    assert value(POOR) == Decimal(1)
    assert value(RICH) == Decimal("0.1")


def test_rate_is_value_ratio() -> None:
    assert rate(RICH, POOR) == Decimal("0.1")
    assert rate(POOR, RICH) == Decimal(10)


def test_payout_example_from_plan() -> None:
    assert payout(Decimal(1_000), RICH, POOR) == Decimal("99.90")


def test_payout_of_tiny_amount_can_be_zero() -> None:
    assert payout(Decimal("0.01"), RICH, POOR) == Decimal("0.00")


def test_payout_stays_below_target_reserve() -> None:
    assert payout(Decimal(1_000_000_000), POOR, RICH) < RICH.reserve


def test_payout_is_exact_when_result_lands_on_a_cent() -> None:
    source = CurveSide(reserve=Decimal(300))
    target = CurveSide(reserve=Decimal(300))

    assert payout(Decimal(300), source, target) == Decimal("150.00")


@pytest.mark.parametrize("amount", [Decimal(0), Decimal(-1)])
def test_payout_rejects_non_positive_amount(amount: Decimal) -> None:
    with pytest.raises(CurveError, match="Amount must be positive"):
        payout(amount, RICH, POOR)


@pytest.mark.parametrize("reserve", [Decimal(0), Decimal(-5)])
def test_side_rejects_non_positive_reserve(reserve: Decimal) -> None:
    with pytest.raises(CurveError, match="Reserve must be positive"):
        CurveSide(reserve=reserve)


def test_side_rejects_non_positive_worth() -> None:
    with pytest.raises(CurveError, match="Worth must be positive"):
        CurveSide(reserve=Decimal(1), worth=Decimal(0))


def test_give_back_runs_payout_back_through_the_curve() -> None:
    paid_out = payout(Decimal(1_000), RICH, POOR)
    source_after = CurveSide(reserve=RICH.reserve + Decimal(1_000))
    target_after = CurveSide(reserve=POOR.reserve - paid_out)

    assert give_back(paid_out, source_after, target_after) == Decimal("999.99")


def test_max_amount_example_from_plan() -> None:
    assert max_amount(Decimal(50), RICH, POOR) == Decimal("500.25")


@pytest.mark.parametrize("remaining", [Decimal(0), Decimal(-10)])
def test_max_amount_is_zero_when_nothing_remains(remaining: Decimal) -> None:
    assert max_amount(remaining, RICH, POOR) == Decimal("0.00")


@pytest.mark.parametrize("remaining", [POOR.reserve, POOR.reserve + 1])
def test_max_amount_is_unbounded_when_remaining_reaches_reserve(remaining: Decimal) -> None:
    assert max_amount(remaining, RICH, POOR) is None


@pytest.mark.parametrize("remaining", [Decimal("0.01"), Decimal(50), Decimal("1234.56"), Decimal(99_999)])
def test_max_amount_payout_fits_remaining(remaining: Decimal) -> None:
    most = max_amount(remaining, RICH, POOR)

    assert payout(most, RICH, POOR) <= remaining
    assert payout(most + Decimal("0.01"), RICH, POOR) >= floor2(remaining - Decimal("0.01"))


STRONG = CurveSide(reserve=Decimal(1_000_000), worth=Decimal(200_000))
WEAK = CurveSide(reserve=Decimal(100_000), worth=Decimal(50_000))


def test_payout_with_unequal_worth_uses_the_power_curve() -> None:
    exponent = 200_000 / 50_000
    expected = floor2(Decimal(100_000) * Decimal(1 - (1_000_000 / 1_001_000) ** exponent))

    assert payout(Decimal(1_000), STRONG, WEAK) == expected
    assert expected == Decimal("399.00")


def test_payout_with_unequal_worth_matches_small_amount_rate() -> None:
    small = Decimal(100)
    expected_per_unit = rate(STRONG, WEAK)

    assert payout(small, STRONG, WEAK) / small == pytest.approx(expected_per_unit, rel=Decimal("0.001"))


def test_give_back_with_unequal_worth_inverts_the_exponent() -> None:
    paid_out = payout(Decimal(1_000), STRONG, WEAK)
    source_after = CurveSide(reserve=STRONG.reserve + Decimal(1_000), worth=STRONG.worth)
    target_after = CurveSide(reserve=WEAK.reserve - paid_out, worth=WEAK.worth)

    returned = give_back(paid_out, source_after, target_after)

    assert Decimal(990) < returned <= Decimal(1_000)


@pytest.mark.parametrize("remaining", [Decimal("0.01"), Decimal(50), Decimal("1234.56"), Decimal(99_000)])
def test_max_amount_with_unequal_worth_fits_remaining(remaining: Decimal) -> None:
    most = max_amount(remaining, STRONG, WEAK)

    assert payout(most, STRONG, WEAK) <= remaining
    assert payout(most + Decimal("0.01"), STRONG, WEAK) >= floor2(remaining - Decimal("0.01"))


def test_payout_is_exact_at_the_largest_stored_reserve() -> None:
    largest = Decimal("99999999999999.99")
    amount = Decimal("999999999.99")
    source = CurveSide(reserve=largest)
    target = CurveSide(reserve=largest - Decimal("0.01"))

    cents = math.floor(Fraction(target.reserve) * Fraction(amount) * 100 / Fraction(source.reserve + amount))

    assert payout(amount, source, target) == Decimal(cents) / 100
